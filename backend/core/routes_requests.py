import threading
import uuid

import numpy as np
import pandas as pd
from flask import jsonify, request

from core import state as S
import core.privilege_store as PS
from core.routes_auth import (
    _changed_by_user_id,
    _current_user,
    _get_council_access,
    _load_auth,
    _require_admin,
    _require_auth,
    _save_auth,
    auth_lock,
)
from core.routes_registration import _build_registration_pipeline, _get_yg_approvers

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


def _get_person_display_name(person_id) -> str:
    try:
        all_p = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
        if not all_p.empty and "person_id" in all_p.columns:
            row = all_p[all_p["person_id"].astype(str) == str(person_id)]
            if not row.empty:
                r = row.iloc[0]
                parts = [str(r.get(k) or "").strip() for k in ("ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")]
                return " ".join(p for p in parts if p and p not in ("nan", "None"))
    except Exception:
        pass
    return str(person_id)


def _get_pending_registrations() -> list[dict]:
    """Return all persons with admin_approval_status = pending."""
    all_p = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    if all_p.empty or S.ADMIN_APPROVAL_STATUS_COL not in all_p.columns:
        return []
    pending = all_p[all_p[S.ADMIN_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower() == S.APPROVAL_STATUS_PENDING]
    return pending.replace({np.nan: None}).to_dict(orient="records")


def _get_admin_approved_registrations() -> list[dict]:
    """Return persons with admin_approval_status = approved that have any pending YG memberships."""
    all_p = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    if all_p.empty or S.ADMIN_APPROVAL_STATUS_COL not in all_p.columns:
        return []
    approved = all_p[all_p[S.ADMIN_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower() == S.APPROVAL_STATUS_APPROVED]
    pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
    result = []
    for _, row in approved.iterrows():
        pid = str(row.get("person_id") or "")
        if pyg.empty or "person_id" not in pyg.columns:
            continue
        yg_rows = pyg[pyg["person_id"].astype(str) == pid]
        if yg_rows.empty:
            continue
        has_pending_yg = False
        if S.YG_APPROVAL_STATUS_COL in yg_rows.columns:
            has_pending_yg = yg_rows[S.YG_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower().isin([S.APPROVAL_STATUS_PENDING]).any()
        if has_pending_yg:
            result.append(row.replace({np.nan: None}).to_dict())
    return result


def _get_all_registration_requests() -> list[dict]:
    """Return all persons with a non-null admin_approval_status (pending/approved/rejected)."""
    all_p = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    if all_p.empty or S.ADMIN_APPROVAL_STATUS_COL not in all_p.columns:
        return []
    has_status = all_p[S.ADMIN_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower().isin(
        [S.APPROVAL_STATUS_PENDING, S.APPROVAL_STATUS_APPROVED, S.APPROVAL_STATUS_REJECTED]
    )
    return all_p[has_status].replace({np.nan: None}).to_dict(orient="records")


def _get_user_council_access(user: dict) -> dict:
    """
    Compute effective council_access for a user, including privilege overrides.
    This is used as a fallback when council_access is not already on the user dict.
    """
    person_type = user.get("person_type")
    person_id   = user.get("person_id")
    username    = user.get("username", "")
    if not person_type or person_id is None:
        return {}
    try:
        from core.routes_auth import _get_person_youth_groups as _gyg
        youth_groups = _gyg(person_type, person_id)
        computed = _get_council_access(person_type, person_id, youth_groups)
        # Apply PrivilegeManager overrides so they take effect here too
        return PS.apply_overrides(username, computed)
    except Exception:
        return {}


def _can_approve_yg(user: dict, youth_group_id: str, age_group: str | None = None) -> bool:
    """
    Central check: can this user approve/reject a YG membership request?
    Respects privilege overrides managed through PrivilegeManager.
    Called by all request approval/rejection endpoints.
    """
    if user.get("role") == "admin":
        return True
    # council_access on a session user already has overrides applied (routes_auth.py)
    council = user.get("council_access") or _get_user_council_access(user)
    if youth_group_id in council:
        info = council[youth_group_id]
        if info.get("full_group"):
            return True
        if age_group and age_group in (info.get("age_groups") or []):
            return True
    return False


def _update_person_approval_col(person_id: int, col: str, value):
    with S.lock:
        persons = S.store.get("persons", pd.DataFrame()).copy()
        if persons.empty or "person_id" not in persons.columns:
            return False
        mask = (persons["person_id"].astype(str) == str(person_id)) & S._scd_active_mask(persons)
        if not mask.any():
            return False
        if col not in persons.columns:
            persons[col] = None
        persons.loc[mask, col] = value
        S.store["persons"] = persons
        S.save()
    return True


def _update_yg_approval_col(record_id: str, col: str, value):
    with S.lock:
        pyg = S.store.get("person_youth_group", pd.DataFrame()).copy()
        if pyg.empty or S.PERSON_YOUTH_GROUP_RECORD_ID_COL not in pyg.columns:
            return None
        mask = (pyg[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str) == record_id) & S._scd_active_mask(pyg)
        if not mask.any():
            return None
        if col not in pyg.columns:
            pyg[col] = None
        pyg.loc[mask, col] = value
        person_id_val = pyg[mask]["person_id"].iloc[0] if "person_id" in pyg.columns else None
        yg_id_val = pyg[mask][S.YOUTH_GROUP_ID_COL].iloc[0] if S.YOUTH_GROUP_ID_COL in pyg.columns else None
        S.store["person_youth_group"] = pyg
        S.save()
    return person_id_val, yg_id_val


def register_requests_routes(app):

    @app.get("/api/requests")
    def get_requests():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        role = u.get("role")
        account_status = u.get("account_status") or "active"
        is_pending = account_status in ("pending", "pending_yg")
        council_access = u.get("council_access") or _get_user_council_access(u)

        # Pending users can only see their own status
        if is_pending:
            person_id = u.get("person_id")
            if not person_id:
                return jsonify({"requests": []})
            pipeline = _build_registration_pipeline(int(person_id))
            return jsonify({"requests": [{"type": "registration", "pipeline": pipeline}], "view": "my_status"})

        if role == "admin":
            # Pending tab: ONLY requests that need admin action (admin_approval_status = pending)
            pending_reqs = _get_pending_registrations()
            result = []
            for row in pending_reqs:
                pid = row.get("person_id")
                if pid is None:
                    continue
                pipeline = _build_registration_pipeline(int(pid))
                result.append({"type": "registration", "pipeline": pipeline})
            return jsonify({"requests": result, "view": "admin"})

        # Council member: show YG-level pending requests for their groups
        if council_access:
            approved_persons = _get_admin_approved_registrations()
            result = []
            seen_pids = set()
            for row in approved_persons:
                pid = row.get("person_id")
                if pid is None or pid in seen_pids:
                    continue
                pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
                if pyg.empty or "person_id" not in pyg.columns:
                    continue
                yg_rows = pyg[pyg["person_id"].astype(str) == str(pid)]
                for _, yg_row in yg_rows.iterrows():
                    yg_id = str(yg_row.get(S.YOUTH_GROUP_ID_COL) or "")
                    age_group = str(yg_row.get("age_group") or "")
                    yg_status = str(yg_row.get(S.YG_APPROVAL_STATUS_COL) or S.APPROVAL_STATUS_PENDING).strip()
                    if yg_status == S.APPROVAL_STATUS_PENDING and _can_approve_yg(u, yg_id, age_group or None):
                        if pid not in seen_pids:
                            seen_pids.add(pid)
                            pipeline = _build_registration_pipeline(int(pid))
                            result.append({"type": "registration", "pipeline": pipeline})
                        break
            return jsonify({"requests": result, "view": "council"})

        return jsonify({"requests": [], "view": "none"})

    @app.post("/api/requests/<int:person_id>/admin-approve")
    def admin_approve_request(person_id):
        err = _require_admin()
        if err:
            return err

        u = _current_user()
        changed_by = _changed_by_user_id(u)
        notes = (request.json or {}).get("notes") or ""
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
                    (S.ADMIN_APPROVAL_STATUS_COL, S.APPROVAL_STATUS_APPROVED),
                    (S.ADMIN_APPROVAL_BY_COL, changed_by),
                    (S.ADMIN_APPROVAL_DATE_COL, now),
                    (S.ADMIN_APPROVAL_NOTES_COL, notes),
                ]:
                    if col not in persons.columns:
                        persons[col] = None
                    persons.loc[mask, col] = val
                S.store["persons"] = persons
                S.save()

            with auth_lock:
                auth_data = _load_auth()
                for user in auth_data["users"]:
                    uid = S._normalize_person_id(user.get("person_id"))
                    if uid is not None and str(uid) == str(person_id):
                        user["account_status"] = "pending_yg"
                _save_auth(auth_data)

        display_name = _get_person_display_name(person_id)

        # Notify user
        auth_data = _load_auth()
        for user in auth_data["users"]:
            uid = S._normalize_person_id(user.get("person_id"))
            if uid is not None and str(uid) == str(person_id):
                _send_notification(user.get("person_id"), "registration_admin_approved", {
                    "person_id": person_id,
                    "message": "تمت الموافقة على بياناتك الشخصية. طلبك الآن بانتظار موافقة فرق الشبيبة.",
                })
                break

        # Notify YG approvers
        pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
        if not pyg.empty and "person_id" in pyg.columns:
            yg_rows = pyg[pyg["person_id"].astype(str) == str(person_id)]
            seen_approver_pids: set[str] = set()
            for _, yg_row in yg_rows.iterrows():
                yg_id = str(yg_row.get(S.YOUTH_GROUP_ID_COL) or "")
                age_group = str(yg_row.get("age_group") or "")
                record_id = str(yg_row.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL) or "")
                approvers = _get_yg_approvers(yg_id, age_group or None)
                yg_name = S.youth_group_display_label(yg_id)
                for approver in approvers:
                    a_pid = str(approver.get("person_id") or "")
                    if a_pid in seen_approver_pids:
                        continue
                    seen_approver_pids.add(a_pid)
                    _send_notification(approver.get("person_id"), "registration_pending_yg", {
                        "person_id": person_id,
                        "person_name": display_name,
                        "youth_group_id": yg_id,
                        "youth_group_name": yg_name,
                        "record_id": record_id,
                        "role": approver.get("role"),
                        "message": f"طلب انضمام جديد: {display_name} إلى {yg_name} بانتظار موافقتك ({approver.get('role')})",
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
                msg = "تم رفض طلب تسجيلك من قِبَل الإدارة."
                if notes:
                    msg += f" السبب: {notes}"
                _send_notification(user.get("person_id"), "registration_admin_rejected", {
                    "person_id": person_id,
                    "message": msg,
                    "reason": notes,
                })
                break

        return jsonify({"ok": True})

    @app.post("/api/requests/yg-approve/<record_id>")
    def yg_approve_request(record_id):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        body = request.json or {}
        notes = (body.get("notes") or "").strip()
        changed_by = _changed_by_user_id(u, fallback="system")
        now = _scd_ts()

        with _req_lock:
            with S.lock:
                pyg = S.store.get("person_youth_group", pd.DataFrame()).copy()
                if pyg.empty or S.PERSON_YOUTH_GROUP_RECORD_ID_COL not in pyg.columns:
                    return jsonify({"error": "record not found"}), 404
                mask = (pyg[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str) == record_id) & S._scd_active_mask(pyg)
                if not mask.any():
                    return jsonify({"error": "record not found"}), 404

                yg_row = pyg[mask].iloc[0]
                yg_id = str(yg_row.get(S.YOUTH_GROUP_ID_COL) or "")
                age_group = str(yg_row.get("age_group") or "")
                person_id = yg_row.get("person_id")

                if not _can_approve_yg(u, yg_id, age_group or None):
                    return jsonify({"error": "ليس لديك صلاحية الموافقة على هذه الشبيبة"}), 403

                for col, val in [
                    (S.YG_APPROVAL_STATUS_COL, S.APPROVAL_STATUS_APPROVED),
                    (S.YG_APPROVED_BY_COL, changed_by),
                    (S.YG_APPROVAL_DATE_COL, now),
                    (S.YG_APPROVAL_NOTES_COL, notes),
                ]:
                    if col not in pyg.columns:
                        pyg[col] = None
                    pyg.loc[mask, col] = val
                S.store["person_youth_group"] = pyg
                S.save()

            # If this is the first approved YG, activate the account
            with auth_lock:
                auth_data = _load_auth()
                for user in auth_data["users"]:
                    uid = S._normalize_person_id(user.get("person_id"))
                    if uid is not None and str(uid) == str(person_id):
                        if user.get("account_status") in ("pending_yg", "pending"):
                            user["account_status"] = "active"
                _save_auth(auth_data)

        yg_name = S.youth_group_display_label(yg_id)
        display_name = _get_person_display_name(person_id)

        # Notify user
        _send_notification(person_id, "registration_yg_approved", {
            "person_id": person_id,
            "youth_group_id": yg_id,
            "youth_group_name": yg_name,
            "message": f"تمت الموافقة على انضمامك إلى {yg_name}!",
        })

        return jsonify({"ok": True})

    @app.post("/api/requests/yg-reject/<record_id>")
    def yg_reject_request(record_id):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        body = request.json or {}
        notes = (body.get("notes") or body.get("reason") or "").strip()
        changed_by = _changed_by_user_id(u, fallback="system")
        now = _scd_ts()

        with _req_lock:
            with S.lock:
                pyg = S.store.get("person_youth_group", pd.DataFrame()).copy()
                if pyg.empty or S.PERSON_YOUTH_GROUP_RECORD_ID_COL not in pyg.columns:
                    return jsonify({"error": "record not found"}), 404
                mask = (pyg[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str) == record_id) & S._scd_active_mask(pyg)
                if not mask.any():
                    return jsonify({"error": "record not found"}), 404

                yg_row = pyg[mask].iloc[0]
                yg_id = str(yg_row.get(S.YOUTH_GROUP_ID_COL) or "")
                age_group = str(yg_row.get("age_group") or "")
                person_id = yg_row.get("person_id")

                if not _can_approve_yg(u, yg_id, age_group or None):
                    return jsonify({"error": "ليس لديك صلاحية"}), 403

                for col, val in [
                    (S.YG_APPROVAL_STATUS_COL, S.APPROVAL_STATUS_REJECTED),
                    (S.YG_APPROVED_BY_COL, changed_by),
                    (S.YG_APPROVAL_DATE_COL, now),
                    (S.YG_APPROVAL_NOTES_COL, notes),
                ]:
                    if col not in pyg.columns:
                        pyg[col] = None
                    pyg.loc[mask, col] = val
                S.store["person_youth_group"] = pyg
                S.save()

            # Check if ALL YG memberships are now rejected → deactivate account
            updated_pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
            all_rejected = True
            has_any_yg = False
            if not updated_pyg.empty and "person_id" in updated_pyg.columns:
                person_yg = updated_pyg[updated_pyg["person_id"].astype(str) == str(person_id)]
                for _, row in person_yg.iterrows():
                    has_any_yg = True
                    status = str(row.get(S.YG_APPROVAL_STATUS_COL) or S.APPROVAL_STATUS_PENDING).strip()
                    if status != S.APPROVAL_STATUS_REJECTED:
                        all_rejected = False
                        break

            if has_any_yg and all_rejected:
                with auth_lock:
                    auth_data = _load_auth()
                    for user in auth_data["users"]:
                        uid = S._normalize_person_id(user.get("person_id"))
                        if uid is not None and str(uid) == str(person_id):
                            if user.get("account_status") not in ("active",):
                                user["account_status"] = "rejected_all_yg"
                                user["rejection_reason"] = notes
                    _save_auth(auth_data)

        yg_name = S.youth_group_display_label(yg_id)

        # Notify user
        msg = f"تم رفض طلب انضمامك إلى {yg_name}."
        if notes:
            msg += f" السبب: {notes}"
        _send_notification(person_id, "registration_yg_rejected", {
            "person_id": person_id,
            "youth_group_id": yg_id,
            "youth_group_name": yg_name,
            "message": msg,
            "reason": notes,
        })

        return jsonify({"ok": True})

    @app.get("/api/requests/history")
    def get_requests_history():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        role = u.get("role")
        account_status = u.get("account_status") or "active"
        is_pending = account_status in ("pending", "pending_yg")

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

        council_access = u.get("council_access") or _get_user_council_access(u)
        if council_access:
            all_reqs = _get_all_registration_requests()
            result = []
            seen = set()
            for row in all_reqs:
                pid = row.get("person_id")
                if pid is None or pid in seen:
                    continue
                pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
                if pyg.empty:
                    continue
                yg_rows = pyg[pyg["person_id"].astype(str) == str(pid)]
                for _, yg_row in yg_rows.iterrows():
                    yg_id = str(yg_row.get(S.YOUTH_GROUP_ID_COL) or "")
                    age_group = str(yg_row.get("age_group") or "")
                    if _can_approve_yg(u, yg_id, age_group or None):
                        seen.add(pid)
                        pipeline = _build_registration_pipeline(int(pid))
                        result.append({"type": "registration", "pipeline": pipeline})
                        break
            return jsonify({"history": result})

        return jsonify({"history": []})
