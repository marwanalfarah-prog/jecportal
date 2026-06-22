import json
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
ALLOWED_SOCIAL_PLATFORMS = {"facebook", "instagram", "linkedin"}
ALL_AGE_GROUPS = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
ALL_AGE_GROUPS_SET = set(ALL_AGE_GROUPS)
YOUTH_GROUP_SOCIAL_MEDIA_ID_PREFIX = "YGSM"
YOUTH_GROUP_SOCIAL_MEDIA_ID_WIDTH = 6

YOUTH_AGE_GROUPS_REQUIRE_SCHOOL = {'البراعم', 'الإعدادي', 'الثانوي'}
YOUTH_AGE_GROUPS_SCHOOL = {'البراعم', 'البراعم الكبرى', 'البراعم الصغرى', 'الإعدادي', 'الثانوي'}
YOUTH_AGE_GROUPS_HIGHER_EDU = {'الجامعيّة', 'العاملة'}
SCHOOL_STATUS_STUDYING = 'على مقاعد الدراسة'


def _bool_field(val) -> bool:
    if not val:
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(val)
    return str(val).strip().lower() in ('true', '1', 'yes', 'نعم')


def _normalize_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "nan", "None", "null"):
        return None
    return text


def _first_present(row: dict | None, *keys: str):
    payload = row if isinstance(row, dict) else {}
    for key in keys:
        if key in payload:
            return payload.get(key)
    return None


def _changed_by_from_current_user() -> str:
    user = auth_exports["_current_user"]()
    if not user or user.get("role") == "admin":
        return "admin"
    person_id = user.get("person_id")
    return str(person_id) if person_id is not None and str(person_id).strip() else "admin"


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


def _normalize_url(value) -> str | None:
    text = _normalize_text(value)
    if not text:
        return None
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return f"https://{text}"


def _normalize_age_groups(value) -> list[str]:
    if isinstance(value, str):
        text = _normalize_text(value)
        if not text:
            values = []
        else:
            try:
                parsed = json.loads(text)
            except (TypeError, ValueError, json.JSONDecodeError):
                parsed = text
            if isinstance(parsed, list):
                values = parsed
            elif isinstance(parsed, tuple):
                values = list(parsed)
            elif parsed is None:
                values = []
            else:
                values = [parsed]
    elif isinstance(value, (list, tuple)):
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
    if len(out) == len(ALL_AGE_GROUPS_SET):
        return []
    return out


def _social_media_id_sequence(value) -> int | None:
    text = _normalize_text(value)
    if not text:
        return None
    upper = text.upper()
    if not upper.startswith(YOUTH_GROUP_SOCIAL_MEDIA_ID_PREFIX):
        return None
    digits = upper[len(YOUTH_GROUP_SOCIAL_MEDIA_ID_PREFIX):]
    if len(digits) != YOUTH_GROUP_SOCIAL_MEDIA_ID_WIDTH or not digits.isdigit():
        return None
    return int(digits)


def _format_social_media_id(sequence: int) -> str:
    return f"{YOUTH_GROUP_SOCIAL_MEDIA_ID_PREFIX}{sequence:0{YOUTH_GROUP_SOCIAL_MEDIA_ID_WIDTH}d}"


def _normalize_social_media_id(value) -> str | None:
    sequence = _social_media_id_sequence(value)
    if sequence is None:
        return None
    return _format_social_media_id(sequence)


def _next_social_media_id_sequence(rows: list[dict] | None = None) -> int:
    candidates = rows if isinstance(rows, list) else []
    if not candidates:
        df = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SOCIAL_MEDIA_SHEET, pd.DataFrame()).copy())
        if not df.empty:
            candidates = df.replace({pd.NA: None}).to_dict(orient="records")

    max_sequence = 0
    for row in candidates:
        sequence = _social_media_id_sequence(
            _first_present(row, S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "id")
        )
        if sequence is not None and sequence > max_sequence:
            max_sequence = sequence
    return max_sequence + 1


def _raw_social_media_sheet_rows() -> list[dict]:
    df = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SOCIAL_MEDIA_SHEET, pd.DataFrame()).copy())
    if df.empty:
        return []
    return df.where(pd.notna(df), None).to_dict(orient="records")


def _raw_social_media_age_group_sheet_rows() -> list[dict]:
    df = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_SHEET, pd.DataFrame()).copy())
    if df.empty:
        return []
    return df.where(pd.notna(df), None).to_dict(orient="records")


