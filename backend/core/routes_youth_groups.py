import os
import math
import uuid
from collections import Counter
from datetime import datetime

import pandas as pd
from flask import jsonify, request, send_from_directory

from core import state as S
from core.routes_auth import exports as auth_exports
from core.routes_promotions import exports as promo_exports


YOUTH_GROUP_LOGOS_DIR = os.path.join(S.PHOTOS_ROOT_DIR, "logos", "youth_groups")
YOUTH_GROUP_SPECIAL_LOGOS_DIR = os.path.join(S.PHOTOS_ROOT_DIR, "logos", "youth_groups_special")
PARISH_LOGOS_DIR = os.path.join(S.PHOTOS_ROOT_DIR, "logos", "parishes")
os.makedirs(YOUTH_GROUP_LOGOS_DIR, exist_ok=True)
os.makedirs(YOUTH_GROUP_SPECIAL_LOGOS_DIR, exist_ok=True)
CHURCHES_FILE = "churches.json"
SPECIAL_LOGOS_META_FILE = "youth_group_special_logos.json"
SOCIAL_MEDIA_META_FILE = "youth_group_social_media.json"
ALLOWED_SOCIAL_PLATFORMS = {"facebook", "instagram", "linkedin"}
ALL_AGE_GROUPS = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']

YOUTH_AGE_GROUPS_REQUIRE_SCHOOL = {'البراعم', 'الإعدادي', 'الثانوي'}


def _normalize_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "nan", "None", "null"):
        return None
    return text


def _pid_key(value) -> str | None:
    norm = S._normalize_person_id(value)
    if norm is None:
        return None
    text = _normalize_text(norm)
    if not text:
        return None
    return text


def _as_int_or_none(value):
    try:
        return int(float(str(value).strip()))
    except Exception:
        return None


def _json_safe(value):
    if value is None:
        return None

    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value

    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            key_text = _normalize_text(k)
            out[(key_text if key_text is not None else str(k))] = _json_safe(v)
        return out

    if isinstance(value, list):
        return [_json_safe(v) for v in value]

    # Handle pandas/numpy sentinels represented as text in object columns.
    if isinstance(value, str):
        text = value.strip()
        if text in ("nan", "NaN", "<NA>", "None", "null", "Infinity", "-Infinity"):
            return None
        return value

    return value


def _resolve_group_id(group_ref: str | None) -> str | None:
    ref = (group_ref or "").strip()
    if not ref:
        return None
    if ref == "GS":
        return "GS"
    return S.youth_group_id(ref)


def _group_logo_filename(group_id: str):
    for ext in S.ALLOWED_EXTENSIONS:
        filename = f"{group_id}.{ext}"
        path = os.path.join(YOUTH_GROUP_LOGOS_DIR, filename)
        if os.path.exists(path):
            return filename
    return None


def _parish_logo_filename(parish_id: str):
    pid = _normalize_text(parish_id)
    if not pid:
        return None
    for ext in S.ALLOWED_EXTENSIONS:
        filename = f"{pid}.{ext}"
        path = os.path.join(PARISH_LOGOS_DIR, filename)
        if os.path.exists(path):
            return filename
    return None


def _special_logos_meta_path() -> str:
    return os.path.join(S.db.data_dir, SPECIAL_LOGOS_META_FILE)


def _social_media_meta_path() -> str:
    return os.path.join(S.db.data_dir, SOCIAL_MEDIA_META_FILE)


def _load_special_logos_meta() -> dict:
    raw = S.db.load_json_file(_special_logos_meta_path(), {})
    if not isinstance(raw, dict):
        return {}
    return raw


def _save_special_logos_meta(payload: dict):
    S.db.save_json_file(_special_logos_meta_path(), payload)


def _load_social_media_meta() -> dict:
    raw = S.db.load_json_file(_social_media_meta_path(), {})
    if not isinstance(raw, dict):
        return {}
    return raw


def _save_social_media_meta(payload: dict):
    S.db.save_json_file(_social_media_meta_path(), payload)


def _normalize_url(value) -> str | None:
    text = _normalize_text(value)
    if not text:
        return None
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return f"https://{text}"


def _normalize_age_groups(value) -> list[str]:
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = value
    else:
        values = []

    out = []
    seen = set()
    for item in values:
        text = _normalize_text(item)
        if not text or text not in ALL_AGE_GROUPS or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def _normalize_social_media_entry(entry: dict) -> dict | None:
    row = entry if isinstance(entry, dict) else {}
    item_id = _normalize_text(row.get("id")) or uuid.uuid4().hex[:12]
    platform = (_normalize_text(row.get("platform")) or "").lower() or None
    url = _normalize_url(row.get("url"))
    age_groups = _normalize_age_groups(row.get("age_groups"))

    if not platform or platform not in ALLOWED_SOCIAL_PLATFORMS or not url:
        return None

    return {
        "id": item_id,
        "platform": platform,
        "url": url,
        "age_groups": age_groups,
    }


