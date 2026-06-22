import json
import os
import threading
import uuid
from datetime import datetime, timezone

import pandas as pd
from flask import jsonify, request

from core import state as S

_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_GRANTS_FILE = os.path.join(_BASE_DIR, "data", "privilege_grants.json")
_LOCK = threading.Lock()

ALL_AGE_GROUPS = ["البراعم", "الإعدادي", "الثانوي", "الجامعيّة", "العاملة", "مرشد روحيّ"]

PRIVILEGE_TYPES = [
    {"id": "profile_access",           "label": "الوصول للملفات الشخصية"},
    {"id": "promotion_access",          "label": "صلاحية الترفيع"},
    {"id": "yg_registration_approval",  "label": "الموافقة على تسجيل الشبيبة"},
    {"id": "yg_file_access",            "label": "الوصول لملف الفرقة"},
]

_CSV_DIR = S.db.csv_dir
_OT_PERIODS = os.path.join(_CSV_DIR, "scd_org_tree_periods.csv")
_OT_NODES   = os.path.join(_CSV_DIR, "scd_org_tree_nodes.csv")
_OT_HULLS   = os.path.join(_CSV_DIR, "scd_org_tree_hulls.csv")
_OT_EDGES   = os.path.join(_CSV_DIR, "scd_org_tree_edges.csv")

GS_GROUP_ID = "GS"
ORG_TREE_DESCENDANTS_SCOPE_TYPE = "org_tree_descendants"
ORG_TREE_DESCENDANTS_GRANTEE_TYPE = "org_tree_descendants"


# ── Storage ──────────────────────────────────────────────────────────────────

def _load_grants():
    if not os.path.exists(_GRANTS_FILE):
        return []
    try:
        with open(_GRANTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_grants(grants):
    os.makedirs(os.path.dirname(_GRANTS_FILE), exist_ok=True)
    with open(_GRANTS_FILE, "w", encoding="utf-8") as f:
        json.dump(grants, f, ensure_ascii=False, indent=2)


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _current_user():
    try:
        from core.routes_auth import exports as auth_exports
        return auth_exports["_current_user"]()
    except Exception:
        return None


def _require_admin():
    user = _current_user()
    if not user or user.get("role") != "admin":
        return jsonify({"error": "unauthorized"}), 403
    return None


# ── CSV helpers ───────────────────────────────────────────────────────────────

def _read_scd_csv(path, columns):
    """Read a SCD CSV, returning only active rows with just the requested columns."""
    if not os.path.exists(path):
        return []
    try:
        df = pd.read_csv(path, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    except Exception:
        return []
    for col in columns:
        if col not in df.columns:
            df[col] = ""
    flag_col = S.SCD_CURRENTLY_ACTIVE_FLAG_COL
    if flag_col in df.columns:
        df = df[df[flag_col].str.strip().str.lower().map(
            lambda v: v not in ("false", "0", "no", "n", "f")
        )]
    return df[columns].to_dict(orient="records")


# ── Person helpers ────────────────────────────────────────────────────────────

def _none_str(v):
    text = ("" if v is None else str(v)).strip()
    return None if text in ("", "nan", "None", "null", "NaT") else text


def _active_persons_with_titles():
    persons = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))
    return S.merge_person_titles(persons)


def _person_full_name(row):
    parts = [_none_str(row.get(k)) for k in ("title", "ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")]
    return " ".join(p for p in parts if p)


def _get_person_name(person_id):
    try:
        persons = _active_persons_with_titles()
        if persons.empty:
            return None
        row = persons[persons["person_id"].astype(str) == str(person_id)]
        if row.empty:
            return None
        return _person_full_name(row.iloc[0]) or None
    except Exception:
        return None


def _normalize_for_search(text):
    return S.normalize_arabic(str(text or ""))


def _search_persons(query, limit=20):
    q = _normalize_for_search(query)
    if not q or len(q) < 2:
        return []
    try:
        persons = _active_persons_with_titles()
        if persons.empty:
            return []
        results = []
        for _, row in persons.iterrows():
            pid = _none_str(row.get("person_id"))
            if not pid:
                continue
            ar_name = _person_full_name(row)
            en_parts = [_none_str(row.get(k)) for k in ("en_first_name", "en_second_name", "en_third_name", "en_last_name")]
            en_name = " ".join(p for p in en_parts if p)
            if q in _normalize_for_search(ar_name) or q in _normalize_for_search(en_name):
                results.append({"person_id": pid, "name": ar_name, "en_name": en_name})
            if len(results) >= limit:
                break
        return results
    except Exception:
        return []


def _refresh_specific_person_grantee_name(grantee):
    if not isinstance(grantee, dict):
        return grantee
    if grantee.get("type") != "specific_person" or not grantee.get("person_id"):
        return grantee
    person_name = _get_person_name(grantee.get("person_id"))
    if person_name:
        grantee["person_name"] = person_name
    return grantee


def _refresh_specific_person_grantee_names(grants):
    for grant in grants or []:
        grantee = (grant or {}).get("grantee") or {}
        _refresh_specific_person_grantee_name(grantee)
    return grants


# ── Org tree helpers ──────────────────────────────────────────────────────────

