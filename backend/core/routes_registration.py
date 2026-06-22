import threading
import uuid

import numpy as np
import pandas as pd
from flask import jsonify, request, session

from core import state as S
from core.routes_auth import (
    _current_user,
    _get_person_name_any,
    _hash_pw,
    _load_auth,
    _save_auth,
)
from core.routes_people import (
    apply_profile_person_relationship_flags,
    collect_profile_validation_errors,
    prepare_profile_person_payload,
    prepare_profile_job_contact_rows,
    replace_profile_sub_rows_batch,
)

_reg_lock = threading.Lock()
_REGISTRATION_FORBIDDEN_AGE_GROUPS = {"مرشد روحيّ", "مرشد روحي"}


def _resolve_approver_name(changed_by_value):
    """Resolve a stored changed_by value (person_id or username) to a display name."""
    if not changed_by_value:
        return None
    val = str(changed_by_value).strip()
    if val.lstrip("-").isdigit():
        name = _get_person_name_any(val)
        if name and name != val:
            return name
    try:
        auth_data = _load_auth()
        for user in auth_data.get("users", []):
            if str(user.get("username") or "") == val:
                return user.get("display_name") or val
    except Exception:
        pass
    return val


def _send_notification(for_person_id, notif_type: str, payload: dict):
    try:
        with S.notif_lock:
            data = S.db.load_notifications()
            notif = {
                "id": str(uuid.uuid4())[:12],
                "type": notif_type,
                "for_person_id": for_person_id,
                "read": False,
                "created_at": S._scd_timestamp(),
                **payload,
            }
            data["notifications"].append(notif)
            S.db.save_notifications(data)
    except Exception as e:
        print(f"Warning: failed to send notification: {e}")


def _notify_admins(notif_type: str, payload: dict):
    auth_data = _load_auth()
    for user in auth_data["users"]:
        if user.get("role") == "admin":
            _send_notification(user.get("person_id"), notif_type, payload)


def _notify_user_by_person_id(person_id, notif_type: str, payload: dict):
    _send_notification(person_id, notif_type, payload)


def _registration_payload_restriction_errors(body: dict) -> list[str]:
    errors: list[str] = []
    person = body.get("person") if isinstance(body.get("person"), dict) else {}
    if S._normalize_text(person.get("title")):
        errors.append("لا يمكن تحديد اللقب أثناء تسجيل عضو جديد.")

    def is_forbidden_age_group(value) -> bool:
        return S._normalize_text(value) in _REGISTRATION_FORBIDDEN_AGE_GROUPS

    for membership_index, row in enumerate(body.get("person_youth_group", []) or [], start=1):
        if not isinstance(row, dict):
            continue
        if is_forbidden_age_group(row.get("age_group")) or is_forbidden_age_group(row.get("current_age_group")):
            errors.append(f"عضوية الشبيبة #{membership_index}: لا يمكن اختيار مرشد روحيّ كفئة عمرية أثناء التسجيل.")
        for history_index, history_row in enumerate(row.get("age_group_history") or [], start=1):
            if not isinstance(history_row, dict):
                continue
            if is_forbidden_age_group(history_row.get("age_group")):
                errors.append(
                    f"سجل الفئة العمرية #{history_index} داخل الشبيبة #{membership_index}: لا يمكن اختيار مرشد روحيّ أثناء التسجيل."
                )
    return errors


