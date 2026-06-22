import json

import math

import os

import re

import sys

import threading

import uuid

from urllib.parse import unquote, urlparse

from urllib.request import Request, urlopen



import numpy as np

import pandas as pd



from core.database import Database





db = Database(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app.py")))



CSV_DIR = db.csv_dir

PHOTOS_ROOT_DIR = db.photos_root_dir

PROFILE_PHOTOS_DIR = db.profile_pictures_dir

os.makedirs(PROFILE_PHOTOS_DIR, exist_ok=True)



SHEETS = [

    "persons", "nationality", "mobile_numbers", "mobile_number_family_relations", "personal_mobile_number_primary", "mobile_number_linked_jobs", "emails", "email_family_relations", "personal_email_primary", "email_linked_jobs", "social_media", "schools", "school_sections", "school_grades",

    "higher_education", "jobs", "responsibilities",

    "person_youth_group", "person_youth_group_age_history", "hobbies_skills", "person_health_conditions", "person_special_notes", "addresses", "person_titles", "person_school_system_sectors", "parishes", "churches", "youth_groups", "youth_group_social_media", "youth_group_social_media_ages", "youth_group_special_logos",

    "person_spouse",

    "lkp_nationality_iso_codes", "institution_logos", "lkp_person_titles", "mottos", "motto_youth_groups",

]



UNREG_SHEETS = [

    "persons", "nationality", "mobile_numbers", "mobile_number_family_relations", "personal_mobile_number_primary", "mobile_number_linked_jobs", "emails", "email_family_relations", "personal_email_primary", "email_linked_jobs", "social_media", "schools", "school_sections", "school_grades",

    "higher_education", "jobs", "responsibilities",

    "person_youth_group", "person_youth_group_age_history", "hobbies_skills", "person_health_conditions", "person_special_notes", "addresses", "person_titles", "person_school_system_sectors",

]



ADDRESS_SHEET = "addresses"

STREET_ADDRESS_COL = "street_address"

ADDRESS_COLUMNS = ["person_id", "country", "governorate", "city", STREET_ADDRESS_COL, "lat", "lng", "is_primary"]

DEFAULT_COUNTRY = "الأردن"

PERSON_TITLE_SHEET = "person_titles"

PERSON_TITLE_COLUMNS = ["person_id", "title"]

PERSON_SCHOOL_SYSTEM_SECTOR_SHEET = "person_school_system_sectors"

PERSON_SCHOOL_SYSTEM_SECTOR_COLUMNS = ["person_id", "school_system_sector"]

PERSON_HEALTH_CONDITION_SHEET = "person_health_conditions"

CONDITION_TYPE_COL = "condition_type"

PERSON_HEALTH_CONDITION_COLUMNS = ["person_id", CONDITION_TYPE_COL, "details"]

PERSON_SPECIAL_NOTE_SHEET = "person_special_notes"

PERSON_SPECIAL_NOTE_COLUMNS = ["person_id", "note_title", "note"]

NATIONALITY_SHEET = "nationality"

NATIONALITY_COLUMNS = ["person_id", "nationality"]

SCHOOL_SHEET = "schools"

SCHOOL_RECORD_ID_COL = "school_record_id"

SCHOOL_NAME_COL = "school_name"

SCHOOL_COLUMNS = ["person_id", SCHOOL_RECORD_ID_COL, SCHOOL_NAME_COL, "start_date", "end_date", "is_current"]

SCHOOL_STATUS_COL = "school_graduated"

SCHOOL_STATUS_STUDYING = "على مقاعد الدراسة"

SCHOOL_STATUS_GRADUATED = "متخرج من المدارس"

SCHOOL_STATUS_NOT_ENROLLED = "غير ملتزم بدراسة مدرسيّة"

SCHOOL_STATUS_VALUES = {

    SCHOOL_STATUS_STUDYING,

    SCHOOL_STATUS_GRADUATED,

    SCHOOL_STATUS_NOT_ENROLLED,

}

SCHOOL_SECTION_SHEET = "school_sections"

SCHOOL_SECTION_COLUMNS = [SCHOOL_RECORD_ID_COL, "section"]

SCHOOL_GRADE_SHEET = "school_grades"

SCHOOL_GRADE_COLUMNS = [SCHOOL_RECORD_ID_COL, "grade"]

TITLE_OPTIONS_SHEET = "lkp_person_titles"

TITLE_OPTIONS_COLUMNS = ["arabic_title", "english_title"]

MOTTOS_SHEET = "mottos"

MOTTOS_COLUMNS = ["motto_id", "title", "year_label", "application_from_date", "application_to_date", "application_is_present", "targets_jec_jordan", "bible_book_id", "bible_section_start", "bible_section_end", "bible_verse_start", "bible_verse_end", "logo_file_name"]

MOTTO_YOUTH_GROUPS_SHEET = "motto_youth_groups"

MOTTO_YOUTH_GROUPS_COLUMNS = ["motto_id", "youth_group_id"]

SCHOOL_LOGO_SHEET = "institution_logos"

SCHOOL_LOGO_ID_COL = "school_logo_id"

INSTITUTION_TYPE_COL = "institution_type"

INSTITUTION_NAME_COL = "institution_name"

INSTITUTION_SECTION_COL = "institution_section"

SCHOOL_LOGO_COLUMNS = [SCHOOL_LOGO_ID_COL, INSTITUTION_TYPE_COL, INSTITUTION_NAME_COL, INSTITUTION_SECTION_COL, "logo_file_name"]

MOBILE_NUMBER_SHEET = "mobile_numbers"

MOBILE_NUMBER_RECORD_ID_COL = "mobile_number_record_id"

MOBILE_NUMBER_FAMILY_RELATION_SHEET = "mobile_number_family_relations"

MOBILE_NUMBER_FAMILY_RELATION_COLUMNS = [MOBILE_NUMBER_RECORD_ID_COL, "family_relation"]

PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET = "personal_mobile_number_primary"

PERSONAL_MOBILE_NUMBER_PRIMARY_COLUMNS = [MOBILE_NUMBER_RECORD_ID_COL, "is_primary"]

MOBILE_NUMBER_LINKED_JOB_SHEET = "mobile_number_linked_jobs"

MOBILE_NUMBER_LINKED_JOB_COLUMNS = [MOBILE_NUMBER_RECORD_ID_COL, "linked_job_ids"]

MOBILE_NUMBER_TYPE_COL = "mobile_number_type"

MOBILE_NUMBER_COLUMNS = ["person_id", MOBILE_NUMBER_RECORD_ID_COL, "mobile_number", MOBILE_NUMBER_TYPE_COL, "phone_calls_flag", "whatsapp_flag"]

DEFAULT_MOBILE_NUMBER_TYPE = "personal"

HIGHER_EDUCATION_SHEET = "higher_education"

HIGHER_EDUCATION_INSTITUTION_COL = "institution_name"

EDUCATION_STATE_COL = "education_state"

HIGHER_EDUCATION_COLUMNS = ["person_id", HIGHER_EDUCATION_INSTITUTION_COL, "major", "degree", "start_date", "end_date", EDUCATION_STATE_COL, "final_gpa"]

EMAIL_SHEET = "emails"

EMAIL_RECORD_ID_COL = "email_record_id"

EMAIL_FAMILY_RELATION_SHEET = "email_family_relations"

EMAIL_FAMILY_RELATION_COLUMNS = [EMAIL_RECORD_ID_COL, "family_relation"]

PERSONAL_EMAIL_PRIMARY_SHEET = "personal_email_primary"

PERSONAL_EMAIL_PRIMARY_COLUMNS = [EMAIL_RECORD_ID_COL, "is_primary"]

EMAIL_LINKED_JOB_SHEET = "email_linked_jobs"

EMAIL_LINKED_JOB_COLUMNS = [EMAIL_RECORD_ID_COL, "linked_job_ids"]

EMAIL_TYPE_COL = "email_type"

EMAIL_COLUMNS = ["person_id", EMAIL_RECORD_ID_COL, "email", EMAIL_TYPE_COL]

DEFAULT_EMAIL_TYPE = "personal"

PERSON_YOUTH_GROUP_SHEET = "person_youth_group"

PERSON_YOUTH_GROUP_RECORD_ID_COL = "person_youth_group_record_id"

PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET = "person_youth_group_age_history"

PERSON_YOUTH_GROUP_AGE_HISTORY_COLUMNS = [PERSON_YOUTH_GROUP_RECORD_ID_COL, "age_group", "start_date", "end_date"]

PERSON_YOUTH_GROUP_APPROVAL_COLUMNS = [

    "yg_approval_status",

    "yg_approved_by",

    "yg_approval_date",

    "yg_approval_notes",

]

PERSON_YOUTH_GROUP_COLUMNS = [

    "person_id",

    PERSON_YOUTH_GROUP_RECORD_ID_COL,

    "youth_join_year",

    "age_group",

    "youth_group_id",

    "archived",

    *PERSON_YOUTH_GROUP_APPROVAL_COLUMNS,

]

AGE_GROUP_ORDER_DESC = ["العاملة", "الجامعيّة", "الثانوي", "الإعدادي", "البراعم"]

AGE_GROUP_ORDER_INDEX = {value: index for index, value in enumerate(AGE_GROUP_ORDER_DESC)}

SOCIAL_MEDIA_SHEET = "social_media"

SOCIAL_MEDIA_COLUMNS = ["person_id", "platform", "url", "is_primary"]

SOCIAL_MEDIA_PLATFORMS = {"facebook", "instagram", "linkedin"}

PARISH_SHEET = "parishes"

PARISH_ID_COL = "parish_id"

PARISH_COLUMNS = [PARISH_ID_COL, "patron_saint", "area", "lpj_url", "facebook_url", "instagram_url", "linkedin_url", "region", "governorate"]

CHURCH_SHEET = "churches"

CHURCH_ID_COL = "church_id"

CHURCH_COLUMNS = [CHURCH_ID_COL, PARISH_ID_COL, "patron_saint", "area", "lat", "lng"]

JOB_SHEET = "jobs"

JOB_ID_COL = "job_id"

EMPLOYER_NAME_COL = "employer_name"

EMPLOYMENT_STATE_COL = "employment_state"

JOB_BASE_COLUMNS = ["person_id", JOB_ID_COL, "job_title", EMPLOYER_NAME_COL, "start_date", "end_date", EMPLOYMENT_STATE_COL]

NO_HIGHER_EDUCATION_COL = "no_higher_education"

NOT_EMPLOYED_COL = "not_employed"

MARITAL_STATUS_COL = "marital_status"

MARITAL_STATUS_SINGLE = "أعزب"

MARITAL_STATUS_ENGAGED = "خاطب"

MARITAL_STATUS_MARRIED = "متزوج"

MARITAL_STATUS_VALUES = {MARITAL_STATUS_SINGLE, MARITAL_STATUS_ENGAGED, MARITAL_STATUS_MARRIED}

SPOUSE_IS_MEMBER_COL = "spouse_is_member"

PERSON_SPOUSE_SHEET = "person_spouse"

PERSON_SPOUSE_COLUMNS = ["person_id", "spouse_person_id"]

SPOUSE_ELIGIBLE_AGE_GROUPS = {"الجامعيّة", "العاملة"}

YOUNG_MARITAL_AGE_GROUPS = {"البراعم", "الإعدادي", "الثانوي", "مرشد روحيّ"}



HEALTH_TYPE_LABELS = {

    'illness': 'حالة صحية',

    'allergy': 'حساسية',

    'surgery': 'عملية جراحية',

    'blood_type': 'فصيلة الدم',

}

EDUCATION_STATE_LABELS = {

    'current': 'حاليًّا',

    'graduated': 'متخرّج',

    'exited': 'منسحب',

    'switched': 'حوّل التخصّص',

}

JOB_STATE_LABELS = {

    'current': 'حاليًّا',

    'previous': 'سابق',

}



RESPONSIBILITY_SHEET = "responsibilities"

RESPONSIBILITY_COLUMNS = ["person_id", "jec_year", "is_current", "responsibility_name", "start_date", "end_date", "youth_group_id"]



UNREG_PERSONS_COLS = [

    "person_id",

    "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name",

    "en_first_name", "en_second_name", "en_third_name", "en_last_name",

    "mother_ar_first_name", "mother_ar_second_name", "mother_ar_last_name",

    "mother_en_first_name", "mother_en_second_name", "mother_en_last_name",

    "gender", "birth_year", "birth_day", "birth_month",

    "registered",

]



PERSON_NAME_COLS = [

    "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name",

]



PERSON_ENGLISH_NAME_COLS = [

    "en_first_name", "en_second_name", "en_third_name", "en_last_name",

]



MOTHER_NAME_COLS = [

    "mother_ar_first_name", "mother_ar_second_name", "mother_ar_last_name",

]



MOTHER_ENGLISH_NAME_COLS = [

    "mother_en_first_name", "mother_en_second_name", "mother_en_last_name",

]



ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}



lock = threading.Lock()

store: dict[str, pd.DataFrame] = {}



unreg_lock = threading.Lock()

unreg_store: dict[str, pd.DataFrame] = {}



# Single shared lock for notifications.json — used by all modules that write notifications.

notif_lock = threading.Lock()



_data_version = 0

_enriched_cache = None

_enriched_cache_version = -1

_members_index_cache = None

_members_index_cache_version = -1

_unreg_index_cache = None

_unreg_index_cache_version = -1

_filters_cache = None

_filters_cache_version = -1



YOUTH_GROUP_ID_COL = "youth_group_id"

YOUTH_GROUP_NAME_COL = "youth_group_name"

YOUTH_GROUP_PATRON_COL = "youth_group_patron"

YOUTH_GROUP_SHORT_NAME_COL = "youth_group_short_name"

ALT_YOUTH_GROUP_PATRON_COL = "شفيع الشبيبة"

ALT_YOUTH_GROUP_SHORT_NAME_COL = "منطقة|اسم مختصر"

YOUTH_GROUP_PARISH_ID_COL = "parish_id"

YOUTH_GROUP_USE_PARISH_LOGO_COL = "use_parish_logo"

YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL = "inherit_parish_social_media"

YOUTH_GROUP_SHEET = "youth_groups"

YOUTH_GROUP_SOCIAL_MEDIA_SHEET = "youth_group_social_media"

YOUTH_GROUP_SOCIAL_MEDIA_ID_COL = "youth_group_social_media_id"

YOUTH_GROUP_SOCIAL_MEDIA_COLUMNS = ["youth_group_id", YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "platform", "url"]

YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_SHEET = "youth_group_social_media_ages"

YOUTH_GROUP_SOCIAL_MEDIA_AGE_GROUP_COLUMNS = [YOUTH_GROUP_SOCIAL_MEDIA_ID_COL, "age_group"]

YOUTH_GROUP_SPECIAL_LOGO_SHEET = "youth_group_special_logos"

SPECIAL_LOGO_ID_COL = "special_logo_id"

YOUTH_GROUP_SPECIAL_LOGO_COLUMNS = ["youth_group_id", SPECIAL_LOGO_ID_COL, "occasion", "start_date", "end_date", "logo_file_name", "is_active"]

NATIONALITY_ISO_SHEET = "lkp_nationality_iso_codes"



SCD_ACTIVE_FROM_COL = "scd_active_from"

SCD_ACTIVE_TO_COL = "scd_active_to"

SCD_CURRENTLY_ACTIVE_FLAG_COL = "scd_currently_active_flag"

SCD_CHANGED_BY_USER_COL = "scd_changed_by_user"

SCD_METADATA_COLUMNS = [SCD_ACTIVE_FROM_COL, SCD_ACTIVE_TO_COL, SCD_CURRENTLY_ACTIVE_FLAG_COL, SCD_CHANGED_BY_USER_COL]



# Registration approval columns

ADMIN_APPROVAL_STATUS_COL = "admin_approval_status"

ADMIN_APPROVAL_BY_COL = "admin_approval_by"

ADMIN_APPROVAL_DATE_COL = "admin_approval_date"

ADMIN_APPROVAL_NOTES_COL = "admin_approval_notes"



YG_APPROVAL_STATUS_COL = "yg_approval_status"

YG_APPROVED_BY_COL = "yg_approved_by"

YG_APPROVAL_DATE_COL = "yg_approval_date"

YG_APPROVAL_NOTES_COL = "yg_approval_notes"



APPROVAL_STATUS_PENDING = "pending"

APPROVAL_STATUS_APPROVED = "approved"

APPROVAL_STATUS_REJECTED = "rejected"

APPROVAL_STATUS_AWAITING_YG = "awaiting_yg"

PERSON_ADDRESS_PROJECTION_COLUMNS = (
    "lat",
    "lng",
    STREET_ADDRESS_COL,
    "country",
    "governorate",
    "city",
    "address",
    "location_url",
)



_youth_group_name_by_id: dict[str, str] = {}

_youth_group_patron_by_id: dict[str, str | None] = {}

_youth_group_short_name_by_id: dict[str, str] = {}

_youth_group_id_by_name: dict[str, str] = {}

_youth_group_id_by_safe_key: dict[str, str] = {}



MONTH_EN_TO_NUM = {

    "jan": 1,

    "feb": 2,

    "mar": 3,

    "apr": 4,

    "may": 5,

    "jun": 6,

    "jul": 7,

    "aug": 8,

    "sep": 9,

    "oct": 10,

    "nov": 11,

    "dec": 12,

}





def _get_or_create_secret_key():

    return db.get_or_create_secret_key()





def _scd_filter_active(df: pd.DataFrame) -> pd.DataFrame:

    """Return only currently-active SCD rows. Returns all rows for sheets without SCD columns (legacy)."""

    if df is None or df.empty:

        return df if df is not None else pd.DataFrame()

    if SCD_CURRENTLY_ACTIVE_FLAG_COL not in df.columns:

        return df

    inactive_mask = _scd_inactive_mask(df[SCD_CURRENTLY_ACTIVE_FLAG_COL])

    return df[~inactive_mask].copy()





def _scd_inactive_mask(flag_series: pd.Series) -> pd.Series:

    """Return True for inactive SCD flags, accepting bools and CSV-loaded strings."""

    bool_false_mask = flag_series == False

    text_false_mask = flag_series.astype(str).str.strip().str.lower().isin({"false", "0", "no", "n", "f"})

    return bool_false_mask | text_false_mask





def _scd_active_mask(df: pd.DataFrame) -> pd.Series:

    """Return True for active SCD rows, accepting bools and CSV-loaded strings."""

    if df is None:

        return pd.Series(dtype=bool)

    if df.empty or SCD_CURRENTLY_ACTIVE_FLAG_COL not in df.columns:

        return pd.Series(True, index=df.index)

    return ~_scd_inactive_mask(df[SCD_CURRENTLY_ACTIVE_FLAG_COL])





def _scd_new_metadata(changed_by: str) -> dict:

    """Return SCD metadata dict for a newly-inserted active row."""

    return {

        SCD_ACTIVE_FROM_COL: _scd_timestamp(),

        SCD_ACTIVE_TO_COL: "",

        SCD_CURRENTLY_ACTIVE_FLAG_COL: True,

        SCD_CHANGED_BY_USER_COL: changed_by or "admin",

    }





def _scd_timestamp() -> str:

    return pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")





def _scd_ensure_columns(df: pd.DataFrame) -> pd.DataFrame:

    """Add SCD metadata columns to df if absent; existing rows default to active (True)."""

    if df is None or df.empty:

        return df if df is not None else pd.DataFrame()

    df = df.copy()

    now = _scd_timestamp()

    for col in SCD_METADATA_COLUMNS:

        if col not in df.columns:

            if col == SCD_ACTIVE_FROM_COL:

                df[col] = now

            elif col == SCD_ACTIVE_TO_COL:

                df[col] = ""

            elif col == SCD_CURRENTLY_ACTIVE_FLAG_COL:

                df[col] = True

            else:

                df[col] = "admin"

    return df





def _scd_val_for_compare(v) -> str:

    if v is None:

        return ""

    s = str(v).strip()

    return "" if s in ("nan", "None", "NaT", "NaN", "<NA>") else s





def _scd_rows_equal(a_rows: list[dict], b_rows: list[dict], cols: list[str]) -> bool:

    """Return True when a_rows and b_rows have identical business data (order-independent)."""

    def sig(row: dict) -> tuple:

        return tuple(_scd_val_for_compare(row.get(c)) for c in cols)

    return sorted(sig(r) for r in a_rows) == sorted(sig(r) for r in b_rows)





def _scd_active_rows(df: pd.DataFrame, key_col: str, key_val: str) -> list[dict]:

    """Active rows for a given key value as plain dicts (NaN → None)."""

    active = _scd_filter_active(df)

    if active.empty or key_col not in active.columns:

        return []

    return active[active[key_col].astype(str) == key_val].replace({pd.NA: None}).to_dict(orient="records")





def _scd_active_satellite_rows(df: pd.DataFrame, rid_col: str, record_ids: set[str]) -> list[dict]:

    """Active satellite rows for a set of parent record_ids as plain dicts."""

    active = _scd_filter_active(df)

    if active.empty or rid_col not in active.columns or not record_ids:

        return []

    return active[active[rid_col].astype(str).isin(record_ids)].replace({pd.NA: None}).to_dict(orient="records")





def _scd_preserve_metadata(rows: list[dict], source_rows: list[dict], key_col: str) -> list[dict]:

    """Re-attach SCD metadata from source_rows onto rows by matching on key_col."""

    lookup: dict[str, dict] = {}

    for src in source_rows:

        k = str(src.get(key_col) or "")

        if k and k not in lookup:

            lookup[k] = {c: src.get(c) for c in SCD_METADATA_COLUMNS}

    default_scd = {SCD_ACTIVE_FROM_COL: None, SCD_ACTIVE_TO_COL: None,

                   SCD_CURRENTLY_ACTIVE_FLAG_COL: True, SCD_CHANGED_BY_USER_COL: None}

    return [{**row, **lookup.get(str(row.get(key_col) or ""), default_scd)} for row in rows]





def _scd_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:

    """Split a DataFrame into (active_df, inactive_df) based on scd_currently_active_flag."""

    if df.empty or SCD_CURRENTLY_ACTIVE_FLAG_COL not in df.columns:

        return df, pd.DataFrame(columns=df.columns)

    inactive_mask = _scd_inactive_mask(df[SCD_CURRENTLY_ACTIVE_FLAG_COL])

    return df[~inactive_mask].copy(), df[inactive_mask].copy()





def _scd_sheet_active_df(sheet_name: str, columns: list[str] | None = None) -> pd.DataFrame:

    df = _scd_filter_active(store.get(sheet_name, pd.DataFrame()).copy())

    if columns is not None:

        for col in columns:

            if col not in df.columns:

                df[col] = None

        return df[columns].copy()

    return df





def _scd_row_key(row: dict, key_columns: list[str]) -> tuple[str, ...]:

    return tuple(_scd_val_for_compare(row.get(col)) for col in key_columns)