def _get_active_period_id(group_id):
    """Find the current (or most recent) period_id for a group."""
    periods = _read_scd_csv(_OT_PERIODS, ["group_id", "period_id", "from_date", "to_date"])
    target_key = S.safe_youth_group_key(group_id)
    group_periods = [
        p for p in periods
        if S.safe_youth_group_key(p.get("group_id", "")) == target_key
    ]
    if not group_periods:
        return None
    open_p = [p for p in group_periods if not _none_str(p.get("to_date"))]
    if open_p:
        return open_p[-1].get("period_id")
    sorted_p = sorted(group_periods, key=lambda p: p.get("from_date", ""), reverse=True)
    return sorted_p[0].get("period_id") if sorted_p else None


def _load_edges_parent_map(period_id):
    """Return {child_node_id: parent_node_id} for hierarchy edges in a period."""
    if not os.path.exists(_OT_EDGES):
        return {}
    try:
        df = pd.read_csv(_OT_EDGES, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    except Exception:
        return {}
    flag_col = S.SCD_CURRENTLY_ACTIVE_FLAG_COL
    if flag_col in df.columns:
        df = df[df[flag_col].str.strip().str.lower().map(lambda v: v not in ("false", "0", "no", "n", "f"))]
    if "period_id" in df.columns:
        df = df[df["period_id"] == period_id]
    if "edge_type" in df.columns:
        df = df[df["edge_type"] == "hierarchy"]
    parent_map = {}
    for _, row in df.iterrows():
        child = _none_str(row.get("to_node_id"))
        parent = _none_str(row.get("from_node_id"))
        if child and parent:
            parent_map[child] = parent
    return parent_map


def _load_edges_parent_multi_map(period_id):
    """Return {child_node_id: [parent_node_id, ...]} for hierarchy edges in a period."""
    if not os.path.exists(_OT_EDGES):
        return {}
    try:
        df = pd.read_csv(_OT_EDGES, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    except Exception:
        return {}
    flag_col = S.SCD_CURRENTLY_ACTIVE_FLAG_COL
    if flag_col in df.columns:
        df = df[df[flag_col].str.strip().str.lower().map(lambda v: v not in ("false", "0", "no", "n", "f"))]
    if "period_id" in df.columns:
        df = df[df["period_id"] == period_id]
    if "edge_type" in df.columns:
        df = df[df["edge_type"] == "hierarchy"]
    parents_by_child: dict[str, list[str]] = {}
    for _, row in df.iterrows():
        child = _none_str(row.get("to_node_id"))
        parent = _none_str(row.get("from_node_id"))
        if not child or not parent:
            continue
        parents = parents_by_child.setdefault(child, [])
        if parent not in parents:
            parents.append(parent)
    return parents_by_child


def _build_person_name_map():
    """Return {person_id: full_name} built once from the in-memory store."""
    try:
        persons = _active_persons_with_titles()
        if persons.empty:
            return {}
        result = {}
        for _, row in persons.iterrows():
            pid = _none_str(row.get("person_id"))
            if pid:
                result[pid] = _person_full_name(row)
        return result
    except Exception:
        return {}


def _get_org_tree_nodes_for_group(group_id, _name_map=None):
    """Return enriched node list for the current period of a group."""
    period_id = _get_active_period_id(group_id)
    if not period_id:
        return []

    nodes = _read_scd_csv(_OT_NODES, ["period_id", "node_id", "person_id", "role", "visibility"])
    nodes = [n for n in nodes if n.get("period_id") == period_id and _none_str(n.get("person_id"))]

    hulls_raw = _read_scd_csv(_OT_HULLS, ["node_id", "hull"])
    # A node can belong to multiple hulls — build a list per node_id
    hull_map: dict[str, list[str]] = {}
    for h in hulls_raw:
        nid = h.get("node_id")
        hull = _none_str(h.get("hull"))
        if nid and hull:
            hull_map.setdefault(nid, []).append(hull)

    # Build name map once for all nodes in this group (avoids per-node DataFrame copies)
    name_map = _name_map if _name_map is not None else _build_person_name_map()

    result = []
    for n in nodes:
        pid = _none_str(n.get("person_id"))
        if not pid:
            continue
        nid = n.get("node_id", "")
        result.append({
            "node_id": nid,
            "person_id": pid,
            "role": _none_str(n.get("role")) or "",
            "hulls": hull_map.get(nid, []),  # list of hull names this node belongs to
            "person_name": name_map.get(pid),
        })
    return result


def _extract_youth_group_ids(spec):
    """Return normalized youth_group_ids from either current array or legacy single-value shapes."""
    ids = spec.get("youth_group_ids") or (
        [spec["youth_group_id"]] if spec.get("youth_group_id") else []
    )
    result = []
    seen = set()
    for raw in ids:
        gid = _none_str(raw)
        if not gid or gid in seen:
            continue
        seen.add(gid)
        result.append(gid)
    return result


def _org_tree_context_cache_key(group_id):
    return f"__org_tree_context__:{S.safe_youth_group_key(group_id)}"


def _get_org_tree_context(group_id, tree_cache=None):
    if tree_cache is None:
        tree_cache = {}
    key = _org_tree_context_cache_key(group_id)
    if key in tree_cache:
        return tree_cache[key]

    context = {
        "period_id": None,
        "person_by_node": {},
        "nodes_by_person": {},
        "parent_by_node": {},
        "parents_by_node": {},
        "children_by_node": {},
    }
    period_id = _get_active_period_id(group_id)
    context["period_id"] = period_id
    if not period_id:
        tree_cache[key] = context
        return context

    nodes = _read_scd_csv(_OT_NODES, ["period_id", "node_id", "person_id", "role", "visibility"])
    nodes = [
        n for n in nodes
        if n.get("period_id") == period_id and _none_str(n.get("node_id"))
    ]
    node_ids = {_none_str(n.get("node_id")) for n in nodes if _none_str(n.get("node_id"))}

    for n in nodes:
        node_id = _none_str(n.get("node_id"))
        person_id = _none_str(n.get("person_id"))
        if not node_id:
            continue
        context["person_by_node"][node_id] = person_id
        if person_id:
            context["nodes_by_person"].setdefault(person_id, []).append(node_id)

    parents_by_node = {}
    for child, parents in _load_edges_parent_multi_map(period_id).items():
        if child not in node_ids:
            continue
        valid_parents = [parent for parent in parents if parent in node_ids]
        if not valid_parents:
            continue
        parents_by_node[child] = valid_parents
    context["parents_by_node"] = parents_by_node
    context["parent_by_node"] = {
        child: parents[0]
        for child, parents in parents_by_node.items()
        if parents
    }
    for child, parents in parents_by_node.items():
        for parent in parents:
            children = context["children_by_node"].setdefault(parent, [])
            if child not in children:
                children.append(child)

    tree_cache[key] = context
    return context


def _descendant_person_ids_for_group(person_id, group_id, tree_cache=None):
    ctx = _get_org_tree_context(group_id, tree_cache)
    start_person_id = _none_str(person_id)
    if not start_person_id:
        return set()

    descendants = set()
    start_nodes = list(ctx["nodes_by_person"].get(start_person_id, []))
    seen_nodes = set(start_nodes)
    for start_node in start_nodes:
        queue = list(ctx["children_by_node"].get(start_node, []))
        while queue:
            node_id = queue.pop(0)
            if node_id in seen_nodes:
                continue
            seen_nodes.add(node_id)

            child_person_id = ctx["person_by_node"].get(node_id)
            if child_person_id and child_person_id != start_person_id:
                descendants.add(child_person_id)
            queue.extend(ctx["children_by_node"].get(node_id, []))
    return descendants


def _ancestor_person_ids_for_group(person_id, group_id, tree_cache=None):
    ctx = _get_org_tree_context(group_id, tree_cache)
    target_person_id = _none_str(person_id)
    if not target_person_id:
        return set()

    ancestors = set()
    start_nodes = list(ctx["nodes_by_person"].get(target_person_id, []))
    seen_nodes = set(start_nodes)
    queue = [
        parent
        for start_node in start_nodes
        for parent in ctx["parents_by_node"].get(start_node, [])
    ]
    while queue:
        parent = queue.pop(0)
        if parent in seen_nodes:
            continue
        seen_nodes.add(parent)
        parent_person_id = ctx["person_by_node"].get(parent)
        if parent_person_id and parent_person_id != target_person_id:
            ancestors.add(parent_person_id)
        queue.extend(ctx["parents_by_node"].get(parent, []))
    return ancestors


def _all_org_tree_person_ids_for_groups(group_ids, tree_cache=None):
    result = set()
    for group_id in group_ids:
        ctx = _get_org_tree_context(group_id, tree_cache)
        result.update(pid for pid in ctx["nodes_by_person"].keys() if _none_str(pid))
    return result


def _build_positions_response(group_id):
    period_id = _get_active_period_id(group_id)
    nodes = _get_org_tree_nodes_for_group(group_id, _build_person_name_map())

    # Unique roles
    seen_roles = {}
    for n in nodes:
        role = n.get("role") or ""
        if role and role not in seen_roles:
            seen_roles[role] = []
        if role:
            seen_roles[role].append({"person_id": n["person_id"], "person_name": n["person_name"]})

    # parent_map: child_node_id → parent_node_id (hierarchy edges only)
    parent_map = _load_edges_parent_map(period_id) if period_id else {}

    # hull_name → list of nodes in that hull
    hull_name_to_nodes: dict[str, list] = {}
    for n in nodes:
        for hull_name in n.get("hulls", []):
            hull_name_to_nodes.setdefault(hull_name, []).append(n)

    hull_instances = []
    for hull_name, hull_nodes in hull_name_to_nodes.items():
        hull_node_ids = {n["node_id"] for n in hull_nodes}

        # Find roots: nodes whose parent is absent or outside this hull
        roots = [
            n for n in hull_nodes
            if parent_map.get(n["node_id"]) not in hull_node_ids
        ]

        if len(roots) <= 1:
            # Single subtree — one hull instance, no disambiguation needed
            hull_instances.append({
                "hull": hull_name,
                "instance_node_ids": sorted(n["node_id"] for n in hull_nodes),
                "parent_info": None,
                "members": [
                    {"person_id": n["person_id"], "person_name": n["person_name"], "role": n["role"]}
                    for n in hull_nodes
                ],
            })
        else:
            # Multiple roots → split by subtree; each root is the head of its instance
            # Build children map restricted to hull nodes
            children_in_hull: dict[str, list[str]] = {}
            for n in hull_nodes:
                p = parent_map.get(n["node_id"])
                if p and p in hull_node_ids:
                    children_in_hull.setdefault(p, []).append(n["node_id"])

            node_by_id = {n["node_id"]: n for n in hull_nodes}

            for root in roots:
                # BFS from this root through hull to collect its subtree
                subtree_ids: set[str] = set()
                queue = [root["node_id"]]
                while queue:
                    curr = queue.pop(0)
                    subtree_ids.add(curr)
                    queue.extend(children_in_hull.get(curr, []))

                inst_nodes = [node_by_id[nid] for nid in subtree_ids if nid in node_by_id]

                hull_instances.append({
                    "hull": hull_name,
                    "instance_node_ids": sorted(subtree_ids),
                    "parent_info": {
                        "node_id": root["node_id"],
                        "role": root.get("role", ""),
                        "person_name": root.get("person_name", ""),
                        "display": root.get("person_name") or root.get("role") or root["node_id"],
                    },
                    "members": [
                        {"person_id": n["person_id"], "person_name": n["person_name"], "role": n["role"]}
                        for n in inst_nodes
                    ],
                })

    return {
        "positions": [{"role": r, "members": m} for r, m in seen_roles.items()],
        "hulls":     hull_instances,
        "all_nodes": [{"person_id": n["person_id"], "person_name": n["person_name"], "role": n["role"], "hulls": n["hulls"]} for n in nodes],
    }


# ── Scope resolution ─────────────────────────────────────────────────────────

def _resolve_scope_to_person_ids(scope):
    """Return set of registered person_id strings covered by a scope spec."""
    stype = scope.get("type", "all")

    try:
        pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
        persons = S._scd_filter_active(S.store.get("persons", pd.DataFrame()))

        if stype == "all":
            if persons.empty:
                return set()
            return {str(pid) for pid in persons["person_id"].dropna() if _none_str(pid)}

        if pyg.empty:
            return set()

        # Support both legacy single values and new array format
        target_ygs = set(scope.get("youth_group_ids") or (
            [scope["youth_group_id"]] if scope.get("youth_group_id") else []
        ))
        target_ags = set(scope.get("age_groups") or (
            [scope["age_group"]] if scope.get("age_group") else []
        ))

        if stype == "youth_group":
            if not target_ygs:
                return set()
            rows = pyg[pyg["youth_group_id"].astype(str).isin(target_ygs)]
        elif stype == "age_group":
            if not target_ygs or not target_ags:
                return set()
            rows = pyg[
                pyg["youth_group_id"].astype(str).isin(target_ygs) &
                pyg["age_group"].astype(str).isin(target_ags)
            ]
        else:
            return set()

        return {str(pid) for pid in rows["person_id"].dropna() if _none_str(pid)}
    except Exception:
        return set()


def _resolve_scope_to_unreg_person_ids(scope):
    """Return set of unregistered (unreg_store) person_id strings covered by a scope spec."""
    stype = scope.get("type", "all")
    try:
        unreg_persons = S._scd_filter_active(S.unreg_store.get("persons", pd.DataFrame()))
        unreg_pyg = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))

        if stype == "all":
            if unreg_persons.empty or "person_id" not in unreg_persons.columns:
                return set()
            return {str(pid) for pid in unreg_persons["person_id"].dropna() if _none_str(pid)}

        if unreg_pyg.empty or "person_id" not in unreg_pyg.columns:
            return set()

        target_ygs = set(scope.get("youth_group_ids") or (
            [scope["youth_group_id"]] if scope.get("youth_group_id") else []
        ))
        target_ags = set(scope.get("age_groups") or (
            [scope["age_group"]] if scope.get("age_group") else []
        ))

        if stype == "youth_group":
            if not target_ygs:
                return set()
            rows = unreg_pyg[unreg_pyg["youth_group_id"].astype(str).isin(target_ygs)]
        elif stype == "age_group":
            if not target_ygs or not target_ags:
                return set()
            rows = unreg_pyg[
                unreg_pyg["youth_group_id"].astype(str).isin(target_ygs) &
                unreg_pyg["age_group"].astype(str).isin(target_ags)
            ]
        else:
            return set()

        return {str(pid) for pid in rows["person_id"].dropna() if _none_str(pid)}
    except Exception:
        return set()


