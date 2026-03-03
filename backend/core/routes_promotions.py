import threading
import uuid

import pandas as pd
from flask import jsonify, request

from core import state as S
from core.routes_auth import _current_user, _get_council_access, _get_person_youth_groups


PROMOTIONS_PATH = S.db.promotions_path
promotions_lock = threading.Lock()


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
    return S.db.load_promotions()


def _save_promotions(data: dict):
    S.db.save_promotions(data)


def _promo_id() -> str:
    return str(uuid.uuid4())[:12]


def _now_str() -> str:
    import datetime as _dt
    return _dt.datetime.utcnow().isoformat()[:19] + 'Z'


def _get_birth_year(person_type: str, pid):
    try:
        if person_type == 'registered':
            reg_persons = S._registered_persons_df()
            row = reg_persons[reg_persons['person_id'] == int(pid)]
            if not row.empty:
                val = row.iloc[0].get('birth_year')
                return int(val) if val and str(val) not in ('nan', 'None', '') else None
        elif person_type == 'unregistered':
            df = S.unreg_store.get('persons', pd.DataFrame())
            row = df[df['person_id'].astype(str) == str(pid)]
            if not row.empty:
                val = row.iloc[0].get('birth_year')
                return int(val) if val and str(val) not in ('nan', 'None', '') else None
    except Exception:
        pass
    return None


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
                            yg = pyg_row.get("youth_group_name")
                            ag = pyg_row.get("age_group")
                            if not yg or not ag:
                                continue
                            if youth_groups_filter and yg not in youth_groups_filter:
                                continue
                            expected = _expected_age_group(by, current_age_group=ag)
                            if expected is None:
                                continue
                            if ag == expected:
                                continue
                            if ag in _SAME_TIER and expected in _SAME_TIER:
                                continue

                            key = (pid_str, yg, ag)
                            if key in existing:
                                continue

                            fn = str(row.get("first_name") or "")
                            ln = str(row.get("last_name") or "")
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
            unreg_persons = S.unreg_store.get("persons", pd.DataFrame()).copy()
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
                        mask = (pyg["person_id"] == int(pid)) & (pyg["youth_group_name"] == yg) & (pyg["age_group"] == from_ag)
                        if not mask.any():
                            _save_promotions(data)
                            return jsonify({"error": "record not found in person_youth_group"}), 404
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
                            _app_reg("responsibilities", extra.get("responsibilities", []))
                            _app_reg("hobbies_skills", extra.get("hobbies_skills", []))
                        S.save()

                elif ptype == "unregistered":
                    with S.unreg_lock:
                        upyg = S.unreg_store.get("person_youth_group", pd.DataFrame())
                        if upyg.empty or "person_id" not in upyg.columns:
                            _save_promotions(data)
                            return jsonify({"error": "record not found"}), 404
                        mask = (upyg["person_id"].astype(str) == str(pid)) & (upyg["youth_group_name"] == yg) & (upyg["age_group"] == from_ag)
                        if not mask.any():
                            _save_promotions(data)
                            return jsonify({"error": "record not found"}), 404
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
}
