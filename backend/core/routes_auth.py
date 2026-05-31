import hashlib
import os
import re
import threading
from copy import deepcopy

import numpy as np
import pandas as pd
from flask import jsonify, request, session

from core import state as S
from core.routes_org_tree import _extract_node_identity, _filter_tree_data_for_user, _load_index, _load_tree_data
import core.privilege_store as PS


auth_lock = threading.Lock()
_auth_cache_lock = threading.Lock()
_auth_cache_data: dict | None = None
_auth_cache_token: float | None = None


def _auth_cache_file_token() -> float | None:
    from core.database import workbook_sheet_name
    try:
        auth_csv = os.path.join(S.db.csv_dir, f"{workbook_sheet_name(S.db.auth_sheet)}.csv")
        if os.path.exists(auth_csv):
            return os.path.getmtime(auth_csv)
    except OSError:
        pass
    return None


def _invalidate_auth_cache():
    global _auth_cache_data, _auth_cache_token
    with _auth_cache_lock:
        _auth_cache_data = None
        _auth_cache_token = None


def _hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def _compose_person_full_name(row) -> str:
    """Build a full person name from all available name components."""
    parts = []
    for key in ("ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name"):
        value = row.get(key, "") if hasattr(row, "get") else ""
        if pd.notna(value):
            text = str(value).strip()
            if text:
                parts.append(text)
    return " ".join(parts)


def _person_type_from_person_id(pid):
    if pid is None or str(pid).strip() == "":
        return None
    persons = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    if persons.empty or "person_id" not in persons.columns:
        return None
    row = persons[persons["person_id"].astype(str) == str(pid)]
    if row.empty:
        return None
    is_registered = S._bool_registered(row.iloc[0].get("registered", True))
    return "registered" if is_registered else "unregistered"


def _has_person_link(user: dict) -> bool:
    person_id = user.get("person_id")
    return user.get("person_type") in ("registered", "unregistered") and person_id is not None and str(person_id).strip() != ""


def _validate_auth_person_link(role: str, person_type: str | None, person_id) -> tuple[str | None, str | None]:
    normalized_role = str(role or "member").strip() or "member"
    normalized_person_id = S._normalize_person_id(person_id)

    if normalized_person_id is None:
        if normalized_role == "admin":
            return None, None
        return "person_id is required for non-admin auth users", None

    actual_person_type = _person_type_from_person_id(normalized_person_id)
    if actual_person_type is None:
        return "linked person was not found or is no longer active", None

    if person_type and person_type not in ("registered", "unregistered"):
        return "invalid person_type", None
    if person_type and person_type != actual_person_type:
        return "person_type does not match the linked person", None

    return None, actual_person_type


def _auth_user_link_error(user: dict) -> str | None:
    error, _actual_person_type = _validate_auth_person_link(
        user.get("role") or "member",
        user.get("person_type"),
        user.get("person_id"),
    )
    return error


def _deactivate_auth_users_for_person(person_id, *, changed_by: str = "admin") -> int:
    person_key = S._normalize_person_id(person_id)
    if person_key is None:
        return 0

    removed = 0
    with auth_lock:
        data = _load_auth()
        kept_users = []
        for user in data.get("users", []):
            uid = S._normalize_person_id(user.get("person_id"))
            if uid is not None and str(uid) == str(person_key):
                removed += 1
                continue
            kept_users.append(user)
        if removed:
            data["users"] = kept_users
            _save_auth(data, changed_by=changed_by)
    return removed


def _changed_by_user_id(user: dict | None, fallback: str = "admin") -> str:
    if not user:
        return fallback
    person_id = S._normalize_person_id(user.get("person_id"))
    if person_id is not None and str(person_id).strip():
        return str(person_id)
    username = str(user.get("username") or "").strip()
    return username or fallback