# ── Grant resolution ──────────────────────────────────────────────────────────

def _resolve_grantee_to_person_ids(grantee, tree_cache=None):
    """Return set of person_id strings that currently satisfy the grantee spec."""
    if tree_cache is None:
        tree_cache = {}
    gtype = grantee.get("type")

    if gtype == "specific_person":
        pid = _none_str(grantee.get("person_id"))
        return {pid} if pid else set()

    if gtype == ORG_TREE_DESCENDANTS_GRANTEE_TYPE:
        return _all_org_tree_person_ids_for_groups(_extract_youth_group_ids(grantee), tree_cache)

    if gtype in ("org_tree_position", "gen_sec_position"):
        group_id = GS_GROUP_ID if gtype == "gen_sec_position" else _none_str(grantee.get("youth_group_id"))
        if not group_id:
            return set()
        if group_id not in tree_cache:
            # Build name map once per request and reuse across all group loads
            if "__name_map__" not in tree_cache:
                tree_cache["__name_map__"] = _build_person_name_map()
            tree_cache[group_id] = _get_org_tree_nodes_for_group(group_id, tree_cache["__name_map__"])
        nodes = tree_cache[group_id]

        mode = grantee.get("selection_mode", "all")
        if mode == "all":
            return {n["person_id"] for n in nodes if n.get("person_id")}
        if mode == "positions":
            targets = set(grantee.get("positions") or [])
            return {n["person_id"] for n in nodes if n.get("role") in targets and n.get("person_id")}
        if mode == "hull":
            hull_nodes_spec = grantee.get("hull_nodes")
            if hull_nodes_spec:
                # Precise match: resolve by the specific node_ids captured at grant time
                hull_nodes_set = set(hull_nodes_spec)
                return {n["person_id"] for n in nodes if n.get("node_id") in hull_nodes_set and n.get("person_id")}
            else:
                # Legacy: match by hull name across all nodes
                target_hull = _none_str(grantee.get("hull")) or ""
                return {n["person_id"] for n in nodes if target_hull in n.get("hulls", []) and n.get("person_id")}

    return set()