def _normalize_social_media_entry(entry: dict) -> dict | None:
    row = entry if isinstance(entry, dict) else {}
    item_id = _normalize_social_media_id(_first_present(row, S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "id"))
    platform = (_normalize_text(row.get("platform")) or "").lower() or None
    url = _normalize_url(row.get("url"))
    age_groups = _normalize_age_groups(row.get("age_groups"))

    if not platform or platform not in ALLOWED_SOCIAL_PLATFORMS or not url:
        return None

    return {
        S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL: item_id,
        "platform": platform,
        "url": url,
        "age_groups": age_groups,
    }


def _social_media_sheet_row(group_id: str | None, entry: dict, *, item_id: str | None = None) -> dict | None:
    gid = _normalize_text(group_id)
    norm = _normalize_social_media_entry(entry)
    if not gid or norm is None:
        return None

    social_media_id = _normalize_social_media_id(item_id or norm.get(S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL))
    if not social_media_id:
        return None

    return {
        "youth_group_id": gid,
        S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL: social_media_id,
        "platform": norm["platform"],
        "url": norm["url"],
    }


def _social_media_age_group_row(item_id: str | None, age_group: str | None) -> dict | None:
    social_media_id = _normalize_social_media_id(item_id)
    normalized_age_group = _normalize_text(age_group)
    if not social_media_id or normalized_age_group not in ALL_AGE_GROUPS_SET:
        return None
    return {
        S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL: social_media_id,
        "age_group": normalized_age_group,
    }


def _social_media_age_group_rows(item_id: str | None, age_groups: list[str] | None) -> list[dict]:
    rows = []
    for age_group in _normalize_age_groups(age_groups):
        row = _social_media_age_group_row(item_id, age_group)
        if row is not None:
            rows.append(row)
    return rows


def _social_media_age_group_lookup() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    seen: set[tuple[str, str]] = set()
    for row in _raw_social_media_age_group_sheet_rows():
        normalized = _social_media_age_group_row(
            _first_present(row, S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "id"),
            row.get("age_group"),
        )
        if normalized is None:
            continue
        social_media_id = normalized[S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL]
        age_group = normalized["age_group"]
        dedupe_key = (social_media_id, age_group)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        out.setdefault(social_media_id, []).append(age_group)

    for social_media_id, age_groups in out.items():
        out[social_media_id] = [age for age in ALL_AGE_GROUPS if age in set(age_groups)]
    return out


def _canonical_social_media_sheet_rows() -> list[dict]:
    rows = []
    for row in _raw_social_media_sheet_rows():
        normalized = _social_media_sheet_row(
            row.get("youth_group_id"),
            row,
            item_id=_first_present(row, S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "id"),
        )
        if normalized is None:
            continue
        rows.append(normalized)
    return rows


def _canonical_social_media_age_group_sheet_rows() -> list[dict]:
    rows = []
    seen: set[tuple[str, str]] = set()
    for row in _raw_social_media_age_group_sheet_rows():
        normalized = _social_media_age_group_row(
            _first_present(row, S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "id"),
            row.get("age_group"),
        )
        if normalized is None:
            continue
        dedupe_key = (normalized[S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL], normalized["age_group"])
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        rows.append(normalized)

    rows.sort(key=lambda row: (
        row[S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL],
        ALL_AGE_GROUPS.index(row["age_group"]) if row["age_group"] in ALL_AGE_GROUPS else len(ALL_AGE_GROUPS),
    ))
    return rows


