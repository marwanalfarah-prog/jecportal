import os
import re
import uuid
from datetime import datetime

from flask import jsonify, request, send_from_directory
import pandas as pd
from werkzeug.utils import secure_filename

from core import state as S
from core.routes_auth import exports as auth_exports


MOTTO_LOGOS_DIR = os.path.join(S.PHOTOS_ROOT_DIR, "logos", "mottos")
os.makedirs(MOTTO_LOGOS_DIR, exist_ok=True)

SCHOOL_LOGOS_DIR = os.path.join(S.PHOTOS_ROOT_DIR, "logos", "schools")
UNIVERSITY_LOGOS_DIR = os.path.join(S.PHOTOS_ROOT_DIR, "logos", "universities")
COMPANY_LOGOS_DIR = os.path.join(S.PHOTOS_ROOT_DIR, "logos", "companies")
SCHOOL_LOGO_ID_PREFIXES = {
    "school": "SCLG",
    "university": "UNLG",
    "company": "COLG",
}
SCHOOL_LOGO_ID_RE = re.compile(r"^(SCLG|UNLG|COLG)(\d{6})$")
SCHOOL_LOGO_RECOVERY_ENTRIES = [
    {S.SCHOOL_LOGO_ID_COL: "SCLG000001", S.INSTITUTION_TYPE_COL: "school", S.INSTITUTION_NAME_COL: "البطريركيّة اللاتينيّة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "SCLG000001.png"},
    {S.SCHOOL_LOGO_ID_COL: "SCLG000002", S.INSTITUTION_TYPE_COL: "school", S.INSTITUTION_NAME_COL: "أكاديميّة كاترينا للأطفال", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "SCLG000002.png"},
    {S.SCHOOL_LOGO_ID_COL: "SCLG000003", S.INSTITUTION_TYPE_COL: "school", S.INSTITUTION_NAME_COL: "كليّة دي لاسال - الفرير", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "SCLG000003.png"},
    {S.SCHOOL_LOGO_ID_COL: "SCLG000004", S.INSTITUTION_TYPE_COL: "school", S.INSTITUTION_NAME_COL: "المدرسة الإنجليزيّة الحديثة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "SCLG000004.png"},
    {S.SCHOOL_LOGO_ID_COL: "UNLG000001", S.INSTITUTION_TYPE_COL: "university", S.INSTITUTION_NAME_COL: "جامعة الحسين التقنيّة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "UNLG000001.png"},
    {S.SCHOOL_LOGO_ID_COL: "UNLG000002", S.INSTITUTION_TYPE_COL: "university", S.INSTITUTION_NAME_COL: "الجامعة الهاشميّة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "UNLG000002.png"},
    {S.SCHOOL_LOGO_ID_COL: "UNLG000003", S.INSTITUTION_TYPE_COL: "university", S.INSTITUTION_NAME_COL: "جامعة البلقاء التطبيقيّة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "UNLG000003.png"},
    {S.SCHOOL_LOGO_ID_COL: "UNLG000004", S.INSTITUTION_TYPE_COL: "university", S.INSTITUTION_NAME_COL: "جامعة العلوم والتكنولوجيا الأردنيّة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "UNLG000004.png"},
    {S.SCHOOL_LOGO_ID_COL: "SCLG000005", S.INSTITUTION_TYPE_COL: "school", S.INSTITUTION_NAME_COL: "أكاديميّة لوريت", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "SCLG000005.png"},
    {S.SCHOOL_LOGO_ID_COL: "SCLG000006", S.INSTITUTION_TYPE_COL: "school", S.INSTITUTION_NAME_COL: "الأردنيّة الدوليّة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "SCLG000006.png"},
    {S.SCHOOL_LOGO_ID_COL: "SCLG000007", S.INSTITUTION_TYPE_COL: "school", S.INSTITUTION_NAME_COL: "الأسقفيّة الإنجيليّة العربيّة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "SCLG000007.png"},
    {S.SCHOOL_LOGO_ID_COL: "UNLG000005", S.INSTITUTION_TYPE_COL: "university", S.INSTITUTION_NAME_COL: "جامعة مؤتة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "UNLG000005.png"},
    {S.SCHOOL_LOGO_ID_COL: "UNLG000006", S.INSTITUTION_TYPE_COL: "university", S.INSTITUTION_NAME_COL: "الجامعة الأردنيّة", S.INSTITUTION_SECTION_COL: "", "logo_file_name": "UNLG000006.png"},
]
os.makedirs(SCHOOL_LOGOS_DIR, exist_ok=True)
os.makedirs(UNIVERSITY_LOGOS_DIR, exist_ok=True)
os.makedirs(COMPANY_LOGOS_DIR, exist_ok=True)


def _bible_books_tree_path() -> str:
    return os.path.join(S.db.data_dir, "bible_books", "bible_books.json")


def _load_bible_books_tree() -> list[dict]:
    raw = S.db.load_json_file(_bible_books_tree_path(), [])
    if not isinstance(raw, list):
        return []
    return raw


CATHOLIC_BIBLE_BOOK_TREE = _load_bible_books_tree()

VERSE_SEGMENT_RE = re.compile(r"^\s*(\d+)\s*:\s*([^\s,:-]+)\s*(?:-\s*(?:(\d+)\s*:\s*)?([^\s,:-]+))?\s*$")


def _config_dir() -> str:
    return os.path.join(S.db.data_dir, "config")


def _legacy_config_path() -> str:
    return os.path.join(S.db.data_dir, "config.json")


def _config_fragment_path(option_name: str) -> str:
    return os.path.join(_config_dir(), f"{option_name}.json")


def _mottos_path() -> str:
    return _config_fragment_path("mottos")


def _legacy_mottos_path() -> str:
    return os.path.join(S.db.data_dir, "mottos.json")


def _clean_text(value):
    if value is None:
        return ""
    text = str(value).strip()
    if text in ("", "nan", "None", "null"):
        return ""
    return text


def _changed_by_from_current_user() -> str:
    user = auth_exports["_current_user"]()
    if not user or user.get("role") == "admin":
        return "admin"
    person_id = user.get("person_id")
    return str(person_id) if person_id is not None and str(person_id).strip() else "admin"


def _normalize_verse_id(value) -> str:
    return re.sub(r"\s+", "", _clean_text(value))


def _parse_verse_id(value) -> tuple[str, int, str] | None:
    verse_id = _normalize_verse_id(value)
    if not verse_id:
        return None

    match = re.match(r"^(\d+)(.*)$", verse_id)
    if not match:
        return None

    number = int(match.group(1))
    if number <= 0:
        return None

    return verse_id, number, match.group(2) or ""


def _compare_verse_ids(left, right) -> int | None:
    left_meta = _parse_verse_id(left)
    right_meta = _parse_verse_id(right)
    if left_meta is None or right_meta is None:
        return None

    if left_meta[1] != right_meta[1]:
        return -1 if left_meta[1] < right_meta[1] else 1
    if left_meta[2] == right_meta[2]:
        return 0
    return -1 if left_meta[2] < right_meta[2] else 1


def _normalize_name_variations(raw):
    """
    Accepts both supported structures:
    - {"base": ["alt1", "alt2"]}
    - [{"name": "base", "variations": ["alt1"]}, ...]
    Returns canonical dict[str, list[str]].
    """
    result = {}
    if isinstance(raw, dict):
        items = raw.items()
    elif isinstance(raw, list):
        items = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            items.append((entry.get("name"), entry.get("variations", [])))
    else:
        items = []

    for base_raw, vars_raw in items:
        base = _clean_text(base_raw)
        if not base:
            continue

        if isinstance(vars_raw, str):
            vals = [vars_raw]
        elif isinstance(vars_raw, list):
            vals = vars_raw
        else:
            vals = []

        cleaned = []
        seen = set()
        for value in vals:
            text = _clean_text(value)
            if not text or text == base or text in seen:
                continue
            seen.add(text)
            cleaned.append(text)

        if base in result:
            existing = set(result[base])
            for value in cleaned:
                if value not in existing:
                    result[base].append(value)
                    existing.add(value)
        else:
            result[base] = cleaned

    return result


def _normalize_person_titles(raw):
    result = []
    if isinstance(raw, dict):
        entries = [
            {
                "arabic_title": key,
                "english_title": value,
            }
            for key, value in raw.items()
        ]
    elif isinstance(raw, list):
        entries = raw
    else:
        entries = []

    by_arabic = {}
    order = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue

        arabic_title = _clean_text(
            entry.get("arabic_title")
            or entry.get("arabic")
            or entry.get("title")
            or entry.get("name")
            or entry.get("ar")
        )
        english_title = _clean_text(
            entry.get("english_title")
            or entry.get("english")
            or entry.get("en")
        )

        if not arabic_title:
            continue

        if arabic_title not in by_arabic:
            by_arabic[arabic_title] = {
                "arabic_title": arabic_title,
                "english_title": english_title,
            }
            order.append(arabic_title)
            continue

        if not by_arabic[arabic_title].get("english_title") and english_title:
            by_arabic[arabic_title]["english_title"] = english_title

    for arabic_title in order:
        result.append(by_arabic[arabic_title])
    return result


def _normalize_school_branches(raw):
    result = {}
    if isinstance(raw, dict):
        items = raw.items()
    elif isinstance(raw, list):
        items = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            items.append((entry.get("school"), entry.get("branches", [])))
    else:
        items = []

    for school_raw, branches_raw in items:
        school = _clean_text(school_raw)
        if not school:
            continue

        if isinstance(branches_raw, str):
            values = [branches_raw]
        elif isinstance(branches_raw, list):
            values = branches_raw
        else:
            values = []

        cleaned = []
        seen = set()
        for value in values:
            branch = _clean_text(value)
            if not branch or branch in seen:
                continue
            seen.add(branch)
            cleaned.append(branch)

        result[school] = cleaned

    return result


def _default_config():
    return {
        "active_jec_year": "",
        "name_variations": {},
        "school_branches": {},
    }


def _normalize_config_payload(raw):
    config = _default_config()
    if isinstance(raw, dict):
        config.update(raw)
    config["active_jec_year"] = _normalize_year_label(config.get("active_jec_year"))
    config["name_variations"] = _normalize_name_variations(config.get("name_variations", {}))
    config["person_titles"] = _normalize_person_titles(config.get("person_titles", []))
    config["school_branches"] = _normalize_school_branches(config.get("school_branches", {}))
    return config


def _default_mottos_payload():
    return {"mottos": []}


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _parse_iso_date(value: str | None):
    text = _clean_text(value)
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except Exception:
        return None


def _normalize_year_label(value) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if re.fullmatch(r"\d{4}", text):
        return text
    return ""


def _book_index() -> dict[tuple[str, str, str], dict]:
    out = {}

    def _visit_section(testament_id, testament_name, section_row):
        section = section_row if isinstance(section_row, dict) else {}
        section_id = _clean_text(section.get("id"))
        section_name = _clean_text(section.get("name"))

        books = section.get("books") if isinstance(section.get("books"), list) else []
        for book in books:
            if not isinstance(book, dict):
                continue
            book_id = _clean_text(book.get("id"))
            book_name = _clean_text(book.get("name"))
            book_abbr = _clean_text(book.get("abbr"))
            if not (testament_id and section_id and book_id):
                continue
            out[(testament_id, section_id, book_id)] = {
                "testament_id": testament_id,
                "testament_name": testament_name,
                "section_id": section_id,
                "section_name": section_name,
                "book_id": book_id,
                "book_name": book_name,
                "book_abbr": book_abbr,
            }

        subsections = section.get("subsections") if isinstance(section.get("subsections"), list) else []
        for subsection in subsections:
            _visit_section(testament_id, testament_name, subsection)

    for testament in CATHOLIC_BIBLE_BOOK_TREE:
        if not isinstance(testament, dict):
            continue
        testament_id = _clean_text(testament.get("id"))
        testament_name = _clean_text(testament.get("name"))
        sections = testament.get("sections") if isinstance(testament.get("sections"), list) else []
        for section in sections:
            _visit_section(testament_id, testament_name, section)

    return out


BOOK_INDEX = _book_index()


def _book_index_by_testament_book_id() -> dict[tuple[str, str], dict]:
    out = {}
    for _, meta in BOOK_INDEX.items():
        testament_id = _clean_text(meta.get("testament_id"))
        book_id = _clean_text(meta.get("book_id"))
        if not (testament_id and book_id):
            continue
        out.setdefault((testament_id, book_id), meta)
    return out


BOOK_INDEX_BY_TESTAMENT_BOOK_ID = _book_index_by_testament_book_id()


def _book_index_by_book_id() -> dict[str, dict]:
    out = {}
    for _, meta in BOOK_INDEX.items():
        book_id = _clean_text(meta.get("book_id"))
        if not book_id:
            continue
        out.setdefault(book_id, meta)
    return out


BOOK_INDEX_BY_BOOK_ID = _book_index_by_book_id()


def _parse_verse_segment(raw_segment: str) -> dict | None:
    text = _clean_text(raw_segment)
    if not text:
        return None
    m = VERSE_SEGMENT_RE.match(text)
    if not m:
        return None

    start_chapter = int(m.group(1))
    start_verse = _normalize_verse_id(m.group(2))
    end_chapter = int(m.group(3)) if m.group(3) else start_chapter
    end_verse = _normalize_verse_id(m.group(4)) if m.group(4) else start_verse

    if min(start_chapter, end_chapter) <= 0:
        return None
    if _parse_verse_id(start_verse) is None or _parse_verse_id(end_verse) is None:
        return None
    if end_chapter < start_chapter:
        return None
    if end_chapter == start_chapter and _compare_verse_ids(start_verse, end_verse) > 0:
        return None

    return {
        "start": {
            "chapter": start_chapter,
            "verse": start_verse,
        },
        "end": {
            "chapter": end_chapter,
            "verse": end_verse,
        },
    }


def _verse_segment_to_text(segment: dict) -> str:
    row = segment if isinstance(segment, dict) else {}
    start = row.get("start") if isinstance(row.get("start"), dict) else {}
    end = row.get("end") if isinstance(row.get("end"), dict) else {}

    try:
        start_chapter = int(start.get("chapter"))
        end_chapter = int(end.get("chapter"))
    except Exception:
        return ""

    start_verse = _normalize_verse_id(start.get("verse"))
    end_verse = _normalize_verse_id(end.get("verse"))

    if min(start_chapter, end_chapter) <= 0:
        return ""
    if _parse_verse_id(start_verse) is None or _parse_verse_id(end_verse) is None:
        return ""
    if end_chapter == start_chapter and _compare_verse_ids(start_verse, end_verse) > 0:
        return ""

    if start_chapter == end_chapter and start_verse == end_verse:
        return f"{start_chapter}: {start_verse}"
    if start_chapter == end_chapter:
        return f"{start_chapter}: {start_verse}-{end_verse}"
    return f"{start_chapter}: {start_verse}-{end_chapter}: {end_verse}"


def _verse_reference_text(value) -> str:
    if isinstance(value, str):
        return _clean_text(value).replace(":", ": ")

    row = value if isinstance(value, dict) else {}
    direct_raw = _clean_text(row.get("raw"))
    if direct_raw:
        return direct_raw.replace(":", ": ")

    segments = row.get("segments") if isinstance(row.get("segments"), list) else []
    rendered = []
    for segment in segments:
        part = _verse_segment_to_text(segment)
        if part:
            rendered.append(part)
    return ", ".join(rendered)


def _normalize_verse_reference(raw_reference) -> dict:
    raw = _verse_reference_text(raw_reference)
    if not raw:
        return {
            "segments": [],
            "all_segments_structured": False,
        }

    parts = [p.strip() for p in re.split(r"[,،;؛]\s*", raw) if p.strip()]
    segments = []
    all_structured = True

    for part in parts:
        parsed = _parse_verse_segment(part)
        if parsed is None:
            all_structured = False
            continue
        segments.append(parsed)

    return {
        "segments": segments,
        "all_segments_structured": all_structured and len(segments) > 0,
    }


def _normalize_targets(raw_targets) -> dict:
    targets = raw_targets if isinstance(raw_targets, dict) else {}
    jec_jordan = bool(targets.get("jec_jordan") or False)

    group_values = targets.get("youth_groups")
    if isinstance(group_values, str):
        values = [group_values]
    elif isinstance(group_values, list):
        values = group_values
    else:
        values = []

    resolved = []
    seen = set()
    for item in values:
        gid = S.youth_group_id(item)
        if not gid or gid == "GS" or gid in seen:
            continue
        seen.add(gid)
        resolved.append(gid)

    return {
        "jec_jordan": jec_jordan,
        "youth_groups": sorted(resolved),
    }


def _normalize_bible_reference(raw_reference: dict) -> dict | None:
    row = raw_reference if isinstance(raw_reference, dict) else {}
    book_row = row.get("book") if isinstance(row.get("book"), dict) else row

    book_id = _clean_text(book_row.get("book_id"))
    testament_id = _clean_text(book_row.get("testament_id"))
    section_id = _clean_text(book_row.get("section_id"))

    if not book_id:
        return None

    # Validate against the canonical bible tree even when only book_id is provided.
    book_meta = None
    if testament_id and section_id:
        book_meta = BOOK_INDEX.get((testament_id, section_id, book_id))
    if book_meta is None and testament_id:
        # Backward compatibility: resolve old section IDs by testament + book.
        book_meta = BOOK_INDEX_BY_TESTAMENT_BOOK_ID.get((testament_id, book_id))
    if book_meta is None:
        book_meta = BOOK_INDEX_BY_BOOK_ID.get(book_id)
    if book_meta is None:
        return None

    verse = _normalize_verse_reference(
        row.get("verses") or row.get("reference") or row.get("raw") or row.get("verse")
    )
    if not verse.get("segments"):
        return None

    return {
        # Persist only the canonical id and hydrate metadata when serializing.
        "book": {
            "book_id": book_id,
        },
        "verse": verse,
    }


def _normalize_motto(raw_motto: dict, existing: dict | None = None, touch_updated: bool = False) -> dict:
    row = raw_motto if isinstance(raw_motto, dict) else {}
    current = existing if isinstance(existing, dict) else {}

    motto_id = _clean_text(current.get("motto_id") or row.get("motto_id")) or uuid.uuid4().hex[:12]
    title = _clean_text(row.get("title") or current.get("title"))
    year_label = _normalize_year_label(row.get("year_label") if "year_label" in row else current.get("year_label"))
    application_from_date = _clean_text(row.get("application_from_date") if "application_from_date" in row else current.get("application_from_date"))
    application_to_date = _clean_text(row.get("application_to_date") if "application_to_date" in row else current.get("application_to_date"))
    application_is_present = bool(
        row.get("application_is_present")
        if "application_is_present" in row
        else current.get("application_is_present")
    )

    if not application_is_present and not application_to_date:
        application_to_date = _clean_text(current.get("application_to_date"))
    if application_is_present:
        application_to_date = ""

    targets = _normalize_targets(row.get("targets") if "targets" in row else current.get("targets"))
    bible_raw = row.get("bible_references") if "bible_references" in row else current.get("bible_references")

    bible_references = []
    if isinstance(bible_raw, list):
        for item in bible_raw:
            normalized = _normalize_bible_reference(item)
            if normalized is None:
                continue
            bible_references.append(normalized)
    if len(bible_references) > 1:
        bible_references = [bible_references[0]]

    logo_file_name = _clean_text(current.get("logo_file_name") or row.get("logo_file_name"))

    return {
        "motto_id": motto_id,
        "title": title,
        "year_label": year_label,
        "application_from_date": application_from_date,
        "application_to_date": application_to_date,
        "application_is_present": application_is_present,
        "targets": targets,
        "bible_references": bible_references,
        "logo_file_name": logo_file_name,
    }


def _motto_logo_filename(motto_id: str) -> str | None:
    mid = _clean_text(motto_id)
    if not mid:
        return None
    for ext in S.ALLOWED_EXTENSIONS:
        file_name = f"{mid}.{ext}"
        path = os.path.join(MOTTO_LOGOS_DIR, file_name)
        if os.path.exists(path):
            return file_name
    return None


def _motto_logo_url(motto_id: str, file_name: str | None = None) -> str | None:
    mid = _clean_text(motto_id)
    if not mid:
        return None
    if not file_name:
        file_name = _motto_logo_filename(mid)
    if not file_name:
        return None
    return f"/api/config/mottos/{mid}/logo"


def _serialize_motto(row: dict) -> dict:
    item = dict(row or {})

    refs_raw = item.get("bible_references") if isinstance(item.get("bible_references"), list) else []
    refs = []
    for ref in refs_raw:
        if not isinstance(ref, dict):
            continue
        ref_book = ref.get("book") if isinstance(ref.get("book"), dict) else {}
        book_id = _clean_text(ref_book.get("book_id"))
        hydrated_book = dict(BOOK_INDEX_BY_BOOK_ID.get(book_id) or {})
        if not hydrated_book and ref_book:
            hydrated_book = dict(ref_book)
        if book_id and not hydrated_book.get("book_id"):
            hydrated_book["book_id"] = book_id

        verse_obj = ref.get("verse") if isinstance(ref.get("verse"), dict) else _normalize_verse_reference(ref.get("verse"))
        verse_raw = _verse_reference_text(verse_obj)
        verse_payload = dict(verse_obj or {})
        if verse_raw:
            # Expose display text without storing it in mottos.json.
            verse_payload["raw"] = verse_raw

        refs.append({
            "book": hydrated_book,
            "verse": verse_payload,
        })
    item["bible_references"] = refs

    item["id"] = item.get("motto_id")
    item["logo_url"] = _motto_logo_url(item.get("motto_id"), item.get("logo_file_name"))
    item["is_active_now"] = _is_motto_active_now(item)

    target = item.get("targets") if isinstance(item.get("targets"), dict) else {}
    youth_groups = []
    for gid in target.get("youth_groups", []):
        name = S.youth_group_name(gid) or gid
        youth_groups.append({"group_id": gid, "group_name": name})
    item["targets_meta"] = {
        "jec_jordan": bool(target.get("jec_jordan") or False),
        "youth_groups": youth_groups,
    }
    return item


def _is_motto_active_now(row: dict) -> bool:
    item = row if isinstance(row, dict) else {}
    from_date = _parse_iso_date(item.get("application_from_date"))
    if from_date is None:
        return False

    today = datetime.utcnow().date()
    if today < from_date:
        return False

    if bool(item.get("application_is_present") or False):
        return True

    to_date = _parse_iso_date(item.get("application_to_date"))
    if to_date is None:
        return False
    return today <= to_date


def _is_motto_applicable_to_groups(row: dict, group_ids: list[str], include_jec_jordan: bool) -> bool:
    item = row if isinstance(row, dict) else {}
    targets = item.get("targets") if isinstance(item.get("targets"), dict) else {}
    if include_jec_jordan and bool(targets.get("jec_jordan") or False):
        return True

    target_group_ids = set(targets.get("youth_groups") if isinstance(targets.get("youth_groups"), list) else [])
    return len(target_group_ids.intersection(set(group_ids))) > 0


def _load_mottos_from_sheets() -> dict:
    mottos_df = S._scd_filter_active(S.store.get(S.MOTTOS_SHEET, pd.DataFrame()).copy())
    yg_df = S._scd_filter_active(S.store.get(S.MOTTO_YOUTH_GROUPS_SHEET, pd.DataFrame()).copy())

    yg_map: dict[str, list[str]] = {}
    if not yg_df.empty:
        for _, row in yg_df.iterrows():
            mid = _clean_text(row.get("motto_id"))
            gid = _clean_text(row.get("youth_group_id"))
            if mid and gid:
                yg_map.setdefault(mid, []).append(gid)

    mottos = []
    if not mottos_df.empty:
        for _, row in mottos_df.iterrows():
            mid = _clean_text(row.get("motto_id"))
            if not mid:
                continue
            book_id = _clean_text(row.get("bible_book_id"))
            bible_references = []
            try:
                sec_start = _clean_text(row.get("bible_section_start"))
                sec_end   = _clean_text(row.get("bible_section_end"))
                vs_start  = _clean_text(row.get("bible_verse_start"))
                vs_end    = _clean_text(row.get("bible_verse_end"))
                if book_id and sec_start and vs_start:
                    sc = int(sec_start)
                    ec = int(sec_end) if sec_end else sc
                    vv_s = vs_start
                    vv_e = vs_end if vs_end else vv_s
                    segment = {
                        "start": {"chapter": sc, "verse": vv_s},
                        "end":   {"chapter": ec, "verse": vv_e},
                    }
                    bible_references = [{"book": {"book_id": book_id}, "verse": {"segments": [segment], "all_segments_structured": True}}]
            except (ValueError, TypeError):
                pass
            mottos.append({
                "motto_id": mid,
                "title": _clean_text(row.get("title")),
                "year_label": _clean_text(row.get("year_label")),
                "application_from_date": _clean_text(row.get("application_from_date")),
                "application_to_date": _clean_text(row.get("application_to_date")),
                "application_is_present": bool(row.get("application_is_present") or False),
                "targets": {
                    "jec_jordan": bool(row.get("targets_jec_jordan") or False),
                    "youth_groups": yg_map.get(mid, []),
                },
                "bible_references": bible_references,
                "logo_file_name": _clean_text(row.get("logo_file_name")),
            })
    return {"mottos": mottos}


def _motto_flat_row(item: dict) -> dict:
    """Convert a normalized motto dict into the flat CSV row dict (no SCD columns)."""
    targets = item.get("targets") if isinstance(item.get("targets"), dict) else {}
    bible_refs = item.get("bible_references") if isinstance(item.get("bible_references"), list) else []
    bible_book_id = ""
    bible_section_start = ""
    bible_section_end = ""
    bible_verse_start = ""
    bible_verse_end = ""
    if bible_refs:
        ref = bible_refs[0]
        book = ref.get("book") if isinstance(ref.get("book"), dict) else {}
        bible_book_id = _clean_text(book.get("book_id")) or ""
        verse = ref.get("verse") if isinstance(ref.get("verse"), dict) else {}
        segments = verse.get("segments") if isinstance(verse.get("segments"), list) else []
        if segments:
            seg = segments[0]
            s = seg.get("start") if isinstance(seg.get("start"), dict) else {}
            e = seg.get("end") if isinstance(seg.get("end"), dict) else {}
            bible_section_start = str(s["chapter"]) if s.get("chapter") else ""
            bible_section_end   = str(e["chapter"]) if e.get("chapter") else ""
            bible_verse_start   = str(s["verse"])   if s.get("verse")   else ""
            bible_verse_end     = str(e["verse"])   if e.get("verse")   else ""
    return {
        "motto_id": _clean_text(item.get("motto_id")) or "",
        "title": _clean_text(item.get("title")) or "",
        "year_label": _clean_text(item.get("year_label")) or "",
        "application_from_date": _clean_text(item.get("application_from_date")) or "",
        "application_to_date": _clean_text(item.get("application_to_date")) or "",
        "application_is_present": bool(item.get("application_is_present") or False),
        "targets_jec_jordan": bool(targets.get("jec_jordan") or False),
        "bible_book_id": bible_book_id,
        "bible_section_start": bible_section_start,
        "bible_section_end": bible_section_end,
        "bible_verse_start": bible_verse_start,
        "bible_verse_end": bible_verse_end,
        "logo_file_name": _clean_text(item.get("logo_file_name")) or "",
    }


def _save_mottos_to_sheets(payload: dict, changed_by: str = "admin") -> None:
    """SCD-aware save. Uses close-and-insert per motto; only touches motto_youth_groups when targets change."""
    rows = payload.get("mottos") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        rows = []

    now = S._scd_timestamp()

    # Build incoming data maps indexed by motto_id
    new_motto_data: dict[str, dict] = {}
    new_yg_data: dict[str, list[str]] = {}
    for item in rows:
        mid = _clean_text(item.get("motto_id"))
        if not mid:
            continue
        new_motto_data[mid] = _motto_flat_row(item)
        targets = item.get("targets") if isinstance(item.get("targets"), dict) else {}
        new_yg_data[mid] = sorted({
            _clean_text(gid) for gid in (targets.get("youth_groups") or []) if _clean_text(gid)
        })

    # ── MOTTOS SHEET ──────────────────────────────────────────────────────────
    mottos_df = S._scd_ensure_columns(S.store.get(S.MOTTOS_SHEET, pd.DataFrame()).copy())
    active_m_df, inactive_m_df = S._scd_split(mottos_df)

    old_active_mottos: dict[str, dict] = {}
    if not active_m_df.empty:
        for _, row in active_m_df.iterrows():
            mid = _clean_text(row.get("motto_id"))
            if mid:
                old_active_mottos[mid] = row.to_dict()

    final_mottos: list[dict] = list(inactive_m_df.replace({pd.NA: None}).to_dict(orient="records")) if not inactive_m_df.empty else []

    for mid, new_row in new_motto_data.items():
        old_row = old_active_mottos.get(mid)
        if old_row is None:
            final_mottos.append({**new_row, **S._scd_new_metadata(changed_by)})
        else:
            unchanged = all(
                S._scd_val_for_compare(old_row.get(c)) == S._scd_val_for_compare(new_row.get(c))
                for c in S.MOTTOS_COLUMNS
            )
            if unchanged:
                final_mottos.append(old_row)
            else:
                closed = dict(old_row)
                closed[S.SCD_ACTIVE_TO_COL] = now
                closed[S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                final_mottos.append(closed)
                final_mottos.append({**new_row, **S._scd_new_metadata(changed_by)})

    # Close active mottos not present in payload (soft delete)
    for mid, old_row in old_active_mottos.items():
        if mid not in new_motto_data:
            closed = dict(old_row)
            closed[S.SCD_ACTIVE_TO_COL] = now
            closed[S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
            final_mottos.append(closed)

    mottos_cols = S.MOTTOS_COLUMNS + [c for c in S.SCD_METADATA_COLUMNS if c not in S.MOTTOS_COLUMNS]
    S.store[S.MOTTOS_SHEET] = pd.DataFrame(final_mottos if final_mottos else [], columns=mottos_cols)

    # ── MOTTO_YOUTH_GROUPS SHEET ──────────────────────────────────────────────
    yg_df = S._scd_ensure_columns(S.store.get(S.MOTTO_YOUTH_GROUPS_SHEET, pd.DataFrame()).copy())
    active_yg_df, inactive_yg_df = S._scd_split(yg_df)

    old_active_yg: dict[str, list[dict]] = {}
    if not active_yg_df.empty:
        for _, row in active_yg_df.iterrows():
            mid = _clean_text(row.get("motto_id"))
            if mid:
                old_active_yg.setdefault(mid, []).append(row.to_dict())

    final_yg: list[dict] = list(inactive_yg_df.replace({pd.NA: None}).to_dict(orient="records")) if not inactive_yg_df.empty else []

    for mid, new_gids in new_yg_data.items():
        old_rows = old_active_yg.get(mid, [])
        old_gids = sorted({
            _clean_text(r.get("youth_group_id")) for r in old_rows if _clean_text(r.get("youth_group_id"))
        })
        if old_gids == new_gids:
            final_yg.extend(old_rows)
        else:
            for old_row in old_rows:
                closed = dict(old_row)
                closed[S.SCD_ACTIVE_TO_COL] = now
                closed[S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                final_yg.append(closed)
            for gid in new_gids:
                final_yg.append({"motto_id": mid, "youth_group_id": gid, **S._scd_new_metadata(changed_by)})

    # Close yg rows for mottos being soft-deleted
    for mid in old_active_yg:
        if mid not in new_motto_data:
            for old_row in old_active_yg[mid]:
                closed = dict(old_row)
                closed[S.SCD_ACTIVE_TO_COL] = now
                closed[S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                final_yg.append(closed)

    yg_cols = S.MOTTO_YOUTH_GROUPS_COLUMNS + [c for c in S.SCD_METADATA_COLUMNS if c not in S.MOTTO_YOUTH_GROUPS_COLUMNS]
    S.store[S.MOTTO_YOUTH_GROUPS_SHEET] = pd.DataFrame(final_yg if final_yg else [], columns=yg_cols)

    S.db.save_excel_sheets(S.store)


def _load_mottos_payload() -> dict:
    payload = _load_mottos_from_sheets()
    normalized = []
    for item in payload.get("mottos", []):
        row = _normalize_motto(item)
        if not row.get("title"):
            continue
        normalized.append(row)
    return {"mottos": normalized}


def _save_mottos_payload(payload: dict, changed_by: str = "admin") -> dict:
    rows = payload.get("mottos") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        rows = []
    normalized = []
    for row in rows:
        item = _normalize_motto(row)
        if not item.get("title"):
            continue
        normalized.append(item)
    result = {"mottos": normalized}
    _save_mottos_to_sheets(result, changed_by=changed_by)
    for legacy_path in (_mottos_path(), _legacy_mottos_path()):
        if os.path.exists(legacy_path):
            try:
                os.remove(legacy_path)
            except OSError:
                pass
    return result


def _list_mottos_serialized() -> list[dict]:
    payload = _load_mottos_payload()
    rows = payload.get("mottos", [])
    rows_sorted = sorted(rows, key=lambda x: _clean_text(x.get("year_label")) or "", reverse=True)
    return [_serialize_motto(row) for row in rows_sorted]


def _validate_motto_scope(targets: dict) -> bool:
    if not isinstance(targets, dict):
        return False
    if bool(targets.get("jec_jordan") or False):
        return True
    youth_groups = targets.get("youth_groups") if isinstance(targets.get("youth_groups"), list) else []
    return len(youth_groups) > 0


def _validate_motto_period(motto: dict) -> tuple[bool, str | None]:
    item = motto if isinstance(motto, dict) else {}
    from_date = _parse_iso_date(item.get("application_from_date"))
    if from_date is None:
        return False, "application from date is required and must be YYYY-MM-DD"

    is_present = bool(item.get("application_is_present") or False)
    if is_present:
        return True, None

    to_date = _parse_iso_date(item.get("application_to_date"))
    if to_date is None:
        return False, "application to date is required when motto is not present"
    if to_date < from_date:
        return False, "application to date must be >= from date"
    return True, None


def _validate_motto_single_reference(motto: dict) -> tuple[bool, str | None]:
    refs = motto.get("bible_references") if isinstance(motto, dict) else []
    if not isinstance(refs, list) or len(refs) != 1:
        return False, "exactly one bible reference is required"

    ref = refs[0] if isinstance(refs[0], dict) else {}
    verse = ref.get("verse") if isinstance(ref.get("verse"), dict) else {}
    segments = verse.get("segments") if isinstance(verse.get("segments"), list) else []
    if not segments or not bool(verse.get("all_segments_structured")):
        return False, "invalid verses format; use chapter:verse or ranges like 1:1ب or 3:15-16"
    return True, None


def _validate_motto_year(motto: dict) -> tuple[bool, str | None]:
    year_label = _clean_text((motto or {}).get("year_label"))
    if not year_label:
        return True, None
    if not re.fullmatch(r"\d{4}", year_label):
        return False, "year must be a 4-digit value"
    return True, None


def _youth_group_scope_options() -> list[dict]:
    options = []
    for item in S.youth_group_options():
        gid = _clean_text(item.get("value"))
        label = _clean_text(item.get("label"))
        if not gid or gid == "GS":
            continue
        options.append({
            "group_id": gid,
            "group_name": label or gid,
        })
    return options


def _load_person_titles_from_sheet() -> list[dict]:
    df = S.store.get(S.TITLE_OPTIONS_SHEET, pd.DataFrame()).copy()
    if df.empty:
        return []
    rows = []
    for _, row in df.iterrows():
        arabic = _clean_text(row.get("arabic_title"))
        english = _clean_text(row.get("english_title"))
        if arabic:
            rows.append({"arabic_title": arabic, "english_title": english or ""})
    return rows


def _save_person_titles_to_sheet(titles: list[dict]) -> None:
    normalized = _normalize_person_titles(titles)
    df = pd.DataFrame(normalized if normalized else [], columns=S.TITLE_OPTIONS_COLUMNS)
    S.store[S.TITLE_OPTIONS_SHEET] = df
    S.db.save_excel_sheets(S.store)


def _load_config():
    defaults = _default_config()

    if os.path.isdir(_config_dir()):
        fragments = {}
        for key, default_value in defaults.items():
            fragments[key] = S.db.load_json_file(_config_fragment_path(key), default_value)
        fragments["person_titles"] = _load_person_titles_from_sheet()
        return _normalize_config_payload(fragments)

    legacy = S.db.load_json_file(_legacy_config_path(), defaults)
    legacy["person_titles"] = _load_person_titles_from_sheet()
    return _normalize_config_payload(legacy)


# ── School / University Logos ─────────────────────────────────────────────────


def _normalize_school_logo_entries(raw_entries) -> list[dict]:
    entries = raw_entries if isinstance(raw_entries, list) else []
    normalized = []
    seen_ids = set()

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        entry_id = _clean_text(entry.get(S.SCHOOL_LOGO_ID_COL) or entry.get("id"))
        entry_type = _clean_text(entry.get(S.INSTITUTION_TYPE_COL) or entry.get("type"))
        name = _clean_text(entry.get(S.INSTITUTION_NAME_COL) or entry.get("name"))
        section = _clean_text(entry.get(S.INSTITUTION_SECTION_COL) or entry.get("section") or "")
        logo_file_name = _clean_text(entry.get("logo_file_name") or "")

        if not entry_id or entry_id in seen_ids:
            continue
        if entry_type not in ("school", "university", "company"):
            continue
        if not name:
            continue

        seen_ids.add(entry_id)
        normalized.append({
            S.SCHOOL_LOGO_ID_COL: entry_id,
            S.INSTITUTION_TYPE_COL: entry_type,
            S.INSTITUTION_NAME_COL: name,
            S.INSTITUTION_SECTION_COL: section,
            "id": entry_id,
            "type": entry_type,
            "name": name,
            "section": section,
            "logo_file_name": logo_file_name,
        })

    return normalized


def _school_logo_dir(entry_type: str) -> str:
    if entry_type == "university":
        return UNIVERSITY_LOGOS_DIR
    if entry_type == "company":
        return COMPANY_LOGOS_DIR
    return SCHOOL_LOGOS_DIR


def _school_logo_prefix(entry_type: str) -> str:
    return SCHOOL_LOGO_ID_PREFIXES.get(entry_type, "SCLG")


def _school_logo_id_matches_type(entry_id: str, entry_type: str) -> bool:
    text = _clean_text(entry_id)
    match = SCHOOL_LOGO_ID_RE.match(text)
    if not match:
        return False
    return match.group(1) == _school_logo_prefix(entry_type)


def _next_school_logo_id(existing_rows: list[dict], entry_type: str) -> str:
    prefix = _school_logo_prefix(entry_type)
    max_num = 0
    for row in existing_rows:
        entry_id = _clean_text(row.get(S.SCHOOL_LOGO_ID_COL) or row.get("id"))
        match = SCHOOL_LOGO_ID_RE.match(entry_id)
        if not match or match.group(1) != prefix:
            continue
        max_num = max(max_num, int(match.group(2)))
    return f"{prefix}{max_num + 1:06d}"


def _school_logo_entry_ext(entry: dict) -> str:
    file_name = _clean_text(entry.get("logo_file_name"))
    if "." not in file_name:
        return ""
    ext = file_name.rsplit(".", 1)[1].lower()
    return ext if ext in S.ALLOWED_EXTENSIONS else ""


def _school_logo_candidate_paths(entry_id: str, logo_file_name: str) -> list[str]:
    candidates = []
    eid = _clean_text(entry_id)
    file_name = _clean_text(logo_file_name)

    if file_name:
        candidates.extend([
            os.path.join(SCHOOL_LOGOS_DIR, file_name),
            os.path.join(UNIVERSITY_LOGOS_DIR, file_name),
            os.path.join(COMPANY_LOGOS_DIR, file_name),
        ])

    if eid:
        for ext in S.ALLOWED_EXTENSIONS:
            legacy_name = f"{eid}.{ext}"
            candidates.extend([
                os.path.join(SCHOOL_LOGOS_DIR, legacy_name),
                os.path.join(UNIVERSITY_LOGOS_DIR, legacy_name),
                os.path.join(COMPANY_LOGOS_DIR, legacy_name),
            ])

    deduped = []
    seen = set()
    for path in candidates:
        norm = os.path.normcase(os.path.normpath(path))
        if norm in seen:
            continue
        seen.add(norm)
        deduped.append(path)
    return deduped


def _locate_school_logo_file(entry: dict) -> str | None:
    entry_id = _clean_text(entry.get(S.SCHOOL_LOGO_ID_COL) or entry.get("id"))
    file_name = _clean_text(entry.get("logo_file_name"))
    for path in _school_logo_candidate_paths(entry_id, file_name):
        if os.path.exists(path):
            return path
    return None


def _find_school_logo_entry(entry_id: str, entries: list[dict] | None = None) -> dict | None:
    eid = _clean_text(entry_id)
    if not eid:
        return None
    rows = entries if isinstance(entries, list) else _school_logo_sheet_rows()
    for entry in rows:
        if _clean_text(entry.get(S.SCHOOL_LOGO_ID_COL) or entry.get("id")) == eid:
            return entry
    return None


def _school_logo_file_path(entry_id: str, entries: list[dict] | None = None) -> str | None:
    entry = _find_school_logo_entry(entry_id, entries)
    if not entry:
        return None
    return _locate_school_logo_file(entry)


def _recover_school_logo_rows_from_files() -> list[dict]:
    recovered = []
    for entry in SCHOOL_LOGO_RECOVERY_ENTRIES:
        file_name = _clean_text(entry.get("logo_file_name"))
        entry_type = _clean_text(entry.get(S.INSTITUTION_TYPE_COL))
        if not file_name or not entry_type:
            continue
        path = os.path.join(_school_logo_dir(entry_type), file_name)
        if not os.path.exists(path):
            continue
        recovered.append(dict(entry))
    return _normalize_school_logo_entries(recovered)


def _migrate_school_logo_storage() -> bool:
    current_df = S._scd_filter_active(S.store.get(S.SCHOOL_LOGO_SHEET, pd.DataFrame()).copy())
    if current_df.empty and S.SCHOOL_LOGO_SHEET not in S.store:
        return False

    if current_df.empty:
        current_rows = []
    else:
        for col in S.SCHOOL_LOGO_COLUMNS:
            if col not in current_df.columns:
                current_df[col] = None
        current_rows = _normalize_school_logo_entries(
            current_df[S.SCHOOL_LOGO_COLUMNS].where(pd.notna(current_df[S.SCHOOL_LOGO_COLUMNS]), None).to_dict(orient="records")
        )

    migrated_rows = []
    used_ids = set()
    changed = False

    for row in current_rows:
        entry = dict(row)
        entry_type = _clean_text(entry.get(S.INSTITUTION_TYPE_COL) or entry.get("type"))
        old_id = _clean_text(entry.get(S.SCHOOL_LOGO_ID_COL) or entry.get("id"))
        old_file_name = _clean_text(entry.get("logo_file_name"))
        new_id = old_id

        if not _school_logo_id_matches_type(old_id, entry_type) or old_id in used_ids:
            new_id = _next_school_logo_id(migrated_rows, entry_type)

        used_ids.add(new_id)

        source_path = _locate_school_logo_file(entry)
        ext = _school_logo_entry_ext(entry)
        if not ext and source_path and "." in os.path.basename(source_path):
            ext = os.path.basename(source_path).rsplit(".", 1)[1].lower()
        if ext and ext not in S.ALLOWED_EXTENSIONS:
            ext = ""

        new_file_name = f"{new_id}.{ext}" if ext else ""

        if source_path and new_file_name:
            dest_dir = _school_logo_dir(entry_type)
            dest_path = os.path.join(dest_dir, new_file_name)
            if os.path.normcase(os.path.normpath(source_path)) != os.path.normcase(os.path.normpath(dest_path)):
                if os.path.exists(dest_path):
                    try:
                        os.remove(dest_path)
                    except OSError:
                        pass
                os.replace(source_path, dest_path)
                changed = True

        if new_id != old_id or new_file_name != old_file_name:
            changed = True

        migrated_rows.append({
            S.SCHOOL_LOGO_ID_COL: new_id,
            S.INSTITUTION_TYPE_COL: entry_type,
            S.INSTITUTION_NAME_COL: _clean_text(entry.get(S.INSTITUTION_NAME_COL) or entry.get("name")),
            S.INSTITUTION_SECTION_COL: _clean_text(entry.get(S.INSTITUTION_SECTION_COL) or entry.get("section") or ""),
            "id": new_id,
            "type": entry_type,
            "name": _clean_text(entry.get(S.INSTITUTION_NAME_COL) or entry.get("name")),
            "section": _clean_text(entry.get(S.INSTITUTION_SECTION_COL) or entry.get("section") or ""),
            "logo_file_name": new_file_name,
        })

    if changed:
        S._scd_replace_rows_by_key(
            S.store,
            S.SCHOOL_LOGO_SHEET,
            _school_logo_rows_df(migrated_rows).replace({pd.NA: None}).to_dict(orient="records"),
            S.SCHOOL_LOGO_COLUMNS,
            [S.SCHOOL_LOGO_ID_COL],
            changed_by="admin",
        )
        S.db.save_excel_sheets(S.store)
    return changed


def _school_logo_rows_df(rows: list[dict] | None = None) -> pd.DataFrame:
    normalized_rows = _normalize_school_logo_entries(rows if rows is not None else [])
    return pd.DataFrame(normalized_rows, columns=S.SCHOOL_LOGO_COLUMNS)


def _school_logo_sheet_rows() -> list[dict]:
    df = S._scd_filter_active(S.store.get(S.SCHOOL_LOGO_SHEET, pd.DataFrame()).copy())
    if df.empty:
        return []
    for col in S.SCHOOL_LOGO_COLUMNS:
        if col not in df.columns:
            df[col] = None
    rows = df[S.SCHOOL_LOGO_COLUMNS].where(pd.notna(df[S.SCHOOL_LOGO_COLUMNS]), None).to_dict(orient="records")
    return _normalize_school_logo_entries(rows)


def _ensure_school_logo_sheet() -> bool:
    current_df = S._scd_filter_active(S.store.get(S.SCHOOL_LOGO_SHEET, pd.DataFrame()).copy())

    if current_df.empty and S.SCHOOL_LOGO_SHEET not in S.store:
        recovered_rows = _recover_school_logo_rows_from_files()
        S._scd_replace_rows_by_key(
            S.store,
            S.SCHOOL_LOGO_SHEET,
            _school_logo_rows_df(recovered_rows).replace({pd.NA: None}).to_dict(orient="records"),
            S.SCHOOL_LOGO_COLUMNS,
            [S.SCHOOL_LOGO_ID_COL],
            changed_by="admin",
        )
        S.db.save_excel_sheets(S.store)
        return True

    if current_df.empty:
        current_rows = []
    else:
        for col in S.SCHOOL_LOGO_COLUMNS:
            if col not in current_df.columns:
                current_df[col] = None
        current_rows = _normalize_school_logo_entries(
            current_df[S.SCHOOL_LOGO_COLUMNS].where(pd.notna(current_df[S.SCHOOL_LOGO_COLUMNS]), None).to_dict(orient="records")
        )

    if not current_rows:
        recovered_rows = _recover_school_logo_rows_from_files()
        if recovered_rows:
            S._scd_replace_rows_by_key(
                S.store,
                S.SCHOOL_LOGO_SHEET,
                _school_logo_rows_df(recovered_rows).replace({pd.NA: None}).to_dict(orient="records"),
                S.SCHOOL_LOGO_COLUMNS,
                [S.SCHOOL_LOGO_ID_COL],
                changed_by="admin",
            )
            S.db.save_excel_sheets(S.store)
            return True

    if current_rows != _normalize_school_logo_entries(current_rows):
        S._scd_replace_rows_by_key(
            S.store,
            S.SCHOOL_LOGO_SHEET,
            _school_logo_rows_df(current_rows).replace({pd.NA: None}).to_dict(orient="records"),
            S.SCHOOL_LOGO_COLUMNS,
            [S.SCHOOL_LOGO_ID_COL],
            changed_by="admin",
        )
        S.db.save_excel_sheets(S.store)
        return True

    if _migrate_school_logo_storage():
        return True

    return False


def _load_school_logos() -> dict:
    _ensure_school_logo_sheet()
    return {"entries": _school_logo_sheet_rows()}


def _save_school_logos(payload: dict, *, changed_by: str = "admin") -> None:
    entries = _normalize_school_logo_entries(payload.get("entries")) if isinstance(payload, dict) else []
    S._scd_replace_rows_by_key(
        S.store,
        S.SCHOOL_LOGO_SHEET,
        _school_logo_rows_df(entries).replace({pd.NA: None}).to_dict(orient="records"),
        S.SCHOOL_LOGO_COLUMNS,
        [S.SCHOOL_LOGO_ID_COL],
        changed_by=changed_by,
    )
    S.db.save_excel_sheets(S.store)
    _migrate_school_logo_storage()


def _school_logo_filename(entry_id: str) -> str | None:
    path = _school_logo_file_path(entry_id)
    return os.path.basename(path) if path else None


def _serialize_school_logo_entry(row: dict) -> dict:
    item = dict(row or {})
    eid = _clean_text(item.get(S.SCHOOL_LOGO_ID_COL) or item.get("id"))
    file_name = _school_logo_filename(eid) if eid else None
    item[S.SCHOOL_LOGO_ID_COL] = eid
    item["id"] = eid
    item["type"] = _clean_text(item.get(S.INSTITUTION_TYPE_COL) or item.get("type"))
    item["name"] = _clean_text(item.get(S.INSTITUTION_NAME_COL) or item.get("name"))
    item["section"] = _clean_text(item.get(S.INSTITUTION_SECTION_COL) or item.get("section"))
    item["logo_file_name"] = file_name or _clean_text(item.get("logo_file_name"))
    item["logo_url"] = f"/api/config/school-logos/{eid}/logo" if (eid and file_name) else None
    return item


def _save_config(config):
    defaults = _default_config()
    payload = _normalize_config_payload(config)

    for key, default_value in defaults.items():
        S.db.save_json_file(_config_fragment_path(key), payload.get(key, default_value))

    _save_person_titles_to_sheet(payload.get("person_titles", []))

    legacy_path = _legacy_config_path()
    if os.path.exists(legacy_path):
        try:
            os.remove(legacy_path)
        except OSError:
            pass

    return payload


def register_config_routes(app):
    @app.get("/api/config")
    def get_config():
        err = auth_exports["_require_auth"]()
        if err:
            return err
        return jsonify({"ok": True, "config": _load_config()})

    @app.get("/api/config/mottos/meta")
    def get_mottos_meta():
        err = auth_exports["_require_auth"]()
        if err:
            return err
        return jsonify({
            "ok": True,
            "scopes": {
                "jec_jordan": {
                    "id": "JEC_JORDAN",
                    "label": "JECJordan",
                },
                "youth_groups": _youth_group_scope_options(),
            },
            "bible_books_tree": CATHOLIC_BIBLE_BOOK_TREE,
        })

    @app.get("/api/config/mottos")
    def get_mottos():
        err = auth_exports["_require_auth"]()
        if err:
            return err
        return jsonify({"ok": True, "mottos": _list_mottos_serialized()})

    @app.get("/api/config/mottos/active")
    def get_active_mottos():
        err = auth_exports["_require_auth"]()
        if err:
            return err

        raw_group_ids = _clean_text(request.args.get("youth_group_ids"))
        include_jec_jordan = str(request.args.get("include_jec_jordan", "true")).strip().lower() not in ("0", "false", "no")

        group_ids = []
        if raw_group_ids:
            for token in [x.strip() for x in raw_group_ids.split(",") if x.strip()]:
                gid = S.youth_group_id(token)
                if not gid or gid == "GS":
                    continue
                if gid not in group_ids:
                    group_ids.append(gid)

        all_rows = _list_mottos_serialized()
        active_rows = [
            row for row in all_rows
            if _is_motto_active_now(row) and _is_motto_applicable_to_groups(row, group_ids, include_jec_jordan)
        ]
        return jsonify({"ok": True, "mottos": active_rows})

    @app.post("/api/config/mottos")
    def create_motto():
        err = auth_exports["_require_admin"]()
        if err:
            return err

        body = request.json or {}
        if not isinstance(body, dict):
            return jsonify({"error": "invalid payload"}), 400

        changed_by = _changed_by_from_current_user()

        with S.lock:
            payload = _load_mottos_payload()
            motto = _normalize_motto(body, touch_updated=True)

            if not motto.get("title"):
                return jsonify({"error": "motto title is required"}), 400
            if not _validate_motto_scope(motto.get("targets")):
                return jsonify({"error": "at least one target is required"}), 400
            period_ok, period_message = _validate_motto_period(motto)
            if not period_ok:
                return jsonify({"error": period_message}), 400
            ref_ok, ref_message = _validate_motto_single_reference(motto)
            if not ref_ok:
                return jsonify({"error": ref_message}), 400
            year_ok, year_message = _validate_motto_year(motto)
            if not year_ok:
                return jsonify({"error": year_message}), 400

            payload["mottos"].append(motto)
            saved = _save_mottos_payload(payload, changed_by=changed_by)

        created = next((row for row in saved.get("mottos", []) if row.get("motto_id") == motto.get("motto_id")), motto)
        return jsonify({"ok": True, "motto": _serialize_motto(created)})

    @app.put("/api/config/mottos/<motto_id>")
    def update_motto(motto_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        body = request.json or {}
        if not isinstance(body, dict):
            return jsonify({"error": "invalid payload"}), 400

        changed_by = _changed_by_from_current_user()

        with S.lock:
            payload = _load_mottos_payload()
            rows = payload.get("mottos", [])
            idx = next((i for i, row in enumerate(rows) if _clean_text(row.get("motto_id")) == _clean_text(motto_id)), -1)
            if idx < 0:
                return jsonify({"error": "motto not found"}), 404

            merged = dict(rows[idx])
            merged.update(body)
            merged["motto_id"] = rows[idx].get("motto_id")
            updated = _normalize_motto(merged, existing=rows[idx], touch_updated=True)

            if not updated.get("title"):
                return jsonify({"error": "motto title is required"}), 400
            if not _validate_motto_scope(updated.get("targets")):
                return jsonify({"error": "at least one target is required"}), 400
            period_ok, period_message = _validate_motto_period(updated)
            if not period_ok:
                return jsonify({"error": period_message}), 400
            ref_ok, ref_message = _validate_motto_single_reference(updated)
            if not ref_ok:
                return jsonify({"error": ref_message}), 400
            year_ok, year_message = _validate_motto_year(updated)
            if not year_ok:
                return jsonify({"error": year_message}), 400

            rows[idx] = updated
            payload["mottos"] = rows
            saved = _save_mottos_payload(payload, changed_by=changed_by)

        saved_row = next((row for row in saved.get("mottos", []) if row.get("motto_id") == rows[idx].get("motto_id")), rows[idx])
        return jsonify({"ok": True, "motto": _serialize_motto(saved_row)})

    @app.delete("/api/config/mottos/<motto_id>")
    def delete_motto(motto_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        changed_by = _changed_by_from_current_user()

        with S.lock:
            payload = _load_mottos_payload()
            rows = payload.get("mottos", [])
            filtered = [row for row in rows if _clean_text(row.get("motto_id")) != _clean_text(motto_id)]

            if len(filtered) == len(rows):
                return jsonify({"error": "motto not found"}), 404

            payload["mottos"] = filtered
            _save_mottos_payload(payload, changed_by=changed_by)

            for ext in S.ALLOWED_EXTENSIONS:
                logo_path = os.path.join(MOTTO_LOGOS_DIR, f"{motto_id}.{ext}")
                if os.path.exists(logo_path):
                    try:
                        os.remove(logo_path)
                    except OSError:
                        pass

        return jsonify({"ok": True})

    @app.post("/api/config/mottos/<motto_id>/logo")
    def upload_motto_logo(motto_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        file = request.files.get("logo")
        if not file or not file.filename:
            return jsonify({"error": "logo file is required"}), 400

        original_name = secure_filename(file.filename)
        if "." not in original_name:
            return jsonify({"error": "file extension is required"}), 400
        ext = original_name.rsplit(".", 1)[1].lower()
        if ext not in S.ALLOWED_EXTENSIONS:
            return jsonify({"error": "unsupported logo type"}), 400

        changed_by = _changed_by_from_current_user()

        with S.lock:
            payload = _load_mottos_payload()
            rows = payload.get("mottos", [])
            idx = next((i for i, row in enumerate(rows) if _clean_text(row.get("motto_id")) == _clean_text(motto_id)), -1)
            if idx < 0:
                return jsonify({"error": "motto not found"}), 404

            for existing_ext in S.ALLOWED_EXTENSIONS:
                existing = os.path.join(MOTTO_LOGOS_DIR, f"{motto_id}.{existing_ext}")
                if os.path.exists(existing):
                    try:
                        os.remove(existing)
                    except OSError:
                        pass

            file_name = f"{motto_id}.{ext}"
            file_path = os.path.join(MOTTO_LOGOS_DIR, file_name)
            file.save(file_path)

            updated = _normalize_motto({
                **rows[idx],
                "logo_file_name": file_name,
            }, existing=rows[idx], touch_updated=True)
            rows[idx] = updated
            payload["mottos"] = rows
            _save_mottos_payload(payload, changed_by=changed_by)

        return jsonify({
            "ok": True,
            "logo_url": _motto_logo_url(motto_id, file_name),
            "motto": _serialize_motto(updated),
        })

    @app.get("/api/config/mottos/<motto_id>/logo")
    def get_motto_logo(motto_id):
        err = auth_exports["_require_auth"]()
        if err:
            return err

        file_name = _motto_logo_filename(motto_id)
        if not file_name:
            return jsonify({"error": "logo not found"}), 404
        return send_from_directory(MOTTO_LOGOS_DIR, file_name)

    @app.put("/api/config")
    def put_config():
        err = auth_exports["_require_admin"]()
        if err:
            return err

        body = request.json or {}
        if not isinstance(body, dict):
            return jsonify({"error": "invalid payload"}), 400

        with S.lock:
            current = _load_config()
            merged = dict(current)
            if "active_jec_year" in body:
                merged["active_jec_year"] = _normalize_year_label(body.get("active_jec_year"))
            if "name_variations" in body:
                merged["name_variations"] = _normalize_name_variations(body.get("name_variations"))
            if "person_titles" in body:
                merged["person_titles"] = _normalize_person_titles(body.get("person_titles"))
            if "school_branches" in body:
                merged["school_branches"] = _normalize_school_branches(body.get("school_branches"))
            saved = _save_config(merged)
        return jsonify({"ok": True, "config": saved})

    @app.put("/api/config/reset")
    def reset_config():
        err = auth_exports["_require_admin"]()
        if err:
            return err
        with S.lock:
            saved = _save_config(_default_config())
        return jsonify({"ok": True, "config": saved})

    @app.get("/api/config/youth-groups")
    def list_config_youth_groups_placeholder():
        return jsonify({"groups": []})

    @app.post("/api/config/youth-groups")
    def create_config_youth_groups_placeholder():
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.put("/api/config/youth-groups/<gid>")
    def update_config_youth_groups_placeholder(gid):
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.delete("/api/config/youth-groups/<gid>")
    def delete_config_youth_groups_placeholder(gid):
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.delete("/api/config/maintenance/notifications")
    def clear_notifications_placeholder():
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.delete("/api/config/maintenance/promotions")
    def clear_promotions_placeholder():
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.post("/api/config/maintenance/reload")
    def reload_data_placeholder():
        return jsonify({"ok": True})

    # ── School / University Logo routes ──────────────────────────────────────

    @app.get("/api/config/school-logos")
    def list_school_logos():
        err = auth_exports["_require_auth"]()
        if err:
            return err
        payload = _load_school_logos()
        entries = [_serialize_school_logo_entry(e) for e in payload.get("entries", [])]
        return jsonify({"ok": True, "entries": entries})

    @app.post("/api/config/school-logos")
    def create_school_logo_entry():
        err = auth_exports["_require_admin"]()
        if err:
            return err
        body = request.json or {}
        if not isinstance(body, dict):
            return jsonify({"error": "invalid payload"}), 400

        entry_type = _clean_text(body.get("type"))
        name = _clean_text(body.get("name"))
        section = _clean_text(body.get("section") or "")

        if entry_type not in ("school", "university", "company"):
            return jsonify({"error": "type must be 'school', 'university', or 'company'"}), 400
        if not name:
            return jsonify({"error": "name is required"}), 400

        with S.lock:
            payload = _load_school_logos()
            entries = payload.get("entries", [])
            for e in entries:
                if (
                    _clean_text(e.get("type")) == entry_type
                    and _clean_text(e.get("name")) == name
                    and _clean_text(e.get("section") or "") == section
                ):
                    return jsonify({"error": "entry already exists"}), 409

            entry_id = _next_school_logo_id(entries, entry_type)
            entry = {
                "id": entry_id,
                "type": entry_type,
                "name": name,
                "section": section,
                "logo_file_name": "",
            }
            entries.append(entry)
            payload["entries"] = entries
            _save_school_logos(payload, changed_by=_changed_by_from_current_user())

        return jsonify({"ok": True, "entry": _serialize_school_logo_entry(entry)}), 201

    @app.delete("/api/config/school-logos/<entry_id>")
    def delete_school_logo_entry(entry_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        with S.lock:
            payload = _load_school_logos()
            entries = payload.get("entries", [])
            target_entry = next((e for e in entries if _clean_text(e.get("id")) == _clean_text(entry_id)), None)
            filtered = [e for e in entries if _clean_text(e.get("id")) != _clean_text(entry_id)]
            if len(filtered) == len(entries):
                return jsonify({"error": "entry not found"}), 404
            payload["entries"] = filtered
            _save_school_logos(payload, changed_by=_changed_by_from_current_user())

        if target_entry:
            logo_path = _locate_school_logo_file(target_entry)
            if logo_path and os.path.exists(logo_path):
                try:
                    os.remove(logo_path)
                except OSError:
                    pass

        return jsonify({"ok": True})

    @app.post("/api/config/school-logos/<entry_id>/logo")
    def upload_school_logo_file(entry_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        file = request.files.get("logo")
        if not file or not file.filename:
            return jsonify({"error": "logo file is required"}), 400

        original_name = secure_filename(file.filename)
        if "." not in original_name:
            return jsonify({"error": "file extension is required"}), 400
        ext = original_name.rsplit(".", 1)[1].lower()
        if ext not in S.ALLOWED_EXTENSIONS:
            return jsonify({"error": "unsupported logo type"}), 400

        with S.lock:
            payload = _load_school_logos()
            entries = payload.get("entries", [])
            idx = next(
                (i for i, e in enumerate(entries) if _clean_text(e.get("id")) == _clean_text(entry_id)),
                -1,
            )
            if idx < 0:
                return jsonify({"error": "entry not found"}), 404

            entry = entries[idx]
            entry_type = _clean_text(entry.get(S.INSTITUTION_TYPE_COL) or entry.get("type"))
            existing = _locate_school_logo_file(entry)
            if existing and os.path.exists(existing):
                try:
                    os.remove(existing)
                except OSError:
                    pass

            file_name = f"{entry_id}.{ext}"
            file.save(os.path.join(_school_logo_dir(entry_type), file_name))

            entries[idx] = {**entries[idx], "logo_file_name": file_name}
            payload["entries"] = entries
            _save_school_logos(payload, changed_by=_changed_by_from_current_user())

        return jsonify({"ok": True, "entry": _serialize_school_logo_entry(entries[idx])})

    @app.get("/api/config/school-logos/<entry_id>/logo")
    def get_school_logo_file(entry_id):
        err = auth_exports["_require_auth"]()
        if err:
            return err
        entry = _find_school_logo_entry(entry_id)
        file_path = _school_logo_file_path(entry_id, [entry] if entry else None)
        if not entry or not file_path:
            return jsonify({"error": "logo not found"}), 404
        return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path))