def _load_auth() -> dict:
    global _auth_cache_data, _auth_cache_token

    current_token = _auth_cache_file_token()
    with _auth_cache_lock:
        if _auth_cache_data is not None and _auth_cache_token == current_token:
            return deepcopy(_auth_cache_data)

    try:
        raw = S.db.load_auth()
    except OSError:
        cached_payload = None
        with _auth_cache_lock:
            if _auth_cache_data is not None:
                cached_payload = deepcopy(_auth_cache_data)
        if cached_payload is not None:
            return cached_payload
        raise
    reg_person_ids: set[str] = set()
    unreg_person_ids: set[str] = set()
    reg_name_by_pid: dict[str, str] = {}
    unreg_name_by_pid: dict[str, str] = {}

    persons = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    if not persons.empty and "person_id" in persons.columns:
        p = persons.copy()
        if "registered" in p.columns:
            p["registered"] = p["registered"].apply(S._bool_registered)
        else:
            p["registered"] = True
        p["pid_key"] = p["person_id"].astype(str)

        reg_rows = p[p["registered"] == True]
        unreg_rows = p[p["registered"] == False]

        reg_person_ids = set(reg_rows["pid_key"].tolist())
        unreg_person_ids = set(unreg_rows["pid_key"].tolist())

        for row in reg_rows.to_dict(orient="records"):
            pid_key = row.get("pid_key")
            if pid_key is None:
                continue
            display = _compose_person_full_name(row)
            if display:
                reg_name_by_pid[str(pid_key)] = display

        for row in unreg_rows.to_dict(orient="records"):
            pid_key = row.get("pid_key")
            if pid_key is None:
                continue
            display = _compose_person_full_name(row)
            if display:
                unreg_name_by_pid[str(pid_key)] = display

    users = []
    for user in raw.get("users", []):
        username = (str(user.get("username") or "")).strip().lower()
        password_hash = str(user.get("password_hash") or "").strip()
        if not username or not password_hash:
            continue
        person_id = S._normalize_person_id(user.get("person_id"))
        role = str(user.get("role") or "member").strip() or "member"
        account_status = str(user.get("account_status") or "active").strip() or "active"
        rejection_reason = user.get("rejection_reason") or None
        person_key = None if person_id is None else str(person_id)
        person_type = None
        if person_key is not None:
            if person_key in reg_person_ids:
                person_type = "registered"
            elif person_key in unreg_person_ids:
                person_type = "unregistered"

        # For pending registrations, look them up in the full persons store (including pending)
        if person_type is None and person_key is not None:
            all_persons = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
            if not all_persons.empty and "person_id" in all_persons.columns:
                row = all_persons[all_persons["person_id"].astype(str) == person_key]
                if not row.empty:
                    person_type = "registered"

        if person_type and person_id is not None:
            if person_type == "registered":
                display_name = reg_name_by_pid.get(person_key) or _get_person_name_any(person_id)
            else:
                display_name = unreg_name_by_pid.get(person_key) or _get_person_name(person_type, person_id)
        elif role == "admin":
            display_name = "المدير"
        else:
            display_name = username
        users.append({
            "username": username,
            "password_hash": password_hash,
            "role": role,
            "person_id": person_id,
            "person_type": person_type,
            "display_name": display_name,
            "account_status": account_status,
            "rejection_reason": rejection_reason,
            "person_missing": bool(
                (person_key is not None and person_type is None)
                or (role != "admin" and person_key is None)
            ),
        })
    payload = {"users": users}
    with _auth_cache_lock:
        _auth_cache_data = payload
        _auth_cache_token = _auth_cache_file_token()
    return deepcopy(payload)


def _save_auth(data: dict, *, changed_by: str | None = None):
    persisted = {
        "users": [
            {
                "person_id": S._normalize_person_id(u.get("person_id")),
                "username": (str(u.get("username") or "")).strip().lower(),
                "password_hash": str(u.get("password_hash") or "").strip(),
                "role": str(u.get("role") or "member").strip() or "member",
                "account_status": str(u.get("account_status") or "active").strip() or "active",
                "rejection_reason": u.get("rejection_reason") or "",
            }
            for u in data.get("users", [])
        ]
    }
    if changed_by is None:
        try:
            current = _current_user()
            changed_by = _changed_by_user_id(current)
        except Exception:
            changed_by = "admin"
    S.db.save_auth(persisted, changed_by=changed_by)
    _invalidate_auth_cache()


def _ensure_admin():
    data = _load_auth()
    if not any(u["role"] == "admin" for u in data["users"]):
        data["users"].append({
            "username": "admin",
            "password_hash": _hash_pw("admin123"),
            "role": "admin",
            "person_type": None,
            "person_id": None,
            "display_name": "المدير",
        })
        _save_auth(data)


def _get_person_name_any(pid) -> str:
    """Look up name including pending (not-yet-approved) persons."""
    try:
        all_persons = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
        if not all_persons.empty and "person_id" in all_persons.columns:
            row = all_persons[all_persons["person_id"].astype(str) == str(pid)]
            if not row.empty:
                return _compose_person_full_name(row.iloc[0].to_dict()) or str(pid)
    except Exception:
        pass
    return str(pid)


