import os
import re
from datetime import date
from urllib.parse import urlparse

import numpy as np
import pandas as pd
from flask import jsonify, request, send_from_directory

from core import state as S
from core.database import SCD_LOGICAL_SHEETS as _SCD_LOGICAL_SHEETS
from core.database import logical_sheet_name as _logical_sheet_name
from core.routes_auth import (
    _current_user,
    _deactivate_auth_users_for_person,
    _get_council_access,
    _get_person_youth_groups,
    _require_admin,
    _require_auth,
)


_MISSING = object()
_ADMIN_ONLY_AGE_GROUPS = {"مرشد روحيّ"}

_ARABIC_CHAR_CLASS = "\u0621-\u064A\u066E-\u066F\u0671-\u06D3\u06FA-\u06FF\u064B-\u065F"
_ARABIC_TEXT_RE = re.compile(rf"^[{_ARABIC_CHAR_CLASS}]+(?:[ -][{_ARABIC_CHAR_CLASS}]+)*$")
_ARABIC_SPACE_TEXT_RE = re.compile(rf"^[{_ARABIC_CHAR_CLASS}]+(?: [{_ARABIC_CHAR_CLASS}]+)*$")
_ENGLISH_TEXT_RE = re.compile(r"^[A-Za-z]+(?:[ -][A-Za-z]+)*$")
_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)
_PHONE_RE = re.compile(r"^\+?\d{7,15}$")
_DATE_TEXT_RE = re.compile(r"^\d{4}-\d{1,2}-\d{1,2}$")
_ARABIC_LETTER_RE = re.compile(rf"[{_ARABIC_CHAR_CLASS}]")
_ENGLISH_LETTER_RE = re.compile(r"[A-Za-z]")
_ADDRESS_ALLOWED_PUNCTUATION = {" ", "-", "/", ".", ",", "،", "#", "(", ")"}
_ARABIC_INDIC_DIGITS = set("٠١٢٣٤٥٦٧٨٩")
_NAME_FIELD_LABELS = {
    "ar_first_name": "الاسم الأول بالعربية",
    "ar_second_name": "الاسم الثاني بالعربية",
    "ar_third_name": "الاسم الثالث بالعربية",
    "ar_last_name": "اسم العائلة بالعربية",
    "en_first_name": "الاسم الأول بالإنجليزية",
    "en_second_name": "الاسم الثاني بالإنجليزية",
    "en_third_name": "الاسم الثالث بالإنجليزية",
    "en_last_name": "اسم العائلة بالإنجليزية",
    "mother_ar_first_name": "اسم الأم الأول بالعربية",
    "mother_ar_second_name": "اسم الأم الثاني بالعربية",
    "mother_ar_last_name": "اسم الأم الأخير بالعربية",
    "mother_en_first_name": "اسم الأم الأول بالإنجليزية",
    "mother_en_second_name": "اسم الأم الثاني بالإنجليزية",
    "mother_en_last_name": "اسم الأم الأخير بالإنجليزية",
}
_ADDRESS_FIELD_LABELS = {
    "country": "الدولة",
    "governorate": "المحافظة / الولاية",
    "city": "المدينة",
    "address": "العنوان التفصيلي",
}
_DATE_FIELD_LABELS = {
    "start_date": "تاريخ البداية",
    "end_date": "تاريخ النهاية",
}


def _validation_error_response(errors: list[str]):
    return jsonify({"error": errors[0], "errors": errors}), 400


def _changed_by_from_current_user() -> str:
    user = _current_user()
    if not user:
        return "system"
    if user.get("role") == "admin":
        return "admin"
    return str(user.get("person_id", "system"))


def _normalize_integer_value(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else S._normalize_text(value)
    text = S._normalize_text(value)
    if not text:
        return None
    return int(text) if re.fullmatch(r"[+-]?\d+", text) else text


def _normalize_gender_value(value):
    text = S._normalize_text(value)
    if not text:
        return None
    simplified = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    if simplified == "ذكر":
        return "ذكر"
    if simplified == "انثى":
        return "أنثى"
    return text


def _normalize_profile_person_fields(person_fields: dict) -> dict:
    normalized = {}
    for key, value in (person_fields or {}).items():
        if key == "gender":
            normalized[key] = _normalize_gender_value(value)
            continue
        if key == "birth_year":
            normalized[key] = _normalize_integer_value(value)
            continue
        if isinstance(value, str):
            normalized[key] = S._normalize_text(value)
            continue
        normalized[key] = value
    return normalized


def _strip_person_projection_fields(person_fields: dict) -> dict:
    cleaned = dict(person_fields or {})
    for key in S.PERSON_ADDRESS_PROJECTION_COLUMNS:
        cleaned.pop(key, None)
    return cleaned


def _populate_arabic_name_from_full_name(person_fields: dict, raw_name) -> dict:
    if person_fields.get("ar_first_name"):
        return person_fields
    full_name = S._normalize_text(raw_name)
    if not full_name:
        return person_fields

    parts = full_name.split(" ")
    updated = dict(person_fields)
    if len(parts) == 1:
        updated["ar_first_name"] = parts[0]
        updated["ar_last_name"] = ""
    elif len(parts) == 2:
        updated["ar_first_name"] = parts[0]
        updated["ar_last_name"] = parts[1]
    elif len(parts) == 3:
        updated["ar_first_name"] = parts[0]
        updated["ar_second_name"] = parts[1]
        updated["ar_last_name"] = parts[2]
    elif len(parts) >= 4:
        updated["ar_first_name"] = parts[0]
        updated["ar_second_name"] = parts[1]
        updated["ar_third_name"] = parts[2]
        updated["ar_last_name"] = " ".join(parts[3:])
    return updated


def _has_value(value) -> bool:
    return S._normalize_text(value) is not None if isinstance(value, str) else value not in (None, "")


def _parse_int_strict(value):
    normalized = _normalize_integer_value(value)
    return normalized if isinstance(normalized, int) else None


def _is_valid_date_text(value) -> bool:
    text = S._normalize_text(value)
    if not text or not _DATE_TEXT_RE.fullmatch(text):
        return False
    year_text, month_text, day_text = text.split("-")
    try:
        date(int(year_text), int(month_text), int(day_text))
    except ValueError:
        return False
    return True


def _is_valid_numeric_text(value) -> bool:
    text = S._normalize_text(value)
    if not text:
        return True
    try:
        float(text)
    except (TypeError, ValueError):
        return False
    return True


def _validate_script_field(value, label: str, pattern, errors: list[str]):
    text = S._normalize_text(value)
    if not text:
        return
    if not pattern.fullmatch(text):
        errors.append(f"{label} يجب أن يحتوي الحروف المسموح بها فقط، مع السماح بمسافة أو شرطة داخل الجزء الواحد.")


def _validate_birth_date(raw_person: dict, person_fields: dict, errors: list[str]):
    raw_person = raw_person or {}
    provided = any(
        key in raw_person and _has_value(raw_person.get(key))
        for key in ("birth_year", "birth_month", "birth_day", "birth_date")
    ) or any(person_fields.get(key) not in (None, "") for key in ("birth_year", "birth_month", "birth_day"))
    if not provided:
        return

    year = _parse_int_strict(raw_person.get("birth_year", person_fields.get("birth_year")))
    month = _parse_int_strict(raw_person.get("birth_month", person_fields.get("birth_month")))
    day = _parse_int_strict(raw_person.get("birth_day", person_fields.get("birth_day")))
    if year is None or month is None or day is None:
        errors.append("تاريخ الميلاد يجب أن يحتوي السنة والشهر واليوم وأن يكون تاريخًا صالحًا.")
        return
    try:
        date(year, month, day)
    except ValueError:
        errors.append("تاريخ الميلاد غير صالح.")


def _validate_gender(value, errors: list[str]):
    if value is None:
        return
    if value not in {"ذكر", "أنثى"}:
        errors.append("الجنس يجب أن يكون ذكر أو أنثى فقط.")


def _validate_numeric_field(value, label: str, errors: list[str]):
    if not _has_value(value):
        return
    if not _is_valid_numeric_text(value):
        errors.append(f"{label} يجب أن يكون رقمًا صحيحًا أو عشريًا.")


def _validate_row_date_fields(rows, section_label: str, errors: list[str]):
    for index, row in enumerate(rows or [], start=1):
        if not isinstance(row, dict):
            continue
        for key, value in row.items():
            if key.endswith("_date") and _has_value(value) and not _is_valid_date_text(value):
                field_label = _DATE_FIELD_LABELS.get(key, key)
                errors.append(f"{section_label} #{index}: {field_label} يجب أن يكون تاريخًا صالحًا.")


def _is_arabic_or_english_address_text(value) -> bool:
    text = S._normalize_text(value)
    if not text:
        return True

    has_letter = False
    for char in text:
        if _ARABIC_LETTER_RE.fullmatch(char) or _ENGLISH_LETTER_RE.fullmatch(char):
            has_letter = True
            continue
        if char.isdigit() or char in _ARABIC_INDIC_DIGITS or char in _ADDRESS_ALLOWED_PUNCTUATION:
            continue
        return False
    return has_letter


def _is_valid_social_url(value) -> bool:
    text = S._normalize_text(value)
    if not text or any(char.isspace() for char in text):
        return False if text else True
    candidate = text if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", text) else f"https://{text}"
    parsed = urlparse(candidate)
    hostname = parsed.hostname or ""
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc) and "." in hostname


def collect_profile_validation_errors(body: dict, person_fields: dict, *, addresses_rows=None) -> list[str]:
    errors: list[str] = []
    raw_person = body.get("person") or {}

    for field_name in S.PERSON_NAME_COLS + S.MOTHER_NAME_COLS:
        _validate_script_field(person_fields.get(field_name), _NAME_FIELD_LABELS[field_name], _ARABIC_TEXT_RE, errors)
    for field_name in S.PERSON_ENGLISH_NAME_COLS + S.MOTHER_ENGLISH_NAME_COLS:
        _validate_script_field(person_fields.get(field_name), _NAME_FIELD_LABELS[field_name], _ENGLISH_TEXT_RE, errors)

    if "gender" in raw_person or person_fields.get("gender") is not None:
        _validate_gender(person_fields.get("gender"), errors)
    _validate_birth_date(raw_person, person_fields, errors)
    if "school_final_gpa" in raw_person:
        _validate_numeric_field(raw_person.get("school_final_gpa"), "المعدل المدرسي", errors)

    for index, row in enumerate(body.get("nationality", []) or [], start=1):
        if not isinstance(row, dict):
            continue
        _validate_script_field(row.get("nationality"), f"الجنسية #{index}", _ARABIC_SPACE_TEXT_RE, errors)

    for index, row in enumerate(body.get("mobile_numbers", []) or [], start=1):
        if not isinstance(row, dict):
            continue
        mobile_number = S._normalize_text(row.get("mobile_number"))
        if mobile_number and not _PHONE_RE.fullmatch(mobile_number):
            errors.append(f"رقم الهاتف #{index} غير صالح. استخدم أرقامًا فقط بدون مسافات أو حروف، ويمكن البدء بالرمز +.")

    for index, row in enumerate(body.get("emails", []) or [], start=1):
        if not isinstance(row, dict):
            continue
        email = S._normalize_text(row.get("email"))
        if email and not _EMAIL_RE.fullmatch(email):
            errors.append(f"البريد الإلكتروني #{index} غير صالح.")

    for index, row in enumerate(body.get("social_media", []) or [], start=1):
        if not isinstance(row, dict):
            continue
        url = S._normalize_text(row.get("url"))
        if url and not _is_valid_social_url(url):
            errors.append(f"رابط التواصل الاجتماعي #{index} غير صالح.")

    for index, row in enumerate(addresses_rows or [], start=1):
        if not isinstance(row, dict):
            continue
        for field_name, label in _ADDRESS_FIELD_LABELS.items():
            value = row.get(field_name)
            if value is None and field_name == "address":
                value = row.get(S.STREET_ADDRESS_COL)
            if _has_value(value) and not _is_arabic_or_english_address_text(value):
                errors.append(f"العنوان #{index}: {label} يجب أن يكون بالعربية أو بالإنجليزية فقط دون خلط بين اللغتين.")

    _validate_row_date_fields(body.get("schools", []), "المدرسة", errors)
    _validate_row_date_fields(body.get("higher_education", []), "التعليم الجامعي", errors)
    _validate_row_date_fields(body.get("jobs", []), "الوظائف", errors)
    _validate_row_date_fields(body.get("responsibilities", []), "المسؤوليات", errors)
    for index, row in enumerate(body.get("higher_education", []) or [], start=1):
        if not isinstance(row, dict):
            continue
        _validate_numeric_field(row.get("final_gpa"), f"المعدل الجامعي #{index}", errors)

    seen_membership_groups: set[str] = set()
    for index, row in enumerate(body.get("person_youth_group", []) or [], start=1):
        if not isinstance(row, dict):
            continue
        youth_group_id = S._normalize_text(row.get(S.YOUTH_GROUP_ID_COL))
        if youth_group_id:
            if youth_group_id in seen_membership_groups:
                errors.append("لا يمكن اختيار نفس الشبيبة أكثر من مرة داخل العضويات.")
            seen_membership_groups.add(youth_group_id)

        history_counts: dict[str, int] = {}
        for history_index, history_row in enumerate(row.get("age_group_history") or [], start=1):
            if not isinstance(history_row, dict):
                continue
            age_group = S._normalize_text(history_row.get("age_group"))
            if age_group:
                history_counts[age_group] = history_counts.get(age_group, 0) + 1
                if history_counts[age_group] > 1:
                    has_any_date = bool(
                        S._normalize_text(history_row.get("start_date"))
                        or S._normalize_text(history_row.get("end_date"))
                    )
                    if not has_any_date:
                        errors.append(
                            f"تكرار الفئة العمرية '{age_group}' داخل الشبيبة #{index} يتطلب تحديد تاريخ بداية أو نهاية لكل تكرار إضافي."
                        )

            for key in ("start_date", "end_date"):
                if _has_value(history_row.get(key)) and not _is_valid_date_text(history_row.get(key)):
                    field_label = _DATE_FIELD_LABELS.get(key, key)
                    errors.append(
                        f"سجل الفئة العمرية #{history_index} داخل الشبيبة #{index}: {field_label} يجب أن يكون تاريخًا صالحًا."
                    )

    return errors


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