def _is_org_tree_descendants_grant(grant):
    if grant.get("privilege_type") != "profile_access":
        return False
    scope = grant.get("scope") or {}
    grantee = grant.get("grantee") or {}
    return (
        scope.get("type") == ORG_TREE_DESCENDANTS_SCOPE_TYPE
        or grantee.get("type") == ORG_TREE_DESCENDANTS_GRANTEE_TYPE
    )


def _org_tree_descendants_grant_group_ids(grant):
    grantee_ids = _extract_youth_group_ids(grant.get("grantee") or {})
    if grantee_ids:
        return grantee_ids
    return _extract_youth_group_ids(grant.get("scope") or {})


def _known_unregistered_person_ids():
    try:
        unreg_persons = S._scd_filter_active(S.unreg_store.get("persons", pd.DataFrame()))
        if unreg_persons.empty or "person_id" not in unreg_persons.columns:
            return set()
        return {str(pid) for pid in unreg_persons["person_id"].dropna() if _none_str(pid)}
    except Exception:
        return set()


def _split_registered_unregistered_person_ids(person_ids):
    unregistered_known = _known_unregistered_person_ids()
    reg_ids = set()
    unreg_ids = set()
    for raw_pid in person_ids:
        pid = _none_str(raw_pid)
        if not pid:
            continue
        if pid in unregistered_known:
            unreg_ids.add(pid)
        else:
            reg_ids.add(pid)
    return reg_ids, unreg_ids