def _get_person_name(person_type: str, pid) -> str:
    try:
        if person_type is None and pid is not None:
            person_type = _person_type_from_person_id(pid)
        if person_type == "registered":
            reg_persons = S._registered_persons_df()
            row = reg_persons[reg_persons["person_id"] == int(pid)]
            if not row.empty:
                r = row.iloc[0]
                full_name = _compose_person_full_name(r)
                return full_name or str(pid)
        elif person_type == "unregistered":
            df = S.unregistered_persons_view_df()
            row = df[df["person_id"].astype(str) == str(pid)]
            if not row.empty:
                r = row.iloc[0]
                full_name = _compose_person_full_name(r)
                return full_name or str(pid)
    except Exception:
        pass
    return str(pid)


def _get_person_youth_groups_any(person_type: str, pid) -> list:
    """Like _get_person_youth_groups but includes pending/unapproved memberships (for the person's own view)."""
    try:
        if person_type is None and pid is not None:
            person_type = _person_type_from_person_id(pid)
        if person_type in ("registered", None):
            pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
            if pyg.empty or "person_id" not in pyg.columns:
                return []
            rows = pyg[pyg["person_id"].astype(str) == str(pid)]
            if S.YOUTH_GROUP_ID_COL not in rows.columns:
                return []
            return rows[S.YOUTH_GROUP_ID_COL].dropna().astype(str).unique().tolist()
        elif person_type == "unregistered":
            df = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))
            if df.empty or "person_id" not in df.columns:
                return []
            rows = df[df["person_id"].astype(str) == str(pid)]
            if S.YOUTH_GROUP_ID_COL not in rows.columns:
                return []
            return rows[S.YOUTH_GROUP_ID_COL].dropna().astype(str).unique().tolist()
    except Exception:
        pass
    return []


def _get_person_youth_groups(person_type: str, pid) -> list:
    try:
        if person_type is None and pid is not None:
            person_type = _person_type_from_person_id(pid)
        if person_type == "registered":
            pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
            rows = pyg[pyg["person_id"] == int(pid)]
            if S.YOUTH_GROUP_ID_COL not in rows.columns:
                return []
            return rows[S.YOUTH_GROUP_ID_COL].dropna().astype(str).unique().tolist()
        elif person_type == "unregistered":
            df = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))
            if df.empty or "person_id" not in df.columns:
                return []
            rows = df[df["person_id"].astype(str) == str(pid)]
            if S.YOUTH_GROUP_ID_COL not in rows.columns:
                return []
            return rows[S.YOUTH_GROUP_ID_COL].dropna().astype(str).unique().tolist()
    except Exception:
        pass
    return []


def _get_person_memberships(person_type: str, pid) -> tuple[list[str], list[str]]:
    """Return parallel lists of youth-group labels and age-group labels for a person."""
    try:
        if person_type is None and pid is not None:
            person_type = _person_type_from_person_id(pid)

        if person_type == "registered":
            df = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
            if df.empty or "person_id" not in df.columns:
                return ([], [])
            rows = df[df["person_id"] == int(pid)]
        elif person_type == "unregistered":
            df = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))
            if df.empty or "person_id" not in df.columns:
                return ([], [])
            rows = df[df["person_id"].astype(str) == str(pid)]
        else:
            return ([], [])

        if rows.empty:
            return ([], [])

        youth_group_ids = rows.get(S.YOUTH_GROUP_ID_COL, pd.Series(dtype=str)).fillna("").astype(str).tolist()
        age_groups = rows.get("age_group", pd.Series(dtype=str)).fillna("").astype(str).tolist()

        youth_groups = []
        for gid in youth_group_ids:
            gid = gid.strip()
            if not gid:
                youth_groups.append("")
                continue
            youth_groups.append(S.youth_group_display_label(gid))

        return (youth_groups, age_groups)
    except Exception:
        return ([], [])


AGE_GROUPS_PY = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
ACTING_PREFIX_PY = 'قائم بأعمال '


def _classify_role_py(role: str) -> dict | None:
    if not role:
        return None

    if role.startswith(ACTING_PREFIX_PY):
        role = role[len(ACTING_PREFIX_PY):]

    if role == 'المسؤول العام':
        return {'tier': 'general_manager', 'full_group': True}
    if role == 'المرشد الروحي':
        return {'tier': 'spiritual_guide', 'full_group': True}
    if role == 'مساعد المرشد الروحي':
        return {'tier': 'spiritual_guide_assistant', 'full_group': True}
    if role == 'نائب المسؤول العام':
        return {'tier': 'reports_to_gm', 'full_group': True}

    import re as _re
    if _re.search(r'^مرشد روحي (فئة|فئتيّ|فئات)', role):
        return {'tier': 'spiritual_guide_agegroup', 'age_groups': [g for g in AGE_GROUPS_PY if g in role]}

    if _re.search(r'^مجلس (فئة|فئتيّ|فئات)', role):
        return {'tier': 'council_head', 'age_groups': [g for g in AGE_GROUPS_PY if g in role]}

    if _re.search(r'^مسؤول (فئة|فئتيّ|فئات)', role):
        return {'tier': 'reports_to_gm', 'council_head': True, 'age_groups': [g for g in AGE_GROUPS_PY if g in role]}

    return None


