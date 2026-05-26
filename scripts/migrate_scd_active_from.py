#!/usr/bin/env python3
"""
Migration: populate scd_active_from and set scd_changed_by_user='admin'
across all SCD sheets in data/JECJordanData/ (CSV directory).

Rules:
- scd_persons, scd_timestamps: keep scd_active_from as-is; only set scd_changed_by_user='admin'
- Demographic sheets (direct person_id): scd_active_from = scd_persons.scd_active_from for that person
- Satellite sheets (no direct person_id): resolve person_id via parent record_id, then same lookup
- scd_person_youth_group, scd_responsibilities: min(scd_timestamps.timestamp) for (person_id, youth_group_id),
  fallback to scd_persons.scd_active_from
- scd_person_youth_group_age_hist: match parent scd_person_youth_group row by person_youth_group_record_id
"""

import os
import sys
import pandas as pd

CSV_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "JECJordanData"))

# Logical name → CSV file stem (workbook sheet name)
SCD_CSV_SHEETS = {
    "persons":                      "scd_persons",
    "timestamps":                   "scd_timestamps",
    "nationality":                  "scd_nationality",
    "mobile_numbers":               "scd_mobile_numbers",
    "emails":                       "scd_emails",
    "schools":                      "scd_schools",
    "jobs":                         "scd_jobs",
    "addresses":                    "scd_addresses",
    "higher_education":             "scd_higher_education",
    "social_media":                 "scd_social_media",
    "hobbies_skills":               "scd_hobbies_skills",
    "person_health_conditions":     "scd_person_health_conditions",
    "person_special_notes":         "scd_person_special_notes",
    "person_titles":                "scd_person_titles",
    "person_school_system_sectors": "scd_person_school_system_sector",
    "auth_users":                   "scd_auth_users",
    "mobile_number_family_relations":  "scd_mobile_number_family_rel",
    "personal_mobile_number_primary":  "scd_personal_mobile_number_prim",
    "mobile_number_linked_jobs":       "scd_mobile_number_linked_jobs",
    "email_family_relations":          "scd_email_family_relations",
    "personal_email_primary":          "scd_personal_email_primary",
    "email_linked_jobs":               "scd_email_linked_jobs",
    "school_sections":                 "scd_school_sections",
    "school_grades":                   "scd_school_grades",
    "person_youth_group":              "scd_person_youth_group",
    "person_youth_group_age_history":  "scd_person_youth_group_age_hist",
    "responsibilities":                "scd_responsibilities",
}


def csv_path(stem: str) -> str:
    return os.path.join(CSV_DIR, f"{stem}.csv")


def read_csv(stem: str) -> pd.DataFrame:
    path = csv_path(stem)
    if not os.path.exists(path):
        return pd.DataFrame()
    return pd.read_csv(path, dtype=str, encoding="utf-8-sig", keep_default_na=True)


def write_csv(stem: str, df: pd.DataFrame):
    df.to_csv(csv_path(stem), index=False, encoding="utf-8-sig")


def safe_str(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, float) and val == int(val):
        return str(int(val))
    return str(val)


