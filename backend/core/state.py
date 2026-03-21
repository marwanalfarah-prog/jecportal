import os
import re
import threading

import numpy as np
import pandas as pd

from core.database import Database


db = Database(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app.py")))

EXCEL_PATH = db.excel_path
PHOTOS_ROOT_DIR = db.photos_root_dir
PROFILE_PHOTOS_DIR = db.profile_pictures_dir
os.makedirs(PROFILE_PHOTOS_DIR, exist_ok=True)

SHEETS = [
    "persons", "nationality", "mobile_numbers", "schools",
    "higher_education", "jobs", "timestamps", "responsibilities",
    "person_youth_group", "hobbies_skills", "addresses", "youth_groups",
]

UNREG_SHEETS = [
    "persons", "nationality", "mobile_numbers", "schools",
    "higher_education", "jobs", "responsibilities",
    "person_youth_group", "hobbies_skills", "addresses",
]

ADDRESS_SHEET = "addresses"
ADDRESS_COLUMNS = ["person_id", "country", "governorate", "city", "address", "is_primary"]
DEFAULT_COUNTRY = "الأردن"

UNREG_PERSONS_COLS = [
    "person_id", "title",
    "first_name", "second_name", "third_name", "last_name",
    "english_first_name", "english_second_name", "english_third_name", "english_last_name",
    "gender", "birth_year", "birth_day", "birth_month",
    "registered",
]

PERSON_NAME_COLS = [
    "first_name", "second_name", "third_name", "last_name",
]

PERSON_ENGLISH_NAME_COLS = [
    "english_first_name", "english_second_name", "english_third_name", "english_last_name",
]

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}

lock = threading.Lock()
store: dict[str, pd.DataFrame] = {}

unreg_lock = threading.Lock()
unreg_store: dict[str, pd.DataFrame] = {}

_data_version = 0
_enriched_cache = None
_enriched_cache_version = -1

YOUTH_GROUP_ID_COL = "youth_group_id"
YOUTH_GROUP_NAME_COL = "youth_group_name"
YOUTH_GROUP_PATRON_COL = "youth_group_patron"
YOUTH_GROUP_SHORT_NAME_COL = "youth_group_short_name"
LEGACY_YOUTH_GROUP_PATRON_COL = "شفيع الشبيبة"
LEGACY_YOUTH_GROUP_SHORT_NAME_COL = "منطقة|اسم مختصر"
YOUTH_GROUP_PARISH_ID_COL = "parish_id"
YOUTH_GROUP_USE_PARISH_LOGO_COL = "use_parish_logo"
YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL = "inherit_parish_social_media"
YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL = "special_logo_active"
YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL = "special_logo_occasion"
YOUTH_GROUP_SHEET = "youth_groups"

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


def invalidate_enriched_cache():
    global _data_version, _enriched_cache, _enriched_cache_version
    _data_version += 1
    _enriched_cache = None
    _enriched_cache_version = -1


def cache_state():
    return _enriched_cache, _enriched_cache_version, _data_version


def set_enriched_cache(payload, version):
    global _enriched_cache, _enriched_cache_version
    _enriched_cache = payload
    _enriched_cache_version = version


def load():
    global store
    store = db.load_excel_sheets(SHEETS)
    print(f"✅ Loaded {len(store)} sheets from Excel.")


def safe_youth_group_key(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"[^\w\u0600-\u06FF]", "_", str(value).strip())


def _normalize_text(v) -> str | None:
    if v is None:
        return None
    text = str(v).strip()
    if text in ("", "nan", "None", "null"):
        return None
    return text


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