def _scd_replace_rows_by_key(

    target_store: dict[str, pd.DataFrame],

    sheet_name: str,

    rows: list[dict],

    business_columns: list[str],

    key_columns: list[str],

    *,

    changed_by: str = "admin",

) -> bool:

    """Replace the active business rows for a sheet using SCD close-and-insert semantics."""

    existing = _scd_ensure_columns(target_store.get(sheet_name, pd.DataFrame()).copy())

    for col in business_columns:

        if col not in existing.columns:

            existing[col] = None



    active_df, inactive_df = _scd_split(existing)

    inactive_rows = inactive_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_df.empty else []

    active_rows = active_df.replace({np.nan: None}).to_dict(orient="records") if not active_df.empty else []



    old_active_by_key: dict[tuple[str, ...], list[dict]] = {}

    for row in active_rows:

        key = _scd_row_key(row, key_columns)

        if all(part == "" for part in key):

            continue

        old_active_by_key.setdefault(key, []).append(row)



    new_by_key: dict[tuple[str, ...], dict] = {}

    new_key_order: list[tuple[str, ...]] = []

    for raw_row in rows or []:

        new_row = {col: raw_row.get(col) for col in business_columns}

        key = _scd_row_key(new_row, key_columns)

        if all(part == "" for part in key) or key in new_by_key:

            continue

        new_by_key[key] = new_row

        new_key_order.append(key)



    now = _scd_timestamp()

    final_rows: list[dict] = list(inactive_rows)

    changed = False



    for key in new_key_order:

        new_row = new_by_key[key]

        old_rows = old_active_by_key.get(key, [])

        old_row = old_rows[0] if old_rows else None



        if old_row is None:

            final_rows.append({**new_row, **_scd_new_metadata(changed_by)})

            changed = True

            continue



        unchanged = all(

            _scd_val_for_compare(old_row.get(col)) == _scd_val_for_compare(new_row.get(col))

            for col in business_columns

        )

        if unchanged:

            final_rows.append(old_row)

        else:

            closed = dict(old_row)

            closed[SCD_ACTIVE_TO_COL] = now

            closed[SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            closed[SCD_CHANGED_BY_USER_COL] = changed_by

            final_rows.append(closed)

            final_rows.append({**new_row, **_scd_new_metadata(changed_by)})

            changed = True



        for duplicate_old in old_rows[1:]:

            closed = dict(duplicate_old)

            closed[SCD_ACTIVE_TO_COL] = now

            closed[SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            closed[SCD_CHANGED_BY_USER_COL] = changed_by

            final_rows.append(closed)

            changed = True



    for key, old_rows in old_active_by_key.items():

        if key in new_by_key:

            continue

        for old_row in old_rows:

            closed = dict(old_row)

            closed[SCD_ACTIVE_TO_COL] = now

            closed[SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            closed[SCD_CHANGED_BY_USER_COL] = changed_by

            final_rows.append(closed)

            changed = True



    final_columns = business_columns + [col for col in SCD_METADATA_COLUMNS if col not in business_columns]

    target_store[sheet_name] = pd.DataFrame(final_rows, columns=final_columns)

    return changed





def invalidate_enriched_cache():

    global _data_version, _enriched_cache, _enriched_cache_version, _members_index_cache, _members_index_cache_version, _unreg_index_cache, _unreg_index_cache_version, _filters_cache, _filters_cache_version

    _data_version += 1

    _enriched_cache = None

    _enriched_cache_version = -1

    _members_index_cache = None

    _members_index_cache_version = -1

    _unreg_index_cache = None

    _unreg_index_cache_version = -1

    _filters_cache = None

    _filters_cache_version = -1





def cache_state():

    return _enriched_cache, _enriched_cache_version, _data_version





def set_enriched_cache(payload, version):

    global _enriched_cache, _enriched_cache_version

    _enriched_cache = payload

    _enriched_cache_version = version





def members_index_cache_state():

    return _members_index_cache, _members_index_cache_version, _data_version





def set_members_index_cache(payload, version):

    global _members_index_cache, _members_index_cache_version

    _members_index_cache = json_safe(payload)

    _members_index_cache_version = version


def filters_cache_state():

    return _filters_cache, _filters_cache_version, _data_version


def set_filters_cache(payload, version):

    global _filters_cache, _filters_cache_version

    _filters_cache = payload

    _filters_cache_version = version





def unreg_index_cache_state():

    return _unreg_index_cache, _unreg_index_cache_version, _data_version





def set_unreg_index_cache(payload, version):

    global _unreg_index_cache, _unreg_index_cache_version

    _unreg_index_cache = payload

    _unreg_index_cache_version = version





def _console_print(message):

    try:

        print(message)

    except UnicodeEncodeError:

        stream = sys.stdout

        encoding = getattr(stream, "encoding", None) or "utf-8"

        safe_message = str(message).encode(encoding, errors="replace").decode(encoding, errors="replace")

        stream.write(safe_message + "\n")

        stream.flush()





def load():

    global store

    store = db.load_excel_sheets(SHEETS)

    _console_print(f"✅ Loaded {len(store)} sheets from CSV.")





def safe_youth_group_key(value: str | None) -> str:

    if value is None:

        return ""

    return re.sub(r"[^\w\u0600-\u06FF]", "_", str(value).strip())





def _normalize_text(v) -> str | None:

    if v is None:

        return None

    text = str(v).replace("\r\n", "\n").replace("\r", "\n").strip()

    if text in ("", "nan", "None", "null"):

        return None

    collapsed = "\n".join(" ".join(line.split()) for line in text.split("\n")).strip()

    if collapsed in ("", "nan", "None", "null"):

        return None

    return collapsed





def _first_present(row: dict | None, *keys: str):

    payload = row if isinstance(row, dict) else {}

    for key in keys:

        if key in payload:

            return payload.get(key)

    return None





def _normalize_lookup_text(value) -> str:

    text = _normalize_text(value) or ""

    return re.sub(r"\s+", " ", text).strip().replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").lower()





def _to_bool(v) -> bool:

    if isinstance(v, bool):

        return v

    if v is None:

        return False

    text = str(v).strip().lower()

    return text in ("1", "true", "yes", "y", "t")





def _normalize_country(v) -> str:

    text = _normalize_text(v)

    if not text:

        return DEFAULT_COUNTRY



    english_key = re.sub(r"\s+", " ", text).strip().lower()

    arabic_key = re.sub(r"\s+", " ", text).strip()

    arabic_key = arabic_key.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")



    if english_key in {"jordan", "the hashemite kingdom of jordan"}:

        return DEFAULT_COUNTRY



    if arabic_key in {"الاردن", "المملكة الاردنية الهاشمية"}:

        return DEFAULT_COUNTRY



    return text





def _normalize_mobile_number_value(value) -> str | None:

    if value is None:

        return None

    text = str(value).strip()

    if text in ("", "nan", "None", "null"):

        return None

    if text.endswith(".0") and text.replace(".", "", 1).replace("-", "", 1).isdigit():

        text = text[:-2]

    return text





def _normalize_mobile_number_type(value) -> str:

    text = _normalize_text(value)

    if not text:

        return DEFAULT_MOBILE_NUMBER_TYPE

    lowered = text.lower()

    if lowered.startswith("family:"):

        return "family"

    known_types = {"personal", "work", "home", "family", "other"}

    if lowered in known_types:

        return lowered

    return text





def _normalize_family_relation(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    return re.sub(r"\s+", " ", text).strip()





def _extract_family_relation_from_mobile_type(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    prefix = "family:"

    if text.lower().startswith(prefix):

        return _normalize_family_relation(text[len(prefix):])

    return None





def _normalize_school_record_id(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    text = text.upper()

    if re.fullmatch(r"SC\d{6}", text):

        return text

    return None





def _normalize_mobile_number_record_id(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    text = text.upper()

    if re.fullmatch(r"MB\d{6}", text):

        return text

    return None





def _mobile_number_record_sequence(value) -> int | None:

    record_id = _normalize_mobile_number_record_id(value)

    if not record_id:

        return None

    return int(record_id[2:])





def _format_mobile_number_record_id(sequence: int) -> str:

    return f"MB{sequence:06d}"





def _next_mobile_number_record_sequence() -> int:

    max_sequence = 0

    for source in (store, unreg_store):

        df = source.get(MOBILE_NUMBER_SHEET, pd.DataFrame()) if isinstance(source, dict) else pd.DataFrame()

        if df.empty or MOBILE_NUMBER_RECORD_ID_COL not in df.columns:

            continue

        for raw_value in df[MOBILE_NUMBER_RECORD_ID_COL].tolist():

            sequence = _mobile_number_record_sequence(raw_value)

            if sequence is not None and sequence > max_sequence:

                max_sequence = sequence

    return max_sequence + 1





def _school_record_sequence(value) -> int | None:

    record_id = _normalize_school_record_id(value)

    if not record_id:

        return None

    return int(record_id[2:])





def _format_school_record_id(sequence: int) -> str:

    return f"SC{sequence:06d}"





def _next_school_record_sequence() -> int:

    max_sequence = 0

    for source in (store, unreg_store):

        df = source.get(SCHOOL_SHEET, pd.DataFrame()) if isinstance(source, dict) else pd.DataFrame()

        if df.empty or SCHOOL_RECORD_ID_COL not in df.columns:

            continue

        for raw_value in df[SCHOOL_RECORD_ID_COL].tolist():

            sequence = _school_record_sequence(raw_value)

            if sequence is not None and sequence > max_sequence:

                max_sequence = sequence

    return max_sequence + 1





def _normalize_school_grade_value(value) -> str | None:

    return _normalize_text(value)





def _normalize_final_gpa(value) -> str | None:

    text = _normalize_text(value)

    return text or None





def _normalize_person_school_final_gpa(value) -> float | None:

    text = _normalize_text(value)

    if not text:

        return None

    try:

        return float(text)

    except (TypeError, ValueError):

        return None





def normalize_school_status(value, *, has_current_school: bool = False) -> str:

    text = _normalize_text(value)

    if text in SCHOOL_STATUS_VALUES:

        return text



    lowered = str(text or "").strip().lower()

    if lowered in ("1", "true", "yes", "y", "t"):

        return SCHOOL_STATUS_GRADUATED

    if lowered in ("0", "false", "no", "n", "f"):

        return SCHOOL_STATUS_STUDYING if has_current_school else SCHOOL_STATUS_NOT_ENROLLED



    if text:

        simplified = re.sub(r"\s+", " ", text).strip()

        if simplified in ("متخرّج من المدارس", "متخرج من المدارس"):

            return SCHOOL_STATUS_GRADUATED

        if simplified in ("على مقاعد الدراسة", "طالب", "حاليًّا", "حاليا", "حالي"):

            return SCHOOL_STATUS_STUDYING

        if simplified in ("غير ملتزم بدراسة مدرسية", "غير ملتزم بدراسة مدرسيّة", "لا يدرس"):

            return SCHOOL_STATUS_NOT_ENROLLED



    return SCHOOL_STATUS_STUDYING if has_current_school else SCHOOL_STATUS_NOT_ENROLLED





def _active_person_ids_for_sheet(df: pd.DataFrame | None) -> set[str]:

    active_df = _scd_filter_active(df)

    if active_df.empty or "person_id" not in active_df.columns:

        return set()

    return {

        str(pid).strip()

        for pid in active_df["person_id"].dropna().astype(str).tolist()

        if str(pid).strip()

    }





def _active_current_school_person_ids(df: pd.DataFrame | None) -> set[str]:

    active_df = _scd_filter_active(df)

    if active_df.empty or "person_id" not in active_df.columns or "is_current" not in active_df.columns:

        return set()

    current_mask = active_df["is_current"].apply(_to_bool)

    return {

        str(pid).strip()

        for pid in active_df[current_mask]["person_id"].dropna().astype(str).tolist()

        if str(pid).strip()

    }





def _school_grade_values_from_value(value) -> list[str]:

    if isinstance(value, (list, tuple, set)):

        source = list(value)

    else:

        source = str(value or "").split("|")



    grades: list[str] = []

    seen: set[str] = set()

    for raw_value in source:

        grade = _normalize_school_grade_value(raw_value)

        if not grade or grade in seen:

            continue

        seen.add(grade)

        grades.append(grade)

    return grades





def _normalize_email_type(value) -> str:

    text = _normalize_text(value)

    if not text:

        return DEFAULT_EMAIL_TYPE

    lowered = text.lower()

    if lowered.startswith("family:"):

        return "family"

    if lowered in {"personal", "work", "family"}:

        return lowered

    return text





def _extract_family_relation_from_email_type(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    prefix = "family:"

    if text.lower().startswith(prefix):

        return _normalize_family_relation(text[len(prefix):])

    return None





def _normalize_email_record_id(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    text = text.upper()

    if re.fullmatch(r"EM\d{6}", text):

        return text

    return None





def _email_record_sequence(value) -> int | None:

    record_id = _normalize_email_record_id(value)

    if not record_id:

        return None

    return int(record_id[2:])





def _format_email_record_id(sequence: int) -> str:

    return f"EM{sequence:06d}"





def _next_email_record_sequence() -> int:

    max_sequence = 0

    for source in (store, unreg_store):

        df = source.get(EMAIL_SHEET, pd.DataFrame()) if isinstance(source, dict) else pd.DataFrame()

        if df.empty or EMAIL_RECORD_ID_COL not in df.columns:

            continue

        for raw_value in df[EMAIL_RECORD_ID_COL].tolist():

            sequence = _email_record_sequence(raw_value)

            if sequence is not None and sequence > max_sequence:

                max_sequence = sequence

    return max_sequence + 1





def _normalize_person_youth_group_record_id(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    text = text.upper()

    if re.fullmatch(r"PRYG\d{6}", text):

        return text

    return None





def _person_youth_group_record_sequence(value) -> int | None:

    record_id = _normalize_person_youth_group_record_id(value)

    if not record_id:

        return None

    return int(record_id[4:])





def _format_person_youth_group_record_id(sequence: int) -> str:

    return f"PRYG{sequence:06d}"





def _next_person_youth_group_record_sequence() -> int:

    max_sequence = 0

    for source in (store, unreg_store):

        df = source.get(PERSON_YOUTH_GROUP_SHEET, pd.DataFrame()) if isinstance(source, dict) else pd.DataFrame()

        if df.empty or PERSON_YOUTH_GROUP_RECORD_ID_COL not in df.columns:

            continue

        for raw_value in df[PERSON_YOUTH_GROUP_RECORD_ID_COL].tolist():

            sequence = _person_youth_group_record_sequence(raw_value)

            if sequence is not None and sequence > max_sequence:

                max_sequence = sequence

    return max_sequence + 1





def _normalize_social_media_platform(value) -> str:

    text = _normalize_text(value)

    if not text:

        return "facebook"

    lowered = text.lower()

    if lowered in SOCIAL_MEDIA_PLATFORMS:

        return lowered

    return text





def _generate_record_id(prefix: str) -> str:

    return f"{prefix}_{uuid.uuid4().hex[:12]}"





def _normalize_job_id(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    text = text.upper()

    if re.fullmatch(r"JB\d{5}", text):

        return text

    return None





def _job_id_sequence(value) -> int | None:

    job_id = _normalize_job_id(value)

    if not job_id:

        return None

    return int(job_id[2:])





def _format_job_id(sequence: int) -> str:

    return f"JB{sequence:05d}"





def _next_job_id_sequence() -> int:

    max_sequence = 0

    for source in (store, unreg_store):

        df = source.get(JOB_SHEET, pd.DataFrame()) if isinstance(source, dict) else pd.DataFrame()

        if df.empty or JOB_ID_COL not in df.columns:

            continue

        for raw_value in df[JOB_ID_COL].tolist():

            sequence = _job_id_sequence(raw_value)

            if sequence is not None and sequence > max_sequence:

                max_sequence = sequence

    return max_sequence + 1





def _normalize_job_id_key(value) -> str | None:

    text = _normalize_text(value)

    return text or None





def normalize_youth_group_special_logo_rows(rows) -> list[dict]:

    normalized = []

    seen: set[tuple[str, str]] = set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        group_id = _normalize_text(row.get("youth_group_id"))

        logo_id = _normalize_text(_first_present(row, SPECIAL_LOGO_ID_COL, "id"))

        occasion = _normalize_text(row.get("occasion"))

        start_date = _normalize_text(row.get("start_date"))

        end_date = _normalize_text(row.get("end_date"))

        file_name = _normalize_text(_first_present(row, "logo_file_name", "file_name"))

        is_active = _to_bool(row.get("is_active"))



        if not group_id or not logo_id or not file_name:

            continue



        dedupe_key = (group_id, logo_id)

        if dedupe_key in seen:

            continue

        seen.add(dedupe_key)



        normalized.append({

            "youth_group_id": group_id,

            SPECIAL_LOGO_ID_COL: logo_id,

            "occasion": occasion,

            "start_date": start_date,

            "end_date": None if is_active else end_date,

            "logo_file_name": file_name,

            "is_active": is_active,

        })



    return normalized





def _normalize_linked_job_ids(value) -> list[str]:

    raw_ids = []

    if isinstance(value, list):

        raw_ids = value

    elif isinstance(value, tuple):

        raw_ids = list(value)

    else:

        text = _normalize_text(value)

        if text:

            try:

                parsed = json.loads(text)

                if isinstance(parsed, list):

                    raw_ids = parsed

                elif parsed is not None:

                    raw_ids = [parsed]

            except (TypeError, ValueError, json.JSONDecodeError):

                raw_ids = re.split(r"\s*[,|]\s*", text)



    normalized = []

    seen = set()

    for item in raw_ids:

        job_id = _normalize_text(item)

        if not job_id or job_id in seen:

            continue

        seen.add(job_id)

        normalized.append(job_id)

    return normalized





def _serialize_linked_job_ids(value) -> str | None:

    linked_job_ids = _normalize_linked_job_ids(value)

    if not linked_job_ids:

        return None

    return json.dumps(linked_job_ids, ensure_ascii=False)





def _remap_linked_job_ids_value(value, id_map: dict[str, str] | None = None) -> list[str]:

    normalized = []

    seen: set[str] = set()

    mappings = id_map or {}

    for job_id in _normalize_linked_job_ids(value):

        mapped = mappings.get(job_id, mappings.get(str(job_id), job_id))

        mapped_id = _normalize_job_id(mapped)

        if not mapped_id or mapped_id in seen:

            continue

        seen.add(mapped_id)

        normalized.append(mapped_id)

    return normalized





def remap_job_links_in_email_rows(rows, id_map: dict[str, str] | None = None) -> list[dict]:

    remapped = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        next_row = dict(row)

        next_row["linked_job_ids"] = _remap_linked_job_ids_value(row.get("linked_job_ids"), id_map)

        remapped.append(next_row)

    return remapped





def remap_job_links_in_mobile_rows(rows, id_map: dict[str, str] | None = None) -> list[dict]:

    remapped = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        next_row = dict(row)

        next_row["linked_job_ids"] = _remap_linked_job_ids_value(row.get("linked_job_ids"), id_map)

        remapped.append(next_row)

    return remapped





def _to_bool_default_true(v) -> bool:

    if v is None:

        return True

    if isinstance(v, str) and v.strip() in ("", "nan", "None", "null"):

        return True

    return _to_bool(v)





def _normalize_coordinate(value, axis: str) -> float | None:

    if value is None:

        return None

    try:

        num = float(value)

    except (TypeError, ValueError):

        return None

    if axis == "lat":

        if num < -90 or num > 90:

            return None

    else:

        if num < -180 or num > 180:

            return None

    return num





def _is_placeholder_coordinate_pair(lat: float | None, lng: float | None) -> bool:

    return lat == 0.0 and lng == 0.0





def _is_allowed_google_maps_host(hostname: str | None) -> bool:

    host = (hostname or "").strip().lower()

    if not host:

        return False

    if host == "goo.gl" or host.endswith(".goo.gl"):

        return True

    return host == "google.com" or host.endswith(".google.com") or ".google." in host





def _extract_coordinate_pair(text: str | None):

    source = str(text or "")

    patterns = [

        (re.compile(r"!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)"), False),

        (re.compile(r"!4d(-?\d{1,3}(?:\.\d+)?)!3d(-?\d{1,3}(?:\.\d+)?)"), True),

        (re.compile(r"@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)"), False),

        (re.compile(r"(-?\d{1,3}(?:\.\d+)?),\+(-?\d{1,3}(?:\.\d+)?)"), False),

        (re.compile(r"(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)"), False),

    ]



    for pattern, reversed_order in patterns:

        match = pattern.search(source)

        if not match:

            continue

        lat_raw = match.group(2) if reversed_order else match.group(1)

        lng_raw = match.group(1) if reversed_order else match.group(2)

        lat = _normalize_coordinate(lat_raw, "lat")

        lng = _normalize_coordinate(lng_raw, "lng")

        if lat is not None and lng is not None:

            return lat, lng

    return None, None





def resolve_google_maps_coordinates(raw_url: str):

    text = str(raw_url or "").strip()

    if not text:

        return None, None



    try:

        parsed = urlparse(text)

    except ValueError:

        return None, None



    if parsed.scheme not in {"http", "https"}:

        return None, None

    if not _is_allowed_google_maps_host(parsed.hostname):

        return None, None



    candidates = [text, unquote(text), parsed.path, unquote(parsed.path)]

    query_pairs = parsed.query.split("&") if parsed.query else []

    for pair in query_pairs:

        if "=" not in pair:

            continue

        _, value = pair.split("=", 1)

        if value:

            candidates.append(value)

            candidates.append(unquote(value))



    for candidate in candidates:

        lat, lng = _extract_coordinate_pair(candidate)

        if lat is not None and lng is not None:

            return lat, lng



    request_obj = Request(text, headers={"User-Agent": "Mozilla/5.0"})

    try:

        with urlopen(request_obj, timeout=10) as response:

            final_url = response.geturl()

            if final_url != text and _is_allowed_google_maps_host(urlparse(final_url).hostname):

                lat, lng = resolve_google_maps_coordinates(final_url)

                if lat is not None and lng is not None:

                    return lat, lng

            try:

                content = response.read(65536).decode("utf-8", errors="ignore")

            except Exception:

                return None, None

            return _extract_coordinate_pair(content)

    except Exception:

        return None, None





def normalize_address_rows(rows) -> list[dict]:

    normalized = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        person_id = _normalize_person_id(row.get("person_id"))

        governorate = _normalize_text(row.get("governorate"))

        city = _normalize_text(row.get("city"))

        address = _normalize_text(_first_present(row, STREET_ADDRESS_COL, "address"))

        country = _normalize_country(row.get("country"))

        lat = _normalize_coordinate(row.get("lat"), "lat")

        lng = _normalize_coordinate(row.get("lng"), "lng")

        location_url = _normalize_text(row.get("location_url"))

        if (lat is None or lng is None) and location_url:

            resolved_lat, resolved_lng = resolve_google_maps_coordinates(location_url)

            lat = resolved_lat if resolved_lat is not None else lat

            lng = resolved_lng if resolved_lng is not None else lng

        if _is_placeholder_coordinate_pair(lat, lng):

            lat = None

            lng = None

        is_primary = _to_bool(row.get("is_primary"))

        has_location = lat is not None or lng is not None

        has_location_reference = has_location or bool(location_url)

        if person_id in (None, "") and not (governorate or city or address or has_location_reference):

            continue

        if not governorate and not city and not address and not has_location_reference:

            continue

        normalized.append({

            "person_id": person_id,

            "country": country,

            "governorate": governorate,

            "city": city,

            STREET_ADDRESS_COL: address,

            "address": address,

            "lat": lat,

            "lng": lng,

            "is_primary": is_primary,

        })



    grouped: dict[str, list[dict]] = {}

    for row in normalized:

        key = str(row.get("person_id"))

        grouped.setdefault(key, []).append(row)



    result = []

    for entries in grouped.values():

        primary_index = next((index for index, entry in enumerate(entries) if entry.get("is_primary")), 0)

        for index, entry in enumerate(entries):

            entry["is_primary"] = index == primary_index

            result.append(entry)

    return result





def normalize_mobile_number_rows(rows) -> list[dict]:

    normalized = []

    used_record_ids: set[str] = set()

    next_sequence = _next_mobile_number_record_sequence()

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        mobile_number = _normalize_mobile_number_value(row.get("mobile_number"))

        if not mobile_number:

            continue

        raw_type = _first_present(row, MOBILE_NUMBER_TYPE_COL, "type")

        mobile_type = _normalize_mobile_number_type(raw_type)

        family_relation = _normalize_family_relation(row.get("family_relation"))

        if mobile_type == "family" and family_relation is None:

            family_relation = _extract_family_relation_from_mobile_type(raw_type)

        if mobile_type != "family":

            family_relation = None

        linked_job_ids = _normalize_linked_job_ids(row.get("linked_job_ids")) if mobile_type == "work" else []

        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        if record_id and record_id not in used_record_ids:

            used_record_ids.add(record_id)

        else:

            while True:

                candidate = _format_mobile_number_record_id(next_sequence)

                next_sequence += 1

                if candidate not in used_record_ids:

                    record_id = candidate

                    used_record_ids.add(candidate)

                    break

        normalized.append({

            "person_id": _normalize_person_id(row.get("person_id")),

            MOBILE_NUMBER_RECORD_ID_COL: record_id,

            "mobile_number": mobile_number,

            MOBILE_NUMBER_TYPE_COL: mobile_type,

            "type": mobile_type,

            "family_relation": family_relation,

            "is_primary": _to_bool(row.get("is_primary")) if mobile_type == "personal" else False,

            "phone_calls_flag": _to_bool_default_true(row.get("phone_calls_flag")),

            "whatsapp_flag": _to_bool_default_true(row.get("whatsapp_flag")),

            "linked_job_ids": linked_job_ids,

        })



    grouped: dict[str, list[dict]] = {}

    for row in normalized:

        key = str(row.get("person_id"))

        grouped.setdefault(key, []).append(row)



    result = []

    for entries in grouped.values():

        primary_seen = False

        for entry in entries:

            if entry.get(MOBILE_NUMBER_TYPE_COL) != "personal":

                entry["is_primary"] = False

            elif entry.get("is_primary") and not primary_seen:

                primary_seen = True

            else:

                entry["is_primary"] = False

            result.append(entry)

    return result





def normalize_mobile_number_family_relation_rows(rows, valid_record_ids: set[str] | None = None) -> list[dict]:

    normalized = []

    seen: set[str] = set()

    allowed_record_ids = valid_record_ids or set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        if not record_id:

            continue

        if allowed_record_ids and record_id not in allowed_record_ids:

            continue



        family_relation = _normalize_family_relation(row.get("family_relation"))

        if not family_relation:

            continue

        if record_id in seen:

            continue

        seen.add(record_id)



        normalized.append({

            MOBILE_NUMBER_RECORD_ID_COL: record_id,

            "family_relation": family_relation,

        })



    return normalized





def mobile_number_family_relation_rows_from_mobile_rows(rows) -> list[dict]:

    family_rows = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        family_relation = _normalize_family_relation(row.get("family_relation"))

        if not record_id or not family_relation:

            continue

        family_rows.append({

            MOBILE_NUMBER_RECORD_ID_COL: record_id,

            "family_relation": family_relation,

        })

    return normalize_mobile_number_family_relation_rows(family_rows)





def normalize_personal_mobile_number_primary_rows(rows, valid_record_ids: set[str] | None = None) -> list[dict]:

    normalized = []

    seen: set[str] = set()

    allowed_record_ids = valid_record_ids or set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        if not record_id:

            continue

        if allowed_record_ids and record_id not in allowed_record_ids:

            continue

        if record_id in seen:

            continue



        seen.add(record_id)

        normalized.append({

            MOBILE_NUMBER_RECORD_ID_COL: record_id,

            "is_primary": _to_bool(row.get("is_primary")),

        })



    return normalized





def personal_mobile_number_primary_rows_from_mobile_rows(rows) -> list[dict]:

    primary_rows = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        mobile_type = _normalize_mobile_number_type(_first_present(row, MOBILE_NUMBER_TYPE_COL, "type"))

        if not record_id or mobile_type != "personal":

            continue



        primary_rows.append({

            MOBILE_NUMBER_RECORD_ID_COL: record_id,

            "is_primary": _to_bool(row.get("is_primary")),

        })



    return normalize_personal_mobile_number_primary_rows(primary_rows)





def normalize_mobile_number_linked_job_rows(rows, valid_record_ids: set[str] | None = None) -> list[dict]:

    normalized = []

    seen: set[tuple[str, str]] = set()

    allowed_record_ids = valid_record_ids or set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        if not record_id:

            continue

        if allowed_record_ids and record_id not in allowed_record_ids:

            continue



        for job_id in _normalize_linked_job_ids(row.get("linked_job_ids")):

            dedupe_key = (record_id, job_id)

            if dedupe_key in seen:

                continue

            seen.add(dedupe_key)

            normalized.append({

                MOBILE_NUMBER_RECORD_ID_COL: record_id,

                "linked_job_ids": job_id,

            })



    return normalized





def mobile_number_linked_job_rows_from_mobile_rows(rows) -> list[dict]:

    linked_job_rows = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        if not record_id:

            continue

        for job_id in _normalize_linked_job_ids(row.get("linked_job_ids")):

            linked_job_rows.append({

                MOBILE_NUMBER_RECORD_ID_COL: record_id,

                "linked_job_ids": job_id,

            })

    return normalize_mobile_number_linked_job_rows(linked_job_rows)





def mobile_number_rows_for_person(source_store: dict[str, pd.DataFrame], person_id) -> list[dict]:

    mobile_numbers_df = _scd_filter_active(source_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame()))

    normalized_person_id = _normalize_person_id(person_id)

    if mobile_numbers_df.empty or "person_id" not in mobile_numbers_df.columns or normalized_person_id in (None, ""):

        return []



    person_key = str(normalized_person_id)

    rows = df_to_json(mobile_numbers_df[mobile_numbers_df["person_id"].astype(str) == person_key])

    if not rows:

        return []



    person_record_ids = {

        record_id

        for record_id in (

            _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

            for row in rows

        )

        if record_id

    }



    family_df = _scd_filter_active(source_store.get(MOBILE_NUMBER_FAMILY_RELATION_SHEET, pd.DataFrame()))

    family_map: dict[str, str] = {}

    if not family_df.empty and MOBILE_NUMBER_RECORD_ID_COL in family_df.columns:

        family_rows = normalize_mobile_number_family_relation_rows(

            family_df.replace({np.nan: None}).to_dict(orient="records"),

            person_record_ids,

        )

        for family_row in family_rows:

            record_id = family_row.get(MOBILE_NUMBER_RECORD_ID_COL)

            family_relation = family_row.get("family_relation")

            if record_id and family_relation:

                family_map[record_id] = family_relation



    personal_primary_df = _scd_filter_active(source_store.get(PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET, pd.DataFrame()))

    personal_primary_map: dict[str, bool] = {}

    if not personal_primary_df.empty and MOBILE_NUMBER_RECORD_ID_COL in personal_primary_df.columns:

        personal_primary_rows = normalize_personal_mobile_number_primary_rows(

            personal_primary_df.replace({np.nan: None}).to_dict(orient="records"),

            person_record_ids,

        )

        for primary_row in personal_primary_rows:

            record_id = primary_row.get(MOBILE_NUMBER_RECORD_ID_COL)

            if record_id:

                personal_primary_map[record_id] = _to_bool(primary_row.get("is_primary"))



    linked_jobs_df = _scd_filter_active(source_store.get(MOBILE_NUMBER_LINKED_JOB_SHEET, pd.DataFrame()))

    linked_job_map: dict[str, list[str]] = {}

    if not linked_jobs_df.empty and MOBILE_NUMBER_RECORD_ID_COL in linked_jobs_df.columns:

        linked_job_rows = normalize_mobile_number_linked_job_rows(

            linked_jobs_df.replace({np.nan: None}).to_dict(orient="records"),

            person_record_ids,

        )

        for linked_job_row in linked_job_rows:

            record_id = linked_job_row.get(MOBILE_NUMBER_RECORD_ID_COL)

            job_id = linked_job_row.get("linked_job_ids")

            if record_id and job_id:

                linked_job_map.setdefault(record_id, []).append(job_id)



    for row in rows:

        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        family_relation = family_map.get(record_id)

        row["family_relation"] = family_relation

        linked_job_ids = linked_job_map.get(record_id, [])

        if family_relation:

            row[MOBILE_NUMBER_TYPE_COL] = "family"

            row["type"] = "family"

        elif linked_job_ids:

            row[MOBILE_NUMBER_TYPE_COL] = "work"

            row["type"] = "work"

        else:

            row[MOBILE_NUMBER_TYPE_COL] = _normalize_mobile_number_type(_first_present(row, MOBILE_NUMBER_TYPE_COL, "type"))

            row["type"] = row[MOBILE_NUMBER_TYPE_COL]

        row["is_primary"] = personal_primary_map.get(record_id, False) if row[MOBILE_NUMBER_TYPE_COL] == "personal" else False

        row["linked_job_ids"] = linked_job_ids



    return normalize_mobile_number_rows(rows)





def replace_mobile_number_rows(target_store: dict[str, pd.DataFrame], person_id, rows, changed_by: str = "system"):

    normalized_person_id = _normalize_person_id(person_id)

    person_key = str(normalized_person_id)

    payload_rows = []

    for row in normalize_mobile_number_rows(rows):

        payload_rows.append({**row, "person_id": normalized_person_id})



    mobile_rows = [{col: row.get(col) for col in MOBILE_NUMBER_COLUMNS} for row in payload_rows]

    family_rows = mobile_number_family_relation_rows_from_mobile_rows(payload_rows)

    personal_primary_rows = personal_mobile_number_primary_rows_from_mobile_rows(payload_rows)

    linked_job_rows = mobile_number_linked_job_rows_from_mobile_rows(payload_rows)



    existing_mobile = _scd_active_rows(target_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame()), "person_id", person_key)

    existing_rids = {

        _normalize_mobile_number_record_id(r.get(MOBILE_NUMBER_RECORD_ID_COL))

        for r in existing_mobile

        if _normalize_mobile_number_record_id(r.get(MOBILE_NUMBER_RECORD_ID_COL))

    }

    if _scd_rows_equal(existing_mobile, mobile_rows, MOBILE_NUMBER_COLUMNS):

        existing_family = _scd_active_satellite_rows(

            target_store.get(MOBILE_NUMBER_FAMILY_RELATION_SHEET, pd.DataFrame()),

            MOBILE_NUMBER_RECORD_ID_COL, existing_rids)

        existing_prim = _scd_active_satellite_rows(

            target_store.get(PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET, pd.DataFrame()),

            MOBILE_NUMBER_RECORD_ID_COL, existing_rids)

        existing_lnk = _scd_active_satellite_rows(

            target_store.get(MOBILE_NUMBER_LINKED_JOB_SHEET, pd.DataFrame()),

            MOBILE_NUMBER_RECORD_ID_COL, existing_rids)

        if (_scd_rows_equal(existing_family, family_rows, MOBILE_NUMBER_FAMILY_RELATION_COLUMNS) and

                _scd_rows_equal(existing_prim, personal_primary_rows, PERSONAL_MOBILE_NUMBER_PRIMARY_COLUMNS) and

                _scd_rows_equal(existing_lnk, linked_job_rows, MOBILE_NUMBER_LINKED_JOB_COLUMNS)):

            return



    now = _scd_timestamp()

    new_scd = _scd_new_metadata(changed_by)



    mobile_df = _scd_ensure_columns(target_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame()).copy())

    existing_record_ids: set[str] = set()

    if not mobile_df.empty and "person_id" in mobile_df.columns and MOBILE_NUMBER_RECORD_ID_COL in mobile_df.columns:

        active_person_mask = (

            (mobile_df["person_id"].astype(str) == person_key) &

            _scd_active_mask(mobile_df)

        )

        for raw_rid in mobile_df[active_person_mask][MOBILE_NUMBER_RECORD_ID_COL].tolist():

            rid = _normalize_mobile_number_record_id(raw_rid)

            if rid:

                existing_record_ids.add(rid)

        if active_person_mask.any():

            mobile_df.loc[active_person_mask, SCD_ACTIVE_TO_COL] = now

            mobile_df.loc[active_person_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            mobile_df.loc[active_person_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if mobile_rows:

        mobile_df = pd.concat([mobile_df, pd.DataFrame([{**r, **new_scd} for r in mobile_rows])], ignore_index=True)

    target_store[MOBILE_NUMBER_SHEET] = mobile_df



    family_df = _scd_ensure_columns(target_store.get(MOBILE_NUMBER_FAMILY_RELATION_SHEET, pd.DataFrame()).copy())

    if not family_df.empty and MOBILE_NUMBER_RECORD_ID_COL in family_df.columns and existing_record_ids:

        active_sat_mask = (

            family_df[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(existing_record_ids) &

            _scd_active_mask(family_df)

        )

        if active_sat_mask.any():

            family_df.loc[active_sat_mask, SCD_ACTIVE_TO_COL] = now

            family_df.loc[active_sat_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            family_df.loc[active_sat_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if family_rows:

        family_df = pd.concat([family_df, pd.DataFrame([{**r, **new_scd} for r in family_rows])], ignore_index=True)

    target_store[MOBILE_NUMBER_FAMILY_RELATION_SHEET] = family_df



    personal_primary_df = _scd_ensure_columns(target_store.get(PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET, pd.DataFrame()).copy())

    if not personal_primary_df.empty and MOBILE_NUMBER_RECORD_ID_COL in personal_primary_df.columns and existing_record_ids:

        active_prim_mask = (

            personal_primary_df[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(existing_record_ids) &

            _scd_active_mask(personal_primary_df)

        )

        if active_prim_mask.any():

            personal_primary_df.loc[active_prim_mask, SCD_ACTIVE_TO_COL] = now

            personal_primary_df.loc[active_prim_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            personal_primary_df.loc[active_prim_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if personal_primary_rows:

        personal_primary_df = pd.concat([personal_primary_df, pd.DataFrame([{**r, **new_scd} for r in personal_primary_rows])], ignore_index=True)

    target_store[PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET] = personal_primary_df



    linked_jobs_df = _scd_ensure_columns(target_store.get(MOBILE_NUMBER_LINKED_JOB_SHEET, pd.DataFrame()).copy())

    if not linked_jobs_df.empty and MOBILE_NUMBER_RECORD_ID_COL in linked_jobs_df.columns and existing_record_ids:

        active_lnk_mask = (

            linked_jobs_df[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(existing_record_ids) &

            _scd_active_mask(linked_jobs_df)

        )

        if active_lnk_mask.any():

            linked_jobs_df.loc[active_lnk_mask, SCD_ACTIVE_TO_COL] = now

            linked_jobs_df.loc[active_lnk_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            linked_jobs_df.loc[active_lnk_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if linked_job_rows:

        linked_jobs_df = pd.concat([linked_jobs_df, pd.DataFrame([{**r, **new_scd} for r in linked_job_rows])], ignore_index=True)

    target_store[MOBILE_NUMBER_LINKED_JOB_SHEET] = linked_jobs_df





def normalize_nationality_payload_rows(rows) -> list[dict]:

    normalized = []

    seen_keys: set[tuple[str, str]] = set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        nationality = _normalize_text(row.get("nationality"))

        if not nationality:

            continue



        person_id = _normalize_person_id(row.get("person_id"))

        person_key = "" if person_id in (None, "") else str(person_id)

        nationality_key = _normalize_lookup_text(nationality)

        dedupe_key = (person_key, nationality_key)

        if dedupe_key in seen_keys:

            continue

        seen_keys.add(dedupe_key)



        normalized.append({

            "person_id": person_id,

            "nationality": nationality,

        })



    return normalized





def normalize_nationality_rows(rows) -> list[dict]:

    return [{col: row.get(col) for col in NATIONALITY_COLUMNS} for row in normalize_nationality_payload_rows(rows)]





def _normalize_age_group(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    return text





def _normalize_membership_date_text(value) -> str | None:

    return _normalize_text(value)





def _normalize_youth_join_year(value) -> int | None:

    return _to_int_or_none(value, 1900, 2500)





def sort_age_group_history_rows(rows: list[dict] | None) -> list[dict]:

    values = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        age_group = _normalize_age_group(row.get("age_group"))

        if not age_group:

            continue

        values.append({

            "age_group": age_group,

            "start_date": _normalize_membership_date_text(row.get("start_date")),

            "end_date": _normalize_membership_date_text(row.get("end_date")),

        })

    values.sort(key=lambda item: (

        AGE_GROUP_ORDER_INDEX.get(item.get("age_group"), len(AGE_GROUP_ORDER_INDEX)),

        item.get("start_date") or "",

        item.get("end_date") or "",

    ))

    return values





def current_age_group_from_history_rows(rows: list[dict] | None) -> str | None:

    sorted_rows = sort_age_group_history_rows(rows)

    return sorted_rows[0]["age_group"] if sorted_rows else None





def normalize_person_youth_group_age_history_entries(rows) -> list[dict]:

    normalized = []

    seen: set[tuple[str, str, str, str]] = set()

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        record_id = _normalize_person_youth_group_record_id(row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL))

        age_group = _normalize_age_group(row.get("age_group"))

        if not record_id or not age_group:

            continue

        start_date = _normalize_membership_date_text(row.get("start_date"))

        end_date = _normalize_membership_date_text(row.get("end_date"))

        dedupe_key = (record_id, age_group, start_date or "", end_date or "")

        if dedupe_key in seen:

            continue

        seen.add(dedupe_key)

        normalized.append({

            PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,

            "age_group": age_group,

            "start_date": start_date,

            "end_date": end_date,

        })

    normalized.sort(key=lambda item: (

        item[PERSON_YOUTH_GROUP_RECORD_ID_COL],

        AGE_GROUP_ORDER_INDEX.get(item.get("age_group"), len(AGE_GROUP_ORDER_INDEX)),

        item.get("start_date") or "",

        item.get("end_date") or "",

    ))

    return normalized





def person_youth_group_age_history_lookup(history_df: pd.DataFrame | None = None) -> dict[str, list[dict]]:

    raw = history_df if history_df is not None else store.get(PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame())

    df = _scd_filter_active(raw)

    if df is None or df.empty or PERSON_YOUTH_GROUP_RECORD_ID_COL not in df.columns:

        return {}



    lookup: dict[str, list[dict]] = {}

    for row in normalize_person_youth_group_age_history_entries(df.replace({np.nan: None}).to_dict(orient="records")):

        record_id = row[PERSON_YOUTH_GROUP_RECORD_ID_COL]

        lookup.setdefault(record_id, []).append({

            "age_group": row.get("age_group"),

            "start_date": row.get("start_date"),

            "end_date": row.get("end_date"),

        })



    return {record_id: sort_age_group_history_rows(rows) for record_id, rows in lookup.items()}





def normalize_person_youth_group_rows(rows, history_lookup: dict[str, list[dict]] | None = None) -> list[dict]:

    normalized = []

    used_record_ids: set[str] = set()

    next_sequence = _next_person_youth_group_record_sequence()

    history_by_record_id = history_lookup or {}



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        youth_group_id = _normalize_text(row.get(YOUTH_GROUP_ID_COL))

        if not youth_group_id:

            continue



        record_id = _normalize_person_youth_group_record_id(row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL))

        if record_id and record_id not in used_record_ids:

            used_record_ids.add(record_id)

        else:

            while True:

                candidate = _format_person_youth_group_record_id(next_sequence)

                next_sequence += 1

                if candidate not in used_record_ids:

                    record_id = candidate

                    used_record_ids.add(candidate)

                    break



        archived = row.get("archived")

        current_age_group = current_age_group_from_history_rows(history_by_record_id.get(record_id)) or _normalize_age_group(row.get("age_group"))

        normalized_row = {

            "person_id": _normalize_person_id(row.get("person_id")),

            PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,

            "youth_join_year": _normalize_youth_join_year(row.get("youth_join_year")),

            "age_group": current_age_group,

            YOUTH_GROUP_ID_COL: youth_group_id,

            "archived": bool(archived) if archived is not None and str(archived) not in ("nan", "None", "") else False,

        }

        for approval_col in PERSON_YOUTH_GROUP_APPROVAL_COLUMNS:

            if approval_col in row:

                normalized_row[approval_col] = row.get(approval_col)

        normalized.append(normalized_row)



    return normalized





def person_youth_group_age_history_rows_from_membership_rows(rows, normalized_membership_rows: list[dict] | None = None) -> list[dict]:

    membership_rows = normalized_membership_rows if normalized_membership_rows is not None else normalize_person_youth_group_rows(rows)

    history_rows = []

    membership_by_index = []

    for index, membership_row in enumerate(membership_rows):

        membership_by_index.append((index, membership_row))



    for index, membership_row in membership_by_index:

        source_row = rows[index] if isinstance(rows, list) and index < len(rows) and isinstance(rows[index], dict) else {}

        record_id = membership_row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL)

        if not record_id:

            continue

        raw_history = source_row.get("age_group_history")

        if isinstance(raw_history, list):

            for item in raw_history:

                if not isinstance(item, dict):

                    continue

                history_rows.append({

                    PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,

                    "age_group": item.get("age_group"),

                    "start_date": item.get("start_date"),

                    "end_date": item.get("end_date"),

                })

            continue



        stored_age_group = _normalize_age_group(source_row.get("age_group")) or _normalize_age_group(membership_row.get("age_group"))

        if stored_age_group:

            history_rows.append({

                PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,

                "age_group": stored_age_group,

                "start_date": None,

                "end_date": None,

            })



    return normalize_person_youth_group_age_history_entries(history_rows)





def build_person_youth_group_payload_rows(df: pd.DataFrame | None, history_df: pd.DataFrame | None = None):

    result = {}

    if df is None or df.empty or "person_id" not in df.columns:

        return result



    history_lookup = person_youth_group_age_history_lookup(history_df)

    for pid, grp in df.groupby("person_id", sort=False):

        rows = []

        for _, row in grp.iterrows():

            yg_id = _normalize_text(row.get(YOUTH_GROUP_ID_COL))

            if not yg_id:

                continue

            record_id = _normalize_person_youth_group_record_id(row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL))

            history_rows = history_lookup.get(record_id, [])

            stored_age_group = _normalize_age_group(row.get("age_group"))

            if not history_rows and stored_age_group:

                history_rows = [{"age_group": stored_age_group, "start_date": None, "end_date": None}]

            current_age_group = current_age_group_from_history_rows(history_rows) or stored_age_group or ""

            join_year = _normalize_youth_join_year(row.get("youth_join_year"))

            archived = row.get("archived")

            payload_row = {

                PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,

                "youth_group_id": yg_id,

                "age_group": current_age_group,

                "current_age_group": current_age_group,

                "age_group_history": sort_age_group_history_rows(history_rows),

                "youth_join_year": join_year,

                "archived": bool(archived) if archived is not None and str(archived) not in ("nan", "None", "") else False,

            }

            for approval_col in PERSON_YOUTH_GROUP_APPROVAL_COLUMNS:

                if approval_col in row:

                    payload_row[approval_col] = row.get(approval_col)

            rows.append(payload_row)

        result[pid] = rows

    return result





def get_person_youth_group_payload_rows(payload_rows_by_person: dict, pid) -> list[dict]:

    if not isinstance(payload_rows_by_person, dict) or not payload_rows_by_person:

        return []



    if pid in payload_rows_by_person:

        return payload_rows_by_person[pid]



    normalized_pid = _normalize_person_id(pid)

    if normalized_pid in payload_rows_by_person:

        return payload_rows_by_person[normalized_pid]



    pid_str = str(normalized_pid if normalized_pid is not None else pid).strip()

    if pid_str in payload_rows_by_person:

        return payload_rows_by_person[pid_str]



    return []





def _ensure_person_youth_group_schema() -> bool:

    changed = False

    pyg = _scd_ensure_columns(store.get(PERSON_YOUTH_GROUP_SHEET, pd.DataFrame()).copy())

    history_df = _scd_ensure_columns(store.get(PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()).copy())



    pyg_required_columns = [

        col for col in PERSON_YOUTH_GROUP_COLUMNS

        if col != "age_group"

    ]

    if pyg.empty:

        pyg = pd.DataFrame(columns=pyg_required_columns + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in pyg_required_columns:

            if col not in pyg.columns:

                pyg[col] = None

                changed = True



    if history_df.empty:

        history_df = pd.DataFrame(columns=PERSON_YOUTH_GROUP_AGE_HISTORY_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in PERSON_YOUTH_GROUP_AGE_HISTORY_COLUMNS:

            if col not in history_df.columns:

                history_df[col] = None

                changed = True



    active_pyg_df, inactive_pyg_df = _scd_split(pyg)

    active_hist_df, inactive_hist_df = _scd_split(history_df)



    active_hist_raw_rows = active_hist_df.replace({np.nan: None}).to_dict(orient="records") if not active_hist_df.empty else []

    existing_history_rows = normalize_person_youth_group_age_history_entries(active_hist_raw_rows)

    history_lookup = {}

    for row in existing_history_rows:

        history_lookup.setdefault(row[PERSON_YOUTH_GROUP_RECORD_ID_COL], []).append({

            "age_group": row.get("age_group"),

            "start_date": row.get("start_date"),

            "end_date": row.get("end_date"),

        })



    main_source_rows = active_pyg_df.replace({np.nan: None}).to_dict(orient="records") if not active_pyg_df.empty else []

    normalized_main_rows = normalize_person_youth_group_rows(main_source_rows, history_lookup)



    supplemental_history_rows = []

    existing_history_ids = {row[PERSON_YOUTH_GROUP_RECORD_ID_COL] for row in existing_history_rows}

    for row in normalized_main_rows:

        record_id = row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL)

        age_group = _normalize_age_group(row.get("age_group"))

        if not record_id or not age_group or record_id in existing_history_ids:

            continue

        supplemental_history_rows.append({

            PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,

            "age_group": age_group,

            "start_date": None,

            "end_date": None,

        })

        existing_history_ids.add(record_id)

        changed = True



    # Keep history for inactive pyg records too (preserve historical data)

    inactive_pyg_record_ids = {

        row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL)

        for row in (inactive_pyg_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_pyg_df.empty else [])

        if row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL)

    }

    valid_record_ids = {

        row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL)

        for row in normalized_main_rows

        if row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL)

    } | inactive_pyg_record_ids

    normalized_history_rows = [

        row for row in normalize_person_youth_group_age_history_entries(existing_history_rows + supplemental_history_rows)

        if row.get(PERSON_YOUTH_GROUP_RECORD_ID_COL) in valid_record_ids

    ]

    normalized_main_rows = normalize_person_youth_group_rows(main_source_rows, person_youth_group_age_history_lookup(pd.DataFrame(normalized_history_rows)))



    if normalized_main_rows != normalize_person_youth_group_rows(main_source_rows, history_lookup):

        changed = True

    if normalized_history_rows != existing_history_rows:

        changed = True



    norm_pyg_scd = _scd_preserve_metadata(normalized_main_rows, main_source_rows, PERSON_YOUTH_GROUP_RECORD_ID_COL)

    inactive_pyg_rows = inactive_pyg_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_pyg_df.empty else []

    normalized_main_df = pd.DataFrame(norm_pyg_scd + inactive_pyg_rows)

    if "youth_join_year" in normalized_main_df.columns:

        normalized_main_df["youth_join_year"] = pd.array(normalized_main_df["youth_join_year"], dtype="Int64")

    store[PERSON_YOUTH_GROUP_SHEET] = normalized_main_df



    norm_hist_scd = _scd_preserve_metadata(normalized_history_rows, active_hist_raw_rows, PERSON_YOUTH_GROUP_RECORD_ID_COL)

    inactive_hist_rows = inactive_hist_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_hist_df.empty else []

    store[PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET] = pd.DataFrame(norm_hist_scd + inactive_hist_rows)

    return changed





def normalize_school_payload_rows(rows) -> list[dict]:

    normalized = []

    used_record_ids: set[str] = set()

    next_sequence = _next_school_record_sequence()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        normalized_row = {

            "person_id": _normalize_person_id(row.get("person_id")),

            SCHOOL_NAME_COL: _first_present(row, SCHOOL_NAME_COL, "school"),

            "school": _first_present(row, SCHOOL_NAME_COL, "school"),

            "section": row.get("section"),

            "start_date": row.get("start_date"),

            "end_date": row.get("end_date"),

            "is_current": row.get("is_current"),

            "grades_attended": _school_grade_values_from_value(row.get("grades_attended")),

        }



        record_id = _normalize_school_record_id(row.get(SCHOOL_RECORD_ID_COL))

        if record_id and record_id not in used_record_ids:

            normalized_row[SCHOOL_RECORD_ID_COL] = record_id

            used_record_ids.add(record_id)

        else:

            while True:

                candidate = _format_school_record_id(next_sequence)

                next_sequence += 1

                if candidate not in used_record_ids:

                    normalized_row[SCHOOL_RECORD_ID_COL] = candidate

                    used_record_ids.add(candidate)

                    break



        normalized.append(normalized_row)



    return normalized





def normalize_school_rows(rows) -> list[dict]:

    normalized = []

    for row in normalize_school_payload_rows(rows):

        normalized.append({

            "person_id": row.get("person_id"),

            SCHOOL_RECORD_ID_COL: row.get(SCHOOL_RECORD_ID_COL),

            SCHOOL_NAME_COL: row.get(SCHOOL_NAME_COL),

            "school": row.get(SCHOOL_NAME_COL),

            "section": row.get("section"),

            "start_date": row.get("start_date"),

            "end_date": row.get("end_date"),

            "is_current": row.get("is_current"),

        })

    return normalized





def normalize_school_section_rows(rows, valid_record_ids: set[str] | None = None) -> list[dict]:

    normalized = []

    seen: set[str] = set()

    allowed_record_ids = valid_record_ids or set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_school_record_id(row.get(SCHOOL_RECORD_ID_COL))

        if not record_id:

            continue

        if allowed_record_ids and record_id not in allowed_record_ids:

            continue



        section = _normalize_text(row.get("section"))

        if not section:

            continue

        if record_id in seen:

            continue

        seen.add(record_id)



        normalized.append({

            SCHOOL_RECORD_ID_COL: record_id,

            "section": section,

        })



    return normalized





def school_section_rows_from_school_rows(rows) -> list[dict]:

    section_rows = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_school_record_id(row.get(SCHOOL_RECORD_ID_COL))

        section = _normalize_text(row.get("section"))

        if not record_id or not section:

            continue



        section_rows.append({

            SCHOOL_RECORD_ID_COL: record_id,

            "section": section,

        })



    return normalize_school_section_rows(section_rows)





def normalize_school_grade_rows(rows, valid_record_ids: set[str] | None = None) -> list[dict]:

    normalized = []

    seen: set[tuple[str, str]] = set()

    allowed_record_ids = valid_record_ids or set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_school_record_id(row.get(SCHOOL_RECORD_ID_COL))

        if not record_id:

            continue



        grade = _normalize_school_grade_value(row.get("grade"))

        if not grade:

            continue



        if allowed_record_ids and record_id not in allowed_record_ids:

            continue



        dedupe_key = (record_id, grade)

        if dedupe_key in seen:

            continue

        seen.add(dedupe_key)



        normalized.append({

            SCHOOL_RECORD_ID_COL: record_id,

            "grade": grade,

        })



    return normalized





def school_grade_rows_from_school_rows(rows) -> list[dict]:

    grade_rows = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_school_record_id(row.get(SCHOOL_RECORD_ID_COL))

        if not record_id:

            continue



        for grade in _school_grade_values_from_value(row.get("grades_attended")):

            grade_rows.append({

                SCHOOL_RECORD_ID_COL: record_id,

                "grade": grade,

            })



    return normalize_school_grade_rows(grade_rows)





def school_rows_for_person(source_store: dict[str, pd.DataFrame], person_id) -> list[dict]:

    schools_df = _scd_filter_active(source_store.get(SCHOOL_SHEET, pd.DataFrame()))

    normalized_person_id = _normalize_person_id(person_id)

    if schools_df.empty or "person_id" not in schools_df.columns or normalized_person_id in (None, ""):

        return []



    person_key = str(normalized_person_id)

    rows = df_to_json(schools_df[schools_df["person_id"].astype(str) == person_key])

    if not rows:

        return []



    person_record_ids = {

        record_id

        for record_id in (

            _normalize_school_record_id(row.get(SCHOOL_RECORD_ID_COL))

            for row in rows

        )

        if record_id

    }



    school_sections_df = _scd_filter_active(source_store.get(SCHOOL_SECTION_SHEET, pd.DataFrame()))

    section_map: dict[str, str] = {}

    if not school_sections_df.empty and SCHOOL_RECORD_ID_COL in school_sections_df.columns:

        section_rows = normalize_school_section_rows(

            school_sections_df.replace({np.nan: None}).to_dict(orient="records"),

            person_record_ids,

        )

        for section_row in section_rows:

            record_id = section_row.get(SCHOOL_RECORD_ID_COL)

            section = section_row.get("section")

            if record_id and section:

                section_map[record_id] = section



    school_grades_df = _scd_filter_active(source_store.get(SCHOOL_GRADE_SHEET, pd.DataFrame()))

    grade_map: dict[str, list[str]] = {}

    if not school_grades_df.empty and SCHOOL_RECORD_ID_COL in school_grades_df.columns:

        grade_rows = normalize_school_grade_rows(

            school_grades_df.replace({np.nan: None}).to_dict(orient="records"),

            person_record_ids,

        )

        for grade_row in grade_rows:

            record_id = grade_row.get(SCHOOL_RECORD_ID_COL)

            if not record_id:

                continue

            grade_map.setdefault(record_id, []).append(grade_row["grade"])



    for row in rows:

        record_id = _normalize_school_record_id(row.get(SCHOOL_RECORD_ID_COL))

        row["section"] = section_map.get(record_id)

        row["grades_attended"] = grade_map.get(record_id, [])



    return rows





def replace_school_rows(target_store: dict[str, pd.DataFrame], person_id, rows, changed_by: str = "system"):

    normalized_person_id = _normalize_person_id(person_id)

    person_key = str(normalized_person_id)

    payload_rows = []

    for row in normalize_school_payload_rows(rows):

        payload_rows.append({**row, "person_id": normalized_person_id})



    school_rows = [{col: row.get(col) for col in SCHOOL_COLUMNS} for row in payload_rows]

    school_section_rows = school_section_rows_from_school_rows(payload_rows)

    school_grade_rows = school_grade_rows_from_school_rows(payload_rows)



    existing_schools = _scd_active_rows(target_store.get(SCHOOL_SHEET, pd.DataFrame()), "person_id", person_key)

    existing_rids = {

        _normalize_school_record_id(r.get(SCHOOL_RECORD_ID_COL))

        for r in existing_schools

        if _normalize_school_record_id(r.get(SCHOOL_RECORD_ID_COL))

    }

    if _scd_rows_equal(existing_schools, school_rows, SCHOOL_COLUMNS):

        existing_secs = _scd_active_satellite_rows(

            target_store.get(SCHOOL_SECTION_SHEET, pd.DataFrame()), SCHOOL_RECORD_ID_COL, existing_rids)

        existing_grds = _scd_active_satellite_rows(

            target_store.get(SCHOOL_GRADE_SHEET, pd.DataFrame()), SCHOOL_RECORD_ID_COL, existing_rids)

        if (_scd_rows_equal(existing_secs, school_section_rows, SCHOOL_SECTION_COLUMNS) and

                _scd_rows_equal(existing_grds, school_grade_rows, SCHOOL_GRADE_COLUMNS)):

            return



    now = _scd_timestamp()

    new_scd = _scd_new_metadata(changed_by)



    schools_df = _scd_ensure_columns(target_store.get(SCHOOL_SHEET, pd.DataFrame()).copy())

    existing_record_ids: set[str] = set()

    if not schools_df.empty and "person_id" in schools_df.columns and SCHOOL_RECORD_ID_COL in schools_df.columns:

        active_mask = (

            (schools_df["person_id"].astype(str) == person_key) &

            _scd_active_mask(schools_df)

        )

        for raw_rid in schools_df[active_mask][SCHOOL_RECORD_ID_COL].tolist():

            rid = _normalize_school_record_id(raw_rid)

            if rid:

                existing_record_ids.add(rid)

        if active_mask.any():

            schools_df.loc[active_mask, SCD_ACTIVE_TO_COL] = now

            schools_df.loc[active_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            schools_df.loc[active_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if school_rows:

        schools_df = pd.concat([schools_df, pd.DataFrame([{**r, **new_scd} for r in school_rows])], ignore_index=True)

    target_store[SCHOOL_SHEET] = schools_df



    school_sections_df = _scd_ensure_columns(target_store.get(SCHOOL_SECTION_SHEET, pd.DataFrame()).copy())

    if not school_sections_df.empty and SCHOOL_RECORD_ID_COL in school_sections_df.columns and existing_record_ids:

        active_sec_mask = (

            school_sections_df[SCHOOL_RECORD_ID_COL].astype(str).isin(existing_record_ids) &

            _scd_active_mask(school_sections_df)

        )

        if active_sec_mask.any():

            school_sections_df.loc[active_sec_mask, SCD_ACTIVE_TO_COL] = now

            school_sections_df.loc[active_sec_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            school_sections_df.loc[active_sec_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if school_section_rows:

        school_sections_df = pd.concat([school_sections_df, pd.DataFrame([{**r, **new_scd} for r in school_section_rows])], ignore_index=True)

    target_store[SCHOOL_SECTION_SHEET] = school_sections_df



    school_grades_df = _scd_ensure_columns(target_store.get(SCHOOL_GRADE_SHEET, pd.DataFrame()).copy())

    if not school_grades_df.empty and SCHOOL_RECORD_ID_COL in school_grades_df.columns and existing_record_ids:

        active_grd_mask = (

            school_grades_df[SCHOOL_RECORD_ID_COL].astype(str).isin(existing_record_ids) &

            _scd_active_mask(school_grades_df)

        )

        if active_grd_mask.any():

            school_grades_df.loc[active_grd_mask, SCD_ACTIVE_TO_COL] = now

            school_grades_df.loc[active_grd_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            school_grades_df.loc[active_grd_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if school_grade_rows:

        school_grades_df = pd.concat([school_grades_df, pd.DataFrame([{**r, **new_scd} for r in school_grade_rows])], ignore_index=True)

    target_store[SCHOOL_GRADE_SHEET] = school_grades_df





def normalize_email_rows(rows) -> list[dict]:

    normalized = []

    used_record_ids: set[str] = set()

    next_sequence = _next_email_record_sequence()

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        email = _normalize_text(row.get("email"))

        if not email:

            continue

        raw_type = _first_present(row, EMAIL_TYPE_COL, "type")

        email_type = _normalize_email_type(raw_type)

        family_relation = _normalize_family_relation(row.get("family_relation"))

        if email_type == "family" and family_relation is None:

            family_relation = _extract_family_relation_from_email_type(raw_type)

        if email_type != "family":

            family_relation = None

        is_primary = _to_bool(row.get("is_primary")) if email_type == "personal" else False

        linked_job_ids = _serialize_linked_job_ids(row.get("linked_job_ids")) if email_type == "work" else None

        if not record_id or record_id in used_record_ids:

            while True:

                candidate = _format_email_record_id(next_sequence)

                next_sequence += 1

                if candidate not in used_record_ids:

                    record_id = candidate

                    break

        used_record_ids.add(record_id)

        normalized.append({

            "person_id": _normalize_person_id(row.get("person_id")),

            EMAIL_RECORD_ID_COL: record_id,

            "email": email,

            EMAIL_TYPE_COL: email_type,

            "type": email_type,

            "family_relation": family_relation,

            "is_primary": is_primary,

            "linked_job_ids": linked_job_ids,

        })



    grouped: dict[str, list[dict]] = {}

    for row in normalized:

        key = str(row.get("person_id"))

        grouped.setdefault(key, []).append(row)



    result = []

    for entries in grouped.values():

        primary_seen = False

        for entry in entries:

            if entry.get(EMAIL_TYPE_COL) != "personal":

                entry["is_primary"] = False

            elif entry.get("is_primary") and not primary_seen:

                primary_seen = True

            else:

                entry["is_primary"] = False

            result.append(entry)

    return result





def _email_row_signature(row: dict | None) -> tuple[str | None, str | None, bool, str | None]:

    payload = row if isinstance(row, dict) else {}

    email_type = _normalize_email_type(_first_present(payload, EMAIL_TYPE_COL, "type"))

    return (

        _normalize_text(payload.get("email")),

        email_type,

        email_type == "personal",

        _normalize_family_relation(payload.get("family_relation")) if email_type == "family" else None,

        _serialize_linked_job_ids(payload.get("linked_job_ids")) if email_type == "work" else None,

    )





def normalize_email_family_relation_rows(rows, valid_record_ids: set[str] | None = None) -> list[dict]:

    normalized = []

    seen: set[str] = set()

    allowed_record_ids = valid_record_ids or set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        if not record_id:

            continue

        if allowed_record_ids and record_id not in allowed_record_ids:

            continue



        family_relation = _normalize_family_relation(row.get("family_relation"))

        if not family_relation:

            continue

        if record_id in seen:

            continue



        seen.add(record_id)

        normalized.append({

            EMAIL_RECORD_ID_COL: record_id,

            "family_relation": family_relation,

        })



    return normalized





def email_family_relation_rows_from_email_rows(rows) -> list[dict]:

    family_rows = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        email_type = _normalize_email_type(_first_present(row, EMAIL_TYPE_COL, "type"))

        family_relation = _normalize_family_relation(row.get("family_relation"))

        if not record_id or email_type != "family" or not family_relation:

            continue



        family_rows.append({

            EMAIL_RECORD_ID_COL: record_id,

            "family_relation": family_relation,

        })



    return normalize_email_family_relation_rows(family_rows)





def normalize_personal_email_primary_rows(rows, valid_record_ids: set[str] | None = None) -> list[dict]:

    normalized = []

    seen: set[str] = set()

    allowed_record_ids = valid_record_ids or set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        if not record_id:

            continue

        if allowed_record_ids and record_id not in allowed_record_ids:

            continue

        if record_id in seen:

            continue



        seen.add(record_id)

        normalized.append({

            EMAIL_RECORD_ID_COL: record_id,

            "is_primary": _to_bool(row.get("is_primary")),

        })



    return normalized





def personal_email_primary_rows_from_email_rows(rows) -> list[dict]:

    primary_rows = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        email_type = _normalize_email_type(_first_present(row, EMAIL_TYPE_COL, "type"))

        if not record_id or email_type != "personal":

            continue



        primary_rows.append({

            EMAIL_RECORD_ID_COL: record_id,

            "is_primary": _to_bool(row.get("is_primary")),

        })



    return normalize_personal_email_primary_rows(primary_rows)





def normalize_email_linked_job_rows(rows, valid_record_ids: set[str] | None = None) -> list[dict]:

    normalized = []

    seen: set[tuple[str, str]] = set()

    allowed_record_ids = valid_record_ids or set()



    for row in rows or []:

        if not isinstance(row, dict):

            continue



        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        if not record_id:

            continue

        if allowed_record_ids and record_id not in allowed_record_ids:

            continue



        for job_id in _normalize_linked_job_ids(row.get("linked_job_ids")):

            dedupe_key = (record_id, job_id)

            if dedupe_key in seen:

                continue

            seen.add(dedupe_key)

            normalized.append({

                EMAIL_RECORD_ID_COL: record_id,

                "linked_job_ids": job_id,

            })



    return normalized





def email_linked_job_rows_from_email_rows(rows) -> list[dict]:

    linked_job_rows = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        if not record_id:

            continue

        for job_id in _normalize_linked_job_ids(row.get("linked_job_ids")):

            linked_job_rows.append({

                EMAIL_RECORD_ID_COL: record_id,

                "linked_job_ids": job_id,

            })

    return normalize_email_linked_job_rows(linked_job_rows)





def email_rows_for_person(source_store: dict[str, pd.DataFrame], person_id) -> list[dict]:

    emails_df = _scd_filter_active(source_store.get(EMAIL_SHEET, pd.DataFrame()))

    normalized_person_id = _normalize_person_id(person_id)

    if emails_df.empty or "person_id" not in emails_df.columns or normalized_person_id in (None, ""):

        return []



    person_key = str(normalized_person_id)

    rows = df_to_json(emails_df[emails_df["person_id"].astype(str) == person_key])

    if not rows:

        return []



    person_record_ids = {

        record_id

        for record_id in (

            _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

            for row in rows

        )

        if record_id

    }



    family_df = _scd_filter_active(source_store.get(EMAIL_FAMILY_RELATION_SHEET, pd.DataFrame()))

    family_map: dict[str, str] = {}

    if not family_df.empty and EMAIL_RECORD_ID_COL in family_df.columns:

        family_rows = normalize_email_family_relation_rows(

            family_df.replace({np.nan: None}).to_dict(orient="records"),

            person_record_ids,

        )

        for family_row in family_rows:

            record_id = family_row.get(EMAIL_RECORD_ID_COL)

            family_relation = family_row.get("family_relation")

            if record_id and family_relation:

                family_map[record_id] = family_relation



    linked_jobs_df = _scd_filter_active(source_store.get(EMAIL_LINKED_JOB_SHEET, pd.DataFrame()))

    linked_job_map: dict[str, list[str]] = {}

    if not linked_jobs_df.empty and EMAIL_RECORD_ID_COL in linked_jobs_df.columns:

        linked_job_rows = normalize_email_linked_job_rows(

            linked_jobs_df.replace({np.nan: None}).to_dict(orient="records"),

            person_record_ids,

        )

        for linked_job_row in linked_job_rows:

            record_id = linked_job_row.get(EMAIL_RECORD_ID_COL)

            job_id = linked_job_row.get("linked_job_ids")

            if record_id and job_id:

                linked_job_map.setdefault(record_id, []).append(job_id)



    personal_primary_df = _scd_filter_active(source_store.get(PERSONAL_EMAIL_PRIMARY_SHEET, pd.DataFrame()))

    personal_primary_map: dict[str, bool] = {}

    if not personal_primary_df.empty and EMAIL_RECORD_ID_COL in personal_primary_df.columns:

        personal_primary_rows = normalize_personal_email_primary_rows(

            personal_primary_df.replace({np.nan: None}).to_dict(orient="records"),

            person_record_ids,

        )

        for primary_row in personal_primary_rows:

            record_id = primary_row.get(EMAIL_RECORD_ID_COL)

            if record_id:

                personal_primary_map[record_id] = _to_bool(primary_row.get("is_primary"))



    for row in rows:

        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        family_relation = family_map.get(record_id)

        linked_job_ids = linked_job_map.get(record_id, [])

        if family_relation:

            row[EMAIL_TYPE_COL] = "family"

            row["type"] = "family"

        elif linked_job_ids:

            row[EMAIL_TYPE_COL] = "work"

            row["type"] = "work"

        else:

            row[EMAIL_TYPE_COL] = _normalize_email_type(_first_present(row, EMAIL_TYPE_COL, "type"))

            row["type"] = row[EMAIL_TYPE_COL]

        row["family_relation"] = family_relation

        row["is_primary"] = personal_primary_map.get(record_id, False) if row[EMAIL_TYPE_COL] == "personal" else False

        row["linked_job_ids"] = linked_job_ids



    return normalize_email_rows(rows)





def prepare_email_rows_for_person(target_store: dict[str, pd.DataFrame], person_id, rows) -> list[dict]:

    normalized_person_id = _normalize_person_id(person_id)

    person_key = str(normalized_person_id)

    emails_df = target_store.get(EMAIL_SHEET, pd.DataFrame()).copy()

    existing_rows = []

    if not emails_df.empty and "person_id" in emails_df.columns:

        existing_rows = emails_df[emails_df["person_id"].astype(str) == person_key].replace({np.nan: None}).to_dict(orient="records")



    existing_by_id: dict[str, dict] = {}

    existing_order: list[dict] = []

    for row in existing_rows:

        existing_order.append(row)

        existing_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        if existing_id:

            existing_by_id[existing_id] = row



    assigned_existing_ids: set[str] = set()

    used_record_ids: set[str] = set(existing_by_id.keys())

    next_sequence = _next_email_record_sequence()

    prepared_rows = []



    for index, row in enumerate(rows or []):

        if not isinstance(row, dict):

            continue



        normalized_rows = normalize_email_rows([row])

        if not normalized_rows:

            continue

        normalized_row = normalized_rows[0]



        canonical_record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        assigned_record_id = None



        if canonical_record_id and canonical_record_id in existing_by_id and canonical_record_id not in assigned_existing_ids:

            assigned_record_id = canonical_record_id

        elif index < len(existing_order):

            candidate_existing_id = _normalize_email_record_id(existing_order[index].get(EMAIL_RECORD_ID_COL))

            if candidate_existing_id and candidate_existing_id not in assigned_existing_ids:

                assigned_record_id = candidate_existing_id

        if not assigned_record_id:

            signature = _email_row_signature(normalized_row)

            for existing_row in existing_order:

                existing_id = _normalize_email_record_id(existing_row.get(EMAIL_RECORD_ID_COL))

                if not existing_id or existing_id in assigned_existing_ids:

                    continue

                if _email_row_signature(existing_row) == signature:

                    assigned_record_id = existing_id

                    break

        if not assigned_record_id:

            while True:

                candidate = _format_email_record_id(next_sequence)

                next_sequence += 1

                if candidate not in used_record_ids:

                    assigned_record_id = candidate

                    break



        used_record_ids.add(assigned_record_id)

        if assigned_record_id in existing_by_id:

            assigned_existing_ids.add(assigned_record_id)



        prepared_rows.append({

            **normalized_row,

            "person_id": normalized_person_id,

            EMAIL_RECORD_ID_COL: assigned_record_id,

        })



    return prepared_rows





def replace_email_rows(target_store: dict[str, pd.DataFrame], person_id, rows, changed_by: str = "system"):

    normalized_person_id = _normalize_person_id(person_id)

    person_key = str(normalized_person_id)

    prepared_rows = prepare_email_rows_for_person(target_store, person_id, rows)

    email_rows = [{col: row.get(col) for col in EMAIL_COLUMNS} for row in prepared_rows]

    family_rows = email_family_relation_rows_from_email_rows(prepared_rows)

    personal_primary_rows = personal_email_primary_rows_from_email_rows(prepared_rows)

    linked_job_rows = email_linked_job_rows_from_email_rows(prepared_rows)



    existing_emails = _scd_active_rows(target_store.get(EMAIL_SHEET, pd.DataFrame()), "person_id", person_key)

    existing_rids = {

        _normalize_email_record_id(r.get(EMAIL_RECORD_ID_COL))

        for r in existing_emails

        if _normalize_email_record_id(r.get(EMAIL_RECORD_ID_COL))

    }

    if _scd_rows_equal(existing_emails, email_rows, EMAIL_COLUMNS):

        existing_family = _scd_active_satellite_rows(

            target_store.get(EMAIL_FAMILY_RELATION_SHEET, pd.DataFrame()), EMAIL_RECORD_ID_COL, existing_rids)

        existing_prim = _scd_active_satellite_rows(

            target_store.get(PERSONAL_EMAIL_PRIMARY_SHEET, pd.DataFrame()), EMAIL_RECORD_ID_COL, existing_rids)

        existing_lnk = _scd_active_satellite_rows(

            target_store.get(EMAIL_LINKED_JOB_SHEET, pd.DataFrame()), EMAIL_RECORD_ID_COL, existing_rids)

        if (_scd_rows_equal(existing_family, family_rows, EMAIL_FAMILY_RELATION_COLUMNS) and

                _scd_rows_equal(existing_prim, personal_primary_rows, PERSONAL_EMAIL_PRIMARY_COLUMNS) and

                _scd_rows_equal(existing_lnk, linked_job_rows, EMAIL_LINKED_JOB_COLUMNS)):

            return



    now = _scd_timestamp()

    new_scd = _scd_new_metadata(changed_by)



    emails_df = _scd_ensure_columns(target_store.get(EMAIL_SHEET, pd.DataFrame()).copy())

    existing_record_ids: set[str] = set()

    if not emails_df.empty and "person_id" in emails_df.columns and EMAIL_RECORD_ID_COL in emails_df.columns:

        active_mask = (

            (emails_df["person_id"].astype(str) == person_key) &

            _scd_active_mask(emails_df)

        )

        for raw_rid in emails_df[active_mask][EMAIL_RECORD_ID_COL].tolist():

            rid = _normalize_email_record_id(raw_rid)

            if rid:

                existing_record_ids.add(rid)

        if active_mask.any():

            emails_df.loc[active_mask, SCD_ACTIVE_TO_COL] = now

            emails_df.loc[active_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            emails_df.loc[active_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if email_rows:

        emails_df = pd.concat([emails_df, pd.DataFrame([{**r, **new_scd} for r in email_rows])], ignore_index=True)

    target_store[EMAIL_SHEET] = emails_df



    family_df = _scd_ensure_columns(target_store.get(EMAIL_FAMILY_RELATION_SHEET, pd.DataFrame()).copy())

    if not family_df.empty and EMAIL_RECORD_ID_COL in family_df.columns and existing_record_ids:

        active_fam_mask = (

            family_df[EMAIL_RECORD_ID_COL].astype(str).isin(existing_record_ids) &

            _scd_active_mask(family_df)

        )

        if active_fam_mask.any():

            family_df.loc[active_fam_mask, SCD_ACTIVE_TO_COL] = now

            family_df.loc[active_fam_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            family_df.loc[active_fam_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if family_rows:

        family_df = pd.concat([family_df, pd.DataFrame([{**r, **new_scd} for r in family_rows])], ignore_index=True)

    target_store[EMAIL_FAMILY_RELATION_SHEET] = family_df



    personal_primary_df = _scd_ensure_columns(target_store.get(PERSONAL_EMAIL_PRIMARY_SHEET, pd.DataFrame()).copy())

    if not personal_primary_df.empty and EMAIL_RECORD_ID_COL in personal_primary_df.columns and existing_record_ids:

        active_prim_mask = (

            personal_primary_df[EMAIL_RECORD_ID_COL].astype(str).isin(existing_record_ids) &

            _scd_active_mask(personal_primary_df)

        )

        if active_prim_mask.any():

            personal_primary_df.loc[active_prim_mask, SCD_ACTIVE_TO_COL] = now

            personal_primary_df.loc[active_prim_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            personal_primary_df.loc[active_prim_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if personal_primary_rows:

        personal_primary_df = pd.concat([personal_primary_df, pd.DataFrame([{**r, **new_scd} for r in personal_primary_rows])], ignore_index=True)

    target_store[PERSONAL_EMAIL_PRIMARY_SHEET] = personal_primary_df



    linked_jobs_df = _scd_ensure_columns(target_store.get(EMAIL_LINKED_JOB_SHEET, pd.DataFrame()).copy())

    if not linked_jobs_df.empty and EMAIL_RECORD_ID_COL in linked_jobs_df.columns and existing_record_ids:

        active_lnk_mask = (

            linked_jobs_df[EMAIL_RECORD_ID_COL].astype(str).isin(existing_record_ids) &

            _scd_active_mask(linked_jobs_df)

        )

        if active_lnk_mask.any():

            linked_jobs_df.loc[active_lnk_mask, SCD_ACTIVE_TO_COL] = now

            linked_jobs_df.loc[active_lnk_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            linked_jobs_df.loc[active_lnk_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if linked_job_rows:

        linked_jobs_df = pd.concat([linked_jobs_df, pd.DataFrame([{**r, **new_scd} for r in linked_job_rows])], ignore_index=True)

    target_store[EMAIL_LINKED_JOB_SHEET] = linked_jobs_df





def normalize_social_media_rows(rows) -> list[dict]:

    normalized = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        url = _normalize_text(row.get("url"))

        if not url:

            continue

        normalized.append({

            "person_id": _normalize_person_id(row.get("person_id")),

            "platform": _normalize_social_media_platform(row.get("platform")),

            "url": url,

            "is_primary": _to_bool(row.get("is_primary")),

        })



    grouped: dict[tuple[str, str], list[dict]] = {}

    for row in normalized:

        key = (str(row.get("person_id")), str(row.get("platform")))

        grouped.setdefault(key, []).append(row)



    result = []

    for entries in grouped.values():

        primary_index = next((index for index, entry in enumerate(entries) if entry.get("is_primary")), 0)

        for index, entry in enumerate(entries):

            entry["is_primary"] = index == primary_index

            result.append(entry)

    return result





def normalize_job_rows(rows, existing_id_map: dict[str, str] | None = None) -> tuple[list[dict], dict[str, str]]:

    normalized = []

    id_map: dict[str, str] = dict(existing_id_map or {})

    used_job_ids: set[str] = {

        mapped_id

        for mapped_id in id_map.values()

        if _normalize_job_id(mapped_id)

    }

    next_sequence = _next_job_id_sequence()

    for row in rows or []:

        if not isinstance(row, dict):

            continue

        raw_job_id = row.get(JOB_ID_COL)

        raw_job_id_key = _normalize_job_id_key(raw_job_id)

        job_title = _normalize_text(row.get("job_title"))

        company = _normalize_text(_first_present(row, EMPLOYER_NAME_COL, "company"))

        start_date = _normalize_text(row.get("start_date"))

        end_date = _normalize_text(row.get("end_date"))

        state = _normalize_text(_first_present(row, EMPLOYMENT_STATE_COL, "state"))

        is_current_raw = row.get("is_current")

        has_is_current_val = is_current_raw not in (None, "", "nan", "None", "null")

        is_current = _to_bool(is_current_raw) if has_is_current_val else (not bool(end_date))

        if not state:

            state = "current" if is_current else "previous"

        if state == "current":

            end_date = None

        if not (job_title or company or start_date or end_date or state):

            continue



        job_id = id_map.get(raw_job_id_key or "") if raw_job_id_key else None

        if not job_id:

            canonical_job_id = _normalize_job_id(raw_job_id)

            if canonical_job_id and canonical_job_id not in used_job_ids:

                job_id = canonical_job_id

            else:

                while True:

                    candidate = _format_job_id(next_sequence)

                    next_sequence += 1

                    if candidate not in used_job_ids:

                        job_id = candidate

                        break

        used_job_ids.add(job_id)

        if raw_job_id_key:

            id_map[raw_job_id_key] = job_id

        id_map[job_id] = job_id



        normalized.append({

            "person_id": _normalize_person_id(row.get("person_id")),

            JOB_ID_COL: job_id,

            "job_title": job_title,

            EMPLOYER_NAME_COL: company,

            "company": company,

            "start_date": start_date,

            "end_date": end_date,

            EMPLOYMENT_STATE_COL: state,

            "state": state,

        })

    return normalized, id_map





def normalize_higher_education_rows(rows) -> list[dict]:

    normalized = []

    for row in rows or []:

        if not isinstance(row, dict):

            continue



        university_college = _normalize_text(_first_present(row, HIGHER_EDUCATION_INSTITUTION_COL, "university_college"))

        major = _normalize_text(row.get("major"))

        degree = _normalize_text(row.get("degree"))

        start_date = _normalize_text(row.get("start_date"))

        end_date = _normalize_text(row.get("end_date"))

        state = _normalize_text(_first_present(row, EDUCATION_STATE_COL, "state"))

        is_current_raw = row.get("is_current")

        has_is_current_val = is_current_raw not in (None, "", "nan", "None", "null")

        is_current = _to_bool(is_current_raw) if has_is_current_val else (not bool(end_date))



        if not state:

            state = "current" if is_current else None

        if state == "current":

            end_date = None



        if not (university_college or major or degree or start_date or end_date or state):

            continue



        normalized.append({

            "person_id": _normalize_person_id(row.get("person_id")),

            HIGHER_EDUCATION_INSTITUTION_COL: university_college,

            "university_college": university_college,

            "major": major,

            "degree": degree,

            "start_date": start_date,

            "end_date": end_date,

            EDUCATION_STATE_COL: state,

            "state": state,

            "final_gpa": _normalize_final_gpa(row.get("final_gpa")) if state in {"current", "graduated"} else None,

        })

    return normalized





def normalize_responsibility_rows(rows) -> list[dict]:

    normalized = []

    current_year = pd.Timestamp.utcnow().year

    for row in rows or []:

        if not isinstance(row, dict):

            continue



        period_text = _normalize_text(_first_present(row, "responsibility_period", "time"))

        jec_year = _to_int_or_none(row.get("jec_year"), 1900, 2100)

        if jec_year is None and period_text:

            if period_text in {"حاليًّا", "حاليًا", "حالي"}:

                jec_year = current_year

            else:

                jec_year = _to_int_or_none(period_text, 1900, 2100)

        is_current_raw = row.get("is_current")

        has_is_current_value = is_current_raw not in (None, "", "nan", "None", "null")

        is_active_raw = row.get("is_active")

        has_is_active_value = is_active_raw not in (None, "", "nan", "None", "null")

        has_current_flag = has_is_current_value or has_is_active_value

        if has_is_current_value:

            is_current = _to_bool(is_current_raw)

        elif has_is_active_value:

            is_current = _to_bool(is_active_raw)

        elif period_text in {"حاليًّا", "حاليًا", "حالي"}:

            is_current = True

        elif period_text in {"سابقًا", "سابقا"} or _to_int_or_none(period_text, 1900, 2100) is not None:

            is_current = False

        else:

            is_current = False

        responsibility_name = _normalize_text(_first_present(row, "responsibility_name", "responsibility"))

        start_date = _normalize_text(row.get("start_date"))

        end_date = _normalize_text(row.get("end_date"))

        youth_group_id = _normalize_text(row.get("youth_group_id"))



        if not (jec_year is not None or has_current_flag or period_text or responsibility_name or start_date or end_date or youth_group_id):

            continue



        normalized.append({

            "person_id": _normalize_person_id(row.get("person_id")),

            "jec_year": jec_year,

            "is_current": is_current,

            "responsibility_name": responsibility_name,

            "start_date": start_date,

            "end_date": end_date,

            "youth_group_id": youth_group_id,

        })

    return normalized





def _job_row_signature(row: dict | None) -> tuple[str | None, str | None, str | None, str | None, str | None]:

    payload = row if isinstance(row, dict) else {}

    return (

        _normalize_text(payload.get("job_title")),

        _normalize_text(_first_present(payload, EMPLOYER_NAME_COL, "company")),

        _normalize_text(payload.get("start_date")),

        _normalize_text(payload.get("end_date")),

        _normalize_text(_first_present(payload, EMPLOYMENT_STATE_COL, "state")),

    )





def prepare_job_rows_for_person(target_store: dict[str, pd.DataFrame], person_id, rows) -> tuple[list[dict], dict[str, str]]:

    normalized_person_id = _normalize_person_id(person_id)

    person_key = str(normalized_person_id)

    jobs_df = target_store.get(JOB_SHEET, pd.DataFrame()).copy()

    existing_rows = []

    if not jobs_df.empty and "person_id" in jobs_df.columns:

        existing_rows = jobs_df[jobs_df["person_id"].astype(str) == person_key].replace({np.nan: None}).to_dict(orient="records")



    existing_by_id: dict[str, dict] = {}

    existing_order: list[dict] = []

    for row in existing_rows:

        existing_order.append(row)

        existing_id = _normalize_job_id(row.get(JOB_ID_COL))

        if existing_id:

            existing_by_id[existing_id] = row



    id_map: dict[str, str] = {}

    assigned_existing_ids: set[str] = set()

    used_job_ids: set[str] = set(existing_by_id.keys())

    next_sequence = _next_job_id_sequence()

    prepared_rows = []



    for index, row in enumerate(rows or []):

        if not isinstance(row, dict):

            continue



        normalized_rows, _ = normalize_job_rows([row])

        if not normalized_rows:

            continue

        normalized_row = normalized_rows[0]



        raw_job_id_key = _normalize_job_id_key(row.get(JOB_ID_COL))

        canonical_job_id = _normalize_job_id(row.get(JOB_ID_COL))

        assigned_job_id = None



        if canonical_job_id and canonical_job_id in existing_by_id and canonical_job_id not in assigned_existing_ids:

            assigned_job_id = canonical_job_id

        elif index < len(existing_order):

            candidate_existing_id = _normalize_job_id(existing_order[index].get(JOB_ID_COL))

            if candidate_existing_id and candidate_existing_id not in assigned_existing_ids:

                assigned_job_id = candidate_existing_id

        if not assigned_job_id:

            signature = _job_row_signature(normalized_row)

            for existing_row in existing_order:

                existing_id = _normalize_job_id(existing_row.get(JOB_ID_COL))

                if not existing_id or existing_id in assigned_existing_ids:

                    continue

                if _job_row_signature(existing_row) == signature:

                    assigned_job_id = existing_id

                    break

        if not assigned_job_id:

            while True:

                candidate = _format_job_id(next_sequence)

                next_sequence += 1

                if candidate not in used_job_ids:

                    assigned_job_id = candidate

                    break



        used_job_ids.add(assigned_job_id)

        if assigned_job_id in existing_by_id:

            assigned_existing_ids.add(assigned_job_id)

        if raw_job_id_key:

            id_map[raw_job_id_key] = assigned_job_id

        id_map[assigned_job_id] = assigned_job_id



        prepared_rows.append({

            **normalized_row,

            "person_id": normalized_person_id,

            JOB_ID_COL: assigned_job_id,

        })



    return prepared_rows, id_map





def replace_job_rows(target_store: dict[str, pd.DataFrame], person_id, rows, changed_by: str = "system") -> dict[str, str]:

    normalized_person_id = _normalize_person_id(person_id)

    person_key = str(normalized_person_id)

    prepared_rows, id_map = prepare_job_rows_for_person(target_store, person_id, rows)



    existing_jobs = _scd_active_rows(target_store.get(JOB_SHEET, pd.DataFrame()), "person_id", person_key)

    if _scd_rows_equal(existing_jobs, prepared_rows, JOB_BASE_COLUMNS):

        return id_map



    now = _scd_timestamp()

    new_scd = _scd_new_metadata(changed_by)



    jobs_df = _scd_ensure_columns(target_store.get(JOB_SHEET, pd.DataFrame()).copy())

    if not jobs_df.empty and "person_id" in jobs_df.columns:

        active_mask = (

            (jobs_df["person_id"].astype(str) == person_key) &

            _scd_active_mask(jobs_df)

        )

        if active_mask.any():

            jobs_df.loc[active_mask, SCD_ACTIVE_TO_COL] = now

            jobs_df.loc[active_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            jobs_df.loc[active_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    if prepared_rows:

        jobs_df = pd.concat([jobs_df, pd.DataFrame([{**r, **new_scd} for r in prepared_rows])], ignore_index=True)

    target_store[JOB_SHEET] = jobs_df

    return id_map





def job_rows_for_person(source_store: dict[str, pd.DataFrame], person_id) -> list[dict]:

    jobs_df = _scd_filter_active(source_store.get(JOB_SHEET, pd.DataFrame()))

    normalized_person_id = _normalize_person_id(person_id)

    if jobs_df.empty or "person_id" not in jobs_df.columns or normalized_person_id in (None, ""):

        return []



    person_key = str(normalized_person_id)

    rows = df_to_json(jobs_df[jobs_df["person_id"].astype(str) == person_key])

    if not rows:

        return []



    normalized_rows, _ = normalize_job_rows(rows)

    return normalized_rows





def address_rows_from_embedded_payload(person: dict | None) -> list[dict]:

    payload = person or {}

    governorate = _normalize_text(payload.get("governorate"))

    city = _normalize_text(payload.get("city"))

    address = _normalize_text(_first_present(payload, STREET_ADDRESS_COL, "address"))

    country = _normalize_country(payload.get("country"))

    if not governorate and not city and not address:

        return []

    return [{

        "country": country,

        "governorate": governorate,

        "city": city,

        STREET_ADDRESS_COL: address,

        "address": address,

        "lat": None,

        "lng": None,

        "is_primary": True,

    }]





def _primary_address_rows(df: pd.DataFrame) -> pd.DataFrame:

    if df is None or df.empty:

        return pd.DataFrame(columns=ADDRESS_COLUMNS)



    working = df.copy()

    for col in ADDRESS_COLUMNS:

        if col not in working.columns:

            working[col] = None



    working["_person_key"] = working["person_id"].apply(lambda value: str(_normalize_person_id(value)))

    working["_primary_rank"] = working["is_primary"].apply(lambda value: 0 if _to_bool(value) else 1)

    working = working.sort_values(by=["_person_key", "_primary_rank"], kind="stable")

    primary = working.drop_duplicates(subset=["_person_key"], keep="first")

    return primary.drop(columns=["_person_key", "_primary_rank"])





def _project_primary_addresses(persons_df: pd.DataFrame, addresses_df: pd.DataFrame | None = None) -> pd.DataFrame:

    working = persons_df.copy()

    for col in ("country", "governorate", "city", STREET_ADDRESS_COL, "lat", "lng"):

        if col not in working.columns:

            working[col] = None



    if working.empty or "person_id" not in working.columns:

        return working



    source_addresses = addresses_df if addresses_df is not None else _scd_filter_active(store.get(ADDRESS_SHEET, pd.DataFrame()))

    primary_rows = _primary_address_rows(source_addresses)

    if primary_rows.empty or "person_id" not in primary_rows.columns:

        return working



    indexed = working.reset_index().rename(columns={"index": "_store_index"})

    merged = indexed.merge(

        primary_rows[["person_id", "country", "governorate", "city", STREET_ADDRESS_COL, "lat", "lng"]],

        on="person_id",

        how="left",

        suffixes=("", "_primary"),

    )

    for col in ("country", "governorate", "city", STREET_ADDRESS_COL, "lat", "lng"):

        primary_col = f"{col}_primary"

        merged[col] = merged[primary_col].where(merged[primary_col].notna(), merged[col])

        merged = merged.drop(columns=[primary_col])

    merged["address"] = merged[STREET_ADDRESS_COL]

    return merged.set_index("_store_index")





def _is_group_id(value: str | None) -> bool:

    if not value:

        return False

    return bool(re.fullmatch(r"YG\d{3,}", value))





def _strip_youth_prefix(value: str | None) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None

    text = re.sub(r"^\s*شبيبة\s*", "", text).strip()

    return text or None





def _split_youth_group_name(value: str | None) -> tuple[str | None, str | None]:

    text = _strip_youth_prefix(value)

    if not text:

        return None, None



    parts = re.split(r"\s+-\s+", text, maxsplit=1)

    if len(parts) >= 2:

        patron = _strip_youth_prefix(parts[0])

        short_name = _strip_youth_prefix(parts[1])

        if short_name:

            return patron, short_name



    return None, text





def _youth_group_display_name(patron: str | None, short_name: str | None) -> str | None:

    patron_text = _normalize_text(patron)

    short_text = _normalize_text(short_name)



    if patron_text and short_text:

        return f"شبيبة {patron_text} - {short_text}"

    if short_text:

        return f"شبيبة {short_text}"

    if patron_text:

        return f"شبيبة {patron_text}"

    return None





def _normalize_youth_group_column_names(df: pd.DataFrame) -> tuple[pd.DataFrame, bool]:

    if df is None:

        return pd.DataFrame(), False



    working = df.copy()

    changed = False



    if YOUTH_GROUP_PATRON_COL not in working.columns and ALT_YOUTH_GROUP_PATRON_COL in working.columns:

        working[YOUTH_GROUP_PATRON_COL] = working[ALT_YOUTH_GROUP_PATRON_COL]

        working = working.drop(columns=[ALT_YOUTH_GROUP_PATRON_COL])

        changed = True



    if YOUTH_GROUP_SHORT_NAME_COL not in working.columns and ALT_YOUTH_GROUP_SHORT_NAME_COL in working.columns:

        working[YOUTH_GROUP_SHORT_NAME_COL] = working[ALT_YOUTH_GROUP_SHORT_NAME_COL]

        working = working.drop(columns=[ALT_YOUTH_GROUP_SHORT_NAME_COL])

        changed = True



    return working, changed





def _refresh_youth_group_indexes():

    global _youth_group_name_by_id, _youth_group_patron_by_id, _youth_group_short_name_by_id

    global _youth_group_id_by_name, _youth_group_id_by_safe_key

    _youth_group_name_by_id = {}

    _youth_group_patron_by_id = {}

    _youth_group_short_name_by_id = {}

    _youth_group_id_by_name = {}

    _youth_group_id_by_safe_key = {}



    df = _scd_sheet_active_df(YOUTH_GROUP_SHEET)

    df, changed = _normalize_youth_group_column_names(df)

    if df.empty:

        return



    def add_lookup(name: str | None, gid: str):

        n = _normalize_text(name)

        if not n:

            return

        _youth_group_id_by_name[n] = gid

        _youth_group_id_by_safe_key[safe_youth_group_key(n)] = gid



    for row in df.replace({np.nan: None}).to_dict(orient="records"):

        gid = _normalize_text(row.get(YOUTH_GROUP_ID_COL))

        raw_name = _normalize_text(row.get(YOUTH_GROUP_NAME_COL))

        patron = _normalize_text(row.get(YOUTH_GROUP_PATRON_COL))

        short_name = _normalize_text(row.get(YOUTH_GROUP_SHORT_NAME_COL))



        if short_name:

            parsed_patron, parsed_short = _split_youth_group_name(short_name)

            if parsed_short:

                if not patron and parsed_patron:

                    patron = parsed_patron

                short_name = parsed_short

        if not short_name and raw_name:

            parsed_patron, parsed_short = _split_youth_group_name(raw_name)

            patron = patron or parsed_patron

            short_name = parsed_short



        if not short_name and patron:

            short_name = patron

            patron = None



        name = _youth_group_display_name(patron, short_name)

        if not gid or not name or not short_name:

            continue



        _youth_group_name_by_id[gid] = name

        _youth_group_patron_by_id[gid] = patron

        _youth_group_short_name_by_id[gid] = short_name



        add_lookup(name, gid)

        add_lookup(short_name, gid)

        add_lookup(patron, gid)

        add_lookup(raw_name, gid)





def youth_group_name(group_ref) -> str | None:

    ref = _normalize_text(group_ref)

    if not ref:

        return None

    if ref in _youth_group_name_by_id:

        return _youth_group_name_by_id[ref]

    if ref in _youth_group_id_by_name:

        return ref

    if _is_group_id(ref):

        return None

    return ref



GENERIC_YOUTH_GROUP_LABEL = "الشبيبة"
GENERAL_SECRETARIAT_LABEL = "الأمانة العامة"


def youth_group_display_label(group_ref, fallback: str | None = GENERIC_YOUTH_GROUP_LABEL) -> str | None:

    ref = _normalize_text(group_ref)

    if not ref:

        return fallback

    if ref == "GS":

        return GENERAL_SECRETARIAT_LABEL

    name = youth_group_name(ref)

    if name and not _is_group_id(name) and name != "GS":

        return name

    if _is_group_id(ref):

        return fallback

    return name or fallback





def youth_group_id(group_ref, create: bool = False) -> str | None:

    ref = _normalize_text(group_ref)

    if not ref:

        return None

    if ref in _youth_group_name_by_id:

        return ref

    if ref in _youth_group_id_by_name:

        return _youth_group_id_by_name[ref]

    safe_key = safe_youth_group_key(ref)

    if safe_key in _youth_group_id_by_safe_key:

        return _youth_group_id_by_safe_key[safe_key]

    if _is_group_id(ref):

        return ref

    if not create:

        return None

    return _create_youth_group_id_for_name(ref)





def youth_group_options() -> list[dict]:

    options = []

    for gid, name in sorted(_youth_group_name_by_id.items(), key=lambda x: x[1]):

        options.append({"value": gid, "label": name})

    return options





def _create_youth_group_id_for_name(name: str) -> str:

    patron, short_name = _split_youth_group_name(name)

    if not short_name:

        short_name = _strip_youth_prefix(name)



    existing = set(_youth_group_name_by_id.keys())

    max_num = 0

    for gid in existing:

        m = re.fullmatch(r"YG(\d{3,})", gid)

        if m:

            max_num = max(max_num, int(m.group(1)))



    next_gid = None

    candidate = max_num + 1

    while next_gid is None:

        gid = f"YG{candidate:03d}"

        if gid not in existing:

            next_gid = gid

        candidate += 1



    yg_df = _scd_sheet_active_df(YOUTH_GROUP_SHEET).copy()

    yg_df, _ = _normalize_youth_group_column_names(yg_df)

    if yg_df.empty:

        yg_df = pd.DataFrame(columns=[

            YOUTH_GROUP_ID_COL,

            YOUTH_GROUP_PATRON_COL,

            YOUTH_GROUP_SHORT_NAME_COL,

            YOUTH_GROUP_PARISH_ID_COL,

            YOUTH_GROUP_USE_PARISH_LOGO_COL,

            YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL,

        ])

    if YOUTH_GROUP_ID_COL not in yg_df.columns:

        yg_df[YOUTH_GROUP_ID_COL] = None

    if YOUTH_GROUP_PATRON_COL not in yg_df.columns:

        yg_df[YOUTH_GROUP_PATRON_COL] = None

    if YOUTH_GROUP_SHORT_NAME_COL not in yg_df.columns:

        yg_df[YOUTH_GROUP_SHORT_NAME_COL] = None

    if YOUTH_GROUP_PARISH_ID_COL not in yg_df.columns:

        yg_df[YOUTH_GROUP_PARISH_ID_COL] = None

    if YOUTH_GROUP_USE_PARISH_LOGO_COL not in yg_df.columns:

        yg_df[YOUTH_GROUP_USE_PARISH_LOGO_COL] = False

    if YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL not in yg_df.columns:

        yg_df[YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL] = False

    for obsolete_col in ("special_logo_active", "special_logo_occasion"):

        if obsolete_col in yg_df.columns:

            yg_df = yg_df.drop(columns=[obsolete_col])

    if "safe_key" in yg_df.columns:

        yg_df = yg_df.drop(columns=["safe_key"])

    if YOUTH_GROUP_NAME_COL in yg_df.columns:

        yg_df = yg_df.drop(columns=[YOUTH_GROUP_NAME_COL])



    rows = yg_df.replace({np.nan: None}).to_dict(orient="records")

    rows.append({

        YOUTH_GROUP_ID_COL: next_gid,

        YOUTH_GROUP_PATRON_COL: patron,

        YOUTH_GROUP_SHORT_NAME_COL: short_name,

        YOUTH_GROUP_PARISH_ID_COL: None,

        YOUTH_GROUP_USE_PARISH_LOGO_COL: False,

        YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL: False,

    })

    _scd_replace_rows_by_key(

        store,

        YOUTH_GROUP_SHEET,

        rows,

        [

            YOUTH_GROUP_ID_COL,

            YOUTH_GROUP_PATRON_COL,

            YOUTH_GROUP_SHORT_NAME_COL,

            YOUTH_GROUP_PARISH_ID_COL,

            YOUTH_GROUP_USE_PARISH_LOGO_COL,

            YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL,

        ],

        [YOUTH_GROUP_ID_COL],

        changed_by="admin",

    )

    _refresh_youth_group_indexes()

    return next_gid





def _ensure_youth_group_catalog() -> bool:

    changed = False

    youth_group_columns = [

        YOUTH_GROUP_ID_COL,

        YOUTH_GROUP_PATRON_COL,

        YOUTH_GROUP_SHORT_NAME_COL,

        YOUTH_GROUP_PARISH_ID_COL,

        YOUTH_GROUP_USE_PARISH_LOGO_COL,

        YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL,

    ]

    yg_df = _scd_sheet_active_df(YOUTH_GROUP_SHEET).copy()

    yg_df, renamed = _normalize_youth_group_column_names(yg_df)

    changed = changed or renamed



    if yg_df.empty:

        yg_df = pd.DataFrame(columns=[

            YOUTH_GROUP_ID_COL,

            YOUTH_GROUP_PATRON_COL,

            YOUTH_GROUP_SHORT_NAME_COL,

            YOUTH_GROUP_PARISH_ID_COL,

            YOUTH_GROUP_USE_PARISH_LOGO_COL,

            YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL,

        ])

        changed = True

    else:

        if YOUTH_GROUP_ID_COL not in yg_df.columns:

            yg_df[YOUTH_GROUP_ID_COL] = None

            changed = True

        if YOUTH_GROUP_PATRON_COL not in yg_df.columns:

            yg_df[YOUTH_GROUP_PATRON_COL] = None

            changed = True

        if YOUTH_GROUP_SHORT_NAME_COL not in yg_df.columns:

            yg_df[YOUTH_GROUP_SHORT_NAME_COL] = None

            changed = True

        if YOUTH_GROUP_PARISH_ID_COL not in yg_df.columns:

            yg_df[YOUTH_GROUP_PARISH_ID_COL] = None

            changed = True

        if YOUTH_GROUP_USE_PARISH_LOGO_COL not in yg_df.columns:

            yg_df[YOUTH_GROUP_USE_PARISH_LOGO_COL] = False

            changed = True

        if YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL not in yg_df.columns:

            yg_df[YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL] = False

            changed = True

        for obsolete_col in ("special_logo_active", "special_logo_occasion"):

            if obsolete_col in yg_df.columns:

                yg_df = yg_df.drop(columns=[obsolete_col])

                changed = True

        if "safe_key" in yg_df.columns:

            yg_df = yg_df.drop(columns=["safe_key"])

            changed = True



    if YOUTH_GROUP_NAME_COL in yg_df.columns:

        changed = True



    normalized_rows = []

    for row in yg_df.replace({np.nan: None}).to_dict(orient="records"):

        gid = _normalize_text(row.get(YOUTH_GROUP_ID_COL))

        raw_name = _normalize_text(row.get(YOUTH_GROUP_NAME_COL))

        patron = _normalize_text(row.get(YOUTH_GROUP_PATRON_COL))

        short_name = _normalize_text(row.get(YOUTH_GROUP_SHORT_NAME_COL))

        parish_id = _normalize_text(row.get(YOUTH_GROUP_PARISH_ID_COL))

        use_parish_logo = _to_bool(row.get(YOUTH_GROUP_USE_PARISH_LOGO_COL))

        inherit_parish_social_media = _to_bool(row.get(YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL))



        if short_name:

            parsed_patron, parsed_short = _split_youth_group_name(short_name)

            if parsed_short:

                if not patron and parsed_patron:

                    patron = parsed_patron

                short_name = parsed_short



        if not short_name and raw_name:

            parsed_patron, parsed_short = _split_youth_group_name(raw_name)

            patron = patron or parsed_patron

            short_name = parsed_short



        if not short_name and patron:

            short_name = patron

            patron = None



        if not short_name:

            continue

        if not gid:

            gid = _normalize_text(row.get("id"))

        normalized_rows.append({

            YOUTH_GROUP_ID_COL: gid,

            YOUTH_GROUP_PATRON_COL: patron,

            YOUTH_GROUP_SHORT_NAME_COL: short_name,

            YOUTH_GROUP_PARISH_ID_COL: parish_id,

            YOUTH_GROUP_USE_PARISH_LOGO_COL: use_parish_logo,

            YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL: inherit_parish_social_media,

        })



    used_ids = set()

    for row in normalized_rows:

        gid = row[YOUTH_GROUP_ID_COL]

        if gid and gid not in used_ids:

            used_ids.add(gid)

            continue

        row[YOUTH_GROUP_ID_COL] = None



    current_rows = [

        {col: row.get(col) for col in youth_group_columns}

        for row in yg_df.replace({np.nan: None}).to_dict(orient="records")

    ]

    if normalized_rows != current_rows:

        changed = True



    _scd_replace_rows_by_key(

        store,

        YOUTH_GROUP_SHEET,

        normalized_rows,

        youth_group_columns,

        [YOUTH_GROUP_ID_COL],

        changed_by="admin",

    )

    _refresh_youth_group_indexes()



    alt_names = set()

    for sheet in ("person_youth_group", "responsibilities"):

        df = store.get(sheet, pd.DataFrame())

        if df.empty:

            continue

        if YOUTH_GROUP_NAME_COL in df.columns:

            vals = df[YOUTH_GROUP_NAME_COL].dropna().astype(str).map(str.strip)

            alt_names.update(v for v in vals if v)



    for name in sorted(alt_names):

        if youth_group_id(name):

            continue

        _create_youth_group_id_for_name(name)

        changed = True



    yg_df = _scd_sheet_active_df(YOUTH_GROUP_SHEET, columns=youth_group_columns).copy()

    if not yg_df.empty:

        yg_df = yg_df.drop_duplicates(subset=[YOUTH_GROUP_ID_COL], keep="first")

        yg_df = yg_df.sort_values(by=[YOUTH_GROUP_SHORT_NAME_COL, YOUTH_GROUP_ID_COL], na_position="last").reset_index(drop=True)

        _scd_replace_rows_by_key(

            store,

            YOUTH_GROUP_SHEET,

            yg_df.replace({np.nan: None}).to_dict(orient="records"),

            youth_group_columns,

            [YOUTH_GROUP_ID_COL],

            changed_by="admin",

        )

        _refresh_youth_group_indexes()



    return changed





def _migrate_group_columns_in_store() -> bool:

    changed = False

    for sheet in ("person_youth_group", "responsibilities"):

        df = store.get(sheet, pd.DataFrame()).copy()

        if df.empty:

            continue



        if YOUTH_GROUP_ID_COL not in df.columns:

            df[YOUTH_GROUP_ID_COL] = None

            changed = True



        new_ids = []

        before_ids = df[YOUTH_GROUP_ID_COL].replace({np.nan: None}).tolist()

        before_names = df[YOUTH_GROUP_NAME_COL].replace({np.nan: None}).tolist() if YOUTH_GROUP_NAME_COL in df.columns else [None] * len(df)



        for raw_id, raw_name in zip(before_ids, before_names):

            gid = youth_group_id(raw_id)

            if gid is None:

                gid = youth_group_id(raw_name, create=True)

            new_ids.append(gid)



        if before_ids != new_ids:

            changed = True

            df[YOUTH_GROUP_ID_COL] = new_ids



        if YOUTH_GROUP_NAME_COL in df.columns:

            df = df.drop(columns=[YOUTH_GROUP_NAME_COL])

            changed = True



        store[sheet] = df



    return changed





def _ensure_youth_group_schema() -> bool:

    changed = _ensure_youth_group_catalog()

    changed = _migrate_group_columns_in_store() or changed

    return changed





def _ensure_addresses_schema() -> bool:

    changed = False

    persons = store.get("persons", pd.DataFrame()).copy()

    addresses = _scd_ensure_columns(store.get(ADDRESS_SHEET, pd.DataFrame()).copy())



    if addresses.empty:

        addresses = pd.DataFrame(columns=ADDRESS_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in ADDRESS_COLUMNS:

            if col not in addresses.columns:

                addresses[col] = None

                changed = True



    active_addr_df, inactive_addr_df = _scd_split(addresses)

    active_rows = active_addr_df.replace({np.nan: None}).to_dict(orient="records") if not active_addr_df.empty else []

    normalized_rows = normalize_address_rows(active_rows)



    if not persons.empty and "person_id" in persons.columns:

        existing_ids = {str(row.get("person_id")) for row in normalized_rows if row.get("person_id") not in (None, "")}

        for row in persons.replace({np.nan: None}).to_dict(orient="records"):

            pid = _normalize_person_id(row.get("person_id"))

            if pid in (None, "") or str(pid) in existing_ids:

                continue

            governorate = _normalize_text(row.get("governorate"))

            city = _normalize_text(row.get("city"))

            address = _normalize_text(_first_present(row, STREET_ADDRESS_COL, "address"))

            country = _normalize_country(row.get("country"))

            location_url = _normalize_text(row.get("location_url"))

            lat = _normalize_coordinate(row.get("lat"), "lat")

            lng = _normalize_coordinate(row.get("lng"), "lng")

            has_text_address = bool(governorate or city or address)

            has_location_reference = bool(location_url or lat is not None or lng is not None)

            if not has_text_address and not has_location_reference:

                continue

            normalized_rows.append({

                "person_id": pid,

                "country": country,

                "governorate": governorate,

                "city": city,

                STREET_ADDRESS_COL: address,

                "address": address,

                "lat": lat,

                "lng": lng,

                "is_primary": True,

            })

            changed = True



    normalized_rows = normalize_address_rows(normalized_rows)

    current_rows = [{col: row.get(col) for col in ADDRESS_COLUMNS} for row in active_rows]

    normalized_business_rows = [{col: row.get(col) for col in ADDRESS_COLUMNS} for row in normalized_rows]

    if normalized_business_rows != current_rows:

        changed = True



    default_scd = {c: (True if c == SCD_CURRENTLY_ACTIVE_FLAG_COL else None) for c in SCD_METADATA_COLUMNS}

    normalized_rows_with_scd = [

        {**row, **({c: active_rows[i].get(c) for c in SCD_METADATA_COLUMNS} if i < len(active_rows) else default_scd)}

        for i, row in enumerate(normalized_rows)

    ]

    inactive_addr_rows = inactive_addr_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_addr_df.empty else []

    store[ADDRESS_SHEET] = pd.DataFrame(normalized_rows_with_scd + inactive_addr_rows)

    store["persons"] = persons

    return changed





def _ensure_mobile_numbers_schema() -> bool:

    changed = False

    mobile_numbers = _scd_ensure_columns(store.get(MOBILE_NUMBER_SHEET, pd.DataFrame()).copy())

    mobile_number_family_relations = _scd_ensure_columns(store.get(MOBILE_NUMBER_FAMILY_RELATION_SHEET, pd.DataFrame()).copy())

    personal_mobile_number_primary = _scd_ensure_columns(store.get(PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET, pd.DataFrame()).copy())

    mobile_number_linked_jobs = _scd_ensure_columns(store.get(MOBILE_NUMBER_LINKED_JOB_SHEET, pd.DataFrame()).copy())



    if mobile_numbers.empty:

        mobile_numbers = pd.DataFrame(columns=MOBILE_NUMBER_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in MOBILE_NUMBER_COLUMNS:

            if col not in mobile_numbers.columns:

                mobile_numbers[col] = None

                changed = True

        if any(col not in MOBILE_NUMBER_COLUMNS and col not in SCD_METADATA_COLUMNS and col not in ("family_relation", "linked_job_ids") for col in mobile_numbers.columns):

            changed = True



    # Split active/inactive and normalize only active rows

    active_mob_df, inactive_mob_df = _scd_split(mobile_numbers)

    active_rows = active_mob_df.replace({np.nan: None}).to_dict(orient="records") if not active_mob_df.empty else []

    normalized_payload_rows = normalize_mobile_number_rows(active_rows)

    normalized_rows = [{col: row.get(col) for col in MOBILE_NUMBER_COLUMNS} for row in normalized_payload_rows]

    current_rows = [{col: row.get(col) for col in MOBILE_NUMBER_COLUMNS} for row in active_rows]

    if normalized_rows != current_rows:

        changed = True



    # All record IDs (active + inactive) for satellite validation

    all_mobile_record_ids = {

        str(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        for row in (active_rows + (inactive_mob_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_mob_df.empty else []))

        if row.get(MOBILE_NUMBER_RECORD_ID_COL)

    }

    active_mobile_record_ids = {str(row.get(MOBILE_NUMBER_RECORD_ID_COL)) for row in normalized_rows if row.get(MOBILE_NUMBER_RECORD_ID_COL)}



    if mobile_number_family_relations.empty:

        mobile_number_family_relations = pd.DataFrame(columns=MOBILE_NUMBER_FAMILY_RELATION_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in MOBILE_NUMBER_FAMILY_RELATION_COLUMNS:

            if col not in mobile_number_family_relations.columns:

                mobile_number_family_relations[col] = None

                changed = True

        if any(col not in MOBILE_NUMBER_FAMILY_RELATION_COLUMNS and col not in SCD_METADATA_COLUMNS for col in mobile_number_family_relations.columns):

            changed = True



    active_fam_df, inactive_fam_df = _scd_split(mobile_number_family_relations)

    existing_family_rows = active_fam_df.replace({np.nan: None}).to_dict(orient="records") if not active_fam_df.empty else []

    embedded_family_rows = mobile_number_family_relation_rows_from_mobile_rows(normalized_payload_rows)

    normalized_family_rows = normalize_mobile_number_family_relation_rows(existing_family_rows + embedded_family_rows, active_mobile_record_ids)

    current_family_rows = normalize_mobile_number_family_relation_rows(existing_family_rows, active_mobile_record_ids)

    if normalized_family_rows != current_family_rows:

        changed = True



    if personal_mobile_number_primary.empty:

        personal_mobile_number_primary = pd.DataFrame(columns=PERSONAL_MOBILE_NUMBER_PRIMARY_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in PERSONAL_MOBILE_NUMBER_PRIMARY_COLUMNS:

            if col not in personal_mobile_number_primary.columns:

                personal_mobile_number_primary[col] = None

                changed = True

        if any(col not in PERSONAL_MOBILE_NUMBER_PRIMARY_COLUMNS and col not in SCD_METADATA_COLUMNS for col in personal_mobile_number_primary.columns):

            changed = True



    personal_mobile_record_ids = {

        str(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        for row in normalized_payload_rows

        if row.get(MOBILE_NUMBER_RECORD_ID_COL) and _normalize_mobile_number_type(_first_present(row, MOBILE_NUMBER_TYPE_COL, "type")) == "personal"

    }

    active_prim_df, inactive_prim_df = _scd_split(personal_mobile_number_primary)

    existing_personal_primary_rows = active_prim_df.replace({np.nan: None}).to_dict(orient="records") if not active_prim_df.empty else []

    embedded_personal_primary_rows = personal_mobile_number_primary_rows_from_mobile_rows(normalized_payload_rows)

    normalized_personal_primary_rows = normalize_personal_mobile_number_primary_rows(existing_personal_primary_rows + embedded_personal_primary_rows, personal_mobile_record_ids)

    current_personal_primary_rows = normalize_personal_mobile_number_primary_rows(existing_personal_primary_rows, personal_mobile_record_ids)

    if normalized_personal_primary_rows != current_personal_primary_rows:

        changed = True



    if mobile_number_linked_jobs.empty:

        mobile_number_linked_jobs = pd.DataFrame(columns=MOBILE_NUMBER_LINKED_JOB_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in MOBILE_NUMBER_LINKED_JOB_COLUMNS:

            if col not in mobile_number_linked_jobs.columns:

                mobile_number_linked_jobs[col] = None

                changed = True

        if any(col not in MOBILE_NUMBER_LINKED_JOB_COLUMNS and col not in SCD_METADATA_COLUMNS for col in mobile_number_linked_jobs.columns):

            changed = True



    active_lnk_df, inactive_lnk_df = _scd_split(mobile_number_linked_jobs)

    existing_linked_job_rows = active_lnk_df.replace({np.nan: None}).to_dict(orient="records") if not active_lnk_df.empty else []

    embedded_linked_job_rows = mobile_number_linked_job_rows_from_mobile_rows(normalized_payload_rows)

    normalized_linked_job_rows = normalize_mobile_number_linked_job_rows(existing_linked_job_rows + embedded_linked_job_rows, active_mobile_record_ids)

    current_linked_job_rows = normalize_mobile_number_linked_job_rows(existing_linked_job_rows, active_mobile_record_ids)

    if normalized_linked_job_rows != current_linked_job_rows:

        changed = True



    # Restore SCD metadata and combine with inactive rows

    norm_mob_scd = _scd_preserve_metadata(normalized_rows, active_rows, MOBILE_NUMBER_RECORD_ID_COL)

    inactive_mob_rows = inactive_mob_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_mob_df.empty else []

    store[MOBILE_NUMBER_SHEET] = pd.DataFrame(norm_mob_scd + inactive_mob_rows)



    norm_fam_scd = _scd_preserve_metadata(normalized_family_rows, existing_family_rows, MOBILE_NUMBER_RECORD_ID_COL)

    inactive_fam_rows = inactive_fam_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_fam_df.empty else []

    store[MOBILE_NUMBER_FAMILY_RELATION_SHEET] = pd.DataFrame(norm_fam_scd + inactive_fam_rows)



    norm_prim_scd = _scd_preserve_metadata(normalized_personal_primary_rows, existing_personal_primary_rows, MOBILE_NUMBER_RECORD_ID_COL)

    inactive_prim_rows = inactive_prim_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_prim_df.empty else []

    store[PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET] = pd.DataFrame(norm_prim_scd + inactive_prim_rows)



    norm_lnk_scd = _scd_preserve_metadata(normalized_linked_job_rows, existing_linked_job_rows, MOBILE_NUMBER_RECORD_ID_COL)

    inactive_lnk_rows = inactive_lnk_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_lnk_df.empty else []

    store[MOBILE_NUMBER_LINKED_JOB_SHEET] = pd.DataFrame(norm_lnk_scd + inactive_lnk_rows)

    return changed





def _ensure_nationality_schema() -> bool:

    changed = False

    nationality = _scd_ensure_columns(store.get(NATIONALITY_SHEET, pd.DataFrame()).copy())



    if nationality.empty:

        nationality = pd.DataFrame(columns=NATIONALITY_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in NATIONALITY_COLUMNS:

            if col not in nationality.columns:

                nationality[col] = None

                changed = True

        if any(col not in NATIONALITY_COLUMNS and col not in SCD_METADATA_COLUMNS for col in nationality.columns):

            changed = True



    active_df, inactive_df = _scd_split(nationality)

    active_rows = active_df.replace({np.nan: None}).to_dict(orient="records") if not active_df.empty else []

    normalized_payload_rows = normalize_nationality_payload_rows(active_rows)

    normalized_rows = [{col: row.get(col) for col in NATIONALITY_COLUMNS} for row in normalized_payload_rows]

    current_rows = [{col: row.get(col) for col in NATIONALITY_COLUMNS} for row in active_rows]

    if normalized_rows != current_rows:

        changed = True



    normalized_rows_with_scd = _scd_preserve_metadata(normalized_rows, active_rows, "nationality")

    inactive_rows = inactive_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_df.empty else []

    store[NATIONALITY_SHEET] = pd.DataFrame(normalized_rows_with_scd + inactive_rows)

    return changed





def _ensure_schools_schema() -> bool:

    changed = False

    schools = _scd_ensure_columns(store.get(SCHOOL_SHEET, pd.DataFrame()).copy())

    school_sections = _scd_ensure_columns(store.get(SCHOOL_SECTION_SHEET, pd.DataFrame()).copy())

    school_grades = _scd_ensure_columns(store.get(SCHOOL_GRADE_SHEET, pd.DataFrame()).copy())



    if schools.empty:

        schools = pd.DataFrame(columns=SCHOOL_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in SCHOOL_COLUMNS:

            if col not in schools.columns:

                schools[col] = None

                changed = True

        if any(col not in SCHOOL_COLUMNS and col not in SCD_METADATA_COLUMNS and col not in ("section", "grades_attended") for col in schools.columns):

            changed = True



    active_sch_df, inactive_sch_df = _scd_split(schools)

    active_rows = active_sch_df.replace({np.nan: None}).to_dict(orient="records") if not active_sch_df.empty else []

    normalized_payload_rows = normalize_school_payload_rows(active_rows)

    normalized_rows = [{col: row.get(col) for col in SCHOOL_COLUMNS} for row in normalized_payload_rows]

    current_rows = [{col: row.get(col) for col in SCHOOL_COLUMNS} for row in active_rows]

    if normalized_rows != current_rows:

        changed = True



    active_school_record_ids = {str(row.get(SCHOOL_RECORD_ID_COL)) for row in normalized_rows if row.get(SCHOOL_RECORD_ID_COL)}



    if school_sections.empty:

        school_sections = pd.DataFrame(columns=SCHOOL_SECTION_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in SCHOOL_SECTION_COLUMNS:

            if col not in school_sections.columns:

                school_sections[col] = None

                changed = True

        if any(col not in SCHOOL_SECTION_COLUMNS and col not in SCD_METADATA_COLUMNS for col in school_sections.columns):

            changed = True



    if school_grades.empty:

        school_grades = pd.DataFrame(columns=SCHOOL_GRADE_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in SCHOOL_GRADE_COLUMNS:

            if col not in school_grades.columns:

                school_grades[col] = None

                changed = True

        if any(col not in SCHOOL_GRADE_COLUMNS and col not in SCD_METADATA_COLUMNS for col in school_grades.columns):

            changed = True



    active_sec_df, inactive_sec_df = _scd_split(school_sections)

    existing_section_rows = active_sec_df.replace({np.nan: None}).to_dict(orient="records") if not active_sec_df.empty else []

    embedded_section_rows = school_section_rows_from_school_rows(normalized_payload_rows)

    normalized_section_rows = normalize_school_section_rows(existing_section_rows + embedded_section_rows, active_school_record_ids)

    current_section_rows = normalize_school_section_rows(existing_section_rows, active_school_record_ids)

    if normalized_section_rows != current_section_rows:

        changed = True



    active_grd_df, inactive_grd_df = _scd_split(school_grades)

    existing_grade_rows = active_grd_df.replace({np.nan: None}).to_dict(orient="records") if not active_grd_df.empty else []

    embedded_grade_rows = school_grade_rows_from_school_rows(normalized_payload_rows)

    normalized_grade_rows = normalize_school_grade_rows(existing_grade_rows + embedded_grade_rows, active_school_record_ids)

    current_grade_rows = normalize_school_grade_rows(existing_grade_rows, active_school_record_ids)

    if normalized_grade_rows != current_grade_rows:

        changed = True



    norm_sch_scd = _scd_preserve_metadata(normalized_rows, active_rows, SCHOOL_RECORD_ID_COL)

    inactive_sch_rows = inactive_sch_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_sch_df.empty else []

    store[SCHOOL_SHEET] = pd.DataFrame(norm_sch_scd + inactive_sch_rows)



    norm_sec_scd = _scd_preserve_metadata(normalized_section_rows, existing_section_rows, SCHOOL_RECORD_ID_COL)

    inactive_sec_rows = inactive_sec_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_sec_df.empty else []

    store[SCHOOL_SECTION_SHEET] = pd.DataFrame(norm_sec_scd + inactive_sec_rows)



    norm_grd_scd = _scd_preserve_metadata(normalized_grade_rows, existing_grade_rows, SCHOOL_RECORD_ID_COL)

    inactive_grd_rows = inactive_grd_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_grd_df.empty else []

    store[SCHOOL_GRADE_SHEET] = pd.DataFrame(norm_grd_scd + inactive_grd_rows)

    return changed





def _ensure_emails_schema() -> bool:

    changed = False

    emails = _scd_ensure_columns(store.get(EMAIL_SHEET, pd.DataFrame()).copy())

    email_family_relations = _scd_ensure_columns(store.get(EMAIL_FAMILY_RELATION_SHEET, pd.DataFrame()).copy())

    personal_email_primary = _scd_ensure_columns(store.get(PERSONAL_EMAIL_PRIMARY_SHEET, pd.DataFrame()).copy())

    email_linked_jobs = _scd_ensure_columns(store.get(EMAIL_LINKED_JOB_SHEET, pd.DataFrame()).copy())



    if emails.empty:

        emails = pd.DataFrame(columns=EMAIL_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in EMAIL_COLUMNS:

            if col not in emails.columns:

                emails[col] = None

                changed = True

        if any(col not in EMAIL_COLUMNS and col not in SCD_METADATA_COLUMNS for col in emails.columns):

            changed = True



    if email_family_relations.empty:

        email_family_relations = pd.DataFrame(columns=EMAIL_FAMILY_RELATION_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in EMAIL_FAMILY_RELATION_COLUMNS:

            if col not in email_family_relations.columns:

                email_family_relations[col] = None

                changed = True

        if any(col not in EMAIL_FAMILY_RELATION_COLUMNS and col not in SCD_METADATA_COLUMNS for col in email_family_relations.columns):

            changed = True



    if personal_email_primary.empty:

        personal_email_primary = pd.DataFrame(columns=PERSONAL_EMAIL_PRIMARY_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in PERSONAL_EMAIL_PRIMARY_COLUMNS:

            if col not in personal_email_primary.columns:

                personal_email_primary[col] = None

                changed = True

        if any(col not in PERSONAL_EMAIL_PRIMARY_COLUMNS and col not in SCD_METADATA_COLUMNS for col in personal_email_primary.columns):

            changed = True



    if email_linked_jobs.empty:

        email_linked_jobs = pd.DataFrame(columns=EMAIL_LINKED_JOB_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in EMAIL_LINKED_JOB_COLUMNS:

            if col not in email_linked_jobs.columns:

                email_linked_jobs[col] = None

                changed = True

        if any(col not in EMAIL_LINKED_JOB_COLUMNS and col not in SCD_METADATA_COLUMNS for col in email_linked_jobs.columns):

            changed = True



    active_em_df, inactive_em_df = _scd_split(emails)

    active_rows = active_em_df.replace({np.nan: None}).to_dict(orient="records") if not active_em_df.empty else []

    normalized_rows = normalize_email_rows(active_rows)

    active_email_record_ids = {

        record_id for record_id in (

            _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL)) for row in normalized_rows

        ) if record_id

    }

    personal_email_record_ids = {

        record_id for record_id in (

            _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

            for row in normalized_rows

            if _normalize_email_type(_first_present(row, EMAIL_TYPE_COL, "type")) == "personal"

        ) if record_id

    }



    active_fam_df, inactive_fam_df = _scd_split(email_family_relations)

    existing_family_rows = active_fam_df.replace({np.nan: None}).to_dict(orient="records") if not active_fam_df.empty else []

    embedded_family_rows = email_family_relation_rows_from_email_rows(active_rows)

    normalized_family_rows = normalize_email_family_relation_rows(existing_family_rows + embedded_family_rows, active_email_record_ids)

    current_family_rows = normalize_email_family_relation_rows(existing_family_rows, active_email_record_ids)



    active_prim_df, inactive_prim_df = _scd_split(personal_email_primary)

    existing_personal_primary_rows = active_prim_df.replace({np.nan: None}).to_dict(orient="records") if not active_prim_df.empty else []

    embedded_personal_primary_rows = personal_email_primary_rows_from_email_rows(active_rows)

    normalized_personal_primary_rows = normalize_personal_email_primary_rows(existing_personal_primary_rows + embedded_personal_primary_rows, personal_email_record_ids)

    current_personal_primary_rows = normalize_personal_email_primary_rows(existing_personal_primary_rows, personal_email_record_ids)



    active_lnk_df, inactive_lnk_df = _scd_split(email_linked_jobs)

    existing_linked_job_rows = active_lnk_df.replace({np.nan: None}).to_dict(orient="records") if not active_lnk_df.empty else []

    embedded_linked_job_rows = email_linked_job_rows_from_email_rows(active_rows)

    normalized_linked_job_rows = normalize_email_linked_job_rows(existing_linked_job_rows + embedded_linked_job_rows, active_email_record_ids)

    current_linked_job_rows = normalize_email_linked_job_rows(existing_linked_job_rows, active_email_record_ids)



    current_rows = [{col: row.get(col) for col in EMAIL_COLUMNS} for row in active_rows]

    normalized_email_sheet_rows = [{col: row.get(col) for col in EMAIL_COLUMNS} for row in normalized_rows]

    if normalized_email_sheet_rows != current_rows:

        changed = True

    if normalized_family_rows != current_family_rows:

        changed = True

    if normalized_personal_primary_rows != current_personal_primary_rows:

        changed = True

    if normalized_linked_job_rows != current_linked_job_rows:

        changed = True



    norm_em_scd = _scd_preserve_metadata(normalized_email_sheet_rows, active_rows, EMAIL_RECORD_ID_COL)

    inactive_em_rows = inactive_em_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_em_df.empty else []

    store[EMAIL_SHEET] = pd.DataFrame(norm_em_scd + inactive_em_rows)



    norm_fam_scd = _scd_preserve_metadata(normalized_family_rows, existing_family_rows, EMAIL_RECORD_ID_COL)

    inactive_fam_rows = inactive_fam_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_fam_df.empty else []

    store[EMAIL_FAMILY_RELATION_SHEET] = pd.DataFrame(norm_fam_scd + inactive_fam_rows)



    norm_prim_scd = _scd_preserve_metadata(normalized_personal_primary_rows, existing_personal_primary_rows, EMAIL_RECORD_ID_COL)

    inactive_prim_rows = inactive_prim_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_prim_df.empty else []

    store[PERSONAL_EMAIL_PRIMARY_SHEET] = pd.DataFrame(norm_prim_scd + inactive_prim_rows)



    norm_lnk_scd = _scd_preserve_metadata(normalized_linked_job_rows, existing_linked_job_rows, EMAIL_RECORD_ID_COL)

    inactive_lnk_rows = inactive_lnk_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_lnk_df.empty else []

    store[EMAIL_LINKED_JOB_SHEET] = pd.DataFrame(norm_lnk_scd + inactive_lnk_rows)

    return changed





def _ensure_social_media_schema() -> bool:

    changed = False

    social_media = _scd_ensure_columns(store.get(SOCIAL_MEDIA_SHEET, pd.DataFrame()).copy())



    if social_media.empty:

        social_media = pd.DataFrame(columns=SOCIAL_MEDIA_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in SOCIAL_MEDIA_COLUMNS:

            if col not in social_media.columns:

                social_media[col] = None

                changed = True



    active_df, inactive_df = _scd_split(social_media)

    active_rows = active_df.replace({np.nan: None}).to_dict(orient="records") if not active_df.empty else []

    normalized_rows = normalize_social_media_rows(active_rows)

    current_rows = [{col: row.get(col) for col in SOCIAL_MEDIA_COLUMNS} for row in active_rows]

    if [{col: r.get(col) for col in SOCIAL_MEDIA_COLUMNS} for r in normalized_rows] != current_rows:

        changed = True



    normalized_rows_with_scd = _scd_preserve_metadata(normalized_rows, active_rows, "url")

    inactive_rows = inactive_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_df.empty else []

    store[SOCIAL_MEDIA_SHEET] = pd.DataFrame(normalized_rows_with_scd + inactive_rows)

    return changed





def _ensure_jobs_schema() -> bool:

    changed = False

    jobs = _scd_ensure_columns(store.get(JOB_SHEET, pd.DataFrame()).copy())



    if jobs.empty:

        jobs = pd.DataFrame(columns=JOB_BASE_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in JOB_BASE_COLUMNS:

            if col not in jobs.columns:

                jobs[col] = None

                changed = True

        if any(col not in JOB_BASE_COLUMNS and col not in SCD_METADATA_COLUMNS and col != "is_current" for col in jobs.columns):

            changed = True



    active_jobs_df, inactive_jobs_df = _scd_split(jobs)

    active_rows = active_jobs_df.replace({np.nan: None}).to_dict(orient="records") if not active_jobs_df.empty else []

    normalized_rows, job_id_map = normalize_job_rows(active_rows)

    current_rows = [{col: row.get(col) for col in JOB_BASE_COLUMNS} for row in active_rows]

    if normalized_rows != current_rows:

        changed = True



    norm_jobs_scd = _scd_preserve_metadata(normalized_rows, active_rows, JOB_ID_COL)

    inactive_jobs_rows = inactive_jobs_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_jobs_df.empty else []



    # Re-normalize emails (preserve SCD metadata)

    emails = _scd_ensure_columns(store.get(EMAIL_SHEET, pd.DataFrame()).copy())

    active_email_df, inactive_email_df = _scd_split(emails)

    active_email_rows = active_email_df.replace({np.nan: None}).to_dict(orient="records") if not active_email_df.empty else []

    normalized_email_rows = normalize_email_rows(active_email_rows)

    current_email_rows = [{col: row.get(col) for col in EMAIL_COLUMNS} for row in active_email_rows]

    normalized_email_sheet_rows = [{col: row.get(col) for col in EMAIL_COLUMNS} for row in normalized_email_rows]

    if normalized_email_sheet_rows != current_email_rows:

        changed = True

    norm_email_scd = _scd_preserve_metadata(normalized_email_sheet_rows, active_email_rows, EMAIL_RECORD_ID_COL)

    inactive_email_rows = inactive_email_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_email_df.empty else []

    store[EMAIL_SHEET] = pd.DataFrame(norm_email_scd + inactive_email_rows)



    # Remap email_linked_jobs job IDs (preserve SCD metadata)

    email_linked_jobs = _scd_ensure_columns(store.get(EMAIL_LINKED_JOB_SHEET, pd.DataFrame()).copy())

    active_elj_df, inactive_elj_df = _scd_split(email_linked_jobs)

    active_elj_rows = active_elj_df.replace({np.nan: None}).to_dict(orient="records") if not active_elj_df.empty else []

    remapped_email_linked_job_rows = []

    for row in active_elj_rows:

        if not isinstance(row, dict):

            continue

        record_id = _normalize_email_record_id(row.get(EMAIL_RECORD_ID_COL))

        if not record_id:

            continue

        for job_id in _remap_linked_job_ids_value(row.get("linked_job_ids"), job_id_map):

            remapped_email_linked_job_rows.append({

                EMAIL_RECORD_ID_COL: record_id,

                "linked_job_ids": job_id,

            })

    normalized_email_linked_job_rows = normalize_email_linked_job_rows(remapped_email_linked_job_rows)

    current_elj_rows = [{col: row.get(col) for col in EMAIL_LINKED_JOB_COLUMNS} for row in active_elj_rows]

    if normalized_email_linked_job_rows != current_elj_rows:

        changed = True

    norm_elj_scd = _scd_preserve_metadata(normalized_email_linked_job_rows, active_elj_rows, EMAIL_RECORD_ID_COL)

    inactive_elj_rows = inactive_elj_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_elj_df.empty else []

    store[EMAIL_LINKED_JOB_SHEET] = pd.DataFrame(norm_elj_scd + inactive_elj_rows)



    # Remap mobile_number_linked_jobs job IDs (preserve SCD metadata)

    mobile_linked_jobs = _scd_ensure_columns(store.get(MOBILE_NUMBER_LINKED_JOB_SHEET, pd.DataFrame()).copy())

    active_mlj_df, inactive_mlj_df = _scd_split(mobile_linked_jobs)

    active_mlj_rows = active_mlj_df.replace({np.nan: None}).to_dict(orient="records") if not active_mlj_df.empty else []

    remapped_mobile_linked_job_rows = []

    for row in active_mlj_rows:

        if not isinstance(row, dict):

            continue

        record_id = _normalize_mobile_number_record_id(row.get(MOBILE_NUMBER_RECORD_ID_COL))

        if not record_id:

            continue

        for job_id in _remap_linked_job_ids_value(row.get("linked_job_ids"), job_id_map):

            remapped_mobile_linked_job_rows.append({

                MOBILE_NUMBER_RECORD_ID_COL: record_id,

                "linked_job_ids": job_id,

            })

    normalized_mobile_linked_job_rows = normalize_mobile_number_linked_job_rows(remapped_mobile_linked_job_rows)

    current_mlj_rows = [{col: row.get(col) for col in MOBILE_NUMBER_LINKED_JOB_COLUMNS} for row in active_mlj_rows]

    if normalized_mobile_linked_job_rows != current_mlj_rows:

        changed = True

    norm_mlj_scd = _scd_preserve_metadata(normalized_mobile_linked_job_rows, active_mlj_rows, MOBILE_NUMBER_RECORD_ID_COL)

    inactive_mlj_rows = inactive_mlj_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_mlj_df.empty else []

    store[MOBILE_NUMBER_LINKED_JOB_SHEET] = pd.DataFrame(norm_mlj_scd + inactive_mlj_rows)



    store[JOB_SHEET] = pd.DataFrame(norm_jobs_scd + inactive_jobs_rows)

    return changed





def _ensure_higher_education_schema() -> bool:

    changed = False

    higher_education = _scd_ensure_columns(store.get(HIGHER_EDUCATION_SHEET, pd.DataFrame()).copy())



    if higher_education.empty:

        higher_education = pd.DataFrame(columns=HIGHER_EDUCATION_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in HIGHER_EDUCATION_COLUMNS:

            if col not in higher_education.columns:

                higher_education[col] = None

                changed = True

        if any(col not in HIGHER_EDUCATION_COLUMNS and col not in SCD_METADATA_COLUMNS and col != "is_current" for col in higher_education.columns):

            changed = True



    active_df, inactive_df = _scd_split(higher_education)

    active_rows = active_df.replace({np.nan: None}).to_dict(orient="records") if not active_df.empty else []

    normalized_rows = normalize_higher_education_rows(active_rows)

    current_rows = [{col: row.get(col) for col in HIGHER_EDUCATION_COLUMNS} for row in active_rows]

    if normalized_rows != current_rows:

        changed = True



    default_scd = {c: (True if c == SCD_CURRENTLY_ACTIVE_FLAG_COL else None) for c in SCD_METADATA_COLUMNS}

    normalized_rows_with_scd = [

        {**row, **({c: active_rows[i].get(c) for c in SCD_METADATA_COLUMNS} if i < len(active_rows) else default_scd)}

        for i, row in enumerate(normalized_rows)

    ]

    inactive_rows = inactive_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_df.empty else []

    store[HIGHER_EDUCATION_SHEET] = pd.DataFrame(normalized_rows_with_scd + inactive_rows)

    return changed





def _ensure_responsibility_schema() -> bool:

    changed = False

    responsibilities = _scd_ensure_columns(store.get(RESPONSIBILITY_SHEET, pd.DataFrame()).copy())



    if responsibilities.empty:

        responsibilities = pd.DataFrame(columns=RESPONSIBILITY_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in RESPONSIBILITY_COLUMNS:

            if col not in responsibilities.columns:

                responsibilities[col] = None

                changed = True

        if any(col not in RESPONSIBILITY_COLUMNS and col not in SCD_METADATA_COLUMNS and col not in {"time", "responsibility", "responsibility_period", "is_active"} for col in responsibilities.columns):

            changed = True



    active_df, inactive_df = _scd_split(responsibilities)

    active_rows = active_df.replace({np.nan: None}).to_dict(orient="records") if not active_df.empty else []

    normalized_rows = normalize_responsibility_rows(active_rows)

    current_rows = [{col: row.get(col) for col in RESPONSIBILITY_COLUMNS} for row in active_rows]

    normalized_sheet_rows = [{col: row.get(col) for col in RESPONSIBILITY_COLUMNS} for row in normalized_rows]

    if normalized_sheet_rows != current_rows:

        changed = True



    default_scd = {c: (True if c == SCD_CURRENTLY_ACTIVE_FLAG_COL else None) for c in SCD_METADATA_COLUMNS}

    normalized_rows_with_scd = [

        {**row, **({c: active_rows[i].get(c) for c in SCD_METADATA_COLUMNS} if i < len(active_rows) else default_scd)}

        for i, row in enumerate(normalized_sheet_rows)

    ]

    inactive_rows = inactive_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_df.empty else []

    store[RESPONSIBILITY_SHEET] = pd.DataFrame(normalized_rows_with_scd + inactive_rows)

    return changed





def _ensure_youth_group_special_logo_schema() -> bool:

    changed = False

    special_logos = _scd_sheet_active_df(YOUTH_GROUP_SPECIAL_LOGO_SHEET, columns=YOUTH_GROUP_SPECIAL_LOGO_COLUMNS).copy()



    if special_logos.empty:

        special_logos = pd.DataFrame(columns=YOUTH_GROUP_SPECIAL_LOGO_COLUMNS)

        changed = True

    else:

        for col in YOUTH_GROUP_SPECIAL_LOGO_COLUMNS:

            if col not in special_logos.columns:

                special_logos[col] = None

                changed = True

        if any(col not in YOUTH_GROUP_SPECIAL_LOGO_COLUMNS for col in special_logos.columns):

            changed = True



    existing_rows = special_logos.replace({np.nan: None}).to_dict(orient="records") if not special_logos.empty else []

    normalized_rows = normalize_youth_group_special_logo_rows(existing_rows)

    current_rows = [{col: row.get(col) for col in YOUTH_GROUP_SPECIAL_LOGO_COLUMNS} for row in existing_rows]

    if normalized_rows != current_rows:

        changed = True



    _scd_replace_rows_by_key(

        store,

        YOUTH_GROUP_SPECIAL_LOGO_SHEET,

        normalized_rows,

        YOUTH_GROUP_SPECIAL_LOGO_COLUMNS,

        [SPECIAL_LOGO_ID_COL],

        changed_by="admin",

    )

    return changed





def _coerce_person_id_columns(target_store: dict[str, pd.DataFrame]):

    """Convert any float64 person_id columns to nullable Int64 so that

    .astype(str) produces '2' instead of '2.0'."""

    for sheet_name in list(target_store.keys()):

        df = target_store[sheet_name]

        if "person_id" in df.columns and df["person_id"].dtype == np.float64:

            target_store[sheet_name] = df.copy()

            target_store[sheet_name]["person_id"] = df["person_id"].astype("Int64")





def save():

    _ensure_persons_schema()

    _ensure_person_titles_schema()

    _ensure_person_school_system_sector_schema()

    _ensure_person_health_condition_schema()

    _ensure_person_special_note_schema()

    _ensure_person_youth_group_schema()

    _ensure_youth_group_schema()

    _ensure_youth_group_special_logo_schema()

    _ensure_nationality_schema()

    _ensure_schools_schema()

    _ensure_mobile_numbers_schema()

    _ensure_emails_schema()

    _ensure_social_media_schema()

    _ensure_higher_education_schema()

    _ensure_jobs_schema()

    _ensure_responsibility_schema()

    _ensure_addresses_schema()

    _coerce_person_id_columns(store)

    db.save_excel_sheets(store)

    invalidate_enriched_cache()

    _console_print("💾 Saved to CSV.")





def df_to_json(df: pd.DataFrame):

    df = db.normalize_boolean_columns(df.copy())

    for col in df.columns:

        if pd.api.types.is_datetime64_any_dtype(df[col]):

            df[col] = df[col].dt.strftime('%Y-%m-%d').where(df[col].notna(), None)

    return json_safe(df.replace({np.nan: None}).to_dict(orient="records"))


def json_safe(value):
    """Return a JSON-valid copy with pandas/numpy missing values converted to None."""
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, set):
        return [json_safe(item) for item in sorted(value, key=str)]
    if isinstance(value, np.ndarray):
        return [json_safe(item) for item in value.tolist()]
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value





def person_name(row):

    parts = [row.get("title"), row.get("ar_first_name"), row.get("ar_second_name"), row.get("ar_third_name"), row.get("ar_last_name")]

    return " ".join(p for p in parts if p)





def _bool_registered(v) -> bool:

    if isinstance(v, bool):

        return v

    if v is None:

        return False

    s = str(v).strip().lower()

    return s in ("1", "true", "yes", "y", "t")





def _to_int_or_none(value, min_value=None, max_value=None):

    if value is None:

        return None

    text = str(value).strip()

    if text in ("", "nan", "None", "null"):

        return None

    try:

        number = int(float(text))

    except (TypeError, ValueError):

        return None

    if min_value is not None and number < min_value:

        return None

    if max_value is not None and number > max_value:

        return None

    return number





def _parse_birth_date_string(value):

    if value is None:

        return None, None

    text = str(value).strip()

    if text in ("", "nan", "None", "null"):

        return None, None



    iso_match = re.match(r"^\d{4}-(\d{1,2})-(\d{1,2})", text)

    if iso_match:

        month = _to_int_or_none(iso_match.group(1), 1, 12)

        day = _to_int_or_none(iso_match.group(2), 1, 31)

        return day, month



    parts = text.split()

    if len(parts) >= 2:

        month = MONTH_EN_TO_NUM.get(parts[0].lower()[:3])

        day = _to_int_or_none(parts[1], 1, 31)

        if month and day:

            return day, month



        rev_day = _to_int_or_none(parts[0], 1, 31)

        rev_month = MONTH_EN_TO_NUM.get(parts[1].lower()[:3])

        if rev_day and rev_month:

            return rev_day, rev_month



    dash_match = re.match(r"^(\d{1,2})-([A-Za-z]+)$", text)

    if dash_match:

        day = _to_int_or_none(dash_match.group(1), 1, 31)

        month = MONTH_EN_TO_NUM.get(dash_match.group(2).lower()[:3])

        if day and month:

            return day, month



    return None, None





def normalize_person_birth_fields(person: dict) -> dict:

    p = dict(person or {})

    day = _to_int_or_none(p.get("birth_day"), 1, 31)

    month = _to_int_or_none(p.get("birth_month"), 1, 12)



    if day is None or month is None:

        parsed_day, parsed_month = _parse_birth_date_string(p.get("birth_date"))

        if day is None:

            day = parsed_day

        if month is None:

            month = parsed_month



    p["birth_day"] = day

    p["birth_month"] = month

    if "school_final_gpa" in p:

        p["school_final_gpa"] = _normalize_person_school_final_gpa(p.get("school_final_gpa"))

    p.pop("birth_date", None)

    return p





def _normalize_birth_columns_in_df(df: pd.DataFrame) -> tuple[pd.DataFrame, bool]:

    changed = False

    if df is None:

        return pd.DataFrame(), changed



    working = df.copy()

    for col in ("birth_day", "birth_month"):

        if col not in working.columns:

            working[col] = None

            changed = True



    has_birth_date_string = "birth_date" in working.columns

    if has_birth_date_string:

        changed = True



    records = working.replace({np.nan: None}).to_dict(orient="records")

    normalized = [normalize_person_birth_fields(r) for r in records]

    if not normalized:
        return working, changed

    out = pd.DataFrame(normalized)



    out["birth_day"] = out["birth_day"].apply(lambda v: _to_int_or_none(v, 1, 31))

    out["birth_month"] = out["birth_month"].apply(lambda v: _to_int_or_none(v, 1, 12))



    if has_birth_date_string and "birth_date" in out.columns:

        out = out.drop(columns=["birth_date"])



    if not changed:

        if not working.equals(out.reindex(columns=working.columns, fill_value=None)):

            changed = True



    return out, changed





def _ensure_persons_schema():

    persons = _scd_ensure_columns(store.get("persons", pd.DataFrame()))

    changed = False



    persons, migrated_birth = _normalize_birth_columns_in_df(persons)

    changed = changed or migrated_birth



    if "registered" not in persons.columns:

        persons["registered"] = True

        changed = True



    for col in (SCHOOL_STATUS_COL, NO_HIGHER_EDUCATION_COL, NOT_EMPLOYED_COL):

        if col not in persons.columns:

            persons[col] = None

            changed = True



    for col in PERSON_NAME_COLS + PERSON_ENGLISH_NAME_COLS + MOTHER_NAME_COLS + MOTHER_ENGLISH_NAME_COLS:

        if col not in persons.columns:

            persons[col] = None

            changed = True



    if "archived" in persons.columns:

        persons = persons.drop(columns=["archived"])

        changed = True

    embedded_address_cols = [col for col in PERSON_ADDRESS_PROJECTION_COLUMNS if col in persons.columns]

    if embedded_address_cols:

        persons = persons.drop(columns=embedded_address_cols)

        changed = True



    before_registered = persons["registered"].copy() if "registered" in persons.columns else None

    persons["registered"] = persons["registered"].apply(_bool_registered)

    if before_registered is not None and not before_registered.equals(persons["registered"]):

        changed = True



    current_school_person_ids = _active_current_school_person_ids(store.get(SCHOOL_SHEET, pd.DataFrame()))

    before_school_status = persons[SCHOOL_STATUS_COL].copy()

    persons[SCHOOL_STATUS_COL] = persons.apply(

        lambda row: normalize_school_status(

            row.get(SCHOOL_STATUS_COL),

            has_current_school=str(row.get("person_id") or "").strip() in current_school_person_ids,

        ),

        axis=1,

    )

    if not before_school_status.equals(persons[SCHOOL_STATUS_COL]):

        changed = True



    higher_education_person_ids = _active_person_ids_for_sheet(store.get(HIGHER_EDUCATION_SHEET, pd.DataFrame()))

    jobs_person_ids = _active_person_ids_for_sheet(store.get(JOB_SHEET, pd.DataFrame()))

    for col, person_ids in (

        (NO_HIGHER_EDUCATION_COL, higher_education_person_ids),

        (NOT_EMPLOYED_COL, jobs_person_ids),

    ):

        before_col = persons[col].copy()

        persons[col] = persons.apply(

            lambda row: False if str(row.get("person_id") or "").strip() in person_ids else _to_bool(row.get(col)),

            axis=1,

        )

        missing_mask = before_col.isna() | before_col.astype(str).str.strip().isin(("", "nan", "None", "null"))

        if missing_mask.any():

            persons.loc[missing_mask, col] = persons[missing_mask].apply(

                lambda row: str(row.get("person_id") or "").strip() not in person_ids,

                axis=1,

            )

        if not before_col.equals(persons[col]):

            changed = True



    if "school_final_gpa" in persons.columns:

        normalized_school_final_gpa = persons["school_final_gpa"].apply(_normalize_person_school_final_gpa)

        if not normalized_school_final_gpa.equals(persons["school_final_gpa"]):

            persons["school_final_gpa"] = normalized_school_final_gpa

            changed = True

    if MARITAL_STATUS_COL not in persons.columns:

        persons[MARITAL_STATUS_COL] = None

        changed = True

    if SPOUSE_IS_MEMBER_COL not in persons.columns:

        persons[SPOUSE_IS_MEMBER_COL] = None

        changed = True

    store["persons"] = persons

    return changed





def _ensure_person_spouse_schema():

    df = _scd_ensure_columns(store.get(PERSON_SPOUSE_SHEET, pd.DataFrame()))

    changed = False

    for col in PERSON_SPOUSE_COLUMNS:

        if col not in df.columns:

            df[col] = None

            changed = True

    if changed:

        store[PERSON_SPOUSE_SHEET] = df

    return changed


def get_spouse_for_person(target_store: dict, pid) -> dict | None:
    """Return the active spouse row for pid, or None."""

    df = target_store.get(PERSON_SPOUSE_SHEET, pd.DataFrame())

    if df.empty or "person_id" not in df.columns:

        return None

    df = _scd_filter_active(df)

    rows = df[df["person_id"].astype(str) == str(pid)]

    if rows.empty:

        return None

    return rows.iloc[0].to_dict()


def _update_person_marital_fields(target_store: dict, pid, marital_status, spouse_is_member, changed_by: str):
    """Update only marital_status and spouse_is_member on the active person row via SCD."""

    persons = _scd_ensure_columns(target_store.get("persons", pd.DataFrame()))

    active_mask = (persons["person_id"].astype(str) == str(pid)) & _scd_active_mask(persons)

    if not active_mask.any():

        return

    now = _scd_timestamp()

    current_row = persons[active_mask].iloc[0].to_dict()

    persons.loc[active_mask, SCD_ACTIVE_TO_COL] = now

    persons.loc[active_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

    persons.loc[active_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    new_row = {k: v for k, v in current_row.items() if k not in SCD_METADATA_COLUMNS}

    new_row[MARITAL_STATUS_COL] = marital_status

    new_row[SPOUSE_IS_MEMBER_COL] = spouse_is_member

    new_row.update(_scd_new_metadata(changed_by))

    target_store["persons"] = pd.concat([persons, pd.DataFrame([new_row])], ignore_index=True)


def set_spouse_relationship(target_store: dict, pid_a, pid_b, marital_status: str, changed_by: str):
    """Create/update a bidirectional spouse link and sync both persons' marital status."""

    now = _scd_timestamp()

    df = _scd_ensure_columns(target_store.get(PERSON_SPOUSE_SHEET, pd.DataFrame()))

    # Expire existing entries for both persons
    for pid in (str(pid_a), str(pid_b)):

        active_mask = (df["person_id"].astype(str) == pid) & _scd_active_mask(df)

        if active_mask.any():

            df.loc[active_mask, SCD_ACTIVE_TO_COL] = now

            df.loc[active_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            df.loc[active_mask, SCD_CHANGED_BY_USER_COL] = changed_by

    # Add new rows for both directions
    new_meta = {SCD_ACTIVE_FROM_COL: now, SCD_ACTIVE_TO_COL: None, SCD_CURRENTLY_ACTIVE_FLAG_COL: True, SCD_CHANGED_BY_USER_COL: changed_by}

    rows_to_add = [
        {"person_id": str(pid_a), "spouse_person_id": str(pid_b), **new_meta},
        {"person_id": str(pid_b), "spouse_person_id": str(pid_a), **new_meta},
    ]

    target_store[PERSON_SPOUSE_SHEET] = pd.concat([df, pd.DataFrame(rows_to_add)], ignore_index=True)

    # Sync marital status on both persons
    for pid in (str(pid_a), str(pid_b)):

        _update_person_marital_fields(target_store, pid, marital_status, True, changed_by)


def remove_spouse_relationship(target_store: dict, pid, changed_by: str):
    """Remove the spouse link for pid (both directions) and set both persons to أعزب."""

    df = _scd_ensure_columns(target_store.get(PERSON_SPOUSE_SHEET, pd.DataFrame()))

    if df.empty:

        return

    now = _scd_timestamp()

    pid_str = str(pid)

    # Find the current spouse before removing
    active = df[_scd_active_mask(df)]

    current_spouse_rows = active[active["person_id"].astype(str) == pid_str]

    spouse_pid = None

    if not current_spouse_rows.empty:

        spouse_pid = str(current_spouse_rows.iloc[0].get("spouse_person_id") or "").strip() or None

    # Expire entries for pid
    mask_a = (df["person_id"].astype(str) == pid_str) & _scd_active_mask(df)

    if mask_a.any():

        df.loc[mask_a, SCD_ACTIVE_TO_COL] = now

        df.loc[mask_a, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

        df.loc[mask_a, SCD_CHANGED_BY_USER_COL] = changed_by

    # Expire entries for spouse (reverse direction)
    if spouse_pid:

        mask_b = (df["person_id"].astype(str) == spouse_pid) & _scd_active_mask(df)

        if mask_b.any():

            df.loc[mask_b, SCD_ACTIVE_TO_COL] = now

            df.loc[mask_b, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            df.loc[mask_b, SCD_CHANGED_BY_USER_COL] = changed_by

    target_store[PERSON_SPOUSE_SHEET] = df

    # Reset both persons to أعزب
    _update_person_marital_fields(target_store, pid_str, MARITAL_STATUS_SINGLE, False, changed_by)

    if spouse_pid:

        _update_person_marital_fields(target_store, spouse_pid, MARITAL_STATUS_SINGLE, False, changed_by)


def _expire_spouse_link(target_store: dict, pid_a, pid_b, changed_by: str):
    """Expire bidirectional spouse link rows only, without touching person records."""

    df = _scd_ensure_columns(target_store.get(PERSON_SPOUSE_SHEET, pd.DataFrame()))

    now = _scd_timestamp()

    for pid in (str(pid_a), str(pid_b)):

        mask = (df["person_id"].astype(str) == pid) & _scd_active_mask(df)

        if mask.any():

            df.loc[mask, SCD_ACTIVE_TO_COL] = now

            df.loc[mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            df.loc[mask, SCD_CHANGED_BY_USER_COL] = changed_by

    target_store[PERSON_SPOUSE_SHEET] = df


def get_person_marital_status(target_store: dict, pid) -> str | None:
    """Return the current marital_status for pid, or None."""

    persons = _scd_filter_active(target_store.get("persons", pd.DataFrame()))

    if persons.empty:

        return None

    row = persons[persons["person_id"].astype(str) == str(pid)]

    if row.empty:

        return None

    val = _normalize_text(row.iloc[0].get(MARITAL_STATUS_COL))

    return val


def get_spouse_candidates(target_store: dict, opposite_gender: str) -> list[dict]:
    """Return list of {person_id, name} for persons in الجامعيّة/العاملة with opposite gender."""

    persons = _registered_persons_df().replace({np.nan: None})

    pyg = _scd_filter_active(target_store.get("person_youth_group", pd.DataFrame()))

    hist = _scd_filter_active(target_store.get("person_youth_group_age_history", pd.DataFrame()))

    if persons.empty or pyg.empty or hist.empty:

        return []

    # Find person_youth_group_record_ids whose current age group is eligible
    eligible_rids = set(hist[hist["age_group"].isin(SPOUSE_ELIGIBLE_AGE_GROUPS)]["person_youth_group_record_id"].astype(str))

    eligible_pids = set(pyg[pyg["person_youth_group_record_id"].astype(str).isin(eligible_rids)]["person_id"].astype(str))

    # Filter persons by gender and eligibility
    gender_col = "gender"

    if gender_col not in persons.columns:

        return []

    mask = (
        persons["person_id"].astype(str).isin(eligible_pids)
        & (persons[gender_col].astype(str).str.strip() == opposite_gender.strip())
    )

    subset = persons[mask]

    result = []

    for _, row in subset.iterrows():

        pid = str(row.get("person_id") or "").strip()

        name_parts = [
            str(row.get(col) or "").strip()
            for col in ("ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
        ]

        full_name = " ".join(p for p in name_parts if p)

        result.append({"person_id": pid, "full_name": full_name})

    return result


def _is_admin_approved(row) -> bool:

    status = str(row.get(ADMIN_APPROVAL_STATUS_COL) or "").strip().lower()

    return status in ("", "approved", "nan", "none")





def _pending_registration_ids() -> set[str]:

    """Return person_ids of persons with a non-approved admin_approval_status."""

    persons = _scd_filter_active(store.get("persons", pd.DataFrame()))

    if persons.empty or ADMIN_APPROVAL_STATUS_COL not in persons.columns:

        return set()

    mask = persons[ADMIN_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower().isin(

        [APPROVAL_STATUS_PENDING, APPROVAL_STATUS_REJECTED]

    )

    return set(persons[mask]["person_id"].astype(str).tolist())





def _registered_persons_df() -> pd.DataFrame:

    _ensure_persons_schema()

    persons = _scd_filter_active(store["persons"])

    reg = persons[persons["registered"] == True].copy()

    if ADMIN_APPROVAL_STATUS_COL in reg.columns:

        status_col = reg[ADMIN_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower()

        reg = reg[~status_col.isin([APPROVAL_STATUS_PENDING, APPROVAL_STATUS_REJECTED])]

    projected = _project_primary_addresses(reg)

    return merge_person_school_system_sectors(merge_person_titles(projected))





def _unregistered_persons_df() -> pd.DataFrame:

    _ensure_persons_schema()

    persons = _scd_filter_active(store["persons"])

    projected = _project_primary_addresses(persons[persons["registered"] == False])

    return merge_person_school_system_sectors(merge_person_titles(projected))





def unregistered_persons_view_df() -> pd.DataFrame:

    return merge_person_school_system_sectors(

        merge_person_titles(

            _scd_filter_active(unreg_store.get("persons", pd.DataFrame())),

            unreg_store.get(PERSON_TITLE_SHEET, pd.DataFrame()),

        ),

        unreg_store.get(PERSON_SCHOOL_SYSTEM_SECTOR_SHEET, pd.DataFrame()),

    )





def _next_person_id() -> int:

    persons = store.get("persons", pd.DataFrame())

    if persons.empty or "person_id" not in persons.columns:

        return 1

    ids = pd.to_numeric(persons["person_id"], errors="coerce").dropna()

    return int(ids.max()) + 1 if not ids.empty else 1





def _normalize_person_id(v):

    if isinstance(v, float):

        if v != v:  # NaN

            return None

        return int(v)

    if isinstance(v, str) and re.fullmatch(r"\d+", v.strip()):

        return int(v.strip())

    return v





def normalize_person_title_rows(rows: list[dict] | None) -> list[dict]:

    by_person_id: dict[str, dict] = {}

    for row in rows or []:

        payload = row or {}

        person_id = _normalize_person_id(payload.get("person_id"))

        title = _normalize_text(payload.get("title"))

        if person_id in (None, ""):

            continue

        key = str(person_id)

        if not title:

            by_person_id.pop(key, None)

            continue

        by_person_id[key] = {

            "person_id": person_id,

            "title": title,

        }

    return list(by_person_id.values())





def normalize_person_school_system_sector_rows(rows: list[dict] | None) -> list[dict]:

    by_person_id: dict[str, dict] = {}

    for row in rows or []:

        payload = row or {}

        person_id = _normalize_person_id(payload.get("person_id"))

        school_system_sector = _normalize_text(payload.get("school_system_sector"))

        if person_id in (None, ""):

            continue

        key = str(person_id)

        if not school_system_sector:

            by_person_id.pop(key, None)

            continue

        by_person_id[key] = {

            "person_id": person_id,

            "school_system_sector": school_system_sector,

        }

    return list(by_person_id.values())





def _normalize_person_health_condition_type(value) -> str | None:

    text = _normalize_text(value)

    if not text:

        return None



    lookup = text.strip().lower().replace("_", "-")

    if lookup in ("illness", "illnesses", "health-condition", "health-conditions", "health condition", "health conditions", "مرض", "امراض", "أمراض", "الحالة الصحية", "الحالات الصحية"):

        return "illness"

    if lookup in ("allergy", "allergies", "حساسية", "حساسيه", "حساسيات"):

        return "allergy"

    if lookup in ("surgery", "surgeries", "operation", "operations", "عملية", "عمليات", "العمليات الجراحية", "العمليات الجراجية"):

        return "surgery"

    return None





def normalize_person_health_condition_rows(rows: list[dict] | None) -> list[dict]:

    normalized_rows: list[dict] = []

    seen: set[tuple[str, str, str]] = set()

    for row in rows or []:

        payload = row or {}

        person_id = _normalize_person_id(payload.get("person_id"))

        condition_type = _normalize_person_health_condition_type(_first_present(payload, CONDITION_TYPE_COL, "type"))

        details = _normalize_text(payload.get("details"))

        if person_id in (None, "") or not condition_type or not details:

            continue

        dedupe_key = (str(person_id), condition_type, details)

        if dedupe_key in seen:

            continue

        seen.add(dedupe_key)

        normalized_rows.append({

            "person_id": person_id,

            CONDITION_TYPE_COL: condition_type,

            "type": condition_type,

            "details": details,

        })

    return normalized_rows





def normalize_person_special_note_rows(rows: list[dict] | None) -> list[dict]:

    normalized_rows: list[dict] = []

    seen: set[tuple[str, str, str]] = set()

    for row in rows or []:

        payload = row or {}

        person_id = _normalize_person_id(payload.get("person_id"))

        note_title = _normalize_text(payload.get("note_title"))

        note = _normalize_text(payload.get("note"))

        if person_id in (None, "") or not note_title or not note:

            continue

        dedupe_key = (str(person_id), note_title, note)

        if dedupe_key in seen:

            continue

        seen.add(dedupe_key)

        normalized_rows.append({

            "person_id": person_id,

            "note_title": note_title,

            "note": note,

        })

    return normalized_rows





def person_title_lookup(title_df: pd.DataFrame | None = None) -> dict[str, str]:

    df = _scd_filter_active(title_df if title_df is not None else store.get(PERSON_TITLE_SHEET, pd.DataFrame()))

    if df is None or df.empty or "person_id" not in df.columns:

        return {}



    lookup: dict[str, str] = {}

    for row in df.replace({np.nan: None}).to_dict(orient="records"):

        person_id = _normalize_person_id(row.get("person_id"))

        title = _normalize_text(row.get("title"))

        if person_id in (None, "") or not title:

            continue

        lookup[str(person_id)] = title

    return lookup





def person_school_system_sector_lookup(sector_df: pd.DataFrame | None = None) -> dict[str, str]:

    df = _scd_filter_active(sector_df if sector_df is not None else store.get(PERSON_SCHOOL_SYSTEM_SECTOR_SHEET, pd.DataFrame()))

    if df is None or df.empty or "person_id" not in df.columns:

        return {}



    lookup: dict[str, str] = {}

    for row in df.replace({np.nan: None}).to_dict(orient="records"):

        person_id = _normalize_person_id(row.get("person_id"))

        school_system_sector = _normalize_text(row.get("school_system_sector"))

        if person_id in (None, "") or not school_system_sector:

            continue

        lookup[str(person_id)] = school_system_sector

    return lookup





def merge_person_titles(persons_df: pd.DataFrame | None, title_df: pd.DataFrame | None = None) -> pd.DataFrame:

    if persons_df is None:

        return pd.DataFrame()



    persons = persons_df.copy()

    if persons.empty:

        if "title" not in persons.columns:

            persons["title"] = None

        return persons



    if "person_id" not in persons.columns:

        if "title" not in persons.columns:

            persons["title"] = None

        return persons



    lookup = person_title_lookup(title_df)

    persons["title"] = persons["person_id"].apply(

        lambda value: lookup.get(str(_normalize_person_id(value)))

    )

    return persons





def merge_person_school_system_sectors(persons_df: pd.DataFrame | None, sector_df: pd.DataFrame | None = None) -> pd.DataFrame:

    if persons_df is None:

        return pd.DataFrame()



    persons = persons_df.copy()

    if persons.empty:

        if "school_system_sector" not in persons.columns:

            persons["school_system_sector"] = None

        return persons



    if "person_id" not in persons.columns:

        if "school_system_sector" not in persons.columns:

            persons["school_system_sector"] = None

        return persons



    lookup = person_school_system_sector_lookup(sector_df)

    persons["school_system_sector"] = persons["person_id"].apply(

        lambda value: lookup.get(str(_normalize_person_id(value)))

    )

    return persons





def replace_person_title(target_store: dict[str, pd.DataFrame], person_id, title_value, changed_by: str = "system"):

    normalized_person_id = _normalize_person_id(person_id)

    person_key = str(normalized_person_id)

    title = _normalize_text(title_value)



    incoming = [{"person_id": normalized_person_id, "title": title}] if normalized_person_id not in (None, "") and title else []

    existing = _scd_active_rows(target_store.get(PERSON_TITLE_SHEET, pd.DataFrame()), "person_id", person_key)

    if _scd_rows_equal(existing, incoming, PERSON_TITLE_COLUMNS):

        return



    now = _scd_timestamp()

    new_scd = _scd_new_metadata(changed_by)



    current_df = _scd_ensure_columns(target_store.get(PERSON_TITLE_SHEET, pd.DataFrame()).copy())

    if not current_df.empty and "person_id" in current_df.columns:

        active_mask = (

            (current_df["person_id"].apply(lambda v: str(_normalize_person_id(v))) == person_key) &

            _scd_active_mask(current_df)

        )

        if active_mask.any():

            current_df.loc[active_mask, SCD_ACTIVE_TO_COL] = now

            current_df.loc[active_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            current_df.loc[active_mask, SCD_CHANGED_BY_USER_COL] = changed_by



    if incoming:

        new_row = pd.DataFrame([{**incoming[0], **new_scd}])

        current_df = pd.concat([current_df, new_row], ignore_index=True)



    target_store[PERSON_TITLE_SHEET] = current_df





def replace_person_school_system_sector(target_store: dict[str, pd.DataFrame], person_id, sector_value, changed_by: str = "system"):

    normalized_person_id = _normalize_person_id(person_id)

    person_key = str(normalized_person_id)

    sector = _normalize_text(sector_value)



    incoming = [{"person_id": normalized_person_id, "school_system_sector": sector}] if normalized_person_id not in (None, "") and sector else []

    existing = _scd_active_rows(target_store.get(PERSON_SCHOOL_SYSTEM_SECTOR_SHEET, pd.DataFrame()), "person_id", person_key)

    if _scd_rows_equal(existing, incoming, PERSON_SCHOOL_SYSTEM_SECTOR_COLUMNS):

        return



    now = _scd_timestamp()

    new_scd = _scd_new_metadata(changed_by)



    current_df = _scd_ensure_columns(target_store.get(PERSON_SCHOOL_SYSTEM_SECTOR_SHEET, pd.DataFrame()).copy())

    if not current_df.empty and "person_id" in current_df.columns:

        active_mask = (

            (current_df["person_id"].apply(lambda v: str(_normalize_person_id(v))) == person_key) &

            _scd_active_mask(current_df)

        )

        if active_mask.any():

            current_df.loc[active_mask, SCD_ACTIVE_TO_COL] = now

            current_df.loc[active_mask, SCD_CURRENTLY_ACTIVE_FLAG_COL] = False

            current_df.loc[active_mask, SCD_CHANGED_BY_USER_COL] = changed_by



    if incoming:

        new_row = pd.DataFrame([{**incoming[0], **new_scd}])

        current_df = pd.concat([current_df, new_row], ignore_index=True)



    target_store[PERSON_SCHOOL_SYSTEM_SECTOR_SHEET] = current_df





def _ensure_person_titles_schema() -> bool:

    changed = False

    persons = store.get("persons", pd.DataFrame()).copy()

    titles_df = _scd_ensure_columns(store.get(PERSON_TITLE_SHEET, pd.DataFrame()))



    active_titles_df, inactive_titles_df = _scd_split(titles_df)

    active_titles_raw_rows = active_titles_df.replace({np.nan: None}).to_dict(orient="records") if not active_titles_df.empty else []

    existing_rows = normalize_person_title_rows(active_titles_raw_rows)

    existing_ids = {str(row.get("person_id")) for row in existing_rows}



    if not persons.empty and "person_id" in persons.columns and "title" in persons.columns:

        for row in persons.replace({np.nan: None}).to_dict(orient="records"):

            person_id = _normalize_person_id(row.get("person_id"))

            title = _normalize_text(row.get("title"))

            if person_id in (None, "") or not title:

                continue

            key = str(person_id)

            if key in existing_ids:

                continue

            existing_rows.append({

                "person_id": person_id,

                "title": title,

            })

            existing_ids.add(key)

            changed = True

        persons = persons.drop(columns=["title"])

        changed = True



    normalized_rows = normalize_person_title_rows(existing_rows)

    original_normalized = normalize_person_title_rows(active_titles_raw_rows)

    if PERSON_TITLE_SHEET not in store or normalized_rows != original_normalized:

        changed = True



    norm_titles_scd = _scd_preserve_metadata(normalized_rows, active_titles_raw_rows, "person_id")

    inactive_titles_rows = inactive_titles_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_titles_df.empty else []

    store["persons"] = persons

    store[PERSON_TITLE_SHEET] = pd.DataFrame(norm_titles_scd + inactive_titles_rows)

    return changed





def _ensure_person_school_system_sector_schema() -> bool:

    changed = False

    persons = store.get("persons", pd.DataFrame()).copy()

    sector_df = _scd_ensure_columns(store.get(PERSON_SCHOOL_SYSTEM_SECTOR_SHEET, pd.DataFrame()))



    active_sector_df, inactive_sector_df = _scd_split(sector_df)

    active_sector_raw_rows = active_sector_df.replace({np.nan: None}).to_dict(orient="records") if not active_sector_df.empty else []

    existing_rows = normalize_person_school_system_sector_rows(active_sector_raw_rows)

    existing_ids = {str(row.get("person_id")) for row in existing_rows}



    if not persons.empty and "person_id" in persons.columns and "school_system_sector" in persons.columns:

        for row in persons.replace({np.nan: None}).to_dict(orient="records"):

            person_id = _normalize_person_id(row.get("person_id"))

            school_system_sector = _normalize_text(row.get("school_system_sector"))

            if person_id in (None, "") or not school_system_sector:

                continue

            key = str(person_id)

            if key in existing_ids:

                continue

            existing_rows.append({

                "person_id": person_id,

                "school_system_sector": school_system_sector,

            })

            existing_ids.add(key)

            changed = True

        persons = persons.drop(columns=["school_system_sector"])

        changed = True



    normalized_rows = normalize_person_school_system_sector_rows(existing_rows)

    original_normalized = normalize_person_school_system_sector_rows(active_sector_raw_rows)

    if PERSON_SCHOOL_SYSTEM_SECTOR_SHEET not in store or normalized_rows != original_normalized:

        changed = True



    norm_sector_scd = _scd_preserve_metadata(normalized_rows, active_sector_raw_rows, "person_id")

    inactive_sector_rows = inactive_sector_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_sector_df.empty else []

    store["persons"] = persons

    store[PERSON_SCHOOL_SYSTEM_SECTOR_SHEET] = pd.DataFrame(norm_sector_scd + inactive_sector_rows)

    return changed





def _ensure_person_health_condition_schema() -> bool:

    changed = False

    health_df = _scd_ensure_columns(store.get(PERSON_HEALTH_CONDITION_SHEET, pd.DataFrame()).copy())



    if health_df.empty:

        health_df = pd.DataFrame(columns=PERSON_HEALTH_CONDITION_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in PERSON_HEALTH_CONDITION_COLUMNS:

            if col not in health_df.columns:

                health_df[col] = None

                changed = True

        if any(col not in PERSON_HEALTH_CONDITION_COLUMNS and col not in SCD_METADATA_COLUMNS for col in health_df.columns):

            changed = True



    active_df, inactive_df = _scd_split(health_df)

    active_rows = active_df.replace({np.nan: None}).to_dict(orient="records") if not active_df.empty else []

    normalized_rows = normalize_person_health_condition_rows(active_rows)

    current_rows = [{col: row.get(col) for col in PERSON_HEALTH_CONDITION_COLUMNS} for row in active_rows]

    if normalized_rows != current_rows:

        changed = True



    default_scd = {c: (True if c == SCD_CURRENTLY_ACTIVE_FLAG_COL else None) for c in SCD_METADATA_COLUMNS}

    normalized_rows_with_scd = [

        {**row, **({c: active_rows[i].get(c) for c in SCD_METADATA_COLUMNS} if i < len(active_rows) else default_scd)}

        for i, row in enumerate(normalized_rows)

    ]

    inactive_rows = inactive_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_df.empty else []

    store[PERSON_HEALTH_CONDITION_SHEET] = pd.DataFrame(normalized_rows_with_scd + inactive_rows)

    return changed





def _ensure_person_special_note_schema() -> bool:

    changed = False

    notes_df = _scd_ensure_columns(store.get(PERSON_SPECIAL_NOTE_SHEET, pd.DataFrame()).copy())



    if notes_df.empty:

        notes_df = pd.DataFrame(columns=PERSON_SPECIAL_NOTE_COLUMNS + SCD_METADATA_COLUMNS)

        changed = True

    else:

        for col in PERSON_SPECIAL_NOTE_COLUMNS:

            if col not in notes_df.columns:

                notes_df[col] = None

                changed = True

        if any(col not in PERSON_SPECIAL_NOTE_COLUMNS and col not in SCD_METADATA_COLUMNS for col in notes_df.columns):

            changed = True



    active_df, inactive_df = _scd_split(notes_df)

    active_rows = active_df.replace({np.nan: None}).to_dict(orient="records") if not active_df.empty else []

    normalized_rows = normalize_person_special_note_rows(active_rows)

    current_rows = [{col: row.get(col) for col in PERSON_SPECIAL_NOTE_COLUMNS} for row in active_rows]

    if normalized_rows != current_rows:

        changed = True



    default_scd = {c: (True if c == SCD_CURRENTLY_ACTIVE_FLAG_COL else None) for c in SCD_METADATA_COLUMNS}

    normalized_rows_with_scd = [

        {**row, **({c: active_rows[i].get(c) for c in SCD_METADATA_COLUMNS} if i < len(active_rows) else default_scd)}

        for i, row in enumerate(normalized_rows)

    ]

    inactive_rows = inactive_df.replace({np.nan: None}).to_dict(orient="records") if not inactive_df.empty else []

    store[PERSON_SPECIAL_NOTE_SHEET] = pd.DataFrame(normalized_rows_with_scd + inactive_rows)

    return changed





def _sheet_for_registered(sheet: str) -> pd.DataFrame:

    df = _scd_filter_active(store.get(sheet, pd.DataFrame()))

    if df.empty or "person_id" not in df.columns:

        return df

    reg_ids = set(_registered_persons_df()["person_id"].astype(str))

    result = df[df["person_id"].astype(str).isin(reg_ids)]

    if sheet == PERSON_YOUTH_GROUP_SHEET and YG_APPROVAL_STATUS_COL in result.columns:

        status_col = result[YG_APPROVAL_STATUS_COL].astype(str).str.strip().str.lower()

        rejected_mask = status_col.isin([APPROVAL_STATUS_PENDING, APPROVAL_STATUS_REJECTED])

        if "archived" in result.columns:
            archived_mask = result["archived"].apply(
                lambda v: v is not None and str(v) not in ("nan", "None", "") and bool(v)
            )
            result = result[~rejected_mask | archived_mask]
        else:
            result = result[~rejected_mask]

    return result





def nationality_iso_lookup() -> dict[str, dict[str, str | None]]:

    df = store.get(NATIONALITY_ISO_SHEET, pd.DataFrame())

    if df.empty:

        return {}



    lookup: dict[str, dict[str, str | None]] = {}

    for row in df.replace({np.nan: None}).to_dict(orient="records"):

        nationality = _normalize_text(row.get("nationality_ar") or row.get("nationality"))

        if not nationality:

            continue

        lookup[_normalize_lookup_text(nationality)] = {

            "iso_alpha2": (_normalize_text(row.get("iso_alpha2")) or "").upper() or None,

        }

    return lookup





def enrich_nationality_rows(rows: list[dict] | None, source_store: dict[str, pd.DataFrame] | None = None) -> list[dict]:

    lookup = nationality_iso_lookup()

    enriched: list[dict] = []

    for row in rows or []:

        normalized = dict(row or {})

        nationality = _normalize_text(normalized.get("nationality"))

        if nationality:

            match = lookup.get(_normalize_lookup_text(nationality), {})

            normalized["iso_alpha2"] = match.get("iso_alpha2")

        else:

            normalized["iso_alpha2"] = None

        enriched.append(normalized)

    return json_safe(enriched)





def normalize_word(word):

    word = re.sub(r'[\u0617-\u061A\u064B-\u0652]', '', word)

    word = re.sub(r'\u0640', '', word)

    word = re.sub(r'[إأآا]', 'ا', word)

    word = re.sub(r'[يى]', 'ي', word)

    word = re.sub(r'ؤ', 'و', word)

    word = re.sub(r'ئ', 'ي', word)

    word = re.sub(r'ة', 'ه', word)

    word = re.sub(r'^ال', '', word.strip())

    return word.lower().strip()





def normalize_arabic(text):

    if not isinstance(text, str):

        return ""

    words = re.sub(r'\s+', ' ', text).strip().split(' ')

    return ' '.join(normalize_word(w) for w in words if w)





def avatar_initial_from_person(row):

    ar_first_name = str(row.get("ar_first_name") or "").strip()

    if ar_first_name:

        return ar_first_name[0]

    for key in ("ar_second_name", "ar_third_name", "ar_last_name"):

        value = str(row.get(key) or "").strip()

        if value:

            return value[0]

    return "؟"





def value_counts_json(series):

    vc = series.dropna().astype(str)

    vc = vc[vc != 'nan'][vc != '']

    counts = vc.value_counts()

    return [{"value": str(v), "count": int(c)} for v, c in counts.items()]





def pid_counts(df, col):

    counts = (

        df[["person_id", col]].dropna(subset=[col])

        .drop_duplicates()

        .groupby(col)["person_id"].count()

        .sort_values(ascending=False)

    )

    return [{"value": str(v), "count": int(c)} for v, c in counts.items()]





def get_photo_path(pid):

    return db.get_photo_path(pid, ALLOWED_EXTENSIONS)





def get_unreg_photo_path(uid):

    return db.get_unregistered_photo_path(uid, ALLOWED_EXTENSIONS)





def build_enriched():

    persons = _registered_persons_df().replace({np.nan: None})

    pyg = _sheet_for_registered("person_youth_group")

    pyg_history = store.get(PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame())

    resp = _sheet_for_registered("responsibilities")

    nat = _sheet_for_registered("nationality")

    sch = _sheet_for_registered("schools")

    he = _sheet_for_registered("higher_education")

    jobs = _sheet_for_registered("jobs")

    hob = _sheet_for_registered("hobbies_skills")



    def pid_to_list(df, col):

        result = {}

        for pid, grp in df.dropna(subset=[col]).groupby("person_id"):

            result[int(pid)] = grp[col].dropna().astype(str).unique().tolist()

        return result



    nat_map = pid_to_list(nat, "nationality")

    sch_map = pid_to_list(sch, SCHOOL_NAME_COL)

    youth_rows_map = build_person_youth_group_payload_rows(pyg, pyg_history)

    _pyg_hist_scd = _scd_filter_active(pyg_history) if not pyg_history.empty else pyg_history
    _age_hist_lookup: dict = {}
    if (
        not _pyg_hist_scd.empty
        and PERSON_YOUTH_GROUP_RECORD_ID_COL in _pyg_hist_scd.columns
        and "age_group" in _pyg_hist_scd.columns
    ):
        for _, _hr in _pyg_hist_scd[[PERSON_YOUTH_GROUP_RECORD_ID_COL, "age_group"]].dropna(subset=["age_group"]).iterrows():
            _r = str(_hr.get(PERSON_YOUTH_GROUP_RECORD_ID_COL) or "").strip()
            _g = _normalize_age_group(str(_hr.get("age_group") or "").strip())
            if _r and _g:
                _age_hist_lookup.setdefault(_r, set()).add(_g)

    ryg_id_map = pid_to_list(resp, YOUTH_GROUP_ID_COL)

    ryear_map = pid_to_list(resp, "jec_year")

    rcurrent_map = pid_to_list(resp, "is_current")

    rrole_map = pid_to_list(resp, "responsibility_name")

    uni_map = pid_to_list(he, HIGHER_EDUCATION_INSTITUTION_COL)

    maj_map = pid_to_list(he, "major")

    deg_map = pid_to_list(he, "degree")

    job_map = pid_to_list(jobs, "job_title")

    comp_map = pid_to_list(jobs, EMPLOYER_NAME_COL)

    hob_map = pid_to_list(hob, "hobby_skill")



    photo_ids = set()

    for name in os.listdir(PROFILE_PHOTOS_DIR):

        if "." not in name:

            continue

        pid_part, ext = name.rsplit(".", 1)

        if ext.lower() not in ALLOWED_EXTENSIONS:

            continue

        if pid_part.isdigit():

            photo_ids.add(int(pid_part))



    enriched = []

    for row in persons.to_dict(orient="records"):

        pid = int(row["person_id"]) if row["person_id"] is not None else None

        row["_avatar_initial"] = avatar_initial_from_person(row)

        row["_nationalities"] = nat_map.get(pid, [])

        row["_schools"] = sch_map.get(pid, [])

        youth_rows = get_person_youth_group_payload_rows(youth_rows_map, pid)

        active_youth_rows = [entry for entry in youth_rows if not bool(entry.get("archived"))]

        archived_youth_rows = [entry for entry in youth_rows if bool(entry.get("archived"))]

        row["_youth_memberships"] = youth_rows



        yg_ids = [entry["youth_group_id"] for entry in active_youth_rows]

        row["_youth_group_ids"] = yg_ids

        row["_youth_groups"] = [youth_group_display_label(gid) for gid in yg_ids]

        row["_age_groups"] = [entry["age_group"] for entry in active_youth_rows]
        _prev_age_set = set()
        for _entry in active_youth_rows:
            _rid = str(_entry.get(PERSON_YOUTH_GROUP_RECORD_ID_COL) or "").strip()
            _cur_ag = _normalize_age_group(str(_entry.get("age_group") or "").strip()) or ""
            for _ag in _age_hist_lookup.get(_rid, set()):
                if _ag and _ag != _cur_ag:
                    _prev_age_set.add(_ag)
        row["_prev_age_groups"] = sorted(_prev_age_set)

        row["_youth_join_years"] = [entry["youth_join_year"] for entry in active_youth_rows]

        row["_archived_youth_group_ids"] = [entry["youth_group_id"] for entry in archived_youth_rows]

        ryg_ids = ryg_id_map.get(pid, [])

        row["_responsibility_youth_group_ids"] = ryg_ids

        row["_responsibility_youth_groups"] = [youth_group_display_label(gid) for gid in ryg_ids]

        row["_responsibility_jec_years"] = ryear_map.get(pid, [])

        row["_responsibility_current_states"] = [

            "حاليًّا" if _to_bool(value) else "سابقًا"

            for value in rcurrent_map.get(pid, [])

        ]

        row["_responsibilities"] = rrole_map.get(pid, [])

        row["_universities"] = uni_map.get(pid, [])

        row["_majors"] = maj_map.get(pid, [])

        row["_degrees"] = deg_map.get(pid, [])

        row["_job_titles"] = job_map.get(pid, [])

        row["_companies"] = comp_map.get(pid, [])

        row["_hobbies"] = hob_map.get(pid, [])

        row["_photo"] = f"/api/person/{pid}/photo" if pid in photo_ids else None

        row["archived"] = bool(youth_rows) and len(active_youth_rows) == 0

        enriched.append(row)

    return enriched





def build_members_index():

    persons = _registered_persons_df().replace({np.nan: None})

    pyg = _sheet_for_registered("person_youth_group")

    pyg_history = store.get(PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame())

    resp = _sheet_for_registered("responsibilities")

    nat = _sheet_for_registered("nationality")

    sch = _sheet_for_registered("schools")

    he = _sheet_for_registered("higher_education")

    jobs = _sheet_for_registered("jobs")

    hob = _sheet_for_registered("hobbies_skills")

    health_cond = _sheet_for_registered(PERSON_HEALTH_CONDITION_SHEET)

    mob_df = _sheet_for_registered("mobile_numbers")

    mob_prim_df = _scd_filter_active(store.get("personal_mobile_number_primary", pd.DataFrame()))

    mob_fam_df = _scd_filter_active(store.get("mobile_number_family_relations", pd.DataFrame()))

    email_df = _sheet_for_registered("emails")

    email_prim_df = _scd_filter_active(store.get("personal_email_primary", pd.DataFrame()))

    email_fam_df = _scd_filter_active(store.get("email_family_relations", pd.DataFrame()))

    social_df = _sheet_for_registered("social_media")

    addr_all_df = _scd_filter_active(store.get(ADDRESS_SHEET, pd.DataFrame()))

    sch_sect_df = _sheet_for_registered("school_sections")

    sch_grade_df = _sheet_for_registered("school_grades")

    special_notes_df = _sheet_for_registered(PERSON_SPECIAL_NOTE_SHEET)



    person_columns = [

        "person_id",

        "title",

        "ar_first_name",

        "ar_second_name",

        "ar_third_name",

        "ar_last_name",

        "en_first_name",

        "en_second_name",

        "en_third_name",

        "en_last_name",

        "gender",

        "country",

        "governorate",

        "city",

        "birth_year",

        "birth_month",

        "birth_day",

        "school_system",

        "school_graduated",

        "school_system_sector",

        "mother_ar_first_name",

        "mother_ar_second_name",

        "mother_ar_last_name",

        "mother_en_first_name",

        "mother_en_second_name",

        "mother_en_last_name",

        "school_final_gpa",

    ]

    existing_person_columns = [col for col in person_columns if col in persons.columns]

    persons = persons[existing_person_columns].copy()



    def pid_to_list(df, col):

        result = {}

        if df.empty or "person_id" not in df.columns or col not in df.columns:

            return result

        for pid, grp in df.dropna(subset=[col]).groupby("person_id"):

            result[int(pid)] = grp[col].dropna().astype(str).unique().tolist()

        return result



    def _pid_to_mapped_list(df, col, label_map):

        raw = pid_to_list(df, col)

        return {pid: sorted({label_map.get(v, v) for v in vals if v}) for pid, vals in raw.items()}



    nat_map = pid_to_list(nat, "nationality")

    sch_map = pid_to_list(sch, SCHOOL_NAME_COL)

    youth_rows_map = build_person_youth_group_payload_rows(pyg, pyg_history)

    ryg_id_map = pid_to_list(resp, YOUTH_GROUP_ID_COL)

    ryear_map = pid_to_list(resp, "jec_year")

    rcurrent_map = pid_to_list(resp, "is_current")

    rrole_map = pid_to_list(resp, "responsibility_name")

    uni_map = pid_to_list(he, HIGHER_EDUCATION_INSTITUTION_COL)

    maj_map = pid_to_list(he, "major")

    deg_map = pid_to_list(he, "degree")

    job_map = pid_to_list(jobs, "job_title")

    comp_map = pid_to_list(jobs, EMPLOYER_NAME_COL)

    hob_map = pid_to_list(hob, "hobby_skill")

    htype_map = _pid_to_mapped_list(health_cond, CONDITION_TYPE_COL, HEALTH_TYPE_LABELS)

    hestate_map = _pid_to_mapped_list(he, EDUCATION_STATE_COL, EDUCATION_STATE_LABELS)

    jstate_map = _pid_to_mapped_list(jobs, EMPLOYMENT_STATE_COL, JOB_STATE_LABELS)



    uni_gpa_map         = pid_to_list(he, "final_gpa")

    health_details_map  = pid_to_list(health_cond, "details")

    note_title_map      = pid_to_list(special_notes_df, "note_title")

    note_details_map    = pid_to_list(special_notes_df, "note")



    _MOBILE_TYPE_AR  = {'personal': 'شخصي', 'work': 'عمل', 'home': 'منزل', 'family': 'عائلي'}

    _EMAIL_TYPE_AR   = {'personal': 'شخصي', 'work': 'عمل', 'family': 'عائلي'}

    _SOCIAL_PLAT_AR  = {'facebook': 'Facebook', 'instagram': 'Instagram', 'linkedin': 'LinkedIn'}

    _PRIMARY_AR      = {True: 'رئيسي', False: 'إضافي'}



    def _build_addr_enr(df):

        out = {}

        if df.empty or 'person_id' not in df.columns:

            return out

        for pid_raw, grp in df.groupby('person_id'):

            try: pk = int(pid_raw)

            except: continue

            rows = grp.replace({np.nan: None}).to_dict(orient='records')

            out[pk] = {

                'multi': len(rows) > 1,

                'loc': any(r.get('lat') is not None and r.get('lng') is not None for r in rows),

                'types': sorted({('رئيسي' if _to_bool(r.get('is_primary')) else 'إضافي') for r in rows}),

                'streets': sorted({str(r.get(STREET_ADDRESS_COL) or '').strip() for r in rows if str(r.get(STREET_ADDRESS_COL) or '').strip()}),

            }

        return out



    def _build_mob_enr(mob, prim, fam):

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

            try: pk = int(pid_raw)

            except: continue

            rows = grp.to_dict(orient='records')

            types = sorted({_MOBILE_TYPE_AR.get(str(r.get('mobile_number_type') or '').strip(), str(r.get('mobile_number_type') or '').strip()) for r in rows if str(r.get('mobile_number_type') or '').strip()})

            fam_r = sorted({str(r.get('family_relation') or '').strip() for r in rows if str(r.get('mobile_number_type') or '').strip() == 'family' and str(r.get('family_relation') or '').strip()})

            pprim = sorted({_PRIMARY_AR[bool(_to_bool(r.get('is_primary')))] for r in rows if str(r.get('mobile_number_type') or '').strip() == 'personal'})

            has_wa = any(_to_bool(r.get('whatsapp_flag')) for r in rows)

            has_pc = any(_to_bool(r.get('phone_calls_flag')) for r in rows)

            out[pk] = {'types': types, 'fam': fam_r, 'pprim': pprim, 'wa': has_wa, 'pc': has_pc}

        return out



    def _build_email_enr(em, prim, fam):

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

            try: pk = int(pid_raw)

            except: continue

            rows = grp.to_dict(orient='records')

            types = sorted({_EMAIL_TYPE_AR.get(str(r.get('email_type') or '').strip(), str(r.get('email_type') or '').strip()) for r in rows if str(r.get('email_type') or '').strip()})

            fam_r = sorted({str(r.get('family_relation') or '').strip() for r in rows if str(r.get('email_type') or '').strip() == 'family' and str(r.get('family_relation') or '').strip()})

            pprim = sorted({_PRIMARY_AR[bool(_to_bool(r.get('is_primary')))] for r in rows if str(r.get('email_type') or '').strip() == 'personal'})

            out[pk] = {'types': types, 'fam': fam_r, 'pprim': pprim}

        return out



    def _build_social_enr(df):

        if df.empty or 'person_id' not in df.columns:

            return {}

        out = {}

        for pid_raw, grp in df.dropna(subset=['platform']).groupby('person_id'):

            try: pk = int(pid_raw)

            except: continue

            rows = grp.replace({np.nan: None}).to_dict(orient='records')

            plats = sorted({_SOCIAL_PLAT_AR.get(str(r.get('platform') or '').strip(), str(r.get('platform') or '').strip()) for r in rows if str(r.get('platform') or '').strip()})

            prim  = sorted({_PRIMARY_AR[bool(_to_bool(r.get('is_primary')))] for r in rows})

            out[pk] = {'plats': plats, 'prim': prim}

        return out



    def _build_school_enr(s_df, sect_df, grade_df):

        if s_df.empty or 'person_id' not in s_df.columns:

            return {}

        rid_sects = {}

        if not sect_df.empty and SCHOOL_RECORD_ID_COL in sect_df.columns and 'section' in sect_df.columns:

            for _, r in sect_df.dropna(subset=['section']).iterrows():

                rid = str(r.get(SCHOOL_RECORD_ID_COL) or '').strip()

                sec = str(r.get('section') or '').strip()

                if rid and sec:

                    rid_sects.setdefault(rid, set()).add(sec)

        rid_grades = {}

        if not grade_df.empty and SCHOOL_RECORD_ID_COL in grade_df.columns and 'grade' in grade_df.columns:

            for _, r in grade_df.dropna(subset=['grade']).iterrows():

                rid = str(r.get(SCHOOL_RECORD_ID_COL) or '').strip()

                g = str(r.get('grade') or '').strip()

                if rid and g:

                    rid_grades.setdefault(rid, set()).add(g)

        out = {}

        for pid_raw, grp in s_df.groupby('person_id'):

            try: pk = int(pid_raw)

            except: continue

            rows = grp.replace({np.nan: None}).to_dict(orient='records')

            statuses = sorted({('حاليًّا' if _to_bool(r.get('is_current')) else 'سابقًا') for r in rows})

            sects, grades = set(), set()

            for r in rows:

                rid = str(r.get(SCHOOL_RECORD_ID_COL) or '').strip()

                sname = str(r.get(SCHOOL_NAME_COL) or '').strip()

                for sec in rid_sects.get(rid, set()):

                    sects.add(f'{sname} - {sec}' if sname else sec)

                if _to_bool(r.get('is_current')):

                    grades.update(rid_grades.get(rid, set()))

            prev_grades = set()

            for r in rows:

                if not _to_bool(r.get('is_current')):

                    rid = str(r.get(SCHOOL_RECORD_ID_COL) or '').strip()

                    prev_grades.update(rid_grades.get(rid, set()))

            out[pk] = {'statuses': statuses, 'sects': sorted(sects), 'grades': sorted(grades), 'prev_grades': sorted(prev_grades)}

        return out



    addr_enr   = _build_addr_enr(addr_all_df)

    mob_enr    = _build_mob_enr(mob_df, mob_prim_df, mob_fam_df)

    email_enr  = _build_email_enr(email_df, email_prim_df, email_fam_df)

    social_enr = _build_social_enr(social_df)

    school_enr = _build_school_enr(sch, sch_sect_df, sch_grade_df)

    # Previous age groups: direct lookup from raw history sheet keyed by record_id
    _pyg_hist_scd = _scd_filter_active(pyg_history) if not pyg_history.empty else pyg_history
    _age_hist_lookup: dict = {}
    if (not _pyg_hist_scd.empty
            and PERSON_YOUTH_GROUP_RECORD_ID_COL in _pyg_hist_scd.columns
            and "age_group" in _pyg_hist_scd.columns):
        for _, _hr in _pyg_hist_scd[[PERSON_YOUTH_GROUP_RECORD_ID_COL, "age_group"]].dropna(subset=["age_group"]).iterrows():
            _r = str(_hr.get(PERSON_YOUTH_GROUP_RECORD_ID_COL) or "").strip()
            _g = _normalize_age_group(str(_hr.get("age_group") or "").strip())
            if _r and _g:
                _age_hist_lookup.setdefault(_r, set()).add(_g)

    # Org tree / GS tree lookup (late import avoids circular dependency)
    from core.routes_org_tree import build_person_org_tree_index as _build_org_tree_index
    _org_tree_map, _gs_tree_map = _build_org_tree_index()

    photo_ids = set()

    for name in os.listdir(PROFILE_PHOTOS_DIR):

        if "." not in name:

            continue

        pid_part, ext = name.rsplit(".", 1)

        if ext.lower() not in ALLOWED_EXTENSIONS:

            continue

        if pid_part.isdigit():

            photo_ids.add(int(pid_part))



    enriched = []

    for row in persons.to_dict(orient="records"):

        pid = int(row["person_id"]) if row.get("person_id") is not None else None

        youth_rows = get_person_youth_group_payload_rows(youth_rows_map, pid)

        active_youth_rows = [entry for entry in youth_rows if not bool(entry.get("archived"))]

        archived_youth_rows = [entry for entry in youth_rows if bool(entry.get("archived"))]

        yg_ids = [entry["youth_group_id"] for entry in active_youth_rows]

        ryg_ids = ryg_id_map.get(pid, [])

        archived_yg_ids = [entry["youth_group_id"] for entry in archived_youth_rows]



        row["_nationalities"] = nat_map.get(pid, [])

        row["_schools"] = sch_map.get(pid, [])

        row["_youth_group_ids"] = yg_ids

        row["_youth_groups"] = [youth_group_display_label(gid) for gid in yg_ids]

        row["_age_groups"] = [entry["age_group"] for entry in active_youth_rows]
        _prev_age_set = set()
        for _entry in active_youth_rows:
            _rid = str(_entry.get(PERSON_YOUTH_GROUP_RECORD_ID_COL) or "").strip()
            _cur_ag = _normalize_age_group(str(_entry.get("age_group") or "").strip()) or ""
            for _ag in _age_hist_lookup.get(_rid, set()):
                if _ag and _ag != _cur_ag:
                    _prev_age_set.add(_ag)
        row["_prev_age_groups"] = sorted(_prev_age_set)

        row["_youth_join_years"] = [entry["youth_join_year"] for entry in active_youth_rows]

        row["_archived_youth_group_ids"] = archived_yg_ids

        row["_archived_youth_groups"] = [youth_group_display_label(gid) for gid in archived_yg_ids]

        row["_archived_age_groups"] = [entry["age_group"] for entry in archived_youth_rows]

        row["_archived_youth_join_years"] = [entry["youth_join_year"] for entry in archived_youth_rows]

        statuses_yic = []
        if active_youth_rows: statuses_yic.append("عضو حالي")
        if archived_youth_rows: statuses_yic.append("عضو سابق")
        row["_youth_is_current"] = statuses_yic

        _ot = _org_tree_map.get(str(pid), {})
        row["_org_tree_groups"] = _ot.get("groups", [])
        row["_org_tree_jec_years"] = _ot.get("jec_years", [])
        row["_org_tree_roles"] = _ot.get("roles", [])
        _gs = _gs_tree_map.get(str(pid), {})
        row["_gs_tree_jec_years"] = _gs.get("jec_years", [])
        row["_gs_tree_roles"] = _gs.get("roles", [])

        row["_responsibility_youth_groups"] = [youth_group_display_label(gid) for gid in ryg_ids]

        row["_responsibility_jec_years"] = ryear_map.get(pid, [])

        row["_responsibility_current_states"] = [

            "حاليًّا" if _to_bool(value) else "سابقًا"

            for value in rcurrent_map.get(pid, [])

        ]

        row["_responsibilities"] = rrole_map.get(pid, [])

        row["_universities"] = uni_map.get(pid, [])

        row["_majors"] = maj_map.get(pid, [])

        row["_degrees"] = deg_map.get(pid, [])

        row["_job_titles"] = job_map.get(pid, [])

        row["_companies"] = comp_map.get(pid, [])

        row["_hobbies"] = hob_map.get(pid, [])

        row["_health_types"] = htype_map.get(pid, [])

        row["_higher_ed_states"] = hestate_map.get(pid, [])

        row["_job_states"] = jstate_map.get(pid, [])

        ae = addr_enr.get(pid, {})

        row["_has_multiple_addresses"] = (["متعدد"] if ae.get("multi") else ["فردي"]) if pid in addr_enr else []

        row["_has_location"] = (["نعم"] if ae.get("loc") else ["لا"]) if pid in addr_enr else []

        row["_address_types"] = ae.get("types", [])

        row["_street_addresses"] = ae.get("streets", [])

        me = mob_enr.get(pid, {})

        row["_mobile_types"] = me.get("types", [])

        row["_mobile_family_relations"] = me.get("fam", [])

        row["_mobile_personal_primary"] = me.get("pprim", [])

        row["_has_whatsapp"] = (["نعم"] if me.get("wa") else ["لا"]) if pid in mob_enr else []

        ee = email_enr.get(pid, {})

        row["_email_types"] = ee.get("types", [])

        row["_email_family_relations"] = ee.get("fam", [])

        row["_email_personal_primary"] = ee.get("pprim", [])

        se = social_enr.get(pid, {})

        row["_social_platforms"] = se.get("plats", [])

        row["_social_primary"] = se.get("prim", [])

        sce = school_enr.get(pid, {})

        row["_school_statuses"] = sce.get("statuses", [])

        row["_school_sections"] = sce.get("sects", [])

        row["_school_current_grades"] = sce.get("grades", [])

        row["_school_previous_grades"] = sce.get("prev_grades", [])

        row["_has_phone_calls"] = (["نعم"] if me.get("pc") else ["لا"]) if pid in mob_enr else []

        row["_uni_gpas"] = uni_gpa_map.get(pid, [])

        row["_health_details"] = health_details_map.get(pid, [])

        row["_special_note_titles"] = note_title_map.get(pid, [])

        row["_special_note_details"] = note_details_map.get(pid, [])

        row["_photo"] = f"/api/person/{pid}/photo" if pid in photo_ids else None

        row["archived"] = bool(youth_rows) and len(active_youth_rows) == 0

        enriched.append(row)

    return enriched





def _sync_unreg_view_from_store():

    global unreg_store

    _ensure_persons_schema()

    persons = store.get("persons", pd.DataFrame()).copy()

    if persons.empty:

        unreg_store = {s: pd.DataFrame() for s in UNREG_SHEETS}

        unreg_store["persons"] = pd.DataFrame(columns=UNREG_PERSONS_COLS)

        return



    persons["registered"] = persons["registered"].apply(_bool_registered)

    persons = _scd_filter_active(persons)

    up = persons[persons["registered"] == False].copy()

    if "person_id" not in up.columns:

        up["person_id"] = None

    up["person_id"] = up["person_id"].apply(_normalize_person_id)

    for col in UNREG_PERSONS_COLS:

        if col not in up.columns:

            up[col] = None



    unreg_store = {"persons": up}

    uids = set(up["person_id"].astype(str).tolist())

    for s in UNREG_SHEETS:

        if s == "persons":

            continue

        df = _scd_filter_active(store.get(s, pd.DataFrame()).copy())

        if s == MOBILE_NUMBER_FAMILY_RELATION_SHEET:

            mobile_numbers_df = unreg_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame())

            if df.empty or MOBILE_NUMBER_RECORD_ID_COL not in df.columns or mobile_numbers_df.empty or MOBILE_NUMBER_RECORD_ID_COL not in mobile_numbers_df.columns:

                unreg_store[s] = pd.DataFrame(columns=MOBILE_NUMBER_FAMILY_RELATION_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in mobile_numbers_df[MOBILE_NUMBER_RECORD_ID_COL].tolist():

                record_id = _normalize_mobile_number_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if s == PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET:

            mobile_numbers_df = unreg_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame())

            if df.empty or MOBILE_NUMBER_RECORD_ID_COL not in df.columns or mobile_numbers_df.empty or MOBILE_NUMBER_RECORD_ID_COL not in mobile_numbers_df.columns:

                unreg_store[s] = pd.DataFrame(columns=PERSONAL_MOBILE_NUMBER_PRIMARY_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in mobile_numbers_df[MOBILE_NUMBER_RECORD_ID_COL].tolist():

                record_id = _normalize_mobile_number_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if s == MOBILE_NUMBER_LINKED_JOB_SHEET:

            mobile_numbers_df = unreg_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame())

            if df.empty or MOBILE_NUMBER_RECORD_ID_COL not in df.columns or mobile_numbers_df.empty or MOBILE_NUMBER_RECORD_ID_COL not in mobile_numbers_df.columns:

                unreg_store[s] = pd.DataFrame(columns=MOBILE_NUMBER_LINKED_JOB_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in mobile_numbers_df[MOBILE_NUMBER_RECORD_ID_COL].tolist():

                record_id = _normalize_mobile_number_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if s == EMAIL_FAMILY_RELATION_SHEET:

            emails_df = unreg_store.get(EMAIL_SHEET, pd.DataFrame())

            if df.empty or EMAIL_RECORD_ID_COL not in df.columns or emails_df.empty or EMAIL_RECORD_ID_COL not in emails_df.columns:

                unreg_store[s] = pd.DataFrame(columns=EMAIL_FAMILY_RELATION_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in emails_df[EMAIL_RECORD_ID_COL].tolist():

                record_id = _normalize_email_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[EMAIL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if s == PERSONAL_EMAIL_PRIMARY_SHEET:

            emails_df = unreg_store.get(EMAIL_SHEET, pd.DataFrame())

            if df.empty or EMAIL_RECORD_ID_COL not in df.columns or emails_df.empty or EMAIL_RECORD_ID_COL not in emails_df.columns:

                unreg_store[s] = pd.DataFrame(columns=PERSONAL_EMAIL_PRIMARY_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in emails_df[EMAIL_RECORD_ID_COL].tolist():

                record_id = _normalize_email_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[EMAIL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if s == EMAIL_LINKED_JOB_SHEET:

            emails_df = unreg_store.get(EMAIL_SHEET, pd.DataFrame())

            if df.empty or EMAIL_RECORD_ID_COL not in df.columns or emails_df.empty or EMAIL_RECORD_ID_COL not in emails_df.columns:

                unreg_store[s] = pd.DataFrame(columns=EMAIL_LINKED_JOB_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in emails_df[EMAIL_RECORD_ID_COL].tolist():

                record_id = _normalize_email_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[EMAIL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if s == PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET:

            memberships_df = unreg_store.get(PERSON_YOUTH_GROUP_SHEET, pd.DataFrame())

            if df.empty or PERSON_YOUTH_GROUP_RECORD_ID_COL not in df.columns or memberships_df.empty or PERSON_YOUTH_GROUP_RECORD_ID_COL not in memberships_df.columns:

                unreg_store[s] = pd.DataFrame(columns=PERSON_YOUTH_GROUP_AGE_HISTORY_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in memberships_df[PERSON_YOUTH_GROUP_RECORD_ID_COL].tolist():

                record_id = _normalize_person_youth_group_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if s == SCHOOL_SECTION_SHEET:

            schools_df = unreg_store.get(SCHOOL_SHEET, pd.DataFrame())

            if df.empty or SCHOOL_RECORD_ID_COL not in df.columns or schools_df.empty or SCHOOL_RECORD_ID_COL not in schools_df.columns:

                unreg_store[s] = pd.DataFrame(columns=SCHOOL_SECTION_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in schools_df[SCHOOL_RECORD_ID_COL].tolist():

                record_id = _normalize_school_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[SCHOOL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if s == SCHOOL_GRADE_SHEET:

            schools_df = unreg_store.get(SCHOOL_SHEET, pd.DataFrame())

            if df.empty or SCHOOL_RECORD_ID_COL not in df.columns or schools_df.empty or SCHOOL_RECORD_ID_COL not in schools_df.columns:

                unreg_store[s] = pd.DataFrame(columns=SCHOOL_GRADE_COLUMNS)

                continue

            unreg_record_ids = set()

            for raw_record_id in schools_df[SCHOOL_RECORD_ID_COL].tolist():

                record_id = _normalize_school_record_id(raw_record_id)

                if record_id:

                    unreg_record_ids.add(record_id)

            unreg_store[s] = df[df[SCHOOL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)].copy()

            continue

        if df.empty or "person_id" not in df.columns:

            unreg_store[s] = pd.DataFrame()

            continue

        unreg_store[s] = df[df["person_id"].astype(str).isin(uids)].copy()





def _load_unreg_store():

    _ensure_persons_schema()

    _sync_unreg_view_from_store()





def _save_unreg_store():

    _ensure_persons_schema()



    persons_all = store.get("persons", pd.DataFrame()).copy()

    if "registered" not in persons_all.columns:

        persons_all["registered"] = True

    persons_all["registered"] = persons_all["registered"].apply(_bool_registered)



    unreg_persons = unreg_store.get("persons", pd.DataFrame()).copy()

    if unreg_persons.empty:

        unreg_persons = pd.DataFrame(columns=UNREG_PERSONS_COLS)

    for col in UNREG_PERSONS_COLS:

        if col not in unreg_persons.columns:

            unreg_persons[col] = None

    if "person_id" in unreg_persons.columns:

        unreg_persons["person_id"] = unreg_persons["person_id"].apply(_normalize_person_id)

    unreg_persons["registered"] = False



    reg_persons = persons_all[persons_all["registered"] == True].copy()

    for col in unreg_persons.columns:

        if col not in reg_persons.columns:

            reg_persons[col] = None

    for col in reg_persons.columns:

        if col not in unreg_persons.columns:

            unreg_persons[col] = None

    store["persons"] = pd.concat([reg_persons, unreg_persons[reg_persons.columns]], ignore_index=True)



    unreg_ids = set(unreg_persons["person_id"].astype(str).tolist())

    for s in UNREG_SHEETS:

        if s == "persons":

            continue

        base = store.get(s, pd.DataFrame())

        if s == MOBILE_NUMBER_FAMILY_RELATION_SHEET:

            unreg_mobile_numbers = unreg_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_mobile_numbers.empty and MOBILE_NUMBER_RECORD_ID_COL in unreg_mobile_numbers.columns:

                for raw_record_id in unreg_mobile_numbers[MOBILE_NUMBER_RECORD_ID_COL].tolist():

                    record_id = _normalize_mobile_number_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and MOBILE_NUMBER_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif s == PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET:

            unreg_mobile_numbers = unreg_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_mobile_numbers.empty and MOBILE_NUMBER_RECORD_ID_COL in unreg_mobile_numbers.columns:

                for raw_record_id in unreg_mobile_numbers[MOBILE_NUMBER_RECORD_ID_COL].tolist():

                    record_id = _normalize_mobile_number_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and MOBILE_NUMBER_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif s == MOBILE_NUMBER_LINKED_JOB_SHEET:

            unreg_mobile_numbers = unreg_store.get(MOBILE_NUMBER_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_mobile_numbers.empty and MOBILE_NUMBER_RECORD_ID_COL in unreg_mobile_numbers.columns:

                for raw_record_id in unreg_mobile_numbers[MOBILE_NUMBER_RECORD_ID_COL].tolist():

                    record_id = _normalize_mobile_number_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and MOBILE_NUMBER_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[MOBILE_NUMBER_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif s == EMAIL_FAMILY_RELATION_SHEET:

            unreg_emails = unreg_store.get(EMAIL_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_emails.empty and EMAIL_RECORD_ID_COL in unreg_emails.columns:

                for raw_record_id in unreg_emails[EMAIL_RECORD_ID_COL].tolist():

                    record_id = _normalize_email_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and EMAIL_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[EMAIL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif s == PERSONAL_EMAIL_PRIMARY_SHEET:

            unreg_emails = unreg_store.get(EMAIL_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_emails.empty and EMAIL_RECORD_ID_COL in unreg_emails.columns:

                for raw_record_id in unreg_emails[EMAIL_RECORD_ID_COL].tolist():

                    record_id = _normalize_email_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and EMAIL_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[EMAIL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif s == EMAIL_LINKED_JOB_SHEET:

            unreg_emails = unreg_store.get(EMAIL_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_emails.empty and EMAIL_RECORD_ID_COL in unreg_emails.columns:

                for raw_record_id in unreg_emails[EMAIL_RECORD_ID_COL].tolist():

                    record_id = _normalize_email_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and EMAIL_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[EMAIL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif s == PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET:

            unreg_memberships = unreg_store.get(PERSON_YOUTH_GROUP_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_memberships.empty and PERSON_YOUTH_GROUP_RECORD_ID_COL in unreg_memberships.columns:

                for raw_record_id in unreg_memberships[PERSON_YOUTH_GROUP_RECORD_ID_COL].tolist():

                    record_id = _normalize_person_youth_group_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and PERSON_YOUTH_GROUP_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif s == SCHOOL_SECTION_SHEET:

            unreg_schools = unreg_store.get(SCHOOL_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_schools.empty and SCHOOL_RECORD_ID_COL in unreg_schools.columns:

                for raw_record_id in unreg_schools[SCHOOL_RECORD_ID_COL].tolist():

                    record_id = _normalize_school_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and SCHOOL_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[SCHOOL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif s == SCHOOL_GRADE_SHEET:

            unreg_schools = unreg_store.get(SCHOOL_SHEET, pd.DataFrame()).copy()

            unreg_record_ids = set()

            if not unreg_schools.empty and SCHOOL_RECORD_ID_COL in unreg_schools.columns:

                for raw_record_id in unreg_schools[SCHOOL_RECORD_ID_COL].tolist():

                    record_id = _normalize_school_record_id(raw_record_id)

                    if record_id:

                        unreg_record_ids.add(record_id)

            if not base.empty and SCHOOL_RECORD_ID_COL in base.columns and unreg_record_ids:

                base = base[~base[SCHOOL_RECORD_ID_COL].astype(str).isin(unreg_record_ids)]

        elif not base.empty and "person_id" in base.columns:

            base = base[~base["person_id"].astype(str).isin(unreg_ids)]

        incoming = unreg_store.get(s, pd.DataFrame()).copy()

        if not incoming.empty:

            if s not in (MOBILE_NUMBER_FAMILY_RELATION_SHEET, PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET, MOBILE_NUMBER_LINKED_JOB_SHEET, EMAIL_FAMILY_RELATION_SHEET, PERSONAL_EMAIL_PRIMARY_SHEET, EMAIL_LINKED_JOB_SHEET, PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, SCHOOL_SECTION_SHEET, SCHOOL_GRADE_SHEET) and "person_id" not in incoming.columns:

                incoming["person_id"] = None

            if s not in (MOBILE_NUMBER_FAMILY_RELATION_SHEET, PERSONAL_MOBILE_NUMBER_PRIMARY_SHEET, MOBILE_NUMBER_LINKED_JOB_SHEET, EMAIL_FAMILY_RELATION_SHEET, PERSONAL_EMAIL_PRIMARY_SHEET, EMAIL_LINKED_JOB_SHEET, PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, SCHOOL_SECTION_SHEET, SCHOOL_GRADE_SHEET):

                incoming["person_id"] = incoming["person_id"].apply(_normalize_person_id)

            base = pd.concat([base, incoming], ignore_index=True)

        store[s] = base



    save()

    _sync_unreg_view_from_store()





def init_state():

    load()

    schema_changed = _ensure_persons_schema()

    person_title_schema_changed = _ensure_person_titles_schema()

    person_school_system_sector_schema_changed = _ensure_person_school_system_sector_schema()

    person_health_condition_schema_changed = _ensure_person_health_condition_schema()

    person_special_note_schema_changed = _ensure_person_special_note_schema()

    person_youth_group_schema_changed = _ensure_person_youth_group_schema()

    group_schema_changed = _ensure_youth_group_schema()

    group_special_logo_schema_changed = _ensure_youth_group_special_logo_schema()

    nationality_schema_changed = _ensure_nationality_schema()

    schools_schema_changed = _ensure_schools_schema()

    mobile_schema_changed = _ensure_mobile_numbers_schema()

    email_schema_changed = _ensure_emails_schema()

    social_media_schema_changed = _ensure_social_media_schema()

    higher_education_schema_changed = _ensure_higher_education_schema()

    jobs_schema_changed = _ensure_jobs_schema()

    responsibility_schema_changed = _ensure_responsibility_schema()

    address_schema_changed = _ensure_addresses_schema()

    person_spouse_schema_changed = _ensure_person_spouse_schema()

    _coerce_person_id_columns(store)

    if schema_changed or person_title_schema_changed or person_school_system_sector_schema_changed or person_health_condition_schema_changed or person_special_note_schema_changed or person_youth_group_schema_changed or group_schema_changed or group_special_logo_schema_changed or nationality_schema_changed or schools_schema_changed or mobile_schema_changed or email_schema_changed or social_media_schema_changed or higher_education_schema_changed or jobs_schema_changed or responsibility_schema_changed or address_schema_changed or person_spouse_schema_changed:

        save()

    _load_unreg_store()

