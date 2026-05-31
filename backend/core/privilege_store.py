"""
Central privilege override store.

This is the single source of truth for manual privilege overrides.
All route files that need to read or apply overrides import from here,
keeping routes_auth.py and routes_privileges.py decoupled.
"""
import json
import os
import threading

from core import state as S

_lock = threading.Lock()

AGE_GROUPS = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']


def _path() -> str:
    return os.path.join(S.db.data_dir, "privilege_overrides.json")


def load() -> dict:
    """Load all privilege overrides from persistent storage."""
    path = _path()
    if not os.path.exists(path):
        return {"overrides": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"overrides": []}


def save(data: dict):
    """Atomically save privilege overrides."""
    path = _path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_lock() -> threading.Lock:
    """Return the shared lock for write operations."""
    return _lock


def apply_overrides(username: str, computed_council: dict) -> dict:
    """
    Apply manual privilege overrides on top of position-computed council access.

    This is the function that makes PrivilegeManager the authoritative hub:
    any grant/revoke created there flows through here into the live council_access
    that auth/me and all permission checks use.
    """
    if not username:
        return dict(computed_council)

    data = load()
    user_overrides = [o for o in data.get("overrides", []) if o.get("username") == username]
    if not user_overrides:
        return dict(computed_council)

    effective = {k: dict(v) for k, v in computed_council.items()}

    for override in user_overrides:
        o_type    = override.get("type")
        privilege = override.get("privilege")
        group_id  = override.get("group_id")
        age_group = override.get("age_group")
        stored_group_name = str(override.get("group_name") or "").strip()
        group_name = stored_group_name
        if group_name == "GS" or S._is_group_id(group_name):
            group_name = ""
        if not group_name and group_id:
            group_name = S.youth_group_display_label(group_id)

        if privilege == "council_full" and group_id:
            if o_type == "grant":
                effective[group_id] = {
                    "full_group": True,
                    "age_groups": list(AGE_GROUPS),
                    "group_name": group_name,
                }
            elif o_type == "revoke":
                effective.pop(group_id, None)

        elif privilege == "council_age_group" and group_id and age_group:
            if o_type == "grant":
                if group_id not in effective:
                    effective[group_id] = {"full_group": False, "age_groups": [], "group_name": group_name}
                if not effective[group_id].get("full_group"):
                    ags = list(effective[group_id].get("age_groups") or [])
                    if age_group not in ags:
                        ags.append(age_group)
                    effective[group_id]["age_groups"] = sorted(
                        ags, key=lambda x: AGE_GROUPS.index(x) if x in AGE_GROUPS else 99
                    )
            elif o_type == "revoke":
                if group_id in effective:
                    if effective[group_id].get("full_group"):
                        remaining = [ag for ag in AGE_GROUPS if ag != age_group]
                        effective[group_id] = {"full_group": False, "age_groups": remaining, "group_name": group_name}
                    else:
                        ags = [ag for ag in (effective[group_id].get("age_groups") or []) if ag != age_group]
                        effective[group_id]["age_groups"] = ags
                        if not ags:
                            effective.pop(group_id)

    return effective