def _profile_access_ids_for_grant(person_id, grant, tree_cache=None):
    if grant.get("privilege_type") != "profile_access":
        return set(), set()

    if _is_org_tree_descendants_grant(grant):
        descendants = set()
        for group_id in _org_tree_descendants_grant_group_ids(grant):
            descendants |= _descendant_person_ids_for_group(person_id, group_id, tree_cache)
        return _split_registered_unregistered_person_ids(descendants)

    if person_id not in _resolve_grantee_to_person_ids(grant.get("grantee") or {}, tree_cache):
        return set(), set()

    scope = grant.get("scope") or {}
    return _resolve_scope_to_person_ids(scope), _resolve_scope_to_unreg_person_ids(scope)


def _profile_accessors_for_grant(target_person_id, grant, tree_cache=None, yg_cache=None):
    if grant.get("privilege_type") != "profile_access":
        return set()

    if _is_org_tree_descendants_grant(grant):
        accessors = set()
        for group_id in _org_tree_descendants_grant_group_ids(grant):
            accessors |= _ancestor_person_ids_for_group(target_person_id, group_id, tree_cache)
        return accessors

    if not _scope_covers_person(grant.get("scope") or {}, target_person_id, yg_cache):
        return set()
    return _resolve_grantee_to_person_ids(grant.get("grantee") or {}, tree_cache)


def _person_yg_memberships(person_id):
    """Return list of {youth_group_id, age_group} for a person."""
    try:
        pyg = S._scd_filter_active(S.store.get("person_youth_group", pd.DataFrame()))
        if pyg.empty:
            return []
        rows = pyg[pyg["person_id"].astype(str) == str(person_id)]
        return [
            {
                "youth_group_id": _none_str(r.get("youth_group_id")) or "",
                "age_group":      _none_str(r.get("age_group")) or "",
            }
            for _, r in rows.iterrows()
        ]
    except Exception:
        return []


def _scope_covers_person(scope, person_id, _yg_cache=None):
    stype = scope.get("type", "all")
    if stype == "all":
        return True

    cache_key = str(person_id)
    if _yg_cache is None:
        _yg_cache = {}
    if cache_key not in _yg_cache:
        _yg_cache[cache_key] = _person_yg_memberships(person_id)
    memberships = _yg_cache[cache_key]

    # Support both legacy single values and new array format
    target_ygs = set(scope.get("youth_group_ids") or (
        [scope["youth_group_id"]] if scope.get("youth_group_id") else []
    ))
    target_ags = set(scope.get("age_groups") or (
        [scope["age_group"]] if scope.get("age_group") else []
    ))

    if stype == "youth_group":
        return any(m.get("youth_group_id") in target_ygs for m in memberships)
    if stype == "age_group":
        return any(m.get("youth_group_id") in target_ygs and m.get("age_group") in target_ags for m in memberships)
    return False


# ── Youth groups helper ───────────────────────────────────────────────────────

def _get_youth_groups_list():
    try:
        ygs = S._scd_filter_active(S.store.get("youth_groups", pd.DataFrame()))
        if ygs.empty:
            return []
        result = []
        for _, row in ygs.iterrows():
            gid = _none_str(row.get("youth_group_id"))
            if not gid:
                continue
            result.append({
                "id":         gid,
                "name":       S.youth_group_name(gid) or _none_str(row.get("youth_group_short_name")) or gid,
                "short_name": _none_str(row.get("youth_group_short_name")) or "",
            })
        return result
    except Exception:
        return []


# ── Unregistered list builder ─────────────────────────────────────────────────