def _ensure_youth_group_social_media_storage() -> bool:
    main_rows = _raw_social_media_sheet_rows()
    age_rows = _raw_social_media_age_group_sheet_rows()

    existing_inline_age_groups: dict[str, list[str]] = {}
    existing_sheet_age_groups: dict[str, list[str]] = {}

    for row in age_rows:
        raw_id = _normalize_text(_first_present(row, S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "id"))
        normalized_age_group = _normalize_text(row.get("age_group"))
        if not raw_id or normalized_age_group not in ALL_AGE_GROUPS_SET:
            continue
        existing_sheet_age_groups.setdefault(raw_id, []).append(normalized_age_group)

    used_ids: set[str] = set()
    next_sequence = _next_social_media_id_sequence(main_rows)
    migrated_main_rows: list[dict] = []
    migrated_age_rows: list[dict] = []

    for row in main_rows:
        if not isinstance(row, dict):
            continue

        raw_id = _normalize_text(_first_present(row, S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "id"))
        inline_age_groups = _normalize_age_groups(row.get("age_groups"))
        if raw_id and inline_age_groups:
            existing_inline_age_groups[raw_id] = inline_age_groups

        social_media_id = _normalize_social_media_id(raw_id)
        if not social_media_id or social_media_id in used_ids:
            while True:
                candidate = _format_social_media_id(next_sequence)
                next_sequence += 1
                if candidate not in used_ids:
                    social_media_id = candidate
                    break
        used_ids.add(social_media_id)

        normalized_main_row = _social_media_sheet_row(row.get("youth_group_id"), row, item_id=social_media_id)
        if normalized_main_row is None:
            continue
        migrated_main_rows.append(normalized_main_row)

        raw_age_groups = existing_sheet_age_groups.get(raw_id or "", []) or existing_inline_age_groups.get(raw_id or "", [])
        normalized_age_groups = _normalize_age_groups(raw_age_groups)
        migrated_age_rows.extend(_social_media_age_group_rows(social_media_id, normalized_age_groups))

    current_main_rows = _canonical_social_media_sheet_rows()
    current_age_rows = _canonical_social_media_age_group_sheet_rows()

    has_obsolete_columns = False
    main_df = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SOCIAL_MEDIA_SHEET, pd.DataFrame()).copy())
    if not main_df.empty:
        has_obsolete_columns = any(
            col not in S.YOUTH_GROUP_SOCIAL_MEDIA_COLUMNS and col not in S.SCD_METADATA_COLUMNS and col != "id"
            for col in main_df.columns
        )

    age_df = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_SHEET, pd.DataFrame()).copy())
    has_age_sheet_schema_mismatch = age_df.empty and S.YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_SHEET not in S.store
    if not age_df.empty:
        has_age_sheet_schema_mismatch = any(
            col not in S.YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_COLUMNS and col not in S.SCD_METADATA_COLUMNS
            for col in age_df.columns
        )

    changed = (
        has_obsolete_columns
        or has_age_sheet_schema_mismatch
        or migrated_main_rows != current_main_rows
        or migrated_age_rows != current_age_rows
    )

    S._scd_replace_rows_by_key(
        S.store,
        S.YOUTH_GROUP_SOCIAL_MEDIA_SHEET,
        migrated_main_rows,
        S.YOUTH_GROUP_SOCIAL_MEDIA_COLUMNS,
        [S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL],
        changed_by="admin",
    )
    S._scd_replace_rows_by_key(
        S.store,
        S.YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_SHEET,
        migrated_age_rows,
        S.YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_COLUMNS,
        [S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "age_group"],
        changed_by="admin",
    )
    return changed

def _group_social_media(group_id: str) -> list[dict]:
    _ensure_youth_group_social_media_storage()

    age_group_lookup = _social_media_age_group_lookup()
    out = []
    for row in _canonical_social_media_sheet_rows():
        if _normalize_text(row.get("youth_group_id")) != str(group_id):
            continue
        norm = _normalize_social_media_entry({
            **row,
            "age_groups": age_group_lookup.get(row.get(S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL), []),
        })
        if norm is None:
            continue
        out.append(norm)
    return out


def _save_group_social_media(group_id: str, rows: list[dict], *, changed_by: str = "admin"):
    _ensure_youth_group_social_media_storage()

    current_rows = _canonical_social_media_sheet_rows()
    current_group_ids = {
        row[S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL]
        for row in current_rows
        if _normalize_text(row.get("youth_group_id")) == str(group_id)
    }
    retained_rows = [
        row for row in current_rows
        if _normalize_text(row.get("youth_group_id")) != str(group_id)
    ]
    retained_age_rows = [
        row for row in _canonical_social_media_age_group_sheet_rows()
        if row[S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL] not in current_group_ids
    ]

    clean = []
    clean_age_rows = []
    used_ids = {row[S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL] for row in retained_rows}
    next_sequence = _next_social_media_id_sequence(current_rows)
    for row in rows:
        normalized_entry = _normalize_social_media_entry(row)
        if normalized_entry is None:
            continue
        social_media_id = _normalize_social_media_id(normalized_entry.get(S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL))
        if not social_media_id or social_media_id in used_ids:
            while True:
                candidate = _format_social_media_id(next_sequence)
                next_sequence += 1
                if candidate not in used_ids:
                    social_media_id = candidate
                    break
        used_ids.add(social_media_id)

        normalized_main_row = _social_media_sheet_row(group_id, normalized_entry, item_id=social_media_id)
        if normalized_main_row is None:
            continue

        clean.append(normalized_main_row)
        clean_age_rows.extend(_social_media_age_group_rows(social_media_id, normalized_entry.get("age_groups")))

    S._scd_replace_rows_by_key(
        S.store,
        S.YOUTH_GROUP_SOCIAL_MEDIA_SHEET,
        retained_rows + clean,
        S.YOUTH_GROUP_SOCIAL_MEDIA_COLUMNS,
        [S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL],
        changed_by=changed_by,
    )
    S._scd_replace_rows_by_key(
        S.store,
        S.YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_SHEET,
        retained_age_rows + clean_age_rows,
        S.YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_COLUMNS,
        [S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "age_group"],
        changed_by=changed_by,
    )


