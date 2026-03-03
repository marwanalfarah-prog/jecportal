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
    "person_youth_group", "hobbies_skills",
]

UNREG_SHEETS = [
    "persons", "nationality", "mobile_numbers", "schools",
    "higher_education", "jobs", "responsibilities",
    "person_youth_group", "hobbies_skills",
]

UNREG_PERSONS_COLS = [
    "person_id", "title",
    "first_name", "second_name", "third_name", "last_name",
    "gender", "governorate", "birth_year", "birth_date",
    "registered", "archived",
]

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}

lock = threading.Lock()
store: dict[str, pd.DataFrame] = {}

unreg_lock = threading.Lock()
unreg_store: dict[str, pd.DataFrame] = {}

_data_version = 0
_enriched_cache = None
_enriched_cache_version = -1


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


def save():
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


def _ensure_persons_schema():
    persons = store.get("persons", pd.DataFrame())
    if "registered" not in persons.columns:
        persons["registered"] = True
    if "title" not in persons.columns:
        persons["title"] = None
    persons["registered"] = persons["registered"].apply(_bool_registered)
    store["persons"] = persons


def _registered_persons_df() -> pd.DataFrame:
    _ensure_persons_schema()
    persons = store["persons"]
    return persons[persons["registered"] == True]


def _unregistered_persons_df() -> pd.DataFrame:
    _ensure_persons_schema()
    persons = store["persons"]
    return persons[persons["registered"] == False]


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

    nat_map = pid_to_list(nat, "nationality")
    sch_map = pid_to_list(sch, "school")
    yg_map = pid_to_list(pyg, "youth_group_name")
    ag_map = pid_to_list(pyg, "age_group")
    yjy_map = pid_to_list(pyg, "youth_join_year")
    ryg_map = pid_to_list(resp, "youth_group_name")
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
        row["_nationalities"] = nat_map.get(pid, [])
        row["_schools"] = sch_map.get(pid, [])
        row["_youth_groups"] = yg_map.get(pid, [])
        row["_age_groups"] = ag_map.get(pid, [])
        row["_youth_join_years"] = yjy_map.get(pid, [])
        row["_responsibility_youth_groups"] = ryg_map.get(pid, [])
        row["_responsibility_times"] = rtime_map.get(pid, [])
        row["_responsibilities"] = rrole_map.get(pid, [])
        row["_universities"] = uni_map.get(pid, [])
        row["_majors"] = maj_map.get(pid, [])
        row["_degrees"] = deg_map.get(pid, [])
        row["_job_titles"] = job_map.get(pid, [])
        row["_companies"] = comp_map.get(pid, [])
        row["_hobbies"] = hob_map.get(pid, [])
        row["_photo"] = f"/api/person/{pid}/photo" if pid in photo_ids else None
        archived = row.get("archived")
        row["archived"] = bool(archived) if archived is not None and str(archived) not in ('nan', 'None', '') else False
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
    _ensure_persons_schema()
    _load_unreg_store()