def run():
    print(f"Loading CSVs from: {CSV_DIR}")
    if not os.path.isdir(CSV_DIR):
        print(f"ERROR: CSV directory not found: {CSV_DIR}")
        return 1

    available = {os.path.splitext(f)[0] for f in os.listdir(CSV_DIR) if f.endswith(".csv")}

    persons_df = read_csv("scd_persons")
    timestamps_df = read_csv("scd_timestamps")

    person_active_from = {}
    for _, row in persons_df.iterrows():
        pid = safe_str(row.get("person_id"))
        af = row.get("scd_active_from")
        if pid and af is not None and not (isinstance(af, float) and pd.isna(af)):
            person_active_from[pid] = af
    print(f"  scd_persons: {len(person_active_from)} person->active_from entries")

    yg_join_date = {}
    for _, row in timestamps_df.iterrows():
        pid = safe_str(row.get("person_id"))
        ygid = safe_str(row.get("youth_group_id"))
        ts = row.get("timestamp")
        if pid and ygid and ts is not None and not (isinstance(ts, float) and pd.isna(ts)):
            key = (pid, ygid)
            if key not in yg_join_date or ts < yg_join_date[key]:
                yg_join_date[key] = ts
    print(f"  scd_timestamps: {len(yg_join_date)} (person,yg)->min(timestamp) entries")

    dfs = {}
    for logical, stem in SCD_CSV_SHEETS.items():
        if stem in available:
            dfs[logical] = read_csv(stem)
        else:
            print(f"  WARNING: {stem}.csv not found, skipping")
            dfs[logical] = pd.DataFrame()

    def build_rid_lookup(df, rid_col, person_col="person_id"):
        result = {}
        if df.empty or rid_col not in df.columns or person_col not in df.columns:
            return result
        for _, row in df.iterrows():
            rid = safe_str(row.get(rid_col))
            pid = safe_str(row.get(person_col))
            if rid and pid:
                result[rid] = pid
        return result

    mobile_rid_to_person = build_rid_lookup(dfs["mobile_numbers"], "mobile_number_record_id")
    email_rid_to_person  = build_rid_lookup(dfs["emails"], "email_record_id")
    school_rid_to_person = build_rid_lookup(dfs["schools"], "school_record_id")
    print(f"  Mobile record_id map: {len(mobile_rid_to_person)} entries")
    print(f"  Email record_id map:  {len(email_rid_to_person)} entries")
    print(f"  School record_id map: {len(school_rid_to_person)} entries")

    def get_person_af(pid):
        pid = safe_str(pid)
        return person_active_from.get(pid) if pid else None

    def get_yg_af(pid, ygid):
        pid_s = safe_str(pid)
        ygid_s = safe_str(ygid)
        if pid_s and ygid_s:
            ts = yg_join_date.get((pid_s, ygid_s))
            if ts is not None:
                return ts
        return get_person_af(pid_s)

    def ensure_scd_cols(df):
        if "scd_active_from" not in df.columns:
            df["scd_active_from"] = None
        if "scd_changed_by_user" not in df.columns:
            df["scd_changed_by_user"] = None
        return df

    def apply_direct_pid(df, keep_active_from=False):
        if df.empty:
            return df
        df = df.copy()
        ensure_scd_cols(df)
        if not keep_active_from and "person_id" in df.columns:
            df["scd_active_from"] = df["person_id"].apply(get_person_af)
        df["scd_changed_by_user"] = "admin"
        return df

    def apply_satellite(df, rid_col, rid_to_person):
        if df.empty or rid_col not in df.columns:
            return df
        df = df.copy()
        ensure_scd_cols(df)
        def lookup(rid):
            pid = rid_to_person.get(safe_str(rid))
            return get_person_af(pid) if pid else None
        df["scd_active_from"] = df[rid_col].apply(lookup)
        df["scd_changed_by_user"] = "admin"
        return df

    dfs["persons"]    = apply_direct_pid(dfs["persons"],    keep_active_from=True)
    dfs["timestamps"] = apply_direct_pid(dfs["timestamps"], keep_active_from=True)

    for logical in [
        "nationality", "mobile_numbers", "emails", "schools", "jobs",
        "addresses", "higher_education", "social_media", "hobbies_skills",
        "person_health_conditions", "person_special_notes",
        "person_titles", "person_school_system_sectors", "auth_users",
    ]:
        dfs[logical] = apply_direct_pid(dfs[logical])

    dfs["mobile_number_family_relations"] = apply_satellite(
        dfs["mobile_number_family_relations"], "mobile_number_record_id", mobile_rid_to_person)
    dfs["personal_mobile_number_primary"] = apply_satellite(
        dfs["personal_mobile_number_primary"], "mobile_number_record_id", mobile_rid_to_person)
    dfs["mobile_number_linked_jobs"] = apply_satellite(
        dfs["mobile_number_linked_jobs"], "mobile_number_record_id", mobile_rid_to_person)
    dfs["email_family_relations"] = apply_satellite(
        dfs["email_family_relations"], "email_record_id", email_rid_to_person)
    dfs["personal_email_primary"] = apply_satellite(
        dfs["personal_email_primary"], "email_record_id", email_rid_to_person)
    dfs["email_linked_jobs"] = apply_satellite(
        dfs["email_linked_jobs"], "email_record_id", email_rid_to_person)
    dfs["school_sections"] = apply_satellite(
        dfs["school_sections"], "school_record_id", school_rid_to_person)
    dfs["school_grades"] = apply_satellite(
        dfs["school_grades"], "school_record_id", school_rid_to_person)

    pyg_df = dfs["person_youth_group"].copy() if not dfs["person_youth_group"].empty else pd.DataFrame()
    if not pyg_df.empty:
        ensure_scd_cols(pyg_df)
        pyg_df["scd_active_from"] = pyg_df.apply(
            lambda r: get_yg_af(r.get("person_id"), r.get("youth_group_id")), axis=1)
        pyg_df["scd_changed_by_user"] = "admin"
    dfs["person_youth_group"] = pyg_df

    pyg_rid_to_af = {}
    if not pyg_df.empty and "person_youth_group_record_id" in pyg_df.columns:
        for _, row in pyg_df.iterrows():
            rid = safe_str(row.get("person_youth_group_record_id"))
            af = row.get("scd_active_from")
            if rid and af is not None:
                pyg_rid_to_af[rid] = af
    print(f"  person_youth_group record_id map: {len(pyg_rid_to_af)} entries")

    pyg_hist_df = dfs["person_youth_group_age_history"].copy() if not dfs["person_youth_group_age_history"].empty else pd.DataFrame()
    if not pyg_hist_df.empty:
        ensure_scd_cols(pyg_hist_df)
        pyg_hist_df["scd_active_from"] = pyg_hist_df["person_youth_group_record_id"].apply(
            lambda rid: pyg_rid_to_af.get(safe_str(rid)))
        pyg_hist_df["scd_changed_by_user"] = "admin"
    dfs["person_youth_group_age_history"] = pyg_hist_df

    resp_df = dfs["responsibilities"].copy() if not dfs["responsibilities"].empty else pd.DataFrame()
    if not resp_df.empty:
        ensure_scd_cols(resp_df)
        resp_df["scd_active_from"] = resp_df.apply(
            lambda r: get_yg_af(r.get("person_id"), r.get("youth_group_id")), axis=1)
        resp_df["scd_changed_by_user"] = "admin"
    dfs["responsibilities"] = resp_df

    print("\nMigration summary:")
    for logical, stem in SCD_CSV_SHEETS.items():
        df = dfs.get(logical, pd.DataFrame())
        if df.empty:
            continue
        total = len(df)
        has_af = df["scd_active_from"].notna().sum() if "scd_active_from" in df.columns else 0
        print(f"  {stem}: {total} rows, {has_af} with scd_active_from set")

    print(f"\nWriting CSVs to {CSV_DIR} ...")
    for logical, stem in SCD_CSV_SHEETS.items():
        if stem not in available:
            continue
        df = dfs.get(logical, pd.DataFrame())
        write_csv(stem, df)
    print("Done.")


if __name__ == "__main__":
    sys.exit(run() or 0)
