import os
from datetime import date

import numpy as np
import pandas as pd
from flask import jsonify, request

from core import state as S


ORG_TREES_DIR = S.db.org_trees_dir
os.makedirs(ORG_TREES_DIR, exist_ok=True)
ORG_TREE_PERIODS_CSV = os.path.join(S.db.csv_dir, "org_tree_periods.csv")
ORG_TREE_NODES_CSV = os.path.join(S.db.csv_dir, "org_tree_nodes.csv")
ORG_TREE_EDGES_CSV = os.path.join(S.db.csv_dir, "org_tree_edges.csv")
ORG_TREE_HULLS_CSV = os.path.join(S.db.csv_dir, "org_tree_hulls.csv")

ORG_TREE_PERIOD_COLUMNS = ["group_id", "period_id", "jec_year", "from_date", "to_date"]


def _next_period_id() -> str:
    max_n = 0
    for row in _read_csv_records(ORG_TREE_PERIODS_CSV, ORG_TREE_PERIOD_COLUMNS):
        pid = str(row.get("period_id") or "").strip()
        if pid.startswith("OTPD") and pid[4:].isdigit():
            max_n = max(max_n, int(pid[4:]))
    return f"OTPD{(max_n + 1):06d}"


ORG_TREE_NODE_COLUMNS = ["period_id", "node_id", "person_id", "role"]
ORG_TREE_EDGE_COLUMNS = ["period_id", "from_node_id", "to_node_id", "edge_type"]
ORG_TREE_HULL_COLUMNS = ["node_id", "hull"]

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


def _uses_json_storage(group_ref: str | None) -> bool:
    return False


def _none_if_blank(value):
    text = "" if value is None else str(value).strip()
    if text in ("", "nan", "None", "null"):
        return None
    return text


def _csv_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _csv_bool(value):
    if isinstance(value, bool):
        return value
    text = _none_if_blank(value)
    if text is None:
        return None
    return text.lower() in ("1", "true", "yes", "y")


def _csv_number(value):
    text = _none_if_blank(value)
    if text is None:
        return None
    try:
        number = float(text)
        return int(number) if number.is_integer() else number
    except Exception:
        return text


