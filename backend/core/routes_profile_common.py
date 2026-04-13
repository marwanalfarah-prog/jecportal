import pandas as pd
from flask import jsonify

from core import state as S
from core.routes_auth import _current_user, _get_council_access, _get_person_youth_groups


def normalize_profile_rows(sheet, rows):
    if sheet == S.ADDRESS_SHEET:
        return S.normalize_address_rows(rows)
    if sheet == S.NATIONALITY_SHEET:
        return S.normalize_nationality_rows(rows)
    if sheet == S.RESPONSIBILITY_SHEET:
        return S.normalize_responsibility_rows(rows)
    if sheet == S.PERSON_YOUTH_GROUP_SHEET:
        return S.normalize_person_youth_group_rows(rows)
    if sheet == S.HIGHER_EDUCATION_SHEET:
        return S.normalize_higher_education_rows(rows)
    if sheet == S.SOCIAL_MEDIA_SHEET:
        return S.normalize_social_media_rows(rows)
    if sheet == S.PERSON_HEALTH_CONDITION_SHEET:
        return S.normalize_person_health_condition_rows(rows)
    if sheet == S.PERSON_SPECIAL_NOTE_SHEET:
        return S.normalize_person_special_note_rows(rows)
    return rows


def normalize_membership_rows(rows):
    out = []
    for row in rows:
        normalized = dict(row)
        archived = normalized.get("archived")
        normalized["archived"] = bool(archived) if archived is not None and str(archived) not in ("nan", "None", "") else False
        out.append(normalized)
    return out


def _group_ids_from_rows(rows: list[dict], normalizer) -> set[str]:
    normalized_rows = normalizer(rows)
    return {
        str(row.get(S.YOUTH_GROUP_ID_COL)).strip()
        for row in normalized_rows
        if str(row.get(S.YOUTH_GROUP_ID_COL) or "").strip()
    }


def _person_group_ids_for_sheet(store: dict, pid, sheet: str, *, compare_as_string: bool) -> set[str]:
    df = store.get(sheet, pd.DataFrame())
    if df.empty or "person_id" not in df.columns or S.YOUTH_GROUP_ID_COL not in df.columns:
        return set()

    if compare_as_string:
        rows = df[df["person_id"].astype(str) == str(pid)]
    else:
        rows = df[df["person_id"] == pid]

    return {
        str(value).strip()
        for value in rows[S.YOUTH_GROUP_ID_COL].dropna().astype(str)
        if str(value).strip()
    }


def validate_responsibility_membership_groups(
    store: dict,
    pid,
    responsibility_rows,
    *,
    compare_as_string: bool,
    membership_rows=None,
) -> list[str]:
    allowed_group_ids = (
        _group_ids_from_rows(membership_rows, S.normalize_person_youth_group_rows)
        if membership_rows is not None
        else _person_group_ids_for_sheet(store, pid, S.PERSON_YOUTH_GROUP_SHEET, compare_as_string=compare_as_string)
    )

    # Preserve already-saved legacy values so unrelated profile edits do not fail.
    allowed_group_ids |= _person_group_ids_for_sheet(
        store,
        pid,
        S.RESPONSIBILITY_SHEET,
        compare_as_string=compare_as_string,
    )

    invalid_group_ids = {
        str(row.get(S.YOUTH_GROUP_ID_COL)).strip()
        for row in S.normalize_responsibility_rows(responsibility_rows)
        if str(row.get(S.YOUTH_GROUP_ID_COL) or "").strip()
        and str(row.get(S.YOUTH_GROUP_ID_COL)).strip() not in allowed_group_ids
    }
    return sorted(invalid_group_ids)


def get_profile_sub_rows(store: dict, pid, sheet, *, compare_as_string: bool):
    if sheet == S.SCHOOL_SHEET:
        return S.school_rows_for_person(store, pid)
    if sheet == S.MOBILE_NUMBER_SHEET:
        return S.mobile_number_rows_for_person(store, pid)
    if sheet == S.EMAIL_SHEET:
        return S.email_rows_for_person(store, pid)
    if sheet == S.JOB_SHEET:
        return S.job_rows_for_person(store, pid)

    df = store.get(sheet, pd.DataFrame())
    if df.empty or "person_id" not in df.columns:
        return []

    if compare_as_string:
        rows = S.df_to_json(df[df["person_id"].astype(str) == str(pid)])
    else:
        rows = S.df_to_json(df[df["person_id"] == pid])

    if sheet == "person_youth_group":
        history_df = store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame())
        payload_rows = S.get_person_youth_group_payload_rows(
            S.build_person_youth_group_payload_rows(pd.DataFrame(rows), history_df),
            pid,
        )
        return normalize_membership_rows(payload_rows)
    if sheet == "nationality":
        return S.enrich_nationality_rows(rows, store)
    return normalize_profile_rows(sheet, rows)