def _parish_social_media_entries(parish: dict | None) -> list[dict]:
    row = parish if isinstance(parish, dict) else {}
    parish_id = _normalize_text(row.get(S.PARISH_ID_COL) or row.get("id")) or "unknown"
    entries = []

    facebook = _normalize_url(row.get("facebook_url"))
    if facebook:
        entries.append({
            S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL: None,
            "platform": "facebook",
            "url": facebook,
            "age_groups": [],
            "source": "parish",
        })

    instagram = _normalize_url(row.get("instagram_url"))
    if instagram:
        entries.append({
            S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL: None,
            "platform": "instagram",
            "url": instagram,
            "age_groups": [],
            "source": "parish",
        })

    linkedin = _normalize_url(row.get("linkedin_url"))
    if linkedin:
        entries.append({
            S.YOUTH_GROUP_SOCIAL_MEDIA_ID_COL: None,
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
    logo_id = _normalize_text(item.get(S.SPECIAL_LOGO_ID_COL) or item.get("id"))
    occasion = _normalize_text(item.get("occasion"))
    start_date = _normalize_text(item.get("start_date"))
    end_date = _normalize_text(item.get("end_date"))
    file_name = _normalize_text(item.get("logo_file_name") or item.get("file_name"))
    is_active = bool(S._to_bool(item.get("is_active"))) if hasattr(S, "_to_bool") else bool(item.get("is_active") or False)

    return {
        S.SPECIAL_LOGO_ID_COL: logo_id,
        "occasion": occasion,
        "start_date": start_date,
        "end_date": end_date,
        "logo_file_name": file_name,
        "is_active": is_active,
    }


def _special_logo_rows_df() -> pd.DataFrame:
    df = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SPECIAL_LOGO_SHEET, pd.DataFrame()).copy())
    if df.empty:
        return pd.DataFrame(columns=S.YOUTH_GROUP_SPECIAL_LOGO_COLUMNS)
    for col in S.YOUTH_GROUP_SPECIAL_LOGO_COLUMNS:
        if col not in df.columns:
            df[col] = None
    return df[S.YOUTH_GROUP_SPECIAL_LOGO_COLUMNS].copy()


def _special_logo_sheet_rows() -> list[dict]:
    df = _special_logo_rows_df()
    if df.empty:
        return []
    return df.replace({pd.NA: None}).to_dict(orient="records")


def _group_special_logos(group_id: str) -> list[dict]:
    rows = []
    for row in _special_logo_sheet_rows():
        if _normalize_text(row.get("youth_group_id")) != str(group_id):
            continue
        rows.append(row)

    out = []
    for row in rows:
        norm = _normalize_special_logo_entry(row)
        if not norm.get(S.SPECIAL_LOGO_ID_COL) or not norm.get("logo_file_name"):
            continue
        if not os.path.exists(os.path.join(YOUTH_GROUP_SPECIAL_LOGOS_DIR, norm["logo_file_name"])):
            continue
        out.append(norm)
    return out


def _save_group_special_logos(group_id: str, rows: list[dict], *, changed_by: str = "admin"):

    with S.lock:
        existing_rows = [
            row for row in _special_logo_sheet_rows()
            if _normalize_text(row.get("youth_group_id")) != str(group_id)
        ]

        for row in rows:
            norm = _normalize_special_logo_entry(row)
            if not norm.get(S.SPECIAL_LOGO_ID_COL) or not norm.get("logo_file_name"):
                continue
            existing_rows.append({
                "youth_group_id": group_id,
                **norm,
            })

        normalized_rows = S.normalize_youth_group_special_logo_rows(existing_rows)
        S._scd_replace_rows_by_key(
            S.store,
            S.YOUTH_GROUP_SPECIAL_LOGO_SHEET,
            normalized_rows,
            S.YOUTH_GROUP_SPECIAL_LOGO_COLUMNS,
            [S.SPECIAL_LOGO_ID_COL],
            changed_by=changed_by,
        )
        S.save()


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
    logo_id = row.get(S.SPECIAL_LOGO_ID_COL)
    return {
        S.SPECIAL_LOGO_ID_COL: logo_id,
        "id": logo_id,
        "occasion": row.get("occasion"),
        "start_date": row.get("start_date"),
        "end_date": row.get("end_date"),
        "is_active": bool(row.get("is_active") or False),
        "logo_url": _special_logo_url(group_id, logo_id),
    }