def _get_council_access(person_type: str, pid, youth_groups: list) -> dict:
    access = {}
    pid_str = str(pid)

    for group_id in youth_groups:
        try:
            periods = _load_index(group_id)
            if not periods:
                continue

            active = next((p for p in periods if not p.get('to_date')), None)
            if not active:
                active = sorted(periods, key=lambda p: p.get('from_date') or '', reverse=True)[0]

            tree = _load_tree_data(group_id, active['id'])

            for node in tree.get('nodes', []):
                matched = False
                node_pid, node_unregistered = _extract_node_identity(node)
                if person_type == 'registered':
                    if not node_unregistered and node_pid is not None and str(node_pid) == pid_str:
                        matched = True
                elif person_type == 'unregistered':
                    if node_unregistered and node_pid is not None and str(node_pid) == pid_str:
                        matched = True

                if not matched:
                    continue

                classified = _classify_role_py(node.get('role', ''))
                if not classified:
                    continue

                if group_id not in access:
                    access[group_id] = {'full_group': False, 'age_groups': set()}

                if classified.get('full_group'):
                    access[group_id]['full_group'] = True
                else:
                    ags = classified.get('age_groups', [])
                    if ags:
                        access[group_id]['age_groups'].update(ags)

        except Exception as e:
            print(f'Warning: council access scan failed for {group_id}: {e}')
            continue

    result = {}
    for group_id, info in access.items():
        group_name = S.youth_group_display_label(group_id)
        if info['full_group']:
            result[group_id] = {'full_group': True, 'age_groups': AGE_GROUPS_PY, 'group_name': group_name}
        elif info['age_groups']:
            result[group_id] = {
                'full_group': False,
                'age_groups': sorted(list(info['age_groups']), key=lambda x: AGE_GROUPS_PY.index(x) if x in AGE_GROUPS_PY else 99),
                'group_name': group_name,
            }
    return result


def _get_council_accessible_persons(council_access: dict) -> list:
    """
    Return every {person_id, person_type} the user can view through their council access.
    Respects age-group specificity: full_group → all members, age_group list → only those ages.
    This is the authoritative list for frontend profile-link visibility.
    """
    accessible: dict[tuple, dict] = {}

    pyg_reg   = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
    pyg_unreg = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))

    for group_id, info in council_access.items():
        is_full      = bool(info.get("full_group"))
        allowed_ages = set(info.get("age_groups") or []) if not is_full else None

        for pyg, ptype in [(pyg_reg, "registered"), (pyg_unreg, "unregistered")]:
            if pyg.empty or "person_id" not in pyg.columns or S.YOUTH_GROUP_ID_COL not in pyg.columns:
                continue
            mask = pyg[S.YOUTH_GROUP_ID_COL].astype(str).str.strip() == group_id
            if not is_full and allowed_ages and "age_group" in pyg.columns:
                mask = mask & pyg["age_group"].isin(allowed_ages)
            for pid_str in pyg[mask]["person_id"].dropna().astype(str):
                pid_str = pid_str.strip()
                if pid_str:
                    key = (pid_str, ptype)
                    if key not in accessible:
                        accessible[key] = {"person_id": pid_str, "person_type": ptype}

    return list(accessible.values())


