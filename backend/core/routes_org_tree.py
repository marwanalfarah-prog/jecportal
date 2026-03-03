import os
import uuid
from datetime import date

import numpy as np
import pandas as pd
from flask import jsonify, request

from core import state as S


ORG_TREES_DIR = S.db.org_trees_dir
os.makedirs(ORG_TREES_DIR, exist_ok=True)


def _group_dir(group_name: str) -> str:
    return S.db.group_dir(group_name)


def _index_path(group_name: str) -> str:
    return S.db.index_path(group_name)


def _period_path(group_name: str, period_id: str) -> str:
    return S.db.period_path(group_name, period_id)


def _period_label(period: dict) -> str:
    if not isinstance(period, dict):
        return "الفترة الأولى"
    jec_year = period.get("jec_year")
    from_date = period.get("from_date")
    if jec_year and from_date:
        return f"{jec_year} — فترة {from_date}"
    if from_date:
        return f"فترة {from_date}"
    if jec_year:
        return f"{jec_year} — فترة"
    return "الفترة الأولى"


def _period_for_storage(period: dict) -> dict:
    p = dict(period or {})
    return {
        "id": p.get("id"),
        "jec_year": p.get("jec_year"),
        "from_date": p.get("from_date"),
        "to_date": p.get("to_date"),
    }


def _period_for_response(period: dict) -> dict:
    p = _period_for_storage(period)
    p["label"] = _period_label(p)
    return p


def _periods_for_response(periods: list) -> list:
    return [_period_for_response(p) for p in (periods or [])]


def _find_period(periods: list, period_id: str):
    if not period_id:
        return None
    return next((p for p in (periods or []) if p.get("id") == period_id), None)


def _load_index(group_name: str) -> list:
    path = _index_path(group_name)
    if not os.path.exists(path):
        legacy_path = S.db.legacy_group_path(group_name)
        if os.path.exists(legacy_path):
            return _migrate_legacy(group_name, legacy_path)
        return []
    periods = S.db.load_json_file(path, [])
    return [_period_for_storage(p) for p in (periods or []) if isinstance(p, dict) and p.get("id")]


def _save_index(group_name: str, periods: list):
    d = _group_dir(group_name)
    os.makedirs(d, exist_ok=True)
    S.db.save_json_file(_index_path(group_name), periods)


def _migrate_legacy(group_name: str, legacy_path: str) -> list:
    try:
        data = S.db.load_json_file(legacy_path, {})
    except Exception:
        return []
    period_id = str(uuid.uuid4())[:8]
    period = {
        "id": period_id,
        "jec_year": None,
        "from_date": None,
        "to_date": None,
    }
    os.makedirs(_group_dir(group_name), exist_ok=True)
    normalized = _normalize_tree_payload(data.get("nodes", []), data.get("edges", []))
    tree_data = {
        **data,
        "nodes": normalized["nodes"],
        "edges": normalized["edges"],
    }
    S.db.save_json_file(_period_path(group_name, period_id), tree_data)
    periods = [period]
    _save_index(group_name, periods)
    try:
        os.remove(legacy_path)
    except Exception:
        pass
    return periods


def _periods_overlap(p1: dict, p2: dict) -> bool:
    FAR = "9999-12-31"
    s1 = p1.get("from_date") or "0000-01-01"
    e1 = p1.get("to_date") or FAR
    s2 = p2.get("from_date") or "0000-01-01"
    e2 = p2.get("to_date") or FAR
    return s1 <= e2 and s2 <= e1


TREE_SNAPSHOT_KEYS = {
    "name", "baseName", "photo", "laqab", "personType",
    "unregistered", "unregisteredId", "unreg_id", "person_id",
}


def _compose_base_name(row: dict) -> str:
    return " ".join(
        str(row.get(k)).strip()
        for k in ("first_name", "second_name", "third_name", "last_name")
        if row.get(k) is not None and str(row.get(k)).strip() not in ("", "nan", "None")
    ).strip()


def _is_unregistered_person_id(pid) -> bool:
    if pid is None or str(pid).strip() == "":
        return False

    pid_norm = S._normalize_person_id(pid)
    if pid_norm is None:
        return False

    try:
        df = S.unreg_store.get("persons", pd.DataFrame())
        if df.empty or "person_id" not in df.columns:
            return False
        col = df["person_id"].dropna().astype(str).str.strip()
        return str(pid_norm) in set(col.tolist())
    except Exception:
        return False