def _group_social_media(group_id: str) -> list[dict]:
    payload = _load_social_media_meta()
    rows = payload.get(group_id) if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return []

    out = []
    for row in rows:
        norm = _normalize_social_media_entry(row)
        if norm is None:
            continue
        out.append(norm)
    return out


def _save_group_social_media(group_id: str, rows: list[dict]):
    payload = _load_social_media_meta()
    clean = []
    for row in rows:
        norm = _normalize_social_media_entry(row)
        if norm is None:
            continue
        clean.append(norm)

    if clean:
        payload[group_id] = clean
    elif group_id in payload:
        del payload[group_id]

    _save_social_media_meta(payload)


def _parish_social_media_entries(parish: dict | None) -> list[dict]:
    row = parish if isinstance(parish, dict) else {}
    parish_id = _normalize_text(row.get("id")) or "unknown"
    entries = []

    facebook = _normalize_url(row.get("facebook_url"))
    if facebook:
        entries.append({
            "id": f"parish-{parish_id}-facebook",
            "platform": "facebook",
            "url": facebook,
            "age_groups": [],
            "source": "parish",
        })

    instagram = _normalize_url(row.get("instagram_url"))
    if instagram:
        entries.append({
            "id": f"parish-{parish_id}-instagram",
            "platform": "instagram",
            "url": instagram,
            "age_groups": [],
            "source": "parish",
        })

    linkedin = _normalize_url(row.get("linkedin_url"))
    if linkedin:
        entries.append({
            "id": f"parish-{parish_id}-linkedin",
            "platform": "linkedin",
            "url": linkedin,
            "age_groups": [],
            "source": "parish",
        })

    return entries


def _effective_social_media_entries(group_entries: list[dict], parish_entries: list[dict], inherit_parish: bool) -> list[dict]:
    own = [{**row, "source": "group"} for row in (group_entries or [])]
    if not inherit_parish:
        return own
    return own + (parish_entries or [])


def _is_valid_iso_date(value: str | None) -> bool:
    text = _normalize_text(value)
    if not text:
        return False
    try:
        datetime.strptime(text, "%Y-%m-%d")
        return True
    except Exception:
        return False


def _normalize_special_logo_entry(entry: dict) -> dict:
    item = entry if isinstance(entry, dict) else {}
    logo_id = _normalize_text(item.get("id"))
    occasion = _normalize_text(item.get("occasion"))
    start_date = _normalize_text(item.get("start_date"))
    end_date = _normalize_text(item.get("end_date"))
    file_name = _normalize_text(item.get("file_name"))
    is_active = bool(item.get("is_active") or False)

    return {
        "id": logo_id,
        "occasion": occasion,
        "start_date": start_date,
        "end_date": end_date,
        "file_name": file_name,
        "is_active": is_active,
    }


def _group_special_logos(group_id: str) -> list[dict]:
    payload = _load_special_logos_meta()
    rows = payload.get(group_id) if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return []

    out = []
    for row in rows:
        norm = _normalize_special_logo_entry(row)
        if not norm.get("id") or not norm.get("file_name"):
            continue
        if not os.path.exists(os.path.join(YOUTH_GROUP_SPECIAL_LOGOS_DIR, norm["file_name"])):
            continue
        out.append(norm)
    return out


def _save_group_special_logos(group_id: str, rows: list[dict]):
    payload = _load_special_logos_meta()
    clean = []
    for row in rows:
        norm = _normalize_special_logo_entry(row)
        if not norm.get("id") or not norm.get("file_name"):
            continue
        clean.append(norm)

    if clean:
        payload[group_id] = clean
    elif group_id in payload:
        del payload[group_id]

    _save_special_logos_meta(payload)


def _active_special_logo_entry(group_id: str, rows: list[dict] | None = None) -> dict | None:
    entries = rows if isinstance(rows, list) else _group_special_logos(group_id)
    for row in entries:
        if bool(row.get("is_active") or False):
            return row
    return None


def _latest_special_logo_entry(group_id: str, rows: list[dict] | None = None) -> dict | None:
    entries = rows if isinstance(rows, list) else _group_special_logos(group_id)
    return entries[-1] if entries else None


def _special_logo_url(group_id: str, logo_id: str | None) -> str | None:
    lid = _normalize_text(logo_id)
    if not lid:
        return None
    return f"/api/youth-groups/{group_id}/special-logo/{lid}"


def _special_logo_payload(group_id: str, entry: dict) -> dict:
    row = _normalize_special_logo_entry(entry)
    return {
        "id": row.get("id"),
        "occasion": row.get("occasion"),
        "start_date": row.get("start_date"),
        "end_date": row.get("end_date"),
        "is_active": bool(row.get("is_active") or False),
        "logo_url": _special_logo_url(group_id, row.get("id")),
    }


def _parish_inherited_fields(parish: dict | None) -> dict:
    row = parish if isinstance(parish, dict) else {}
    parish_id = _normalize_text(row.get("id"))
    parish_logo = f"/api/parishes/{parish_id}/logo" if _parish_logo_filename(parish_id) else None

    return {
        "parish_name": _normalize_text(row.get("name")),
        "parish_logo_url": parish_logo,
        "parish_lpj_url": _normalize_text(row.get("lpj_url")),
        "parish_facebook_url": _normalize_text(row.get("facebook_url")),
        "parish_instagram_url": _normalize_text(row.get("instagram_url")),
        "parish_linkedin_url": _normalize_text(row.get("linkedin_url")),
        "region": _normalize_text(row.get("region")),
        "governorate": _normalize_text(row.get("governorate")),
    }


