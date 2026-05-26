"""
Reassign period IDs and node IDs in all 4 org-tree CSVs.

  period_id  : old 8-char hex (e.g. cae89751)  →  OTPD######  (6 digits, sequential)
  node_id    : old n<ts>_<n>  (e.g. n1771750862093_5) →  OTND########  (8 digits, globally sequential)

Affected CSVs
  org_tree_periods.csv     – period_id
  org_tree_nodes.csv       – period_id, node_id
  org_tree_edges.csv       – period_id, from_node_id, to_node_id
  org_tree_node_hulls.csv  – period_id, node_id
"""

import csv
import io
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_DIR   = os.path.join(REPO_ROOT, "data", "JECJordanData")

PERIODS_CSV = os.path.join(CSV_DIR, "org_tree_periods.csv")
NODES_CSV   = os.path.join(CSV_DIR, "org_tree_nodes.csv")
EDGES_CSV   = os.path.join(CSV_DIR, "org_tree_edges.csv")
HULLS_CSV   = os.path.join(CSV_DIR, "org_tree_node_hulls.csv")


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path, fieldnames, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# ── Build period ID mapping  (old → new OTPD######) ───────────────────────────

def build_period_map():
    _, rows = read_csv(PERIODS_CSV)
    mapping = {}
    counter = 1
    for row in rows:
        old = row.get("period_id", "").strip()
        if old and old not in mapping:
            mapping[old] = f"OTPD{counter:06d}"
            counter += 1
    return mapping


# ── Build node ID mapping  (old → new OTND########) ───────────────────────────
# Each row in org_tree_nodes.csv gets its own globally-unique new ID.
# The key is (period_id_old, node_id_old) so the same node string in two
# different periods maps to two different OTND IDs.

def build_node_map(period_map):
    _, rows = read_csv(NODES_CSV)
    mapping = {}   # (old_period_id, old_node_id) → new_node_id
    counter = 1
    for row in rows:
        old_pid = row.get("period_id", "").strip()
        old_nid = row.get("node_id", "").strip()
        if old_pid and old_nid:
            key = (old_pid, old_nid)
            if key not in mapping:
                mapping[key] = f"OTND{counter:08d}"
                counter += 1
    return mapping


# ── Patch each CSV ─────────────────────────────────────────────────────────────

def migrate_periods(period_map):
    fieldnames, rows = read_csv(PERIODS_CSV)
    for row in rows:
        old = row.get("period_id", "").strip()
        if old in period_map:
            row["period_id"] = period_map[old]
    write_csv(PERIODS_CSV, fieldnames, rows)
    print(f"  periods : {len(rows)} rows updated")


def migrate_nodes(period_map, node_map):
    fieldnames, rows = read_csv(NODES_CSV)
    for row in rows:
        old_pid = row.get("period_id", "").strip()
        old_nid = row.get("node_id", "").strip()
        key = (old_pid, old_nid)
        if old_pid in period_map:
            row["period_id"] = period_map[old_pid]
        if key in node_map:
            row["node_id"] = node_map[key]
    write_csv(NODES_CSV, fieldnames, rows)
    print(f"  nodes   : {len(rows)} rows updated")


def migrate_edges(period_map, node_map):
    fieldnames, rows = read_csv(EDGES_CSV)
    for row in rows:
        old_pid  = row.get("period_id", "").strip()
        old_from = row.get("from_node_id", "").strip()
        old_to   = row.get("to_node_id", "").strip()
        if old_pid in period_map:
            row["period_id"] = period_map[old_pid]
        from_key = (old_pid, old_from)
        to_key   = (old_pid, old_to)
        if from_key in node_map:
            row["from_node_id"] = node_map[from_key]
        if to_key in node_map:
            row["to_node_id"] = node_map[to_key]
    write_csv(EDGES_CSV, fieldnames, rows)
    print(f"  edges   : {len(rows)} rows updated")


def migrate_hulls(period_map, node_map):
    fieldnames, rows = read_csv(HULLS_CSV)
    for row in rows:
        old_pid = row.get("period_id", "").strip()
        old_nid = row.get("node_id", "").strip()
        key = (old_pid, old_nid)
        if old_pid in period_map:
            row["period_id"] = period_map[old_pid]
        if key in node_map:
            row["node_id"] = node_map[key]
    write_csv(HULLS_CSV, fieldnames, rows)
    print(f"  hulls   : {len(rows)} rows updated")


if __name__ == "__main__":
    print("Building ID maps...")
    period_map = build_period_map()
    node_map   = build_node_map(period_map)

    print(f"  {len(period_map)} period IDs  -> OTPD000001 ... OTPD{len(period_map):06d}")
    print(f"  {len(node_map)} node IDs    -> OTND00000001 ... OTND{len(node_map):08d}")

    print("Migrating CSVs...")
    migrate_periods(period_map)
    migrate_nodes(period_map, node_map)
    migrate_edges(period_map, node_map)
    migrate_hulls(period_map, node_map)

    print("Done.")
    print()
    print("Period ID mapping:")
    for old, new in period_map.items():
        print(f"  {old}  ->  {new}")
