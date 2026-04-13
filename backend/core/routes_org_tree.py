import os
import uuid
from datetime import date

import numpy as np
import pandas as pd
from flask import jsonify, request

from core import state as S


ORG_TREES_DIR = S.db.org_trees_dir
os.makedirs(ORG_TREES_DIR, exist_ok=True)

_PERSON_LOOKUP_CACHE_VERSION = None
_REGISTERED_PERSON_ROWS: dict = {}
_UNREGISTERED_PERSON_ROWS: dict = {}
_UNREGISTERED_PERSON_IDS: set[str] = set()
_ORG_TREE_PERIOD_CACHE: dict[str, dict] = {}

GS_GROUP_ID = "GS"
GS_GROUP_ALIASES = {
    GS_GROUP_ID,
    "__AMANAH_AMMA__",
    "AMANAH_AMMA",
    "GENERAL_SECRETARIAT",
    "الأمانة العامة",
}
GS_GROUP_ALIAS_SAFE_KEYS = {S.safe_youth_group_key(v) for v in GS_GROUP_ALIASES}


def _canonical_group_ref(group_ref: str | None) -> str | None:
    ref = str(group_ref or "").strip()
    if not ref:
        return None
    if ref in GS_GROUP_ALIASES:
        return GS_GROUP_ID
    if S.safe_youth_group_key(ref) in GS_GROUP_ALIAS_SAFE_KEYS:
        return GS_GROUP_ID
    return ref


def _group_dir(group_name: str) -> str:
    group_ref = _canonical_group_ref(group_name) or group_name
    group_id = S.youth_group_id(group_ref) or group_ref
    return S.db.group_dir(group_id)


def _index_path(group_name: str) -> str:
    group_ref = _canonical_group_ref(group_name) or group_name
    group_id = S.youth_group_id(group_ref) or group_ref
    return S.db.index_path(group_id)


def _period_path(group_name: str, period_id: str) -> str:
    group_ref = _canonical_group_ref(group_name) or group_name
    group_id = S.youth_group_id(group_ref) or group_ref
    return S.db.period_path(group_id, period_id)


def _resolve_group_id(group_ref: str) -> str:
    canonical = _canonical_group_ref(group_ref) or group_ref
    if canonical == GS_GROUP_ID:
        return GS_GROUP_ID
    return S.youth_group_id(canonical, create=True) or canonical


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
    group_id = _resolve_group_id(group_name)
    path = _index_path(group_id)
    if not os.path.exists(path):
        legacy_path = S.db.legacy_group_path(group_id)
        if os.path.exists(legacy_path):
            return _migrate_legacy(group_id, legacy_path)
        return []
    periods = S.db.load_json_file(path, [])
    return [_period_for_storage(p) for p in (periods or []) if isinstance(p, dict) and p.get("id")]


def _save_index(group_name: str, periods: list):
    group_id = _resolve_group_id(group_name)
    d = _group_dir(group_id)
    os.makedirs(d, exist_ok=True)
    S.db.save_json_file(_index_path(group_id), periods)


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
    group_id = _resolve_group_id(group_name)
    os.makedirs(_group_dir(group_id), exist_ok=True)
    normalized = _normalize_tree_payload(data.get("nodes", []), data.get("edges", []))
    tree_data = {
        **data,
        "nodes": normalized["nodes"],
        "edges": normalized["edges"],
    }
    S.db.save_json_file(_period_path(group_id, period_id), tree_data)
    periods = [period]
    _save_index(group_id, periods)
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
        for k in ("ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
        if row.get(k) is not None and str(row.get(k)).strip() not in ("", "nan", "None")
    ).strip()


def _current_data_version() -> int:
    return S.cache_state()[2]


