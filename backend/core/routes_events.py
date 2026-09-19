import json
import os
import random
import threading
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from io import BytesIO

import pandas as pd
from openpyxl.styles import Alignment
from flask import jsonify, request, send_file, send_from_directory
from werkzeug.utils import secure_filename

from core import state as S
from core.routes_auth import exports as auth_exports

# ── Constants ─────────────────────────────────────────────────────────────────

EVENT_TYPES = ['مخيم', 'لقاء', 'نشاط', 'رحلة', 'لقاء تنشئة', 'دورة تدريبية', 'لقاء مشترك', 'اجتماع']

AGE_GROUPS_ALL = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']

SUPERVISOR_STATUSES = [
    'مقترح من اللجنة',
    'مقترح من الشبيبة',
    'مقترح من الأمانة العامة',
    'بانتظار موافقة مكتب الأمانة',
    'بانتظار موافقة المسؤول العام',
    'بانتظار موافقة مسؤول اللجنة',
    'بانتظار موافقة الشخص',
    'تمت الموافقة من الشخص',
    'تم الاعتذار من مكتب الأمانة',
    'تم الاعتذار من المسؤول العام',
    'تم الاعتذار من مسؤول اللجنة',
    'تم الاعتذار من الشخص',
]

PROPOSAL_STATUSES = {'مقترح من اللجنة', 'مقترح من الشبيبة', 'مقترح من الأمانة العامة'}

ARABIC_ORDINALS = {
    1: 'الأول', 2: 'الثاني', 3: 'الثالث', 4: 'الرابع', 5: 'الخامس',
    6: 'السادس', 7: 'السابع', 8: 'الثامن', 9: 'التاسع', 10: 'العاشر',
}

# Python weekday(): Mon=0 … Sun=6
ARABIC_DAY_NAMES = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد']

ALLOWED_IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}

REG_TYPES = {'members', 'supervisors', 'gs_committee', 'guests'}
REG_TYPE_ORDER = ('members', 'supervisors', 'gs_committee', 'guests')
FINAL_PERSON_APPROVED_STATUS = 'تمت الموافقة من الشخص'
ATTENDANCE_STATUSES = {'registered', 'attended', 'apologized'}
ATTENDANCE_DEFAULT_STATUS = 'registered'
ATTENDANCE_APOLOGIZED_STATUS = 'apologized'
ATTENDANCE_STATUS_LABELS = {
    'registered': 'مسجّل',
    'attended': 'حضر',
    'apologized': 'اعتذر',
}

# Admin-defined extra registration fields. A field is declared once on a
# registration category (members / supervisors / …) and then applies to every
# entry in that category, including the XLSX export.
CUSTOM_FIELD_TYPES = ('text', 'textarea', 'number', 'date', 'select', 'checkbox')
CUSTOM_FIELD_LABEL_MAX = 60
CUSTOM_FIELD_CHECKBOX_TRUE = 'نعم'

MEMBER_EXPORT_COLUMNS = [
    'الاسم الكامل بالعربية',
    'حالة الملف الشخصي',
    'حالة التسجيل',
    'حالة الحضور',
    'تاريخ الاعتذار عن الحضور',
    'سبب الاعتذار عن الحضور',
    'الجنس',
    'تاريخ الميلاد الكامل',
    'الصف الحالي',
    'التعليم الجامعي',
    'الوظيفة الحالية',
    'رقم الهاتف',
    'الشبيبة',
    'رقم الغرفة',
    'الفريق',
    'اسم الأم الكامل بالعربية',
    'الحالات الصحية',
    'ملاحظات الملف الشخصي',
    'ملاحظات التسجيل',
]

SUPERVISOR_EXPORT_COLUMNS = [
    'الاسم الكامل بالعربية',
    'حالة الملف الشخصي',
    'حالة التسجيل في النشاط',
    'حالة الحضور',
    'تاريخ الاعتذار عن الحضور',
    'سبب الاعتذار عن الحضور',
    'الجنس',
    'تاريخ الميلاد الكامل',
    'الفئة العمريّة',
    'الشبيبة',
    'رقم الغرفة',
    'الفريق',
    'دور المسؤول في الفريق',
    'الصف الحالي',
    'التعليم الجامعي',
    'الوظيفة الحالية',
    'رقم الهاتف',
    'الحالات الصحية',
    'ملاحظات الملف الشخصي',
    'ملاحظات التسجيل',
]

GS_COMMITTEE_EXPORT_COLUMNS = [
    'الاسم الكامل بالعربية',
    'حالة الملف الشخصي',
    'حالة التسجيل في النشاط',
    'حالة الحضور',
    'تاريخ الاعتذار عن الحضور',
    'سبب الاعتذار عن الحضور',
    'الجنس',
    'تاريخ الميلاد الكامل',
    'الدور في النشاط',
    'الأفواج / الهياكل',
    'رقم الغرفة',
    'التعليم الجامعي',
    'الوظيفة الحالية',
    'رقم الهاتف',
    'الحالات الصحية',
    'ملاحظات الملف الشخصي',
    'ملاحظات التسجيل',
]

MOBILE_TYPE_LABELS = {
    'personal': 'الهاتف الشخصي',
    'work': 'هاتف العمل',
    'home': 'هاتف المنزل',
    'family': 'رقم هاتف فرد من العائلة',
}

PROFILE_STATUS_LABELS = {
    'registered': 'مسجّل',
    'unregistered': 'غير مسجّل',
}

SCHOOL_GRADE_ORDER = [
    'الروضة الصغرى (KG1)',
    'الروضة الكبرى (KG2)',
    'الصف الأول',
    'الصف الثاني',
    'الصف الثالث',
    'الصف الرابع',
    'الصف الخامس',
    'الصف السادس',
    'الصف السابع',
    'الصف الثامن',
    'الصف التاسع',
    'الصف العاشر',
    'الصف الحادي عشر (الأول ثانوي)',
    'الصف الثاني عشر (التوجيهي)',
]

# ── File paths ────────────────────────────────────────────────────────────────

_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_EVENTS_FILE            = os.path.join(_BASE_DIR, 'data', 'events.json')
_PRESETS_FILE           = os.path.join(_BASE_DIR, 'data', 'event_title_presets.json')
_SCHEDULE_PRESETS_FILE  = os.path.join(_BASE_DIR, 'data', 'event_schedule_presets.json')
_IMAGES_DIR    = os.path.join(S.PHOTOS_ROOT_DIR, 'events')
_LOGOS_DIR     = os.path.join(_IMAGES_DIR, 'logos')
_POSTERS_DIR   = os.path.join(_IMAGES_DIR, 'posters')
_DOCS_DIR      = os.path.join(_IMAGES_DIR, 'documents')

os.makedirs(_LOGOS_DIR, exist_ok=True)
os.makedirs(_POSTERS_DIR, exist_ok=True)
os.makedirs(_DOCS_DIR, exist_ok=True)

ALLOWED_DOC_EXT = {'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.odt', '.ods', '.odp'}

_LOCK = threading.Lock()

# ── Storage helpers ───────────────────────────────────────────────────────────