def _seed_current_membership_rows(membership_rows, *, youth_group_id: str | None) -> list[dict]:
    base_rows = [dict(row) for row in (membership_rows or []) if isinstance(row, dict)]
    target_group_id = S.youth_group_id(youth_group_id) or S._normalize_text(youth_group_id)
    if not target_group_id or not S._is_group_id(target_group_id):
        return base_rows

    found = False
    for row in base_rows:
        group_id = S.youth_group_id(row.get(S.YOUTH_GROUP_ID_COL)) or S._normalize_text(row.get(S.YOUTH_GROUP_ID_COL))
        if group_id != target_group_id:
            continue
        row[S.YOUTH_GROUP_ID_COL] = target_group_id
        row["archived"] = False
        found = True

    if found:
        return base_rows

    base_rows.append({
        S.YOUTH_GROUP_ID_COL: target_group_id,
        "archived": False,
    })
    return base_rows


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

    # Only expose currently-active SCD rows; inactive rows are historical audit records
    if sheet in _SCD_LOGICAL_SHEETS:
        df = S._scd_filter_active(df)

    if compare_as_string:
        rows = S.df_to_json(df[df["person_id"].astype(str) == str(pid)])
    else:
        rows = S.df_to_json(df[df["person_id"] == pid])

    _scd_cols = set(S.SCD_METADATA_COLUMNS)
    rows = [{k: v for k, v in row.items() if k not in _scd_cols} for row in rows]

    if sheet == "person_youth_group":
        history_df = S._scd_filter_active(store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()))
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

    _scd_cols = set(S.SCD_METADATA_COLUMNS)
    person_data = {
        k: v for k, v in S.df_to_json(
            S._project_primary_addresses(row, store.get("addresses", pd.DataFrame()))
        )[0].items()
        if k not in _scd_cols
    }
    _, ext = photo_path_getter(pid)
    return {
        "person": person_data,
        "avatar_initial": S.avatar_initial_from_person(person_data),
        "photo": photo_url_template.format(pid=pid) if ext else None,
        "timestamps": [],
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


def prepare_profile_person_payload(raw_person, *, addresses_rows=_MISSING, infer_addresses_from_payload: bool = False):
    source = raw_person or {}
    person_fields = _normalize_profile_person_fields(S.normalize_person_birth_fields(source))
    title_in_payload = "title" in source
    person_title = person_fields.pop("title", None)
    school_system_sector_in_payload = "school_system_sector" in source
    school_system_sector = person_fields.pop("school_system_sector", None)

    resolved_addresses = None if addresses_rows is _MISSING else addresses_rows
    if infer_addresses_from_payload and resolved_addresses is None:
        inferred_addresses = S.address_rows_from_embedded_payload(source)
        if inferred_addresses:
            resolved_addresses = inferred_addresses

    person_fields = _strip_person_projection_fields(person_fields)

    return person_fields, {
        "title_in_payload": title_in_payload,
        "person_title": person_title,
        "school_system_sector_in_payload": school_system_sector_in_payload,
        "school_system_sector": school_system_sector,
        "addresses_rows": resolved_addresses,
    }


def apply_profile_person_relationship_flags(body: dict, person_fields: dict) -> dict:
    payload = body if isinstance(body, dict) else {}

    school_rows = payload.get("schools", []) or []
    has_current_school = any(
        isinstance(row, dict) and S._to_bool(row.get("is_current"))
        for row in school_rows
    )
    school_status = S.normalize_school_status(
        person_fields.get(S.SCHOOL_STATUS_COL),
        has_current_school=has_current_school,
    )
    person_fields[S.SCHOOL_STATUS_COL] = school_status
    if school_status == S.SCHOOL_STATUS_STUDYING and not has_current_school and school_rows:
        normalized_school_rows = []
        made_current = False
        for row in school_rows:
            if not isinstance(row, dict):
                continue
            next_row = dict(row)
            next_row["is_current"] = not made_current
            if next_row["is_current"]:
                next_row["end_date"] = None
                made_current = True
            normalized_school_rows.append(next_row)
        payload["schools"] = normalized_school_rows
    elif school_status != S.SCHOOL_STATUS_STUDYING:
        normalized_school_rows = []
        for row in school_rows:
            if not isinstance(row, dict):
                continue
            next_row = dict(row)
            next_row["is_current"] = False
            normalized_school_rows.append(next_row)
        payload["schools"] = normalized_school_rows

    higher_rows = payload.get("higher_education", []) or []
    if S.normalize_higher_education_rows(higher_rows):
        person_fields[S.NO_HIGHER_EDUCATION_COL] = False
    elif S._to_bool(person_fields.get(S.NO_HIGHER_EDUCATION_COL)):
        payload["higher_education"] = []
        person_fields[S.NO_HIGHER_EDUCATION_COL] = True
    else:
        person_fields[S.NO_HIGHER_EDUCATION_COL] = False

    job_rows = payload.get("jobs", []) or []
    normalized_job_rows, _ = S.normalize_job_rows(job_rows)
    if normalized_job_rows:
        person_fields[S.NOT_EMPLOYED_COL] = False
    elif S._to_bool(person_fields.get(S.NOT_EMPLOYED_COL)):
        payload["jobs"] = []
        person_fields[S.NOT_EMPLOYED_COL] = True
    else:
        person_fields[S.NOT_EMPLOYED_COL] = False

    return payload


def prepare_profile_job_contact_rows(store: dict, pid, *, job_rows, mobile_rows, email_rows):
    prepared_job_rows, job_id_map = S.prepare_job_rows_for_person(store, pid, job_rows)
    mobile_rows_payload = None if mobile_rows is None else S.remap_job_links_in_mobile_rows(mobile_rows, job_id_map)
    email_rows_payload = None if email_rows is None else S.prepare_email_rows_for_person(
        store,
        pid,
        S.remap_job_links_in_email_rows(email_rows, job_id_map),
    )
    return prepared_job_rows, mobile_rows_payload, email_rows_payload


def _request_youth_group_ids(body: dict | None) -> list[str]:
    payload = body or {}
    raw_values = payload.get("youth_group_ids")
    if not isinstance(raw_values, list):
        raw_values = [payload.get("youth_group_id")]

    seen: set[str] = set()
    group_ids: list[str] = []
    for raw_value in raw_values:
        group_id = S.youth_group_id(raw_value) or S._normalize_text(raw_value)
        if not group_id or group_id in seen:
            continue
        seen.add(group_id)
        group_ids.append(group_id)
    return group_ids


def replace_profile_sub_rows(store: dict, pid, sheet, rows, *, compare_as_string: bool, changed_by: str = "system"):
    if sheet == S.SCHOOL_SHEET:
        S.replace_school_rows(store, pid, rows, changed_by=changed_by)
        return
    if sheet == S.MOBILE_NUMBER_SHEET:
        S.replace_mobile_number_rows(store, pid, rows, changed_by=changed_by)
        return
    if sheet == S.EMAIL_SHEET:
        S.replace_email_rows(store, pid, rows, changed_by=changed_by)
        return
    if sheet == S.JOB_SHEET:
        S.replace_job_rows(store, pid, rows, changed_by=changed_by)
        return

    if sheet == S.PERSON_YOUTH_GROUP_SHEET:
        membership_rows = S.normalize_person_youth_group_rows(rows)
        history_rows = S.person_youth_group_age_history_rows_from_membership_rows(rows, membership_rows)

        # Early return if nothing changed
        pid_key = str(pid)
        existing_memberships = S._scd_active_rows(
            store.get(sheet, pd.DataFrame()), "person_id", pid_key)
        existing_approval_by_record_id = {}
        for existing_row in existing_memberships:
            record_id = S._normalize_person_youth_group_record_id(
                existing_row.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL)
            )
            if record_id:
                existing_approval_by_record_id[record_id] = {
                    col: existing_row.get(col)
                    for col in S.PERSON_YOUTH_GROUP_APPROVAL_COLUMNS
                    if col in existing_row
                }
        for membership_row in membership_rows:
            record_id = S._normalize_person_youth_group_record_id(
                membership_row.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL)
            )
            existing_approval = existing_approval_by_record_id.get(record_id or "")
            if not existing_approval:
                continue
            for col, existing_value in existing_approval.items():
                if (
                    S._scd_val_for_compare(membership_row.get(col)) == ""
                    and S._scd_val_for_compare(existing_value) != ""
                ):
                    membership_row[col] = existing_value
        existing_pyg_rids = {
            str(r.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL))
            for r in existing_memberships
            if r.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL)
        }
        pyg_cols = [c for c in store.get(sheet, pd.DataFrame()).columns if c not in S.SCD_METADATA_COLUMNS]
        incoming_with_pid = [{**row, "person_id": pid} for row in membership_rows]
        if S._scd_rows_equal(existing_memberships, incoming_with_pid, pyg_cols or list(S.PERSON_YOUTH_GROUP_COLUMNS)):
            existing_hist = S._scd_active_satellite_rows(
                store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()),
                S.PERSON_YOUTH_GROUP_RECORD_ID_COL, existing_pyg_rids)
            hist_cols = [c for c in store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()).columns if c not in S.SCD_METADATA_COLUMNS]
            if S._scd_rows_equal(existing_hist, history_rows, hist_cols or [S.PERSON_YOUTH_GROUP_RECORD_ID_COL, "age_group", "start_date", "end_date"]):
                return

        now = S._scd_timestamp()
        new_scd = S._scd_new_metadata(changed_by)

        df = S._scd_ensure_columns(store.get(sheet, pd.DataFrame()))
        deactivate_record_ids: set[str] = set()
        if "person_id" in df.columns:
            if compare_as_string:
                person_mask = df["person_id"].astype(str) == str(pid)
            else:
                person_mask = df["person_id"] == pid
            active_mask = person_mask & S._scd_active_mask(df)
            if S.PERSON_YOUTH_GROUP_RECORD_ID_COL in df.columns:
                deactivate_record_ids = set(df.loc[active_mask, S.PERSON_YOUTH_GROUP_RECORD_ID_COL].dropna().astype(str))
            if active_mask.any():
                df.loc[active_mask, S.SCD_ACTIVE_TO_COL] = now
                df.loc[active_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                df.loc[active_mask, S.SCD_CHANGED_BY_USER_COL] = changed_by
        if membership_rows:
            new_df = pd.DataFrame([{**row, "person_id": pid, **new_scd} for row in membership_rows])
            df = pd.concat([df, new_df], ignore_index=True) if not df.empty else new_df.reset_index(drop=True)
        store[sheet] = df

        history_df = S._scd_ensure_columns(store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()))
        if S.PERSON_YOUTH_GROUP_RECORD_ID_COL in history_df.columns and deactivate_record_ids:
            hist_active_mask = (
                history_df[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin(deactivate_record_ids)
                & S._scd_active_mask(history_df)
            )
            if hist_active_mask.any():
                history_df.loc[hist_active_mask, S.SCD_ACTIVE_TO_COL] = now
                history_df.loc[hist_active_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                history_df.loc[hist_active_mask, S.SCD_CHANGED_BY_USER_COL] = changed_by
        if history_rows:
            new_history_df = pd.DataFrame([{**row, **new_scd} for row in history_rows])
            history_df = pd.concat([history_df, new_history_df], ignore_index=True) if not history_df.empty else new_history_df.reset_index(drop=True)
        store[S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET] = history_df
        return

    rows = normalize_profile_rows(sheet, rows)
    if sheet in _SCD_LOGICAL_SHEETS:
        df = S._scd_ensure_columns(store.get(sheet, pd.DataFrame()))

        # Early return if nothing changed
        pid_str = str(pid)
        existing = S._scd_active_rows(df, "person_id", pid_str)
        biz_cols = [c for c in df.columns if c not in S.SCD_METADATA_COLUMNS]
        rows_with_pid = [{**row, "person_id": pid} for row in rows]
        if S._scd_rows_equal(existing, rows_with_pid, biz_cols):
            return

        if "person_id" in df.columns:
            if compare_as_string:
                active_mask = (df["person_id"].astype(str) == str(pid)) & S._scd_active_mask(df)
            else:
                active_mask = (df["person_id"] == pid) & S._scd_active_mask(df)
            if active_mask.any():
                now = S._scd_timestamp()
                df.loc[active_mask, S.SCD_ACTIVE_TO_COL] = now
                df.loc[active_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                df.loc[active_mask, S.SCD_CHANGED_BY_USER_COL] = changed_by
        if rows:
            new_scd = S._scd_new_metadata(changed_by)
            new_df = pd.DataFrame([{**row, **new_scd} for row in rows])
            if "person_id" not in new_df.columns:
                new_df.insert(0, "person_id", pid)
            else:
                new_df["person_id"] = pid
            df = pd.concat([df, new_df], ignore_index=True) if not df.empty else new_df.reset_index(drop=True)
        store[sheet] = df
    else:
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
            df = pd.concat([df, new_df], ignore_index=True) if not df.empty else new_df.reset_index(drop=True)
        store[sheet] = df


def replace_profile_sub_rows_batch(
    store: dict,
    pid,
    sheet_rows_map: dict,
    *,
    compare_as_string: bool,
    changed_by: str = "system",
    sheet_order=None,
    include_empty: bool = True,
):
    if sheet_order is None:
        items = sheet_rows_map.items()
    else:
        items = ((sheet, sheet_rows_map[sheet]) for sheet in sheet_order if sheet in sheet_rows_map)

    for sheet, rows in items:
        if rows is None:
            continue
        if not include_empty and not rows:
            continue
        replace_profile_sub_rows(store, pid, sheet, rows, compare_as_string=compare_as_string, changed_by=changed_by)


def remove_profile_rows_by_person_id(
    store: dict,
    pid,
    *,
    compare_as_string: bool,
    sheet_names,
    changed_by: str = "system",
    remove_membership_history: bool = False,
):
    record_ids = set()
    if remove_membership_history:
        membership_df = store.get(S.PERSON_YOUTH_GROUP_SHEET, pd.DataFrame())
        if (
            not membership_df.empty
            and "person_id" in membership_df.columns
            and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in membership_df.columns
        ):
            if compare_as_string:
                matches = membership_df[membership_df["person_id"].astype(str) == str(pid)]
            else:
                matches = membership_df[membership_df["person_id"] == pid]
            record_ids = {
                str(value).strip()
                for value in matches[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].dropna().astype(str).tolist()
                if str(value).strip()
            }

    now = S._scd_timestamp()
    for sheet in sheet_names:
        df = store.get(sheet, pd.DataFrame())
        if sheet in _SCD_LOGICAL_SHEETS:
            df = S._scd_ensure_columns(df)
            if (
                sheet == S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET
                and not df.empty
                and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in df.columns
            ):
                if record_ids:
                    hist_mask = (
                        df[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin(record_ids)
                        & S._scd_active_mask(df)
                    )
                    if hist_mask.any():
                        df.loc[hist_mask, S.SCD_ACTIVE_TO_COL] = now
                        df.loc[hist_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                        df.loc[hist_mask, S.SCD_CHANGED_BY_USER_COL] = changed_by
                    store[sheet] = df
                continue
            if df.empty or "person_id" not in df.columns:
                continue
            if compare_as_string:
                active_mask = (df["person_id"].astype(str) == str(pid)) & S._scd_active_mask(df)
            else:
                active_mask = (df["person_id"] == pid) & S._scd_active_mask(df)
            if active_mask.any():
                df.loc[active_mask, S.SCD_ACTIVE_TO_COL] = now
                df.loc[active_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                df.loc[active_mask, S.SCD_CHANGED_BY_USER_COL] = changed_by
                store[sheet] = df
        else:
            if (
                sheet == S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET
                and not df.empty
                and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in df.columns
            ):
                if record_ids:
                    store[sheet] = df[
                        ~df[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin(record_ids)
                    ].reset_index(drop=True)
                continue
            if df.empty or "person_id" not in df.columns:
                continue
            if compare_as_string:
                store[sheet] = df[df["person_id"].astype(str) != str(pid)].reset_index(drop=True)
            else:
                store[sheet] = df[df["person_id"] != pid].reset_index(drop=True)


def remove_profile_photo_files(pid):
    for ext in S.ALLOWED_EXTENSIONS:
        path = os.path.join(S.PROFILE_PHOTOS_DIR, f"{pid}.{ext}")
        if os.path.exists(path):
            os.remove(path)


def handle_profile_photo_upload(pid, file, *, photo_url: str, after_save=None):
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in S.ALLOWED_EXTENSIONS:
        return jsonify({"error": "unsupported file type"}), 400

    remove_profile_photo_files(pid)
    dest = os.path.join(S.PROFILE_PHOTOS_DIR, f"{pid}.{ext}")
    file.save(dest)
    if after_save:
        after_save()
    return jsonify({"ok": True, "photo": photo_url})


def update_profile_membership_archive_state(
    store: dict,
    persons_df: pd.DataFrame,
    pid,
    youth_group_ids: list[str],
    *,
    compare_as_string: bool,
    archived: bool,
    save_callback,
):
    if persons_df.empty or "person_id" not in persons_df.columns:
        return jsonify({"error": "not found"}), 404

    if compare_as_string:
        person_rows = persons_df[persons_df["person_id"].astype(str) == str(pid)]
    else:
        person_rows = persons_df[persons_df["person_id"] == pid]
    if person_rows.empty:
        return jsonify({"error": "not found"}), 404

    memberships_df = S._scd_ensure_columns(store.get(S.PERSON_YOUTH_GROUP_SHEET, pd.DataFrame()).copy())
    if memberships_df.empty or "person_id" not in memberships_df.columns or S.YOUTH_GROUP_ID_COL not in memberships_df.columns:
        return jsonify({"error": "membership not found"}), 404

    # Only touch currently-active SCD rows
    scd_active_mask = S._scd_active_mask(memberships_df)
    combined_mask = pd.Series(False, index=memberships_df.index)
    for youth_group_id in youth_group_ids:
        if compare_as_string:
            mask = (
                (memberships_df["person_id"].astype(str) == str(pid))
                & (memberships_df[S.YOUTH_GROUP_ID_COL].astype(str) == youth_group_id)
                & scd_active_mask
            )
        else:
            mask = (
                (memberships_df["person_id"] == pid)
                & (memberships_df[S.YOUTH_GROUP_ID_COL].astype(str) == youth_group_id)
                & scd_active_mask
            )
        if not mask.any():
            return jsonify({"error": "membership not found"}), 404
        combined_mask = combined_mask | mask

    # SCD deactivate matching active rows, then insert new rows with updated archived flag
    now = S._scd_timestamp()
    changed_by = _changed_by_from_current_user() or "system"
    new_scd = S._scd_new_metadata(changed_by)
    active_rows = memberships_df[combined_mask].to_dict(orient="records")
    memberships_df.loc[combined_mask, S.SCD_ACTIVE_TO_COL] = now
    memberships_df.loc[combined_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
    memberships_df.loc[combined_mask, S.SCD_CHANGED_BY_USER_COL] = changed_by
    new_rows = []
    for row in active_rows:
        new_row = {k: v for k, v in row.items() if k not in S.SCD_METADATA_COLUMNS}
        new_row["archived"] = archived
        new_row.update(new_scd)
        new_rows.append(new_row)
    store[S.PERSON_YOUTH_GROUP_SHEET] = pd.concat(
        [memberships_df, pd.DataFrame(new_rows)], ignore_index=True
    )
    if save_callback:
        save_callback()
    return None


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
        return "self"
    if user.get("role") == "member":
        youth_groups = _get_person_youth_groups(user.get("person_type"), user.get("person_id"))
        council_access = _get_council_access(user.get("person_type"), user.get("person_id"), youth_groups)
        accessible_group_ids = {str(gid).strip() for gid in council_access.keys() if str(gid).strip()}
        if accessible_group_ids & _profile_group_ids(person_type, pid):
            return "council"
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


def _get_user_council_group_ids(user) -> set[str]:
    if not user or user.get("role") != "member":
        return set()
    youth_groups = _get_person_youth_groups(user.get("person_type"), user.get("person_id"))
    council_access = _get_council_access(user.get("person_type"), user.get("person_id"), youth_groups)
    return {str(gid).strip() for gid in council_access.keys() if str(gid).strip()}


def _apply_address_location_restriction(incoming_addresses, store, pid, compare_as_string: bool) -> list:
    """prv2: strip lat/lng from incoming address rows, restore from stored rows by position."""
    if not incoming_addresses:
        return list(incoming_addresses or [])
    addr_df = S._scd_filter_active(store.get(S.ADDRESS_SHEET, pd.DataFrame()))
    if not addr_df.empty and "person_id" in addr_df.columns:
        if compare_as_string:
            mask = addr_df["person_id"].astype(str) == str(pid)
        else:
            mask = addr_df["person_id"] == pid
        stored_rows = addr_df[mask].replace({pd.NA: None}).to_dict(orient="records")
    else:
        stored_rows = []
    result = []
    for i, row in enumerate(incoming_addresses):
        row = dict(row)
        for field in ("lat", "lng", "location_url"):
            row.pop(field, None)
        if i < len(stored_rows):
            for field in ("lat", "lng"):
                val = stored_rows[i].get(field)
                if val is not None:
                    row[field] = val
        result.append(row)
    return result


def _validate_membership_scope(body, store, pid, scope, council_group_ids, compare_as_string: bool):
    """
    Validates and adjusts person_youth_group in body for 'council' or 'self' scope.
    Returns (modified_body, errors).
    - council: other-group rows preserved from store; editable group rows validated
    - self: all groups validated with same rules except archived direction
    """
    errors = []

    pyg_df = S._scd_filter_active(store.get(S.PERSON_YOUTH_GROUP_SHEET, pd.DataFrame()))
    hist_df = S._scd_filter_active(store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()))

    if not pyg_df.empty and "person_id" in pyg_df.columns:
        pmask = (
            pyg_df["person_id"].astype(str) == str(pid)
            if compare_as_string
            else pyg_df["person_id"] == pid
        )
        existing_rows = pyg_df[pmask].replace({pd.NA: None}).to_dict(orient="records")
    else:
        existing_rows = []

    existing_record_ids = {
        str(r.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL, "") or "")
        for r in existing_rows
        if r.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL)
    }
    history_by_record: dict[str, list[dict]] = {}
    if not hist_df.empty and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in hist_df.columns:
        for hr in hist_df[
            hist_df[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin(existing_record_ids)
        ].replace({pd.NA: None}).to_dict(orient="records"):
            rid = str(hr.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL, "") or "")
            history_by_record.setdefault(rid, []).append({
                "age_group": hr.get("age_group"),
                "start_date": hr.get("start_date"),
                "end_date": hr.get("end_date"),
            })

    existing_by_group: dict[str, dict] = {}
    for row in existing_rows:
        gid = str(row.get(S.YOUTH_GROUP_ID_COL, "") or "").strip()
        if gid:
            existing_by_group[gid] = row

    incoming_pyg = list(body.get("person_youth_group") or [])
    incoming_by_group: dict[str, dict] = {}
    for row in incoming_pyg:
        gid = str(row.get(S.YOUTH_GROUP_ID_COL, "") or "").strip()
        if gid:
            incoming_by_group[gid] = row

    editable_groups = council_group_ids if scope == "council" else set(existing_by_group.keys())

    # Cannot add a new membership
    new_groups = set(incoming_by_group.keys()) - set(existing_by_group.keys())
    if new_groups:
        return body, ["لا يمكن إضافة عضوية جديدة في شبيبة."]

    # Cannot remove an existing editable membership
    for gid in editable_groups:
        if gid in existing_by_group and gid not in incoming_by_group:
            return body, ["لا يمكن حذف عضوية الشخص في الشبيبة."]

    final_rows: list[dict] = []

    # Preserve non-editable groups exactly as stored (council scope only)
    for gid, ex_row in existing_by_group.items():
        if gid in editable_groups:
            continue
        rid = str(ex_row.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL, "") or "")
        row_copy = dict(ex_row)
        row_copy["age_group_history"] = list(history_by_record.get(rid, []))
        final_rows.append(row_copy)

    # Validate and add editable groups
    for gid, inc_row in incoming_by_group.items():
        if gid not in editable_groups or gid not in existing_by_group:
            continue
        ex_row = existing_by_group[gid]
        rid = str(ex_row.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL, "") or "")
        existing_hist = history_by_record.get(rid, [])
        existing_ag_set = {h.get("age_group") for h in existing_hist if h.get("age_group")}

        current_ag = S.current_age_group_from_history_rows(existing_hist) or ex_row.get("age_group")
        current_ag_idx = S.AGE_GROUP_ORDER_INDEX.get(current_ag, -1) if current_ag else -1

        # Archived direction: prv3 (self) can only go active→inactive
        existing_archived = bool(ex_row.get("archived", False))
        incoming_archived = bool(inc_row.get("archived", False))
        if scope == "self" and existing_archived and not incoming_archived:
            return body, ["لا يمكنك إعادة تفعيل العضوية في الشبيبة."]

        # Validate new age group history entries
        incoming_hist = list(inc_row.get("age_group_history") or [])
        incoming_ag_set = {h.get("age_group") for h in incoming_hist if isinstance(h, dict) and h.get("age_group")}
        for h in incoming_hist:
            if not isinstance(h, dict):
                continue
            ag = h.get("age_group")
            if not ag or ag in existing_ag_set:
                continue
            if ag in _ADMIN_ONLY_AGE_GROUPS:
                return body, [f"لا يمكنك تعيين '{ag}' — يختص بالمدير فقط."]
            ag_idx = S.AGE_GROUP_ORDER_INDEX.get(ag, -1)
            if ag_idx == -1:
                return body, [f"فئة العمر '{ag}' غير معروفة."]
            if current_ag_idx != -1 and ag_idx <= current_ag_idx:
                return body, [f"لا يمكن إضافة فئة ({ag}) أكبر من أو تساوي الفئة الحالية ({current_ag})."]

        # Preserve any existing history entries that were omitted
        for existing_h in existing_hist:
            ag = existing_h.get("age_group")
            if ag and ag not in incoming_ag_set:
                incoming_hist.append(dict(existing_h))

        validated_row = dict(inc_row)
        validated_row[S.PERSON_YOUTH_GROUP_RECORD_ID_COL] = rid
        validated_row["age_group_history"] = incoming_hist
        validated_row["archived"] = incoming_archived
        final_rows.append(validated_row)

    modified_body = dict(body)
    modified_body["person_youth_group"] = final_rows
    return modified_body, []


def _filter_responsibilities_for_council(body, store, pid, council_group_ids, compare_as_string: bool) -> dict:
    """prv2: preserve non-council responsibility rows from store; only allow incoming rows for council groups."""
    resp_df = S._scd_filter_active(store.get("responsibilities", pd.DataFrame()))
    if not resp_df.empty and "person_id" in resp_df.columns:
        pmask = (
            resp_df["person_id"].astype(str) == str(pid)
            if compare_as_string
            else resp_df["person_id"] == pid
        )
        existing_resp = resp_df[pmask].replace({pd.NA: None}).to_dict(orient="records")
    else:
        existing_resp = []

    preserved = [
        r for r in existing_resp
        if str(r.get(S.YOUTH_GROUP_ID_COL, "") or "").strip() not in council_group_ids
    ]
    incoming_resp = list(body.get("responsibilities") or [])
    council_resp = [
        r for r in incoming_resp
        if str(r.get(S.YOUTH_GROUP_ID_COL, "") or "").strip() in council_group_ids
    ]
    modified = dict(body)
    modified["responsibilities"] = preserved + council_resp
    return modified


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


def _person_full_name(person: dict | None) -> str:
    payload = person if isinstance(person, dict) else {}
    parts = [
        payload.get("title"),
        payload.get("ar_first_name"),
        payload.get("ar_second_name"),
        payload.get("ar_third_name"),
        payload.get("ar_last_name"),
    ]
    return " ".join(str(part).strip() for part in parts if str(part or "").strip())


def _membership_rows_by_person(df: pd.DataFrame):
    lookup = {}
    if df is None or df.empty or "person_id" not in df.columns:
        return lookup

    for pid, grp in df.groupby("person_id", sort=False):
        entries = []
        for _, row in grp.iterrows():
            youth_group_id = S._normalize_text(row.get(S.YOUTH_GROUP_ID_COL))
            if not youth_group_id:
                continue
            archived = row.get("archived")
            if archived is not None and str(archived) not in ("nan", "None", "") and bool(archived):
                continue
            entries.append({
                "youth_group_id": youth_group_id,
                "age_group": S._normalize_text(row.get("age_group")) or "",
            })
        lookup[str(S._normalize_person_id(pid))] = entries
    return lookup


def _build_people_location_rows(persons_df: pd.DataFrame, addresses_df: pd.DataFrame, memberships_df: pd.DataFrame, person_type: str):
    if persons_df is None or persons_df.empty or "person_id" not in persons_df.columns:
        return []
    if addresses_df is None or addresses_df.empty or "person_id" not in addresses_df.columns:
        return []

    person_lookup = {}
    for person in persons_df.replace({np.nan: None}).to_dict(orient="records"):
        pid = str(S._normalize_person_id(person.get("person_id")))
        if pid:
            person_lookup[pid] = person

    memberships_lookup = _membership_rows_by_person(memberships_df)
    rows = []
    for index, address in enumerate(addresses_df.replace({np.nan: None}).to_dict(orient="records")):
        pid = str(S._normalize_person_id(address.get("person_id")))
        person = person_lookup.get(pid)
        if not pid or person is None:
            continue

        lat = S._normalize_coordinate(address.get("lat"), "lat")
        lng = S._normalize_coordinate(address.get("lng"), "lng")
        if lat is None or lng is None:
            continue

        memberships = memberships_lookup.get(pid, [])
        youth_groups = []
        age_groups = []
        for membership in memberships:
            youth_group_id = membership.get("youth_group_id")
            youth_group_name = S.youth_group_name(youth_group_id) or youth_group_id
            if youth_group_name and youth_group_name not in youth_groups:
                youth_groups.append(youth_group_name)
            age_group = membership.get("age_group")
            if age_group and age_group not in age_groups:
                age_groups.append(age_group)

        country = S._normalize_text(address.get("country")) or S.DEFAULT_COUNTRY
        governorate = S._normalize_text(address.get("governorate"))
        city = S._normalize_text(address.get("city"))
        full_address_line = S._normalize_text(address.get(S.STREET_ADDRESS_COL) or address.get("address"))

        rows.append({
            "location_key": f"{person_type}:{pid}:{index}",
            "person_id": person.get("person_id"),
            "person_type": person_type,
            "full_name": _person_full_name(person),
            "youth_groups": youth_groups,
            "age_groups": age_groups,
            "country": country,
            "governorate": governorate,
            "city": city,
            "address": full_address_line,
            "full_address": "، ".join(part for part in [country, governorate, city, full_address_line] if part),
            "lat": lat,
            "lng": lng,
            "is_primary": S._to_bool(address.get("is_primary")),
        })

    rows.sort(key=lambda item: (
        str(item.get("governorate") or ""),
        str(item.get("city") or ""),
        str(item.get("full_name") or ""),
        0 if item.get("is_primary") else 1,
    ))
    return rows


def _active_registered_person_ids() -> set[str]:
    persons = S._registered_persons_df()
    if persons.empty or "person_id" not in persons.columns:
        return set()

    pyg = S._sheet_for_registered("person_youth_group")
    if pyg.empty or "person_id" not in pyg.columns:
        return {str(S._normalize_person_id(pid)) for pid in persons["person_id"].dropna()}

    membership_person_ids: set[str] = set()
    active_person_ids: set[str] = set()
    for _, row in pyg.iterrows():
        person_id = S._normalize_person_id(row.get("person_id"))
        if person_id in (None, ""):
            continue
        person_key = str(person_id)
        membership_person_ids.add(person_key)

        archived = row.get("archived")
        if archived is not None and str(archived) not in ("nan", "None", "") and bool(archived):
            continue
        active_person_ids.add(person_key)

    registered_person_ids = {str(S._normalize_person_id(pid)) for pid in persons["person_id"].dropna()}
    no_membership_person_ids = registered_person_ids - membership_person_ids
    return active_person_ids | no_membership_person_ids


def _active_registered_persons_df() -> pd.DataFrame:
    persons = S._registered_persons_df()
    if persons.empty or "person_id" not in persons.columns:
        return persons

    active_person_ids = _active_registered_person_ids()
    if not active_person_ids:
        return persons.iloc[0:0].copy()
    return persons[persons["person_id"].astype(str).isin(active_person_ids)].copy()


def _filter_to_active_registered_people(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty or "person_id" not in df.columns:
        return df

    active_person_ids = _active_registered_person_ids()
    if not active_person_ids:
        return df.iloc[0:0].copy()
    return df[df["person_id"].astype(str).isin(active_person_ids)].copy()


def _active_registered_membership_df() -> pd.DataFrame:
    pyg = _filter_to_active_registered_people(S._sheet_for_registered("person_youth_group"))
    if pyg.empty:
        return pyg

    archived_series = pyg["archived"] if "archived" in pyg.columns else pd.Series(False, index=pyg.index)
    archived_mask = archived_series.apply(
        lambda value: value is not None and str(value) not in ("nan", "None", "") and bool(value)
    )
    return pyg[~archived_mask].copy()


def register_registered_routes(app):
    @app.get("/api/stats")
    def stats():
        persons = _active_registered_persons_df()
        pyg = _active_registered_membership_df()
        higher_education = _filter_to_active_registered_people(S._sheet_for_registered("higher_education"))
        jobs = _filter_to_active_registered_people(S._sheet_for_registered("jobs"))
        nationality = _filter_to_active_registered_people(S._sheet_for_registered("nationality"))
        yg_count = 0
        if not pyg.empty and S.YOUTH_GROUP_ID_COL in pyg.columns:
            yg_count = int(pyg[S.YOUTH_GROUP_ID_COL].dropna().astype(str).nunique())
        return jsonify({
            "total_members": int(len(persons)),
            "youth_groups": yg_count,
            "higher_ed": int(len(higher_education)),
            "employed": int(len(jobs)),
            "governorates": int(persons["governorate"].nunique()),
            "nationalities": int(nationality["nationality"].nunique()) if not nationality.empty and "nationality" in nationality.columns else 0,
        })

    @app.get("/api/chart/governorate")
    def chart_gov():
        data = _active_registered_persons_df()["governorate"].value_counts().reset_index()
        data.columns = ["label", "value"]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/gender")
    def chart_gender():
        data = _active_registered_persons_df()["gender"].value_counts().reset_index()
        data.columns = ["label", "value"]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/youth_group")
    def chart_yg():
        pyg = _active_registered_membership_df()
        if pyg.empty or S.YOUTH_GROUP_ID_COL not in pyg.columns:
            return jsonify([])
        data = (
            pyg[["person_id", S.YOUTH_GROUP_ID_COL]]
            .dropna(subset=[S.YOUTH_GROUP_ID_COL])
            .drop_duplicates()
            .groupby(S.YOUTH_GROUP_ID_COL)["person_id"].count()
            .sort_values(ascending=False)
            .head(15)
            .reset_index()
        )
        data.columns = ["group_id", "value"]
        data["label"] = data["group_id"].apply(lambda gid: S.youth_group_name(gid) or gid)
        data = data[["label", "value", "group_id"]]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/age_group")
    def chart_ag():
        data = _active_registered_membership_df()["age_group"].value_counts().reset_index()
        data.columns = ["label", "value"]
        return jsonify(S.df_to_json(data))

    @app.get("/api/persons/enriched")
    def get_persons_enriched():
        cached_payload, cached_version, data_version = S.cache_state()
        if cached_payload is not None and cached_version == data_version:
            return jsonify(cached_payload)
        payload = S.build_enriched()
        S.set_enriched_cache(payload, data_version)
        return jsonify(payload)

    @app.get("/api/persons/members-index")
    def get_persons_members_index():
        cached_payload, cached_version, data_version = S.members_index_cache_state()
        if cached_payload is not None and cached_version == data_version:
            return jsonify(cached_payload)
        payload = S.build_members_index()
        S.set_members_index_cache(payload, data_version)
        return jsonify(payload)

    @app.get("/api/filters")
    def filters():
        persons = S._registered_persons_df()
        pyg = S._sheet_for_registered("person_youth_group")
        resp = S._sheet_for_registered("responsibilities")
        nat = S._sheet_for_registered("nationality")
        sch = S._sheet_for_registered("schools")
        he = S._sheet_for_registered("higher_education")
        jobs = S._sheet_for_registered("jobs")
        hob = S._sheet_for_registered("hobbies_skills")

        youth_group_counts = []
        youth_group_count_map = {}
        if not pyg.empty and S.YOUTH_GROUP_ID_COL in pyg.columns:
            counts = (
                pyg[["person_id", S.YOUTH_GROUP_ID_COL]]
                .dropna(subset=[S.YOUTH_GROUP_ID_COL])
                .drop_duplicates()
                .groupby(S.YOUTH_GROUP_ID_COL)["person_id"].count()
            )
            youth_group_count_map = {
                str(gid): int(count)
                for gid, count in counts.items()
                if str(gid).strip()
            }

        seen_youth_group_ids = set()
        for option in S.youth_group_options():
            group_id = str(option.get("value") or "").strip()
            if not group_id:
                continue
            seen_youth_group_ids.add(group_id)
            youth_group_counts.append({
                "value": group_id,
                "label": S.youth_group_name(group_id) or str(option.get("label") or group_id),
                "count": youth_group_count_map.get(group_id, 0),
            })

        for group_id, count in youth_group_count_map.items():
            if group_id in seen_youth_group_ids:
                continue
            youth_group_counts.append({
                "value": group_id,
                "label": S.youth_group_name(group_id) or group_id,
                "count": count,
            })

        youth_group_counts.sort(key=lambda item: (-int(item.get("count") or 0), str(item.get("label") or item.get("value") or "")))

        return jsonify({
            "ar_first_name": S.value_counts_json(persons["ar_first_name"]),
            "ar_second_name": S.value_counts_json(persons["ar_second_name"]),
            "ar_third_name": S.value_counts_json(persons["ar_third_name"]),
            "ar_last_name": S.value_counts_json(persons["ar_last_name"]),
            "en_first_name": S.value_counts_json(persons["en_first_name"]),
            "en_second_name": S.value_counts_json(persons["en_second_name"]),
            "en_third_name": S.value_counts_json(persons["en_third_name"]),
            "en_last_name": S.value_counts_json(persons["en_last_name"]),
            "mother_ar_first_name": S.value_counts_json(persons["mother_ar_first_name"]),
            "mother_ar_second_name": S.value_counts_json(persons["mother_ar_second_name"]),
            "mother_ar_last_name": S.value_counts_json(persons["mother_ar_last_name"]),
            "mother_en_first_name": S.value_counts_json(persons["mother_en_first_name"]),
            "mother_en_second_name": S.value_counts_json(persons["mother_en_second_name"]),
            "mother_en_last_name": S.value_counts_json(persons["mother_en_last_name"]),
            "gender": S.value_counts_json(persons["gender"]),
            "school_system": S.value_counts_json(persons["school_system"]),
            "governorate": S.value_counts_json(persons["governorate"]),
            "birth_year": S.value_counts_json(persons["birth_year"].astype(str)),
            "nationality": S.pid_counts(nat, "nationality"),
            "youth_group": youth_group_counts,
            "age_group": S.pid_counts(pyg, "age_group"),
            "youth_join_year": S.pid_counts(pyg, "youth_join_year"),
            "responsibility": S.pid_counts(resp, "responsibility_name"),
            "school": S.pid_counts(sch, S.SCHOOL_NAME_COL),
            "university": S.pid_counts(he, S.HIGHER_EDUCATION_INSTITUTION_COL),
            "major": S.pid_counts(he, "major"),
            "degree": S.pid_counts(he, "degree"),
            "job_title": S.pid_counts(jobs, "job_title"),
            "company": S.pid_counts(jobs, S.EMPLOYER_NAME_COL),
            "hobby_skill": S.pid_counts(hob, "hobby_skill"),
        })

    @app.get("/api/nationality-iso-codes")
    def get_nationality_iso_codes():
        err = _require_auth()
        if err:
            return err
        lookup = S.nationality_iso_lookup()
        entries = [
            {
                "nationality": nationality,
                "iso_alpha2": payload.get("iso_alpha2"),
            }
            for nationality, payload in lookup.items()
            if nationality
        ]
        entries.sort(key=lambda item: str(item.get("nationality") or ""))
        return jsonify({"entries": entries})

    @app.get("/api/persons")
    def get_persons():
        df = S._registered_persons_df().copy().replace({np.nan: None})
        df["_avatar_initial"] = df.apply(lambda r: S.avatar_initial_from_person(r), axis=1)
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 50))
        total = len(df)
        df = df.iloc[(page - 1) * per_page: page * per_page]
        return jsonify({"total": total, "page": page, "per_page": per_page, "data": S.df_to_json(df)})

    @app.get("/api/person/<int:pid>")
    def get_person(pid):
        err = require_profile_view_access("registered", pid)
        if err:
            return err
        record = build_profile_record(
            S._registered_persons_df(),
            S.store,
            pid,
            compare_as_string=False,
            photo_path_getter=S.get_photo_path,
            photo_url_template="/api/person/{pid}/photo",
        )
        if not record:
            # Allow viewing pending-registration profiles for: the person themselves,
            # admins (who need to review before approving), and council members who
            # have access to at least one of the person's youth groups.
            viewer = _current_user()
            can_view_pending = False
            if viewer:
                if viewer.get("role") == "admin":
                    can_view_pending = True
                elif viewer.get("person_id") is not None and str(viewer.get("person_id")) == str(pid):
                    can_view_pending = True
                else:
                    # Council member: check if they have access to any of the person's pending YG memberships
                    pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
                    if not pyg.empty and "person_id" in pyg.columns:
                        person_yg_ids = set(
                            pyg[pyg["person_id"].astype(str) == str(pid)][S.YOUTH_GROUP_ID_COL]
                            .dropna().astype(str).tolist()
                        )
                        viewer_yg = _get_person_youth_groups(viewer.get("person_type"), viewer.get("person_id"))
                        council_access = _get_council_access(viewer.get("person_type"), viewer.get("person_id"), viewer_yg)
                        if person_yg_ids & set(council_access.keys()):
                            can_view_pending = True

            if can_view_pending:
                all_active = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
                record = build_profile_record(
                    all_active, S.store, pid,
                    compare_as_string=False,
                    photo_path_getter=S.get_photo_path,
                    photo_url_template="/api/person/{pid}/photo",
                )
            if not record:
                return jsonify({"error": "not found"}), 404
        return jsonify(record)

    @app.post("/api/person/<int:pid>/photo")
    def upload_photo(pid):
        if not profile_edit_scope("registered", pid):
            return jsonify({"error": "forbidden"}), 403
        if "photo" not in request.files:
            return jsonify({"error": "no file"}), 400
        file = request.files["photo"]
        return handle_profile_photo_upload(
            pid,
            file,
            photo_url=f"/api/person/{pid}/photo",
            after_save=S.invalidate_enriched_cache,
        )

    @app.get("/api/person/<int:pid>/photo")
    def serve_photo(pid):
        err = require_profile_view_access("registered", pid)
        if err:
            return err
        path, ext = S.get_photo_path(pid)
        if not path:
            return jsonify({"error": "not found"}), 404
        return send_from_directory(S.PROFILE_PHOTOS_DIR, f"{pid}.{ext}")

    @app.get("/api/table/<sheet>")
    def get_table(sheet):
        err = _require_admin()
        if err:
            return err
        sheet = _logical_sheet_name(sheet)
        if sheet not in S.store:
            return jsonify({"error": "not found"}), 404
        df = S.store[sheet]
        if sheet in _SCD_LOGICAL_SHEETS:
            df = S._scd_filter_active(df)
            df = df.drop(columns=[c for c in S.SCD_METADATA_COLUMNS if c in df.columns])
        return jsonify(S.df_to_json(df))

    @app.put("/api/table/<sheet>")
    def put_table(sheet):
        err = _require_admin()
        if err:
            return err
        sheet = _logical_sheet_name(sheet)
        if sheet not in S.store:
            return jsonify({"error": "not found"}), 404
        if sheet in _SCD_LOGICAL_SHEETS:
            return jsonify({"error": "SCD tables cannot be directly replaced; use the profile API to make changes"}), 403
        body = request.json
        with S.lock:
            S.store[sheet] = pd.DataFrame(body)
            S.save()
        return jsonify({"ok": True})

    @app.post("/api/location/resolve-google-maps")
    def resolve_google_maps_location():
        err = _require_auth()
        if err:
            return err
        body = request.json or {}
        raw_url = str(body.get("url") or "").strip()
        if not raw_url:
            return jsonify({"error": "url is required"}), 400
        try:
            lat, lng = S.resolve_google_maps_coordinates(raw_url)
        except Exception:
            return jsonify({"error": "failed to resolve location"}), 400
        if lat is None or lng is None:
            return jsonify({"error": "coordinates not found"}), 400
        return jsonify({"lat": lat, "lng": lng})

    @app.put("/api/person/<int:pid>")
    def update_person(pid):
        scope = profile_edit_scope("registered", pid)
        if not scope:
            return jsonify({"error": "unauthorized"}), 403

        body = request.json or {}
        if scope == "location_only":
            if set(body.keys()) - {"addresses"}:
                return jsonify({"error": "forbidden"}), 403
            try:
                addresses_rows = build_location_only_address_rows(S.store, pid, body.get("addresses"), compare_as_string=False)
            except ValueError:
                return jsonify({"error": "invalid google maps location"}), 400

            with S.lock:
                changed_by = _changed_by_from_current_user()
                replace_profile_sub_rows(S.store, pid, "addresses", addresses_rows, compare_as_string=False, changed_by=changed_by)
                S.save()
            return jsonify({"ok": True})

        with S.lock:
            if scope in ("council", "self"):
                user = _current_user()
                council_group_ids = _get_user_council_group_ids(user) if scope == "council" else set()
                body = dict(body)
                if "person" in body and "title" in (body.get("person") or {}):
                    body["person"] = {k: v for k, v in body["person"].items() if k != "title"}
                if scope == "council" and "addresses" in body:
                    body["addresses"] = _apply_address_location_restriction(
                        body.get("addresses"), S.store, pid, compare_as_string=False
                    )
                if "person_youth_group" in body:
                    body, membership_errors = _validate_membership_scope(
                        body, S.store, pid, scope, council_group_ids, compare_as_string=False
                    )
                    if membership_errors:
                        return _validation_error_response(membership_errors)
                if scope == "council" and "responsibilities" in body:
                    body = _filter_responsibilities_for_council(
                        body, S.store, pid, council_group_ids, compare_as_string=False
                    )

            raw_person = body.get("person", {})
            p, person_payload = prepare_profile_person_payload(
                raw_person,
                addresses_rows=body.get("addresses") if "addresses" in body else None,
                infer_addresses_from_payload=True,
            )
            body = apply_profile_person_relationship_flags(body, p)
            validation_errors = collect_profile_validation_errors(
                body,
                p,
                addresses_rows=person_payload["addresses_rows"],
            )
            invalid_responsibility_groups = validate_responsibility_membership_groups(
                S.store,
                pid,
                body.get("responsibilities", []),
                compare_as_string=False,
                membership_rows=body.get("person_youth_group", []),
            )
            if invalid_responsibility_groups:
                validation_errors.append(
                    "مسؤولية الشبيبة يجب أن تطابق إحدى عضويات الشخص في الشبيبة."
                )
            if validation_errors:
                return _validation_error_response(validation_errors)

            prepared_job_rows, mobile_rows_payload, email_rows_payload = prepare_profile_job_contact_rows(
                S.store,
                pid,
                job_rows=body.get("jobs", []),
                mobile_rows=body.get("mobile_numbers", []),
                email_rows=body.get("emails", []),
            )

            changed_by = _changed_by_from_current_user()
            all_persons = S._scd_ensure_columns(S.store["persons"].copy())
            person_mask = (
                (all_persons["person_id"] == pid)
                & S._scd_active_mask(all_persons)
            )
            if person_mask.any():
                now = S._scd_timestamp()
                current_row = all_persons[person_mask].iloc[0].to_dict()
                all_persons.loc[person_mask, S.SCD_ACTIVE_TO_COL] = now
                all_persons.loc[person_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                all_persons.loc[person_mask, S.SCD_CHANGED_BY_USER_COL] = changed_by
                new_row_data = {k: v for k, v in current_row.items() if k not in S.SCD_METADATA_COLUMNS}
                new_row_data.update(p)
                new_row_data.update(S._scd_new_metadata(changed_by))
                S.store["persons"] = pd.concat([all_persons, pd.DataFrame([new_row_data])], ignore_index=True)
                if person_payload["title_in_payload"]:
                    S.replace_person_title(S.store, pid, person_payload["person_title"], changed_by=changed_by)
                if person_payload["school_system_sector_in_payload"]:
                    S.replace_person_school_system_sector(S.store, pid, person_payload["school_system_sector"], changed_by=changed_by)

            payload_by_sheet = {
                "nationality": body.get("nationality", []),
                "jobs": prepared_job_rows,
                "mobile_numbers": mobile_rows_payload,
                "emails": email_rows_payload,
                "social_media": body.get("social_media", []),
                "schools": body.get("schools", []),
                "higher_education": body.get("higher_education", []),
                "responsibilities": body.get("responsibilities", []),
                "person_youth_group": body.get("person_youth_group", []),
                "hobbies_skills": body.get("hobbies_skills", []),
                S.PERSON_HEALTH_CONDITION_SHEET: body.get(S.PERSON_HEALTH_CONDITION_SHEET, []),
                S.PERSON_SPECIAL_NOTE_SHEET: body.get(S.PERSON_SPECIAL_NOTE_SHEET, []),
            }
            if person_payload["addresses_rows"] is not None:
                payload_by_sheet["addresses"] = person_payload["addresses_rows"]

            replace_profile_sub_rows_batch(
                S.store,
                pid,
                payload_by_sheet,
                compare_as_string=False,
                changed_by=changed_by,
                sheet_order=(
                    "nationality",
                    "jobs",
                    "mobile_numbers",
                    "emails",
                    "social_media",
                    "addresses",
                    "schools",
                    "higher_education",
                    "responsibilities",
                    "person_youth_group",
                    "hobbies_skills",
                    S.PERSON_HEALTH_CONDITION_SHEET,
                    S.PERSON_SPECIAL_NOTE_SHEET,
                ),
            )
            S.save()
        return jsonify({"ok": True})

    @app.post("/api/person")
    def add_person():
        body = request.json or {}
        with S.lock:
            new_id = S._next_person_id()
            raw_person = body.get("person", {})
            p, person_payload = prepare_profile_person_payload(
                raw_person,
                addresses_rows=body.get("addresses") if "addresses" in body else None,
                infer_addresses_from_payload="addresses" not in body,
            )
            body = apply_profile_person_relationship_flags(body, p)
            validation_errors = collect_profile_validation_errors(
                body,
                p,
                addresses_rows=person_payload["addresses_rows"],
            )
            invalid_responsibility_groups = validate_responsibility_membership_groups(
                S.store,
                new_id,
                body.get("responsibilities", []),
                compare_as_string=False,
                membership_rows=body.get("person_youth_group", []),
            )
            if invalid_responsibility_groups:
                validation_errors.append(
                    "مسؤولية الشبيبة يجب أن تطابق إحدى عضويات الشخص في الشبيبة."
                )
            if validation_errors:
                return _validation_error_response(validation_errors)

            prepared_job_rows, mobile_rows_payload, email_rows_payload = prepare_profile_job_contact_rows(
                S.store,
                new_id,
                job_rows=body.get("jobs", []),
                mobile_rows=body.get("mobile_numbers", []),
                email_rows=body.get("emails", []),
            )

            changed_by = _changed_by_from_current_user()
            p["person_id"] = new_id
            p["registered"] = True
            new_person_scd = S._scd_new_metadata(changed_by)
            S.store["persons"] = pd.concat([S.store["persons"], pd.DataFrame([{**p, **new_person_scd}])], ignore_index=True)
            S.replace_person_title(S.store, new_id, person_payload["person_title"], changed_by=changed_by)
            S.replace_person_school_system_sector(S.store, new_id, person_payload["school_system_sector"], changed_by=changed_by)

            replace_profile_sub_rows_batch(
                S.store,
                new_id,
                {
                    "nationality": body.get("nationality", []),
                    "jobs": prepared_job_rows,
                    "mobile_numbers": mobile_rows_payload,
                    "emails": email_rows_payload,
                    "social_media": body.get("social_media", []),
                    "addresses": person_payload["addresses_rows"],
                    "schools": body.get("schools", []),
                    "higher_education": body.get("higher_education", []),
                    "responsibilities": body.get("responsibilities", []),
                    "person_youth_group": body.get("person_youth_group", []),
                    "hobbies_skills": body.get("hobbies_skills", []),
                    S.PERSON_HEALTH_CONDITION_SHEET: body.get(S.PERSON_HEALTH_CONDITION_SHEET, []),
                    S.PERSON_SPECIAL_NOTE_SHEET: body.get(S.PERSON_SPECIAL_NOTE_SHEET, []),
                },
                compare_as_string=False,
                changed_by=changed_by,
                sheet_order=(
                    "nationality",
                    "jobs",
                    "mobile_numbers",
                    "emails",
                    "social_media",
                    "addresses",
                    "schools",
                    "higher_education",
                    "responsibilities",
                    "person_youth_group",
                    "hobbies_skills",
                    S.PERSON_HEALTH_CONDITION_SHEET,
                    S.PERSON_SPECIAL_NOTE_SHEET,
                ),
            )
            S.save()
        return jsonify({"ok": True, "person_id": new_id})

    @app.delete("/api/person/<int:pid>")
    def delete_person(pid):
        err = _require_admin()
        if err:
            return err
        with S.lock:
            persons = S._scd_ensure_columns(S.store["persons"])
            reg_mask = (
                (persons["person_id"] == pid)
                & (persons["registered"].apply(S._bool_registered))
                & S._scd_active_mask(persons)
            )
            if reg_mask.any():
                now = S._scd_timestamp()
                persons.loc[reg_mask, S.SCD_ACTIVE_TO_COL] = now
                persons.loc[reg_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                persons.loc[reg_mask, S.SCD_CHANGED_BY_USER_COL] = "admin"
                S.store["persons"] = persons
            remove_profile_rows_by_person_id(
                S.store,
                pid,
                compare_as_string=False,
                changed_by="admin",
                sheet_names=(sheet for sheet in S.store if sheet != "persons"),
                remove_membership_history=True,
            )
            remove_profile_photo_files(pid)
            S.save()
            _deactivate_auth_users_for_person(pid, changed_by="admin")
        return jsonify({"ok": True})

    @app.patch("/api/person/<int:pid>/archive")
    def archive_person(pid):
        err = _require_admin()
        if err:
            return err
        body = request.json or {}
        youth_group_ids = _request_youth_group_ids(body)
        if not youth_group_ids:
            return jsonify({"error": "youth_group_id is required"}), 400

        with S.lock:
            err = update_profile_membership_archive_state(
                S.store,
                S._registered_persons_df(),
                pid,
                youth_group_ids,
                compare_as_string=False,
                archived=True,
                save_callback=S.save,
            )
            if err:
                return err
        return jsonify({"ok": True})

    @app.patch("/api/person/<int:pid>/unarchive")
    def unarchive_person(pid):
        err = _require_admin()
        if err:
            return err
        body = request.json or {}
        youth_group_ids = _request_youth_group_ids(body)
        if not youth_group_ids:
            return jsonify({"error": "youth_group_id is required"}), 400

        with S.lock:
            err = update_profile_membership_archive_state(
                S.store,
                S._registered_persons_df(),
                pid,
                youth_group_ids,
                compare_as_string=False,
                archived=False,
                save_callback=S.save,
            )
            if err:
                return err
        return jsonify({"ok": True})


def _validate_promote_record(record):
    errors = []
    person = record.get("person") or {}

    for field in ("ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name"):
        if not S._normalize_text(str(person.get(field) or "")):
            errors.append(_NAME_FIELD_LABELS.get(field, field))

    if not S._normalize_text(str(person.get("gender") or "")):
        errors.append("الجنس")

    dob_missing = []
    if not person.get("birth_year"):
        dob_missing.append("السنة")
    if not person.get("birth_month"):
        dob_missing.append("الشهر")
    if not person.get("birth_day"):
        dob_missing.append("اليوم")
    if dob_missing:
        errors.append(f"تاريخ الميلاد الكامل ({', '.join(dob_missing)})")

    if not (record.get("mobile_numbers") or []):
        errors.append("رقم هاتف واحد على الأقل")

    addresses = record.get("addresses") or []
    has_valid_address = any(
        S._normalize_text(str(addr.get("country") or "")) and S._normalize_text(str(addr.get("governorate") or ""))
        for addr in addresses
    )
    if not has_valid_address:
        errors.append("عنوان يحتوي على الدولة والمحافظة")

    memberships = record.get("person_youth_group") or []
    if not memberships:
        errors.append("عضوية شبيبة واحدة على الأقل")
    else:
        has_age_group = any(
            any(S._normalize_text(str(h.get("age_group") or "")) for h in (m.get("age_group_history") or []))
            for m in memberships
        )
        if not has_age_group:
            errors.append("فئة عمرية واحدة على الأقل في إحدى عضويات الشبيبة")

    return errors


def register_unregistered_routes(app):
    @app.get("/api/unregistered")
    def get_unregistered():
        cached_payload, cached_version, data_version = S.unreg_index_cache_state()
        if cached_payload is not None and cached_version == data_version:
            return jsonify(cached_payload)

        with S.unreg_lock:
            cached_payload, cached_version, data_version = S.unreg_index_cache_state()
            if cached_payload is not None and cached_version == data_version:
                return jsonify(cached_payload)
            persons_df = S._project_primary_addresses(
                S.unregistered_persons_view_df(),
                S._scd_filter_active(S.unreg_store.get("addresses", pd.DataFrame())),
            ).replace({np.nan: None})
            pyg = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))
            pyg_history = S._scd_filter_active(S.unreg_store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()))
            resp = S._scd_filter_active(S.unreg_store.get("responsibilities", pd.DataFrame()))
            nat = S._scd_filter_active(S.unreg_store.get("nationality", pd.DataFrame()))
            sch = S._scd_filter_active(S.unreg_store.get("schools", pd.DataFrame()))
            he = S._scd_filter_active(S.unreg_store.get("higher_education", pd.DataFrame()))
            jobs = S._scd_filter_active(S.unreg_store.get("jobs", pd.DataFrame()))
            hob = S._scd_filter_active(S.unreg_store.get("hobbies_skills", pd.DataFrame()))
            health_cond = S._scd_filter_active(S.unreg_store.get(S.PERSON_HEALTH_CONDITION_SHEET, pd.DataFrame()))
            mob_df = S._scd_filter_active(S.unreg_store.get("mobile_numbers", pd.DataFrame()))
            mob_prim_df = S._scd_filter_active(S.unreg_store.get("personal_mobile_number_primary", pd.DataFrame()))
            mob_fam_df = S._scd_filter_active(S.unreg_store.get("mobile_number_family_relations", pd.DataFrame()))
            email_df = S._scd_filter_active(S.unreg_store.get("emails", pd.DataFrame()))
            email_prim_df = S._scd_filter_active(S.unreg_store.get("personal_email_primary", pd.DataFrame()))
            email_fam_df = S._scd_filter_active(S.unreg_store.get("email_family_relations", pd.DataFrame()))
            social_df = S._scd_filter_active(S.unreg_store.get("social_media", pd.DataFrame()))
            addr_all_df = S._scd_filter_active(S.unreg_store.get(S.ADDRESS_SHEET, pd.DataFrame()))
            sch_sect_df = S._scd_filter_active(S.unreg_store.get("school_sections", pd.DataFrame()))
            sch_grade_df = S._scd_filter_active(S.unreg_store.get("school_grades", pd.DataFrame()))
            special_notes_df = S._scd_filter_active(S.unreg_store.get(S.PERSON_SPECIAL_NOTE_SHEET, pd.DataFrame()))

            def pid_to_list_u(df, col):
                result = {}
                if df.empty or "person_id" not in df.columns or col not in df.columns:
                    return result
                for pid, grp in df.dropna(subset=[col]).groupby("person_id"):
                    result[str(pid)] = grp[col].dropna().astype(str).unique().tolist()
                return result

            nat_map = pid_to_list_u(nat, "nationality")
            sch_map = pid_to_list_u(sch, S.SCHOOL_NAME_COL)
            youth_rows_map = S.build_person_youth_group_payload_rows(pyg, pyg_history)
            ryg_id_map = pid_to_list_u(resp, S.YOUTH_GROUP_ID_COL)
            ryear_map = pid_to_list_u(resp, "jec_year")
            rcurrent_map = pid_to_list_u(resp, "is_current")
            rrole_map = pid_to_list_u(resp, "responsibility_name")
            uni_map = pid_to_list_u(he, S.HIGHER_EDUCATION_INSTITUTION_COL)
            maj_map = pid_to_list_u(he, "major")
            deg_map = pid_to_list_u(he, "degree")
            job_map = pid_to_list_u(jobs, "job_title")
            comp_map = pid_to_list_u(jobs, S.EMPLOYER_NAME_COL)
            hob_map = pid_to_list_u(hob, "hobby_skill")

            def pid_to_mapped_list_u(df, col, label_map):
                raw = pid_to_list_u(df, col)
                return {pid: sorted({label_map.get(v, v) for v in vals if v}) for pid, vals in raw.items()}

            htype_map = pid_to_mapped_list_u(health_cond, S.CONDITION_TYPE_COL, S.HEALTH_TYPE_LABELS)
            hestate_map = pid_to_mapped_list_u(he, S.EDUCATION_STATE_COL, S.EDUCATION_STATE_LABELS)
            jstate_map = pid_to_mapped_list_u(jobs, S.EMPLOYMENT_STATE_COL, S.JOB_STATE_LABELS)

            uni_gpa_map        = pid_to_list_u(he, "final_gpa")
            health_details_map = pid_to_list_u(health_cond, "details")
            note_title_map     = pid_to_list_u(special_notes_df, "note_title")
            note_details_map   = pid_to_list_u(special_notes_df, "note")

            _MOBILE_TYPE_AR_U  = {'personal': 'شخصي', 'work': 'عمل', 'home': 'منزل', 'family': 'عائلي'}
            _EMAIL_TYPE_AR_U   = {'personal': 'شخصي', 'work': 'عمل', 'family': 'عائلي'}
            _SOCIAL_PLAT_AR_U  = {'facebook': 'Facebook', 'instagram': 'Instagram', 'linkedin': 'LinkedIn'}
            _PRIMARY_AR_U      = {True: 'رئيسي', False: 'إضافي'}

            def _build_addr_enr_u(df):
                out = {}
                if df.empty or 'person_id' not in df.columns:
                    return out
                for pid_raw, grp in df.groupby('person_id'):
                    pk = str(pid_raw)
                    rows = grp.replace({np.nan: None}).to_dict(orient='records')
                    out[pk] = {
                        'multi': len(rows) > 1,
                        'loc': any(r.get('lat') is not None and r.get('lng') is not None for r in rows),
                        'types': sorted({('رئيسي' if S._to_bool(r.get('is_primary')) else 'إضافي') for r in rows}),
                        'streets': sorted({str(r.get(S.STREET_ADDRESS_COL) or '').strip() for r in rows if str(r.get(S.STREET_ADDRESS_COL) or '').strip()}),
                    }
                return out

            def _build_mob_enr_u(mob, prim, fam):
                if mob.empty or 'person_id' not in mob.columns:
                    return {}
                m = mob.copy()
                RID = 'mobile_number_record_id'
                if not prim.empty and RID in prim.columns and 'is_primary' in prim.columns:
                    m = m.merge(prim[[RID, 'is_primary']].drop_duplicates(RID), on=RID, how='left')
                if not fam.empty and RID in fam.columns and 'family_relation' in fam.columns:
                    m = m.merge(fam[[RID, 'family_relation']].drop_duplicates(RID), on=RID, how='left')
                m = m.replace({np.nan: None})
                out = {}
                for pid_raw, grp in m.groupby('person_id'):
                    pk = str(pid_raw)
                    rows = grp.to_dict(orient='records')
                    types = sorted({_MOBILE_TYPE_AR_U.get(str(r.get('mobile_number_type') or '').strip(), str(r.get('mobile_number_type') or '').strip()) for r in rows if str(r.get('mobile_number_type') or '').strip()})
                    fam_r = sorted({str(r.get('family_relation') or '').strip() for r in rows if str(r.get('mobile_number_type') or '').strip() == 'family' and str(r.get('family_relation') or '').strip()})
                    pprim = sorted({_PRIMARY_AR_U[bool(S._to_bool(r.get('is_primary')))] for r in rows if str(r.get('mobile_number_type') or '').strip() == 'personal'})
                    has_wa = any(S._to_bool(r.get('whatsapp_flag')) for r in rows)
                    has_pc = any(S._to_bool(r.get('phone_calls_flag')) for r in rows)
                    out[pk] = {'types': types, 'fam': fam_r, 'pprim': pprim, 'wa': has_wa, 'pc': has_pc}
                return out

            def _build_email_enr_u(em, prim, fam):
                if em.empty or 'person_id' not in em.columns:
                    return {}
                e = em.copy()
                RID = 'email_record_id'
                if not prim.empty and RID in prim.columns and 'is_primary' in prim.columns:
                    e = e.merge(prim[[RID, 'is_primary']].drop_duplicates(RID), on=RID, how='left')
                if not fam.empty and RID in fam.columns and 'family_relation' in fam.columns:
                    e = e.merge(fam[[RID, 'family_relation']].drop_duplicates(RID), on=RID, how='left')
                e = e.replace({np.nan: None})
                out = {}
                for pid_raw, grp in e.groupby('person_id'):
                    pk = str(pid_raw)
                    rows = grp.to_dict(orient='records')
                    types = sorted({_EMAIL_TYPE_AR_U.get(str(r.get('email_type') or '').strip(), str(r.get('email_type') or '').strip()) for r in rows if str(r.get('email_type') or '').strip()})
                    fam_r = sorted({str(r.get('family_relation') or '').strip() for r in rows if str(r.get('email_type') or '').strip() == 'family' and str(r.get('family_relation') or '').strip()})
                    pprim = sorted({_PRIMARY_AR_U[bool(S._to_bool(r.get('is_primary')))] for r in rows if str(r.get('email_type') or '').strip() == 'personal'})
                    out[pk] = {'types': types, 'fam': fam_r, 'pprim': pprim}
                return out

            def _build_social_enr_u(df):
                if df.empty or 'person_id' not in df.columns:
                    return {}
                out = {}
                for pid_raw, grp in df.dropna(subset=['platform']).groupby('person_id'):
                    pk = str(pid_raw)
                    rows = grp.replace({np.nan: None}).to_dict(orient='records')
                    plats = sorted({_SOCIAL_PLAT_AR_U.get(str(r.get('platform') or '').strip(), str(r.get('platform') or '').strip()) for r in rows if str(r.get('platform') or '').strip()})
                    prim  = sorted({_PRIMARY_AR_U[bool(S._to_bool(r.get('is_primary')))] for r in rows})
                    out[pk] = {'plats': plats, 'prim': prim}
                return out

            def _build_school_enr_u(s_df, sect_df, grade_df):
                if s_df.empty or 'person_id' not in s_df.columns:
                    return {}
                rid_sects = {}
                if not sect_df.empty and S.SCHOOL_RECORD_ID_COL in sect_df.columns and 'section' in sect_df.columns:
                    for _, r in sect_df.dropna(subset=['section']).iterrows():
                        rid = str(r.get(S.SCHOOL_RECORD_ID_COL) or '').strip()
                        sec = str(r.get('section') or '').strip()
                        if rid and sec:
                            rid_sects.setdefault(rid, set()).add(sec)
                rid_grades = {}
                if not grade_df.empty and S.SCHOOL_RECORD_ID_COL in grade_df.columns and 'grade' in grade_df.columns:
                    for _, r in grade_df.dropna(subset=['grade']).iterrows():
                        rid = str(r.get(S.SCHOOL_RECORD_ID_COL) or '').strip()
                        g = str(r.get('grade') or '').strip()
                        if rid and g:
                            rid_grades.setdefault(rid, set()).add(g)
                out = {}
                for pid_raw, grp in s_df.groupby('person_id'):
                    pk = str(pid_raw)
                    rows = grp.replace({np.nan: None}).to_dict(orient='records')
                    statuses = sorted({'حاليًّا' if S._to_bool(r.get('is_current')) else 'سابقًا' for r in rows})
                    sects, grades = set(), set()
                    for r in rows:
                        rid = str(r.get(S.SCHOOL_RECORD_ID_COL) or '').strip()
                        sname = str(r.get(S.SCHOOL_NAME_COL) or '').strip()
                        for sec in rid_sects.get(rid, set()):
                            sects.add(f'{sname} - {sec}' if sname else sec)
                        if S._to_bool(r.get('is_current')):
                            grades.update(rid_grades.get(rid, set()))
                    prev_grades = set()
                    for r in rows:
                        if not S._to_bool(r.get('is_current')):
                            rid = str(r.get(S.SCHOOL_RECORD_ID_COL) or '').strip()
                            prev_grades.update(rid_grades.get(rid, set()))
                    out[pk] = {'statuses': statuses, 'sects': sorted(sects), 'grades': sorted(grades), 'prev_grades': sorted(prev_grades)}
                return out

            addr_enr   = _build_addr_enr_u(addr_all_df)
            mob_enr    = _build_mob_enr_u(mob_df, mob_prim_df, mob_fam_df)
            email_enr  = _build_email_enr_u(email_df, email_prim_df, email_fam_df)
            social_enr = _build_social_enr_u(social_df)
            school_enr = _build_school_enr_u(sch, sch_sect_df, sch_grade_df)

            # Previous age groups: direct lookup from raw history sheet
            _pyg_hist_scd = S._scd_filter_active(pyg_history) if not pyg_history.empty else pyg_history
            _age_hist_lookup: dict = {}
            if (not _pyg_hist_scd.empty
                    and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in _pyg_hist_scd.columns
                    and "age_group" in _pyg_hist_scd.columns):
                for _, _hr in _pyg_hist_scd[[S.PERSON_YOUTH_GROUP_RECORD_ID_COL, "age_group"]].dropna(subset=["age_group"]).iterrows():
                    _r = str(_hr.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL) or "").strip()
                    _g = S._normalize_age_group(str(_hr.get("age_group") or "").strip())
                    if _r and _g:
                        _age_hist_lookup.setdefault(_r, set()).add(_g)

            from core.routes_org_tree import build_person_org_tree_index as _build_org_tree_index
            _org_tree_map, _gs_tree_map = _build_org_tree_index()

            photo_ids: set[str] = set()
            try:
                for name in os.listdir(S.PROFILE_PHOTOS_DIR):
                    if "." not in name:
                        continue
                    pid_part, ext = name.rsplit(".", 1)
                    if ext.lower() in S.ALLOWED_EXTENSIONS:
                        photo_ids.add(pid_part)
            except OSError:
                pass

            enriched = []
            for row in persons_df.to_dict(orient="records"):
                uid = str(row.get("person_id", ""))
                row["_avatar_initial"] = S.avatar_initial_from_person(row)
                row["_nationalities"] = nat_map.get(uid, [])
                row["_schools"] = sch_map.get(uid, [])
                youth_rows = S.get_person_youth_group_payload_rows(youth_rows_map, uid)
                active_youth_rows = [entry for entry in youth_rows if not bool(entry.get("archived"))]
                archived_youth_rows = [entry for entry in youth_rows if bool(entry.get("archived"))]
                row["_youth_memberships"] = youth_rows

                yg_ids = [entry["youth_group_id"] for entry in active_youth_rows]
                archived_yg_ids = [entry["youth_group_id"] for entry in archived_youth_rows]
                row["_youth_group_ids"] = yg_ids
                row["_youth_groups"] = [S.youth_group_name(gid) or gid for gid in yg_ids]
                row["_age_groups"] = [entry["age_group"] for entry in active_youth_rows]
                _prev_age_set = set()
                for _entry in active_youth_rows:
                    _rid = str(_entry.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL) or "").strip()
                    _cur_ag = S._normalize_age_group(str(_entry.get("age_group") or "").strip()) or ""
                    for _ag in _age_hist_lookup.get(_rid, set()):
                        if _ag and _ag != _cur_ag:
                            _prev_age_set.add(_ag)
                row["_prev_age_groups"] = sorted(_prev_age_set)
                row["_youth_join_years"] = [entry["youth_join_year"] for entry in active_youth_rows]
                row["_archived_youth_group_ids"] = archived_yg_ids
                row["_archived_youth_groups"] = [S.youth_group_name(gid) or gid for gid in archived_yg_ids]
                row["_archived_age_groups"] = [entry["age_group"] for entry in archived_youth_rows]
                row["_archived_youth_join_years"] = [entry["youth_join_year"] for entry in archived_youth_rows]
                statuses_yic = []
                if active_youth_rows: statuses_yic.append("عضو حالي")
                if archived_youth_rows: statuses_yic.append("عضو سابق")
                row["_youth_is_current"] = statuses_yic
                _ot = _org_tree_map.get(uid, {})
                row["_org_tree_groups"] = _ot.get("groups", [])
                row["_org_tree_jec_years"] = _ot.get("jec_years", [])
                row["_org_tree_roles"] = _ot.get("roles", [])
                _gs = _gs_tree_map.get(uid, {})
                row["_gs_tree_jec_years"] = _gs.get("jec_years", [])
                row["_gs_tree_roles"] = _gs.get("roles", [])
                ryg_ids = ryg_id_map.get(uid, [])
                row["_responsibility_youth_group_ids"] = ryg_ids
                row["_responsibility_youth_groups"] = [S.youth_group_name(gid) or gid for gid in ryg_ids]
                row["_responsibility_jec_years"] = ryear_map.get(uid, [])
                row["_responsibility_current_states"] = [
                    "حاليًّا" if S._to_bool(value) else "سابقًا"
                    for value in rcurrent_map.get(uid, [])
                ]
                row["_responsibilities"] = rrole_map.get(uid, [])
                row["_universities"] = uni_map.get(uid, [])
                row["_majors"] = maj_map.get(uid, [])
                row["_degrees"] = deg_map.get(uid, [])
                row["_job_titles"] = job_map.get(uid, [])
                row["_companies"] = comp_map.get(uid, [])
                row["_hobbies"] = hob_map.get(uid, [])
                row["_health_types"] = htype_map.get(uid, [])
                row["_higher_ed_states"] = hestate_map.get(uid, [])
                row["_job_states"] = jstate_map.get(uid, [])
                ae = addr_enr.get(uid, {})
                row["_has_multiple_addresses"] = (["متعدد"] if ae.get("multi") else ["فردي"]) if uid in addr_enr else []
                row["_has_location"] = (["نعم"] if ae.get("loc") else ["لا"]) if uid in addr_enr else []
                row["_address_types"] = ae.get("types", [])
                row["_street_addresses"] = ae.get("streets", [])
                me = mob_enr.get(uid, {})
                row["_mobile_types"] = me.get("types", [])
                row["_mobile_family_relations"] = me.get("fam", [])
                row["_mobile_personal_primary"] = me.get("pprim", [])
                row["_has_whatsapp"] = (["نعم"] if me.get("wa") else ["لا"]) if uid in mob_enr else []
                ee = email_enr.get(uid, {})
                row["_email_types"] = ee.get("types", [])
                row["_email_family_relations"] = ee.get("fam", [])
                row["_email_personal_primary"] = ee.get("pprim", [])
                se = social_enr.get(uid, {})
                row["_social_platforms"] = se.get("plats", [])
                row["_social_primary"] = se.get("prim", [])
                sce = school_enr.get(uid, {})
                row["_school_statuses"] = sce.get("statuses", [])
                row["_school_sections"] = sce.get("sects", [])
                row["_school_current_grades"] = sce.get("grades", [])
                row["_school_previous_grades"] = sce.get("prev_grades", [])
                row["_has_phone_calls"] = (["نعم"] if me.get("pc") else ["لا"]) if uid in mob_enr else []
                row["_uni_gpas"] = uni_gpa_map.get(uid, [])
                row["_health_details"] = health_details_map.get(uid, [])
                row["_special_note_titles"] = note_title_map.get(uid, [])
                row["_special_note_details"] = note_details_map.get(uid, [])
                row["_photo"] = f"/api/unregistered/{uid}/photo" if uid in photo_ids else None
                row["archived"] = bool(youth_rows) and len(active_youth_rows) == 0
                enriched.append(row)

            S.set_unreg_index_cache(enriched, data_version)
        return jsonify(enriched)

    @app.get("/api/unregistered/<uid>")
    def get_unregistered_profile(uid):
        err = require_profile_view_access("unregistered", uid)
        if err:
            return err
        with S.unreg_lock:
            record = build_profile_record(
                S.unregistered_persons_view_df(),
                S.unreg_store,
                uid,
                compare_as_string=True,
                photo_path_getter=S.get_unreg_photo_path,
                photo_url_template="/api/unregistered/{pid}/photo",
            )
        if not record:
            return jsonify({"error": "not found"}), 404
        return jsonify(record)

    @app.post("/api/unregistered")
    def add_unregistered():
        body = request.json or {}
        provided_uid = S._normalize_person_id(body.get("person_id"))
        new_uid = provided_uid if provided_uid not in (None, "") else S._next_person_id()
        with S.unreg_lock:
            existing = S.unreg_store.get("persons", pd.DataFrame())
            if not existing.empty and "person_id" in existing.columns:
                if str(new_uid) in existing["person_id"].astype(str).values:
                    record = build_profile_record(
                        S.unregistered_persons_view_df(),
                        S.unreg_store,
                        new_uid,
                        compare_as_string=True,
                        photo_path_getter=S.get_unreg_photo_path,
                        photo_url_template="/api/unregistered/{pid}/photo",
                    )
                    return jsonify({"ok": True, "person_id": new_uid, "record": record})
            raw_person = body.get("person") or {}
            p, person_payload = prepare_profile_person_payload(
                raw_person,
                addresses_rows=body.get("addresses") if "addresses" in body else None,
                infer_addresses_from_payload="addresses" not in body,
            )
            p = _populate_arabic_name_from_full_name(p, body.get("name"))
            body = apply_profile_person_relationship_flags(body, p)
            validation_errors = collect_profile_validation_errors(
                body,
                p,
                addresses_rows=person_payload["addresses_rows"],
            )
            invalid_responsibility_groups = validate_responsibility_membership_groups(
                S.unreg_store,
                new_uid,
                body.get("responsibilities", []),
                compare_as_string=True,
                membership_rows=body.get("person_youth_group", []),
            )
            if invalid_responsibility_groups:
                validation_errors.append(
                    "مسؤولية الشبيبة يجب أن تطابق إحدى عضويات الشخص في الشبيبة."
                )
            if validation_errors:
                return _validation_error_response(validation_errors)

            prepared_job_rows, mobile_rows_payload, email_rows_payload = prepare_profile_job_contact_rows(
                S.unreg_store,
                new_uid,
                job_rows=body.get("jobs", []),
                mobile_rows=body.get("mobile_numbers", []),
                email_rows=body.get("emails", []),
            )

            changed_by = _changed_by_from_current_user()
            p["person_id"] = new_uid
            p["registered"] = False
            new_person_scd = S._scd_new_metadata(changed_by)
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            new_row = pd.DataFrame([{**p, **new_person_scd}])
            for col in S.UNREG_PERSONS_COLS:
                if col not in new_row.columns:
                    new_row[col] = None
            S.unreg_store["persons"] = pd.concat([persons_df, new_row], ignore_index=True)
            S.replace_person_title(S.unreg_store, new_uid, person_payload["person_title"], changed_by=changed_by)
            S.replace_person_school_system_sector(S.unreg_store, new_uid, person_payload["school_system_sector"], changed_by=changed_by)
            replace_profile_sub_rows_batch(
                S.unreg_store,
                new_uid,
                {
                    "addresses": person_payload["addresses_rows"],
                    "nationality": body.get("nationality", []),
                    "jobs": prepared_job_rows,
                    "mobile_numbers": mobile_rows_payload,
                    "emails": email_rows_payload,
                    "social_media": body.get("social_media", []),
                    "schools": body.get("schools", []),
                    "higher_education": body.get("higher_education", []),
                    "responsibilities": body.get("responsibilities", []),
                    "person_youth_group": body.get("person_youth_group", []),
                    "hobbies_skills": body.get("hobbies_skills", []),
                    S.PERSON_HEALTH_CONDITION_SHEET: body.get(S.PERSON_HEALTH_CONDITION_SHEET, []),
                    S.PERSON_SPECIAL_NOTE_SHEET: body.get(S.PERSON_SPECIAL_NOTE_SHEET, []),
                },
                compare_as_string=True,
                changed_by=changed_by,
                sheet_order=(
                    "addresses",
                    "nationality",
                    "jobs",
                    "mobile_numbers",
                    "emails",
                    "social_media",
                    "schools",
                    "higher_education",
                    "responsibilities",
                    "person_youth_group",
                    "hobbies_skills",
                    S.PERSON_HEALTH_CONDITION_SHEET,
                    S.PERSON_SPECIAL_NOTE_SHEET,
                ),
                include_empty=False,
            )
            S._save_unreg_store()
            record = build_profile_record(
                S.unregistered_persons_view_df(),
                S.unreg_store,
                new_uid,
                compare_as_string=True,
                photo_path_getter=S.get_unreg_photo_path,
                photo_url_template="/api/unregistered/{pid}/photo",
            )
        return jsonify({"ok": True, "person_id": new_uid, "record": record})

    @app.put("/api/unregistered/<uid>")
    def update_unregistered(uid):
        scope = profile_edit_scope("unregistered", uid)
        if not scope:
            return jsonify({"error": "unauthorized"}), 403

        body = request.json or {}
        if scope == "location_only":
            if set(body.keys()) - {"addresses"}:
                return jsonify({"error": "forbidden"}), 403
            try:
                addresses_rows = build_location_only_address_rows(S.unreg_store, uid, body.get("addresses"), compare_as_string=True)
            except ValueError:
                return jsonify({"error": "invalid google maps location"}), 400

            with S.unreg_lock:
                changed_by = _changed_by_from_current_user()
                replace_profile_sub_rows(S.unreg_store, uid, "addresses", addresses_rows, compare_as_string=True, changed_by=changed_by)
                S._save_unreg_store()
                record = build_profile_record(
                    S.unregistered_persons_view_df(),
                    S.unreg_store,
                    uid,
                    compare_as_string=True,
                    photo_path_getter=S.get_unreg_photo_path,
                    photo_url_template="/api/unregistered/{pid}/photo",
                )
            return jsonify({"ok": True, "record": record})

        with S.unreg_lock:
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            if persons_df.empty or "person_id" not in persons_df.columns:
                return jsonify({"error": "not found"}), 404
            idx = persons_df[persons_df["person_id"].astype(str) == str(uid)].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404

            if scope in ("council", "self"):
                user = _current_user()
                council_group_ids = _get_user_council_group_ids(user) if scope == "council" else set()
                body = dict(body)
                if "person" in body and "title" in (body.get("person") or {}):
                    body["person"] = {k: v for k, v in body["person"].items() if k != "title"}
                if scope == "council" and "addresses" in body:
                    body["addresses"] = _apply_address_location_restriction(
                        body.get("addresses"), S.unreg_store, uid, compare_as_string=True
                    )
                if "person_youth_group" in body:
                    body, membership_errors = _validate_membership_scope(
                        body, S.unreg_store, uid, scope, council_group_ids, compare_as_string=True
                    )
                    if membership_errors:
                        return _validation_error_response(membership_errors)
                if scope == "council" and "responsibilities" in body:
                    body = _filter_responsibilities_for_council(
                        body, S.unreg_store, uid, council_group_ids, compare_as_string=True
                    )

            raw_person = body.get("person", {})
            p, person_payload = prepare_profile_person_payload(
                raw_person,
                addresses_rows=body.get("addresses") if "addresses" in body else None,
                infer_addresses_from_payload=True,
            )
            body = apply_profile_person_relationship_flags(body, p)
            validation_errors = collect_profile_validation_errors(
                body,
                p,
                addresses_rows=person_payload["addresses_rows"],
            )
            invalid_responsibility_groups = validate_responsibility_membership_groups(
                S.unreg_store,
                uid,
                body.get("responsibilities", []),
                compare_as_string=True,
                membership_rows=body.get("person_youth_group") if "person_youth_group" in body else None,
            )
            if invalid_responsibility_groups:
                validation_errors.append(
                    "مسؤولية الشبيبة يجب أن تطابق إحدى عضويات الشخص في الشبيبة."
                )
            if validation_errors:
                return _validation_error_response(validation_errors)

            prepared_job_rows, mobile_rows_payload, email_rows_payload = prepare_profile_job_contact_rows(
                S.unreg_store,
                uid,
                job_rows=body.get("jobs", []),
                mobile_rows=body.get("mobile_numbers") if "mobile_numbers" in body else None,
                email_rows=body.get("emails") if "emails" in body else None,
            )

            changed_by = _changed_by_from_current_user()
            all_unreg = S._scd_ensure_columns(S.unreg_store.get("persons", pd.DataFrame()).copy())
            uid_mask = (
                (all_unreg["person_id"].astype(str) == str(uid))
                & S._scd_active_mask(all_unreg)
            )
            if uid_mask.any():
                now = S._scd_timestamp()
                current_row = all_unreg[uid_mask].iloc[0].to_dict()
                all_unreg.loc[uid_mask, S.SCD_ACTIVE_TO_COL] = now
                all_unreg.loc[uid_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                all_unreg.loc[uid_mask, S.SCD_CHANGED_BY_USER_COL] = changed_by
                new_row_data = {k: v for k, v in current_row.items() if k not in S.SCD_METADATA_COLUMNS}
                new_row_data.update(p)
                new_row_data.update(S._scd_new_metadata(changed_by))
                S.unreg_store["persons"] = pd.concat([all_unreg, pd.DataFrame([new_row_data])], ignore_index=True)
            if person_payload["title_in_payload"]:
                S.replace_person_title(S.unreg_store, uid, person_payload["person_title"], changed_by=changed_by)
            if person_payload["school_system_sector_in_payload"]:
                S.replace_person_school_system_sector(S.unreg_store, uid, person_payload["school_system_sector"], changed_by=changed_by)
            payload_by_sheet = {
                "addresses": person_payload["addresses_rows"],
                "nationality": body.get("nationality", []),
                "jobs": prepared_job_rows,
                "mobile_numbers": mobile_rows_payload,
                "emails": email_rows_payload,
                "social_media": body.get("social_media", []),
                "schools": body.get("schools", []),
                "higher_education": body.get("higher_education", []),
                "responsibilities": body.get("responsibilities", []),
                "person_youth_group": body.get("person_youth_group", []),
                "hobbies_skills": body.get("hobbies_skills", []),
                S.PERSON_HEALTH_CONDITION_SHEET: body.get(S.PERSON_HEALTH_CONDITION_SHEET, []),
                S.PERSON_SPECIAL_NOTE_SHEET: body.get(S.PERSON_SPECIAL_NOTE_SHEET, []),
            }
            if person_payload["addresses_rows"] is not None:
                replace_profile_sub_rows_batch(
                    S.unreg_store,
                    uid,
                    payload_by_sheet,
                    compare_as_string=True,
                    changed_by=changed_by,
                    sheet_order=("addresses",),
                )

            replace_profile_sub_rows_batch(
                S.unreg_store,
                uid,
                payload_by_sheet,
                compare_as_string=True,
                changed_by=changed_by,
                sheet_order=tuple(
                    sheet
                    for sheet in (
                        "nationality",
                        "jobs",
                        "mobile_numbers",
                        "emails",
                        "social_media",
                        "schools",
                        "higher_education",
                        "responsibilities",
                        "person_youth_group",
                        "hobbies_skills",
                        S.PERSON_HEALTH_CONDITION_SHEET,
                        S.PERSON_SPECIAL_NOTE_SHEET,
                    )
                    if sheet in body
                ),
                include_empty=True,
            )
            S._save_unreg_store()
            record = build_profile_record(
                S.unregistered_persons_view_df(),
                S.unreg_store,
                uid,
                compare_as_string=True,
                photo_path_getter=S.get_unreg_photo_path,
                photo_url_template="/api/unregistered/{pid}/photo",
            )
        return jsonify({"ok": True, "record": record})

    @app.delete("/api/unregistered/<uid>")
    def delete_unregistered(uid):
        err = _require_admin()
        if err:
            return err
        with S.unreg_lock:
            remove_profile_rows_by_person_id(
                S.unreg_store,
                uid,
                compare_as_string=True,
                changed_by="admin",
                sheet_names=S.UNREG_SHEETS,
                remove_membership_history=True,
            )
            S._save_unreg_store()
            _deactivate_auth_users_for_person(uid, changed_by="admin")
        remove_profile_photo_files(uid)
        return jsonify({"ok": True})

    @app.patch("/api/unregistered/<uid>/archive")
    def archive_unregistered(uid):
        err = _require_admin()
        if err:
            return err
        body = request.json or {}
        youth_group_ids = _request_youth_group_ids(body)
        if not youth_group_ids:
            return jsonify({"error": "youth_group_id is required"}), 400

        with S.unreg_lock:
            err = update_profile_membership_archive_state(
                S.unreg_store,
                S.unreg_store.get("persons", pd.DataFrame()),
                uid,
                youth_group_ids,
                compare_as_string=True,
                archived=True,
                save_callback=S._save_unreg_store,
            )
            if err:
                return err
        return jsonify({"ok": True})

    @app.patch("/api/unregistered/<uid>/unarchive")
    def unarchive_unregistered(uid):
        err = _require_admin()
        if err:
            return err
        body = request.json or {}
        youth_group_ids = _request_youth_group_ids(body)
        if not youth_group_ids:
            return jsonify({"error": "youth_group_id is required"}), 400

        with S.unreg_lock:
            err = update_profile_membership_archive_state(
                S.unreg_store,
                S.unreg_store.get("persons", pd.DataFrame()),
                uid,
                youth_group_ids,
                compare_as_string=True,
                archived=False,
                save_callback=S._save_unreg_store,
            )
            if err:
                return err
        return jsonify({"ok": True})

    @app.post("/api/unregistered/<uid>/photo")
    def upload_unreg_photo(uid):
        if not profile_edit_scope("unregistered", uid):
            return jsonify({"error": "forbidden"}), 403
        if "photo" not in request.files:
            return jsonify({"error": "no file"}), 400
        file = request.files["photo"]
        return handle_profile_photo_upload(
            uid,
            file,
            photo_url=f"/api/unregistered/{uid}/photo",
        )

    @app.get("/api/unregistered/<uid>/photo")
    def serve_unreg_photo(uid):
        err = require_profile_view_access("unregistered", uid)
        if err:
            return err
        path, ext = S.get_unreg_photo_path(uid)
        if not path:
            return jsonify({"error": "not found"}), 404
        return send_from_directory(os.path.dirname(path), f"{uid}.{ext}")

    @app.post("/api/unregistered/<uid>/promote")
    def promote_unregistered(uid):
        err = _require_admin()
        if err:
            return err
        with S.unreg_lock:
            record = build_profile_record(
                S.unregistered_persons_view_df(),
                S.unreg_store,
                uid,
                compare_as_string=True,
                photo_path_getter=S.get_unreg_photo_path,
                photo_url_template="/api/unregistered/{pid}/photo",
            )
            if not record:
                return jsonify({"error": "not found"}), 404

        issues = _validate_promote_record(record)
        if issues:
            return jsonify({"error": "لا يمكن إتمام التسجيل. يرجى استكمال البيانات الناقصة.", "issues": issues}), 422

        promoted_pid = S._normalize_person_id(uid)
        if promoted_pid in (None, ""):
            return jsonify({"error": "invalid person_id"}), 400

        with S.lock:
            persons_df = S._scd_ensure_columns(S.store.get("persons", pd.DataFrame()).copy())
            if "person_id" not in persons_df.columns:
                persons_df["person_id"] = None

            active_mask = (
                (persons_df["person_id"].astype(str) == str(promoted_pid))
                & S._scd_active_mask(persons_df)
            )
            now = S._scd_timestamp()

            if active_mask.any():
                current_row = (
                    persons_df.loc[active_mask]
                    .replace({np.nan: None})
                    .to_dict(orient="records")[-1]
                )
                persons_df.loc[active_mask, S.SCD_ACTIVE_TO_COL] = now
                persons_df.loc[active_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                persons_df.loc[active_mask, S.SCD_CHANGED_BY_USER_COL] = "admin"
                promoted_person = {
                    key: value
                    for key, value in current_row.items()
                    if key not in S.SCD_METADATA_COLUMNS
                }
            else:
                promoted_person = dict(record.get("person") or {})

            promoted_person.pop("title", None)
            promoted_person.pop("school_system_sector", None)
            promoted_person = _strip_person_projection_fields(promoted_person)
            promoted_person["person_id"] = promoted_pid
            promoted_person["registered"] = True

            S.store["persons"] = pd.concat(
                [
                    persons_df,
                    pd.DataFrame([{**promoted_person, **S._scd_new_metadata("admin")}]),
                ],
                ignore_index=True,
            )
            S.save()

        src_path, ext = S.get_unreg_photo_path(uid)
        if ext and src_path:
            dest_path = os.path.join(S.PROFILE_PHOTOS_DIR, f"{promoted_pid}.{ext}")
            if os.path.abspath(src_path) != os.path.abspath(dest_path):
                try:
                    os.replace(src_path, dest_path)
                except Exception:
                    pass

        with S.unreg_lock:
            S._sync_unreg_view_from_store()

        return jsonify({"ok": True, "person_id": promoted_pid})

    @app.post("/api/unregistered/sync")
    def sync_unregistered():
        body = request.json or {}
        nodes = body.get("nodes", [])
        sync_group_ids = _request_youth_group_ids(body)
        sync_group_id = sync_group_ids[0] if sync_group_ids else ""
        sync_membership_group_id = sync_group_id if S._is_group_id(sync_group_id) else ""
        created = {}
        changed = False
        with S.unreg_lock:
            for n in nodes:
                if not n.get("name") and not n.get("baseName"):
                    continue
                raw_name = n.get("baseName") or n.get("name") or ""
                parts = raw_name.strip().split()
                if len(parts) == 1:
                    fn, sn, tn, ln = parts[0], "", "", ""
                elif len(parts) == 2:
                    fn, sn, tn, ln = parts[0], "", "", parts[1]
                elif len(parts) == 3:
                    fn, sn, tn, ln = parts[0], parts[1], "", parts[2]
                else:
                    fn, sn, tn, ln = parts[0], parts[1], parts[2], " ".join(parts[3:])

                persons_df = S.unreg_store.get("persons", pd.DataFrame())
                norm_target = S.normalize_arabic(raw_name.strip())
                existing_uid = None
                if not persons_df.empty and "person_id" in persons_df.columns:
                    for _, row in persons_df.iterrows():
                        row_base = " ".join(
                            str(row[k]) for k in ("ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
                            if row.get(k)
                        )
                        if S.normalize_arabic(row_base.strip()) == norm_target:
                            existing_uid = S._normalize_person_id(row["person_id"])
                            break

                if existing_uid:
                    if sync_membership_group_id:
                        existing_membership_rows = get_profile_sub_rows(
                            S.unreg_store,
                            existing_uid,
                            S.PERSON_YOUTH_GROUP_SHEET,
                            compare_as_string=True,
                        )
                        seeded_membership_rows = _seed_current_membership_rows(
                            existing_membership_rows,
                            youth_group_id=sync_membership_group_id,
                        )
                        if seeded_membership_rows != existing_membership_rows:
                            replace_profile_sub_rows(
                                S.unreg_store,
                                existing_uid,
                                S.PERSON_YOUTH_GROUP_SHEET,
                                seeded_membership_rows,
                                compare_as_string=True,
                            )
                            changed = True
                    created[n.get("id")] = existing_uid
                    continue

                new_uid = S._next_person_id()
                p_row = {
                    "person_id": new_uid,
                    "ar_first_name": fn,
                    "ar_second_name": sn,
                    "ar_third_name": tn,
                    "ar_last_name": ln,
                    **S._scd_new_metadata("system"),
                }
                new_row = pd.DataFrame([p_row])
                S.unreg_store["persons"] = pd.concat([persons_df, new_row], ignore_index=True)
                S.replace_person_title(S.unreg_store, new_uid, n.get("laqab", ""))
                if sync_membership_group_id:
                    replace_profile_sub_rows(
                        S.unreg_store,
                        new_uid,
                        S.PERSON_YOUTH_GROUP_SHEET,
                        _seed_current_membership_rows([], youth_group_id=sync_membership_group_id),
                        compare_as_string=True,
                    )
                created[n.get("id")] = new_uid
                changed = True
            if changed:
                S._save_unreg_store()
        return jsonify({"ok": True, "created": created})


def register_person_routes(app):
    register_registered_routes(app)
    register_unregistered_routes(app)