def _churches_payload_path() -> str:
    return os.path.join(S.db.data_dir, CHURCHES_FILE)


def _parish_by_id() -> dict[str, dict]:
    payload = S.db.load_json_file(_churches_payload_path(), {"parishes": [], "churches": []})
    parishes = payload.get("parishes") if isinstance(payload, dict) else []
    if not isinstance(parishes, list):
        return {}

    out = {}
    for parish in parishes:
        if not isinstance(parish, dict):
            continue
        pid = _normalize_text(parish.get("id"))
        if not pid:
            continue
        out[pid] = parish
    return out


def _churches_for_parish(parish_id: str | None) -> list[dict]:
    pid = _normalize_text(parish_id)
    if not pid:
        return []

    payload = S.db.load_json_file(_churches_payload_path(), {"parishes": [], "churches": []})
    churches = payload.get("churches") if isinstance(payload, dict) else []
    if not isinstance(churches, list):
        return []

    out = []
    for church in churches:
        if not isinstance(church, dict):
            continue
        if _normalize_text(church.get("parish_id")) != pid:
            continue

        patron = _normalize_text(church.get("patron_saint"))
        area = _normalize_text(church.get("area"))
        out.append({
            "id": _normalize_text(church.get("id")),
            "name": f"كنيسة {patron} - {area}" if patron or area else None,
            "patron_saint": patron,
            "area": area,
            "lat": church.get("lat"),
            "lng": church.get("lng"),
        })

    out.sort(key=lambda c: (
        _normalize_text(c.get("patron_saint")) or "",
        _normalize_text(c.get("area")) or "",
        _normalize_text(c.get("id")) or "",
    ))
    return out


def _group_meta(group_id: str) -> dict:
    label = S.youth_group_name(group_id) or group_id
    parish_map = _parish_by_id()
    meta = {
        "group_id": group_id,
        "group_name": label,
        "patron": None,
        "short_name": None,
        "parish_id": None,
        "parish_name": None,
        "parish_logo_url": None,
        "parish_lpj_url": None,
        "parish_facebook_url": None,
        "parish_instagram_url": None,
        "parish_linkedin_url": None,
        "region": None,
        "governorate": None,
        "parish_churches": [],
        "use_parish_logo": False,
        "inherit_parish_social_media": False,
        "social_media": [],
        "parish_social_media": [],
        "effective_social_media": [],
        "special_logo_active": False,
        "special_logo_occasion": None,
        "special_logos": [],
    }

    yg = S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame())
    if yg.empty or S.YOUTH_GROUP_ID_COL not in yg.columns:
        return meta

    row = yg[yg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)]
    if row.empty:
        return meta

    r = row.iloc[0].to_dict()
    parish_id = _normalize_text(r.get(S.YOUTH_GROUP_PARISH_ID_COL))
    use_parish_logo = bool(S._to_bool(r.get(S.YOUTH_GROUP_USE_PARISH_LOGO_COL))) if hasattr(S, "_to_bool") else bool(r.get(S.YOUTH_GROUP_USE_PARISH_LOGO_COL))
    inherit_parish_social_media = bool(S._to_bool(r.get(S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL))) if hasattr(S, "_to_bool") else bool(r.get(S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL))
    special_logo_active = bool(S._to_bool(r.get(S.YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL))) if hasattr(S, "_to_bool") else bool(r.get(S.YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL))
    special_logo_occasion = _normalize_text(r.get(S.YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL))
    parish = parish_map.get(parish_id or "", {})
    meta["patron"] = r.get(S.YOUTH_GROUP_PATRON_COL)
    meta["short_name"] = r.get(S.YOUTH_GROUP_SHORT_NAME_COL)
    meta["parish_id"] = parish_id
    meta["use_parish_logo"] = use_parish_logo
    meta["inherit_parish_social_media"] = inherit_parish_social_media
    meta["special_logo_active"] = special_logo_active
    meta["special_logo_occasion"] = special_logo_occasion
    meta.update(_parish_inherited_fields(parish))
    meta["parish_churches"] = _churches_for_parish(parish_id)
    group_social_media = _group_social_media(group_id)
    parish_social_media = _parish_social_media_entries(parish)
    meta["social_media"] = [{**row, "source": "group"} for row in group_social_media]
    meta["parish_social_media"] = parish_social_media
    meta["effective_social_media"] = _effective_social_media_entries(group_social_media, parish_social_media, inherit_parish_social_media)

    entries = _group_special_logos(group_id)
    meta["special_logos"] = [_special_logo_payload(group_id, entry) for entry in entries]
    active_entry = _active_special_logo_entry(group_id, entries)
    if active_entry:
        meta["special_logo_active"] = True
        meta["special_logo_occasion"] = _normalize_text(active_entry.get("occasion"))
    else:
        meta["special_logo_active"] = False
    return meta