def _build_registration_pipeline(person_id: int, viewer_person_id: str = None) -> dict:
    """Build the full approval pipeline status for a person.

    viewer_person_id: if set, each YG membership gets can_yg_approve=True when this person
    is a designated yg_registration_approval grantee for that membership.
    """
    from core.routes_privileges import get_yg_registration_approval_grantees

    all_persons = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    person_row = {}
    if not all_persons.empty and "person_id" in all_persons.columns:
        match = all_persons[all_persons["person_id"].astype(str) == str(person_id)]
        if not match.empty:
            person_row = match.iloc[0].replace({np.nan: None}).to_dict()

    admin_status = str(person_row.get(S.ADMIN_APPROVAL_STATUS_COL) or "pending").strip()
    admin_by = _resolve_approver_name(person_row.get(S.ADMIN_APPROVAL_BY_COL))
    admin_date = person_row.get(S.ADMIN_APPROVAL_DATE_COL)
    admin_notes = person_row.get(S.ADMIN_APPROVAL_NOTES_COL)

    display_name_parts = []
    for key in ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name"):
        v = person_row.get(key)
        if v and str(v).strip() not in ("", "nan", "None"):
            display_name_parts.append(str(v).strip())
    display_name = " ".join(display_name_parts)

    pyg_df = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
    yg_memberships = []
    if not pyg_df.empty and "person_id" in pyg_df.columns:
        rows = pyg_df[pyg_df["person_id"].astype(str) == str(person_id)]
        for _, row in rows.iterrows():
            r = row.replace({np.nan: None}).to_dict()
            yg_id = str(r.get(S.YOUTH_GROUP_ID_COL) or "")
            age_group = str(r.get("age_group") or "")
            yg_status = str(r.get(S.YG_APPROVAL_STATUS_COL) or "pending").strip()
            yg_by = _resolve_approver_name(r.get(S.YG_APPROVED_BY_COL))
            yg_date = r.get(S.YG_APPROVAL_DATE_COL)
            yg_notes = r.get(S.YG_APPROVAL_NOTES_COL)

            # Enrich with who needs to give second approval
            awaiting_approvers = []
            can_yg_approve = False
            if yg_status == S.APPROVAL_STATUS_AWAITING_YG:
                awaiting_approvers = get_yg_registration_approval_grantees(yg_id, age_group)
                if viewer_person_id:
                    can_yg_approve = any(
                        str(a["person_id"]) == str(viewer_person_id)
                        for a in awaiting_approvers
                    )

            yg_memberships.append({
                "record_id": str(r.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL) or ""),
                "youth_group_id": yg_id,
                "youth_group_name": S.youth_group_display_label(yg_id),
                "age_group": age_group,
                "yg_approval_status": yg_status,
                "yg_approved_by": yg_by or None,
                "yg_approval_date": str(yg_date) if yg_date else None,
                "yg_approval_notes": yg_notes,
                "awaiting_approvers": awaiting_approvers,
                "can_yg_approve": can_yg_approve,
            })

    return {
        "person_id": person_id,
        "display_name": display_name,
        "admin_approval_status": admin_status,
        "admin_approval_by": admin_by,
        "admin_approval_date": str(admin_date) if admin_date else None,
        "admin_approval_notes": admin_notes,
        "yg_memberships": yg_memberships,
    }