def _build_unreg_list_for_ids(unreg_ids: set[str]) -> list[dict]:
    """Build a minimal enriched unregistered-members list for the given person IDs."""
    try:
        persons_df = S.unregistered_persons_view_df()
        if persons_df.empty or "person_id" not in persons_df.columns:
            return []

        persons_df = persons_df[persons_df["person_id"].astype(str).isin(unreg_ids)].copy()
        if persons_df.empty:
            return []

        pyg_df = S._scd_filter_active(S.unreg_store.get("person_youth_group", pd.DataFrame()))

        # Build per-person active and archived youth-group data
        yg_col = getattr(S, "YOUTH_GROUP_ID_COL", "youth_group_id")
        active_yg: dict[str, list[str]] = {}
        active_yg_id: dict[str, list[str]] = {}
        active_ag: dict[str, list[str]] = {}
        arch_yg: dict[str, list[str]] = {}
        arch_yg_id: dict[str, list[str]] = {}
        arch_ag: dict[str, list[str]] = {}

        if not pyg_df.empty and "person_id" in pyg_df.columns:
            for _, row in pyg_df.iterrows():
                pid = _none_str(row.get("person_id"))
                if not pid or pid not in unreg_ids:
                    continue
                archived_flag = row.get("archived")
                is_archived = bool(archived_flag) if archived_flag is not None and str(archived_flag) not in ("nan", "None", "") else False
                yg_id = _none_str(row.get(yg_col) or row.get("youth_group_id"))
                age_grp = _none_str(row.get("age_group")) or ""
                if not yg_id:
                    continue
                yg_name = getattr(S, "youth_group_display_label", lambda x: x)(yg_id) or yg_id
                if is_archived:
                    arch_yg.setdefault(pid, []).append(yg_name)
                    arch_yg_id.setdefault(pid, []).append(yg_id)
                    arch_ag.setdefault(pid, []).append(age_grp)
                else:
                    active_yg.setdefault(pid, []).append(yg_name)
                    active_yg_id.setdefault(pid, []).append(yg_id)
                    active_ag.setdefault(pid, []).append(age_grp)

        result = []
        for _, row in persons_df.replace({pd.NA: None}).iterrows():
            pid = _none_str(row.get("person_id"))
            if not pid:
                continue
            d = dict(row)
            has_active = bool(active_yg.get(pid))
            d["_youth_groups"] = active_yg.get(pid, [])
            d["_youth_group_ids"] = active_yg_id.get(pid, [])
            d["_age_groups"] = active_ag.get(pid, [])
            d["_archived_youth_groups"] = arch_yg.get(pid, [])
            d["_archived_youth_group_ids"] = arch_yg_id.get(pid, [])
            d["_archived_age_groups"] = arch_ag.get(pid, [])
            # A person is "archived" if all their memberships are archived (same logic as registered)
            d["archived"] = not has_active and bool(arch_yg.get(pid))
            result.append(d)
        return result
    except Exception:
        return []


# ── Public helpers (used by other route modules) ───────────────────────────────

def get_user_profile_access_ids(person_id: str) -> tuple[set[str], set[str]]:
    """Return (reg_ids, unreg_ids) of person IDs this person has profile_access to."""
    with _LOCK:
        grants = _load_grants()
    tree_cache: dict = {}
    reg_ids: set[str] = set()
    unreg_ids: set[str] = set()
    for g in grants:
        grant_reg_ids, grant_unreg_ids = _profile_access_ids_for_grant(person_id, g, tree_cache)
        reg_ids |= grant_reg_ids
        unreg_ids |= grant_unreg_ids
    reg_ids.discard(person_id)
    unreg_ids.discard(person_id)
    return reg_ids, unreg_ids


def get_yg_registration_approval_grantees(youth_group_id: str, age_group: str) -> list[dict]:
    """Return [{person_id, person_name, grant_label}] with yg_registration_approval covering this YG+age_group."""
    with _LOCK:
        grants = _load_grants()
    yg_id = str(youth_group_id or "").strip()
    ag = str(age_group or "").strip()
    tree_cache: dict = {}
    seen_pids: set[str] = set()
    result = []
    for g in grants:
        if g.get("privilege_type") != "yg_registration_approval":
            continue
        scope = g.get("scope") or {}
        stype = scope.get("type", "")
        target_ygs = set(scope.get("youth_group_ids") or (
            [scope["youth_group_id"]] if scope.get("youth_group_id") else []
        ))
        target_ags = set(scope.get("age_groups") or (
            [scope["age_group"]] if scope.get("age_group") else []
        ))
        if stype == "youth_group":
            if yg_id not in target_ygs:
                continue
        elif stype == "age_group":
            if yg_id not in target_ygs or ag not in target_ags:
                continue
        else:
            continue
        grantee = g.get("grantee") or {}
        mode = grantee.get("selection_mode", "")
        if mode == "positions" and grantee.get("positions"):
            grant_label = "، ".join(grantee["positions"])
        elif mode == "hull" and grantee.get("hull"):
            grant_label = grantee["hull"]
        else:
            grant_label = ""
        for pid in _resolve_grantee_to_person_ids(grantee, tree_cache):
            if pid in seen_pids:
                continue
            seen_pids.add(pid)
            result.append({
                "person_id": pid,
                "person_name": _get_person_name(pid),
                "grant_label": grant_label,
            })
    return result


def can_user_approve_yg_membership(person_id: str, youth_group_id: str, age_group: str) -> bool:
    """Return True if person_id has yg_registration_approval covering this YG+age_group."""
    return any(
        str(g["person_id"]) == str(person_id)
        for g in get_yg_registration_approval_grantees(youth_group_id, age_group)
    )