def _effective_group_logo_url(group_id: str, meta: dict | None = None) -> str | None:
    row = meta if isinstance(meta, dict) else {}
    use_parish_logo = bool(row.get("use_parish_logo") or False)

    if use_parish_logo:
        parish_id = _normalize_text(row.get("parish_id"))
        if parish_id and _parish_logo_filename(parish_id):
            return f"/api/parishes/{parish_id}/logo"

    own_logo = _group_logo_filename(group_id)
    if own_logo:
        return f"/api/youth-groups/{group_id}/logo"
    return None


def _effective_group_special_logo_url(group_id: str, meta: dict | None = None, only_if_active: bool = False) -> str | None:
    row = meta if isinstance(meta, dict) else {}
    entries = row.get("special_logos") if isinstance(row.get("special_logos"), list) else _group_special_logos(group_id)

    active = None
    for item in entries:
        if bool(item.get("is_active") or False):
            active = item
            break

    if only_if_active:
        return _special_logo_url(group_id, active.get("id")) if active else None

    target = active or (entries[-1] if entries else None)
    if not target:
        return None
    return _special_logo_url(group_id, target.get("id"))


def _registered_member_rows(group_id: str) -> list[dict]:
    pyg = S._sheet_for_registered("person_youth_group")
    if pyg.empty or S.YOUTH_GROUP_ID_COL not in pyg.columns:
        return []

    rows = pyg[pyg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)].copy()
    if rows.empty or "person_id" not in rows.columns:
        return []

    persons = S._registered_persons_df().copy()
    if persons.empty or "person_id" not in persons.columns:
        return []
    person_map = {}
    for row in persons.replace({pd.NA: None}).to_dict(orient="records"):
        key = _pid_key(row.get("person_id"))
        if key:
            person_map[key] = row

    out = []
    for r in rows.replace({pd.NA: None}).to_dict(orient="records"):
        pid_key = _pid_key(r.get("person_id"))
        if not pid_key:
            continue
        person = person_map.get(pid_key, {})
        full_name = " ".join(
            str(person.get(k) or "").strip()
            for k in ("first_name", "second_name", "third_name", "last_name")
            if str(person.get(k) or "").strip()
        ).strip()
        if not full_name:
            full_name = " ".join(
                str(person.get(k) or "").strip()
                for k in ("first_name", "last_name")
                if str(person.get(k) or "").strip()
            ).strip() or pid_key
        pid_as_int = _as_int_or_none(pid_key)
        out.append({
            "person_id": pid_as_int if pid_as_int is not None else pid_key,
            "person_type": "registered",
            "full_name": full_name,
            "gender": person.get("gender"),
            "age_group": r.get("age_group"),
            "youth_join_year": r.get("youth_join_year"),
            "archived": bool(r.get("archived") or False),
        })
    return out


def _unregistered_member_rows(group_id: str) -> list[dict]:
    pyg = S.unreg_store.get("person_youth_group", pd.DataFrame())
    if pyg.empty or S.YOUTH_GROUP_ID_COL not in pyg.columns:
        return []

    rows = pyg[pyg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)].copy()
    if rows.empty or "person_id" not in rows.columns:
        return []

    persons = S.unreg_store.get("persons", pd.DataFrame())
    person_map = {}
    if not persons.empty and "person_id" in persons.columns:
        for r in persons.replace({pd.NA: None}).to_dict(orient="records"):
            pid_key = _pid_key(r.get("person_id"))
            if not pid_key:
                continue
            person_map[pid_key] = r

    out = []
    for r in rows.replace({pd.NA: None}).to_dict(orient="records"):
        pid_key = _pid_key(r.get("person_id"))
        if not pid_key:
            continue
        person = person_map.get(pid_key, {})
        full_name = " ".join(
            str(person.get(k) or "").strip()
            for k in ("first_name", "second_name", "third_name", "last_name")
            if str(person.get(k) or "").strip()
        ).strip()
        if not full_name:
            full_name = " ".join(
                str(person.get(k) or "").strip()
                for k in ("first_name", "last_name")
                if str(person.get(k) or "").strip()
            ).strip() or pid_key
        out.append({
            "person_id": pid_key,
            "person_type": "unregistered",
            "full_name": full_name,
            "gender": person.get("gender"),
            "age_group": r.get("age_group"),
            "youth_join_year": r.get("youth_join_year"),
            "archived": bool(r.get("archived") or False),
        })
    return out


def _group_periods(group_id: str) -> list[dict]:
    index_path = S.db.index_path(group_id)
    if not os.path.exists(index_path):
        return []
    periods = S.db.load_json_file(index_path, [])
    out = []
    for p in periods or []:
        if not isinstance(p, dict):
            continue
        out.append({
            "id": p.get("id"),
            "jec_year": p.get("jec_year"),
            "from_date": p.get("from_date"),
            "to_date": p.get("to_date"),
        })
    return out