def _parish_inherited_fields(parish: dict | None) -> dict:
    row = parish if isinstance(parish, dict) else {}
    parish_id = _normalize_text(row.get(S.PARISH_ID_COL) or row.get("id"))
    parish_logo = f"/api/parishes/{parish_id}/logo" if _parish_logo_filename(parish_id) else None
    patron = _normalize_text(row.get("patron_saint"))
    area = _normalize_text(row.get("area"))
    parish_name = _normalize_text(row.get("name"))
    if not parish_name and patron and area:
        parish_name = f"رعية {patron} - {area}"

    return {
        "parish_name": parish_name,
        "parish_logo_url": parish_logo,
        "parish_lpj_url": _normalize_text(row.get("lpj_url")),
        "parish_facebook_url": _normalize_text(row.get("facebook_url")),
        "parish_instagram_url": _normalize_text(row.get("instagram_url")),
        "parish_linkedin_url": _normalize_text(row.get("linkedin_url")),
        "region": _normalize_text(row.get("region")),
        "governorate": _normalize_text(row.get("governorate")),
    }


def _parish_by_id() -> dict[str, dict]:
    parishes_df = S._scd_filter_active(S.store.get(S.PARISH_SHEET, pd.DataFrame()).copy())
    if parishes_df.empty:
        return {}

    for col in S.PARISH_COLUMNS:
        if col not in parishes_df.columns:
            parishes_df[col] = None

    parishes = parishes_df[S.PARISH_COLUMNS].where(pd.notna(parishes_df[S.PARISH_COLUMNS]), None).to_dict(orient="records")

    out = {}
    for parish in parishes:
        if not isinstance(parish, dict):
            continue
        pid = _normalize_text(parish.get(S.PARISH_ID_COL) or parish.get("id"))
        if not pid:
            continue
        out[pid] = parish
    return out


