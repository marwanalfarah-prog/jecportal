import base64
import copy
import datetime as _dt
import os

import pandas as pd
from flask import jsonify, request

from core import state as S
from core.routes_auth import _changed_by_user_id, _current_user, _require_admin
from core.routes_privileges import get_user_promotion_access


AGE_GROUP_ORDER = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
_AGE_ORDER_INDEX = {name: idx for idx, name in enumerate(AGE_GROUP_ORDER)}

DEFAULT_PROMOTION_AGE_RULES = [
    {
        "age_group": 'البراعم',
        "min_birth_year": 2015,
        "max_birth_year": None,
        "promotion_to": 'الإعدادي',
    },
    {
        "age_group": 'الإعدادي',
        "min_birth_year": 2012,
        "max_birth_year": 2014,
        "promotion_to": 'الثانوي',
    },
    {
        "age_group": 'الثانوي',
        "min_birth_year": 2008,
        "max_birth_year": 2011,
        "promotion_to": 'الجامعيّة',
    },
    {
        "age_group": 'الجامعيّة',
        "min_birth_year": None,
        "max_birth_year": 2007,
        "promotion_to": None,
    },
    {
        "age_group": 'العاملة',
        "min_birth_year": None,
        "max_birth_year": None,
        "promotion_to": None,
    },
]

_PROMOTION_RULES_PATH = os.path.join(S.db.data_dir, "config", "promotion_rules.json")


def _as_year_or_none(value):
    if value is None:
        return None
    try:
        text = str(value).strip()
        if text in ('', 'nan', 'None', 'null'):
            return None
        return int(float(text))
    except Exception:
        return None


def _normalize_age_rule(rule: dict | None, default_rule: dict) -> dict:
    src = rule or {}
    age_group = default_rule['age_group']

    has_min = 'min_birth_year' in src
    has_max = 'max_birth_year' in src
    min_year = _as_year_or_none(src.get('min_birth_year')) if has_min else None
    max_year = _as_year_or_none(src.get('max_birth_year')) if has_max else None
    if not has_min:
        min_year = default_rule.get('min_birth_year')
    if not has_max:
        max_year = default_rule.get('max_birth_year')

    has_promo = 'promotion_to' in src
    promo_to = src.get('promotion_to') if has_promo else default_rule.get('promotion_to')
    if promo_to not in AGE_GROUP_ORDER and promo_to is not None:
        promo_to = default_rule.get('promotion_to')
    if promo_to == age_group:
        promo_to = None

    return {
        'age_group': age_group,
        'min_birth_year': min_year,
        'max_birth_year': max_year,
        'promotion_to': promo_to,
    }


def _normalize_group_promotion_rules(rules) -> list[dict]:
    in_rules = rules if isinstance(rules, list) else []
    by_group = {}
    for item in in_rules:
        if not isinstance(item, dict):
            continue
        ag = item.get('age_group')
        if ag in AGE_GROUP_ORDER:
            by_group[ag] = item

    return [
        _normalize_age_rule(by_group.get(default['age_group']), default)
        for default in DEFAULT_PROMOTION_AGE_RULES
    ]


def _load_promotion_rules() -> dict:
    data = S.db.load_json_file(_PROMOTION_RULES_PATH, {})
    if not isinstance(data.get('group_age_rules'), dict):
        data['group_age_rules'] = {}
        S.db.save_json_file(_PROMOTION_RULES_PATH, data)
    return data


def _save_promotion_rules(data: dict):
    S.db.save_json_file(_PROMOTION_RULES_PATH, data)


def _group_promotion_rules(rules_dict: dict, group_id: str | None) -> list[dict]:
    rules_by_group = rules_dict.get('group_age_rules') if isinstance(rules_dict.get('group_age_rules'), dict) else {}
    if group_id and group_id in rules_by_group:
        return _normalize_group_promotion_rules(rules_by_group.get(group_id))
    return copy.deepcopy(DEFAULT_PROMOTION_AGE_RULES)


def _make_promo_id(person_type: str, person_id, youth_group: str, from_age_group: str) -> str:
    key = f"{person_type}|{person_id}|{youth_group}|{from_age_group}"
    return base64.urlsafe_b64encode(key.encode('utf-8')).decode('ascii').rstrip('=')