def _get_org_tree_descendants(person_type: str, pid, youth_groups: list) -> list:
    """
    Find every person who sits below person_id in any of their org trees.

    The tree is stored as a flat node list + edge list (from → to means parent → child).
    We BFS from every node the current person occupies, following edges downward,
    and collect all person identities we encounter.

    Returns a list of {"person_id": str, "person_type": "registered"|"unregistered"}.
    """
    if pid is None or not person_type:
        return []

    pid_str = str(pid)
    seen: dict[tuple, dict] = {}  # (pid_str, ptype) → record, for deduplication

    for group_id in youth_groups:
        try:
            periods = _load_index(group_id)
            if not periods:
                continue
            active = next((p for p in periods if not p.get("to_date")), None)
            if not active:
                active = sorted(periods, key=lambda p: p.get("from_date") or "", reverse=True)[0]

            tree = _filter_tree_data_for_user(
                _load_tree_data(group_id, active["id"]),
                {"role": "member"},
            )
            nodes = tree.get("nodes", [])
            edges = tree.get("edges", [])
            if not nodes:
                continue

            # node_id → node object
            node_map: dict[str, dict] = {}
            for n in nodes:
                nid = n.get("id")
                if nid:
                    node_map[nid] = n

            # parent_node_id → [child_node_ids]  (edges go from parent to child)
            children_of: dict[str, list] = {}
            for e in edges:
                src = e.get("from")
                dst = e.get("to")
                if src and dst:
                    children_of.setdefault(src, []).append(dst)

            # Find every node this person occupies
            my_node_ids: list[str] = []
            for n in nodes:
                node_pid, node_unreg = _extract_node_identity(n)
                if node_pid is None:
                    continue
                match = (
                    (person_type == "registered"   and not node_unreg and str(node_pid) == pid_str) or
                    (person_type == "unregistered" and     node_unreg and str(node_pid) == pid_str)
                )
                if match and n.get("id"):
                    my_node_ids.append(n["id"])

            if not my_node_ids:
                continue

            # BFS downward through the edge graph
            visited: set[str] = set()
            queue: list[str] = []
            for nid in my_node_ids:
                queue.extend(children_of.get(nid, []))

            while queue:
                nid = queue.pop(0)
                if nid in visited:
                    continue
                visited.add(nid)
                queue.extend(children_of.get(nid, []))

                node = node_map.get(nid)
                if not node:
                    continue
                desc_pid, desc_unreg = _extract_node_identity(node)
                if desc_pid is None:
                    continue
                desc_type = "unregistered" if desc_unreg else "registered"
                key = (str(desc_pid), desc_type)
                if key not in seen:
                    seen[key] = {"person_id": str(desc_pid), "person_type": desc_type}

        except Exception as e:
            print(f"Warning: org-tree descendant scan failed for {group_id}: {e}")
            continue

    return list(seen.values())


def _current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    data = _load_auth()
    user = next((u for u in data["users"] if u["username"] == uid), None)
    if user and _auth_user_link_error(user):
        return None
    return user


def _require_admin():
    u = _current_user()
    if not u or u["role"] != "admin":
        return jsonify({"error": "unauthorized"}), 403
    return None


def _require_auth():
    u = _current_user()
    if not u:
        return jsonify({"error": "unauthorized"}), 401
    return None