def _ensure_person_lookup_cache():
    global _PERSON_LOOKUP_CACHE_VERSION, _REGISTERED_PERSON_ROWS, _UNREGISTERED_PERSON_ROWS, _UNREGISTERED_PERSON_IDS

    data_version = _current_data_version()
    if _PERSON_LOOKUP_CACHE_VERSION == data_version:
        return

    reg_rows = {}
    reg_df = S._registered_persons_df().replace({np.nan: None})
    if not reg_df.empty and "person_id" in reg_df.columns:
        for row in reg_df.to_dict(orient="records"):
            pid = S._normalize_person_id(row.get("person_id"))
            if pid is not None:
                reg_rows[pid] = row

    unreg_rows = {}
    unreg_ids = set()
    unreg_df = S.unregistered_persons_view_df().replace({np.nan: None})
    if not unreg_df.empty and "person_id" in unreg_df.columns:
        for row in unreg_df.to_dict(orient="records"):
            pid = S._normalize_person_id(row.get("person_id"))
            if pid is None:
                continue
            unreg_rows[pid] = row
            unreg_ids.add(str(pid))

    _REGISTERED_PERSON_ROWS = reg_rows
    _UNREGISTERED_PERSON_ROWS = unreg_rows
    _UNREGISTERED_PERSON_IDS = unreg_ids
    _PERSON_LOOKUP_CACHE_VERSION = data_version


def _is_unregistered_person_id(pid) -> bool:
    if pid is None or str(pid).strip() == "":
        return False

    pid_norm = S._normalize_person_id(pid)
    if pid_norm is None:
        return False

    _ensure_person_lookup_cache()
    return str(pid_norm) in _UNREGISTERED_PERSON_IDS


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


def _enrich_node_with_identity(node: dict, pid, unregistered: bool) -> dict:
    _ensure_person_lookup_cache()

    n = dict(node or {})
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
            row = _REGISTERED_PERSON_ROWS.get(pid)
            if not row:
                return n
            base = _compose_base_name(row)
            photo_path, _ = S.get_photo_path(int(pid))
            n["baseName"] = base
            n["laqab"] = ""
            n["personType"] = "علماني"
            n["photo"] = f"/api/person/{pid}/photo" if photo_path else None
            n["name"] = base
            return n

        row = _UNREGISTERED_PERSON_ROWS.get(S._normalize_person_id(pid))
        if not row:
            return n
        base = _compose_base_name(row)
        _, ext = S.get_unreg_photo_path(str(pid))
        laqab = str(row.get("title") or "").strip()
        n["baseName"] = base
        n["laqab"] = laqab
        n["personType"] = "مكرّس" if laqab else "علماني"
        n["photo"] = f"/api/unregistered/{pid}/photo" if ext else None
        n["name"] = f"{laqab} {base}".strip() if laqab else base
    except Exception:
        return n

    return n


def _enrich_node_from_person(node: dict) -> dict:
    pid, unregistered = _extract_node_identity(node or {})
    return _enrich_node_with_identity(node, pid, unregistered)


def _period_cache_entry(path: str) -> dict:
    data_version = _current_data_version()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {"nodes": [], "edges": [], "person_ids": set(), "unregistered_ids": set()}

    cached = _ORG_TREE_PERIOD_CACHE.get(path)
    if cached and cached.get("mtime") == mtime and cached.get("data_version") == data_version:
        return cached

    data = S.db.load_json_file(path, {"nodes": [], "edges": []})
    enriched_nodes = []
    person_ids = set()
    unregistered_ids = set()

    for raw_node in (data.get("nodes") or []):
        pid, is_unregistered = _extract_node_identity(raw_node)
        if pid is not None:
            if is_unregistered:
                unregistered_ids.add(str(pid))
            else:
                person_ids.add(str(pid))
        enriched_nodes.append(_enrich_node_with_identity(raw_node, pid, is_unregistered))

    cached = {
        "mtime": mtime,
        "data_version": data_version,
        "nodes": enriched_nodes,
        "edges": data.get("edges") or [],
        "person_ids": person_ids,
        "unregistered_ids": unregistered_ids,
    }
    _ORG_TREE_PERIOD_CACHE[path] = cached
    return cached