def _parse_promo_id(promo_id: str):
    try:
        padded = promo_id + '=' * (-len(promo_id) % 4)
        key = base64.urlsafe_b64decode(padded).decode('utf-8')
        parts = key.split('|', 3)
        return parts if len(parts) == 4 else None
    except Exception:
        return None


def _birth_year_in_rule(birth_year: int, rule: dict) -> bool:
    min_year = _as_year_or_none(rule.get('min_birth_year'))
    max_year = _as_year_or_none(rule.get('max_birth_year'))
    if min_year is not None and birth_year < min_year:
        return False
    if max_year is not None and birth_year > max_year:
        return False
    return min_year is not None or max_year is not None


def _expected_age_group_for_group(birth_year, current_age_group=None, rules: list[dict] | None = None) -> str | None:
    if birth_year is None:
        return None
    try:
        by = int(birth_year)
    except (ValueError, TypeError):
        return None

    normalized_rules = _normalize_group_promotion_rules(rules)
    rule_by_group = {r['age_group']: r for r in normalized_rules}
    current_idx = _AGE_ORDER_INDEX.get(current_age_group)

    target_from_year = None
    for rule in normalized_rules:
        if _birth_year_in_rule(by, rule):
            candidate = rule.get('age_group')
            candidate_idx = _AGE_ORDER_INDEX.get(candidate)
            if candidate_idx is None:
                continue
            if current_idx is None or candidate_idx > current_idx:
                target_from_year = candidate
            break

    if target_from_year:
        if current_age_group in _SAME_TIER and target_from_year in _SAME_TIER:
            return None
        return target_from_year

    current_rule = rule_by_group.get(current_age_group)
    if current_rule and not _birth_year_in_rule(by, current_rule):
        target = current_rule.get('promotion_to')
        target_idx = _AGE_ORDER_INDEX.get(target)
        if target_idx is not None and (current_idx is None or target_idx > current_idx):
            if current_age_group in _SAME_TIER and target in _SAME_TIER:
                return None
            return target

    return _expected_age_group(by, current_age_group=current_age_group)


def _expected_age_group(birth_year, current_age_group=None) -> str | None:
    if birth_year is None:
        return None
    try:
        by = int(birth_year)
    except (ValueError, TypeError):
        return None
    if by >= 2015:
        return 'البراعم'
    if 2012 <= by <= 2014:
        return 'الإعدادي'
    if 2008 <= by <= 2011:
        return 'الثانوي'
    if by <= 2007:
        if current_age_group == 'الثانوي':
            return 'الجامعيّة'
        return None
    return None


_SAME_TIER = {'الجامعيّة', 'العاملة'}


def _now_str() -> str:
    return _dt.datetime.utcnow().isoformat()[:19] + 'Z'


def _scan_for_pending(result, person_type, persons_df, pyg_df, youth_groups_filter, rules_cache, rules_dict):
    if persons_df.empty or pyg_df.empty:
        return

    persons_by_id = {
        str(row.get('person_id', '')): row
        for row in persons_df.replace({pd.NA: None, float('nan'): None}).to_dict('records')
    }
    seen = set()

    for _, pyg_row in pyg_df.replace({pd.NA: None, float('nan'): None}).iterrows():
        pid = pyg_row.get('person_id')
        yg = pyg_row.get(S.YOUTH_GROUP_ID_COL)
        ag = pyg_row.get('age_group')
        if pid is None or not yg or not ag:
            continue
        if youth_groups_filter and yg not in youth_groups_filter:
            continue

        pid_str = str(pid)
        person = persons_by_id.get(pid_str)
        if person is None:
            continue

        by_raw = person.get('birth_year')
        by = None
        try:
            if by_raw and str(by_raw) not in ('nan', 'None', ''):
                by = int(by_raw)
        except (ValueError, TypeError):
            pass
        if by is None:
            continue

        if yg not in rules_cache:
            rules_cache[yg] = _group_promotion_rules(rules_dict, yg)
        expected = _expected_age_group_for_group(by, current_age_group=ag, rules=rules_cache[yg])
        if expected is None or ag == expected:
            continue
        if ag in _SAME_TIER and expected in _SAME_TIER:
            continue

        key = (pid_str, yg, ag)
        if key in seen:
            continue
        seen.add(key)

        display_name = " ".join(
            str(person.get(k) or "").strip()
            for k in ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
            if str(person.get(k) or "").strip()
        )
        pid_out = int(pid_str) if person_type == 'registered' else pid_str

        result.append({
            'id': _make_promo_id(person_type, pid_str, yg, ag),
            'person_type': person_type,
            'person_id': pid_out,
            'display_name': display_name,
            'birth_year': by,
            'youth_group': yg,
            'from_age_group': ag,
            'to_age_group': expected,
            'status': 'pending',
            'approved_by': None,
        })