def build_profile_record(
    persons_df: pd.DataFrame,
    store: dict,
    pid,
    *,
    compare_as_string: bool,
    photo_path_getter,
    photo_url_template: str,
):
    if persons_df.empty or "person_id" not in persons_df.columns:
        return None

    if compare_as_string:
        row = persons_df[persons_df["person_id"].astype(str) == str(pid)]
    else:
        row = persons_df[persons_df["person_id"] == pid]
    if row.empty:
        return None

    person_data = S.df_to_json(
        S._project_primary_addresses(row, store.get("addresses", pd.DataFrame()))
    )[0]
    _, ext = photo_path_getter(pid)
    return {
        "person": person_data,
        "avatar_initial": S.avatar_initial_from_person(person_data),
        "photo": photo_url_template.format(pid=pid) if ext else None,
        "timestamps": get_profile_sub_rows(store, pid, "timestamps", compare_as_string=compare_as_string),
        "nationality": get_profile_sub_rows(store, pid, "nationality", compare_as_string=compare_as_string),
        "mobile_numbers": get_profile_sub_rows(store, pid, "mobile_numbers", compare_as_string=compare_as_string),
        "emails": get_profile_sub_rows(store, pid, "emails", compare_as_string=compare_as_string),
        "social_media": get_profile_sub_rows(store, pid, "social_media", compare_as_string=compare_as_string),
        "addresses": get_profile_sub_rows(store, pid, "addresses", compare_as_string=compare_as_string),
        "schools": get_profile_sub_rows(store, pid, "schools", compare_as_string=compare_as_string),
        "higher_education": get_profile_sub_rows(store, pid, "higher_education", compare_as_string=compare_as_string),
        "jobs": get_profile_sub_rows(store, pid, "jobs", compare_as_string=compare_as_string),
        "responsibilities": get_profile_sub_rows(store, pid, "responsibilities", compare_as_string=compare_as_string),
        "person_youth_group": get_profile_sub_rows(store, pid, "person_youth_group", compare_as_string=compare_as_string),
        "hobbies_skills": get_profile_sub_rows(store, pid, "hobbies_skills", compare_as_string=compare_as_string),
        "person_health_conditions": get_profile_sub_rows(store, pid, S.PERSON_HEALTH_CONDITION_SHEET, compare_as_string=compare_as_string),
        "person_special_notes": get_profile_sub_rows(store, pid, S.PERSON_SPECIAL_NOTE_SHEET, compare_as_string=compare_as_string),
    }


