import threading
import uuid

import numpy as np
import pandas as pd
from flask import jsonify, request

from core import state as S
from core.routes_auth import (
    _changed_by_user_id,
    _current_user,
    _load_auth,
    _require_admin,
    _require_auth,
    _save_auth,
    auth_lock,
)
from core.routes_registration import _build_registration_pipeline

_req_lock = threading.Lock()


def _scd_ts():
    return S._scd_timestamp()


def _send_notification(for_person_id, notif_type: str, payload: dict):
    try:
        with S.notif_lock:
            data = S.db.load_notifications()
            notif = {
                "id": str(uuid.uuid4())[:12],
                "type": notif_type,
                "for_person_id": for_person_id,
                "read": False,
                "created_at": _scd_ts(),
                **payload,
            }
            data["notifications"].append(notif)
            S.db.save_notifications(data)
    except Exception as e:
        print(f"Warning: notification failed: {e}")


def _notify_admins(notif_type: str, payload: dict):
    auth_data = _load_auth()
    for user in auth_data["users"]:
        if user.get("role") == "admin":
            _send_notification(user.get("person_id"), notif_type, payload)


def _get_pending_registrations() -> list[dict]:
    """Return all persons with admin_approval_status = pending."""
    all_p = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    if all_p.empty or S.ADMIN_APPROVAL_STATUS_COL not in all_p.columns:
        return []
    pending = all_p[all_p[S.ADMIN_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower() == S.APPROVAL_STATUS_PENDING]
    return pending.replace({np.nan: None}).to_dict(orient="records")


def _get_all_registration_requests() -> list[dict]:
    """Return all persons with a non-null admin_approval_status."""
    all_p = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    if all_p.empty or S.ADMIN_APPROVAL_STATUS_COL not in all_p.columns:
        return []
    has_status = all_p[S.ADMIN_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower().isin(
        [S.APPROVAL_STATUS_PENDING, S.APPROVAL_STATUS_APPROVED, S.APPROVAL_STATUS_REJECTED]
    )
    return all_p[has_status].replace({np.nan: None}).to_dict(orient="records")


def _get_yg_assignments_for_approver(person_id: str) -> list[dict]:
    """Return pipelines for awaiting_yg memberships this person is designated to approve."""
    from core.routes_privileges import can_user_approve_yg_membership

    pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
    if pyg.empty or S.YG_APPROVAL_STATUS_COL not in pyg.columns:
        return []

    awaiting = pyg[pyg[S.YG_APPROVAL_STATUS_COL].astype(str).str.strip() == S.APPROVAL_STATUS_AWAITING_YG]
    if awaiting.empty:
        return []

    candidate_pids: set[str] = set()
    for _, row in awaiting.iterrows():
        yg_id = str(row.get(S.YOUTH_GROUP_ID_COL) or "")
        age_group = str(row.get("age_group") or "")
        pid = S._person_id_key(row.get("person_id"))
        if pid and can_user_approve_yg_membership(person_id, yg_id, age_group):
            candidate_pids.add(pid)

    result = []
    for pid_str in candidate_pids:
        try:
            pipeline = _build_registration_pipeline(int(pid_str), viewer_person_id=person_id)
            result.append({"type": "registration", "pipeline": pipeline})
        except (ValueError, TypeError):
            continue
    return result


def _activate_account_if_ready(person_id: int):
    """Set account_status=active if person has at least one approved YG membership (or no memberships)."""
    pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
    has_memberships = False
    has_approved = False
    if not pyg.empty and "person_id" in pyg.columns:
        rows = pyg[pyg["person_id"].astype(str) == str(person_id)]
        if not rows.empty:
            has_memberships = True
            statuses = rows[S.YG_APPROVAL_STATUS_COL].astype(str).str.strip().tolist() if S.YG_APPROVAL_STATUS_COL in rows.columns else []
            has_approved = any(s == S.APPROVAL_STATUS_APPROVED for s in statuses)

    if not has_memberships or has_approved:
        with auth_lock:
            auth_data = _load_auth()
            for user in auth_data["users"]:
                uid = S._normalize_person_id(user.get("person_id"))
                if uid is not None and str(uid) == str(person_id):
                    if user.get("account_status") == "pending":
                        user["account_status"] = "active"
            _save_auth(auth_data)
        return True
    return False


def _deactivate_account_all_yg_rejected(person_id: int):
    """Deactivate account and mark person rejected when every YG membership is rejected (Scenario C)."""
    pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
    all_rejected = True
    has_memberships = False
    if not pyg.empty and "person_id" in pyg.columns:
        rows = pyg[pyg["person_id"].astype(str) == str(person_id)]
        if not rows.empty:
            has_memberships = True
            statuses = rows[S.YG_APPROVAL_STATUS_COL].astype(str).str.strip().tolist() if S.YG_APPROVAL_STATUS_COL in rows.columns else []
            all_rejected = all(s == S.APPROVAL_STATUS_REJECTED for s in statuses)

    if not has_memberships or not all_rejected:
        return False

    # Revert admin_approval_status to rejected so person is hidden from member lists
    with S.lock:
        persons = S.store.get("persons", pd.DataFrame()).copy()
        if not persons.empty and "person_id" in persons.columns:
            mask = (persons["person_id"].astype(str) == str(person_id)) & S._scd_active_mask(persons)
            if mask.any():
                persons.loc[mask, S.ADMIN_APPROVAL_STATUS_COL] = S.APPROVAL_STATUS_REJECTED
                S.store["persons"] = persons
                S.save()

    with auth_lock:
        auth_data = _load_auth()
        for user in auth_data["users"]:
            uid = S._normalize_person_id(user.get("person_id"))
            if uid is not None and str(uid) == str(person_id):
                user["account_status"] = "rejected_yg"
                user["rejection_reason"] = "تم رفض عضويتك في جميع فرق الشبيبة."
        _save_auth(auth_data)
    return True


def register_requests_routes(app):

    @app.get("/api/requests")
    def get_requests():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        role = u.get("role")
        account_status = u.get("account_status") or "active"
        is_pending = account_status == "pending"

        # Pending users see only their own status
        if is_pending:
            person_id = u.get("person_id")
            if not person_id:
                return jsonify({"requests": [], "yg_assignments": [], "view": "my_status"})
            pipeline = _build_registration_pipeline(int(person_id))
            return jsonify({
                "requests": [{"type": "registration", "pipeline": pipeline}],
                "yg_assignments": [],
                "view": "my_status",
            })

        # Admin: show pending admin-level requests
        admin_requests = []
        if role == "admin":
            for row in _get_pending_registrations():
                pid = row.get("person_id")
                if pid is None:
                    continue
                pipeline = _build_registration_pipeline(int(pid))
                admin_requests.append({"type": "registration", "pipeline": pipeline})

        # Any user with yg_registration_approval grants: show their YG assignment queue
        yg_assignments = []
        person_id = u.get("person_id")
        if person_id:
            from core.routes_privileges import get_user_yg_registration_approval_scope
            if get_user_yg_registration_approval_scope(str(person_id)):
                yg_assignments = _get_yg_assignments_for_approver(str(person_id))

        if role == "admin":
            view = "admin"
        elif yg_assignments:
            view = "yg_approver"
        else:
            view = "none"

        return jsonify({
            "requests": admin_requests,
            "yg_assignments": yg_assignments,
            "view": view,
        })

    @app.post("/api/requests/<int:person_id>/admin-approve")
    def admin_approve_request(person_id):
        err = _require_admin()
        if err:
            return err

        u = _current_user()
        changed_by = _changed_by_user_id(u)
        notes = (request.json or {}).get("notes") or ""
        now = _scd_ts()

        from core.routes_privileges import get_yg_registration_approval_grantees

        with _req_lock:
            with S.lock:
                persons = S.store.get("persons", pd.DataFrame()).copy()
                if persons.empty or "person_id" not in persons.columns:
                    return jsonify({"error": "person not found"}), 404
                mask = (persons["person_id"].astype(str) == str(person_id)) & S._scd_active_mask(persons)
                if not mask.any():
                    return jsonify({"error": "person not found"}), 404

                for col, val in [
                    (S.ADMIN_APPROVAL_STATUS_COL, S.APPROVAL_STATUS_APPROVED),
                    (S.ADMIN_APPROVAL_BY_COL, changed_by),
                    (S.ADMIN_APPROVAL_DATE_COL, now),
                    (S.ADMIN_APPROVAL_NOTES_COL, notes),
                ]:
                    if col not in persons.columns:
                        persons[col] = None
                    persons.loc[mask, col] = val
                S.store["persons"] = persons

                # Per-membership: check for second-approver grantees
                pyg = S.store.get("person_youth_group", pd.DataFrame()).copy()
                has_memberships = False
                all_auto_approved = True
                # {grantee_person_id: [(yg_name, age_group, record_id), ...]}
                grantee_notifications: dict[str, list[tuple]] = {}

                if not pyg.empty and "person_id" in pyg.columns:
                    pyg_mask = (pyg["person_id"].astype(str) == str(person_id)) & S._scd_active_mask(pyg)
                    if pyg_mask.any():
                        has_memberships = True
                        for col in [S.YG_APPROVAL_STATUS_COL, S.YG_APPROVED_BY_COL, S.YG_APPROVAL_DATE_COL, S.YG_APPROVAL_NOTES_COL]:
                            if col not in pyg.columns:
                                pyg[col] = None

                        for idx in pyg[pyg_mask].index:
                            yg_id = str(pyg.loc[idx, S.YOUTH_GROUP_ID_COL] if S.YOUTH_GROUP_ID_COL in pyg.columns else "")
                            age_group = str(pyg.loc[idx, "age_group"] if "age_group" in pyg.columns else "")
                            record_id = str(pyg.loc[idx, S.PERSON_YOUTH_GROUP_RECORD_ID_COL] if S.PERSON_YOUTH_GROUP_RECORD_ID_COL in pyg.columns else "")

                            grantees = get_yg_registration_approval_grantees(yg_id, age_group)
                            if grantees:
                                # Needs second approval
                                pyg.loc[idx, S.YG_APPROVAL_STATUS_COL] = S.APPROVAL_STATUS_AWAITING_YG
                                all_auto_approved = False
                                yg_name = S.youth_group_display_label(yg_id)
                                for grantee in grantees:
                                    gpid = str(grantee["person_id"])
                                    grantee_notifications.setdefault(gpid, []).append(
                                        (yg_name, age_group, record_id)
                                    )
                            else:
                                # Auto-approve
                                pyg.loc[idx, S.YG_APPROVAL_STATUS_COL] = S.APPROVAL_STATUS_APPROVED
                                pyg.loc[idx, S.YG_APPROVED_BY_COL] = changed_by
                                pyg.loc[idx, S.YG_APPROVAL_DATE_COL] = now

                        S.store["person_youth_group"] = pyg

                S.save()

            # Set account active if no memberships or all auto-approved
            if not has_memberships or all_auto_approved:
                with auth_lock:
                    auth_data = _load_auth()
                    for user in auth_data["users"]:
                        uid = S._normalize_person_id(user.get("person_id"))
                        if uid is not None and str(uid) == str(person_id):
                            user["account_status"] = "active"
                    _save_auth(auth_data)

        # Notify the registering person that admin approved their personal data
        auth_data = _load_auth()
        display_name = ""
        person_auth_user = None
        for user in auth_data["users"]:
            uid = S._normalize_person_id(user.get("person_id"))
            if uid is not None and str(uid) == str(person_id):
                person_auth_user = user
                break

        if person_auth_user:
            _send_notification(person_auth_user.get("person_id"), "registration_admin_approved", {
                "person_id": person_id,
                "message": "تمت الموافقة على بياناتك الشخصية من قِبَل الفريق.",
            })

        # Notify YG grantees for each awaiting_yg membership
        if grantee_notifications:
            # Build the person's display name for the notification
            with S.lock:
                all_persons = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
                if not all_persons.empty and "person_id" in all_persons.columns:
                    match = all_persons[all_persons["person_id"].astype(str) == str(person_id)]
                    if not match.empty:
                        row = match.iloc[0]
                        parts = [str(row.get(k) or "").strip() for k in
                                 ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")]
                        display_name = " ".join(p for p in parts if p)

            for gpid, memberships in grantee_notifications.items():
                for (yg_name, age_group, record_id) in memberships:
                    ag_label = f" - فئة {age_group}" if age_group else ""
                    _send_notification(gpid, "registration_yg_approval_needed", {
                        "person_id": person_id,
                        "person_name": display_name,
                        "youth_group_name": yg_name,
                        "age_group": age_group,
                        "record_id": record_id,
                        "message": f"طلب عضوية جديد في {yg_name}{ag_label} يحتاج موافقتك: {display_name or 'متقدّم جديد'}",
                    })

        return jsonify({"ok": True})

    @app.post("/api/requests/<int:person_id>/admin-reject")
    def admin_reject_request(person_id):
        err = _require_admin()
        if err:
            return err

        u = _current_user()
        changed_by = _changed_by_user_id(u)
        body = request.json or {}
        notes = (body.get("notes") or body.get("reason") or "").strip()
        now = _scd_ts()

        with _req_lock:
            with S.lock:
                persons = S.store.get("persons", pd.DataFrame()).copy()
                if persons.empty or "person_id" not in persons.columns:
                    return jsonify({"error": "person not found"}), 404
                mask = (persons["person_id"].astype(str) == str(person_id)) & S._scd_active_mask(persons)
                if not mask.any():
                    return jsonify({"error": "person not found"}), 404
                for col, val in [
                    (S.ADMIN_APPROVAL_STATUS_COL, S.APPROVAL_STATUS_REJECTED),
                    (S.ADMIN_APPROVAL_BY_COL, changed_by),
                    (S.ADMIN_APPROVAL_DATE_COL, now),
                    (S.ADMIN_APPROVAL_NOTES_COL, notes),
                ]:
                    if col not in persons.columns:
                        persons[col] = None
                    persons.loc[mask, col] = val
                S.store["persons"] = persons

                # Reject all YG memberships too
                pyg = S.store.get("person_youth_group", pd.DataFrame()).copy()
                if not pyg.empty and "person_id" in pyg.columns:
                    pyg_mask = (pyg["person_id"].astype(str) == str(person_id)) & S._scd_active_mask(pyg)
                    if pyg_mask.any():
                        for col in [S.YG_APPROVAL_STATUS_COL, S.YG_APPROVED_BY_COL, S.YG_APPROVAL_DATE_COL]:
                            if col not in pyg.columns:
                                pyg[col] = None
                        pyg.loc[pyg_mask, S.YG_APPROVAL_STATUS_COL] = S.APPROVAL_STATUS_REJECTED
                        S.store["person_youth_group"] = pyg

                S.save()

            with auth_lock:
                auth_data = _load_auth()
                for user in auth_data["users"]:
                    uid = S._normalize_person_id(user.get("person_id"))
                    if uid is not None and str(uid) == str(person_id):
                        user["account_status"] = "rejected_admin"
                        user["rejection_reason"] = notes
                _save_auth(auth_data)

        # Notify user
        auth_data = _load_auth()
        for user in auth_data["users"]:
            uid = S._normalize_person_id(user.get("person_id"))
            if uid is not None and str(uid) == str(person_id):
                msg = "تم رفض طلب تسجيلك من قِبَل الفريق."
                if notes:
                    msg += f" السبب: {notes}"
                _send_notification(user.get("person_id"), "registration_admin_rejected", {
                    "person_id": person_id,
                    "message": msg,
                    "reason": notes,
                })
                break

        return jsonify({"ok": True})

    @app.post("/api/requests/yg/<record_id>/approve")
    def yg_approve_membership(record_id):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        from core.routes_privileges import can_user_approve_yg_membership
        viewer_pid = str(u.get("person_id") or "")
        notes = (request.json or {}).get("notes") or ""
        now = _scd_ts()
        changed_by = _changed_by_user_id(u)

        with _req_lock:
            with S.lock:
                pyg = S.store.get("person_youth_group", pd.DataFrame()).copy()
                if pyg.empty or S.PERSON_YOUTH_GROUP_RECORD_ID_COL not in pyg.columns:
                    return jsonify({"error": "membership not found"}), 404

                rec_mask = (pyg[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str) == record_id) & S._scd_active_mask(pyg)
                if not rec_mask.any():
                    return jsonify({"error": "membership not found"}), 404

                yg_id = str(pyg[rec_mask][S.YOUTH_GROUP_ID_COL].iloc[0] if S.YOUTH_GROUP_ID_COL in pyg.columns else "")
                age_group = str(pyg[rec_mask]["age_group"].iloc[0] if "age_group" in pyg.columns else "")
                member_pid = pyg[rec_mask]["person_id"].iloc[0] if "person_id" in pyg.columns else None
                current_yg_status = str(pyg[rec_mask][S.YG_APPROVAL_STATUS_COL].iloc[0] if S.YG_APPROVAL_STATUS_COL in pyg.columns else "")

                if current_yg_status != S.APPROVAL_STATUS_AWAITING_YG:
                    return jsonify({"error": "membership is not awaiting YG approval"}), 400

                # Permission check: must be the designated approver or admin
                is_admin = u.get("role") == "admin"
                if not is_admin and not can_user_approve_yg_membership(viewer_pid, yg_id, age_group):
                    return jsonify({"error": "unauthorized"}), 403

                for col in [S.YG_APPROVAL_STATUS_COL, S.YG_APPROVED_BY_COL, S.YG_APPROVAL_DATE_COL, S.YG_APPROVAL_NOTES_COL]:
                    if col not in pyg.columns:
                        pyg[col] = None
                pyg.loc[rec_mask, S.YG_APPROVAL_STATUS_COL] = S.APPROVAL_STATUS_APPROVED
                pyg.loc[rec_mask, S.YG_APPROVED_BY_COL] = changed_by
                pyg.loc[rec_mask, S.YG_APPROVAL_DATE_COL] = now
                if notes:
                    pyg.loc[rec_mask, S.YG_APPROVAL_NOTES_COL] = notes
                S.store["person_youth_group"] = pyg
                S.save()

            member_pid_int = int(member_pid) if member_pid is not None else None

        # Activate account if this is the first approved membership
        if member_pid_int is not None:
            _activate_account_if_ready(member_pid_int)

        # Notify the member
        if member_pid is not None:
            yg_name = S.youth_group_display_label(yg_id)
            ag_label = f" - فئة {age_group}" if age_group else ""
            _send_notification(member_pid, "registration_yg_approved", {
                "person_id": member_pid,
                "youth_group_name": yg_name,
                "age_group": age_group,
                "message": f"تمت الموافقة على عضويتك في {yg_name}{ag_label}!",
            })

        return jsonify({"ok": True})

    @app.post("/api/requests/yg/<record_id>/reject")
    def yg_reject_membership(record_id):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        from core.routes_privileges import can_user_approve_yg_membership
        viewer_pid = str(u.get("person_id") or "")
        body = request.json or {}
        reason = (body.get("reason") or body.get("notes") or "").strip()
        now = _scd_ts()
        changed_by = _changed_by_user_id(u)

        with _req_lock:
            with S.lock:
                pyg = S.store.get("person_youth_group", pd.DataFrame()).copy()
                if pyg.empty or S.PERSON_YOUTH_GROUP_RECORD_ID_COL not in pyg.columns:
                    return jsonify({"error": "membership not found"}), 404

                rec_mask = (pyg[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str) == record_id) & S._scd_active_mask(pyg)
                if not rec_mask.any():
                    return jsonify({"error": "membership not found"}), 404

                yg_id = str(pyg[rec_mask][S.YOUTH_GROUP_ID_COL].iloc[0] if S.YOUTH_GROUP_ID_COL in pyg.columns else "")
                age_group = str(pyg[rec_mask]["age_group"].iloc[0] if "age_group" in pyg.columns else "")
                member_pid = pyg[rec_mask]["person_id"].iloc[0] if "person_id" in pyg.columns else None
                current_yg_status = str(pyg[rec_mask][S.YG_APPROVAL_STATUS_COL].iloc[0] if S.YG_APPROVAL_STATUS_COL in pyg.columns else "")

                if current_yg_status != S.APPROVAL_STATUS_AWAITING_YG:
                    return jsonify({"error": "membership is not awaiting YG approval"}), 400

                is_admin = u.get("role") == "admin"
                if not is_admin and not can_user_approve_yg_membership(viewer_pid, yg_id, age_group):
                    return jsonify({"error": "unauthorized"}), 403

                for col in [S.YG_APPROVAL_STATUS_COL, S.YG_APPROVED_BY_COL, S.YG_APPROVAL_DATE_COL, S.YG_APPROVAL_NOTES_COL]:
                    if col not in pyg.columns:
                        pyg[col] = None
                pyg.loc[rec_mask, S.YG_APPROVAL_STATUS_COL] = S.APPROVAL_STATUS_REJECTED
                pyg.loc[rec_mask, S.YG_APPROVED_BY_COL] = changed_by
                pyg.loc[rec_mask, S.YG_APPROVAL_DATE_COL] = now
                pyg.loc[rec_mask, S.YG_APPROVAL_NOTES_COL] = reason
                S.store["person_youth_group"] = pyg
                S.save()

            member_pid_int = int(member_pid) if member_pid is not None else None

        # Notify the member about this rejection
        if member_pid is not None:
            yg_name = S.youth_group_display_label(yg_id)
            ag_label = f" - فئة {age_group}" if age_group else ""
            msg = f"تم رفض عضويتك في {yg_name}{ag_label}."
            if reason:
                msg += f" السبب: {reason}"
            _send_notification(member_pid, "registration_yg_rejected", {
                "person_id": member_pid,
                "youth_group_name": yg_name,
                "age_group": age_group,
                "message": msg,
                "reason": reason,
            })

        # Scenario C: if ALL memberships are now rejected → deactivate account
        if member_pid_int is not None:
            _deactivate_account_all_yg_rejected(member_pid_int)

        return jsonify({"ok": True})

    @app.get("/api/requests/history")
    def get_requests_history():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        role = u.get("role")
        account_status = u.get("account_status") or "active"
        is_pending = account_status == "pending"

        if is_pending:
            person_id = u.get("person_id")
            if not person_id:
                return jsonify({"history": []})
            pipeline = _build_registration_pipeline(int(person_id))
            return jsonify({"history": [{"type": "registration", "pipeline": pipeline}]})

        if role == "admin":
            all_reqs = _get_all_registration_requests()
            result = []
            for row in all_reqs:
                pid = row.get("person_id")
                if pid is None:
                    continue
                pipeline = _build_registration_pipeline(int(pid))
                result.append({"type": "registration", "pipeline": pipeline})
            return jsonify({"history": result})

        return jsonify({"history": []})