def normalize_address_rows(rows) -> list[dict]:
    normalized = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        person_id = _normalize_person_id(row.get("person_id"))
        governorate = _normalize_text(row.get("governorate"))
        city = _normalize_text(row.get("city"))
        address = _normalize_text(row.get("address"))
        country = _normalize_country(row.get("country"))
        is_primary = _to_bool(row.get("is_primary"))
        if person_id in (None, "") and not (governorate or city or address):
            continue
        if not governorate and not city and not address:
            continue
        normalized.append({
            "person_id": person_id,
            "country": country,
            "governorate": governorate,
            "city": city,
            "address": address,
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


def address_rows_from_legacy_person_payload(person: dict | None) -> list[dict]:
    payload = person or {}
    governorate = _normalize_text(payload.get("governorate"))
    city = _normalize_text(payload.get("city"))
    address = _normalize_text(payload.get("address"))
    country = _normalize_country(payload.get("country"))
    if not governorate and not city and not address:
        return []
    return [{
        "country": country,
        "governorate": governorate,
        "city": city,
        "address": address,
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
    for col in ("country", "governorate", "city", "address"):
        if col not in working.columns:
            working[col] = None

    if working.empty or "person_id" not in working.columns:
        return working

    source_addresses = addresses_df if addresses_df is not None else store.get(ADDRESS_SHEET, pd.DataFrame())
    primary_rows = _primary_address_rows(source_addresses)
    if primary_rows.empty or "person_id" not in primary_rows.columns:
        return working

    indexed = working.reset_index().rename(columns={"index": "_store_index"})
    merged = indexed.merge(
        primary_rows[["person_id", "country", "governorate", "city", "address"]],
        on="person_id",
        how="left",
        suffixes=("", "_primary"),
    )
    for col in ("country", "governorate", "city", "address"):
        primary_col = f"{col}_primary"
        merged[col] = merged[primary_col].where(merged[primary_col].notna(), merged[col])
        merged = merged.drop(columns=[primary_col])
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

    if YOUTH_GROUP_PATRON_COL not in working.columns and LEGACY_YOUTH_GROUP_PATRON_COL in working.columns:
        working[YOUTH_GROUP_PATRON_COL] = working[LEGACY_YOUTH_GROUP_PATRON_COL]
        working = working.drop(columns=[LEGACY_YOUTH_GROUP_PATRON_COL])
        changed = True

    if YOUTH_GROUP_SHORT_NAME_COL not in working.columns and LEGACY_YOUTH_GROUP_SHORT_NAME_COL in working.columns:
        working[YOUTH_GROUP_SHORT_NAME_COL] = working[LEGACY_YOUTH_GROUP_SHORT_NAME_COL]
        working = working.drop(columns=[LEGACY_YOUTH_GROUP_SHORT_NAME_COL])
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

    df = store.get(YOUTH_GROUP_SHEET, pd.DataFrame())
    df, changed = _normalize_youth_group_column_names(df)
    if changed:
        store[YOUTH_GROUP_SHEET] = df
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
        legacy_name = _normalize_text(row.get(YOUTH_GROUP_NAME_COL))
        patron = _normalize_text(row.get(YOUTH_GROUP_PATRON_COL))
        short_name = _normalize_text(row.get(YOUTH_GROUP_SHORT_NAME_COL))

        if short_name:
            parsed_patron, parsed_short = _split_youth_group_name(short_name)
            if parsed_short:
                if not patron and parsed_patron:
                    patron = parsed_patron
                short_name = parsed_short
        if not short_name and legacy_name:
            parsed_patron, parsed_short = _split_youth_group_name(legacy_name)
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
        add_lookup(legacy_name, gid)


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

    yg_df = store.get(YOUTH_GROUP_SHEET, pd.DataFrame()).copy()
    yg_df, _ = _normalize_youth_group_column_names(yg_df)
    if yg_df.empty:
        yg_df = pd.DataFrame(columns=[
            YOUTH_GROUP_ID_COL,
            YOUTH_GROUP_PATRON_COL,
            YOUTH_GROUP_SHORT_NAME_COL,
            YOUTH_GROUP_PARISH_ID_COL,
            YOUTH_GROUP_USE_PARISH_LOGO_COL,
            YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL,
            YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL,
            YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL,
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
    if YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL not in yg_df.columns:
        yg_df[YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL] = False
    if YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL not in yg_df.columns:
        yg_df[YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL] = None
    if "safe_key" in yg_df.columns:
        yg_df = yg_df.drop(columns=["safe_key"])
    if YOUTH_GROUP_NAME_COL in yg_df.columns:
        yg_df = yg_df.drop(columns=[YOUTH_GROUP_NAME_COL])

    yg_df = pd.concat([
        yg_df,
        pd.DataFrame([{
            YOUTH_GROUP_ID_COL: next_gid,
            YOUTH_GROUP_PATRON_COL: patron,
            YOUTH_GROUP_SHORT_NAME_COL: short_name,
            YOUTH_GROUP_PARISH_ID_COL: None,
            YOUTH_GROUP_USE_PARISH_LOGO_COL: False,
            YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL: False,
            YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL: False,
            YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL: None,
        }]),
    ], ignore_index=True)
    store[YOUTH_GROUP_SHEET] = yg_df
    _refresh_youth_group_indexes()
    return next_gid


def _ensure_youth_group_catalog() -> bool:
    changed = False
    yg_df = store.get(YOUTH_GROUP_SHEET, pd.DataFrame()).copy()
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
            YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL,
            YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL,
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
        if YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL not in yg_df.columns:
            yg_df[YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL] = False
            changed = True
        if YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL not in yg_df.columns:
            yg_df[YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL] = None
            changed = True
        if "safe_key" in yg_df.columns:
            yg_df = yg_df.drop(columns=["safe_key"])
            changed = True

    if YOUTH_GROUP_NAME_COL in yg_df.columns:
        changed = True

    normalized_rows = []
    for row in yg_df.replace({np.nan: None}).to_dict(orient="records"):
        gid = _normalize_text(row.get(YOUTH_GROUP_ID_COL))
        legacy_name = _normalize_text(row.get(YOUTH_GROUP_NAME_COL))
        patron = _normalize_text(row.get(YOUTH_GROUP_PATRON_COL))
        short_name = _normalize_text(row.get(YOUTH_GROUP_SHORT_NAME_COL))
        parish_id = _normalize_text(row.get(YOUTH_GROUP_PARISH_ID_COL))
        use_parish_logo = _to_bool(row.get(YOUTH_GROUP_USE_PARISH_LOGO_COL))
        inherit_parish_social_media = _to_bool(row.get(YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL))
        special_logo_active = _to_bool(row.get(YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL))
        special_logo_occasion = _normalize_text(row.get(YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL))

        if short_name:
            parsed_patron, parsed_short = _split_youth_group_name(short_name)
            if parsed_short:
                if not patron and parsed_patron:
                    patron = parsed_patron
                short_name = parsed_short

        if not short_name and legacy_name:
            parsed_patron, parsed_short = _split_youth_group_name(legacy_name)
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
            YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL: special_logo_active,
            YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL: special_logo_occasion,
        })

    used_ids = set()
    for row in normalized_rows:
        gid = row[YOUTH_GROUP_ID_COL]
        if gid and gid not in used_ids:
            used_ids.add(gid)
            continue
        row[YOUTH_GROUP_ID_COL] = None

    if normalized_rows != yg_df.replace({np.nan: None}).to_dict(orient="records"):
        changed = True

    store[YOUTH_GROUP_SHEET] = pd.DataFrame(
        normalized_rows,
        columns=[
            YOUTH_GROUP_ID_COL,
            YOUTH_GROUP_PATRON_COL,
            YOUTH_GROUP_SHORT_NAME_COL,
            YOUTH_GROUP_PARISH_ID_COL,
            YOUTH_GROUP_USE_PARISH_LOGO_COL,
            YOUTH_GROUP_INHERIT_PARISH_SOCIAL_COL,
            YOUTH_GROUP_SPECIAL_LOGO_ACTIVE_COL,
            YOUTH_GROUP_SPECIAL_LOGO_OCCASION_COL,
        ],
    )
    _refresh_youth_group_indexes()

    legacy_names = set()
    for sheet in ("person_youth_group", "responsibilities", "timestamps"):
        df = store.get(sheet, pd.DataFrame())
        if df.empty:
            continue
        if YOUTH_GROUP_NAME_COL in df.columns:
            vals = df[YOUTH_GROUP_NAME_COL].dropna().astype(str).map(str.strip)
            legacy_names.update(v for v in vals if v)

    for name in sorted(legacy_names):
        if youth_group_id(name):
            continue
        _create_youth_group_id_for_name(name)
        changed = True

    yg_df = store.get(YOUTH_GROUP_SHEET, pd.DataFrame()).copy()
    if not yg_df.empty:
        yg_df = yg_df.drop_duplicates(subset=[YOUTH_GROUP_ID_COL], keep="first")
        yg_df = yg_df.sort_values(by=[YOUTH_GROUP_SHORT_NAME_COL, YOUTH_GROUP_ID_COL], na_position="last").reset_index(drop=True)
        store[YOUTH_GROUP_SHEET] = yg_df
        _refresh_youth_group_indexes()

    return changed


def _migrate_group_columns_in_store() -> bool:
    changed = False
    for sheet in ("person_youth_group", "responsibilities", "timestamps"):
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
    addresses = store.get(ADDRESS_SHEET, pd.DataFrame()).copy()

    if addresses.empty:
        addresses = pd.DataFrame(columns=ADDRESS_COLUMNS)
        changed = True
    else:
        for col in ADDRESS_COLUMNS:
            if col not in addresses.columns:
                addresses[col] = None
                changed = True

    existing_rows = addresses.replace({np.nan: None}).to_dict(orient="records") if not addresses.empty else []
    normalized_rows = normalize_address_rows(existing_rows)

    if not persons.empty and "person_id" in persons.columns:
        existing_ids = {str(row.get("person_id")) for row in normalized_rows if row.get("person_id") not in (None, "")}
        for row in persons.replace({np.nan: None}).to_dict(orient="records"):
            pid = _normalize_person_id(row.get("person_id"))
            if pid in (None, "") or str(pid) in existing_ids:
                continue
            legacy_governorate = _normalize_text(row.get("governorate"))
            legacy_city = _normalize_text(row.get("city"))
            legacy_address = _normalize_text(row.get("address"))
            legacy_country = _normalize_country(row.get("country"))
            if not legacy_governorate and not legacy_city and not legacy_address:
                continue
            normalized_rows.append({
                "person_id": pid,
                "country": legacy_country,
                "governorate": legacy_governorate,
                "city": legacy_city,
                "address": legacy_address,
                "is_primary": True,
            })
            changed = True

    normalized_rows = normalize_address_rows(normalized_rows)
    if normalized_rows != existing_rows:
        changed = True
    store[ADDRESS_SHEET] = pd.DataFrame(normalized_rows, columns=ADDRESS_COLUMNS)

    for legacy_col in ("governorate", "city", "country", "address"):
        if legacy_col in persons.columns:
            persons = persons.drop(columns=[legacy_col])
            changed = True
    store["persons"] = persons
    return changed


def save():
    _ensure_youth_group_schema()
    _ensure_addresses_schema()
    db.save_excel_sheets(store)
    invalidate_enriched_cache()
    print("💾 Saved to Excel.")


def df_to_json(df: pd.DataFrame):
    df = df.copy()
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = df[col].dt.strftime('%Y-%m-%d').where(df[col].notna(), None)
    return df.replace({np.nan: None}).to_dict(orient="records")


def person_name(row):
    parts = [row.get("first_name"), row.get("second_name"), row.get("third_name"), row.get("last_name")]
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


def _parse_legacy_birth_date(value):
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
        legacy_day, legacy_month = _parse_legacy_birth_date(p.get("birth_date"))
        if day is None:
            day = legacy_day
        if month is None:
            month = legacy_month

    p["birth_day"] = day
    p["birth_month"] = month
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

    has_legacy_birth_date = "birth_date" in working.columns
    if has_legacy_birth_date:
        changed = True

    records = working.replace({np.nan: None}).to_dict(orient="records")
    normalized = [normalize_person_birth_fields(r) for r in records]
    out = pd.DataFrame(normalized)

    out["birth_day"] = out["birth_day"].apply(lambda v: _to_int_or_none(v, 1, 31))
    out["birth_month"] = out["birth_month"].apply(lambda v: _to_int_or_none(v, 1, 12))

    if has_legacy_birth_date and "birth_date" in out.columns:
        out = out.drop(columns=["birth_date"])

    if not changed:
        if not working.equals(out.reindex(columns=working.columns, fill_value=None)):
            changed = True

    return out, changed


def _ensure_persons_schema():
    persons = store.get("persons", pd.DataFrame())
    changed = False

    persons, migrated_birth = _normalize_birth_columns_in_df(persons)
    changed = changed or migrated_birth

    if "registered" not in persons.columns:
        persons["registered"] = True
        changed = True
    if "title" not in persons.columns:
        persons["title"] = None
        changed = True

    for col in PERSON_NAME_COLS + PERSON_ENGLISH_NAME_COLS:
        if col not in persons.columns:
            persons[col] = None
            changed = True

    if "archived" in persons.columns:
        persons = persons.drop(columns=["archived"])
        changed = True

    for legacy_col in ("governorate", "country", "address"):
        if legacy_col in persons.columns:
            changed = True

    before_registered = persons["registered"].copy() if "registered" in persons.columns else None
    persons["registered"] = persons["registered"].apply(_bool_registered)
    if before_registered is not None and not before_registered.equals(persons["registered"]):
        changed = True

    store["persons"] = persons
    return changed


def _registered_persons_df() -> pd.DataFrame:
    _ensure_persons_schema()
    persons = store["persons"]
    return _project_primary_addresses(persons[persons["registered"] == True])


def _unregistered_persons_df() -> pd.DataFrame:
    _ensure_persons_schema()
    persons = store["persons"]
    return _project_primary_addresses(persons[persons["registered"] == False])


def _next_person_id() -> int:
    persons = store.get("persons", pd.DataFrame())
    if persons.empty or "person_id" not in persons.columns:
        return 1
    ids = pd.to_numeric(persons["person_id"], errors="coerce").dropna()
    return int(ids.max()) + 1 if not ids.empty else 1


def _normalize_person_id(v):
    if isinstance(v, str) and re.fullmatch(r"\d+", v.strip()):
        return int(v.strip())
    return v


def _sheet_for_registered(sheet: str) -> pd.DataFrame:
    df = store.get(sheet, pd.DataFrame())
    if df.empty or "person_id" not in df.columns:
        return df
    reg_ids = set(_registered_persons_df()["person_id"].astype(str))
    return df[df["person_id"].astype(str).isin(reg_ids)]


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


def name_parts_norm(row):
    return [
        normalize_arabic(row.get(k))
        for k in ("first_name", "second_name", "third_name", "last_name")
        if row.get(k)
    ]


def avatar_initial_from_person(row):
    first_name = str(row.get("first_name") or "").strip()
    if first_name:
        return first_name[0]
    for key in ("second_name", "third_name", "last_name"):
        value = str(row.get(key) or "").strip()
        if value:
            return value[0]
    return "؟"


def person_matches_name_query(parts, query_words):
    if not query_words:
        return True
    if all(any(qw in p for p in parts) for qw in query_words):
        return True
    pi, qi = 0, 0
    while pi < len(parts) and qi < len(query_words):
        if query_words[qi] in parts[pi]:
            qi += 1
        pi += 1
    return qi == len(query_words)


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

    def pid_to_youth_rows(df):
        result = {}
        if df.empty or "person_id" not in df.columns:
            return result

        for pid, grp in df.groupby("person_id", sort=False):
            rows = []
            for _, row in grp.iterrows():
                yg_id = _normalize_text(row.get(YOUTH_GROUP_ID_COL))
                if not yg_id:
                    continue
                age_group = _normalize_text(row.get("age_group")) or ""
                join_year = _normalize_text(row.get("youth_join_year")) or ""
                archived = row.get("archived")
                rows.append({
                    "youth_group_id": yg_id,
                    "age_group": age_group,
                    "youth_join_year": join_year,
                    "archived": bool(archived) if archived is not None and str(archived) not in ("nan", "None", "") else False,
                })
            result[int(pid)] = rows
        return result

    nat_map = pid_to_list(nat, "nationality")
    sch_map = pid_to_list(sch, "school")
    youth_rows_map = pid_to_youth_rows(pyg)
    ryg_id_map = pid_to_list(resp, YOUTH_GROUP_ID_COL)
    rtime_map = pid_to_list(resp, "time")
    rrole_map = pid_to_list(resp, "responsibility")
    uni_map = pid_to_list(he, "university_college")
    maj_map = pid_to_list(he, "major")
    deg_map = pid_to_list(he, "degree")
    job_map = pid_to_list(jobs, "job_title")
    comp_map = pid_to_list(jobs, "company")
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
        youth_rows = youth_rows_map.get(pid, [])
        active_youth_rows = [entry for entry in youth_rows if not bool(entry.get("archived"))]
        archived_youth_rows = [entry for entry in youth_rows if bool(entry.get("archived"))]
        row["_youth_memberships"] = youth_rows

        yg_ids = [entry["youth_group_id"] for entry in active_youth_rows]
        row["_youth_group_ids"] = yg_ids
        row["_youth_groups"] = [youth_group_name(gid) or gid for gid in yg_ids]
        row["_age_groups"] = [entry["age_group"] for entry in active_youth_rows]
        row["_youth_join_years"] = [entry["youth_join_year"] for entry in active_youth_rows]
        row["_archived_youth_group_ids"] = [entry["youth_group_id"] for entry in archived_youth_rows]
        ryg_ids = ryg_id_map.get(pid, [])
        row["_responsibility_youth_group_ids"] = ryg_ids
        row["_responsibility_youth_groups"] = [youth_group_name(gid) or gid for gid in ryg_ids]
        row["_responsibility_times"] = rtime_map.get(pid, [])
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


def _sync_unreg_view_from_store():
    global unreg_store
    _ensure_persons_schema()
    persons = store.get("persons", pd.DataFrame()).copy()
    if persons.empty:
        unreg_store = {s: pd.DataFrame() for s in UNREG_SHEETS}
        unreg_store["persons"] = pd.DataFrame(columns=UNREG_PERSONS_COLS)
        return

    persons["registered"] = persons["registered"].apply(_bool_registered)
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
        df = store.get(s, pd.DataFrame()).copy()
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
        if not base.empty and "person_id" in base.columns:
            base = base[~base["person_id"].astype(str).isin(unreg_ids)]
        incoming = unreg_store.get(s, pd.DataFrame()).copy()
        if not incoming.empty:
            if "person_id" not in incoming.columns:
                incoming["person_id"] = None
            incoming["person_id"] = incoming["person_id"].apply(_normalize_person_id)
            base = pd.concat([base, incoming], ignore_index=True)
        store[s] = base

    save()
    _sync_unreg_view_from_store()


def init_state():
    load()
    schema_changed = _ensure_persons_schema()
    group_schema_changed = _ensure_youth_group_schema()
    address_schema_changed = _ensure_addresses_schema()
    if schema_changed or group_schema_changed or address_schema_changed:
        save()
    _load_unreg_store()