def _load_events():
    if not os.path.exists(_EVENTS_FILE):
        return {'events': []}
    try:
        with open(_EVENTS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {'events': []}
        if not isinstance(data.get('events'), list):
            data['events'] = []
        return data
    except Exception:
        return {'events': []}


def _save_events(data):
    os.makedirs(os.path.dirname(_EVENTS_FILE), exist_ok=True)
    with open(_EVENTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _load_presets():
    if not os.path.exists(_PRESETS_FILE):
        return {'gs': [], 'yg': {}}
    try:
        with open(_PRESETS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {'gs': [], 'yg': {}}
        if not isinstance(data.get('gs'), list):
            data['gs'] = []
        if not isinstance(data.get('yg'), dict):
            data['yg'] = {}
        return data
    except Exception:
        return {'gs': [], 'yg': {}}


def _save_presets(data):
    os.makedirs(os.path.dirname(_PRESETS_FILE), exist_ok=True)
    with open(_PRESETS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _load_schedule_presets():
    if not os.path.exists(_SCHEDULE_PRESETS_FILE):
        return {'presets': []}
    try:
        with open(_SCHEDULE_PRESETS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {'presets': []}
        if not isinstance(data.get('presets'), list):
            data['presets'] = []
        return data
    except Exception:
        return {'presets': []}


def _save_schedule_presets(data):
    os.makedirs(os.path.dirname(_SCHEDULE_PRESETS_FILE), exist_ok=True)
    with open(_SCHEDULE_PRESETS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── ID generators ─────────────────────────────────────────────────────────────

def _gen_id(prefix, existing_ids, width=6):
    nums = set()
    for eid in existing_ids:
        s = str(eid or '')
        if s.startswith(prefix) and s[len(prefix):].isdigit():
            nums.add(int(s[len(prefix):]))
    n = max(nums, default=0) + 1
    return f'{prefix}{n:0{width}d}'


# ── Utility ───────────────────────────────────────────────────────────────────

def _compute_nights(start_str, end_str):
    if not start_str or not end_str:
        return []
    try:
        start_dt = datetime.fromisoformat(str(start_str))
        end_dt   = datetime.fromisoformat(str(end_str))
    except (TypeError, ValueError):
        return []
    start_d = start_dt.date()
    end_d   = end_dt.date()
    if end_d <= start_d:
        return []
    nights = []
    d = start_d
    while d < end_d:
        name1 = ARABIC_DAY_NAMES[d.weekday()]
        name2 = ARABIC_DAY_NAMES[(d + timedelta(days=1)).weekday()]
        nights.append(f'ليلة {name1} - {name2}')
        d += timedelta(days=1)
    return nights


def _age_group_label(age_groups):
    if not age_groups:
        return ''
    if len(age_groups) == 1:
        return f'فئة {age_groups[0]}'
    if len(age_groups) == 2:
        return f'فئتيّ {age_groups[0]} و{age_groups[1]}'
    parts = ' و'.join(age_groups)
    return f'فئات {parts}'


def _compute_base_title(event_type, title_label):
    et = str(event_type or '').strip()
    tl = str(title_label or '').strip()
    if tl:
        return f'{et} {tl}'
    return et


def _is_attendance_visible(reg_type, entry):
    if reg_type in ('members', 'guests'):
        return True
    if reg_type in ('supervisors', 'gs_committee'):
        return str(entry.get('status') or '').strip() == FINAL_PERSON_APPROVED_STATUS
    return False


def _normalize_attendance_status(value):
    val = str(value or '').strip()
    return val if val in ATTENDANCE_STATUSES else None


def _is_attendance_apologized(entry):
    return _normalize_attendance_status(entry.get('attendance_status')) == ATTENDANCE_APOLOGIZED_STATUS


def _ensure_attendance_fields(reg_type, entry):
    changed = False
    visible = _is_attendance_visible(reg_type, entry)
    status = _normalize_attendance_status(entry.get('attendance_status'))
    if status is None and visible:
        status = ATTENDANCE_DEFAULT_STATUS

    if 'attendance_status' not in entry or entry.get('attendance_status') != status:
        entry['attendance_status'] = status
        changed = True

    for field in ('apology_date', 'apology_reason'):
        cleaned = str(entry.get(field) or '').strip()
        if field not in entry or entry.get(field) != cleaned:
            entry[field] = cleaned
            changed = True

    if status != ATTENDANCE_APOLOGIZED_STATUS:
        for field in ('apology_date', 'apology_reason'):
            if entry.get(field):
                entry[field] = ''
                changed = True

    return changed


def _normalize_registration_attendance(evt):
    changed = False
    registration = evt.setdefault('registration', {})
    for reg_type in REG_TYPE_ORDER:
        entries = registration.setdefault(reg_type, [])
        if not isinstance(entries, list):
            registration[reg_type] = []
            changed = True
            continue
        for entry in entries:
            if isinstance(entry, dict):
                changed = _ensure_attendance_fields(reg_type, entry) or changed
    return changed


def _apply_attendance_payload(reg_type, entry, body):
    if not any(field in body for field in ('attendance_status', 'apology_date', 'apology_reason')):
        return None

    _ensure_attendance_fields(reg_type, entry)

    if 'attendance_status' in body:
        status = str(body.get('attendance_status') or '').strip()
        if status not in ATTENDANCE_STATUSES:
            return 'invalid attendance_status'
        entry['attendance_status'] = status

    if 'apology_date' in body:
        entry['apology_date'] = str(body.get('apology_date') or '').strip()
    if 'apology_reason' in body:
        entry['apology_reason'] = str(body.get('apology_reason') or '').strip()

    _ensure_attendance_fields(reg_type, entry)
    return None


# ── Custom registration fields ────────────────────────────────────────────────

def _ensure_registration_fields(evt):
    """Guarantee evt['registration_fields'] holds one list per registration type."""
    changed = False
    fields = evt.get('registration_fields')
    if not isinstance(fields, dict):
        fields = {}
        changed = True
    for reg_type in REG_TYPE_ORDER:
        if not isinstance(fields.get(reg_type), list):
            fields[reg_type] = []
            changed = True
    for key in [k for k in fields if k not in REG_TYPE_ORDER]:
        fields.pop(key)
        changed = True
    evt['registration_fields'] = fields
    return changed


def _registration_fields(evt, reg_type):
    _ensure_registration_fields(evt)
    return evt['registration_fields'].get(reg_type, [])


def _normalize_custom_field_options(raw):
    options = []
    for opt in (raw or []):
        text = str(opt if opt is not None else '').strip()
        if text and text not in options:
            options.append(text)
    return options


def _validate_custom_field_payload(body, existing=None):
    """Build a field definition from a request body. Returns (field, error)."""
    base = dict(existing or {})
    label = str(body.get('label', base.get('label', '')) or '').strip()
    if not label:
        return None, 'اسم الحقل مطلوب'
    if len(label) > CUSTOM_FIELD_LABEL_MAX:
        return None, f'اسم الحقل يجب ألا يتجاوز {CUSTOM_FIELD_LABEL_MAX} حرفاً'

    ftype = str(body.get('type', base.get('type', 'text')) or 'text').strip()
    if ftype not in CUSTOM_FIELD_TYPES:
        return None, 'نوع الحقل غير صالح'

    options = _normalize_custom_field_options(
        body['options'] if 'options' in body else base.get('options')
    )
    if ftype == 'select' and not options:
        return None, 'حقل الاختيار من قائمة يحتاج خياراً واحداً على الأقل'
    if ftype != 'select':
        options = []

    base.update({'label': label, 'type': ftype, 'options': options})
    return base, None


def _normalize_custom_field_value(field, raw):
    """Coerce a submitted value to the field's type. Returns (value, error)."""
    ftype = field.get('type')
    label = field.get('label') or field.get('id')

    if ftype == 'checkbox':
        if isinstance(raw, str):
            return raw.strip().lower() in ('true', '1', 'yes', 'on', CUSTOM_FIELD_CHECKBOX_TRUE), None
        return bool(raw), None

    if ftype == 'number':
        if raw is None or str(raw).strip() == '':
            return '', None
        try:
            num = float(str(raw).strip())
        except (TypeError, ValueError):
            return None, f'قيمة الحقل "{label}" يجب أن تكون رقماً'
        return int(num) if num.is_integer() else num, None

    value = str(raw if raw is not None else '').strip()
    if ftype == 'select' and value and value not in (field.get('options') or []):
        return None, f'قيمة غير صالحة للحقل "{label}"'
    return value, None


def _ensure_entry_custom_fields(evt, reg_type, entry):
    """Make sure entry['custom_fields'] exists and holds no values for deleted fields."""
    valid_ids = {str(f.get('id')) for f in _registration_fields(evt, reg_type)}
    values = entry.get('custom_fields')
    if not isinstance(values, dict):
        values = {}
    cleaned = {k: v for k, v in values.items() if str(k) in valid_ids}
    changed = cleaned != entry.get('custom_fields')
    entry['custom_fields'] = cleaned
    return changed


def _normalize_registration_custom_fields(evt):
    changed = _ensure_registration_fields(evt)
    registration = evt.setdefault('registration', {})
    for reg_type in REG_TYPE_ORDER:
        for entry in registration.get(reg_type, []) or []:
            if isinstance(entry, dict):
                changed = _ensure_entry_custom_fields(evt, reg_type, entry) or changed
    return changed


def _apply_custom_fields_payload(evt, reg_type, entry, body):
    """Merge body['custom_fields'] into the entry. Returns an error string or None."""
    _ensure_entry_custom_fields(evt, reg_type, entry)
    if 'custom_fields' not in body:
        return None
    incoming = body.get('custom_fields')
    if incoming is None:
        return None
    if not isinstance(incoming, dict):
        return 'custom_fields must be an object'

    by_id = {str(f.get('id')): f for f in _registration_fields(evt, reg_type)}
    for field_id, raw in incoming.items():
        field = by_id.get(str(field_id))
        if not field:
            continue  # unknown / stale field id — ignore rather than fail the save
        value, error = _normalize_custom_field_value(field, raw)
        if error:
            return error
        entry['custom_fields'][str(field_id)] = value
    return None


def _custom_field_export_value(field, value):
    if field.get('type') == 'checkbox':
        return CUSTOM_FIELD_CHECKBOX_TRUE if value else ''
    return _export_text(value, preserve_newlines=(field.get('type') == 'textarea'))


def _custom_export_columns(evt, reg_type, base_columns):
    """Return (all_columns, [(header, field), …]) with headers unique across the sheet."""
    columns = list(base_columns)
    pairs = []
    for field in _registration_fields(evt, reg_type):
        base_header = str(field.get('label') or '').strip() or str(field.get('id') or '')
        header, suffix = base_header, 2
        while header in columns:
            header = f'{base_header} ({suffix})'
            suffix += 1
        columns.append(header)
        pairs.append((header, field))
    return columns, pairs


def _custom_field_row_values(entry, custom_pairs):
    values = entry.get('custom_fields')
    values = values if isinstance(values, dict) else {}
    return {
        header: _custom_field_export_value(field, values.get(str(field.get('id'))))
        for header, field in custom_pairs
    }


def _enrich_with_display_names(events):
    groups = defaultdict(list)
    for evt in events:
        key = (str(evt.get('jec_year', '') or ''), str(evt.get('base_title', '') or ''))
        groups[key].append(evt)

    for group in groups.values():
        if len(group) == 1:
            group[0]['display_name'] = group[0].get('base_title', '')
            group[0]['ordinal'] = None
        else:
            sorted_group = sorted(group, key=lambda e: str(e.get('created_at', '') or ''))
            for i, evt in enumerate(sorted_group, 1):
                ordinal_str = ARABIC_ORDINALS.get(i, str(i))
                evt['display_name'] = f"{evt.get('base_title', '')} {ordinal_str}"
                evt['ordinal'] = i

    return events


def _active_flag_filter(df):
    flag = 'scd_currently_active_flag'
    if flag in df.columns:
        df = df[df[flag].str.strip().str.lower().map(lambda v: v not in ('false', '0', 'no', 'n', 'f'))]
    return df


def _person_full_name(person_id):
    """Return the full Arabic name for a person_id from the registered store, or None."""
    try:
        persons = S.merge_person_titles(S._scd_filter_active(S.store.get('persons', pd.DataFrame())))
        if persons.empty:
            return None
        row = persons[persons['person_id'].astype(str).str.strip() == str(person_id).strip()]
        if row.empty:
            return None
        r = row.iloc[0]
        parts = [str(r.get(k) or '').strip() for k in ('title', 'ar_first_name', 'ar_second_name', 'ar_third_name', 'ar_last_name')]
        name = ' '.join(p for p in parts if p)
        return name or None
    except Exception:
        return None


def _lookup_person_name_unreg(person_id):
    """Return (name, is_unregistered) for a person_id, checking registered store first."""
    if not person_id:
        return None, False
    pid_str = str(person_id).strip()
    try:
        persons = S.merge_person_titles(S._scd_filter_active(S.store.get('persons', pd.DataFrame())))
        if not persons.empty:
            row = persons[persons['person_id'].astype(str).str.strip() == pid_str]
            if not row.empty:
                r = row.iloc[0]
                parts = [str(r.get(k) or '').strip() for k in ('title', 'ar_first_name', 'ar_second_name', 'ar_third_name', 'ar_last_name')]
                name = ' '.join(p for p in parts if p)
                is_registered = S._bool_registered(r.get('registered')) if 'registered' in row.columns else True
                return name or None, not is_registered
    except Exception:
        pass
    try:
        unreg = S._scd_filter_active(S.unreg_store.get('persons', pd.DataFrame()))
        if not unreg.empty:
            row = unreg[unreg['person_id'].astype(str).str.strip() == pid_str]
            if not row.empty:
                r = row.iloc[0]
                parts = [str(r.get(k) or '').strip() for k in ('ar_first_name', 'ar_second_name', 'ar_third_name', 'ar_last_name')]
                name = ' '.join(p for p in parts if p)
                return name or None, True
    except Exception:
        pass
    return None, False


def _lookup_yg_label(yg_id):
    """Return display label for a youth group ID."""
    if not yg_id:
        return None
    try:
        return S.youth_group_display_label(str(yg_id).strip()) or None
    except Exception:
        return None


def _lookup_age_group(person_id, yg_id):
    """Return current age group for a person in the given YG, from membership history."""
    if not person_id or not yg_id:
        return None
    try:
        pid_str = str(person_id).strip()
        yg_str  = str(yg_id).strip()
        id_col  = 'person_youth_group_record_id'
        for source in (S.store, S.unreg_store):
            pyg = S._scd_filter_active(source.get('person_youth_group', pd.DataFrame()))
            if pyg.empty or not {'person_id', 'youth_group_id', id_col}.issubset(pyg.columns):
                continue
            rows = pyg[
                (pyg['person_id'].astype(str).str.strip() == pid_str) &
                (pyg['youth_group_id'].astype(str).str.strip() == yg_str)
            ]
            if rows.empty:
                continue
            record_ids = set(rows[id_col].astype(str).str.strip())
            age_hist = source.get('person_youth_group_age_history', pd.DataFrame())
            if age_hist.empty or id_col not in age_hist.columns:
                continue
            hist_rows = age_hist[age_hist[id_col].astype(str).str.strip().isin(record_ids)]
            if hist_rows.empty:
                continue
            ag = S.current_age_group_from_history_rows(hist_rows.to_dict('records'))
            if ag:
                return ag
        return None
    except Exception:
        return None


def _load_org_tree_dfs():
    """Load and filter the three org-tree CSVs. Returns (periods_df, nodes_df, edges_df, GS_GROUP_ID)."""
    try:
        from core.routes_org_tree import (
            ORG_TREE_PERIODS_CSV, ORG_TREE_NODES_CSV,
            ORG_TREE_EDGES_CSV, GS_GROUP_ID
        )
        p = pd.read_csv(ORG_TREE_PERIODS_CSV, dtype=str, encoding='utf-8-sig', keep_default_na=False) if os.path.exists(ORG_TREE_PERIODS_CSV) else pd.DataFrame()
        n = pd.read_csv(ORG_TREE_NODES_CSV,   dtype=str, encoding='utf-8-sig', keep_default_na=False) if os.path.exists(ORG_TREE_NODES_CSV)   else pd.DataFrame()
        e = pd.read_csv(ORG_TREE_EDGES_CSV,   dtype=str, encoding='utf-8-sig', keep_default_na=False) if os.path.exists(ORG_TREE_EDGES_CSV)   else pd.DataFrame()
        if not p.empty: p = _active_flag_filter(p)
        if not n.empty: n = _active_flag_filter(n)
        if not e.empty:
            e = _active_flag_filter(e)
            if 'edge_type' in e.columns:
                e = e[e['edge_type'].str.strip() == 'hierarchy']
        return p, n, e, GS_GROUP_ID
    except Exception:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), 'GS'


def _compute_person_reg_context(person_id, periods_df, nodes_df, edges_df, GS_GROUP_ID):
    """Core computation given pre-loaded DataFrames (no CSV I/O)."""
    result = {
        'is_in_gs_tree': False,
        'gs_role': None,
        'gs_tree_superior_name': None,
        'yg_masoul_aam_name': None,
        'skip_masoul_step': False,
    }
    if not person_id:
        return result

    pid_str = str(person_id).strip()

    # ── GS tree lookup ────────────────────────────────────────────────────
    if not periods_df.empty and not nodes_df.empty:
        gs_periods = periods_df[periods_df['group_id'].str.strip() == GS_GROUP_ID].copy()

        if not gs_periods.empty:
            # Sort periods most-recent first so we use the latest period the person appears in.
            # This prevents stale/old periods (whose flag was never set to False) from polluting
            # the role with historical positions.
            sort_col = 'from_date' if 'from_date' in gs_periods.columns else 'period_id'
            gs_periods = gs_periods.sort_values(sort_col, ascending=False, na_position='last')

            gs_nodes = pd.DataFrame()
            active_period_id = None
            for _, period_row in gs_periods.iterrows():
                _pid = str(period_row['period_id']).strip()
                candidate = nodes_df[
                    (nodes_df['period_id'].str.strip() == _pid) &
                    (nodes_df['person_id'].str.strip() == pid_str)
                ]
                if not candidate.empty:
                    active_period_id = _pid
                    gs_nodes = candidate
                    break

            if not gs_nodes.empty:
                result['is_in_gs_tree'] = True
                # Deduplicate roles while preserving order
                seen = set()
                roles = []
                for r in gs_nodes['role'].str.strip().tolist():
                    if r and r not in seen:
                        seen.add(r)
                        roles.append(r)
                result['gs_role'] = ', '.join(roles) if roles else None

                # Find direct superior using only the same period's edges
                my_node_ids = set(gs_nodes['node_id'].str.strip())
                if not edges_df.empty and 'period_id' in edges_df.columns and active_period_id:
                    gs_edges = edges_df[edges_df['period_id'].str.strip() == active_period_id]
                    parent_edges = gs_edges[gs_edges['to_node_id'].str.strip().isin(my_node_ids)]
                    if not parent_edges.empty:
                        parent_node_id = parent_edges.iloc[0]['from_node_id'].strip()
                        parent_node = nodes_df[
                            (nodes_df['period_id'].str.strip() == active_period_id) &
                            (nodes_df['node_id'].str.strip() == parent_node_id)
                        ]
                        if not parent_node.empty:
                            sup_pid = parent_node.iloc[0].get('person_id', '').strip()
                            if sup_pid:
                                result['gs_tree_superior_name'] = _person_full_name(sup_pid)
                                result['skip_masoul_step'] = (pid_str == sup_pid)

    # ── YG مسؤول عام lookup (only if not in GS tree) ─────────────────────
    if not result['is_in_gs_tree'] and not periods_df.empty and not nodes_df.empty:
        # Get person's active youth group memberships
        try:
            pyg = S._scd_filter_active(S.store.get('person_youth_group', pd.DataFrame()))
            # Filter out archived memberships (person left the YG) — archived column is truthy string/bool
            if not pyg.empty and 'archived' in pyg.columns:
                archived_mask = pyg['archived'].astype(str).str.strip().str.lower().isin({'true', '1', 'yes', 'y', 't'})
                pyg = pyg[~archived_mask]
            if not pyg.empty and 'person_id' in pyg.columns and 'youth_group_id' in pyg.columns:
                person_ygs = pyg[pyg['person_id'].astype(str).str.strip() == pid_str]
                yg_ids = [str(g).strip() for g in person_ygs['youth_group_id'].dropna().unique() if str(g).strip() and str(g).strip() != GS_GROUP_ID]

                # Fall back to unreg_store when no registered memberships found
                if not yg_ids:
                    unreg_pyg = S._scd_filter_active(S.unreg_store.get('person_youth_group', pd.DataFrame()))
                    if not unreg_pyg.empty and 'archived' in unreg_pyg.columns:
                        unreg_archived_mask = unreg_pyg['archived'].astype(str).str.strip().str.lower().isin({'true', '1', 'yes', 'y', 't'})
                        unreg_pyg = unreg_pyg[~unreg_archived_mask]
                    if not unreg_pyg.empty and 'person_id' in unreg_pyg.columns and 'youth_group_id' in unreg_pyg.columns:
                        person_ygs = unreg_pyg[unreg_pyg['person_id'].astype(str).str.strip() == pid_str]
                        yg_ids = [str(g).strip() for g in person_ygs['youth_group_id'].dropna().unique() if str(g).strip() and str(g).strip() != GS_GROUP_ID]

                for yg_id in yg_ids:
                    yg_periods = periods_df[periods_df['group_id'].str.strip() == yg_id]
                    if yg_periods.empty:
                        continue
                    yg_period_ids = set(yg_periods['period_id'].str.strip())

                    yg_nodes = nodes_df[nodes_df['period_id'].str.strip().isin(yg_period_ids)]
                    if yg_nodes.empty:
                        continue

                    # Root nodes = nodes that are not a child (to_node_id) of any hierarchy edge.
                    # المرشد الروحي is connected via a 'peer' edge (filtered out) so it also
                    # appears as a root node. Among roots, prefer the node explicitly
                    # labelled المسؤول العام; fall back to first root only if no such role exists.
                    if not edges_df.empty and 'period_id' in edges_df.columns:
                        yg_edges = edges_df[edges_df['period_id'].str.strip().isin(yg_period_ids)]
                        child_node_ids = set(yg_edges['to_node_id'].str.strip())
                        root_nodes = yg_nodes[~yg_nodes['node_id'].str.strip().isin(child_node_ids)]
                    else:
                        root_nodes = yg_nodes

                    candidate_nodes = pd.DataFrame()
                    if 'role' in root_nodes.columns and not root_nodes.empty:
                        candidate_nodes = root_nodes[
                            root_nodes['role'].str.strip() == 'المسؤول العام'
                        ]
                    if candidate_nodes.empty:
                        candidate_nodes = root_nodes

                    if not candidate_nodes.empty:
                        root_pid = candidate_nodes.iloc[0].get('person_id', '').strip()
                        if root_pid:
                            result['yg_masoul_aam_name'] = _person_full_name(root_pid)
                            result['skip_masoul_step'] = (pid_str == root_pid)
                            break
        except Exception:
            pass

    return result


def _get_person_reg_context(person_id):
    """Load org-tree CSVs and compute registration context for a single person."""
    periods_df, nodes_df, edges_df, gs_group_id = _load_org_tree_dfs()
    return _compute_person_reg_context(person_id, periods_df, nodes_df, edges_df, gs_group_id)


def _enrich_all_registrations(evt):
    """
    Compute and attach all derived fields to every registration entry.
    These fields are NOT stored in the JSON — they are computed fresh on each GET.
    """
    try:
        periods_df, nodes_df, edges_df, gs_group_id = _load_org_tree_dfs()
        name_cache     = {}
        gender_cache   = {}
        birthday_cache = {}
        for reg_type in REG_TYPES:
            for entry in evt.get('registration', {}).get(reg_type, []):
                pid = str(entry.get('person_id') or '').strip()

                if pid:
                    if pid not in name_cache:
                        name_cache[pid] = _lookup_person_name_unreg(pid)
                    name, is_unreg = name_cache[pid]
                    entry['name']            = name
                    entry['is_unregistered'] = is_unreg

                    if pid not in gender_cache:
                        gender_cache[pid] = _lookup_person_gender(pid)
                    entry['gender'] = gender_cache[pid]

                    if pid not in birthday_cache:
                        birthday_cache[pid] = _lookup_person_birthday(pid)
                    bd = birthday_cache[pid]
                    entry['birth_day']   = bd['birth_day']
                    entry['birth_month'] = bd['birth_month']
                    entry['birth_year']  = bd['birth_year']
                else:
                    entry['name']            = None
                    entry['is_unregistered'] = True
                    entry['gender']          = None
                    entry['birth_day']       = None
                    entry['birth_month']     = None
                    entry['birth_year']      = None

                if reg_type in ('members', 'supervisors'):
                    yg_id = str(entry.get('youth_group_id') or '').strip() or None
                    entry['youth_group_label'] = _lookup_yg_label(yg_id) if yg_id else None
                    entry['age_group']         = _lookup_age_group(pid, yg_id) if pid and yg_id else None

                if reg_type in ('supervisors', 'gs_committee') and pid:
                    ctx = _compute_person_reg_context(pid, periods_df, nodes_df, edges_df, gs_group_id)
                    entry['is_in_gs_tree']        = ctx['is_in_gs_tree']
                    entry['gs_tree_superior_name'] = ctx['gs_tree_superior_name']
                    entry['yg_masoul_aam_name']    = ctx['yg_masoul_aam_name']
                    if reg_type == 'gs_committee':
                        entry['gs_role'] = ctx['gs_role']
                    # skip_masoul_step is stored at creation; only fall back to computed value for legacy entries
                    if 'skip_masoul_step' not in entry:
                        yg_proposed = str(entry.get('status') or '').strip() == 'مقترح من الشبيبة'
                        entry['skip_masoul_step'] = yg_proposed or bool(ctx['skip_masoul_step'])

        for apology in evt.get('yg_apologies', []):
            yg_id = str(apology.get('youth_group_id') or '').strip()
            apology['youth_group_label'] = _lookup_yg_label(yg_id) if yg_id else None
    except Exception:
        pass


def _lookup_person_gender(person_id):
    """Return gender string ('ذكر'/'أنثى'/None) for a person_id, checking both stores."""
    if not person_id:
        return None
    pid_str = str(person_id).strip()
    try:
        persons = S._scd_filter_active(S.store.get('persons', pd.DataFrame()))
        if not persons.empty and 'person_id' in persons.columns:
            row = persons[persons['person_id'].astype(str).str.strip() == pid_str]
            if not row.empty:
                val = str(row.iloc[0].get('gender') or '').strip()
                return val or None
    except Exception:
        pass
    try:
        unreg = S._scd_filter_active(S.unreg_store.get('persons', pd.DataFrame()))
        if not unreg.empty and 'person_id' in unreg.columns:
            row = unreg[unreg['person_id'].astype(str).str.strip() == pid_str]
            if not row.empty:
                val = str(row.iloc[0].get('gender') or '').strip()
                return val or None
    except Exception:
        pass
    return None


def _lookup_person_birthday(person_id):
    """Return {'birth_day', 'birth_month', 'birth_year'} (ints or None) for a
    person_id, checking the registered store then the unregistered store."""
    empty = {'birth_day': None, 'birth_month': None, 'birth_year': None}
    if not person_id:
        return dict(empty)
    pid_str = str(person_id).strip()

    def _int(v):
        try:
            if v is None or pd.isna(v):
                return None
            return int(float(v))
        except (TypeError, ValueError):
            return None

    for store in (S.store, S.unreg_store):
        try:
            persons = S._scd_filter_active(store.get('persons', pd.DataFrame()))
            if persons.empty or 'person_id' not in persons.columns:
                continue
            row = persons[persons['person_id'].astype(str).str.strip() == pid_str]
            if row.empty:
                continue
            r = row.iloc[0]
            res = {
                'birth_day':   _int(r.get('birth_day')),
                'birth_month': _int(r.get('birth_month')),
                'birth_year':  _int(r.get('birth_year')),
            }
            if res['birth_day'] and res['birth_month']:
                return res
        except Exception:
            pass
    return dict(empty)


def _export_text(value, preserve_newlines=False):
    if value is None or value is pd.NA:
        return ''
    try:
        if pd.isna(value):
            return ''
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    if text.lower() in ('nan', 'none', 'null'):
        return ''
    if preserve_newlines:
        return '\n'.join(' '.join(line.split()) for line in text.splitlines())
    return ' '.join(text.split())


def _person_key(value):
    normalized = S._normalize_person_id(value)
    if normalized in (None, ''):
        return ''
    return str(normalized).strip()


def _rows_for_person(source_store, sheet_name, person_id):
    df = S._scd_filter_active(source_store.get(sheet_name, pd.DataFrame()))
    key = _person_key(person_id)
    if df.empty or 'person_id' not in df.columns or not key:
        return []
    rows = df[df['person_id'].map(_person_key) == key]
    if rows.empty:
        return []
    return S.df_to_json(rows)


def _person_profile_from_store(source_store, person_id):
    rows = _rows_for_person(source_store, 'persons', person_id)
    if not rows:
        return None
    return S.normalize_person_birth_fields(rows[0])


def _resolve_profile_source(person_id, fallback_unregistered=False):
    if fallback_unregistered:
        unregistered = _person_profile_from_store(S.unreg_store, person_id)
        if unregistered:
            return 'unregistered', S.unreg_store, unregistered

    registered = _person_profile_from_store(S.store, person_id)
    if registered:
        if 'registered' not in registered or S._bool_registered(registered.get('registered')):
            return 'registered', S.store, registered
        unregistered = _person_profile_from_store(S.unreg_store, person_id)
        if unregistered:
            return 'unregistered', S.unreg_store, unregistered
        return 'unregistered', S.store, registered

    unregistered = _person_profile_from_store(S.unreg_store, person_id)
    if unregistered:
        return 'unregistered', S.unreg_store, unregistered

    if fallback_unregistered:
        return 'unregistered', S.unreg_store, {}
    return 'registered', S.store, {}


def _format_int_part(value, width=None):
    text = _export_text(value)
    if not text:
        return ''
    if text.endswith('.0') and text[:-2].lstrip('-').isdigit():
        text = text[:-2]
    if text.lstrip('-').isdigit():
        number = int(text)
        if width:
            return f'{number:0{width}d}'
        return str(number)
    return text


def _format_birthdate(person):
    year = _format_int_part(person.get('birth_year'), 4)
    month = _format_int_part(person.get('birth_month'), 2)
    day = _format_int_part(person.get('birth_day'), 2)
    if year and month and day:
        return f'{year}-{month}-{day}'
    return ' / '.join(part for part in (year, month, day) if part)


def _format_ar_name(person, fallback=''):
    if fallback:
        return _export_text(fallback)
    parts = [
        _export_text(person.get('title')),
        _export_text(person.get('ar_first_name')),
        _export_text(person.get('ar_second_name')),
        _export_text(person.get('ar_third_name')),
        _export_text(person.get('ar_last_name')),
    ]
    return ' '.join(part for part in parts if part)


def _format_mother_ar_name(person):
    parts = [
        _export_text(person.get('mother_ar_first_name')),
        _export_text(person.get('mother_ar_second_name')),
        _export_text(person.get('mother_ar_last_name')),
    ]
    return ' '.join(part for part in parts if part)


def _unique_texts(values):
    seen = set()
    out = []
    for value in values:
        text = _export_text(value)
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _school_grade_rank(grade):
    text = _export_text(grade)
    try:
        return SCHOOL_GRADE_ORDER.index(text)
    except ValueError:
        return -1


def _format_current_grade(source_store, person_id, person):
    school_rows = S.school_rows_for_person(source_store, person_id)
    current_school_rows = [row for row in school_rows if S._to_bool(row.get('is_current'))]
    if not current_school_rows:
        return ''

    school_status = S.normalize_school_status(
        person.get('school_graduated'),
        has_current_school=True,
    )
    if school_status != S.SCHOOL_STATUS_STUDYING:
        return ''

    grades = []
    for row in current_school_rows:
        grades.extend(row.get('grades_attended') or [])
    grades = _unique_texts(grades)
    if not grades:
        return ''

    ranked = [(grade, _school_grade_rank(grade)) for grade in grades]
    known = [item for item in ranked if item[1] >= 0]
    if known:
        return max(known, key=lambda item: item[1])[0]
    return grades[-1]


def _format_mobile_type(row):
    mobile_type = _export_text(row.get(S.MOBILE_NUMBER_TYPE_COL) or row.get('type'))
    label = MOBILE_TYPE_LABELS.get(mobile_type, mobile_type)
    family_relation = _export_text(row.get('family_relation'))
    if mobile_type == 'family' and family_relation:
        return f'رقم هاتف {family_relation}'
    return label or 'غير محدد'


def _format_phone_numbers(source_store, person_id):
    rows = S.mobile_number_rows_for_person(source_store, person_id)
    values = []
    for row in rows:
        number = _export_text(row.get('mobile_number'))
        if not number:
            continue
        values.append(f'{number} ({_format_mobile_type(row)})')
    return ', '.join(values)


def _format_health_conditions(source_store, person_id):
    rows = S.normalize_person_health_condition_rows(
        _rows_for_person(source_store, S.PERSON_HEALTH_CONDITION_SHEET, person_id)
    )
    values = []
    for row in rows:
        condition_type = _export_text(row.get(S.CONDITION_TYPE_COL) or row.get('type'))
        title = _export_text(S.HEALTH_TYPE_LABELS.get(condition_type, condition_type))
        details = _export_text(row.get('details'))
        if title and details:
            values.append(f'{title}: {details}')
        elif details:
            values.append(details)
    return ', '.join(values)


def _format_profile_notes(source_store, person_id):
    rows = S.normalize_person_special_note_rows(
        _rows_for_person(source_store, S.PERSON_SPECIAL_NOTE_SHEET, person_id)
    )
    values = []
    for row in rows:
        title = _export_text(row.get('note_title'))
        note = _export_text(row.get('note'))
        if title and note:
            values.append(f'{title}: {note}')
        elif note:
            values.append(note)
    return ', '.join(values)


def _format_member_registration_status(entry):
    status = _export_text(entry.get('confirmation_status')) or 'confirmed'
    if status == 'pending':
        priority = _format_int_part(entry.get('yg_priority'))
        return f'انتظار #{priority}' if priority else 'انتظار'
    if status == 'denied':
        return 'معتذر منه'
    return 'مؤكّد'


def _format_attendance_status(entry):
    status = _normalize_attendance_status(entry.get('attendance_status')) or ATTENDANCE_DEFAULT_STATUS
    return ATTENDANCE_STATUS_LABELS.get(status, status)


def _build_bedroom_assignment_lookup(evt):
    """Return {reg_id: room_name} from bedroom_assignments + location rooms."""
    room_by_id = {}
    try:
        from core.routes_camp_locations import _load as _lc_load
        locs_data = _lc_load()
        loc_ids = {
            loc.get('camp_location_id')
            for loc in (evt.get('locations') or [])
            if loc.get('camp_location_id')
        }
        for loc in locs_data.get('locations', []):
            if loc.get('id') not in loc_ids:
                continue
            for bld in loc.get('buildings', []):
                for flr in bld.get('floors', []):
                    for rm in flr.get('rooms', []):
                        rid = rm.get('id')
                        if rid:
                            room_by_id[rid] = _export_text(rm.get('name', ''))
    except Exception:
        pass
    result = {}
    for asgn in (evt.get('bedroom_assignments') or []):
        reg_id  = asgn.get('reg_id')
        room_id = asgn.get('room_id')
        if reg_id and room_id and room_id in room_by_id:
            result[reg_id] = room_by_id[room_id]
    return result


def _build_team_name_lookup(evt):
    """Return {team_id: team_name}."""
    return {
        t['team_id']: _export_text(t.get('name', ''))
        for t in (evt.get('teams') or [])
        if t.get('team_id')
    }


def _build_member_export_rows(evt):
    _normalize_registration_attendance(evt)
    _normalize_registration_custom_fields(evt)
    _enrich_all_registrations(evt)
    room_lookup = _build_bedroom_assignment_lookup(evt)
    team_lookup = _build_team_name_lookup(evt)
    _, custom_pairs = _custom_export_columns(evt, 'members', MEMBER_EXPORT_COLUMNS)
    rows = []
    for entry in evt.get('registration', {}).get('members', []):
        person_id = entry.get('person_id')
        reg_id    = entry.get('id')
        profile_status, source_store, person = _resolve_profile_source(
            person_id,
            fallback_unregistered=bool(entry.get('is_unregistered')),
        )
        rows.append({
            'الاسم الكامل بالعربية': _format_ar_name(person, entry.get('name')),
            'حالة الملف الشخصي': PROFILE_STATUS_LABELS.get(profile_status, profile_status),
            'حالة التسجيل': _format_member_registration_status(entry),
            'حالة الحضور': _format_attendance_status(entry),
            'تاريخ الاعتذار عن الحضور': _export_text(entry.get('apology_date')),
            'سبب الاعتذار عن الحضور': _export_text(entry.get('apology_reason'), preserve_newlines=True),
            'الجنس': _export_text(entry.get('gender') or person.get('gender')),
            'تاريخ الميلاد الكامل': _format_birthdate(person),
            'الصف الحالي': _format_current_grade(source_store, person_id, person),
            'التعليم الجامعي': _format_higher_education(source_store, person_id),
            'الوظيفة الحالية': _format_current_job(source_store, person_id),
            'رقم الهاتف': _format_phone_numbers(source_store, person_id),
            'الشبيبة': _export_text(entry.get('youth_group_label') or _lookup_yg_label(entry.get('youth_group_id'))),
            'رقم الغرفة': room_lookup.get(reg_id, ''),
            'الفريق': team_lookup.get(entry.get('team_id') or '', ''),
            'اسم الأم الكامل بالعربية': _format_mother_ar_name(person),
            'الحالات الصحية': _format_health_conditions(source_store, person_id),
            'ملاحظات الملف الشخصي': _format_profile_notes(source_store, person_id),
            'ملاحظات التسجيل': _export_text(entry.get('notes'), preserve_newlines=True),
            **_custom_field_row_values(entry, custom_pairs),
        })
    return rows


def _apply_multiline_wrap(worksheet):
    """Enable wrap_text on any cell whose value has an embedded newline, and
    grow that row's height so every line stays visible instead of clipped."""
    row_lines = {}
    for row in worksheet.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and '\n' in cell.value:
                cell.alignment = Alignment(wrap_text=True, vertical='top')
                row_lines[cell.row] = max(row_lines.get(cell.row, 1), cell.value.count('\n') + 1)
    for row_idx, lines in row_lines.items():
        worksheet.row_dimensions[row_idx].height = max(
            worksheet.row_dimensions[row_idx].height or 15, 15 * lines)


def _build_members_export_workbook(evt):
    output = BytesIO()
    rows = _build_member_export_rows(evt)
    columns, _ = _custom_export_columns(evt, 'members', MEMBER_EXPORT_COLUMNS)
    df = pd.DataFrame(rows, columns=columns)
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Participants')
        worksheet = writer.sheets['Participants']
        worksheet.freeze_panes = 'A2'
        worksheet.auto_filter.ref = worksheet.dimensions
        _apply_multiline_wrap(worksheet)
        for column_cells in worksheet.columns:
            max_length = max(len(_export_text(cell.value)) for cell in column_cells)
            worksheet.column_dimensions[column_cells[0].column_letter].width = min(max(max_length + 2, 12), 60)
    output.seek(0)
    return output


def _format_higher_education(source_store, person_id):
    rows = _rows_for_person(source_store, S.HIGHER_EDUCATION_SHEET, person_id)
    values = []
    for row in rows:
        state = _export_text(row.get(S.EDUCATION_STATE_COL) or row.get('state'))
        end_date = _export_text(row.get('end_date'))
        is_current = (state == 'current') or (not end_date)
        if not is_current:
            continue
        institution = _export_text(row.get(S.HIGHER_EDUCATION_INSTITUTION_COL) or row.get('institution_name'))
        major = _export_text(row.get('major'))
        parts = [p for p in [institution, major] if p]
        if parts:
            values.append(' / '.join(parts))
    return ', '.join(values)


def _format_current_job(source_store, person_id):
    rows = S.job_rows_for_person(source_store, person_id)
    values = []
    for row in rows:
        state = _export_text(row.get(S.EMPLOYMENT_STATE_COL) or row.get('state'))
        end_date = _export_text(row.get('end_date'))
        is_current = (state == 'current') or (not end_date and state != 'previous')
        if not is_current:
            continue
        job_title = _export_text(row.get('job_title'))
        employer = _export_text(row.get(S.EMPLOYER_NAME_COL) or row.get('company'))
        parts = [p for p in [job_title, employer] if p]
        if parts:
            values.append(' / '.join(parts))
    return ', '.join(values)


def _build_supervisor_export_rows(evt):
    _normalize_registration_attendance(evt)
    _normalize_registration_custom_fields(evt)
    _enrich_all_registrations(evt)
    room_lookup = _build_bedroom_assignment_lookup(evt)
    team_lookup = _build_team_name_lookup(evt)
    _, custom_pairs = _custom_export_columns(evt, 'supervisors', SUPERVISOR_EXPORT_COLUMNS)
    rows = []
    for entry in evt.get('registration', {}).get('supervisors', []):
        person_id = entry.get('person_id')
        reg_id    = entry.get('id')
        profile_status, source_store, person = _resolve_profile_source(
            person_id,
            fallback_unregistered=bool(entry.get('is_unregistered')),
        )
        attendance_status = _format_attendance_status(entry) if entry.get('status') == FINAL_PERSON_APPROVED_STATUS else ''
        rows.append({
            'الاسم الكامل بالعربية':   _format_ar_name(person, entry.get('name')),
            'حالة الملف الشخصي':       PROFILE_STATUS_LABELS.get(profile_status, profile_status),
            'حالة التسجيل في النشاط':  _export_text(entry.get('status')),
            'حالة الحضور':             attendance_status,
            'تاريخ الاعتذار عن الحضور': _export_text(entry.get('apology_date')) if entry.get('attendance_status') == 'apologized' else '',
            'سبب الاعتذار عن الحضور':  _export_text(entry.get('apology_reason'), preserve_newlines=True) if entry.get('attendance_status') == 'apologized' else '',
            'الجنس':                    _export_text(entry.get('gender') or person.get('gender')),
            'تاريخ الميلاد الكامل':    _format_birthdate(person),
            'الفئة العمريّة':           _export_text(entry.get('age_group')),
            'الشبيبة':                  _export_text(entry.get('youth_group_label') or _lookup_yg_label(entry.get('youth_group_id'))),
            'رقم الغرفة':              room_lookup.get(reg_id, ''),
            'الفريق':                  team_lookup.get(entry.get('team_id') or '', ''),
            'دور المسؤول في الفريق':  {'main': 'رئيسي', 'assistant': 'مساعد'}.get(entry.get('team_role') or '', ''),
            'الصف الحالي':             _format_current_grade(source_store, person_id, person),
            'التعليم الجامعي':         _format_higher_education(source_store, person_id),
            'الوظيفة الحالية':         _format_current_job(source_store, person_id),
            'رقم الهاتف':              _format_phone_numbers(source_store, person_id),
            'الحالات الصحية':          _format_health_conditions(source_store, person_id),
            'ملاحظات الملف الشخصي':   _format_profile_notes(source_store, person_id),
            'ملاحظات التسجيل':         _export_text(entry.get('notes'), preserve_newlines=True),
            **_custom_field_row_values(entry, custom_pairs),
        })
    return rows


def _build_supervisors_export_workbook(evt):
    output = BytesIO()
    rows = _build_supervisor_export_rows(evt)
    columns, _ = _custom_export_columns(evt, 'supervisors', SUPERVISOR_EXPORT_COLUMNS)
    df = pd.DataFrame(rows, columns=columns)
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Supervisors')
        worksheet = writer.sheets['Supervisors']
        worksheet.freeze_panes = 'A2'
        worksheet.auto_filter.ref = worksheet.dimensions
        _apply_multiline_wrap(worksheet)
        for column_cells in worksheet.columns:
            max_length = max(len(_export_text(cell.value)) for cell in column_cells)
            worksheet.column_dimensions[column_cells[0].column_letter].width = min(max(max_length + 2, 12), 60)
    output.seek(0)
    return output


def _build_gs_committee_export_rows(evt):
    _normalize_registration_attendance(evt)
    _normalize_registration_custom_fields(evt)
    _enrich_all_registrations(evt)
    room_lookup = _build_bedroom_assignment_lookup(evt)
    _, custom_pairs = _custom_export_columns(evt, 'gs_committee', GS_COMMITTEE_EXPORT_COLUMNS)
    rows = []
    for entry in evt.get('registration', {}).get('gs_committee', []):
        person_id = entry.get('person_id')
        reg_id    = entry.get('id')
        profile_status, source_store, person = _resolve_profile_source(
            person_id,
            fallback_unregistered=bool(entry.get('is_unregistered')),
        )
        attendance_status = _format_attendance_status(entry) if entry.get('status') == FINAL_PERSON_APPROVED_STATUS else ''
        hulls = entry.get('hulls') or []
        rows.append({
            'الاسم الكامل بالعربية':    _format_ar_name(person, entry.get('name')),
            'حالة الملف الشخصي':        PROFILE_STATUS_LABELS.get(profile_status, profile_status),
            'حالة التسجيل في النشاط':   _export_text(entry.get('status')),
            'حالة الحضور':              attendance_status,
            'تاريخ الاعتذار عن الحضور': _export_text(entry.get('apology_date')) if entry.get('attendance_status') == 'apologized' else '',
            'سبب الاعتذار عن الحضور':   _export_text(entry.get('apology_reason'), preserve_newlines=True) if entry.get('attendance_status') == 'apologized' else '',
            'الجنس':                     _export_text(entry.get('gender') or person.get('gender')),
            'تاريخ الميلاد الكامل':     _format_birthdate(person),
            'الدور في النشاط':          _export_text(entry.get('role')),
            'الأفواج / الهياكل':        ' / '.join(hulls),
            'رقم الغرفة':               room_lookup.get(reg_id, ''),
            'التعليم الجامعي':          _format_higher_education(source_store, person_id),
            'الوظيفة الحالية':          _format_current_job(source_store, person_id),
            'رقم الهاتف':               _format_phone_numbers(source_store, person_id),
            'الحالات الصحية':           _format_health_conditions(source_store, person_id),
            'ملاحظات الملف الشخصي':    _format_profile_notes(source_store, person_id),
            'ملاحظات التسجيل':          _export_text(entry.get('notes'), preserve_newlines=True),
            **_custom_field_row_values(entry, custom_pairs),
        })
    return rows


def _build_gs_committee_export_workbook(evt):
    output = BytesIO()
    rows = _build_gs_committee_export_rows(evt)
    columns, _ = _custom_export_columns(evt, 'gs_committee', GS_COMMITTEE_EXPORT_COLUMNS)
    df = pd.DataFrame(rows, columns=columns)
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='GS Committee')
        worksheet = writer.sheets['GS Committee']
        worksheet.freeze_panes = 'A2'
        worksheet.auto_filter.ref = worksheet.dimensions
        _apply_multiline_wrap(worksheet)
        for column_cells in worksheet.columns:
            max_length = max(len(_export_text(cell.value)) for cell in column_cells)
            worksheet.column_dimensions[column_cells[0].column_letter].width = min(max(max_length + 2, 12), 60)
    output.seek(0)
    return output


def _lookup_gs_role(person_id):
    ctx = _get_person_reg_context(person_id)
    return ctx['gs_role']


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _current_user():
    try:
        return auth_exports['_current_user']()
    except Exception:
        return None


def _require_admin():
    user = _current_user()
    if not user or user.get('role') != 'admin':
        return jsonify({'error': 'unauthorized'}), 403
    return None


# ── Team helpers ─────────────────────────────────────────────────────────────

def _auto_distribute_members(members, teams, mode='reset'):
    """
    Distribute confirmed members across teams.  Priority order:

    1. Gender balance ±1  (hard cap — never exceeded).
    2. YG ceiling: no team gets more than ceil(yg_size / num_teams) members
       from the same YG.  Enforced via a steep graduated penalty; the function
       retries up to MAX_TRIES times with different shuffles and returns the
       attempt with the fewest ceiling violations.
    3. Team size ±1  (falls out automatically from correct gender targets).

    Scoring per team when placing a member from YG yg:
      • count_in_team == 0           →   0       (prefer empty)
      • 0 < count < ceil(yg/K)       →  count × 100  (graduated, prefer less crowded)
      • count >= ceil(yg/K)          →  50 000 + count × 1 000  (strongly avoid)
      • gender slot full             →  999 999  (hard cap)
    Constrained YGs (total ≤ num_teams, ceil = 1) are processed before flexible
    ones so they claim their exclusive slots while all positions are still open.
    """
    MAX_TRIES = 20

    num_teams = len(teams)
    if num_teams == 0:
        return {}

    team_ids = [t['team_id'] for t in teams]
    tid_set  = set(team_ids)
    confirmed = [
        m for m in members
        if (m.get('confirmation_status') or 'confirmed') == 'confirmed'
        and not _is_attendance_apologized(m)
    ]
    to_dist = confirmed if mode == 'reset' else [
        m for m in confirmed
        if not m.get('team_id') or m.get('team_id') not in tid_set
    ]
    if not to_dist:
        return {}

    # ── Pre-compute per-YG totals and ceilings ────────────────────────────────
    yg_total = defaultdict(int)
    for m in to_dist:
        yg_total[m.get('youth_group_id') or 'none'] += 1

    # ceil(yg_size / num_teams) — the ideal maximum per team for each YG
    yg_ceil_map = {
        yg: (cnt + num_teams - 1) // num_teams
        for yg, cnt in yg_total.items()
    }

    males    = [m for m in to_dist if m.get('gender') == 'ذكر']
    females  = [m for m in to_dist if m.get('gender') == 'أنثى']
    unknowns = [m for m in to_dist if m.get('gender') not in ('ذكر', 'أنثى')]
    total    = len(to_dist)

    base_m,  extra_m  = divmod(len(males),  num_teams)
    base_f,  extra_f  = divmod(len(females), num_teams)
    base_sz, extra_sz = divmod(total,        num_teams)

    # ── Single-attempt runner ─────────────────────────────────────────────────
    def _run(order):
        male_tgt   = {order[i]: base_m  + (1 if i < extra_m  else 0) for i in range(num_teams)}
        female_tgt = {order[i]: base_f  + (1 if i < extra_f  else 0) for i in range(num_teams)}
        size_tgt   = {order[i]: base_sz + (1 if i < extra_sz else 0) for i in range(num_teams)}

        team_male     = defaultdict(int)
        team_female   = defaultdict(int)
        team_unk      = defaultdict(int)
        # per-YG member count per team (all genders combined)
        tyc = defaultdict(lambda: defaultdict(int))

        if mode == 'unassigned':
            for m in confirmed:
                tid = m.get('team_id')
                if tid and tid in tid_set:
                    g  = m.get('gender', '')
                    yg = m.get('youth_group_id') or 'none'
                    if g == 'ذكر':    team_male[tid]   += 1
                    elif g == 'أنثى': team_female[tid] += 1
                    else:              team_unk[tid]    += 1
                    tyc[tid][yg] += 1

        res = {}

        def yg_pen(tid, yg):
            ceiling = yg_ceil_map.get(yg, 1)
            cnt     = tyc[tid][yg]
            if cnt >= ceiling:
                return 50000 + cnt * 1000
            return cnt * 100   # 0 when cnt == 0

        def _ordered(group):
            """Round-robin interleave, constrained YGs (ceil=1) before flexible."""
            yg_map = defaultdict(list)
            for m in group:
                yg_map[m.get('youth_group_id') or 'none'].append(m)
            c_qs, f_qs = [], []
            for yg, lst in yg_map.items():
                (c_qs if yg_total[yg] <= num_teams else f_qs).append(lst[:])
            out = []
            for qs in (sorted(c_qs, key=len, reverse=True),
                       sorted(f_qs, key=len, reverse=True)):
                while any(q for q in qs):
                    for q in qs:
                        if q:
                            out.append(q.pop(0))
            return out

        def place(group, count_d, tgt_d):
            for m in _ordered(group):
                yg = m.get('youth_group_id') or 'none'

                def score(tid, _yg=yg):
                    if count_d[tid] >= tgt_d.get(tid, 0):
                        return 999999
                    return yg_pen(tid, _yg) + count_d[tid] * 10

                best = min(order, key=score)
                res[m['id']]  = best
                count_d[best] += 1
                tyc[best][yg] += 1

        place(males,   team_male,   male_tgt)
        place(females, team_female, female_tgt)

        for m in _ordered(unknowns):
            yg = m.get('youth_group_id') or 'none'

            def score_u(tid, _yg=yg):
                placed = team_male[tid] + team_female[tid] + team_unk[tid]
                if placed >= size_tgt.get(tid, 0):
                    return 999999
                return yg_pen(tid, _yg) + placed * 10

            best = min(order, key=score_u)
            res[m['id']]   = best
            team_unk[best] += 1
            tyc[best][yg]  += 1

        return res

    # ── Violation counter ─────────────────────────────────────────────────────
    def _violations(res):
        """Sum of excess members above YG ceiling across all teams."""
        tc = defaultdict(lambda: defaultdict(int))
        for m in to_dist:
            tid = res.get(m['id'])
            if tid:
                tc[tid][m.get('youth_group_id') or 'none'] += 1
        v = 0
        for tid, yg_counts in tc.items():
            for yg, cnt in yg_counts.items():
                ceil_v = yg_ceil_map.get(yg, 1)
                if cnt > ceil_v:
                    v += cnt - ceil_v
        return v

    # ── Retry loop — return best result across MAX_TRIES shuffles ─────────────
    order    = team_ids[:]
    best_res = None
    best_v   = float('inf')

    for _ in range(MAX_TRIES):
        random.shuffle(order)
        res = _run(list(order))
        v   = _violations(res)
        if v < best_v:
            best_v   = v
            best_res = res
        if v == 0:
            break

    # ── Post-fix: spread large YGs to all teams via gender-safe swaps ─────────
    # The main pass (constrained-first ordering) correctly handles small YGs but
    # may leave some teams with 0 from a large YG when gender slots fill up early.
    # We fix this without touching gender balance: for each large YG that has a
    # 0-team, find a donor team with 2+, then swap one of the donor's members with
    # a same-gender member from the 0-team whose YG won't exceed ceiling in the donor.
    def _post_fix_spread(res):
        for _pass in range(num_teams):
            any_swap = False

            # Rebuild team → YG → member-list map from current result
            tyg = defaultdict(lambda: defaultdict(list))
            for m in to_dist:
                tid = res.get(m['id'])
                if tid:
                    tyg[tid][m.get('youth_group_id') or 'none'].append(m)

            for yg, total in yg_total.items():
                if total < num_teams:
                    continue  # Not enough members to reach every team — skip

                zero_teams  = [tid for tid in team_ids if not tyg[tid].get(yg)]
                donor_teams = [tid for tid in team_ids if len(tyg[tid].get(yg, [])) >= 2]

                if not zero_teams or not donor_teams:
                    continue

                for z_tid in zero_teams:
                    done = False
                    for d_tid in donor_teams:
                        for m_out in tyg[d_tid][yg]:
                            g = m_out.get('gender', '')
                            # Find a same-gender member in z_tid from a different YG
                            for m_in in [m for m in to_dist
                                         if res.get(m['id']) == z_tid
                                         and m.get('gender', '') == g
                                         and (m.get('youth_group_id') or 'none') != yg]:
                                m_in_yg = m_in.get('youth_group_id') or 'none'
                                # Ensure d_tid gaining m_in_yg stays within its ceiling
                                if len(tyg[d_tid].get(m_in_yg, [])) >= yg_ceil_map.get(m_in_yg, 1):
                                    continue
                                # Swap — gender counts unchanged, no ceiling created
                                res[m_out['id']] = z_tid
                                res[m_in['id']]  = d_tid
                                any_swap = done  = True
                                break
                            if done:
                                break
                        if done:
                            break

            if not any_swap:
                break  # Converged — no more improvements possible

        return res

    if best_res:
        best_res = _post_fix_spread(best_res)

    return best_res or {}


# ── Route registrar ───────────────────────────────────────────────────────────

def register_events_routes(app):

    # ── Constants ──────────────────────────────────────────────────────────────

    @app.route('/api/events/constants', methods=['GET'])
    def events_constants():
        return jsonify({
            'event_types': EVENT_TYPES,
            'age_groups': AGE_GROUPS_ALL,
            'supervisor_statuses': SUPERVISOR_STATUSES,
            'proposal_statuses': list(PROPOSAL_STATUSES),
        })

    # ── Title Presets ──────────────────────────────────────────────────────────

    @app.route('/api/events/title-presets', methods=['GET'])
    def list_title_presets():
        err = _require_admin()
        if err:
            return err
        organizer = request.args.get('organizer', 'gs').strip()
        yg_id = request.args.get('yg_id', '').strip()
        with _LOCK:
            presets = _load_presets()
        if organizer == 'gs':
            return jsonify({'presets': presets.get('gs', [])})
        if organizer == 'yg' and yg_id:
            return jsonify({'presets': presets.get('yg', {}).get(yg_id, [])})
        return jsonify({'presets': []})

    @app.route('/api/events/title-presets', methods=['POST'])
    def create_title_preset():
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        organizer = str(body.get('organizer', 'gs') or 'gs').strip()
        yg_id = str(body.get('yg_id', '') or '').strip()
        name = str(body.get('name', '') or '').strip()
        if not name:
            return jsonify({'error': 'name required'}), 400
        with _LOCK:
            presets = _load_presets()
            all_ids = []
            for p in presets.get('gs', []):
                all_ids.append(p.get('id', ''))
            for yg_presets in presets.get('yg', {}).values():
                for p in yg_presets:
                    all_ids.append(p.get('id', ''))
            new_id = _gen_id('EVTPRE', all_ids)
            new_preset = {'id': new_id, 'name': name, 'created_at': datetime.now().isoformat()}
            if organizer == 'gs':
                presets.setdefault('gs', []).append(new_preset)
            elif organizer == 'yg' and yg_id:
                presets.setdefault('yg', {}).setdefault(yg_id, []).append(new_preset)
            else:
                return jsonify({'error': 'invalid organizer'}), 400
            _save_presets(presets)
        return jsonify({'preset': new_preset}), 201

    @app.route('/api/events/title-presets/<preset_id>', methods=['DELETE'])
    def delete_title_preset(preset_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            presets = _load_presets()
            found = False
            orig_gs = presets.get('gs', [])
            presets['gs'] = [p for p in orig_gs if p.get('id') != preset_id]
            if len(presets['gs']) != len(orig_gs):
                found = True
            for yg_id, yg_list in presets.get('yg', {}).items():
                new_list = [p for p in yg_list if p.get('id') != preset_id]
                if len(new_list) != len(yg_list):
                    presets['yg'][yg_id] = new_list
                    found = True
            _save_presets(presets)
        if not found:
            return jsonify({'error': 'not found'}), 404
        return jsonify({'ok': True})

    # ── Events CRUD ────────────────────────────────────────────────────────────

    @app.route('/api/events', methods=['GET'])
    def list_events():
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
        events = list(data.get('events', []))
        events = _enrich_with_display_names(events)
        return jsonify({'events': events})

    @app.route('/api/events', methods=['POST'])
    def create_event():
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}

        event_type = str(body.get('event_type', '') or '').strip()
        if event_type not in EVENT_TYPES:
            return jsonify({'error': 'invalid event_type'}), 400

        jec_year = str(body.get('jec_year', '') or '').strip()
        if not jec_year:
            return jsonify({'error': 'jec_year required'}), 400

        organizer_type = str(body.get('organizer_type', 'gs') or 'gs').strip()
        if organizer_type not in ('gs', 'yg', 'combined'):
            return jsonify({'error': 'invalid organizer_type'}), 400

        organizer_yg_participants = body.get('organizer_yg_participants', []) or []
        if not isinstance(organizer_yg_participants, list):
            organizer_yg_participants = []

        target_type = str(body.get('target_type', 'age_groups') or 'age_groups').strip()
        target_age_groups = body.get('target_age_groups', []) or []
        if not isinstance(target_age_groups, list):
            target_age_groups = []
        target_hull_label = str(body.get('target_hull_label', '') or '').strip()

        title_source = str(body.get('title_source', 'age_groups') or 'age_groups').strip()
        title_preset_id = str(body.get('title_preset_id', '') or '').strip() or None
        title_label = str(body.get('title_label', '') or '').strip()

        if title_source == 'age_groups':
            title_label = _age_group_label(target_age_groups)
        elif not title_label:
            return jsonify({'error': 'title_label required'}), 400

        base_title = _compute_base_title(event_type, title_label)

        start_dt = str(body.get('start_datetime', '') or '').strip()
        end_dt   = str(body.get('end_datetime', '') or '').strip()
        nights   = _compute_nights(start_dt, end_dt)

        theme_text       = str(body.get('theme_text', '') or '').strip() or None
        theme_is_verse   = bool(body.get('theme_is_verse', False))
        theme_verse_data = body.get('theme_verse_data') or None

        locations = body.get('locations', []) or []
        if not isinstance(locations, list):
            locations = []
        for loc in locations:
            if 'id' not in loc:
                loc['id'] = str(uuid.uuid4())[:8]

        with _LOCK:
            data = _load_events()
            existing_ids = [e.get('id', '') for e in data.get('events', [])]
            new_id = _gen_id('EVT', existing_ids)
            now = datetime.now().isoformat()
            new_event = {
                'id': new_id,
                'jec_year': jec_year,
                'event_type': event_type,
                'organizer_type': organizer_type,
                'organizer_yg_participants': organizer_yg_participants,
                'target_type': target_type,
                'target_age_groups': target_age_groups,
                'target_hull_label': target_hull_label,
                'title_source': title_source,
                'title_preset_id': title_preset_id,
                'title_label': title_label,
                'base_title': base_title,
                'theme_text': theme_text,
                'theme_is_verse': theme_is_verse,
                'theme_verse_data': theme_verse_data,
                'locations': locations,
                'start_datetime': start_dt,
                'end_datetime': end_dt,
                'nights': nights,
                'logos': [],
                'posters': [],
                'documents': [],
                'yg_quotas': {},
                'transport_support': {'include_participants': True, 'include_supervisors': False, 'amounts': {}},
                'yg_apologies': [],
                'registration': {
                    'members': [],
                    'supervisors': [],
                    'gs_committee': [],
                    'guests': [],
                },
                'registration_fields': {reg_type: [] for reg_type in REG_TYPE_ORDER},
                'created_at': now,
                'updated_at': now,
            }
            data['events'].append(new_event)
            _save_events(data)
        return jsonify({'event': new_event}), 201

    @app.route('/api/events/<event_id>', methods=['GET'])
    def get_event(event_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            changed = _normalize_registration_attendance(evt)
            changed = _normalize_registration_custom_fields(evt) or changed
            if changed:
                evt['updated_at'] = datetime.now().isoformat()
                _save_events(data)
        _enrich_with_display_names(events)
        _enrich_all_registrations(evt)
        return jsonify({'event': evt})

    @app.route('/api/events/<event_id>/registration/members/export.xlsx', methods=['GET'])
    def export_event_members_registration(event_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            changed = _normalize_registration_attendance(evt)
            if changed:
                evt['updated_at'] = datetime.now().isoformat()
                _save_events(data)
        _enrich_with_display_names(events)
        workbook = _build_members_export_workbook(evt)
        filename = f'{event_id}_participants.xlsx'
        return send_file(
            workbook,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename,
        )

    @app.route('/api/events/<event_id>/registration/supervisors/export.xlsx', methods=['GET'])
    def export_event_supervisors_registration(event_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            changed = _normalize_registration_attendance(evt)
            if changed:
                evt['updated_at'] = datetime.now().isoformat()
                _save_events(data)
        _enrich_with_display_names(events)
        workbook = _build_supervisors_export_workbook(evt)
        filename = f'{event_id}_supervisors.xlsx'
        return send_file(
            workbook,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename,
        )

    @app.route('/api/events/<event_id>/registration/gs_committee/export.xlsx', methods=['GET'])
    def export_event_gs_committee_registration(event_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            changed = _normalize_registration_attendance(evt)
            if changed:
                evt['updated_at'] = datetime.now().isoformat()
                _save_events(data)
        _enrich_with_display_names(events)
        workbook = _build_gs_committee_export_workbook(evt)
        filename = f'{event_id}_gs_committee.xlsx'
        return send_file(
            workbook,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename,
        )

    @app.route('/api/events/<event_id>', methods=['PUT'])
    def update_event(event_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404

            updatable = [
                'jec_year', 'event_type', 'organizer_type', 'organizer_yg_participants',
                'target_type', 'target_age_groups', 'target_hull_label',
                'title_source', 'title_preset_id', 'title_label',
                'theme_text', 'theme_is_verse', 'theme_verse_data',
                'locations', 'start_datetime', 'end_datetime',
                'has_teams', 'has_team_leaders', 'num_teams', 'max_members_per_team',
            ]
            for field in updatable:
                if field in body:
                    evt[field] = body[field]

            # Recompute derived fields
            if 'title_source' in body or 'title_label' in body or 'target_age_groups' in body:
                if evt.get('title_source') == 'age_groups':
                    evt['title_label'] = _age_group_label(evt.get('target_age_groups', []))
                evt['base_title'] = _compute_base_title(evt.get('event_type', ''), evt.get('title_label', ''))

            if 'start_datetime' in body or 'end_datetime' in body:
                evt['nights'] = _compute_nights(evt.get('start_datetime', ''), evt.get('end_datetime', ''))

            if 'yg_quotas' in body:
                raw_quotas = body.get('yg_quotas') or {}
                if isinstance(raw_quotas, dict):
                    clean = {}
                    for k, v in raw_quotas.items():
                        try:
                            n = int(v)
                            if n >= 0:
                                clean[str(k).strip()] = n
                        except (TypeError, ValueError):
                            pass
                    evt['yg_quotas'] = clean

            if 'transport_support' in body:
                raw_ts = body.get('transport_support') or {}
                if isinstance(raw_ts, dict):
                    clean_amounts = {}
                    for k, v in (raw_ts.get('amounts') or {}).items():
                        try:
                            n = float(v)
                            if n >= 0:
                                clean_amounts[str(k).strip()] = n
                        except (TypeError, ValueError):
                            pass
                    evt['transport_support'] = {
                        'include_participants': bool(raw_ts.get('include_participants', True)),
                        'include_supervisors':  bool(raw_ts.get('include_supervisors', False)),
                        'amounts': clean_amounts,
                    }

            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'event': evt})

    @app.route('/api/events/<event_id>', methods=['DELETE'])
    def delete_event(event_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            orig = data.get('events', [])
            data['events'] = [e for e in orig if e.get('id') != event_id]
            if len(data['events']) == len(orig):
                return jsonify({'error': 'not found'}), 404
            _save_events(data)
        return jsonify({'ok': True})

    # ── Media: Logos ───────────────────────────────────────────────────────────

    @app.route('/api/events/<event_id>/logos', methods=['POST'])
    def upload_event_logo(event_id):
        err = _require_admin()
        if err:
            return err
        if 'logo' not in request.files:
            return jsonify({'error': 'no file'}), 400
        file = request.files['logo']
        ext = os.path.splitext(secure_filename(file.filename))[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return jsonify({'error': 'invalid file type'}), 400
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            existing_ids = [img.get('id', '') for img in evt.get('logos', [])]
            img_id = _gen_id('EVTIMG', existing_ids)
            filename = f'{img_id}{ext}'
            file.save(os.path.join(_LOGOS_DIR, filename))
            is_main = len(evt.get('logos', [])) == 0
            img_entry = {'id': img_id, 'filename': filename, 'is_main': is_main}
            evt.setdefault('logos', []).append(img_entry)
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'image': img_entry}), 201

    @app.route('/api/events/<event_id>/logos/<img_id>', methods=['GET'])
    def serve_event_logo(event_id, img_id):
        with _LOCK:
            data = _load_events()
        evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
        if not evt:
            return jsonify({'error': 'not found'}), 404
        img = next((i for i in evt.get('logos', []) if i.get('id') == img_id), None)
        if not img:
            return jsonify({'error': 'not found'}), 404
        return send_from_directory(_LOGOS_DIR, img['filename'])

    @app.route('/api/events/<event_id>/logos/<img_id>', methods=['DELETE'])
    def delete_event_logo(event_id, img_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            img = next((i for i in evt.get('logos', []) if i.get('id') == img_id), None)
            if not img:
                return jsonify({'error': 'not found'}), 404
            evt['logos'] = [i for i in evt['logos'] if i.get('id') != img_id]
            # If deleted was main and others remain, set first as main
            if img.get('is_main') and evt['logos']:
                evt['logos'][0]['is_main'] = True
            try:
                os.remove(os.path.join(_LOGOS_DIR, img['filename']))
            except OSError:
                pass
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    @app.route('/api/events/<event_id>/logos/<img_id>/set-main', methods=['PATCH'])
    def set_main_event_logo(event_id, img_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            found = False
            for img in evt.get('logos', []):
                img['is_main'] = img.get('id') == img_id
                if img['is_main']:
                    found = True
            if not found:
                return jsonify({'error': 'not found'}), 404
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    # ── Media: Posters ─────────────────────────────────────────────────────────

    @app.route('/api/events/<event_id>/posters', methods=['POST'])
    def upload_event_poster(event_id):
        err = _require_admin()
        if err:
            return err
        if 'poster' not in request.files:
            return jsonify({'error': 'no file'}), 400
        file = request.files['poster']
        ext = os.path.splitext(secure_filename(file.filename))[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return jsonify({'error': 'invalid file type'}), 400
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            all_logo_ids = [img.get('id', '') for img in evt.get('logos', [])]
            all_poster_ids = [img.get('id', '') for img in evt.get('posters', [])]
            img_id = _gen_id('EVTIMG', all_logo_ids + all_poster_ids)
            filename = f'{img_id}{ext}'
            file.save(os.path.join(_POSTERS_DIR, filename))
            is_main = len(evt.get('posters', [])) == 0
            img_entry = {'id': img_id, 'filename': filename, 'is_main': is_main}
            evt.setdefault('posters', []).append(img_entry)
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'image': img_entry}), 201

    @app.route('/api/events/<event_id>/posters/<img_id>', methods=['GET'])
    def serve_event_poster(event_id, img_id):
        with _LOCK:
            data = _load_events()
        evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
        if not evt:
            return jsonify({'error': 'not found'}), 404
        img = next((i for i in evt.get('posters', []) if i.get('id') == img_id), None)
        if not img:
            return jsonify({'error': 'not found'}), 404
        return send_from_directory(_POSTERS_DIR, img['filename'])

    @app.route('/api/events/<event_id>/posters/<img_id>', methods=['DELETE'])
    def delete_event_poster(event_id, img_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            img = next((i for i in evt.get('posters', []) if i.get('id') == img_id), None)
            if not img:
                return jsonify({'error': 'not found'}), 404
            evt['posters'] = [i for i in evt['posters'] if i.get('id') != img_id]
            if img.get('is_main') and evt['posters']:
                evt['posters'][0]['is_main'] = True
            try:
                os.remove(os.path.join(_POSTERS_DIR, img['filename']))
            except OSError:
                pass
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    @app.route('/api/events/<event_id>/posters/<img_id>/set-main', methods=['PATCH'])
    def set_main_event_poster(event_id, img_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            found = False
            for img in evt.get('posters', []):
                img['is_main'] = img.get('id') == img_id
                if img['is_main']:
                    found = True
            if not found:
                return jsonify({'error': 'not found'}), 404
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    # ── Media: Documents (المراسلة) ────────────────────────────────────────────

    @app.route('/api/events/<event_id>/documents', methods=['POST'])
    def upload_event_document(event_id):
        err = _require_admin()
        if err:
            return err
        if 'document' not in request.files:
            return jsonify({'error': 'no file'}), 400
        file = request.files['document']
        raw_name = (file.filename or '').strip()
        ext = os.path.splitext(raw_name)[1].lower()
        if ext not in ALLOWED_DOC_EXT:
            return jsonify({'error': 'invalid file type'}), 400
        # Strip path separators and null bytes; keep Arabic characters intact
        original_name = raw_name.replace('/', '').replace('\\', '').replace('\x00', '') or f'document{ext}'
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            all_ids = (
                [d.get('id', '') for d in evt.get('logos', [])] +
                [d.get('id', '') for d in evt.get('posters', [])] +
                [d.get('id', '') for d in evt.get('documents', [])]
            )
            doc_id = _gen_id('EVTDOC', all_ids)
            filename = f'{doc_id}{ext}'
            file.save(os.path.join(_DOCS_DIR, filename))
            is_main = len(evt.get('documents', [])) == 0
            doc_entry = {'id': doc_id, 'filename': filename, 'original_name': original_name, 'is_main': is_main}
            evt.setdefault('documents', []).append(doc_entry)
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'document': doc_entry}), 201

    @app.route('/api/events/<event_id>/documents/<doc_id>', methods=['GET'])
    def serve_event_document(event_id, doc_id):
        with _LOCK:
            data = _load_events()
        evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
        if not evt:
            return jsonify({'error': 'not found'}), 404
        doc = next((d for d in evt.get('documents', []) if d.get('id') == doc_id), None)
        if not doc:
            return jsonify({'error': 'not found'}), 404
        return send_from_directory(_DOCS_DIR, doc['filename'], as_attachment=True,
                                   download_name=doc.get('original_name', doc['filename']))

    @app.route('/api/events/<event_id>/documents/<doc_id>', methods=['DELETE'])
    def delete_event_document(event_id, doc_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            doc = next((d for d in evt.get('documents', []) if d.get('id') == doc_id), None)
            if not doc:
                return jsonify({'error': 'not found'}), 404
            evt['documents'] = [d for d in evt['documents'] if d.get('id') != doc_id]
            if doc.get('is_main') and evt['documents']:
                evt['documents'][0]['is_main'] = True
            try:
                os.remove(os.path.join(_DOCS_DIR, doc['filename']))
            except OSError:
                pass
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    @app.route('/api/events/<event_id>/documents/<doc_id>/set-main', methods=['PATCH'])
    def set_main_event_document(event_id, doc_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            found = False
            for doc in evt.get('documents', []):
                doc['is_main'] = doc.get('id') == doc_id
                if doc['is_main']:
                    found = True
            if not found:
                return jsonify({'error': 'not found'}), 404
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    # ── Registration ───────────────────────────────────────────────────────────

    @app.route('/api/events/<event_id>/registration/<reg_type>', methods=['POST'])
    def add_registration_entry(event_id, reg_type):
        err = _require_admin()
        if err:
            return err
        if reg_type not in REG_TYPES:
            return jsonify({'error': 'invalid reg_type'}), 400
        body = request.get_json(force=True) or {}

        # Accept either person_id (registered) or unregistered_id (legacy), both map to person_id.
        # NOTE: person_id can legitimately be 0, so don't use `x or default` here — that treats
        # 0 as falsy and drops it.
        raw_pid = body.get('person_id')
        person_id = str(raw_pid).strip() if raw_pid not in (None, '') else None
        if not person_id:
            raw_unreg_id = body.get('unregistered_id')
            person_id = str(raw_unreg_id).strip() if raw_unreg_id not in (None, '') else None
        if not person_id:
            return jsonify({'error': 'person_id required'}), 400

        notes          = str(body.get('notes', '') or '').strip()
        nights_staying = body.get('nights_staying', []) or []
        if not isinstance(nights_staying, list):
            nights_staying = []

        # Load supervision context once (read-only, outside lock)
        supervision_ctx = _get_person_reg_context(person_id) if reg_type in ('supervisors', 'gs_committee') else None

        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404

            reg_list = evt.setdefault('registration', {}).setdefault(reg_type, [])
            all_reg_ids = [r.get('id', '') for section in evt['registration'].values() for r in section]
            new_reg_id = _gen_id('EVTREG', all_reg_ids)
            now = datetime.now().isoformat()

            entry = {
                'id': new_reg_id,
                'person_id': person_id,
                'notes': notes,
                'nights_staying': nights_staying,
                'added_at': now,
            }

            if reg_type in ('members', 'supervisors'):
                entry['youth_group_id'] = str(body.get('youth_group_id', '') or '').strip() or None

            if reg_type == 'members':
                conf = str(body.get('confirmation_status', 'confirmed') or 'confirmed').strip()
                if conf not in ('confirmed', 'pending'):
                    conf = 'confirmed'
                entry['confirmation_status'] = conf
                if conf == 'pending':
                    yg_key = str(entry.get('youth_group_id') or '').strip()
                    max_p = max(
                        (int(r.get('yg_priority') or 0) for r in reg_list
                         if r.get('confirmation_status') == 'pending'
                         and str(r.get('youth_group_id') or '').strip() == yg_key),
                        default=0
                    )
                    entry['yg_priority'] = max_p + 1
                else:
                    entry['yg_priority'] = None

            if reg_type in ('supervisors', 'gs_committee'):
                status_val = str(body.get('status', 'مقترح من اللجنة') or 'مقترح من اللجنة').strip()
                entry['status'] = status_val
                # Store skip_masoul_step: true if proposed by YG or person is their own superior
                yg_proposed = status_val == 'مقترح من الشبيبة'
                entry['skip_masoul_step'] = yg_proposed or bool(supervision_ctx.get('skip_masoul_step', False))

            if reg_type == 'gs_committee':
                default_role = supervision_ctx.get('gs_role') if supervision_ctx else None
                entry['role'] = str(body.get('role', '') or default_role or '').strip()
                entry['role_preset_id'] = str(body.get('role_preset_id', '') or '').strip() or None
                raw_hulls = body.get('hulls', []) or []
                entry['hulls'] = [str(h).strip() for h in raw_hulls if str(h).strip()]

            if reg_type == 'guests':
                entry['reason'] = str(body.get('reason', '') or '').strip()

            _ensure_attendance_fields(reg_type, entry)
            custom_error = _apply_custom_fields_payload(evt, reg_type, entry, body)
            if custom_error:
                return jsonify({'error': custom_error}), 400

            reg_list.append(entry)
            evt['updated_at'] = now
            _save_events(data)

        # Enrich the new entry with derived fields for the response
        response_entry = dict(entry)
        name, is_unreg = _lookup_person_name_unreg(person_id)
        response_entry['name']           = name
        response_entry['is_unregistered'] = is_unreg
        if reg_type in ('members', 'supervisors'):
            yg_id = str(entry.get('youth_group_id') or '').strip() or None
            response_entry['youth_group_label'] = _lookup_yg_label(yg_id) if yg_id else None
            response_entry['age_group']         = _lookup_age_group(person_id, yg_id) if yg_id else None
        if reg_type in ('supervisors', 'gs_committee') and supervision_ctx:
            response_entry['is_in_gs_tree']        = supervision_ctx['is_in_gs_tree']
            response_entry['gs_tree_superior_name'] = supervision_ctx['gs_tree_superior_name']
            response_entry['yg_masoul_aam_name']    = supervision_ctx['yg_masoul_aam_name']
            # skip_masoul_step is already in entry (stored above)

        return jsonify({'entry': response_entry}), 201

    @app.route('/api/events/<event_id>/registration/<reg_type>/<reg_id>', methods=['PUT'])
    def update_registration_entry(event_id, reg_type, reg_id):
        err = _require_admin()
        if err:
            return err
        if reg_type not in REG_TYPES:
            return jsonify({'error': 'invalid reg_type'}), 400
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            reg_list = evt.get('registration', {}).get(reg_type, [])
            entry = next((r for r in reg_list if r.get('id') == reg_id), None)
            if not entry:
                return jsonify({'error': 'not found'}), 404

            simple_fields = ['notes', 'nights_staying', 'youth_group_id']
            for f in simple_fields:
                if f in body:
                    entry[f] = body[f]

            # team assignment (members + supervisors)
            if reg_type in ('members', 'supervisors'):
                if 'team_id' in body:
                    entry['team_id'] = body['team_id'] or None

            # team role (supervisors only)
            if reg_type == 'supervisors':
                if 'team_role' in body:
                    entry['team_role'] = body['team_role'] or None

            if reg_type in ('supervisors', 'gs_committee'):
                if 'status' in body:
                    entry['status'] = body['status']

            if reg_type == 'gs_committee':
                for f in ['role', 'role_preset_id']:
                    if f in body:
                        entry[f] = body[f]
                if 'hulls' in body:
                    raw_hulls = body.get('hulls', []) or []
                    entry['hulls'] = [str(h).strip() for h in raw_hulls if str(h).strip()]

            if reg_type == 'guests':
                if 'reason' in body:
                    entry['reason'] = body['reason']

            _ensure_attendance_fields(reg_type, entry)
            attendance_error = _apply_attendance_payload(reg_type, entry, body)
            if attendance_error:
                return jsonify({'error': attendance_error}), 400

            custom_error = _apply_custom_fields_payload(evt, reg_type, entry, body)
            if custom_error:
                return jsonify({'error': custom_error}), 400

            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)

        return jsonify({'entry': entry})

    @app.route('/api/events/<event_id>/registration/<reg_type>/<reg_id>', methods=['DELETE'])
    def delete_registration_entry(event_id, reg_type, reg_id):
        err = _require_admin()
        if err:
            return err
        if reg_type not in REG_TYPES:
            return jsonify({'error': 'invalid reg_type'}), 400
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            reg_list = evt.get('registration', {}).get(reg_type, [])
            orig_len = len(reg_list)
            deleted = next((r for r in reg_list if r.get('id') == reg_id), None)
            evt['registration'][reg_type] = [r for r in reg_list if r.get('id') != reg_id]
            if len(evt['registration'][reg_type]) == orig_len:
                return jsonify({'error': 'not found'}), 404
            # Re-number pending priorities after deleting a pending member
            if reg_type == 'members' and deleted and deleted.get('confirmation_status') == 'pending':
                del_p   = deleted.get('yg_priority') or 0
                del_yg  = str(deleted.get('youth_group_id') or '').strip()
                for m in evt['registration']['members']:
                    if (str(m.get('youth_group_id') or '').strip() == del_yg
                            and m.get('confirmation_status') == 'pending'):
                        p = m.get('yg_priority')
                        if isinstance(p, int) and p > del_p:
                            m['yg_priority'] = p - 1
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    # ── Custom registration fields ─────────────────────────────────────────────

    @app.route('/api/events/<event_id>/registration/<reg_type>/fields', methods=['GET'])
    def list_registration_fields(event_id, reg_type):
        err = _require_admin()
        if err:
            return err
        if reg_type not in REG_TYPES:
            return jsonify({'error': 'invalid reg_type'}), 400
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            fields = list(_registration_fields(evt, reg_type))
        return jsonify({'fields': fields})

    @app.route('/api/events/<event_id>/registration/<reg_type>/fields', methods=['POST'])
    def add_registration_field(event_id, reg_type):
        err = _require_admin()
        if err:
            return err
        if reg_type not in REG_TYPES:
            return jsonify({'error': 'invalid reg_type'}), 400
        body = request.get_json(force=True) or {}

        field, error = _validate_custom_field_payload(body)
        if error:
            return jsonify({'error': error}), 400

        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404

            _ensure_registration_fields(evt)
            reg_fields = evt['registration_fields'][reg_type]
            if any(str(f.get('label') or '').strip() == field['label'] for f in reg_fields):
                return jsonify({'error': 'يوجد حقل بنفس الاسم في هذه الفئة'}), 409

            all_field_ids = [
                f.get('id', '') for section in evt['registration_fields'].values() for f in section
            ]
            field['id'] = _gen_id('EVTFLD', all_field_ids)
            field['created_at'] = datetime.now().isoformat()
            reg_fields.append(field)
            evt['updated_at'] = field['created_at']
            _save_events(data)

        return jsonify({'field': field}), 201

    @app.route('/api/events/<event_id>/registration/<reg_type>/fields/<field_id>', methods=['PUT'])
    def update_registration_field(event_id, reg_type, field_id):
        err = _require_admin()
        if err:
            return err
        if reg_type not in REG_TYPES:
            return jsonify({'error': 'invalid reg_type'}), 400
        body = request.get_json(force=True) or {}

        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404

            _ensure_registration_fields(evt)
            reg_fields = evt['registration_fields'][reg_type]
            index = next((i for i, f in enumerate(reg_fields) if f.get('id') == field_id), None)
            if index is None:
                return jsonify({'error': 'not found'}), 404

            # The type is fixed once created — changing it would invalidate stored values.
            updated, error = _validate_custom_field_payload(
                {k: v for k, v in body.items() if k != 'type'}, existing=reg_fields[index]
            )
            if error:
                return jsonify({'error': error}), 400
            if any(
                i != index and str(f.get('label') or '').strip() == updated['label']
                for i, f in enumerate(reg_fields)
            ):
                return jsonify({'error': 'يوجد حقل بنفس الاسم في هذه الفئة'}), 409

            reg_fields[index] = updated
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)

        return jsonify({'field': updated})

    @app.route('/api/events/<event_id>/registration/<reg_type>/fields/<field_id>', methods=['DELETE'])
    def delete_registration_field(event_id, reg_type, field_id):
        err = _require_admin()
        if err:
            return err
        if reg_type not in REG_TYPES:
            return jsonify({'error': 'invalid reg_type'}), 400
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404

            _ensure_registration_fields(evt)
            reg_fields = evt['registration_fields'][reg_type]
            remaining = [f for f in reg_fields if f.get('id') != field_id]
            if len(remaining) == len(reg_fields):
                return jsonify({'error': 'not found'}), 404
            evt['registration_fields'][reg_type] = remaining

            # Drop the now-orphaned values from every entry in this category.
            for entry in evt.get('registration', {}).get(reg_type, []) or []:
                if isinstance(entry, dict):
                    _ensure_entry_custom_fields(evt, reg_type, entry)

            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    # ── Teams ──────────────────────────────────────────────────────────────────

    @app.route('/api/events/<event_id>/teams', methods=['POST'])
    def create_event_teams(event_id):
        err = _require_admin()
        if err: return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            if 'teams' in body:
                new_teams = [{'team_id': 'team_' + uuid.uuid4().hex[:8], 'name': t.get('name', ''), 'created_at': datetime.now().isoformat()} for t in body['teams']]
            elif 'count' in body:
                count = max(1, int(body.get('count', 0)))
                new_teams = [{'team_id': 'team_' + uuid.uuid4().hex[:8], 'name': f'فريق {i + 1}', 'created_at': datetime.now().isoformat()} for i in range(count)]
            else:
                return jsonify({'error': 'need teams or count'}), 400
            evt.setdefault('teams', []).extend(new_teams)
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'event': evt})

    @app.route('/api/events/<event_id>/teams/<team_id>', methods=['PUT'])
    def update_event_team(event_id, team_id):
        err = _require_admin()
        if err: return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            team = next((t for t in evt.get('teams', []) if t.get('team_id') == team_id), None)
            if not team:
                return jsonify({'error': 'team not found'}), 404
            if 'name' in body:
                team['name'] = body['name']
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'team': team, 'event': evt})

    @app.route('/api/events/<event_id>/teams/<team_id>', methods=['DELETE'])
    def delete_event_team(event_id, team_id):
        err = _require_admin()
        if err: return err
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            if not any(t.get('team_id') == team_id for t in evt.get('teams', [])):
                return jsonify({'error': 'team not found'}), 404
            evt['teams'] = [t for t in evt.get('teams', []) if t.get('team_id') != team_id]
            for reg_type in ('members', 'supervisors'):
                for entry in evt.get('registration', {}).get(reg_type, []):
                    if entry.get('team_id') == team_id:
                        entry['team_id'] = None
                        if reg_type == 'supervisors':
                            entry['team_role'] = None
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'event': evt})

    @app.route('/api/events/<event_id>/teams/auto-distribute', methods=['POST'])
    def auto_distribute_event_teams(event_id):
        err = _require_admin()
        if err: return err
        body = request.get_json(force=True) or {}
        mode = body.get('mode', 'reset')
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            teams = evt.get('teams', [])
            if not teams:
                return jsonify({'error': 'no teams defined'}), 400
            _normalize_registration_attendance(evt)
            members = evt.get('registration', {}).get('members', [])
            # gender is a derived field not stored in JSON; look it up now so the
            # distribution algorithm can enforce gender balance across teams.
            gender_cache = {}
            for m in members:
                pid = str(m.get('person_id') or '').strip()
                if pid:
                    if pid not in gender_cache:
                        gender_cache[pid] = _lookup_person_gender(pid)
                    m['_gender_tmp'] = gender_cache[pid]
                else:
                    m['_gender_tmp'] = None
            # patch gender temporarily so _auto_distribute_members can read it
            for m in members:
                m['gender'] = m.pop('_gender_tmp', None)
            assignments = _auto_distribute_members(members, teams, mode=mode)
            # remove the transient gender field — it must not be persisted
            for m in members:
                m.pop('gender', None)
            if mode == 'reset':
                for m in members:
                    m['team_id'] = assignments.get(m['id']) or None
            else:
                for m in members:
                    if m['id'] in assignments:
                        m['team_id'] = assignments[m['id']]
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'event': evt, 'assigned_count': len(assignments)})

    @app.route('/api/events/<event_id>/teams/unassign', methods=['POST'])
    def unassign_event_teams(event_id):
        err = _require_admin()
        if err: return err
        body = request.get_json(force=True) or {}
        scope = body.get('scope', 'all_members')
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            reg = evt.get('registration', {})
            if scope == 'all_members':
                for m in reg.get('members', []):
                    m['team_id'] = None
            elif scope == 'all_supervisors':
                for s in reg.get('supervisors', []):
                    s['team_id'] = None
                    s['team_role'] = None
            elif scope == 'all_main':
                for s in reg.get('supervisors', []):
                    if s.get('team_role') == 'main':
                        s['team_id'] = None
                        s['team_role'] = None
            elif scope == 'all_assistant':
                for s in reg.get('supervisors', []):
                    if s.get('team_role') == 'assistant':
                        s['team_id'] = None
                        s['team_role'] = None
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'event': evt})

    # ── Member approve / deny ──────────────────────────────────────────────────

    @app.route('/api/events/<event_id>/registration/members/<reg_id>/action', methods=['POST'])
    def member_registration_action(event_id, reg_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        action = str(body.get('action', '') or '').strip()
        if action not in ('approve', 'deny'):
            return jsonify({'error': 'invalid action'}), 400

        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404

            members = evt.get('registration', {}).get('members', [])
            entry = next((m for m in members if m.get('id') == reg_id), None)
            if not entry:
                return jsonify({'error': 'not found'}), 404
            if (entry.get('confirmation_status') or 'confirmed') != 'pending':
                return jsonify({'error': 'not pending'}), 400

            yg_key   = str(entry.get('youth_group_id') or '').strip()
            old_prio = entry.get('yg_priority') or 0

            if action == 'approve':
                # Cascade (opposite of deny): approve this person and every pending
                # person ABOVE them in the same YG queue (priority <= old_prio).
                for m in members:
                    if (str(m.get('youth_group_id') or '').strip() == yg_key
                            and m.get('confirmation_status') == 'pending'):
                        p = m.get('yg_priority')
                        if m.get('id') == reg_id or (isinstance(p, int) and p <= old_prio):
                            m['confirmation_status'] = 'confirmed'
                            m['yg_priority'] = None
                # Compact remaining pending (priority > old_prio) down by old_prio
                for m in members:
                    if (str(m.get('youth_group_id') or '').strip() == yg_key
                            and m.get('confirmation_status') == 'pending'):
                        p = m.get('yg_priority')
                        if isinstance(p, int) and p > old_prio:
                            m['yg_priority'] = p - old_prio

            else:  # deny
                entry['confirmation_status'] = 'denied'
                entry['yg_priority'] = None
                # Cascade: deny all pending in same YG with priority >= old_prio
                for m in members:
                    if (m.get('id') != reg_id
                            and str(m.get('youth_group_id') or '').strip() == yg_key
                            and m.get('confirmation_status') == 'pending'):
                        p = m.get('yg_priority')
                        if isinstance(p, int) and p >= old_prio:
                            m['confirmation_status'] = 'denied'
                            m['yg_priority'] = None

            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    # ── YG Apologies ───────────────────────────────────────────────────────────

    @app.route('/api/events/<event_id>/yg-apologies', methods=['POST'])
    def add_yg_apology(event_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        youth_group_id = str(body.get('youth_group_id', '') or '').strip()
        if not youth_group_id:
            return jsonify({'error': 'youth_group_id required'}), 400
        reason = str(body.get('reason', '') or '').strip()
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            apologies = evt.setdefault('yg_apologies', [])
            all_ids = [a.get('id', '') for a in apologies]
            new_id = _gen_id('EVTAPOL', all_ids)
            now = datetime.now().isoformat()
            entry = {
                'id': new_id,
                'youth_group_id': youth_group_id,
                'reason': reason,
                'apologized_at': now,
            }
            apologies.append(entry)
            evt['updated_at'] = now
            _save_events(data)
        response_entry = dict(entry)
        response_entry['youth_group_label'] = _lookup_yg_label(youth_group_id)
        return jsonify({'entry': response_entry}), 201

    @app.route('/api/events/<event_id>/yg-apologies/<apology_id>', methods=['DELETE'])
    def delete_yg_apology(event_id, apology_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            orig = evt.get('yg_apologies', [])
            evt['yg_apologies'] = [a for a in orig if a.get('id') != apology_id]
            if len(evt['yg_apologies']) == len(orig):
                return jsonify({'error': 'not found'}), 404
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    # ── Person registration context ────────────────────────────────────────────

    @app.route('/api/events/persons/<person_id>/reg-context', methods=['GET'])
    def get_person_reg_context_route(person_id):
        err = _require_admin()
        if err:
            return err
        ctx = _get_person_reg_context(person_id)
        return jsonify({'person_id': person_id, **ctx})

    # ── Compute nights preview ─────────────────────────────────────────────────

    @app.route('/api/events/compute-nights', methods=['POST'])
    def compute_nights_preview():
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        nights = _compute_nights(body.get('start_datetime', ''), body.get('end_datetime', ''))
        return jsonify({'nights': nights})

    # ── Schedule Presets (global) ──────────────────────────────────────────────

    @app.route('/api/schedule-presets', methods=['GET'])
    def list_schedule_presets():
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_schedule_presets()
        return jsonify({'presets': data.get('presets', [])})

    @app.route('/api/schedule-presets', methods=['POST'])
    def create_schedule_preset():
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        title = str(body.get('title', '') or '').strip()
        description = str(body.get('description', '') or '').strip()
        default_duration = body.get('default_duration_minutes')
        if not title:
            return jsonify({'error': 'title required'}), 400
        try:
            default_duration = int(default_duration) if default_duration is not None else None
        except (TypeError, ValueError):
            default_duration = None
        with _LOCK:
            data = _load_schedule_presets()
            existing_ids = [p.get('id', '') for p in data.get('presets', [])]
            new_id = _gen_id('SCHPRE', existing_ids)
            new_preset = {
                'id': new_id,
                'title': title,
                'description': description,
                'default_duration_minutes': default_duration,
                'created_at': datetime.now().isoformat(),
            }
            data.setdefault('presets', []).append(new_preset)
            _save_schedule_presets(data)
        return jsonify({'preset': new_preset}), 201

    @app.route('/api/schedule-presets/<preset_id>', methods=['PUT'])
    def update_schedule_preset(preset_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_schedule_presets()
            preset = next((p for p in data.get('presets', []) if p.get('id') == preset_id), None)
            if not preset:
                return jsonify({'error': 'not found'}), 404
            if 'title' in body:
                preset['title'] = str(body['title'] or '').strip()
            if 'description' in body:
                preset['description'] = str(body['description'] or '').strip()
            if 'default_duration_minutes' in body:
                v = body['default_duration_minutes']
                try:
                    preset['default_duration_minutes'] = int(v) if v is not None else None
                except (TypeError, ValueError):
                    preset['default_duration_minutes'] = None
            preset['updated_at'] = datetime.now().isoformat()
            _save_schedule_presets(data)
        return jsonify({'preset': preset})

    @app.route('/api/schedule-presets/<preset_id>', methods=['DELETE'])
    def delete_schedule_preset(preset_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_schedule_presets()
            orig = data.get('presets', [])
            data['presets'] = [p for p in orig if p.get('id') != preset_id]
            if len(data['presets']) == len(orig):
                return jsonify({'error': 'not found'}), 404
            _save_schedule_presets(data)
        return jsonify({'ok': True})

    # ── Event Schedule Entries ─────────────────────────────────────────────────

    @app.route('/api/events/<event_id>/schedule/entries', methods=['POST'])
    def add_schedule_entry(event_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        title = str(body.get('title', '') or '').strip()
        description = str(body.get('description', '') or '').strip()
        preset_id = body.get('preset_id') or None
        try:
            duration = int(body.get('duration_minutes', 0) or 0)
        except (TypeError, ValueError):
            duration = 0
        if not title:
            return jsonify({'error': 'title required'}), 400
        if duration < 1:
            return jsonify({'error': 'duration_minutes must be >= 1'}), 400
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            existing = evt.setdefault('schedule', [])
            all_ids = [e.get('id', '') for e in existing]
            new_id = _gen_id('SCHENT', all_ids)
            new_order = max((e.get('order', 0) for e in existing), default=-1) + 1
            entry = {
                'id': new_id,
                'title': title,
                'description': description,
                'duration_minutes': duration,
                'preset_id': preset_id,
                'order': new_order,
                'created_at': datetime.now().isoformat(),
            }
            existing.append(entry)
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'entry': entry}), 201

    @app.route('/api/events/<event_id>/schedule/entries/<entry_id>', methods=['PUT'])
    def update_schedule_entry(event_id, entry_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            entry = next((e for e in evt.get('schedule', []) if e.get('id') == entry_id), None)
            if not entry:
                return jsonify({'error': 'entry not found'}), 404
            if 'title' in body:
                entry['title'] = str(body['title'] or '').strip()
            if 'description' in body:
                entry['description'] = str(body['description'] or '').strip()
            if 'duration_minutes' in body:
                try:
                    entry['duration_minutes'] = max(1, int(body['duration_minutes'] or 1))
                except (TypeError, ValueError):
                    pass
            if 'preset_id' in body:
                entry['preset_id'] = body['preset_id'] or None
            entry['updated_at'] = datetime.now().isoformat()
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'entry': entry})

    @app.route('/api/events/<event_id>/schedule/entries/<entry_id>', methods=['DELETE'])
    def delete_schedule_entry(event_id, entry_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            orig = evt.get('schedule', [])
            evt['schedule'] = [e for e in orig if e.get('id') != entry_id]
            if len(evt['schedule']) == len(orig):
                return jsonify({'error': 'entry not found'}), 404
            # Re-index order after deletion
            for i, e in enumerate(sorted(evt['schedule'], key=lambda x: x.get('order', 0))):
                e['order'] = i
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    @app.route('/api/events/<event_id>/schedule/reorder', methods=['POST'])
    def reorder_schedule_entries(event_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        ordered_ids = body.get('ordered_ids', [])
        if not isinstance(ordered_ids, list):
            return jsonify({'error': 'ordered_ids must be a list'}), 400
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            entries_by_id = {e['id']: e for e in evt.get('schedule', [])}
            reordered = []
            for i, eid in enumerate(ordered_ids):
                if eid in entries_by_id:
                    entries_by_id[eid]['order'] = i
                    reordered.append(entries_by_id[eid])
            # Append any entries not mentioned in ordered_ids at the end
            mentioned = set(ordered_ids)
            tail_order = len(reordered)
            for e in evt.get('schedule', []):
                if e['id'] not in mentioned:
                    e['order'] = tail_order
                    reordered.append(e)
                    tail_order += 1
            evt['schedule'] = reordered
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'schedule': reordered})

    # ── Event Schedule Exceptions ──────────────────────────────────────────────

    @app.route('/api/events/<event_id>/schedule/exceptions', methods=['POST'])
    def add_schedule_exception(event_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        title = str(body.get('title', '') or '').strip()
        description = str(body.get('description', '') or '').strip()
        fixed_time = str(body.get('fixed_time', '') or '').strip()
        if not title:
            return jsonify({'error': 'title required'}), 400
        if not fixed_time:
            return jsonify({'error': 'fixed_time required'}), 400
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            existing = evt.setdefault('schedule_exceptions', [])
            all_ids = [e.get('id', '') for e in existing]
            new_id = _gen_id('SCHEXC', all_ids)
            exc = {
                'id': new_id,
                'title': title,
                'description': description,
                'fixed_time': fixed_time,
                'created_at': datetime.now().isoformat(),
            }
            existing.append(exc)
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'exception': exc}), 201

    @app.route('/api/events/<event_id>/schedule/exceptions/<exc_id>', methods=['PUT'])
    def update_schedule_exception(event_id, exc_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            exc = next((e for e in evt.get('schedule_exceptions', []) if e.get('id') == exc_id), None)
            if not exc:
                return jsonify({'error': 'exception not found'}), 404
            if 'title' in body:
                exc['title'] = str(body['title'] or '').strip()
            if 'description' in body:
                exc['description'] = str(body['description'] or '').strip()
            if 'fixed_time' in body:
                exc['fixed_time'] = str(body['fixed_time'] or '').strip()
            exc['updated_at'] = datetime.now().isoformat()
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'exception': exc})

    @app.route('/api/events/<event_id>/schedule/exceptions/<exc_id>', methods=['DELETE'])
    def delete_schedule_exception(event_id, exc_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            events = data.get('events', [])
            evt = next((e for e in events if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            orig = evt.get('schedule_exceptions', [])
            evt['schedule_exceptions'] = [e for e in orig if e.get('id') != exc_id]
            if len(evt['schedule_exceptions']) == len(orig):
                return jsonify({'error': 'exception not found'}), 404
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    # ── Bedroom helpers ───────────────────────────────────────────────────────

    def _room_quality_score(room):
        score = 0
        if room.get('is_vip'):
            score += 10000
        for f in (room.get('features') or []):
            if f == 'مكيف':
                score += 1000
            elif f == 'مروحة':
                score += 500
            else:
                score += 50
        score -= (room.get('capacity') or 99) * 10
        return score

    def _load_rooms_for_event(evt):
        try:
            from core.routes_camp_locations import _load as _lc_load
            locs_data = _lc_load()
        except Exception:
            return []
        loc_ids = {loc.get('camp_location_id') for loc in (evt.get('locations') or []) if loc.get('camp_location_id')}
        out = []
        for loc in locs_data.get('locations', []):
            if loc.get('id') not in loc_ids:
                continue
            for bld in loc.get('buildings', []):
                for flr in bld.get('floors', []):
                    for rm in flr.get('rooms', []):
                        out.append({
                            'location_id': loc['id'],
                            'location_name': loc.get('name', ''),
                            'building_id': bld['id'],
                            'building_name': bld.get('name', ''),
                            'floor_id': flr['id'],
                            'floor_name': flr.get('name', ''),
                            'room': rm,
                        })
        return out

    def _auto_distribute_bedrooms(evt, config, rooms_flat):
        occupied    = set(config.get('occupied_rooms') or [])
        floor_gen   = config.get('floor_gender') or {}
        bld_gen     = config.get('building_gender') or {}
        opts        = config.get('distribution_options') or {}
        yg_cohesion = opts.get('yg_cohesion', 'none')
        leader_pl   = opts.get('leader_placement', 'none')
        compactness = opts.get('compactness', 'compact')
        hull_prio   = config.get('hull_priority') or []
        multi_ov    = config.get('multi_hull_overrides') or {}

        hull_rank = {}
        for item in hull_prio:
            r = item.get('rank', 999)
            for h in (item.get('hulls') or []):
                hull_rank[h] = r

        event_nights = set(evt.get('nights') or [])
        reg = evt.get('registration') or {}

        # Use gender from enriched registration data (already computed by caller)
        # as the primary source; fall back to store lookup only when missing.
        pid_gender = {}
        for rt in ('members', 'supervisors', 'gs_committee', 'guests'):
            for e in reg.get(rt, []):
                pid = str(e.get('person_id') or '').strip()
                g   = str(e.get('gender') or '').strip()
                if pid and g:
                    pid_gender[pid] = g

        gcache, scache = {}, {}

        def gget(pid):
            if pid not in gcache:
                gcache[pid] = pid_gender.get(pid) or _lookup_person_gender(pid) or ''
            return gcache[pid]

        def sget(pid):
            if pid not in scache:
                try:
                    row = S.get_spouse_for_person(S.store, pid)
                    scache[pid] = S._person_id_key((row or {}).get('spouse_person_id'))
                except Exception:
                    scache[pid] = ''
            return scache[pid]

        cands = []

        def add(e, rtype, pg, ps, yg=None, hull=None):
            if _is_attendance_apologized(e):
                return
            ns = [n for n in (e.get('nights_staying') or []) if n in event_nights]
            if not ns:
                return
            cands.append({
                'reg_id': e['id'],
                'pid':    str(e.get('person_id') or ''),
                'rtype':  rtype, 'nights': ns, 'pg': pg, 'ps': ps,
                'yg':     yg, 'hull': hull,
            })

        for e in reg.get('guests', []):
            add(e, 'guests', 0, 0)
        for e in reg.get('gs_committee', []):
            if str(e.get('status') or '').strip() != FINAL_PERSON_APPROVED_STATUS:
                continue
            hulls = e.get('hulls') or []
            ah    = multi_ov.get(e['id']) or (hulls[0] if hulls else None)
            add(e, 'gs_committee', 1, hull_rank.get(ah, 999) if ah else 999, hull=ah)
        for e in reg.get('supervisors', []):
            if str(e.get('status') or '').strip() == FINAL_PERSON_APPROVED_STATUS:
                add(e, 'supervisors', 2, 0, yg=e.get('youth_group_id'))
        for e in reg.get('members', []):
            if (e.get('confirmation_status') or 'confirmed') == 'confirmed':
                add(e, 'members', 3, 0, yg=e.get('youth_group_id'))

        random.shuffle(cands)
        if leader_pl == 'with_members':
            # Members must be placed before supervisors so supervisors can join their YG rooms
            def _sort_key(c):
                if c['rtype'] == 'members':
                    return (2, c['ps'])
                if c['rtype'] == 'supervisors':
                    return (3, c['ps'])
                return (c['pg'], c['ps'])
            cands.sort(key=_sort_key)
        else:
            cands.sort(key=lambda c: (c['pg'], c['ps']))

        valid = [r for r in rooms_flat if r['room'].get('id') not in occupied]
        valid.sort(key=lambda r: _room_quality_score(r['room']), reverse=True)

        # ── Per-room state ──────────────────────────────────────────────────
        rm_occ      = {}  # {rid: {night: count}}
        rm_gen      = {}  # {rid: 'ذكر'|'أنثى'|None}
        rm_pids     = {}  # {rid: set of person_ids}
        rm_has_gs   = {}  # {rid: bool}  – contains gs_committee
        rm_has_sup  = {}  # {rid: bool}  – contains supervisors (المسؤولون only)
        rm_has_mem  = {}  # {rid: bool}  – contains members
        rm_has_guest= {}  # {rid: bool}  – contains a guest (room is private)
        rm_yg       = {}  # {rid: set of yg_ids}
        rm_info     = {}  # {rid: flat room dict}

        for r in valid:
            rid = r['room']['id']
            rm_occ[rid]       = {}
            rm_gen[rid]       = None
            rm_pids[rid]      = set()
            rm_has_gs[rid]    = False
            rm_has_sup[rid]   = False
            rm_has_mem[rid]   = False
            rm_has_guest[rid] = False
            rm_yg[rid]        = set()
            rm_info[rid]      = r

        # Seed counter from existing assignments to avoid ID collisions on reset=False
        existing_asgns = evt.get('bedroom_assignments') or []
        _pfx  = 'BDRM'
        _used = {int(a['id'][len(_pfx):]) for a in existing_asgns
                 if str(a.get('id', '')).startswith(_pfx)
                 and str(a.get('id', ''))[len(_pfx):].isdigit()}
        ctr = [max(_used, default=0)]

        yg_home, asgns = {}, []

        def mk_id():
            ctr[0] += 1
            return f'BDRM{ctr[0]:06d}'

        def cap(rid):
            return rm_info[rid]['room'].get('capacity') or 1

        def mocc(rid, ns):
            return max((rm_occ[rid].get(n, 0) for n in ns), default=0)

        # ── Checks ─────────────────────────────────────────────────────────

        def gok(pid, rid):
            """Gender + floor/building lock check."""
            g = gget(pid)
            r = rm_info.get(rid)
            if not r:
                return False
            gk = 'male' if g == 'ذكر' else ('female' if g == 'أنثى' else None)
            if gk:
                if floor_gen.get(r['floor_id']) not in (None, gk):
                    return False
                if bld_gen.get(r['building_id']) not in (None, gk):
                    return False
            rg = rm_gen.get(rid)
            if rg and g and rg != g:
                # Opposite gender: only allowed for spouse pairs
                sp = sget(pid)
                return bool(sp and sp in rm_pids.get(rid, set()))
            return True

        def fits(ns, rid):
            """Night-based capacity check."""
            c = cap(rid)
            return all(rm_occ[rid].get(n, 0) < c for n in ns)

        def category_ok(rid, rtype):
            """Hard inter-category rules — never relaxed."""
            # Guest rooms are private: nobody else enters, guests don't share
            if rm_has_guest.get(rid):
                return False  # room already has a guest → nobody can join
            if rtype == 'guests' and (rm_has_gs[rid] or rm_has_sup[rid] or rm_has_mem[rid]):
                return False  # guest needs an empty room
            # الأمانة العامة واللجان never shares with المشاركون or المسؤولون
            if rtype == 'gs_committee' and (rm_has_sup[rid] or rm_has_mem[rid]):
                return False
            if rtype in ('members', 'supervisors') and rm_has_gs[rid]:
                return False
            return True

        def leader_ok(rid, rtype):
            """Leader placement soft constraint."""
            if leader_pl == 'alone':
                if rtype == 'supervisors' and rm_has_mem[rid]:
                    return False  # supervisor room shouldn't have members
                if rtype == 'members' and rm_has_sup[rid] and not rm_has_mem[rid]:
                    return False  # member room shouldn't be supervisor-only
            return True

        def yg_split_ok(rid, yg):
            if yg_cohesion == 'split' and yg and yg in rm_yg.get(rid, set()):
                return False
            return True

        # ── Assignment ─────────────────────────────────────────────────────

        def do_asgn(c, rid):
            pid = c['pid']
            g   = gget(pid)
            for n in c['nights']:
                rm_occ[rid][n] = rm_occ[rid].get(n, 0) + 1
            if g and not rm_gen[rid]:
                rm_gen[rid] = g
            rm_pids[rid].add(pid)
            if c['yg']:
                rm_yg[rid].add(c['yg'])
            rt = c['rtype']
            if rt == 'guests':
                rm_has_guest[rid] = True
            elif rt == 'gs_committee':
                rm_has_gs[rid] = True
            elif rt == 'supervisors':
                rm_has_sup[rid] = True
            elif rt == 'members':
                rm_has_mem[rid] = True
            asgns.append({
                'id': mk_id(), 'reg_id': c['reg_id'], 'person_id': pid,
                'reg_type': rt, 'room_id': rid,
                'nights': c['nights'], 'active_hull': c['hull'],
            })

        def sorted_rids(ns, rtype):
            """Sort room IDs by the compactness preference."""
            rids = list(rm_info.keys())
            if rtype == 'guests':
                # Guests: prefer smallest room with best quality (private = fewest beds)
                rids.sort(key=lambda r: (
                    rm_info[r]['room'].get('capacity', 99),
                    -_room_quality_score(rm_info[r]['room']),
                ))
            elif compactness == 'compact':
                rids.sort(key=lambda r: (-mocc(r, ns), -_room_quality_score(rm_info[r]['room'])))
            else:
                rids.sort(key=lambda r: (mocc(r, ns), -_room_quality_score(rm_info[r]['room'])))
            return rids

        def pick_room(cand, force=None):
            pid, ns, rtype, yg = cand['pid'], cand['nights'], cand['rtype'], cand['yg']

            # Try the forced room first (all hard rules must pass)
            if force and force in rm_info:
                if (gok(pid, force) and fits(ns, force)
                        and category_ok(force, rtype)
                        and leader_ok(force, rtype)
                        and yg_split_ok(force, yg)):
                    return force

            rids = sorted_rids(ns, rtype)

            # Pass 1: all constraints
            for rid in rids:
                if (gok(pid, rid) and fits(ns, rid)
                        and category_ok(rid, rtype)
                        and leader_ok(rid, rtype)
                        and yg_split_ok(rid, yg)):
                    return rid

            # Pass 2: relax leader_pl and yg_split — keep hard category + gender + capacity
            for rid in rids:
                if gok(pid, rid) and fits(ns, rid) and category_ok(rid, rtype):
                    return rid

            return None

        # ── Main placement loop ─────────────────────────────────────────────

        for cand in cands:
            g      = gget(cand['pid'])
            yg_key = (cand['yg'], g) if cand['yg'] else None

            if yg_cohesion == 'together' and yg_key:
                # Prefer the room the YG has been filling; update yg_home to the
                # actual room so the group stays together even after a room fills.
                rid = pick_room(cand, force=yg_home.get(yg_key))

            elif leader_pl == 'with_members' and cand['rtype'] == 'supervisors' and cand['yg']:
                # Find rooms that already contain this YG.
                # Sort candidate rooms by quality/compactness so we pick the best.
                yg_rids = [r for r, ygs in rm_yg.items()
                           if cand['yg'] in ygs
                           and gok(cand['pid'], r)
                           and fits(cand['nights'], r)
                           and category_ok(r, cand['rtype'])]
                if yg_rids:
                    if compactness == 'compact':
                        yg_rids.sort(key=lambda r: (-mocc(r, cand['nights']),
                                                     -_room_quality_score(rm_info[r]['room'])))
                    else:
                        yg_rids.sort(key=lambda r: (mocc(r, cand['nights']),
                                                     -_room_quality_score(rm_info[r]['room'])))
                    rid = yg_rids[0]
                else:
                    rid = pick_room(cand)

            else:
                rid = pick_room(cand)

            if rid:
                do_asgn(cand, rid)
                # Always update yg_home so subsequent members of the same YG
                # continue filling THIS room (not only the first one they used).
                if yg_key:
                    yg_home[yg_key] = rid

        return asgns

    # ── Bedroom routes ────────────────────────────────────────────────────────

    @app.route('/api/events/<event_id>/bedroom', methods=['GET'])
    def get_event_bedroom(event_id):
        with _LOCK:
            data = _load_events()
            evt  = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
        if not evt:
            return jsonify({'error': 'not found'}), 404
        _normalize_registration_attendance(evt)
        _enrich_all_registrations(evt)
        rooms_flat = _load_rooms_for_event(evt)
        return jsonify({
            'config':      evt.get('bedroom_config') or {},
            'assignments': evt.get('bedroom_assignments') or [],
            'rooms_flat':  rooms_flat,
            'nights':      evt.get('nights') or [],
            'registration': evt.get('registration') or {},
        })

    @app.route('/api/events/<event_id>/bedroom-config', methods=['PUT'])
    def update_bedroom_config(event_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_events()
            evt  = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            cfg = evt.setdefault('bedroom_config', {})
            for key in ('hull_priority', 'multi_hull_overrides', 'floor_gender',
                        'building_gender', 'occupied_rooms', 'distribution_options'):
                if key in body:
                    cfg[key] = body[key]
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'config': cfg})

    @app.route('/api/events/<event_id>/bedroom-assignments/auto-distribute', methods=['POST'])
    def auto_distribute_bedrooms(event_id):
        err = _require_admin()
        if err:
            return err
        body  = request.get_json(force=True) or {}
        reset = body.get('reset', True)
        with _LOCK:
            data = _load_events()
            evt  = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            rooms_flat = _load_rooms_for_event(evt)
            if not rooms_flat:
                return jsonify({'error': 'no rooms found for this event'}), 400
            config = evt.get('bedroom_config') or {}
            _normalize_registration_attendance(evt)
            _enrich_all_registrations(evt)
            new_asgns = _auto_distribute_bedrooms(evt, config, rooms_flat)
            if reset:
                evt['bedroom_assignments'] = new_asgns
            else:
                existing     = evt.get('bedroom_assignments') or []
                new_reg_ids  = {a['reg_id'] for a in new_asgns}
                evt['bedroom_assignments'] = [a for a in existing if a['reg_id'] not in new_reg_ids] + new_asgns
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'assignments': evt['bedroom_assignments'], 'count': len(new_asgns)})

    @app.route('/api/events/<event_id>/bedroom-assignments', methods=['DELETE'])
    def clear_bedroom_assignments(event_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt  = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            evt['bedroom_assignments'] = []
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})

    @app.route('/api/events/<event_id>/bedroom-assignments', methods=['POST'])
    def create_bedroom_assignment(event_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        reg_id   = str(body.get('reg_id') or '').strip()
        person_id = str(body.get('person_id') or '').strip()
        reg_type  = str(body.get('reg_type') or '').strip()
        room_id   = str(body.get('room_id') or '').strip()
        nights    = body.get('nights') or []
        if not all([reg_id, person_id, reg_type, room_id, nights]):
            return jsonify({'error': 'reg_id, person_id, reg_type, room_id, nights required'}), 400
        with _LOCK:
            data = _load_events()
            evt  = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            existing = evt.setdefault('bedroom_assignments', [])
            _pfx  = 'BDRM'
            _nums = {int(a['id'][len(_pfx):]) for a in existing
                     if str(a.get('id', '')).startswith(_pfx) and str(a.get('id', ''))[len(_pfx):].isdigit()}
            new_id = f'{_pfx}{(max(_nums, default=0) + 1):06d}'
            asgn = {
                'id': new_id, 'reg_id': reg_id, 'person_id': person_id,
                'reg_type': reg_type, 'room_id': room_id, 'nights': nights,
                'active_hull': body.get('active_hull'),
            }
            existing.append(asgn)
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'assignment': asgn}), 201

    @app.route('/api/events/<event_id>/bedroom-assignments/<asgn_id>', methods=['PUT'])
    def update_bedroom_assignment(event_id, asgn_id):
        err = _require_admin()
        if err:
            return err
        body = request.get_json(force=True) or {}
        with _LOCK:
            data = _load_events()
            evt  = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            asgn = next((a for a in (evt.get('bedroom_assignments') or []) if a.get('id') == asgn_id), None)
            if not asgn:
                return jsonify({'error': 'assignment not found'}), 404
            for key in ('room_id', 'nights', 'active_hull'):
                if key in body:
                    asgn[key] = body[key]
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'assignment': asgn})

    @app.route('/api/events/<event_id>/bedroom-assignments/<asgn_id>', methods=['DELETE'])
    def delete_bedroom_assignment(event_id, asgn_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            data = _load_events()
            evt  = next((e for e in data.get('events', []) if e.get('id') == event_id), None)
            if not evt:
                return jsonify({'error': 'not found'}), 404
            orig = evt.get('bedroom_assignments') or []
            evt['bedroom_assignments'] = [a for a in orig if a.get('id') != asgn_id]
            if len(evt['bedroom_assignments']) == len(orig):
                return jsonify({'error': 'not found'}), 404
            evt['updated_at'] = datetime.now().isoformat()
            _save_events(data)
        return jsonify({'ok': True})