def _churches_for_parish(parish_id: str | None) -> list[dict]:
    pid = _normalize_text(parish_id)
    if not pid:
        return []

    churches_df = S._scd_filter_active(S.store.get(S.CHURCH_SHEET, pd.DataFrame()).copy())
    if churches_df.empty:
        return []

    for col in S.CHURCH_COLUMNS:
        if col not in churches_df.columns:
            churches_df[col] = None

    churches = churches_df[S.CHURCH_COLUMNS].where(pd.notna(churches_df[S.CHURCH_COLUMNS]), None).to_dict(orient="records")

    out = []
    for church in churches:
        if not isinstance(church, dict):
            continue
        if _normalize_text(church.get(S.PARISH_ID_COL) or church.get("parish_id")) != pid:
            continue

        patron = _normalize_text(church.get("patron_saint"))
        area = _normalize_text(church.get("area"))
        church_id = _normalize_text(church.get(S.CHURCH_ID_COL) or church.get("id"))
        out.append({
            S.CHURCH_ID_COL: church_id,
            "id": church_id,
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
    label = S.youth_group_display_label(group_id)
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

    yg = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame()).copy())
    if yg.empty or S.YOUTH_GROUP_ID_COL not in yg.columns:
        return meta

    row = yg[yg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)]
    if row.empty:
        return meta

    r = row.iloc[0].to_dict()
    parish_id = _normalize_text(r.get(S.YOUTH_GROUP_PARISH_ID_COL))
    use_parish_logo = bool(S._to_bool(r.get(S.YOUTH_GROUP_USE_PARISH_LOGO_COL))) if hasattr(S, "_to_bool") else bool(r.get(S.YOUTH_GROUP_USE_PARISH_LOGO_COL))
    inherit_parish_social_media = bool(S._to_bool(r.get(S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL))) if hasattr(S, "_to_bool") else bool(r.get(S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL))
    parish = parish_map.get(parish_id or "", {})
    meta["patron"] = r.get(S.YOUTH_GROUP_PATRON_COL)
    meta["short_name"] = r.get(S.YOUTH_GROUP_SHORT_NAME_COL)
    meta["parish_id"] = parish_id
    meta["use_parish_logo"] = use_parish_logo
    meta["inherit_parish_social_media"] = inherit_parish_social_media
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
        return _special_logo_url(group_id, active.get(S.SPECIAL_LOGO_ID_COL) or active.get("id")) if active else None

    target = active or (entries[-1] if entries else None)
    if not target:
        return None
    return _special_logo_url(group_id, target.get(S.SPECIAL_LOGO_ID_COL) or target.get("id"))


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
            for k in ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
            if str(person.get(k) or "").strip()
        ).strip()
        if not full_name:
            full_name = " ".join(
                str(person.get(k) or "").strip()
                for k in ("ar_first_name", "ar_last_name")
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
    pyg = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))
    if pyg.empty or S.YOUTH_GROUP_ID_COL not in pyg.columns:
        return []

    rows = pyg[pyg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)].copy()
    if rows.empty or "person_id" not in rows.columns:
        return []

    persons = S.unregistered_persons_view_df()
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
            for k in ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
            if str(person.get(k) or "").strip()
        ).strip()
        if not full_name:
            full_name = " ".join(
                str(person.get(k) or "").strip()
                for k in ("ar_first_name", "ar_last_name")
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
    from core.routes_org_tree import _load_index

    periods = _load_index(group_id)
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
        schools_df = S._scd_filter_active(S.unreg_store.get("schools", pd.DataFrame()))

    if schools_df.empty or "person_id" not in schools_df.columns:
        return {}

    out = {}
    for row in schools_df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        school = _normalize_text(row.get(S.SCHOOL_NAME_COL) or row.get("school"))
        if not pid or not school:
            continue
        out.setdefault(pid, []).append(school)
    return out


def _pids_with_data(person_type: str, sheet: str, value_col: str) -> set[str]:
    if person_type == "registered":
        df = S._sheet_for_registered(sheet)
    else:
        df = S._scd_filter_active(S.unreg_store.get(sheet, pd.DataFrame()))
    if df.empty or "person_id" not in df.columns:
        return set()
    out = set()
    for row in df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        if pid and _normalize_text(str(row.get(value_col) or "")):
            out.add(pid)
    return out


def _pids_with_valid_address(person_type: str) -> set[str]:
    if person_type == "registered":
        df = S._sheet_for_registered("addresses")
    else:
        df = S._scd_filter_active(S.unreg_store.get("addresses", pd.DataFrame()))
    if df.empty or "person_id" not in df.columns:
        return set()
    out = set()
    for row in df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        if (pid and _normalize_text(str(row.get("country") or ""))
                and _normalize_text(str(row.get("governorate") or ""))):
            out.add(pid)
    return out


def _pids_with_higher_edu(person_type: str) -> set[str]:
    if person_type == "registered":
        df = S._sheet_for_registered("higher_education")
    else:
        df = S._scd_filter_active(S.unreg_store.get("higher_education", pd.DataFrame()))
    if df.empty or "person_id" not in df.columns:
        return set()
    out = set()
    for row in df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        if pid and pid not in out:
            if (_normalize_text(str(row.get("university_college") or ""))
                    and _normalize_text(str(row.get("major") or ""))
                    and _normalize_text(str(row.get("degree") or ""))):
                out.add(pid)
    return out


def _pids_with_job(person_type: str) -> set[str]:
    if person_type == "registered":
        df = S._sheet_for_registered("jobs")
    else:
        df = S._scd_filter_active(S.unreg_store.get("jobs", pd.DataFrame()))
    if df.empty or "person_id" not in df.columns:
        return set()
    out = set()
    for row in df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        if pid and pid not in out:
            if (_normalize_text(str(row.get("company") or ""))
                    and _normalize_text(str(row.get("job_title") or ""))):
                out.add(pid)
    return out


def _pids_with_school_grade(person_type: str) -> set[str]:
    if person_type == "registered":
        schools_df = S._sheet_for_registered("schools")
        grades_df = S._sheet_for_registered("school_grades")
    else:
        schools_df = S._scd_filter_active(S.unreg_store.get("schools", pd.DataFrame()))
        grades_df = S._scd_filter_active(S.unreg_store.get("school_grades", pd.DataFrame()))
    if schools_df.empty or "person_id" not in schools_df.columns:
        return set()
    if grades_df.empty or "school_record_id" not in grades_df.columns:
        return set()
    grade_rids = set(grades_df["school_record_id"].dropna().astype(str).tolist())
    out = set()
    for row in schools_df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        rid = str(row.get("school_record_id") or "").strip()
        if pid and rid and rid in grade_rids:
            out.add(pid)
    return out


def _person_rows_by_key(person_type: str) -> dict[str, dict]:
    if person_type == "registered":
        persons_df = S._registered_persons_df().copy()
    else:
        persons_df = S.unregistered_persons_view_df().copy()

    if persons_df.empty or "person_id" not in persons_df.columns:
        return {}

    out = {}
    for row in persons_df.replace({pd.NA: None}).to_dict(orient="records"):
        pid = _pid_key(row.get("person_id"))
        if pid:
            out[pid] = row
    return out


def _member_problem_issues(member: dict, person_row: dict | None, profile_data: dict) -> list[str]:
    issues = []
    person = person_row or {}

    missing_name_parts = [
        label
        for key, label in (
            ("ar_first_name", "الاسم الأول"),
            ("ar_second_name", "اسم الأب"),
            ("ar_third_name", "اسم الجد"),
            ("ar_last_name", "اسم العائلة"),
        )
        if not _normalize_text(person.get(key))
    ]
    if missing_name_parts:
        issues.append(f"أجزاء الاسم ناقصة: {', '.join(missing_name_parts)}")

    if not _normalize_text(str(person.get("gender") or "")):
        issues.append("الجنس مفقود")

    dob_missing = [lbl for field, lbl in [("birth_year", "السنة"), ("birth_month", "الشهر"), ("birth_day", "اليوم")] if not person.get(field)]
    if dob_missing:
        issues.append(f"تاريخ الميلاد ناقص ({', '.join(dob_missing)})")

    if not _normalize_text(str(person.get("marital_status") or "")):
        issues.append("الحالة الاجتماعية مفقودة")

    if not profile_data.get("has_nationality"):
        issues.append("الجنسية مفقودة")

    if not profile_data.get("has_phone"):
        issues.append("رقم الهاتف مفقود")

    if not profile_data.get("has_address"):
        issues.append("العنوان مفقود")

    if not _normalize_text(str(member.get("youth_join_year") or "")):
        issues.append("سنة الانتساب مفقودة")

    age_group = _normalize_text(member.get("age_group"))
    if age_group in YOUTH_AGE_GROUPS_SCHOOL:
        school_graduated = _normalize_text(str(person.get("school_graduated") or ""))
        if not school_graduated:
            issues.append("الحالة الدراسية مفقودة")
        elif school_graduated == SCHOOL_STATUS_STUDYING and not profile_data.get("has_school_with_grade"):
            issues.append("المدرسة أو الصف الدراسي مفقود")

    if not profile_data.get("has_hobby"):
        issues.append("الهوايات والمهارات مفقودة")

    if age_group in YOUTH_AGE_GROUPS_HIGHER_EDU:
        if not _bool_field(person.get("no_higher_education")) and not profile_data.get("has_higher_edu"):
            issues.append("التعليم الجامعي مفقود")
        if not _bool_field(person.get("not_employed")) and not profile_data.get("has_job"):
            issues.append("معلومات العمل مفقودة")

    return issues


def register_youth_group_routes(app):
    if _ensure_youth_group_social_media_storage():
        S.db.save_excel_sheets(S.store)

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
                "group_name": opt.get("label") or S.youth_group_display_label(gid),
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

        reg_profile = {
            "nationalities": _pids_with_data("registered", "nationality", "nationality"),
            "phones":        _pids_with_data("registered", "mobile_numbers", "mobile_number"),
            "addresses":     _pids_with_valid_address("registered"),
            "hobbies":       _pids_with_data("registered", "hobbies_skills", "hobby_skill"),
            "higher_edu":    _pids_with_higher_edu("registered"),
            "jobs":          _pids_with_job("registered"),
            "school_grades": _pids_with_school_grade("registered"),
        }
        unreg_profile = {
            "nationalities": _pids_with_data("unregistered", "nationality", "nationality"),
            "phones":        _pids_with_data("unregistered", "mobile_numbers", "mobile_number"),
            "addresses":     _pids_with_valid_address("unregistered"),
            "hobbies":       _pids_with_data("unregistered", "hobbies_skills", "hobby_skill"),
            "higher_edu":    _pids_with_higher_edu("unregistered"),
            "jobs":          _pids_with_job("unregistered"),
            "school_grades": _pids_with_school_grade("unregistered"),
        }

        problematic_members = []
        for member in all_members:
            pid = _pid_key(member.get("person_id"))
            if not pid:
                continue
            person_type = member.get("person_type")
            lookup = reg_profile if person_type == "registered" else unreg_profile
            if person_type == "registered":
                person_row = reg_person_by_key.get(pid)
            else:
                person_row = unreg_person_by_key.get(pid)
            profile_data = {
                "has_nationality":      pid in lookup["nationalities"],
                "has_phone":            pid in lookup["phones"],
                "has_address":          pid in lookup["addresses"],
                "has_hobby":            pid in lookup["hobbies"],
                "has_higher_edu":       pid in lookup["higher_edu"],
                "has_job":              pid in lookup["jobs"],
                "has_school_with_grade": pid in lookup["school_grades"],
            }

            issues = _member_problem_issues(member, person_row, profile_data)
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

        promo_rules = promo_exports["_load_promotion_rules"]()
        default_rules = promo_exports["_default_promotion_age_rules"]()
        group_rules = promo_exports["_group_promotion_rules"](promo_rules, group_id)

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

        promo_rules = promo_exports["_load_promotion_rules"]()
        if not isinstance(promo_rules.get("group_age_rules"), dict):
            promo_rules["group_age_rules"] = {}
        promo_rules["group_age_rules"][group_id] = normalized
        promo_exports["_save_promotion_rules"](promo_rules)

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
            changed_by = _changed_by_from_current_user()
            yg = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame()).copy())
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
            S._scd_replace_rows_by_key(
                S.store,
                S.YOUTH_GROUP_SHEET,
                yg.replace({pd.NA: None}).to_dict(orient="records"),
                [
                    S.YOUTH_GROUP_ID_COL,
                    S.YOUTH_GROUP_PATRON_COL,
                    S.YOUTH_GROUP_SHORT_NAME_COL,
                    S.YOUTH_GROUP_PARISH_ID_COL,
                    S.YOUTH_GROUP_USE_PARISH_LOGO_COL,
                    S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL,
                ],
                [S.YOUTH_GROUP_ID_COL],
                changed_by=changed_by,
            )
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
            changed_by = _changed_by_from_current_user()
            yg = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame()).copy())
            if yg.empty or S.YOUTH_GROUP_ID_COL not in yg.columns:
                return jsonify({"error": "not found"}), 404

            if S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL not in yg.columns:
                yg[S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL] = False

            mask = yg[S.YOUTH_GROUP_ID_COL].astype(str) == str(group_id)
            if not mask.any():
                return jsonify({"error": "not found"}), 404

            yg.loc[mask, S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL] = inherit_parish_social_media
            S._scd_replace_rows_by_key(
                S.store,
                S.YOUTH_GROUP_SHEET,
                yg.replace({pd.NA: None}).to_dict(orient="records"),
                [
                    S.YOUTH_GROUP_ID_COL,
                    S.YOUTH_GROUP_PATRON_COL,
                    S.YOUTH_GROUP_SHORT_NAME_COL,
                    S.YOUTH_GROUP_PARISH_ID_COL,
                    S.YOUTH_GROUP_USE_PARISH_LOGO_COL,
                    S.YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL,
                ],
                [S.YOUTH_GROUP_ID_COL],
                changed_by=changed_by,
            )
            _save_group_social_media(group_id, normalized_rows, changed_by=changed_by)
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
            S.SPECIAL_LOGO_ID_COL: logo_id,
            "occasion": occasion,
            "start_date": start_date,
            "end_date": end_date,
            "is_active": is_active,
            "logo_file_name": dest_name,
        }
        entries.append(new_entry)
        _save_group_special_logos(group_id, entries, changed_by=_changed_by_from_current_user())

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
            target_id = special_logo_id or _normalize_text(entries[-1].get(S.SPECIAL_LOGO_ID_COL) or entries[-1].get("id"))
            found = False
            for item in entries:
                is_target = _normalize_text(item.get(S.SPECIAL_LOGO_ID_COL) or item.get("id")) == target_id
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
                    if _normalize_text(item.get(S.SPECIAL_LOGO_ID_COL) or item.get("id")) == special_logo_id:
                        item["is_active"] = False
                        found = True
                if not found:
                    return jsonify({"error": "invalid special_logo_id"}), 400
            else:
                for item in entries:
                    item["is_active"] = False

        _save_group_special_logos(group_id, entries, changed_by=_changed_by_from_current_user())

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
            logo_name = _normalize_text(entry.get("logo_file_name") or entry.get("file_name"))
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
            if _normalize_text(item.get(S.SPECIAL_LOGO_ID_COL) or item.get("id")) != lid:
                continue
            logo_name = _normalize_text(item.get("logo_file_name") or item.get("file_name"))
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
            logo_name = _normalize_text(active_entry.get("logo_file_name") or active_entry.get("file_name"))
            if logo_name:
                return send_from_directory(YOUTH_GROUP_SPECIAL_LOGOS_DIR, logo_name)
        return jsonify({"error": "not found"}), 404