def _build_approved(result, person_type, pyg_all_df, persons_df, youth_groups_filter):
    if pyg_all_df.empty or S.SCD_CURRENTLY_ACTIVE_FLAG_COL not in pyg_all_df.columns:
        return

    inactive_mask = S._scd_inactive_mask(pyg_all_df[S.SCD_CURRENTLY_ACTIVE_FLAG_COL])
    pyg_inactive = pyg_all_df[inactive_mask].replace({pd.NA: None, float('nan'): None})
    if pyg_inactive.empty:
        return

    pyg_active = S._scd_filter_active(pyg_all_df)

    # (pid_str, yg) → active row info
    active_by_key = {}
    for _, row in pyg_active.iterrows():
        key = (str(row.get('person_id', '')), row.get(S.YOUTH_GROUP_ID_COL) or '')
        active_by_key[key] = {
            'age_group': row.get('age_group'),
            'scd_changed_by_user': row.get(S.SCD_CHANGED_BY_USER_COL),
        }

    persons_by_id = {}
    if not persons_df.empty:
        for _, row in persons_df.replace({pd.NA: None, float('nan'): None}).iterrows():
            persons_by_id[str(row.get('person_id', ''))] = row.to_dict()

    # Per (pid_str, yg) keep only the most recently closed inactive row
    most_recent: dict[tuple, object] = {}
    if S.SCD_ACTIVE_TO_COL in pyg_inactive.columns:
        pyg_inactive = pyg_inactive.copy()
        pyg_inactive['_scd_to_dt'] = pd.to_datetime(pyg_inactive[S.SCD_ACTIVE_TO_COL], errors='coerce')
        for _, inact in pyg_inactive.iterrows():
            pid_str = str(inact.get('person_id', ''))
            yg = inact.get(S.YOUTH_GROUP_ID_COL) or ''
            key = (pid_str, yg)
            ts = inact.get('_scd_to_dt')
            existing = most_recent.get(key)
            if existing is None or (ts is not None and (existing.get('_scd_to_dt') is None or ts > existing.get('_scd_to_dt'))):
                most_recent[key] = inact.to_dict()
    else:
        for _, inact in pyg_inactive.iterrows():
            pid_str = str(inact.get('person_id', ''))
            yg = inact.get(S.YOUTH_GROUP_ID_COL) or ''
            most_recent[(pid_str, yg)] = inact.to_dict()

    for (pid_str, yg), inact in most_recent.items():
        if youth_groups_filter and yg not in youth_groups_filter:
            continue

        from_ag = inact.get('age_group') or ''
        from_ag_idx = _AGE_ORDER_INDEX.get(from_ag)
        if from_ag_idx is None:
            continue

        active = active_by_key.get((pid_str, yg))
        if not active:
            continue

        to_ag = active.get('age_group') or ''
        to_ag_idx = _AGE_ORDER_INDEX.get(to_ag)
        if to_ag_idx is None or to_ag_idx <= from_ag_idx:
            continue

        approved_by = inact.get(S.SCD_CHANGED_BY_USER_COL) or active.get('scd_changed_by_user') or ''
        if not approved_by:
            continue

        person = persons_by_id.get(pid_str)
        if person is None:
            continue

        by_raw = person.get('birth_year')
        by = None
        try:
            if by_raw and str(by_raw) not in ('nan', 'None', ''):
                by = int(by_raw)
        except (ValueError, TypeError):
            pass

        display_name = " ".join(
            str(person.get(k) or "").strip()
            for k in ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
            if str(person.get(k) or "").strip()
        )
        pid_out = int(pid_str) if person_type == 'registered' else pid_str

        result.append({
            'id': _make_promo_id(person_type, pid_str, yg, from_ag),
            'person_type': person_type,
            'person_id': pid_out,
            'display_name': display_name,
            'birth_year': by,
            'youth_group': yg,
            'from_age_group': from_ag,
            'to_age_group': to_ag,
            'status': 'approved',
            'approved_by': approved_by,
        })