def _read_csv_records(path: str, columns: list[str]) -> list[dict]:
    if not os.path.exists(path):
        return []
    try:
        df = pd.read_csv(path, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    except Exception:
        return []
    for col in columns:
        if col not in df.columns:
            df[col] = ""
    return df[columns].to_dict(orient="records")


def _write_csv_records(path: str, columns: list[str], rows: list[dict]):
    os.makedirs(S.db.csv_dir, exist_ok=True)
    df = pd.DataFrame(rows, columns=columns)
    df.to_csv(path, index=False, encoding="utf-8-sig")


def _period_from_csv_record(row: dict) -> dict:
    return {
        "id": _none_if_blank(row.get("period_id")),
        "jec_year": _csv_number(row.get("jec_year")),
        "from_date": _none_if_blank(row.get("from_date")),
        "to_date": _none_if_blank(row.get("to_date")),
    }


def _period_to_csv_record(group_id: str, period: dict) -> dict:
    p = _period_for_storage(period)
    return {
        "group_id": group_id,
        "period_id": _csv_value(p.get("id")),
        "jec_year": _csv_value(p.get("jec_year")),
        "from_date": _csv_value(p.get("from_date")),
        "to_date": _csv_value(p.get("to_date")),
    }


def _node_from_csv_record(row: dict) -> dict:
    node = {}
    node_id = _none_if_blank(row.get("node_id"))
    if node_id is not None:
        node["id"] = node_id
    person_id = _csv_number(row.get("person_id"))
    if person_id is not None:
        node["personId"] = person_id
    role = _none_if_blank(row.get("role"))
    if role is not None:
        node["role"] = role
    return node


def _node_to_csv_record(period_id: str, node: dict) -> dict:
    return {
        "period_id": period_id,
        "node_id": _csv_value(node.get("id")),
        "person_id": _csv_value(node.get("personId")),
        "role": _csv_value(node.get("role")),
    }


def _edge_from_csv_record(row: dict) -> dict:
    edge = {}
    from_node_id = _none_if_blank(row.get("from_node_id"))
    if from_node_id is not None:
        edge["from"] = from_node_id
    to_node_id = _none_if_blank(row.get("to_node_id"))
    if to_node_id is not None:
        edge["to"] = to_node_id
    edge_type = _none_if_blank(row.get("edge_type"))
    if edge_type is not None:
        edge["type"] = edge_type
    edge["id"] = f"{from_node_id or ''}|{to_node_id or ''}|{edge_type or ''}"
    return edge


def _edge_to_csv_record(period_id: str, edge: dict) -> dict:
    return {
        "period_id": period_id,
        "from_node_id": _csv_value(edge.get("from")),
        "to_node_id": _csv_value(edge.get("to")),
        "edge_type": _csv_value(edge.get("type")),
    }


def _load_csv_hulls(node_ids: set[str]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    wanted = {str(node_id).strip() for node_id in (node_ids or set()) if str(node_id or "").strip()}
    if not wanted:
        return result
    for row in _read_csv_records(ORG_TREE_HULLS_CSV, ORG_TREE_HULL_COLUMNS):
        nid = _none_if_blank(row.get("node_id"))
        hull = _none_if_blank(row.get("hull"))
        if nid not in wanted:
            continue
        if nid and hull:
            result.setdefault(nid, []).append(hull)
    return result


def _save_csv_hulls(nodes: list, *, remove_node_ids: set[str] | None = None):
    rows = _read_csv_records(ORG_TREE_HULLS_CSV, ORG_TREE_HULL_COLUMNS)
    node_ids = {
        _csv_value(node.get("id"))
        for node in (nodes or [])
        if _none_if_blank(node.get("id")) is not None
    }
    stale_node_ids = {
        str(node_id).strip()
        for node_id in (remove_node_ids or set())
        if str(node_id or "").strip()
    }
    replaced_node_ids = node_ids | stale_node_ids
    kept = [row for row in rows if _none_if_blank(row.get("node_id")) not in replaced_node_ids]
    for node in (nodes or []):
        nid = _csv_value(node.get("id"))
        for hull in (node.get("hulls") or []):
            hull_str = _none_if_blank(str(hull) if hull is not None else None)
            if nid and hull_str:
                kept.append({"node_id": nid, "hull": hull_str})
    _write_csv_records(ORG_TREE_HULLS_CSV, ORG_TREE_HULL_COLUMNS, kept)


def _delete_csv_hulls(node_ids: set[str]):
    delete_ids = {
        str(node_id).strip()
        for node_id in (node_ids or set())
        if str(node_id or "").strip()
    }
    if not delete_ids:
        return
    rows = _read_csv_records(ORG_TREE_HULLS_CSV, ORG_TREE_HULL_COLUMNS)
    _write_csv_records(
        ORG_TREE_HULLS_CSV,
        ORG_TREE_HULL_COLUMNS,
        [row for row in rows if _none_if_blank(row.get("node_id")) not in delete_ids],
    )


def _load_csv_index(group_id: str) -> list[dict]:
    rows = [
        row for row in _read_csv_records(ORG_TREE_PERIODS_CSV, ORG_TREE_PERIOD_COLUMNS)
        if row.get("group_id") == group_id and _none_if_blank(row.get("period_id")) is not None
    ]
    return [_period_from_csv_record(row) for row in rows]


def _save_csv_index(group_id: str, periods: list):
    rows = _read_csv_records(ORG_TREE_PERIODS_CSV, ORG_TREE_PERIOD_COLUMNS)
    kept = [row for row in rows if row.get("group_id") != group_id]
    kept.extend(_period_to_csv_record(group_id, period) for period in (periods or []))
    _write_csv_records(ORG_TREE_PERIODS_CSV, ORG_TREE_PERIOD_COLUMNS, kept)


def _load_csv_tree_data(group_id: str, period_id: str) -> dict:
    nodes = [
        _node_from_csv_record(row)
        for row in _read_csv_records(ORG_TREE_NODES_CSV, ORG_TREE_NODE_COLUMNS)
        if row.get("period_id") == period_id
    ]
    edges = [
        _edge_from_csv_record(row)
        for row in _read_csv_records(ORG_TREE_EDGES_CSV, ORG_TREE_EDGE_COLUMNS)
        if row.get("period_id") == period_id
    ]
    hulls_map = _load_csv_hulls({node.get("id") for node in nodes})
    for node in nodes:
        nid = node.get("id")
        if nid in hulls_map:
            node["hulls"] = hulls_map[nid]
    return {"nodes": nodes, "edges": edges}


def _save_csv_tree_data(group_id: str, period_id: str, data: dict):
    node_rows = _read_csv_records(ORG_TREE_NODES_CSV, ORG_TREE_NODE_COLUMNS)
    old_node_ids = {
        _none_if_blank(row.get("node_id"))
        for row in node_rows
        if row.get("period_id") == period_id
    }
    old_node_ids = {node_id for node_id in old_node_ids if node_id}
    kept_nodes = [row for row in node_rows if row.get("period_id") != period_id]
    kept_nodes.extend(_node_to_csv_record(period_id, node) for node in (data.get("nodes") or []))
    _write_csv_records(ORG_TREE_NODES_CSV, ORG_TREE_NODE_COLUMNS, kept_nodes)

    edge_rows = _read_csv_records(ORG_TREE_EDGES_CSV, ORG_TREE_EDGE_COLUMNS)
    kept_edges = [row for row in edge_rows if row.get("period_id") != period_id]
    kept_edges.extend(_edge_to_csv_record(period_id, edge) for edge in (data.get("edges") or []))
    _write_csv_records(ORG_TREE_EDGES_CSV, ORG_TREE_EDGE_COLUMNS, kept_edges)

    _save_csv_hulls(data.get("nodes") or [], remove_node_ids=old_node_ids)


def _delete_csv_tree_data(group_id: str, period_id: str):
    node_rows = _read_csv_records(ORG_TREE_NODES_CSV, ORG_TREE_NODE_COLUMNS)
    delete_node_ids = {
        _none_if_blank(row.get("node_id"))
        for row in node_rows
        if row.get("period_id") == period_id
    }
    delete_node_ids = {node_id for node_id in delete_node_ids if node_id}
    _write_csv_records(
        ORG_TREE_NODES_CSV,
        ORG_TREE_NODE_COLUMNS,
        [row for row in node_rows if row.get("period_id") != period_id],
    )

    edge_rows = _read_csv_records(ORG_TREE_EDGES_CSV, ORG_TREE_EDGE_COLUMNS)
    _write_csv_records(
        ORG_TREE_EDGES_CSV,
        ORG_TREE_EDGE_COLUMNS,
        [row for row in edge_rows if row.get("period_id") != period_id],
    )

    _delete_csv_hulls(delete_node_ids)


def _csv_storage_mtime() -> float:
    mtimes = []
    for path in (ORG_TREE_PERIODS_CSV, ORG_TREE_NODES_CSV, ORG_TREE_EDGES_CSV, ORG_TREE_HULLS_CSV):
        try:
            mtimes.append(os.path.getmtime(path))
        except OSError:
            pass
    return max(mtimes) if mtimes else 0


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
    if not _uses_json_storage(group_id):
        periods = _load_csv_index(group_id)
        if periods:
            return [_period_for_storage(p) for p in periods if isinstance(p, dict) and p.get("id")]
        legacy_path = S.db.legacy_group_path(group_id)
        if os.path.exists(legacy_path):
            return _migrate_legacy(group_id, legacy_path)
        return []

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
    if not _uses_json_storage(group_id):
        _save_csv_index(group_id, periods)
        return

    d = _group_dir(group_id)
    os.makedirs(d, exist_ok=True)
    S.db.save_json_file(_index_path(group_id), periods)


def _migrate_legacy(group_name: str, legacy_path: str) -> list:
    try:
        data = S.db.load_json_file(legacy_path, {})
    except Exception:
        return []
    period_id = _next_period_id()
    period = {
        "id": period_id,
        "jec_year": None,
        "from_date": None,
        "to_date": None,
    }
    group_id = _resolve_group_id(group_name)
    normalized = _normalize_tree_payload(data.get("nodes", []), data.get("edges", []))
    tree_data = {
        **data,
        "nodes": normalized["nodes"],
        "edges": normalized["edges"],
    }
    periods = [period]
    _save_index(group_id, periods)
    _save_tree_data(group_id, period_id, tree_data)
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


def _period_cache_entry(group_name: str, period_id: str) -> dict:
    data_version = _current_data_version()
    group_id = _resolve_group_id(group_name)
    if _uses_json_storage(group_id):
        cache_key = _period_path(group_id, period_id)
        try:
            mtime = os.path.getmtime(cache_key)
        except OSError:
            return {"nodes": [], "edges": [], "person_ids": set(), "unregistered_ids": set()}
    else:
        cache_key = f"csv:{group_id}:{period_id}"
        mtime = _csv_storage_mtime()

    cached = _ORG_TREE_PERIOD_CACHE.get(cache_key)
    if cached and cached.get("mtime") == mtime and cached.get("data_version") == data_version:
        return cached

    data = _load_tree_data(group_id, period_id)
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
    _ORG_TREE_PERIOD_CACHE[cache_key] = cached
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
            period_id = period.get("id")
            if not _tree_period_exists(group_id, period_id):
                continue

            period_cache = _period_cache_entry(group_id, period_id)
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


def _load_tree_data(group_name: str, period_id: str) -> dict:
    group_id = _resolve_group_id(group_name)
    if _uses_json_storage(group_id):
        return S.db.load_json_file(_period_path(group_id, period_id), {"nodes": [], "edges": []})
    return _load_csv_tree_data(group_id, period_id)


def _save_tree_data(group_name: str, period_id: str, data: dict):
    group_id = _resolve_group_id(group_name)
    if _uses_json_storage(group_id):
        os.makedirs(_group_dir(group_id), exist_ok=True)
        S.db.save_json_file(_period_path(group_id, period_id), data)
        return
    _save_csv_tree_data(group_id, period_id, data)


def _tree_period_exists(group_name: str, period_id: str) -> bool:
    group_id = _resolve_group_id(group_name)
    if _uses_json_storage(group_id):
        return os.path.exists(_period_path(group_id, period_id))
    return _find_period(_load_index(group_id), period_id) is not None


def _delete_tree_data(group_name: str, period_id: str):
    group_id = _resolve_group_id(group_name)
    if _uses_json_storage(group_id):
        ppath = _period_path(group_id, period_id)
        try:
            if os.path.exists(ppath):
                os.remove(ppath)
        except Exception:
            pass
        return
    _delete_csv_tree_data(group_id, period_id)


def _migrate_all_org_tree_files():
    try:
        if not os.path.exists(ORG_TREES_DIR):
            return

        for group_dir in os.scandir(ORG_TREES_DIR):
            if not group_dir.is_dir():
                continue
            current_name = group_dir.name
            canonical = _canonical_group_ref(current_name)
            if canonical != GS_GROUP_ID:
                continue
            target_group_id = GS_GROUP_ID
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
        has_person_id = bool(person_id and str(person_id).strip())
        has_unregistered_id = bool(unregistered_id and str(unregistered_id).strip())
        if not has_person_id and not has_unregistered_id:
            return jsonify({"error": "person_id or unregistered_id is required"}), 400
        if has_person_id and has_unregistered_id:
            return jsonify({"error": "provide either person_id or unregistered_id"}), 400

        from core.routes_people import require_profile_view_access

        target_type = "unregistered" if has_unregistered_id else "registered"
        target_id = unregistered_id if has_unregistered_id else person_id
        err = require_profile_view_access(target_type, target_id)
        if err:
            return err

        group_refs = _parse_group_refs(request.args.get("group_ids"))
        history = _load_history_trees(group_refs, person_id=person_id, unregistered_id=unregistered_id)
        return jsonify({"items": history})

    @app.get("/api/org-tree/<path:group_name>/periods")
    def get_org_tree_periods(group_name):
        periods = _load_index(group_name)
        return jsonify(_periods_for_response(periods))

    @app.get("/api/org-tree/<path:group_name>/<period_id>")
    def get_org_tree_period(group_name, period_id):
        periods = _load_index(group_name)
        period = _find_period(periods, period_id)
        if not _tree_period_exists(group_name, period_id):
            return jsonify({"nodes": [], "edges": [], "period": _period_for_response(period) if period else None}), 404
        cached = _period_cache_entry(group_name, period_id)
        return jsonify({"nodes": cached["nodes"], "edges": cached["edges"], "period": _period_for_response(period) if period else None})

    @app.get("/api/org-tree/<path:group_name>")
    def get_org_tree(group_name):
        period_id = request.args.get("period_id")
        if period_id:
            periods = _load_index(group_name)
            period = _find_period(periods, period_id)
            if not _tree_period_exists(group_name, period_id):
                return jsonify({"nodes": [], "edges": [], "period": _period_for_response(period) if period else None, "periods": _periods_for_response(periods)})
            cached = _period_cache_entry(group_name, period_id)
            payload = {"nodes": cached["nodes"], "edges": cached["edges"], "period": _period_for_response(period) if period else None}
            payload["periods"] = _periods_for_response(periods)
            return jsonify(payload)

        periods = _load_index(group_name)
        if not periods:
            return jsonify({"nodes": [], "edges": [], "period": None, "periods": []})

        active = next((p for p in periods if p.get("to_date") is None), None)
        if not active:
            active = sorted(periods, key=lambda p: p.get("from_date") or "", reverse=True)[0]

        if not _tree_period_exists(group_name, active["id"]):
            return jsonify({"nodes": [], "edges": [], "period": _period_for_response(active), "periods": _periods_for_response(periods)})
        cached = _period_cache_entry(group_name, active["id"])
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

            new_id = _next_period_id()
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
            _save_tree_data(group_name, new_id, tree_data)

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
            _save_tree_data(group_name, pid_str, tree_data)
            period_payload = _find_period(periods, pid_str)
            return jsonify({"ok": True, "period": _period_for_response(period_payload), "periods": _periods_for_response(periods)})

        new_id = _next_period_id()
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
        _save_tree_data(group_name, new_id, tree_data)
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
        _delete_tree_data(group_name, period_id)

        return jsonify({"ok": True, "periods": _periods_for_response(periods)})


_migrate_all_org_tree_files()