def _prepare_tree_response_data(data: dict, period: dict | None = None) -> dict:
    payload = dict(data or {})
    payload["nodes"] = [_enrich_node_from_person(n) for n in (payload.get("nodes") or [])]
    payload["edges"] = payload.get("edges") or []
    payload.pop("period", None)
    payload["period"] = _period_for_response(period) if isinstance(period, dict) else None
    return payload


def _group_display_name(group_ref: str) -> str:
    group_id = _resolve_group_id(group_ref)
    if group_id == GS_GROUP_ID:
        return "الأمانة العامة"
    return S.youth_group_name(group_id) or group_id


def _build_history_target_matcher(person_id=None, unregistered_id=None):
    target_person_id = S._normalize_person_id(person_id) if person_id is not None and str(person_id).strip() != "" else None
    target_unregistered_id = S._normalize_person_id(unregistered_id) if unregistered_id is not None and str(unregistered_id).strip() != "" else None

    def matcher(node: dict) -> bool:
        node_id, node_is_unregistered = _extract_node_identity(node)
        if node_id is None:
            return False

        if target_unregistered_id is not None:
            return bool(node_is_unregistered and node_id == target_unregistered_id)

        if target_person_id is None:
            return False

        return bool(not node_is_unregistered and node_id == target_person_id)

    return matcher


def _parse_group_refs(raw_group_ids: str | None) -> list[str]:
    if not raw_group_ids:
        refs = [opt["value"] for opt in S.youth_group_options()]
        refs.append(GS_GROUP_ID)
    else:
        refs = [part.strip() for part in str(raw_group_ids).split(",") if part.strip()]

    resolved = []
    seen = set()
    for ref in refs:
        group_id = _resolve_group_id(ref)
        if not group_id or group_id in seen:
            continue
        seen.add(group_id)
        resolved.append(group_id)
    return resolved


def _load_history_trees(group_refs: list[str], person_id=None, unregistered_id=None) -> list[dict]:
    matches = []
    target_person_id = S._normalize_person_id(person_id) if person_id is not None and str(person_id).strip() != "" else None
    target_unregistered_id = S._normalize_person_id(unregistered_id) if unregistered_id is not None and str(unregistered_id).strip() != "" else None
    for group_ref in group_refs:
        periods = _load_index(group_ref)
        if not periods:
            continue

        group_id = _resolve_group_id(group_ref)
        group_name = _group_display_name(group_id)

        for period in periods:
            path = _period_path(group_id, period.get("id"))
            if not os.path.exists(path):
                continue

            period_cache = _period_cache_entry(path)
            if target_unregistered_id is not None:
                if str(target_unregistered_id) not in period_cache["unregistered_ids"]:
                    continue
            elif target_person_id is not None:
                if str(target_person_id) not in period_cache["person_ids"]:
                    continue
            else:
                continue

            matches.append({
                "groupId": group_id,
                "groupName": group_name,
                "period": _period_for_response(period),
                "nodes": period_cache["nodes"],
                "edges": period_cache["edges"],
            })

    return matches


def _normalize_tree_payload(nodes: list, edges: list) -> dict:
    return {
        "nodes": _canonicalize_tree_nodes(nodes),
        "edges": edges or [],
    }


