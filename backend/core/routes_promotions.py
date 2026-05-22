import copy
import threading
import uuid

import pandas as pd
from flask import jsonify, request

from core import state as S
from core.routes_auth import _current_user, _get_council_access, _get_person_youth_groups


PROMOTIONS_PATH = S.db.promotions_path
promotions_lock = threading.Lock()

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


def _ensure_promotion_settings_shape(data: dict) -> bool:
    changed = False
    if 'promotions' not in data or not isinstance(data.get('promotions'), list):
        data['promotions'] = []
        changed = True

    rules_by_group = data.get('group_age_rules')
    if not isinstance(rules_by_group, dict):
        rules_by_group = {}
        data['group_age_rules'] = rules_by_group
        changed = True

    for gid, rules in list(rules_by_group.items()):
        normalized = _normalize_group_promotion_rules(rules)
        if normalized != rules:
            rules_by_group[gid] = normalized
            changed = True

    return changed


def _group_promotion_rules(data: dict, group_id: str | None) -> list[dict]:
    rules_by_group = data.get('group_age_rules') if isinstance(data.get('group_age_rules'), dict) else {}
    if group_id and group_id in rules_by_group:
        return _normalize_group_promotion_rules(rules_by_group.get(group_id))
    return copy.deepcopy(DEFAULT_PROMOTION_AGE_RULES)


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


def _load_promotions() -> dict:
    data = S.db.load_promotions()
    changed = _ensure_promotion_settings_shape(data)
    for promo in data.get("promotions", []):
        gid = S.youth_group_id(promo.get("youth_group"), create=True)
        if gid and promo.get("youth_group") != gid:
            promo["youth_group"] = gid
            changed = True
        if "youth_group_name" in promo:
            promo.pop("youth_group_name", None)
            changed = True
    if changed:
        _save_promotions(data)
    return data


def _save_promotions(data: dict):
    S.db.save_promotions(data)


def _promo_id() -> str:
    return str(uuid.uuid4())[:12]


def _now_str() -> str:
    import datetime as _dt
    return _dt.datetime.utcnow().isoformat()[:19] + 'Z'