def get_user_yg_registration_approval_scope(person_id: str) -> list[dict]:
    """Return list of scope dicts for yg_registration_approval grants where person_id is a grantee."""
    with _LOCK:
        grants = _load_grants()
    tree_cache: dict = {}
    scopes = []
    for g in grants:
        if g.get("privilege_type") != "yg_registration_approval":
            continue
        if person_id not in _resolve_grantee_to_person_ids(g.get("grantee") or {}, tree_cache):
            continue
        scope = g.get("scope") or {}
        stype = scope.get("type", "")
        yg_ids = list(set(scope.get("youth_group_ids") or (
            [scope["youth_group_id"]] if scope.get("youth_group_id") else []
        )))
        age_groups = list(set(scope.get("age_groups") or (
            [scope["age_group"]] if scope.get("age_group") else []
        )))
        if yg_ids:
            scopes.append({"type": stype, "youth_group_ids": yg_ids, "age_groups": age_groups})
    return scopes


def get_user_promotion_access(person_id: str) -> dict | None:
    """Return {'youth_group_ids': [...], 'age_groups': [...]} if person has promotion_access, else None."""
    with _LOCK:
        grants = _load_grants()
    tree_cache: dict = {}
    allowed_ygs: set[str] = set()
    allowed_ags: set[str] = set()
    found = False
    for g in grants:
        if g.get("privilege_type") != "promotion_access":
            continue
        if person_id not in _resolve_grantee_to_person_ids(g.get("grantee") or {}, tree_cache):
            continue
        found = True
        scope = g.get("scope") or {}
        stype = scope.get("type", "")
        yg_ids = set(scope.get("youth_group_ids") or (
            [scope["youth_group_id"]] if scope.get("youth_group_id") else []
        ))
        ags = set(scope.get("age_groups") or (
            [scope["age_group"]] if scope.get("age_group") else []
        ))
        allowed_ygs |= yg_ids
        if stype == "age_group":
            allowed_ags |= ags
    if not found or not allowed_ygs:
        return None
    return {"youth_group_ids": sorted(allowed_ygs), "age_groups": sorted(allowed_ags)}


# ── Routes ────────────────────────────────────────────────────────────────────

