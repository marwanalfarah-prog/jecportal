import os

import numpy as np
import pandas as pd
from flask import jsonify, request, send_from_directory

from core import state as S
from core.routes_auth import _require_admin
from core.routes_profile_common import (
    build_location_only_address_rows,
    build_profile_record,
    profile_edit_scope,
    require_profile_view_access,
    replace_profile_sub_rows,
    validate_responsibility_membership_groups,
)


def _unreg_build_record(uid):
    return build_profile_record(
        S.unregistered_persons_view_df(),
        S.unreg_store,
        uid,
        compare_as_string=True,
        photo_path_getter=S.get_unreg_photo_path,
        photo_url_template="/api/unregistered/{pid}/photo",
    )


def _unreg_replace_sub(sheet, uid, rows):
    replace_profile_sub_rows(S.unreg_store, uid, sheet, rows, compare_as_string=True)


def register_unregistered_routes(app):
    @app.get("/api/unregistered")
    def get_unregistered():
        with S.unreg_lock:
            persons_df = S._project_primary_addresses(
                S.unregistered_persons_view_df(),
                S.unreg_store.get("addresses", pd.DataFrame()),
            ).replace({np.nan: None})
            pyg = S.unreg_store.get("person_youth_group", pd.DataFrame())
            pyg_history = S.unreg_store.get(S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET, pd.DataFrame())
            resp = S.unreg_store.get("responsibilities", pd.DataFrame())
            nat = S.unreg_store.get("nationality", pd.DataFrame())
            sch = S.unreg_store.get("schools", pd.DataFrame())
            he = S.unreg_store.get("higher_education", pd.DataFrame())
            jobs = S.unreg_store.get("jobs", pd.DataFrame())
            hob = S.unreg_store.get("hobbies_skills", pd.DataFrame())

            def pid_to_list_u(df, col):
                result = {}
                if df.empty or "person_id" not in df.columns or col not in df.columns:
                    return result
                for pid, grp in df.dropna(subset=[col]).groupby("person_id"):
                    result[str(pid)] = grp[col].dropna().astype(str).unique().tolist()
                return result

            nat_map = pid_to_list_u(nat, "nationality")
            sch_map = pid_to_list_u(sch, S.SCHOOL_NAME_COL)
            youth_rows_map = S.build_person_youth_group_payload_rows(pyg, pyg_history)
            ryg_id_map = pid_to_list_u(resp, S.YOUTH_GROUP_ID_COL)
            ryear_map = pid_to_list_u(resp, "jec_year")
            rcurrent_map = pid_to_list_u(resp, "is_current")
            rrole_map = pid_to_list_u(resp, "responsibility_name")
            uni_map = pid_to_list_u(he, S.HIGHER_EDUCATION_INSTITUTION_COL)
            maj_map = pid_to_list_u(he, "major")
            deg_map = pid_to_list_u(he, "degree")
            job_map = pid_to_list_u(jobs, "job_title")
            comp_map = pid_to_list_u(jobs, S.EMPLOYER_NAME_COL)
            hob_map = pid_to_list_u(hob, "hobby_skill")

            enriched = []
            for row in persons_df.to_dict(orient="records"):
                uid = str(row.get("person_id", ""))
                row["_avatar_initial"] = S.avatar_initial_from_person(row)
                row["_nationalities"] = nat_map.get(uid, [])
                row["_schools"] = sch_map.get(uid, [])
                youth_rows = S.get_person_youth_group_payload_rows(youth_rows_map, uid)
                active_youth_rows = [entry for entry in youth_rows if not bool(entry.get("archived"))]
                archived_youth_rows = [entry for entry in youth_rows if bool(entry.get("archived"))]
                row["_youth_memberships"] = youth_rows

                yg_ids = [entry["youth_group_id"] for entry in active_youth_rows]
                archived_yg_ids = [entry["youth_group_id"] for entry in archived_youth_rows]
                row["_youth_group_ids"] = yg_ids
                row["_youth_groups"] = [S.youth_group_name(gid) or gid for gid in yg_ids]
                row["_age_groups"] = [entry["age_group"] for entry in active_youth_rows]
                row["_youth_join_years"] = [entry["youth_join_year"] for entry in active_youth_rows]
                row["_archived_youth_group_ids"] = archived_yg_ids
                row["_archived_youth_groups"] = [S.youth_group_name(gid) or gid for gid in archived_yg_ids]
                row["_archived_age_groups"] = [entry["age_group"] for entry in archived_youth_rows]
                ryg_ids = ryg_id_map.get(uid, [])
                row["_responsibility_youth_group_ids"] = ryg_ids
                row["_responsibility_youth_groups"] = [S.youth_group_name(gid) or gid for gid in ryg_ids]
                row["_responsibility_jec_years"] = ryear_map.get(uid, [])
                row["_responsibility_current_states"] = [
                    "حاليًّا" if S._to_bool(value) else "سابقًا"
                    for value in rcurrent_map.get(uid, [])
                ]
                row["_responsibilities"] = rrole_map.get(uid, [])
                row["_universities"] = uni_map.get(uid, [])
                row["_majors"] = maj_map.get(uid, [])
                row["_degrees"] = deg_map.get(uid, [])
                row["_job_titles"] = job_map.get(uid, [])
                row["_companies"] = comp_map.get(uid, [])
                row["_hobbies"] = hob_map.get(uid, [])
                _, ext = S.get_unreg_photo_path(uid)
                row["_photo"] = f"/api/unregistered/{uid}/photo" if ext else None
                row["archived"] = bool(youth_rows) and len(active_youth_rows) == 0
                enriched.append(row)
        return jsonify(enriched)

    @app.get("/api/unregistered/<uid>")
    def get_unregistered_profile(uid):
        err = require_profile_view_access("unregistered", uid)
        if err:
            return err
        with S.unreg_lock:
            record = _unreg_build_record(uid)
        if not record:
            return jsonify({"error": "not found"}), 404
        return jsonify(record)

    @app.post("/api/unregistered")
    def add_unregistered():
        body = request.json or {}
        provided_uid = S._normalize_person_id(body.get("person_id"))
        new_uid = provided_uid if provided_uid not in (None, "") else S._next_person_id()
        with S.unreg_lock:
            existing = S.unreg_store.get("persons", pd.DataFrame())
            if not existing.empty and "person_id" in existing.columns:
                if str(new_uid) in existing["person_id"].astype(str).values:
                    record = _unreg_build_record(new_uid)
                    return jsonify({"ok": True, "person_id": new_uid, "record": record})
            raw_person = body.get("person") or {}
            p = S.normalize_person_birth_fields(raw_person)
            person_title = p.pop("title", None)
            school_system_sector = p.pop("school_system_sector", None)
            addresses_rows = body.get("addresses") if "addresses" in body else S.address_rows_from_legacy_person_payload(raw_person)
            for legacy_col in ("governorate", "city", "country", "address"):
                p.pop(legacy_col, None)
            if not p.get("ar_first_name"):
                raw_name = body.get("name", "")
                parts = raw_name.strip().split() if raw_name else []
                if len(parts) == 1:
                    p = {**p, "ar_first_name": parts[0], "ar_last_name": ""}
                elif len(parts) == 2:
                    p = {**p, "ar_first_name": parts[0], "ar_last_name": parts[1]}
                elif len(parts) == 3:
                    p = {**p, "ar_first_name": parts[0], "ar_second_name": parts[1], "ar_last_name": parts[2]}
                elif len(parts) >= 4:
                    p = {**p, "ar_first_name": parts[0], "ar_second_name": parts[1], "ar_third_name": parts[2], "ar_last_name": " ".join(parts[3:])}
            p["person_id"] = new_uid
            p["registered"] = False
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            new_row = pd.DataFrame([p])
            for col in S.UNREG_PERSONS_COLS:
                if col not in new_row.columns:
                    new_row[col] = None
            S.unreg_store["persons"] = pd.concat([persons_df, new_row], ignore_index=True)
            S.replace_person_title(S.unreg_store, new_uid, person_title)
            S.replace_person_school_system_sector(S.unreg_store, new_uid, school_system_sector)
            prepared_job_rows, job_id_map = S.prepare_job_rows_for_person(S.unreg_store, new_uid, body.get("jobs", []))
            mobile_rows_payload = S.remap_job_links_in_mobile_rows(body.get("mobile_numbers", []), job_id_map)
            email_rows_payload = S.prepare_email_rows_for_person(S.unreg_store, new_uid, S.remap_job_links_in_email_rows(body.get("emails", []), job_id_map))
            invalid_responsibility_groups = validate_responsibility_membership_groups(
                S.unreg_store,
                new_uid,
                body.get("responsibilities", []),
                compare_as_string=True,
                membership_rows=body.get("person_youth_group", []),
            )
            if invalid_responsibility_groups:
                return jsonify({
                    "error": "responsibility youth_group_id must match one of the person's youth-group memberships",
                    "invalid_youth_group_ids": invalid_responsibility_groups,
                }), 400
            if addresses_rows:
                _unreg_replace_sub("addresses", new_uid, addresses_rows)
            payload_by_sheet = {
                "nationality": body.get("nationality", []),
                "jobs": prepared_job_rows,
                "mobile_numbers": mobile_rows_payload,
                "emails": email_rows_payload,
                "social_media": body.get("social_media", []),
                "schools": body.get("schools", []),
                "higher_education": body.get("higher_education", []),
                "timestamps": body.get("timestamps", []),
                "responsibilities": body.get("responsibilities", []),
                "person_youth_group": body.get("person_youth_group", []),
                "hobbies_skills": body.get("hobbies_skills", []),
                S.PERSON_HEALTH_CONDITION_SHEET: body.get(S.PERSON_HEALTH_CONDITION_SHEET, []),
                S.PERSON_SPECIAL_NOTE_SHEET: body.get(S.PERSON_SPECIAL_NOTE_SHEET, []),
            }
            for sheet in ("nationality", "jobs", "mobile_numbers", "emails", "social_media", "schools", "higher_education", "timestamps", "responsibilities", "person_youth_group", "hobbies_skills", S.PERSON_HEALTH_CONDITION_SHEET, S.PERSON_SPECIAL_NOTE_SHEET):
                rows = payload_by_sheet.get(sheet, [])
                if rows:
                    _unreg_replace_sub(sheet, new_uid, rows)
            S._save_unreg_store()
            record = _unreg_build_record(new_uid)
        return jsonify({"ok": True, "person_id": new_uid, "record": record})

    @app.put("/api/unregistered/<uid>")
    def update_unregistered(uid):
        scope = profile_edit_scope("unregistered", uid)
        if not scope:
            return jsonify({"error": "unauthorized"}), 403

        body = request.json or {}
        if scope == "location_only":
            if set(body.keys()) - {"addresses"}:
                return jsonify({"error": "forbidden"}), 403
            try:
                addresses_rows = build_location_only_address_rows(S.unreg_store, uid, body.get("addresses"), compare_as_string=True)
            except ValueError:
                return jsonify({"error": "invalid google maps location"}), 400

            with S.unreg_lock:
                _unreg_replace_sub("addresses", uid, addresses_rows)
                S._save_unreg_store()
                record = _unreg_build_record(uid)
            return jsonify({"ok": True, "record": record})

        with S.unreg_lock:
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            if persons_df.empty or "person_id" not in persons_df.columns:
                return jsonify({"error": "not found"}), 404
            idx = persons_df[persons_df["person_id"].astype(str) == str(uid)].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404
            raw_person = body.get("person", {})
            p = S.normalize_person_birth_fields(raw_person)
            title_in_payload = "title" in raw_person
            person_title = p.pop("title", None)
            school_system_sector_in_payload = "school_system_sector" in raw_person
            school_system_sector = p.pop("school_system_sector", None)
            addresses_rows = body.get("addresses") if "addresses" in body else None
            if addresses_rows is None:
                legacy_addresses = S.address_rows_from_legacy_person_payload(raw_person)
                if legacy_addresses:
                    addresses_rows = legacy_addresses
            for legacy_col in ("governorate", "city", "country", "address"):
                p.pop(legacy_col, None)
            for k, v in p.items():
                S.unreg_store["persons"].at[idx[0], k] = v
            if title_in_payload:
                S.replace_person_title(S.unreg_store, uid, person_title)
            if school_system_sector_in_payload:
                S.replace_person_school_system_sector(S.unreg_store, uid, school_system_sector)
            prepared_job_rows, job_id_map = S.prepare_job_rows_for_person(S.unreg_store, uid, body.get("jobs", [])) if "jobs" in body else (None, {})
            mobile_rows_payload = S.remap_job_links_in_mobile_rows(body.get("mobile_numbers", []), job_id_map) if "mobile_numbers" in body else None
            email_rows_payload = S.prepare_email_rows_for_person(S.unreg_store, uid, S.remap_job_links_in_email_rows(body.get("emails", []), job_id_map)) if "emails" in body else None
            invalid_responsibility_groups = validate_responsibility_membership_groups(
                S.unreg_store,
                uid,
                body.get("responsibilities", []),
                compare_as_string=True,
                membership_rows=body.get("person_youth_group") if "person_youth_group" in body else None,
            )
            if invalid_responsibility_groups:
                return jsonify({
                    "error": "responsibility youth_group_id must match one of the person's youth-group memberships",
                    "invalid_youth_group_ids": invalid_responsibility_groups,
                }), 400
            if addresses_rows is not None:
                _unreg_replace_sub("addresses", uid, addresses_rows)
            payload_by_sheet = {
                "nationality": body.get("nationality", []),
                "jobs": prepared_job_rows,
                "mobile_numbers": mobile_rows_payload,
                "emails": email_rows_payload,
                "social_media": body.get("social_media", []),
                "schools": body.get("schools", []),
                "higher_education": body.get("higher_education", []),
                "timestamps": body.get("timestamps", []),
                "responsibilities": body.get("responsibilities", []),
                "person_youth_group": body.get("person_youth_group", []),
                "hobbies_skills": body.get("hobbies_skills", []),
                S.PERSON_HEALTH_CONDITION_SHEET: body.get(S.PERSON_HEALTH_CONDITION_SHEET, []),
                S.PERSON_SPECIAL_NOTE_SHEET: body.get(S.PERSON_SPECIAL_NOTE_SHEET, []),
            }
            for sheet in ("nationality", "jobs", "mobile_numbers", "emails", "social_media", "schools", "higher_education", "timestamps", "responsibilities", "person_youth_group", "hobbies_skills", S.PERSON_HEALTH_CONDITION_SHEET, S.PERSON_SPECIAL_NOTE_SHEET):
                if sheet in body:
                    _unreg_replace_sub(sheet, uid, payload_by_sheet.get(sheet, body.get(sheet, [])))
            S._save_unreg_store()
            record = _unreg_build_record(uid)
        return jsonify({"ok": True, "record": record})

    @app.delete("/api/unregistered/<uid>")
    def delete_unregistered(uid):
        err = _require_admin()
        if err:
            return err
        with S.unreg_lock:
            membership_df = S.unreg_store.get("person_youth_group", pd.DataFrame())
            record_ids = set()
            if not membership_df.empty and "person_id" in membership_df.columns and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in membership_df.columns:
                matches = membership_df[membership_df["person_id"].astype(str) == str(uid)]
                record_ids = {
                    str(value).strip()
                    for value in matches[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].dropna().astype(str).tolist()
                    if str(value).strip()
                }
            for s in S.UNREG_SHEETS:
                df = S.unreg_store.get(s, pd.DataFrame())
                if s == S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET and not df.empty and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in df.columns:
                    if record_ids:
                        S.unreg_store[s] = df[~df[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin(record_ids)].reset_index(drop=True)
                    continue
                if not df.empty and "person_id" in df.columns:
                    S.unreg_store[s] = df[df["person_id"].astype(str) != str(uid)].reset_index(drop=True)
            S._save_unreg_store()
        for ext in S.ALLOWED_EXTENSIONS:
            p = os.path.join(S.PROFILE_PHOTOS_DIR, f"{uid}.{ext}")
            if os.path.exists(p):
                os.remove(p)
        return jsonify({"ok": True})

    @app.post("/api/unregistered/<uid>/photo")
    def upload_unreg_photo(uid):
        err = _require_admin()
        if err:
            return err
        if "photo" not in request.files:
            return jsonify({"error": "no file"}), 400
        file = request.files["photo"]
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in S.ALLOWED_EXTENSIONS:
            return jsonify({"error": "unsupported file type"}), 400
        for old_ext in S.ALLOWED_EXTENSIONS:
            old = os.path.join(S.PROFILE_PHOTOS_DIR, f"{uid}.{old_ext}")
            if os.path.exists(old):
                os.remove(old)
        dest = os.path.join(S.PROFILE_PHOTOS_DIR, f"{uid}.{ext}")
        file.save(dest)
        return jsonify({"ok": True, "photo": f"/api/unregistered/{uid}/photo"})

    @app.get("/api/unregistered/<uid>/photo")
    def serve_unreg_photo(uid):
        err = require_profile_view_access("unregistered", uid)
        if err:
            return err
        path, ext = S.get_unreg_photo_path(uid)
        if not path:
            return jsonify({"error": "not found"}), 404
        return send_from_directory(os.path.dirname(path), f"{uid}.{ext}")

    @app.post("/api/unregistered/<uid>/promote")
    def promote_unregistered(uid):
        err = _require_admin()
        if err:
            return err
        with S.unreg_lock:
            record = _unreg_build_record(uid)
            if not record:
                return jsonify({"error": "not found"}), 404

        with S.lock:
            new_pid = S._next_person_id()
            p = dict(record.get("person") or {})
            p.pop("person_id", None)
            person_title = p.pop("title", None)
            school_system_sector = p.pop("school_system_sector", None)
            p["person_id"] = new_pid
            p["registered"] = True
            S.store["persons"] = pd.concat([S.store["persons"], pd.DataFrame([p])], ignore_index=True)
            S.replace_person_title(S.store, new_pid, person_title)
            S.replace_person_school_system_sector(S.store, new_pid, school_system_sector)

            for sheet in ("nationality", "mobile_numbers", "emails", "social_media", "addresses", "schools", "higher_education", "jobs", "timestamps", "responsibilities", "person_youth_group", "hobbies_skills", S.PERSON_HEALTH_CONDITION_SHEET, S.PERSON_SPECIAL_NOTE_SHEET):
                rows = record.get(sheet, [])
                if rows:
                    if sheet == "person_youth_group":
                        replace_profile_sub_rows(S.store, new_pid, sheet, rows, compare_as_string=False)
                    else:
                        ndf = pd.DataFrame(rows)
                        ndf["person_id"] = new_pid
                        S.store[sheet] = pd.concat([S.store[sheet], ndf], ignore_index=True)
            S.save()

        src_path, ext = S.get_unreg_photo_path(uid)
        if ext and src_path:
            try:
                os.replace(src_path, os.path.join(S.PROFILE_PHOTOS_DIR, f"{new_pid}.{ext}"))
            except Exception:
                pass

        with S.unreg_lock:
            membership_df = S.unreg_store.get("person_youth_group", pd.DataFrame())
            record_ids = set()
            if not membership_df.empty and "person_id" in membership_df.columns and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in membership_df.columns:
                matches = membership_df[membership_df["person_id"].astype(str) == str(uid)]
                record_ids = {
                    str(value).strip()
                    for value in matches[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].dropna().astype(str).tolist()
                    if str(value).strip()
                }
            for s in S.UNREG_SHEETS:
                df = S.unreg_store.get(s, pd.DataFrame())
                if s == S.PERSON_YOUTH_GROUP_AGE_HISTORY_SHEET and not df.empty and S.PERSON_YOUTH_GROUP_RECORD_ID_COL in df.columns:
                    if record_ids:
                        S.unreg_store[s] = df[~df[S.PERSON_YOUTH_GROUP_RECORD_ID_COL].astype(str).isin(record_ids)].reset_index(drop=True)
                    continue
                if not df.empty and "person_id" in df.columns:
                    S.unreg_store[s] = df[df["person_id"].astype(str) != str(uid)].reset_index(drop=True)
            S._save_unreg_store()

        return jsonify({"ok": True, "person_id": new_pid})

    @app.post("/api/unregistered/sync")
    def sync_unregistered():
        body = request.json or {}
        nodes = body.get("nodes", [])
        created = {}
        with S.unreg_lock:
            for n in nodes:
                if not n.get("name") and not n.get("baseName"):
                    continue
                raw_name = n.get("baseName") or n.get("name") or ""
                parts = raw_name.strip().split()
                if len(parts) == 1:
                    fn, sn, tn, ln = parts[0], "", "", ""
                elif len(parts) == 2:
                    fn, sn, tn, ln = parts[0], "", "", parts[1]
                elif len(parts) == 3:
                    fn, sn, tn, ln = parts[0], parts[1], "", parts[2]
                else:
                    fn, sn, tn, ln = parts[0], parts[1], parts[2], " ".join(parts[3:])

                persons_df = S.unreg_store.get("persons", pd.DataFrame())
                norm_target = S.normalize_arabic(raw_name.strip())
                existing_uid = None
                if not persons_df.empty and "person_id" in persons_df.columns:
                    for _, row in persons_df.iterrows():
                        row_base = " ".join(
                            str(row[k]) for k in ("ar_first_name", "ar_second_name", "ar_third_name", "ar_last_name")
                            if row.get(k)
                        )
                        if S.normalize_arabic(row_base.strip()) == norm_target:
                            existing_uid = S._normalize_person_id(row["person_id"])
                            break

                if existing_uid:
                    created[n.get("id")] = existing_uid
                    continue

                new_uid = S._next_person_id()
                p_row = {
                    "person_id": new_uid,
                    "ar_first_name": fn,
                    "ar_second_name": sn,
                    "ar_third_name": tn,
                    "ar_last_name": ln,
                }
                new_row = pd.DataFrame([p_row])
                S.unreg_store["persons"] = pd.concat([persons_df, new_row], ignore_index=True)
                S.replace_person_title(S.unreg_store, new_uid, n.get("laqab", ""))
                created[n.get("id")] = new_uid
            if created:
                S._save_unreg_store()
        return jsonify({"ok": True, "created": created})


exports = {
    "_unreg_build_record": _unreg_build_record,
}