def register_promotions_routes(app):
    @app.get("/api/promotions")
    def list_promotions():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        data = _load_promotions()
        promos = data.get("promotions", [])

        if u["role"] == "admin":
            return jsonify({"promotions": promos})

        youth_groups = _get_person_youth_groups(u["person_type"], u["person_id"])
        council_access = _get_council_access(u["person_type"], u["person_id"], youth_groups)

        def _can_see(pr):
            grp = pr.get("youth_group")
            info = council_access.get(grp)
            if not info:
                return False
            if info.get("full_group"):
                return True
            from_ag = pr.get("from_age_group")
            to_ag = pr.get("to_age_group")
            ags = info.get("age_groups", [])
            return from_ag in ags or to_ag in ags

        return jsonify({"promotions": [p for p in promos if _can_see(p)]})

    @app.post("/api/promotions/scan")
    def scan_promotions():
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        youth_groups_filter = None
        if u["role"] != "admin":
            ygs = _get_person_youth_groups(u["person_type"], u["person_id"])
            council_access = _get_council_access(u["person_type"], u["person_id"], ygs)
            youth_groups_filter = set(council_access.keys())

        created = []
        with promotions_lock:
            data = _load_promotions()
            existing = {
                (str(p["person_id"]), p["youth_group"], p["from_age_group"]): p
                for p in data["promotions"]
                if p["status"] == "pending"
            }

            pyg = S.store["person_youth_group"]
            rules_cache = {}

            def _scan_persons(person_type, persons_df, pyg_df):
                for row in persons_df.replace({pd.NA: None, float('nan'): None}).to_dict(orient='records'):
                    pid = row.get("person_id")
                    if pid is None:
                        continue
                    pid_str = str(pid)
                    by_raw = row.get("birth_year")
                    by = None
                    try:
                        if by_raw and str(by_raw) not in ('nan', 'None', ''):
                            by = int(by_raw)
                    except (ValueError, TypeError):
                        pass
                    if by is None:
                        continue

                    if not pyg_df.empty and "person_id" in pyg_df.columns:
                        mask = pyg_df["person_id"].astype(str) == pid_str
                        for _, pyg_row in pyg_df[mask].iterrows():
                            yg = pyg_row.get(S.YOUTH_GROUP_ID_COL)
                            ag = pyg_row.get("age_group")
                            if not yg or not ag:
                                continue
                            if youth_groups_filter and yg not in youth_groups_filter:
                                continue
                            if yg not in rules_cache:
                                rules_cache[yg] = _group_promotion_rules(data, yg)
                            expected = _expected_age_group_for_group(by, current_age_group=ag, rules=rules_cache[yg])
                            if expected is None:
                                continue
                            if ag == expected:
                                continue
                            if ag in _SAME_TIER and expected in _SAME_TIER:
                                continue

                            key = (pid_str, yg, ag)
                            if key in existing:
                                continue

                            fn = str(row.get("ar_first_name") or "")
                            ln = str(row.get("ar_last_name") or "")
                            new_promo = {
                                "id": _promo_id(),
                                "person_type": person_type,
                                "person_id": pid if person_type == "registered" else pid_str,
                                "display_name": f"{fn} {ln}".strip(),
                                "birth_year": by,
                                "youth_group": yg,
                                "from_age_group": ag,
                                "to_age_group": expected,
                                "status": "pending",
                                "approved_by": None,
                                "created_at": _now_str(),
                                "updated_at": _now_str(),
                            }
                            data["promotions"].append(new_promo)
                            existing[key] = new_promo
                            created.append(new_promo)

            _scan_persons("registered", S._registered_persons_df().copy(), pyg)
            unreg_persons = S.unregistered_persons_view_df().copy()
            unreg_pyg = S.unreg_store.get("person_youth_group", pd.DataFrame()).copy()
            if not unreg_persons.empty:
                _scan_persons("unregistered", unreg_persons, unreg_pyg)

            _save_promotions(data)

        return jsonify({"ok": True, "created": len(created), "promotions": created})

    @app.patch("/api/promotions/<promo_id>")
    def update_promotion(promo_id):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401

        body = request.json or {}
        action = body.get("action")
        if action not in ("approve", "reject"):
            return jsonify({"error": "action must be approve or reject"}), 400

        with promotions_lock:
            data = _load_promotions()
            promo = next((p for p in data["promotions"] if p["id"] == promo_id), None)
            if not promo:
                return jsonify({"error": "not found"}), 404

            if u["role"] != "admin":
                ygs = _get_person_youth_groups(u["person_type"], u["person_id"])
                ca = _get_council_access(u["person_type"], u["person_id"], ygs)
                info = ca.get(promo["youth_group"])
                if not info:
                    return jsonify({"error": "forbidden"}), 403
                if not info.get("full_group"):
                    ags = info.get("age_groups", [])
                    if promo["from_age_group"] not in ags and promo["to_age_group"] not in ags:
                        return jsonify({"error": "forbidden"}), 403

            promo["status"] = "approved" if action == "approve" else "rejected"
            promo["approved_by"] = u["username"]
            promo["updated_at"] = _now_str()

            if action == "approve":
                pid = promo["person_id"]
                yg = promo["youth_group"]
                from_ag = promo["from_age_group"]
                to_ag = promo["to_age_group"]
                ptype = promo["person_type"]
                extra = body.get("extra_data") or {}

                if ptype == "registered":
                    with S.lock:
                        pyg = S.store["person_youth_group"]
                        mask = (pyg["person_id"] == int(pid)) & (pyg[S.YOUTH_GROUP_ID_COL] == yg) & (pyg["age_group"] == from_ag)
                        if not mask.any():
                            _save_promotions(data)
                            return jsonify({"error": "record not found in person_youth_group"}), 404
                        record_id = S._normalize_person_youth_group_record_id(pyg.loc[mask, S.PERSON_YOUTH_GROUP_RECORD_ID_COL].iloc[0])
                        history_df = S.store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame())
                        history_rows = history_df.replace({pd.NA: None, float('nan'): None}).to_dict(orient="records") if not history_df.empty else []
                        history_rows.append({
                            S.PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,
                            "age_group": to_ag,
                            "start_date": None,
                            "end_date": None,
                        })
                        S.store[S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET] = pd.DataFrame(
                            S.normalize_person_youth_group_age_history_entries(history_rows),
                            columns=S.PERSON_YOUTH_GROUP_AGE_HISTORY_COLUMNS,
                        )
                        S.store["person_youth_group"].loc[mask, "age_group"] = to_ag
                        if extra and from_ag == 'الثانوي' and to_ag == 'الجامعيّة':
                            int_pid = int(pid)

                            def _app_reg(sheet, rows):
                                if not rows:
                                    return
                                ndf = pd.DataFrame(rows)
                                ndf["person_id"] = int_pid
                                S.store[sheet] = pd.concat([S.store[sheet], ndf], ignore_index=True)

                            _app_reg("higher_education", extra.get("higher_education", []))
                            _app_reg("jobs", extra.get("jobs", []))
                            _app_reg("emails", extra.get("emails", []))
                            _app_reg("social_media", extra.get("social_media", []))
                            _app_reg("responsibilities", extra.get("responsibilities", []))
                            _app_reg("hobbies_skills", extra.get("hobbies_skills", []))
                        S.save()

                elif ptype == "unregistered":
                    with S.unreg_lock:
                        upyg = S.unreg_store.get("person_youth_group", pd.DataFrame())
                        if upyg.empty or "person_id" not in upyg.columns:
                            _save_promotions(data)
                            return jsonify({"error": "record not found"}), 404
                        mask = (upyg["person_id"].astype(str) == str(pid)) & (upyg[S.YOUTH_GROUP_ID_COL] == yg) & (upyg["age_group"] == from_ag)
                        if not mask.any():
                            _save_promotions(data)
                            return jsonify({"error": "record not found"}), 404
                        record_id = S._normalize_person_youth_group_record_id(upyg.loc[mask, S.PERSON_YOUTH_GROUP_RECORD_ID_COL].iloc[0])
                        history_df = S.unreg_store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame())
                        history_rows = history_df.replace({pd.NA: None, float('nan'): None}).to_dict(orient="records") if not history_df.empty else []
                        history_rows.append({
                            S.PERSON_YOUTH_GROUP_RECORD_ID_COL: record_id,
                            "age_group": to_ag,
                            "start_date": None,
                            "end_date": None,
                        })
                        S.unreg_store[S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET] = pd.DataFrame(
                            S.normalize_person_youth_group_age_history_entries(history_rows),
                            columns=S.PERSON_YOUTH_GROUP_AGE_HISTORY_COLUMNS,
                        )
                        S.unreg_store["person_youth_group"].loc[mask, "age_group"] = to_ag
                        if extra and from_ag == 'الثانوي' and to_ag == 'الجامعيّة':
                            str_pid = str(pid)

                            def _app_unreg(sheet, rows):
                                if not rows:
                                    return
                                ndf = pd.DataFrame(rows)
                                ndf["person_id"] = str_pid
                                cur = S.unreg_store.get(sheet, pd.DataFrame())
                                S.unreg_store[sheet] = pd.concat([cur, ndf], ignore_index=True)

                            _app_unreg("higher_education", extra.get("higher_education", []))
                            _app_unreg("jobs", extra.get("jobs", []))
                            _app_unreg("emails", extra.get("emails", []))
                            _app_unreg("social_media", extra.get("social_media", []))
                            _app_unreg("responsibilities", extra.get("responsibilities", []))
                            _app_unreg("hobbies_skills", extra.get("hobbies_skills", []))
                        S._save_unreg_store()

            _save_promotions(data)

        return jsonify({"ok": True, "promotion": promo})

    @app.delete("/api/promotions/<promo_id>")
    def delete_promotion(promo_id):
        u = _current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401
        with promotions_lock:
            data = _load_promotions()
            data["promotions"] = [p for p in data["promotions"] if p["id"] != promo_id]
            _save_promotions(data)
        return jsonify({"ok": True})


exports = {
    "_now_str": _now_str,
    "_default_promotion_age_rules": lambda: copy.deepcopy(DEFAULT_PROMOTION_AGE_RULES),
    "_normalize_group_promotion_rules": _normalize_group_promotion_rules,
    "_ensure_promotion_settings_shape": _ensure_promotion_settings_shape,
    "_group_promotion_rules": _group_promotion_rules,
}