def register_privileges_routes(app):

    @app.get("/api/privileges/types")
    def get_privilege_types():
        err = _require_admin()
        if err:
            return err
        return jsonify({"types": PRIVILEGE_TYPES})

    @app.get("/api/privileges/age-groups")
    def get_age_groups():
        err = _require_admin()
        if err:
            return err
        return jsonify({"age_groups": ALL_AGE_GROUPS})

    @app.get("/api/privileges/youth-groups")
    def get_priv_youth_groups():
        err = _require_admin()
        if err:
            return err
        return jsonify({"youth_groups": _get_youth_groups_list()})

    @app.get("/api/privileges/org-positions/<path:group_id>")
    def get_org_positions(group_id):
        err = _require_admin()
        if err:
            return err
        return jsonify(_build_positions_response(group_id))

    @app.get("/api/privileges/persons/search")
    def search_privilege_persons():
        err = _require_admin()
        if err:
            return err
        q = str(request.args.get("q") or "").strip()
        return jsonify({"persons": _search_persons(q)})

    @app.get("/api/privileges/grants")
    def list_privilege_grants():
        err = _require_admin()
        if err:
            return err
        type_filter = request.args.get("type")
        with _LOCK:
            grants = _load_grants()
        if type_filter:
            grants = [g for g in grants if g.get("privilege_type") == type_filter]
        _refresh_specific_person_grantee_names(grants)
        return jsonify({"grants": grants})

    @app.post("/api/privileges/grants")
    def create_privilege_grants():
        err = _require_admin()
        if err:
            return err
        user = _current_user()
        body = request.json or {}
        raw_grants = body.get("grants") or []
        if not isinstance(raw_grants, list) or not raw_grants:
            return jsonify({"error": "grants array required"}), 400

        now = datetime.now(timezone.utc).isoformat()
        granted_by = (user or {}).get("username") or "admin"
        created = []

        with _LOCK:
            existing = _load_grants()
            for g in raw_grants:
                if not g.get("privilege_type") or not g.get("scope") or not g.get("grantee"):
                    continue
                grantee = dict(g["grantee"])
                _refresh_specific_person_grantee_name(grantee)
                record = {
                    "id":             str(uuid.uuid4()),
                    "privilege_type": g["privilege_type"],
                    "scope":          g["scope"],
                    "grantee":        grantee,
                    "notes":          str(g.get("notes") or "").strip(),
                    "granted_at":     now,
                    "granted_by":     granted_by,
                }
                existing.append(record)
                created.append(record)
            _save_grants(existing)

        return jsonify({"ok": True, "created": created})

    @app.delete("/api/privileges/grants/<grant_id>")
    def delete_privilege_grant(grant_id):
        err = _require_admin()
        if err:
            return err
        with _LOCK:
            grants = _load_grants()
            remaining = [g for g in grants if g.get("id") != grant_id]
            if len(remaining) == len(grants):
                return jsonify({"error": "not found"}), 404
            _save_grants(remaining)
        return jsonify({"ok": True})

    @app.get("/api/privileges/resolve")
    def resolve_person_access():
        """What privileges does this person currently hold?"""
        err = _require_admin()
        if err:
            return err
        person_id = _none_str(request.args.get("person_id"))
        if not person_id:
            return jsonify({"error": "person_id required"}), 400

        with _LOCK:
            grants = _load_grants()
        _refresh_specific_person_grantee_names(grants)

        tree_cache = {}
        matched = [g for g in grants if person_id in _resolve_grantee_to_person_ids(g.get("grantee") or {}, tree_cache)]

        return jsonify({"grants": matched, "person_name": _get_person_name(person_id)})

    @app.get("/api/privileges/who-can-access")
    def who_can_access_person():
        """Who has profile_access covering this person?"""
        err = _require_admin()
        if err:
            return err
        person_id = _none_str(request.args.get("person_id"))
        if not person_id:
            return jsonify({"error": "person_id required"}), 400

        with _LOCK:
            grants = _load_grants()
        _refresh_specific_person_grantee_names(grants)

        yg_cache = {}
        tree_cache = {}
        profile_grants = [g for g in grants if g.get("privilege_type") == "profile_access"]
        covering = []
        accessors_map = {}
        for g in profile_grants:
            pids = _profile_accessors_for_grant(person_id, g, tree_cache, yg_cache)
            if not pids:
                continue
            covering.append(g)
            for pid in pids:
                if pid not in accessors_map:
                    accessors_map[pid] = {"person_id": pid, "person_name": _get_person_name(pid), "via_grants": []}
                accessors_map[pid]["via_grants"].append(g.get("id"))

        return jsonify({
            "person_name":     _get_person_name(person_id),
            "covering_grants": covering,
            "accessors":       list(accessors_map.values()),
        })

    @app.get("/api/privileges/accessible-members")
    def accessible_members():
        """Return registered and unregistered members the current user has profile_access to."""
        user = _current_user()
        if not user:
            return jsonify({"error": "unauthorized"}), 401

        try:
            person_id = _none_str(user.get("person_id"))
            if not person_id:
                return jsonify({"registered": [], "unregistered": []})

            with _LOCK:
                grants = _load_grants()

            tree_cache = {}
            my_grants = [
                g for g in grants
                if person_id in _resolve_grantee_to_person_ids(g.get("grantee") or {}, tree_cache)
            ]

            reg_ids: set[str] = set()
            unreg_ids: set[str] = set()
            for g in my_grants:
                grant_reg_ids, grant_unreg_ids = _profile_access_ids_for_grant(person_id, g, tree_cache)
                reg_ids |= grant_reg_ids
                unreg_ids |= grant_unreg_ids
            # Do NOT discard own ID — the user should see themselves in the members list.

            # Registered members
            cached_payload, cached_version, data_version = S.members_index_cache_state()
            if cached_payload is not None and cached_version == data_version:
                reg_full_list = cached_payload
            else:
                reg_full_list = S.build_members_index()
                S.set_members_index_cache(reg_full_list, data_version)

            registered = [p for p in (reg_full_list or []) if str(p.get("person_id", "")) in reg_ids]

            # Unregistered members — build directly from unreg_store (no cache dependency)
            unregistered = _build_unreg_list_for_ids(unreg_ids) if unreg_ids else []

            return jsonify(S.json_safe({"registered": registered, "unregistered": unregistered}))
        except Exception:
            return jsonify({"registered": [], "unregistered": []})

    @app.get("/api/privileges/my-access")
    def my_access():
        """Return what the current logged-in user has access to via privilege grants."""
        user = _current_user()
        if not user:
            return jsonify({"error": "unauthorized"}), 401

        person_id = _none_str(user.get("person_id"))
        empty = {"profile_access": [], "profile_access_unreg": [], "promotion_access": None}
        if not person_id:
            return jsonify(empty)

        with _LOCK:
            grants = _load_grants()

        tree_cache = {}
        my_grants = [
            g for g in grants
            if person_id in _resolve_grantee_to_person_ids(g.get("grantee") or {}, tree_cache)
        ]

        profile_ids: set[str] = set()
        profile_unreg_ids: set[str] = set()
        for g in my_grants:
            grant_profile_ids, grant_profile_unreg_ids = _profile_access_ids_for_grant(person_id, g, tree_cache)
            profile_ids |= grant_profile_ids
            profile_unreg_ids |= grant_profile_unreg_ids

        # A person never needs a grant to access their own profile
        profile_ids.discard(person_id)
        profile_unreg_ids.discard(person_id)

        # Collect promotion_access scope (union of all matching grants)
        allowed_ygs: set[str] = set()
        allowed_ags: set[str] = set()
        for g in my_grants:
            if g.get("privilege_type") != "promotion_access":
                continue
            scope = g.get("scope") or {}
            stype = scope.get("type", "")
            yg_ids = set(scope.get("youth_group_ids") or (
                [scope["youth_group_id"]] if scope.get("youth_group_id") else []
            ))
            ags = set(scope.get("age_groups") or (
                [scope["age_group"]] if scope.get("age_group") else []
            ))
            allowed_ygs |= yg_ids
            if stype == "age_group":
                allowed_ags |= ags

        promo_access = {
            "youth_group_ids": sorted(allowed_ygs),
            "age_groups": sorted(allowed_ags),  # empty = all age groups for that YG
        } if allowed_ygs else None

        yg_approval_scopes = get_user_yg_registration_approval_scope(person_id) if person_id else []

        yg_file_group_ids: set[str] = set()
        for g in my_grants:
            if g.get("privilege_type") != "yg_file_access":
                continue
            scope = g.get("scope") or {}
            for gid in (scope.get("youth_group_ids") or (
                [scope["youth_group_id"]] if scope.get("youth_group_id") else []
            )):
                if _none_str(gid):
                    yg_file_group_ids.add(str(gid))

        return jsonify({
            "profile_access": sorted(profile_ids),
            "profile_access_unreg": sorted(profile_unreg_ids),
            "promotion_access": promo_access,
            "yg_approval_scopes": yg_approval_scopes,
            "yg_file_access_group_ids": sorted(yg_file_group_ids),
        })