def _schools_by_person_key(person_type: str) -> dict[str, list[str]]:
    if person_type == "registered":
        schools_df = S._sheet_for_registered("schools")
    else:
        schools_df = S.unreg_store.get("schools", pd.DataFrame())

    if schools_df.empty or "person_id" not in schools_df.columns:
        return {}

    out = {}
    for row in schools_df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        school = _normalize_text(row.get("school"))
        if not pid or not school:
            continue
        out.setdefault(pid, []).append(school)
    return out


def _person_rows_by_key(person_type: str) -> dict[str, dict]:
    if person_type == "registered":
        persons_df = S._registered_persons_df().copy()
    else:
        persons_df = S.unreg_store.get("persons", pd.DataFrame()).copy()

    if persons_df.empty or "person_id" not in persons_df.columns:
        return {}

    out = {}
    for row in persons_df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        if pid:
            out[pid] = row
    return out


def _member_problem_issues(member: dict, person_row: dict | None, schools: list[str]) -> list[str]:
    issues = []

    person = person_row or {}
    missing_name_parts = [
        label
        for key, label in (
            ("first_name", "الاسم الأول"),
            ("second_name", "اسم الأب"),
            ("third_name", "اسم الجد"),
            ("last_name", "اسم العائلة"),
        )
        if not _normalize_text(person.get(key))
    ]
    if missing_name_parts:
        issues.append(f"أجزاء الاسم ناقصة: {', '.join(missing_name_parts)}")

    age_group = _normalize_text(member.get("age_group"))
    if age_group in YOUTH_AGE_GROUPS_REQUIRE_SCHOOL and len(schools) == 0:
        issues.append(f"المدرسة مفقودة لفئة {age_group}")

    return issues