def register_auth_routes(app):
    _ensure_admin()

    @app.post("/api/auth/login")
    def auth_login():
        body = request.json or {}
        username = (body.get("username") or "").strip().lower()
        password = body.get("password") or ""
        data = _load_auth()
        user = next((u for u in data["users"] if u["username"].lower() == username), None)
        if not user or user["password_hash"] != _hash_pw(password):
            return jsonify({"error": "اسم المستخدم أو كلمة المرور غير صحيحة"}), 401

        link_error = _auth_user_link_error(user)
        if link_error:
            session.clear()
            return jsonify({
                "error": "تم تعطيل هذا الحساب لأن الملف الشخصي المرتبط به غير موجود.",
                "account_status": "missing_person",
            }), 403

        account_status = user.get("account_status") or "active"
        if account_status == "rejected_admin":
            reason = user.get("rejection_reason") or ""
            msg = "تم رفض طلب تسجيلك من قِبَل الإدارة."
            if reason:
                msg += f" السبب: {reason}"
            return jsonify({"error": msg, "account_status": account_status}), 403
        if account_status == "rejected_all_yg":
            reason = user.get("rejection_reason") or ""
            msg = "تم رفض طلب انضمامك إلى جميع فرق الشبيبة المطلوبة."
            if reason:
                msg += f" السبب: {reason}"
            return jsonify({"error": msg, "account_status": account_status}), 403

        session["user_id"] = user["username"]
        safe = {k: v for k, v in user.items() if k != "password_hash"}
        is_pending = account_status in ("pending", "pending_yg")
        safe["is_pending"] = is_pending

        if _has_person_link(user):
            youth_groups = _get_person_youth_groups_any(user["person_type"], user["person_id"])
            safe["youth_groups"] = youth_groups
            if not is_pending:
                computed = _get_council_access(user["person_type"], user["person_id"], youth_groups)
                council  = PS.apply_overrides(username, computed)
                safe["council_access"] = council
                safe["org_tree_descendants"]      = _get_org_tree_descendants(user["person_type"], user["person_id"], youth_groups)
                safe["council_accessible_persons"] = _get_council_accessible_persons(council)
            else:
                safe["council_access"] = {}
                safe["org_tree_descendants"] = []
                safe["council_accessible_persons"] = []
        else:
            safe["youth_groups"] = []
            safe["council_access"] = {}
            safe["org_tree_descendants"] = []
            safe["council_accessible_persons"] = []
        return jsonify({"ok": True, "user": safe})

    @app.post("/api/auth/logout")
    def auth_logout():
        session.clear()
        return jsonify({"ok": True})

    @app.get("/api/auth/me")
    def auth_me():
        u = _current_user()
        if not u:
            return jsonify({"user": None})
        account_status = u.get("account_status") or "active"
        safe = {k: v for k, v in u.items() if k != "password_hash"}
        is_pending = account_status in ("pending", "pending_yg")
        safe["is_pending"] = is_pending
        if _has_person_link(u):
            youth_groups = _get_person_youth_groups_any(u["person_type"], u["person_id"])
            safe["youth_groups"] = youth_groups
            if not is_pending:
                computed = _get_council_access(u["person_type"], u["person_id"], youth_groups)
                council  = PS.apply_overrides(u["username"], computed)
                safe["council_access"] = council
                safe["org_tree_descendants"]      = _get_org_tree_descendants(u["person_type"], u["person_id"], youth_groups)
                safe["council_accessible_persons"] = _get_council_accessible_persons(council)
            else:
                safe["council_access"] = {}
                safe["org_tree_descendants"] = []
                safe["council_accessible_persons"] = []
        else:
            safe["youth_groups"] = []
            safe["council_access"] = {}
            safe["org_tree_descendants"] = []
            safe["council_accessible_persons"] = []
        return jsonify({"user": safe})

    @app.get("/api/auth/users")
    def auth_list_users():
        err = _require_admin()
        if err:
            return err
        data = _load_auth()
        users = []
        for u in data["users"]:
            safe = {k: v for k, v in u.items() if k != "password_hash"}
            if _has_person_link(u):
                youth_groups = _get_person_youth_groups(u["person_type"], u["person_id"])
                safe["youth_groups"] = youth_groups
                computed = _get_council_access(u["person_type"], u["person_id"], youth_groups)
                safe["council_access"] = PS.apply_overrides(u["username"], computed)
            else:
                safe["youth_groups"] = []
                safe["council_access"] = {}
            users.append(safe)
        return jsonify({"users": users})

    @app.get("/api/auth/users/basic")
    def auth_list_users_basic():
        err = _require_admin()
        if err:
            return err
        data = _load_auth()
        users = []
        for u in data["users"]:
            users.append({
                "username": u.get("username"),
                "role": u.get("role"),
                "person_type": u.get("person_type"),
                "person_id": u.get("person_id"),
                "display_name": u.get("display_name") or _get_person_name(u.get("person_type"), S._normalize_person_id(u.get("person_id"))),
                "person_missing": bool(u.get("person_missing")),
            })
        return jsonify({"users": users})

    @app.get("/api/auth/users/export")
    def auth_export_users():
        err = _require_admin()
        if err:
            return err

        data = _load_auth()
        rows = []
        for u in data["users"]:
            person_type = u.get("person_type")
            person_id = S._normalize_person_id(u.get("person_id"))
            youth_groups, age_groups = _get_person_memberships(person_type, person_id)

            resolved_name = ""
            if _has_person_link(u):
                resolved_name = _get_person_name(person_type, person_id)
            if not resolved_name:
                resolved_name = str(u.get("display_name") or u.get("username") or "")

            username = str(u.get("username") or "").strip().lower()
            rows.append({
                "full_name": resolved_name,
                "youth_groups": youth_groups,
                "age_groups": age_groups,
                "username": username,
                # Source directly from JECJordanData auth sheet.
                "password": str(u.get("password_hash") or ""),
            })

        return jsonify({"users": rows, "passwords_reset": False})

    @app.post("/api/auth/users")
    def auth_create_user():
        err = _require_admin()
        if err:
            return err
        body = request.json or {}
        username = (body.get("username") or "").strip().lower()
        password = body.get("password") or ""
        role = str(body.get("role") or "member").strip() or "member"
        person_type = body.get("person_type")
        person_id = S._normalize_person_id(body.get("person_id"))
        link_error, actual_person_type = _validate_auth_person_link(role, person_type, person_id)
        if link_error:
            return jsonify({"error": link_error}), 400
        person_type = actual_person_type or None
        display_name = body.get("display_name") or _get_person_name(person_type, person_id)

        if not username or not password:
            return jsonify({"error": "username and password required"}), 400

        with auth_lock:
            data = _load_auth()
            if any(u["username"].lower() == username for u in data["users"]):
                return jsonify({"error": "المستخدم موجود مسبقاً"}), 409
            new_user = {
                "username": username,
                "password_hash": _hash_pw(password),
                "role": role,
                "person_type": person_type,
                "person_id": person_id,
                "display_name": display_name,
            }
            data["users"].append(new_user)
            _save_auth(data)
        safe = {k: v for k, v in new_user.items() if k != "password_hash"}
        return jsonify({"ok": True, "user": safe})

    @app.put("/api/auth/users/<username>")
    def auth_update_user(username):
        me = _current_user()
        if not me:
            return jsonify({"error": "unauthorized"}), 401
        if me["role"] != "admin" and me["username"].lower() != username.lower():
            return jsonify({"error": "forbidden"}), 403

        body = request.json or {}
        with auth_lock:
            data = _load_auth()
            user = next((u for u in data["users"] if u["username"].lower() == username.lower()), None)
            if not user:
                return jsonify({"error": "not found"}), 404
            old_username = str(user.get("username") or "").strip().lower()

            if "username" in body:
                new_username = (str(body.get("username") or "")).strip().lower()
                if not new_username:
                    return jsonify({"error": "username required"}), 400
                taken = next(
                    (
                        u for u in data["users"]
                        if u is not user and str(u.get("username") or "").strip().lower() == new_username
                    ),
                    None,
                )
                if taken is not None:
                    return jsonify({"error": "المستخدم موجود مسبقاً"}), 409
                user["username"] = new_username

            if body.get("password"):
                user["password_hash"] = _hash_pw(body["password"])
            if me["role"] == "admin":
                if "role" in body:
                    user["role"] = body["role"]
                if "display_name" in body:
                    user["display_name"] = body["display_name"]
                if "person_type" in body:
                    user["person_type"] = body["person_type"]
                if "person_id" in body:
                    user["person_id"] = S._normalize_person_id(body["person_id"])

            link_error, actual_person_type = _validate_auth_person_link(
                user.get("role"),
                user.get("person_type"),
                user.get("person_id"),
            )
            if link_error:
                return jsonify({"error": link_error}), 400
            if actual_person_type:
                user["person_type"] = actual_person_type
            elif S._normalize_person_id(user.get("person_id")) is None:
                user["person_type"] = None

            if me["username"].lower() == old_username and user.get("username"):
                session["user_id"] = str(user.get("username")).strip().lower()
            _save_auth(data)
        safe = {k: v for k, v in user.items() if k != "password_hash"}
        return jsonify({"ok": True, "user": safe})

    @app.delete("/api/auth/users/<username>")
    def auth_delete_user(username):
        err = _require_admin()
        if err:
            return err
        if username.lower() == "admin":
            return jsonify({"error": "cannot delete default admin"}), 400
        with auth_lock:
            data = _load_auth()
            data["users"] = [u for u in data["users"] if u["username"].lower() != username.lower()]
            _save_auth(data)
        return jsonify({"ok": True})

    @app.get("/api/auth/council-members")
    def council_members():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        youth_groups = _get_person_youth_groups(u["person_type"], u["person_id"])
        council_access = _get_council_access(u["person_type"], u["person_id"], youth_groups)

        if not council_access:
            return jsonify({"members": []})

        pyg = S._sheet_for_registered("person_youth_group")
        accessible_pids = set()

        for group_id, info in council_access.items():
            age_groups = info.get("age_groups", [])
            if info.get("full_group"):
                mask = pyg[S.YOUTH_GROUP_ID_COL] == group_id
            else:
                mask = (pyg[S.YOUTH_GROUP_ID_COL] == group_id) & (pyg["age_group"].isin(age_groups))
            pids = pyg[mask]["person_id"].dropna().unique().tolist()
            accessible_pids.update(str(int(p)) for p in pids)

        unreg_pyg = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))
        if not unreg_pyg.empty and "person_id" in unreg_pyg.columns:
            for group_id, info in council_access.items():
                age_groups = info.get("age_groups", [])
                if info.get("full_group"):
                    mask = unreg_pyg[S.YOUTH_GROUP_ID_COL] == group_id
                else:
                    mask = (unreg_pyg[S.YOUTH_GROUP_ID_COL] == group_id) & (unreg_pyg["age_group"].isin(age_groups))
                uids = unreg_pyg[mask]["person_id"].dropna().astype(str).unique().tolist()
                accessible_pids.update(f"unreg:{uid}" for uid in uids)

        return jsonify({"members": list(accessible_pids), "council_access": council_access})

    @app.post("/api/auth/generate-all")
    def auth_generate_all():
        err = _require_admin()
        if err:
            return err

        def _slugify(text: str) -> str:
            AR_MAP = {
                'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j',
                'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
                'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
                'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'y',
                'ة': 'h', 'ئ': 'y', 'ؤ': 'w', 'ء': 'a', 'لا': 'la',
            }
            out = []
            for ch in text:
                out.append(AR_MAP.get(ch, ch))
            slug = ''.join(out)
            slug = re.sub(r'[^a-z0-9_]', '', slug.lower())
            return slug[:20] or 'user'

        def _make_username(first: str, last: str, existing: set) -> str:
            base = _slugify((first or '') + '_' + (last or ''))
            if not base or base == '_':
                base = 'user'
            candidate = base
            i = 2
            while candidate in existing:
                candidate = f"{base}{i}"
                i += 1
            return candidate

        def _make_password(first: str, last: str, pid) -> str:
            slug = _slugify((first or 'u') + (last or 'u'))[:6]
            suffix = str(pid)[-4:]
            return f"{slug}{suffix}"

        with auth_lock:
            data = _load_auth()
            existing_usernames = {u["username"].lower() for u in data["users"]}
            created = []

            persons_df = S._registered_persons_df().replace({np.nan: None})
            existing_pids_reg = {
                str(u["person_id"]) for u in data["users"] if u.get("person_type") == "registered" and u.get("person_id") is not None
            }

            for row in persons_df.to_dict(orient="records"):
                pid = row.get("person_id")
                if pid is None:
                    continue
                if str(pid) in existing_pids_reg:
                    continue
                fn = str(row.get("ar_first_name") or "")
                ln = str(row.get("ar_last_name") or "")
                uname = _make_username(fn, ln, existing_usernames)
                pw = _make_password(fn, ln, pid)
                existing_usernames.add(uname)
                display_name = _compose_person_full_name(row)
                youth_groups, age_groups = _get_person_memberships("registered", pid)
                new_user = {
                    "username": uname,
                    "password_hash": _hash_pw(pw),
                    "role": "member",
                    "person_type": "registered",
                    "person_id": int(pid),
                    "display_name": display_name or f"{fn} {ln}".strip(),
                }
                data["users"].append(new_user)
                created.append({
                    "username": uname,
                    "password": pw,
                    "person_id": int(pid),
                    "person_type": "registered",
                    "display_name": new_user["display_name"],
                    "youth_groups": youth_groups,
                    "age_groups": age_groups,
                })

            unreg_df = S.unregistered_persons_view_df().replace({np.nan: None})
            existing_pids_unreg = {
                str(u["person_id"]) for u in data["users"] if u.get("person_type") == "unregistered" and u.get("person_id") is not None
            }

            if not unreg_df.empty and "person_id" in unreg_df.columns:
                for row in unreg_df.to_dict(orient="records"):
                    pid = row.get("person_id")
                    if pid is None:
                        continue
                    if str(pid) in existing_pids_unreg:
                        continue
                    fn = str(row.get("ar_first_name") or "")
                    ln = str(row.get("ar_last_name") or "")
                    uname = _make_username(fn, ln, existing_usernames)
                    pw = _make_password(fn, ln, pid)
                    existing_usernames.add(uname)
                    display_name = _compose_person_full_name(row)
                    youth_groups, age_groups = _get_person_memberships("unregistered", pid)
                    new_user = {
                        "username": uname,
                        "password_hash": _hash_pw(pw),
                        "role": "member",
                        "person_type": "unregistered",
                        "person_id": S._normalize_person_id(pid),
                        "display_name": display_name or f"{fn} {ln}".strip(),
                    }
                    data["users"].append(new_user)
                    created.append({
                        "username": uname,
                        "password": pw,
                        "person_id": S._normalize_person_id(pid),
                        "person_type": "unregistered",
                        "display_name": new_user["display_name"],
                        "youth_groups": youth_groups,
                        "age_groups": age_groups,
                    })

            _save_auth(data)

        return jsonify({"ok": True, "created": len(created), "accounts": created})


exports = {
    "_current_user": _current_user,
    "_require_admin": _require_admin,
    "_require_auth": _require_auth,
    "_load_auth": _load_auth,
    "_changed_by_user_id": _changed_by_user_id,
    "_deactivate_auth_users_for_person": _deactivate_auth_users_for_person,
    "_get_person_name": _get_person_name,
    "_get_person_youth_groups": _get_person_youth_groups,
    "_get_council_access": _get_council_access,
    "_has_person_link": _has_person_link,
    "_get_council_accessible_persons": _get_council_accessible_persons,
    "_get_org_tree_descendants": _get_org_tree_descendants,
}