def replace_profile_sub_rows(store: dict, pid, sheet, rows, *, compare_as_string: bool):
    if sheet == S.SCHOOL_SHEET:
        S.replace_school_rows(store, pid, rows)
        return
    if sheet == S.MOBILE_NUMBER_SHEET:
        S.replace_mobile_number_rows(store, pid, rows)
        return
    if sheet == S.EMAIL_SHEET:
        S.replace_email_rows(store, pid, rows)
        return
    if sheet == S.JOB_SHEET:
        S.replace_job_rows(store, pid, rows)
        return

    if sheet == S.PERSON_YOUTH_GROUP_SHEET:
        membership_rows = S.normalize_person_youth_group_rows(rows)
        history_rows = S.person_youth_group_age_history_rows_from_membership_rows(rows, membership_rows)

        df = store.get(sheet, pd.DataFrame())
        if "person_id" in df.columns:
            if compare_as_string:
                df = df[df["person_id"].astype(str) != str(pid)]
            else:
                df = df[df["person_id"] != pid]
        if membership_rows:
            new_df = pd.DataFrame(membership_rows)
            new_df["person_id"] = pid
            if df.empty:
                df = new_df.reset_index(drop=True)
            else:
                df = pd.concat([df, new_df], ignore_index=True)
        store[sheet] = df

        history_df = store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame())
        if S.PERSON_YOUTH_GROUP_RECORD_ID_COL in history_df.columns:
            record_ids = {row.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL) for row in membership_rows if row.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL)}
            history_df = history_df[~history_df[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin({str(value) for value in record_ids})]
        if history_rows:
            new_history_df = pd.DataFrame(history_rows)
            if history_df.empty:
                history_df = new_history_df.reset_index(drop=True)
            else:
                history_df = pd.concat([history_df, new_history_df], ignore_index=True)
        store[S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET] = history_df
        return

    rows = normalize_profile_rows(sheet, rows)
    df = store.get(sheet, pd.DataFrame())
    if "person_id" in df.columns:
        if compare_as_string:
            df = df[df["person_id"].astype(str) != str(pid)]
        else:
            df = df[df["person_id"] != pid]
    if rows:
        new_df = pd.DataFrame(rows)
        if "person_id" not in new_df.columns:
            new_df.insert(0, "person_id", pid)
        else:
            new_df["person_id"] = pid
        if df.empty:
            df = new_df.reset_index(drop=True)
        else:
            df = pd.concat([df, new_df], ignore_index=True)
    store[sheet] = df


def profile_edit_scope(person_type: str, pid):
    user = _current_user()
    if not user:
        return None
    if user.get("role") == "admin":
        return "full"
    if (
        user.get("role") == "member"
        and user.get("person_type") == person_type
        and str(user.get("person_id")) == str(pid)
    ):
        return "full"
    return None


def _profile_group_ids(person_type: str, pid) -> set[str]:
    groups: set[str] = set()
    if person_type not in {"registered", "unregistered"}:
        return groups

    store = S.store if person_type == "registered" else S.unreg_store
    compare_as_string = person_type == "unregistered"

    for sheet in ("person_youth_group", "responsibilities"):
        df = store.get(sheet, pd.DataFrame())
        if df.empty or "person_id" not in df.columns or S.YOUTH_GROUP_ID_COL not in df.columns:
            continue

        if compare_as_string:
            rows = df[df["person_id"].astype(str) == str(pid)]
        else:
            rows = df[df["person_id"] == pid]

        for value in rows[S.YOUTH_GROUP_ID_COL].dropna().astype(str):
            group_id = value.strip()
            if group_id:
                groups.add(group_id)

    return groups


def profile_view_scope(person_type: str, pid):
    user = _current_user()
    if not user:
        return None

    if user.get("role") == "admin":
        return "full"

    if user.get("person_type") == person_type and str(user.get("person_id")) == str(pid):
        return "self"

    if user.get("role") != "member":
        return None

    youth_groups = _get_person_youth_groups(user.get("person_type"), user.get("person_id"))
    council_access = _get_council_access(user.get("person_type"), user.get("person_id"), youth_groups)
    accessible_group_ids = {str(group_id).strip() for group_id in council_access.keys() if str(group_id).strip()}
    if not accessible_group_ids:
        return None

    if accessible_group_ids & _profile_group_ids(person_type, pid):
        return "scoped"

    return None


def require_profile_view_access(person_type: str, pid):
    user = _current_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    if not profile_view_scope(person_type, pid):
        return jsonify({"error": "forbidden"}), 403
    return None


def build_location_only_address_rows(store: dict, pid, incoming_rows, *, compare_as_string: bool):
    source_rows = incoming_rows if isinstance(incoming_rows, list) else []
    incoming = source_rows[0] if source_rows else {}
    location_url = str(incoming.get("location_url") or "").strip()
    lat = S._normalize_coordinate(incoming.get("lat"), "lat")
    lng = S._normalize_coordinate(incoming.get("lng"), "lng")

    if location_url and (lat is None or lng is None):
        lat, lng = S.resolve_google_maps_coordinates(location_url)
    if location_url and (lat is None or lng is None):
        raise ValueError("coordinates not found")
    if not location_url:
        lat = None
        lng = None

    addresses_df = store.get("addresses", pd.DataFrame())
    if addresses_df.empty or "person_id" not in addresses_df.columns:
        existing_rows = []
    elif compare_as_string:
        existing_rows = S.df_to_json(addresses_df[addresses_df["person_id"].astype(str) == str(pid)])
    else:
        existing_rows = S.df_to_json(addresses_df[addresses_df["person_id"] == pid])

    if existing_rows:
        primary_index = next((index for index, row in enumerate(existing_rows) if S._to_bool(row.get("is_primary"))), 0)
        normalized_rows = [dict(row) for row in existing_rows]
        normalized_rows[primary_index]["location_url"] = location_url or None
        normalized_rows[primary_index]["lat"] = lat
        normalized_rows[primary_index]["lng"] = lng
        return normalized_rows

    return [{
        "country": S.DEFAULT_COUNTRY,
        "governorate": None,
        "city": None,
        "address": None,
        "location_url": location_url or None,
        "lat": lat,
        "lng": lng,
        "is_primary": True,
    }]