def _extract_node_identity(node: dict):
    pid = node.get("personId")
    if pid is None or str(pid).strip() == "":
        pid = node.get("person_id")

    legacy_unreg = node.get("unregisteredId")
    if legacy_unreg is None or str(legacy_unreg).strip() == "":
        legacy_unreg = node.get("unreg_id")

    if legacy_unreg is not None and str(legacy_unreg).strip() != "":
        if pid is None or str(pid).strip() == "":
            pid = legacy_unreg

    if pid is None or str(pid).strip() == "":
        return None, False

    pid_str = str(pid).strip()
    unregistered = _is_unregistered_person_id(pid_str)
    pid_norm = S._normalize_person_id(pid_str)

    if unregistered:
        return pid_norm, True

    if not unregistered:
        try:
            return int(pid_str), False
        except Exception:
            return pid_str, True
    return pid_norm, True


def _canonicalize_tree_nodes(nodes: list) -> list:
    out = []
    for raw in (nodes or []):
        node = dict(raw or {})
        pid, unregistered = _extract_node_identity(node)
        clean = {k: v for k, v in node.items() if k not in TREE_SNAPSHOT_KEYS}
        clean["personId"] = pid
        out.append(clean)
    return out


def _enrich_node_from_person(node: dict) -> dict:
    n = dict(node or {})
    pid, unregistered = _extract_node_identity(n)
    n["personId"] = pid
    n["unregistered"] = bool(unregistered)

    n.pop("person_id", None)
    n.pop("unreg_id", None)
    if unregistered and pid is not None:
        n["unregisteredId"] = S._normalize_person_id(pid)
    else:
        n.pop("unregisteredId", None)

    if pid is None:
        return n

    try:
        if not unregistered:
            reg_persons = S._registered_persons_df()
            row = reg_persons[reg_persons["person_id"] == int(pid)]
            if row.empty:
                return n
            r = row.iloc[0].replace({np.nan: None}).to_dict()
            base = _compose_base_name(r)
            photo_path, _ = S.get_photo_path(int(pid))
            n["baseName"] = base
            n["laqab"] = ""
            n["personType"] = "علماني"
            n["photo"] = f"/api/person/{pid}/photo" if photo_path else None
            n["name"] = base
            return n

        df = S.unreg_store.get("persons", pd.DataFrame())
        if df.empty or "person_id" not in df.columns:
            return n
        row = df[df["person_id"].astype(str) == str(pid)]
        if row.empty:
            return n
        r = row.iloc[0].replace({np.nan: None}).to_dict()
        base = _compose_base_name(r)
        _, ext = S.get_unreg_photo_path(str(pid))
        laqab = str(r.get("title") or "").strip()
        n["baseName"] = base
        n["laqab"] = laqab
        n["personType"] = "مكرّس" if laqab else "علماني"
        n["photo"] = f"/api/unregistered/{pid}/photo" if ext else None
        n["name"] = f"{laqab} {base}".strip() if laqab else base
    except Exception:
        return n

    return n


def _prepare_tree_response_data(data: dict, period: dict | None = None) -> dict:
    payload = dict(data or {})
    payload["nodes"] = [_enrich_node_from_person(n) for n in (payload.get("nodes") or [])]
    payload["edges"] = payload.get("edges") or []
    payload.pop("period", None)
    payload["period"] = _period_for_response(period) if isinstance(period, dict) else None
    return payload


def _normalize_tree_payload(nodes: list, edges: list) -> dict:
    return {
        "nodes": _canonicalize_tree_nodes(nodes),
        "edges": edges or [],
    }