def register_youth_group_routes(app):
    @app.get("/api/youth-groups")
    def list_youth_group_profiles():
        err = auth_exports["_require_admin"]()
        if err:
            return err

        options = S.youth_group_options()
        groups = []
        for opt in options:
            gid = opt.get("value")
            if not gid:
                continue
            meta = _group_meta(gid)
            logo_url = _effective_group_logo_url(gid, meta)
            special_logo_url = _effective_group_special_logo_url(gid, meta)
            active_special_logo_url = _effective_group_special_logo_url(gid, meta, only_if_active=True)
            groups.append({
                "group_id": gid,
                "group_name": opt.get("label") or gid,
                "logo_url": logo_url,
                "special_logo_url": special_logo_url,
                "active_special_logo_url": active_special_logo_url,
                "special_logo_active": bool(meta.get("special_logo_active") or False),
                "special_logo_occasion": _normalize_text(meta.get("special_logo_occasion")),
                "special_logos": meta.get("special_logos") or [],
                "use_parish_logo": bool(meta.get("use_parish_logo") or False),
            })
        return jsonify({"groups": groups})

    @app.get("/api/youth-groups/<path:group_ref>/details")
    def youth_group_details(group_ref):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        meta = _group_meta(group_id)
        reg_members = _registered_member_rows(group_id)
        unreg_members = _unregistered_member_rows(group_id)
        all_members = reg_members + unreg_members
        all_members.sort(key=lambda m: (m.get("full_name") or "").strip())

        reg_person_by_key = _person_rows_by_key("registered")
        unreg_person_by_key = _person_rows_by_key("unregistered")
        reg_schools_by_key = _schools_by_person_key("registered")
        unreg_schools_by_key = _schools_by_person_key("unregistered")

        problematic_members = []
        for member in all_members:
            pid = _pid_key(member.get("person_id"))
            if not pid:
                continue
            person_type = member.get("person_type")
            if person_type == "registered":
                person_row = reg_person_by_key.get(pid)
                schools = reg_schools_by_key.get(pid, [])
            else:
                person_row = unreg_person_by_key.get(pid)
                schools = unreg_schools_by_key.get(pid, [])

            issues = _member_problem_issues(member, person_row, schools)
            if not issues:
                continue

            problematic_members.append({
                "person_id": member.get("person_id"),
                "person_type": person_type,
                "full_name": member.get("full_name"),
                "age_group": member.get("age_group"),
                "issues": issues,
            })

        age_counter = Counter()
        for m in all_members:
            age = _normalize_text(m.get("age_group")) or ""
            if age:
                age_counter[age] += 1

        periods = _group_periods(group_id)
        active = next((p for p in periods if not p.get("to_date")), None)

        logo_url = _effective_group_logo_url(group_id, meta)
        special_logo_url = _effective_group_special_logo_url(group_id, meta)
        active_special_logo_url = _effective_group_special_logo_url(group_id, meta, only_if_active=True)

        promo_data = S.db.load_promotions()
        promo_changed = promo_exports["_ensure_promotion_settings_shape"](promo_data)
        if promo_changed:
            S.db.save_promotions(promo_data)

        default_rules = promo_exports["_default_promotion_age_rules"]()
        group_rules = promo_exports["_group_promotion_rules"](promo_data, group_id)

        payload = {
            "group": {
                **meta,
                "logo_url": logo_url,
                "special_logo_url": special_logo_url,
                "active_special_logo_url": active_special_logo_url,
                "has_special_logo": bool(special_logo_url),
                "special_logo_occasion": _normalize_text(meta.get("special_logo_occasion")),
                "special_logos": meta.get("special_logos") or [],
                "has_logo": bool(logo_url),
            },
            "promotion_settings": {
                "age_rules": group_rules,
                "default_age_rules": default_rules,
            },
            "problematic_data": {
                "members": problematic_members,
                "total": len(problematic_members),
            },
            "stats": {
                "members_total": len(all_members),
                "registered_total": len(reg_members),
                "unregistered_total": len(unreg_members),
                "active_period": active,
                "periods_total": len(periods),
                "age_group_breakdown": [
                    {"label": age, "count": count}
                    for age, count in sorted(age_counter.items(), key=lambda x: x[0])
                ],
            },
            "periods": periods,
            "members": all_members,
        }

        return jsonify(_json_safe(payload))

    @app.put("/api/youth-groups/<path:group_ref>/promotion-limits")
    def update_youth_group_promotion_limits(group_ref):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        body = request.json or {}
        raw_rules = body.get("age_rules")
        if not isinstance(raw_rules, list):
            return jsonify({"error": "age_rules must be a list"}), 400

        normalized = promo_exports["_normalize_group_promotion_rules"](raw_rules)

        promo_data = S.db.load_promotions()
        promo_exports["_ensure_promotion_settings_shape"](promo_data)
        by_group = promo_data.get("group_age_rules")
        if not isinstance(by_group, dict):
            by_group = {}
            promo_data["group_age_rules"] = by_group

        by_group[group_id] = normalized
        S.db.save_promotions(promo_data)

        return jsonify({"ok": True, "group_id": group_id, "age_rules": normalized})

    @app.put("/api/youth-groups/<path:group_ref>/parish")
    def update_youth_group_parish(group_ref):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        body = request.json or {}
        parish_id = _normalize_text(body.get("parish_id"))
        if not parish_id:
            return jsonify({"error": "parish_id is required"}), 400

        use_parish_logo = bool(S._to_bool(body.get("use_parish_logo"))) if hasattr(S, "_to_bool") else bool(body.get("use_parish_logo"))
        inherit_parish_social_media_arg = body.get("inherit_parish_social_media")

        parish_map = _parish_by_id()
        parish = parish_map.get(parish_id)
        if not parish:
            return jsonify({"error": "invalid parish_id"}), 400

        with S.lock:
            yg = S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame()).copy()
            if yg.empty or S.YOUTH_GROUP_ID_COL not in yg.columns:
                return jsonify({"error": "not found"}), 404

            if S.YOUTH_GROUP_PARISH_ID_COL not in yg.columns:
                yg[S.YOUTH_GROUP_PARISH_ID_COL] = None
            if S.YOUTH_GROUP_USE_PARISH_LOGO_COL not in yg.columns:
                yg[S.YOUTH_GROUP_USE_PARISH_LOGO_COL] = False
            if S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL not in yg.columns:
                yg[S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL] = False

            mask = yg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)
            if not mask.any():
                return jsonify({"error": "not found"}), 404

            current_inherit_parish_social_media = bool(S._to_bool(yg.loc[mask, S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL].iloc[0])) if hasattr(S, "_to_bool") else bool(yg.loc[mask, S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL].iloc[0])
            inherit_parish_social_media = current_inherit_parish_social_media
            if inherit_parish_social_media_arg is not None:
                inherit_parish_social_media = bool(S._to_bool(inherit_parish_social_media_arg)) if hasattr(S, "_to_bool") else bool(inherit_parish_social_media_arg)

            yg.loc[mask, S.YOUTH_GROUP_PARISH_ID_COL] = parish_id
            yg.loc[mask, S.YOUTH_GROUP_USE_PARISH_LOGO_COL] = use_parish_logo
            yg.loc[mask, S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL] = inherit_parish_social_media
            S.store[S.YOUTH_GROUP_SHEET] = yg
            S.db.save_excel_sheets(S.store)
            S.invalidate_enriched_cache()

        return jsonify({
            "ok": True,
            "group_id": group_id,
            "parish_id": parish_id,
            "use_parish_logo": use_parish_logo,
            "inherit_parish_social_media": inherit_parish_social_media,
            **_parish_inherited_fields(parish),
            "parish_churches": _churches_for_parish(parish_id),
        })

    @app.put("/api/youth-groups/<path:group_ref>/social-media")
    def update_youth_group_social_media(group_ref):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        body = request.json or {}
        raw_rows = body.get("social_media")
        if raw_rows is not None and not isinstance(raw_rows, list):
            return jsonify({"error": "social_media must be a list"}), 400

        inherit_parish_social_media = bool(S._to_bool(body.get("inherit_parish_social_media"))) if hasattr(S, "_to_bool") else bool(body.get("inherit_parish_social_media"))

        normalized_rows = []
        for row in raw_rows or []:
            norm = _normalize_social_media_entry(row)
            if norm is None:
                return jsonify({"error": "invalid social media row"}), 400
            normalized_rows.append(norm)

        with S.lock:
            yg = S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame()).copy()
            if yg.empty or S.YOUTH_GROUP_ID_COL not in yg.columns:
                return jsonify({"error": "not found"}), 404

            if S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL not in yg.columns:
                yg[S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL] = False

            mask = yg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)
            if not mask.any():
                return jsonify({"error": "not found"}), 404

            yg.loc[mask, S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL] = inherit_parish_social_media
            S.store[S.YOUTH_GROUP_SHEET] = yg
            _save_group_social_media(group_id, normalized_rows)
            S.db.save_excel_sheets(S.store)
            S.invalidate_enriched_cache()

        meta = _group_meta(group_id)
        return jsonify(_json_safe({
            "ok": True,
            "group_id": group_id,
            "inherit_parish_social_media": bool(meta.get("inherit_parish_social_media") or False),
            "social_media": meta.get("social_media") or [],
            "parish_social_media": meta.get("parish_social_media") or [],
            "effective_social_media": meta.get("effective_social_media") or [],
        }))

    @app.post("/api/youth-groups/<path:group_ref>/logo")
    def upload_youth_group_logo(group_ref):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        if "logo" not in request.files:
            return jsonify({"error": "no file"}), 400

        file = request.files["logo"]
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in S.ALLOWED_EXTENSIONS:
            return jsonify({"error": "unsupported file type"}), 400

        os.makedirs(YOUTH_GROUP_LOGOS_DIR, exist_ok=True)
        for old_ext in S.ALLOWED_EXTENSIONS:
            old = os.path.join(YOUTH_GROUP_LOGOS_DIR, f"{group_id}.{old_ext}")
            if os.path.exists(old):
                os.remove(old)

        dest_name = f"{group_id}.{ext}"
        file.save(os.path.join(YOUTH_GROUP_LOGOS_DIR, dest_name))

        return jsonify({"ok": True, "logo_url": f"/api/youth-groups/{group_id}/logo"})

    @app.post("/api/youth-groups/<path:group_ref>/special-logo")
    def upload_youth_group_special_logo(group_ref):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        if "logo" not in request.files:
            return jsonify({"error": "no file"}), 400

        occasion = _normalize_text(request.form.get("occasion"))
        if not occasion:
            return jsonify({"error": "occasion is required"}), 400

        start_date = _normalize_text(request.form.get("start_date"))
        end_date = _normalize_text(request.form.get("end_date"))
        is_active = bool(S._to_bool(request.form.get("is_active"))) if hasattr(S, "_to_bool") else bool(request.form.get("is_active"))

        if not _is_valid_iso_date(start_date):
            return jsonify({"error": "start_date is required in YYYY-MM-DD format"}), 400

        if not is_active and not _is_valid_iso_date(end_date):
            return jsonify({"error": "end_date is required in YYYY-MM-DD format when logo is not current"}), 400

        if is_active:
            end_date = None

        file = request.files["logo"]
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in S.ALLOWED_EXTENSIONS:
            return jsonify({"error": "unsupported file type"}), 400

        os.makedirs(YOUTH_GROUP_SPECIAL_LOGOS_DIR, exist_ok=True)
        logo_id = uuid.uuid4().hex[:12]
        dest_name = f"{group_id}_{logo_id}.{ext}"
        file.save(os.path.join(YOUTH_GROUP_SPECIAL_LOGOS_DIR, dest_name))

        entries = _group_special_logos(group_id)
        if is_active:
            for item in entries:
                item["is_active"] = False

        new_entry = {
            "id": logo_id,
            "occasion": occasion,
            "start_date": start_date,
            "end_date": end_date,
            "is_active": is_active,
            "file_name": dest_name,
        }
        entries.append(new_entry)
        _save_group_special_logos(group_id, entries)

        with S.lock:
            yg = S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame()).copy()
            if yg.empty or S.YOUTH_GROUP_ID_COL not in yg.columns:
                return jsonify({"error": "not found"}), 404

            if S.YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL not in yg.columns:
                yg[S.YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL] = None
            if S.YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL not in yg.columns:
                yg[S.YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL] = False

            mask = yg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)
            if not mask.any():
                return jsonify({"error": "not found"}), 404

            active_entry = _active_special_logo_entry(group_id, entries)
            yg.loc[mask, S.YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL] = _normalize_text(active_entry.get("occasion")) if active_entry else None
            yg.loc[mask, S.YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL] = bool(active_entry)
            S.store[S.YOUTH_GROUP_SHEET] = yg
            S.db.save_excel_sheets(S.store)
            S.invalidate_enriched_cache()

        return jsonify({
            "ok": True,
            "special_logo": _special_logo_payload(group_id, new_entry),
            "special_logos": [_special_logo_payload(group_id, entry) for entry in entries],
            "special_logo_url": _effective_group_special_logo_url(group_id),
            "active_special_logo_url": _effective_group_special_logo_url(group_id, only_if_active=True),
            "special_logo_occasion": _normalize_text((_active_special_logo_entry(group_id, entries) or {}).get("occasion")),
        })

    @app.put("/api/youth-groups/<path:group_ref>/special-logo-settings")
    def update_youth_group_special_logo_settings(group_ref):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        body = request.json or {}
        special_logo_active = bool(S._to_bool(body.get("special_logo_active"))) if hasattr(S, "_to_bool") else bool(body.get("special_logo_active"))
        special_logo_id = _normalize_text(body.get("special_logo_id"))

        entries = _group_special_logos(group_id)
        if not entries:
            return jsonify({"error": "no special logos uploaded"}), 400

        if special_logo_active:
            target_id = special_logo_id or _normalize_text(entries[-1].get("id"))
            found = False
            for item in entries:
                is_target = _normalize_text(item.get("id")) == target_id
                item["is_active"] = bool(is_target)
                if is_target:
                    item["end_date"] = None
                    found = True
            if not found:
                return jsonify({"error": "invalid special_logo_id"}), 400
        else:
            if special_logo_id:
                found = False
                for item in entries:
                    if _normalize_text(item.get("id")) == special_logo_id:
                        item["is_active"] = False
                        found = True
                if not found:
                    return jsonify({"error": "invalid special_logo_id"}), 400
            else:
                for item in entries:
                    item["is_active"] = False

        _save_group_special_logos(group_id, entries)

        with S.lock:
            yg = S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame()).copy()
            if yg.empty or S.YOUTH_GROUP_ID_COL not in yg.columns:
                return jsonify({"error": "not found"}), 404

            if S.YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL not in yg.columns:
                yg[S.YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL] = False
            if S.YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL not in yg.columns:
                yg[S.YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL] = None

            mask = yg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)
            if not mask.any():
                return jsonify({"error": "not found"}), 404

            active_entry = _active_special_logo_entry(group_id, entries)
            yg.loc[mask, S.YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL] = bool(active_entry)
            yg.loc[mask, S.YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL] = _normalize_text(active_entry.get("occasion")) if active_entry else None
            S.store[S.YOUTH_GROUP_SHEET] = yg
            S.db.save_excel_sheets(S.store)
            S.invalidate_enriched_cache()

        meta = _group_meta(group_id)
        special_logo_url = _effective_group_special_logo_url(group_id, meta)
        active_special_logo_url = _effective_group_special_logo_url(group_id, meta, only_if_active=True)
        return jsonify({
            "ok": True,
            "group_id": group_id,
            "special_logo_active": bool(meta.get("special_logo_active") or False),
            "special_logo_url": special_logo_url,
            "active_special_logo_url": active_special_logo_url,
            "special_logo_occasion": _normalize_text(meta.get("special_logo_occasion")),
            "has_special_logo": bool(special_logo_url),
            "special_logos": meta.get("special_logos") or [],
        })

    @app.get("/api/youth-groups/<path:group_ref>/logo")
    def serve_youth_group_logo(group_ref):
        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404
        meta = _group_meta(group_id)
        if bool(meta.get("use_parish_logo") or False):
            parish_id = _normalize_text(meta.get("parish_id"))
            parish_logo = _parish_logo_filename(parish_id) if parish_id else None
            if parish_logo:
                return send_from_directory(PARISH_LOGOS_DIR, parish_logo)

        logo_name = _group_logo_filename(group_id)
        if logo_name:
            return send_from_directory(YOUTH_GROUP_LOGOS_DIR, logo_name)
        return jsonify({"error": "not found"}), 404

    @app.get("/api/youth-groups/<path:group_ref>/special-logo")
    def serve_youth_group_special_logo(group_ref):
        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        entry = _active_special_logo_entry(group_id) or _latest_special_logo_entry(group_id)
        if entry:
            logo_name = _normalize_text(entry.get("file_name"))
            if logo_name:
                return send_from_directory(YOUTH_GROUP_SPECIAL_LOGOS_DIR, logo_name)
        return jsonify({"error": "not found"}), 404

    @app.get("/api/youth-groups/<path:group_ref>/special-logo/<logo_id>")
    def serve_youth_group_special_logo_by_id(group_ref, logo_id):
        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        lid = _normalize_text(logo_id)
        if not lid:
            return jsonify({"error": "not found"}), 404

        for item in _group_special_logos(group_id):
            if _normalize_text(item.get("id")) != lid:
                continue
            logo_name = _normalize_text(item.get("file_name"))
            if logo_name:
                return send_from_directory(YOUTH_GROUP_SPECIAL_LOGOS_DIR, logo_name)
            break
        return jsonify({"error": "not found"}), 404

    @app.get("/api/youth-groups/<path:group_ref>/special-logo-active")
    def serve_youth_group_special_logo_active(group_ref):
        group_id = _resolve_group_id(group_ref)
        if not group_id:
            return jsonify({"error": "not found"}), 404

        meta = _group_meta(group_id)
        if not bool(meta.get("special_logo_active") or False):
            return jsonify({"error": "not found"}), 404

        active_entry = _active_special_logo_entry(group_id)
        if active_entry:
            logo_name = _normalize_text(active_entry.get("file_name"))
            if logo_name:
                return send_from_directory(YOUTH_GROUP_SPECIAL_LOGOS_DIR, logo_name)
        return jsonify({"error": "not found"}), 404