def _migrate_all_org_tree_files():
    try:
        if not os.path.exists(ORG_TREES_DIR):
            return
        known_group_ids = {opt["value"] for opt in S.youth_group_options()}
        safe_to_group_id = {
            S.safe_youth_group_key(opt["label"]): opt["value"]
            for opt in S.youth_group_options()
        }

        for group_dir in os.scandir(ORG_TREES_DIR):
            if not group_dir.is_dir():
                continue
            current_name = group_dir.name
            canonical = _canonical_group_ref(current_name)
            if canonical == GS_GROUP_ID:
                target_group_id = GS_GROUP_ID
            else:
                target_group_id = current_name if current_name in known_group_ids else safe_to_group_id.get(current_name)
            active_dir_path = group_dir.path
            if target_group_id and target_group_id != current_name:
                target_path = os.path.join(ORG_TREES_DIR, target_group_id)
                if not os.path.exists(target_path):
                    try:
                        os.rename(group_dir.path, target_path)
                        active_dir_path = target_path
                    except Exception:
                        active_dir_path = group_dir.path

            for entry in os.scandir(active_dir_path):
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
    @app.get("/api/org-tree/history")
    def get_org_tree_history():
        person_id = request.args.get("person_id")
        unregistered_id = request.args.get("unregistered_id")
        if not person_id and not unregistered_id:
            return jsonify({"error": "person_id or unregistered_id is required"}), 400

        group_refs = _parse_group_refs(request.args.get("group_ids"))
        history = _load_history_trees(group_refs, person_id=person_id, unregistered_id=unregistered_id)
        return jsonify({"items": history})

    @app.patch("/api/unregistered/<uid>/archive")
    def archive_unregistered(uid):
        body = request.json or {}
        youth_group_id = str(body.get("youth_group_id") or "").strip()
        if not youth_group_id:
            return jsonify({"error": "youth_group_id is required"}), 400

        with S.unreg_lock:
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            idx = persons_df[persons_df["person_id"].astype(str) == str(uid)].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404

            pyg = S.unreg_store.get("person_youth_group", pd.DataFrame())
            if pyg.empty or "person_id" not in pyg.columns or S.YOUTH_GROUP_ID_COL not in pyg.columns:
                return jsonify({"error": "membership not found"}), 404

            mask = (
                (pyg["person_id"].astype(str) == str(uid))
                & (pyg[S.YOUTH_GROUP_ID_COL].astype(str) == youth_group_id)
            )
            if not mask.any():
                return jsonify({"error": "membership not found"}), 404

            if "archived" not in S.unreg_store["person_youth_group"].columns:
                S.unreg_store["person_youth_group"]["archived"] = False
            S.unreg_store["person_youth_group"].loc[mask, "archived"] = True
            S._save_unreg_store()
        return jsonify({"ok": True})

    @app.patch("/api/unregistered/<uid>/unarchive")
    def unarchive_unregistered(uid):
        body = request.json or {}
        youth_group_id = str(body.get("youth_group_id") or "").strip()
        if not youth_group_id:
            return jsonify({"error": "youth_group_id is required"}), 400

        with S.unreg_lock:
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            idx = persons_df[persons_df["person_id"].astype(str) == str(uid)].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404

            pyg = S.unreg_store.get("person_youth_group", pd.DataFrame())
            if pyg.empty or "person_id" not in pyg.columns or S.YOUTH_GROUP_ID_COL not in pyg.columns:
                return jsonify({"error": "membership not found"}), 404

            mask = (
                (pyg["person_id"].astype(str) == str(uid))
                & (pyg[S.YOUTH_GROUP_ID_COL].astype(str) == youth_group_id)
            )
            if not mask.any():
                return jsonify({"error": "membership not found"}), 404

            if "archived" not in S.unreg_store["person_youth_group"].columns:
                S.unreg_store["person_youth_group"]["archived"] = False
            S.unreg_store["person_youth_group"].loc[mask, "archived"] = False
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
        cached = _period_cache_entry(path)
        return jsonify({"nodes": cached["nodes"], "edges": cached["edges"], "period": _period_for_response(period) if period else None})

    @app.get("/api/org-tree/<path:group_name>")
    def get_org_tree(group_name):
        period_id = request.args.get("period_id")
        if period_id:
            periods = _load_index(group_name)
            period = _find_period(periods, period_id)
            path = _period_path(group_name, period_id)
            if not os.path.exists(path):
                return jsonify({"nodes": [], "edges": [], "period": _period_for_response(period) if period else None, "periods": _periods_for_response(periods)})
            cached = _period_cache_entry(path)
            payload = {"nodes": cached["nodes"], "edges": cached["edges"], "period": _period_for_response(period) if period else None}
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
        cached = _period_cache_entry(path)
        data = {"nodes": cached["nodes"], "edges": cached["edges"], "period": _period_for_response(active)}
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