def register_registration_routes(app):

    @app.post("/api/registration/submit")
    def registration_submit():
        body = request.json or {}
        username = (body.get("username") or "").strip().lower()
        password = body.get("password") or ""

        if not username:
            return jsonify({"error": "اسم المستخدم مطلوب"}), 400
        if len(username) < 3:
            return jsonify({"error": "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"}), 400
        if not password:
            return jsonify({"error": "كلمة المرور مطلوبة"}), 400
        if len(password) < 6:
            return jsonify({"error": "كلمة المرور يجب أن تكون 6 أحرف على الأقل"}), 400

        import re as _re
        if not _re.fullmatch(r"[a-z0-9_]+", username):
            return jsonify({"error": "اسم المستخدم يجب أن يحتوي أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط"}), 400
        restriction_errors = _registration_payload_restriction_errors(body)
        if restriction_errors:
            return jsonify({"error": restriction_errors[0], "errors": restriction_errors}), 400

        with _reg_lock:
            auth_data = _load_auth()
            if any(u["username"].lower() == username for u in auth_data["users"]):
                return jsonify({"error": "اسم المستخدم مستخدم مسبقاً، يرجى اختيار اسم آخر"}), 409

            with S.lock:
                new_id = S._next_person_id()
                raw_person = body.get("person", {})
                raw_person = dict(raw_person) if isinstance(raw_person, dict) else {}
                raw_person.pop("title", None)
                p, person_payload = prepare_profile_person_payload(
                    raw_person,
                    addresses_rows=body.get("addresses") if "addresses" in body else None,
                    infer_addresses_from_payload="addresses" not in body,
                )
                body = apply_profile_person_relationship_flags(body, p)
                validation_errors = collect_profile_validation_errors(
                    body, p, addresses_rows=person_payload["addresses_rows"]
                )
                if validation_errors:
                    return jsonify({"error": validation_errors[0], "errors": validation_errors}), 400

                prepared_job_rows, mobile_rows_payload, email_rows_payload = prepare_profile_job_contact_rows(
                    S.store, new_id,
                    job_rows=body.get("jobs", []),
                    mobile_rows=body.get("mobile_numbers", []),
                    email_rows=body.get("emails", []),
                )

                p["person_id"] = new_id
                p["registered"] = True
                p[S.ADMIN_APPROVAL_STATUS_COL] = S.APPROVAL_STATUS_PENDING
                p[S.ADMIN_APPROVAL_BY_COL] = None
                p[S.ADMIN_APPROVAL_DATE_COL] = None
                p[S.ADMIN_APPROVAL_NOTES_COL] = None

                new_person_scd = S._scd_new_metadata("registration")
                S.store["persons"] = pd.concat(
                    [S.store["persons"], pd.DataFrame([{**p, **new_person_scd}])],
                    ignore_index=True,
                )
                S.replace_person_title(S.store, new_id, person_payload["person_title"], changed_by="registration")
                S.replace_person_school_system_sector(S.store, new_id, person_payload["school_system_sector"], changed_by="registration")

                yg_rows_raw = body.get("person_youth_group", [])
                yg_rows_pending = []
                for row in (yg_rows_raw or []):
                    if isinstance(row, dict):
                        yg_rows_pending.append({
                            **row,
                            S.YG_APPROVAL_STATUS_COL: S.APPROVAL_STATUS_PENDING,
                            S.YG_APPROVED_BY_COL: None,
                            S.YG_APPROVAL_DATE_COL: None,
                            S.YG_APPROVAL_NOTES_COL: None,
                        })

                replace_profile_sub_rows_batch(
                    S.store, new_id,
                    {
                        "nationality": body.get("nationality", []),
                        "jobs": prepared_job_rows,
                        "mobile_numbers": mobile_rows_payload,
                        "emails": email_rows_payload,
                        "social_media": body.get("social_media", []),
                        "addresses": person_payload["addresses_rows"],
                        "schools": body.get("schools", []),
                        "higher_education": body.get("higher_education", []),
                        "responsibilities": [],
                        "person_youth_group": yg_rows_pending,
                        "hobbies_skills": body.get("hobbies_skills", []),
                        S.PERSON_HEALTH_CONDITION_SHEET: body.get(S.PERSON_HEALTH_CONDITION_SHEET, []),
                        S.PERSON_SPECIAL_NOTE_SHEET: body.get(S.PERSON_SPECIAL_NOTE_SHEET, []),
                    },
                    compare_as_string=False,
                    changed_by="registration",
                    sheet_order=(
                        "nationality", "jobs", "mobile_numbers", "emails", "social_media",
                        "addresses", "schools", "higher_education", "responsibilities",
                        "person_youth_group", "hobbies_skills",
                        S.PERSON_HEALTH_CONDITION_SHEET, S.PERSON_SPECIAL_NOTE_SHEET,
                    ),
                )

                # Ensure new registration memberships always enter the approval
                # pipeline as pending, regardless of profile payload defaults.
                if yg_rows_raw:
                    pyg_df = S.store.get("person_youth_group", pd.DataFrame()).copy()
                    if not pyg_df.empty and "person_id" in pyg_df.columns:
                        active_new = (pyg_df["person_id"].astype(str) == str(new_id)) & S._scd_active_mask(pyg_df)
                        for col in [S.YG_APPROVAL_STATUS_COL, S.YG_APPROVED_BY_COL, S.YG_APPROVAL_DATE_COL, S.YG_APPROVAL_NOTES_COL]:
                            if col not in pyg_df.columns:
                                pyg_df[col] = None
                        pyg_df.loc[active_new, S.YG_APPROVAL_STATUS_COL] = S.APPROVAL_STATUS_PENDING
                        S.store["person_youth_group"] = pyg_df

                S.save()

            new_user = {
                "person_id": new_id,
                "username": username,
                "password_hash": _hash_pw(password),
                "role": "member",
                "account_status": "pending",
                "rejection_reason": "",
            }
            auth_data["users"].append(new_user)
            _save_auth(auth_data)

        display_name_parts = [
            str(p.get(k) or "").strip()
            for k in ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
            if p.get(k) and str(p.get(k)).strip() not in ("", "nan", "None")
        ]
        display_name = " ".join(display_name_parts) or username

        _notify_admins("registration_pending_admin", {
            "person_id": new_id,
            "person_name": display_name,
            "username": username,
            "message": f"طلب تسجيل جديد: {display_name} (@{username}) بانتظار موافقتك",
        })

        # Only log in the new user if no one is currently logged in (public registration flow)
        submitter = _current_user()
        safe_user = {k: v for k, v in new_user.items() if k != "password_hash"}
        safe_user["display_name"] = display_name
        safe_user["person_type"] = "registered"
        safe_user["is_pending"] = True
        safe_user["youth_groups"] = [
            str(r.get(S.YOUTH_GROUP_ID_COL, ""))
            for r in yg_rows_raw
            if isinstance(r, dict) and r.get(S.YOUTH_GROUP_ID_COL)
        ]

        if not submitter:
            session["user_id"] = username
            return jsonify({"ok": True, "person_id": new_id, "user": safe_user, "auto_logged_in": True})
        else:
            return jsonify({"ok": True, "person_id": new_id, "user": safe_user, "auto_logged_in": False})

    @app.get("/api/registration/my-status")
    def registration_my_status():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401
        person_id = u.get("person_id")
        if person_id is None:
            return jsonify({"error": "no person linked"}), 400
        pipeline = _build_registration_pipeline(int(person_id))
        return jsonify({"ok": True, "pipeline": pipeline})

    @app.get("/api/registration/check-username")
    def registration_check_username():
        username = (request.args.get("username") or "").strip().lower()
        if not username:
            return jsonify({"available": False})
        auth_data = _load_auth()
        taken = any(u["username"].lower() == username for u in auth_data["users"])
        return jsonify({"available": not taken})