def _migrate_all_org_tree_files():
    try:
        if not os.path.exists(ORG_TREES_DIR):
            return
        for group_dir in os.scandir(ORG_TREES_DIR):
            if not group_dir.is_dir():
                continue
            for entry in os.scandir(group_dir.path):
                if not entry.is_file() or not entry.name.endswith('.json'):
                    continue
                try:
                    if entry.name == 'index.json':
                        periods = S.db.load_json_file(entry.path, [])
                        new_periods = [_period_for_storage(p) for p in (periods or []) if isinstance(p, dict) and p.get('id')]
                        if new_periods != periods:
                            S.db.save_json_file(entry.path, new_periods)
                        continue

                    data = S.db.load_json_file(entry.path, {})
                    normalized = _normalize_tree_payload(data.get('nodes') or [], data.get('edges') or [])
                    new_data = dict(data)
                    new_data['nodes'] = normalized['nodes']
                    new_data['edges'] = normalized['edges']
                    new_data.pop('period', None)
                    if new_data != data:
                        S.db.save_json_file(entry.path, new_data)
                except Exception:
                    continue
    except Exception:
        pass


def register_org_tree_routes(app):
    @app.patch("/api/unregistered/<uid>/archive")
    def archive_unregistered(uid):
        with S.unreg_lock:
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            idx = persons_df[persons_df["person_id"].astype(str) == str(uid)].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404
            S.unreg_store["persons"].at[idx[0], "archived"] = True
            S._save_unreg_store()
        return jsonify({"ok": True})

    @app.patch("/api/unregistered/<uid>/unarchive")
    def unarchive_unregistered(uid):
        with S.unreg_lock:
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            idx = persons_df[persons_df["person_id"].astype(str) == str(uid)].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404
            S.unreg_store["persons"].at[idx[0], "archived"] = False
            S._save_unreg_store()
        return jsonify({"ok": True})

    @app.get("/api/org-tree/<path:group_name>/periods")
    def get_org_tree_periods(group_name):
        periods = _load_index(group_name)
        return jsonify(_periods_for_response(periods))

    @app.get("/api/org-tree/<path:group_name>/<period_id>")
    def get_org_tree_period(group_name, period_id):
        periods = _load_index(group_name)
        period = _find_period(periods, period_id)
        path = _period_path(group_name, period_id)
        if not os.path.exists(path):
            return jsonify({"nodes": [], "edges": [], "period": _period_for_response(period) if period else None}), 404
        data = S.db.load_json_file(path, {"nodes": [], "edges": []})
        return jsonify(_prepare_tree_response_data(data, period))

    @app.get("/api/org-tree/<path:group_name>")
    def get_org_tree(group_name):
        period_id = request.args.get("period_id")
        if period_id:
            periods = _load_index(group_name)
            period = _find_period(periods, period_id)
            path = _period_path(group_name, period_id)
            if not os.path.exists(path):
                return jsonify({"nodes": [], "edges": [], "period": _period_for_response(period) if period else None, "periods": _periods_for_response(periods)})
            data = S.db.load_json_file(path, {"nodes": [], "edges": []})
            payload = _prepare_tree_response_data(data, period)
            payload["periods"] = _periods_for_response(periods)
            return jsonify(payload)

        periods = _load_index(group_name)
        if not periods:
            return jsonify({"nodes": [], "edges": [], "period": None, "periods": []})

        active = next((p for p in periods if p.get("to_date") is None), None)
        if not active:
            active = sorted(periods, key=lambda p: p.get("from_date") or "", reverse=True)[0]

        path = _period_path(group_name, active["id"])
        if not os.path.exists(path):
            return jsonify({"nodes": [], "edges": [], "period": _period_for_response(active), "periods": _periods_for_response(periods)})
        data = _prepare_tree_response_data(S.db.load_json_file(path, {"nodes": [], "edges": []}), active)
        data["periods"] = _periods_for_response(periods)
        return jsonify(data)

    @app.put("/api/org-tree/<path:group_name>")
    def put_org_tree(group_name):
        body = request.json
        periods = _load_index(group_name)

        close_current = body.get("close_current", False)
        new_period_data = body.get("new_period")
        period = body.get("period")
        period_id = body.get("period_id") or (period.get("id") if isinstance(period, dict) else None)

        os.makedirs(_group_dir(group_name), exist_ok=True)

        if new_period_data:
            candidate = {
                "from_date": new_period_data.get("from_date"),
                "to_date": new_period_data.get("to_date"),
            }
            for existing in periods:
                if close_current and existing.get("to_date") is None:
                    continue
                if _periods_overlap(candidate, existing):
                    return jsonify({"error": "overlap", "message": "تتداخل الفترة الزمنية مع فترة موجودة"}), 409

            if close_current:
                for p in periods:
                    if p.get("to_date") is None:
                        p["to_date"] = new_period_data.get("from_date") or str(date.today())

            new_id = str(uuid.uuid4())[:8]
            new_period = {
                "id": new_id,
                "jec_year": new_period_data.get("jec_year"),
                "from_date": new_period_data.get("from_date"),
                "to_date": new_period_data.get("to_date"),
            }
            periods.append(new_period)
            _save_index(group_name, periods)

            normalized = _normalize_tree_payload(body.get("nodes", []), body.get("edges", []))
            tree_data = {
                "nodes": normalized["nodes"],
                "edges": normalized["edges"],
            }
            S.db.save_json_file(_period_path(group_name, new_id), tree_data)

            return jsonify({"ok": True, "period": _period_for_response(new_period), "periods": _periods_for_response(periods)})

        if period_id:
            pid_str = period_id
            target_period = _find_period(periods, pid_str)
            if not target_period:
                return jsonify({"error": "not found"}), 404
            period_updates = period if isinstance(period, dict) else {}
            for p in periods:
                if p["id"] == pid_str:
                    p.update({k: period_updates.get(k, p.get(k)) for k in ("jec_year", "from_date", "to_date")})
            _save_index(group_name, periods)

            normalized = _normalize_tree_payload(body.get("nodes", []), body.get("edges", []))
            tree_data = {
                "nodes": normalized["nodes"],
                "edges": normalized["edges"],
            }
            S.db.save_json_file(_period_path(group_name, pid_str), tree_data)
            period_payload = _find_period(periods, pid_str)
            return jsonify({"ok": True, "period": _period_for_response(period_payload), "periods": _periods_for_response(periods)})

        new_id = str(uuid.uuid4())[:8]
        new_period = {
            "id": new_id,
            "jec_year": None,
            "from_date": None,
            "to_date": None,
        }
        periods = [new_period]
        _save_index(group_name, periods)
        normalized = _normalize_tree_payload(body.get("nodes", []), body.get("edges", []))
        tree_data = {
            "nodes": normalized["nodes"],
            "edges": normalized["edges"],
        }
        S.db.save_json_file(_period_path(group_name, new_id), tree_data)
        return jsonify({"ok": True, "period": _period_for_response(new_period), "periods": _periods_for_response(periods)})

    @app.route("/api/org-tree/<path:group_name>/period/<period_id>", methods=["PATCH"])
    def patch_org_tree_period(group_name, period_id):
        body = request.json
        periods = _load_index(group_name)

        target = next((p for p in periods if p["id"] == period_id), None)
        if not target:
            return jsonify({"error": "not found"}), 404

        candidate = {
            "from_date": body.get("from_date", target.get("from_date")),
            "to_date": body.get("to_date", target.get("to_date")),
        }
        for p in periods:
            if p["id"] == period_id:
                continue
            if not p.get("to_date"):
                if not candidate["to_date"]:
                    return jsonify({"error": "overlap", "message": "يوجد بالفعل فترة جارية مفتوحة"}), 409
                continue
            if _periods_overlap(candidate, p):
                return jsonify({"error": "overlap", "message": "تتداخل الفترة الزمنية مع فترة موجودة"}), 409

        for k in ("jec_year", "from_date", "to_date"):
            if k in body:
                target[k] = body[k]

        _save_index(group_name, periods)

        return jsonify({"ok": True, "period": _period_for_response(target), "periods": _periods_for_response(periods)})

    @app.route("/api/org-tree/<path:group_name>/period/<period_id>", methods=["DELETE"])
    def delete_org_tree_period(group_name, period_id):
        periods = _load_index(group_name)
        target = next((p for p in periods if p["id"] == period_id), None)
        if not target:
            return jsonify({"error": "not found"}), 404

        periods = [p for p in periods if p["id"] != period_id]
        _save_index(group_name, periods)

        ppath = _period_path(group_name, period_id)
        try:
            if os.path.exists(ppath):
                os.remove(ppath)
        except Exception:
            pass

        return jsonify({"ok": True, "periods": _periods_for_response(periods)})


_migrate_all_org_tree_files()