def _compute_promotions(youth_groups_filter=None) -> list[dict]:
    rules_dict = _load_promotion_rules()
    rules_cache: dict = {}
    result: list = []

    pyg_active = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
    persons_df = S._registered_persons_df().copy()
    _scan_for_pending(result, 'registered', persons_df, pyg_active,
                      youth_groups_filter, rules_cache, rules_dict)

    unreg_persons = S.unregistered_persons_view_df().copy()
    unreg_pyg_active = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame())).copy()
    if not unreg_persons.empty:
        _scan_for_pending(result, 'unregistered', unreg_persons, unreg_pyg_active,
                          youth_groups_filter, rules_cache, rules_dict)

    _build_approved(result, 'registered',
                    S.store.get("person_youth_group", pd.DataFrame()),
                    persons_df, youth_groups_filter)

    if not unreg_persons.empty:
        _build_approved(result, 'unregistered',
                        S.unreg_store.get("person_youth_group", pd.DataFrame()),
                        unreg_persons, youth_groups_filter)

    return result


def register_promotions_routes(app):
    @app.get("/api/promotions")
    def list_promotions():
        user = _current_user()
        if not user:
            return jsonify({"error": "unauthorized"}), 401

        if user.get("role") == "admin":
            return jsonify({"promotions": _compute_promotions()})

        # Allow members who have promotion_access privilege
        person_id = str(user.get("person_id") or "")
        if not person_id:
            return jsonify({"error": "forbidden"}), 403

        access = get_user_promotion_access(person_id)
        if not access:
            return jsonify({"error": "forbidden"}), 403

        yg_filter = set(access["youth_group_ids"]) or None
        promos = _compute_promotions(youth_groups_filter=yg_filter)

        # Further filter by age groups if the grant scope restricted them
        allowed_ags = set(access.get("age_groups") or [])
        if allowed_ags:
            promos = [
                p for p in promos
                if p.get("from_age_group") in allowed_ags or p.get("to_age_group") in allowed_ags
            ]

        return jsonify({"promotions": promos})

    @app.post("/api/promotions/scan")
    def scan_promotions():
        user = _current_user()
        if not user:
            return jsonify({"error": "unauthorized"}), 401

        if user.get("role") == "admin":
            promos = _compute_promotions()
        else:
            person_id = str(user.get("person_id") or "")
            access = get_user_promotion_access(person_id) if person_id else None
            if not access:
                return jsonify({"error": "forbidden"}), 403
            yg_filter = set(access["youth_group_ids"]) or None
            promos = _compute_promotions(youth_groups_filter=yg_filter)
            allowed_ags = set(access.get("age_groups") or [])
            if allowed_ags:
                promos = [p for p in promos if p.get("from_age_group") in allowed_ags or p.get("to_age_group") in allowed_ags]

        pending = [p for p in promos if p["status"] == "pending"]
        return jsonify({"ok": True, "created": len(pending), "promotions": pending})

    @app.patch("/api/promotions/<promo_id>")
    def update_promotion(promo_id):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        body = request.json or {}
        action = body.get("action")
        if action not in ("approve", "reject"):
            return jsonify({"error": "action must be approve or reject"}), 400

        parsed = _parse_promo_id(promo_id)
        if not parsed:
            return jsonify({"error": "invalid promotion id"}), 400
        person_type, pid_str, yg, from_ag = parsed

        if u.get("role") != "admin":
            person_id = str(u.get("person_id") or "")
            access = get_user_promotion_access(person_id) if person_id else None
            if not access or yg not in set(access["youth_group_ids"]):
                return jsonify({"error": "forbidden"}), 403

        if action == "reject":
            # Without persistence, rejection is a no-op
            return jsonify({"ok": True, "promotion": {
                "id": promo_id, "status": "rejected",
                "from_age_group": from_ag, "youth_group": yg,
            }})

        # Determine to_age_group dynamically
        rules_dict = _load_promotion_rules()
        rules = _group_promotion_rules(rules_dict, yg)

        extra = body.get("extra_data") or {}
        promo_changed_by = _changed_by_user_id(u)

        if person_type == "registered":
            try:
                pid = int(pid_str)
            except ValueError:
                return jsonify({"error": "invalid person_id"}), 400

            # Look up birth_year
            persons_df = S._registered_persons_df()
            person_row = persons_df[persons_df["person_id"] == pid]
            if person_row.empty:
                return jsonify({"error": "person not found"}), 404
            by_raw = person_row.iloc[0].get("birth_year")
            by = _as_year_or_none(by_raw)
            to_ag = _expected_age_group_for_group(by, current_age_group=from_ag, rules=rules)
            if to_ag is None:
                return jsonify({"error": "no promotion target found"}), 400

            with S.lock:
                pyg_df = S._scd_ensure_columns(S.store["person_youth_group"].copy())
                active_mask = (
                    (pyg_df["person_id"] == pid)
                    & (pyg_df[S.YOUTH_GROUP_ID_COL] == yg)
                    & (pyg_df["age_group"] == from_ag)
                    & (pyg_df[S.SCD_CURRENTLY_ACTIVE_FLAG_COL] != False)
                )
                if not active_mask.any():
                    return jsonify({"error": "record not found in person_youth_group"}), 404
                now = pd.Timestamp.now()
                new_scd = S._scd_new_metadata(promo_changed_by)
                current_pyg = pyg_df[active_mask].iloc[0].to_dict()
                record_id = S._normalize_person_youth_group_record_id(current_pyg.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL))
                pyg_df.loc[active_mask, S.SCD_ACTIVE_TO_COL] = now
                pyg_df.loc[active_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                pyg_df.loc[active_mask, S.SCD_CHANGED_BY_USER_COL] = promo_changed_by
                new_pyg = {k: v for k, v in current_pyg.items() if k not in S.SCD_METADATA_COLUMNS}
                new_pyg["age_group"] = to_ag
                new_pyg.update(new_scd)
                S.store["person_youth_group"] = pd.concat([pyg_df, pd.DataFrame([new_pyg])], ignore_index=True)
                history_df = S._scd_ensure_columns(S.store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()).copy())
                new_hist = {
                    S.PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,
                    "age_group": to_ag,
                    "start_date": None,
                    "end_date": None,
                    **new_scd,
                }
                S.store[S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET] = pd.concat(
                    [history_df, pd.DataFrame([new_hist])], ignore_index=True
                )
                if extra and from_ag == 'الثانوي' and to_ag == 'الجامعيّة':
                    def _app_reg(sheet, rows):
                        if not rows:
                            return
                        row_scd = S._scd_new_metadata(promo_changed_by)
                        ndf = pd.DataFrame([{**r, **row_scd} for r in rows])
                        ndf["person_id"] = pid
                        cur = S._scd_ensure_columns(S.store.get(sheet, pd.DataFrame()).copy())
                        S.store[sheet] = pd.concat([cur, ndf], ignore_index=True)

                    _app_reg("higher_education", extra.get("higher_education", []))
                    _app_reg("jobs", extra.get("jobs", []))
                    _app_reg("emails", extra.get("emails", []))
                    _app_reg("social_media", extra.get("social_media", []))
                    _app_reg("responsibilities", extra.get("responsibilities", []))
                    _app_reg("hobbies_skills", extra.get("hobbies_skills", []))
                S.save()

            promo_row = person_row.iloc[0]
            promo_display_name = " ".join(
                str(promo_row.get(k) or "").strip()
                for k in ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
                if str(promo_row.get(k) or "").strip()
            )
            return jsonify({"ok": True, "promotion": {
                "id": promo_id,
                "person_type": person_type,
                "person_id": pid,
                "display_name": promo_display_name,
                "youth_group": yg,
                "from_age_group": from_ag,
                "to_age_group": to_ag,
                "status": "approved",
                "approved_by": promo_changed_by,
            }})

        else:  # unregistered
            with S.unreg_lock:
                upyg = S._scd_ensure_columns(S.unreg_store.get("person_youth_group", pd.DataFrame()).copy())
                if upyg.empty or "person_id" not in upyg.columns:
                    return jsonify({"error": "record not found"}), 404

                # Look up birth_year for unregistered person
                unreg_df = S.unregistered_persons_view_df()
                if not unreg_df.empty:
                    unreg_row = unreg_df[unreg_df["person_id"].astype(str) == pid_str]
                    by_raw = unreg_row.iloc[0].get("birth_year") if not unreg_row.empty else None
                else:
                    by_raw = None
                by = _as_year_or_none(by_raw)
                to_ag = _expected_age_group_for_group(by, current_age_group=from_ag, rules=rules)
                if to_ag is None:
                    return jsonify({"error": "no promotion target found"}), 400

                u_active_mask = (
                    (upyg["person_id"].astype(str) == pid_str)
                    & (upyg[S.YOUTH_GROUP_ID_COL] == yg)
                    & (upyg["age_group"] == from_ag)
                    & (upyg[S.SCD_CURRENTLY_ACTIVE_FLAG_COL] != False)
                )
                if not u_active_mask.any():
                    return jsonify({"error": "record not found"}), 404
                now = pd.Timestamp.now()
                new_scd = S._scd_new_metadata(promo_changed_by)
                current_upyg = upyg[u_active_mask].iloc[0].to_dict()
                record_id = S._normalize_person_youth_group_record_id(current_upyg.get(S.PERSON_YOUTH_GROUP_RECORD_ID_COL))
                upyg.loc[u_active_mask, S.SCD_ACTIVE_TO_COL] = now
                upyg.loc[u_active_mask, S.SCD_CURRENTLY_ACTIVE_FLAG_COL] = False
                upyg.loc[u_active_mask, S.SCD_CHANGED_BY_USER_COL] = promo_changed_by
                new_upyg = {k: v for k, v in current_upyg.items() if k not in S.SCD_METADATA_COLUMNS}
                new_upyg["age_group"] = to_ag
                new_upyg.update(new_scd)
                S.unreg_store["person_youth_group"] = pd.concat([upyg, pd.DataFrame([new_upyg])], ignore_index=True)
                u_history_df = S._scd_ensure_columns(S.unreg_store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame()).copy())
                new_uhist = {
                    S.PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,
                    "age_group": to_ag,
                    "start_date": None,
                    "end_date": None,
                    **new_scd,
                }
                S.unreg_store[S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET] = pd.concat(
                    [u_history_df, pd.DataFrame([new_uhist])], ignore_index=True
                )
                if extra and from_ag == 'الثانوي' and to_ag == 'الجامعيّة':
                    def _app_unreg(sheet, rows):
                        if not rows:
                            return
                        row_scd = S._scd_new_metadata(promo_changed_by)
                        ndf = pd.DataFrame([{**r, **row_scd} for r in rows])
                        ndf["person_id"] = pid_str
                        cur = S._scd_ensure_columns(S.unreg_store.get(sheet, pd.DataFrame()).copy())
                        S.unreg_store[sheet] = pd.concat([cur, ndf], ignore_index=True)

                    _app_unreg("higher_education", extra.get("higher_education", []))
                    _app_unreg("jobs", extra.get("jobs", []))
                    _app_unreg("emails", extra.get("emails", []))
                    _app_unreg("social_media", extra.get("social_media", []))
                    _app_unreg("responsibilities", extra.get("responsibilities", []))
                    _app_unreg("hobbies_skills", extra.get("hobbies_skills", []))
                S._save_unreg_store()

            return jsonify({"ok": True, "promotion": {
                "id": promo_id,
                "person_type": person_type,
                "person_id": pid_str,
                "youth_group": yg,
                "from_age_group": from_ag,
                "to_age_group": to_ag,
                "status": "approved",
                "approved_by": promo_changed_by,
            }})

    @app.delete("/api/promotions/<promo_id>")
    def delete_promotion(promo_id):
        user = _current_user()
        if not user:
            return jsonify({"error": "unauthorized"}), 401

        if user.get("role") != "admin":
            person_id = str(user.get("person_id") or "")
            parsed = _parse_promo_id(promo_id)
            if not parsed or not person_id:
                return jsonify({"error": "forbidden"}), 403
            _, _, yg, _ = parsed
            access = get_user_promotion_access(person_id)
            if not access or yg not in set(access["youth_group_ids"]):
                return jsonify({"error": "forbidden"}), 403

        return jsonify({"ok": True})


exports = {
    "_now_str": _now_str,
    "_default_promotion_age_rules": lambda: copy.deepcopy(DEFAULT_PROMOTION_AGE_RULES),
    "_normalize_group_promotion_rules": _normalize_group_promotion_rules,
    "_load_promotion_rules": _load_promotion_rules,
    "_save_promotion_rules": _save_promotion_rules,
    "_group_promotion_rules": _group_promotion_rules,
}
