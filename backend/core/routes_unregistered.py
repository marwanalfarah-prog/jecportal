import os

import numpy as np
import pandas as pd
from flask import jsonify, request, send_from_directory

from core import state as S


def _unreg_sub(sheet, uid):
    df = S.unreg_store.get(sheet, pd.DataFrame())
    if df.empty or "person_id" not in df.columns:
        return []
    rows = S.df_to_json(df[df["person_id"].astype(str) == str(uid)])
    if sheet == "person_youth_group":
        out = []
        for row in rows:
            normalized = dict(row)
            archived = normalized.get("archived")
            normalized["archived"] = bool(archived) if archived is not None and str(archived) not in ("nan", "None", "") else False
            out.append(normalized)
        return out
    if sheet == "nationality":
        return S.enrich_nationality_rows(rows)
    return rows


def _unreg_build_record(uid):
    persons_df = S.unreg_store.get("persons", pd.DataFrame())
    if persons_df.empty or "person_id" not in persons_df.columns:
        return None
    row = persons_df[persons_df["person_id"].astype(str) == str(uid)]
    if row.empty:
        return None
    person_data = S.df_to_json(
        S._project_primary_addresses(row, S.unreg_store.get("addresses", pd.DataFrame()))
    )[0]
    _, ext = S.get_unreg_photo_path(uid)
    return {
        "person": person_data,
        "avatar_initial": S.avatar_initial_from_person(person_data),
        "photo": f"/api/unregistered/{uid}/photo" if ext else None,
        "nationality": _unreg_sub("nationality", uid),
        "mobile_numbers": _unreg_sub("mobile_numbers", uid),
        "emails": _unreg_sub("emails", uid),
        "social_media": _unreg_sub("social_media", uid),
        "addresses": _unreg_sub("addresses", uid),
        "schools": _unreg_sub("schools", uid),
        "higher_education": _unreg_sub("higher_education", uid),
        "jobs": _unreg_sub("jobs", uid),
        "responsibilities": _unreg_sub("responsibilities", uid),
        "person_youth_group": _unreg_sub("person_youth_group", uid),
        "hobbies_skills": _unreg_sub("hobbies_skills", uid),
    }


def _unreg_replace_sub(sheet, uid, rows):
    df = S.unreg_store.get(sheet, pd.DataFrame())
    if "person_id" in df.columns:
        df = df[df["person_id"].astype(str) != str(uid)]
    if rows:
        new_df = pd.DataFrame(rows)
        if sheet == "person_youth_group":
            if "archived" not in new_df.columns:
                new_df["archived"] = False
            new_df["archived"] = new_df["archived"].fillna(False).astype(bool)
        if "person_id" not in new_df.columns:
            new_df.insert(0, "person_id", uid)
        else:
            new_df["person_id"] = new_df["person_id"].apply(S._normalize_person_id)
        df = pd.concat([df, new_df], ignore_index=True)
    S.unreg_store[sheet] = df


def register_unregistered_routes(app):
    @app.get("/api/unregistered")
    def get_unregistered():
        with S.unreg_lock:
            persons_df = S._project_primary_addresses(
                S.unreg_store.get("persons", pd.DataFrame()),
                S.unreg_store.get("addresses", pd.DataFrame()),
            ).replace({np.nan: None})
            pyg = S.unreg_store.get("person_youth_group", pd.DataFrame())
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

            def pid_to_youth_rows_u(df):
                result = {}
                if df.empty or "person_id" not in df.columns:
                    return result

                for pid, grp in df.groupby("person_id", sort=False):
                    rows = []
                    for _, row in grp.iterrows():
                        yg_id = S._normalize_text(row.get(S.YOUTH_GROUP_ID_COL))
                        if not yg_id:
                            continue
                        age_group = S._normalize_text(row.get("age_group")) or ""
                        join_year = S._normalize_text(row.get("youth_join_year")) or ""
                        archived = row.get("archived")
                        rows.append({
                            "youth_group_id": yg_id,
                            "age_group": age_group,
                            "youth_join_year": join_year,
                            "archived": bool(archived) if archived is not None and str(archived) not in ("nan", "None", "") else False,
                        })
                    result[str(pid)] = rows
                return result

            nat_map = pid_to_list_u(nat, "nationality")
            sch_map = pid_to_list_u(sch, "school")
            youth_rows_map = pid_to_youth_rows_u(pyg)
            ryg_id_map = pid_to_list_u(resp, S.YOUTH_GROUP_ID_COL)
            rtime_map = pid_to_list_u(resp, "time")
            rrole_map = pid_to_list_u(resp, "responsibility")
            uni_map = pid_to_list_u(he, "university_college")
            maj_map = pid_to_list_u(he, "major")
            deg_map = pid_to_list_u(he, "degree")
            job_map = pid_to_list_u(jobs, "job_title")
            comp_map = pid_to_list_u(jobs, "company")
            hob_map = pid_to_list_u(hob, "hobby_skill")

            enriched = []
            for row in persons_df.to_dict(orient="records"):
                uid = str(row.get("person_id", ""))
                row["_avatar_initial"] = S.avatar_initial_from_person(row)
                row["_nationalities"] = nat_map.get(uid, [])
                row["_schools"] = sch_map.get(uid, [])
                youth_rows = youth_rows_map.get(uid, [])
                active_youth_rows = [entry for entry in youth_rows if not bool(entry.get("archived"))]
                archived_youth_rows = [entry for entry in youth_rows if bool(entry.get("archived"))]
                row["_youth_memberships"] = youth_rows

                yg_ids = [entry["youth_group_id"] for entry in active_youth_rows]
                row["_youth_group_ids"] = yg_ids
                row["_youth_groups"] = [S.youth_group_name(gid) or gid for gid in yg_ids]
                row["_age_groups"] = [entry["age_group"] for entry in active_youth_rows]
                row["_youth_join_years"] = [entry["youth_join_year"] for entry in active_youth_rows]
                row["_archived_youth_group_ids"] = [entry["youth_group_id"] for entry in archived_youth_rows]
                ryg_ids = ryg_id_map.get(uid, [])
                row["_responsibility_youth_group_ids"] = ryg_ids
                row["_responsibility_youth_groups"] = [S.youth_group_name(gid) or gid for gid in ryg_ids]
                row["_responsibility_times"] = rtime_map.get(uid, [])
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
            addresses_rows = body.get("addresses") if "addresses" in body else S.address_rows_from_legacy_person_payload(raw_person)
            for legacy_col in ("governorate", "city", "country", "address"):
                p.pop(legacy_col, None)
            if not p.get("first_name"):
                raw_name = body.get("name", "")
                parts = raw_name.strip().split() if raw_name else []
                if len(parts) == 1:
                    p = {**p, "first_name": parts[0], "last_name": ""}
                elif len(parts) == 2:
                    p = {**p, "first_name": parts[0], "last_name": parts[1]}
                elif len(parts) == 3:
                    p = {**p, "first_name": parts[0], "second_name": parts[1], "last_name": parts[2]}
                elif len(parts) >= 4:
                    p = {**p, "first_name": parts[0], "second_name": parts[1], "third_name": parts[2], "last_name": " ".join(parts[3:])}
            p["person_id"] = new_uid
            p["registered"] = False
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            new_row = pd.DataFrame([p])
            for col in S.UNREG_PERSONS_COLS:
                if col not in new_row.columns:
                    new_row[col] = None
            S.unreg_store["persons"] = pd.concat([persons_df, new_row], ignore_index=True)
            if addresses_rows:
                _unreg_replace_sub("addresses", new_uid, addresses_rows)
            for sheet in ("nationality", "mobile_numbers", "emails", "social_media", "schools", "higher_education", "jobs", "responsibilities", "person_youth_group", "hobbies_skills"):
                rows = body.get(sheet, [])
                if rows:
                    _unreg_replace_sub(sheet, new_uid, rows)
            S._save_unreg_store()
            record = _unreg_build_record(new_uid)
        return jsonify({"ok": True, "person_id": new_uid, "record": record})

    @app.put("/api/unregistered/<uid>")
    def update_unregistered(uid):
        body = request.json or {}
        with S.unreg_lock:
            persons_df = S.unreg_store.get("persons", pd.DataFrame())
            if persons_df.empty or "person_id" not in persons_df.columns:
                return jsonify({"error": "not found"}), 404
            idx = persons_df[persons_df["person_id"].astype(str) == str(uid)].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404
            raw_person = body.get("person", {})
            p = S.normalize_person_birth_fields(raw_person)
            addresses_rows = body.get("addresses") if "addresses" in body else None
            if addresses_rows is None:
                legacy_addresses = S.address_rows_from_legacy_person_payload(raw_person)
                if legacy_addresses:
                    addresses_rows = legacy_addresses
            for legacy_col in ("governorate", "city", "country", "address"):
                p.pop(legacy_col, None)
            for k, v in p.items():
                S.unreg_store["persons"].at[idx[0], k] = v
            if addresses_rows is not None:
                _unreg_replace_sub("addresses", uid, addresses_rows)
            for sheet in ("nationality", "mobile_numbers", "emails", "social_media", "schools", "higher_education", "jobs", "responsibilities", "person_youth_group", "hobbies_skills"):
                if sheet in body:
                    _unreg_replace_sub(sheet, uid, body[sheet])
            S._save_unreg_store()
            record = _unreg_build_record(uid)
        return jsonify({"ok": True, "record": record})

    @app.delete("/api/unregistered/<uid>")
    def delete_unregistered(uid):
        with S.unreg_lock:
            for s in S.UNREG_SHEETS:
                df = S.unreg_store.get(s, pd.DataFrame())
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
        path, ext = S.get_unreg_photo_path(uid)
        if not path:
            return jsonify({"error": "not found"}), 404
        return send_from_directory(os.path.dirname(path), f"{uid}.{ext}")

    @app.post("/api/unregistered/<uid>/promote")
    def promote_unregistered(uid):
        with S.unreg_lock:
            record = _unreg_build_record(uid)
            if not record:
                return jsonify({"error": "not found"}), 404

        with S.lock:
            new_pid = S._next_person_id()
            p = dict(record.get("person") or {})
            p.pop("person_id", None)
            p.pop("title", None)
            p["person_id"] = new_pid
            p["registered"] = True
            S.store["persons"] = pd.concat([S.store["persons"], pd.DataFrame([p])], ignore_index=True)

            for sheet in ("nationality", "mobile_numbers", "emails", "social_media", "addresses", "schools", "higher_education", "jobs", "responsibilities", "person_youth_group", "hobbies_skills"):
                rows = record.get(sheet, [])
                if rows:
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
            for s in S.UNREG_SHEETS:
                df = S.unreg_store.get(s, pd.DataFrame())
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
                            str(row[k]) for k in ("first_name", "second_name", "third_name", "last_name")
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
                    "title": n.get("laqab", ""),
                    "first_name": fn,
                    "second_name": sn,
                    "third_name": tn,
                    "last_name": ln,
                }
                new_row = pd.DataFrame([p_row])
                S.unreg_store["persons"] = pd.concat([persons_df, new_row], ignore_index=True)
                created[n.get("id")] = new_uid
            if created:
                S._save_unreg_store()
        return jsonify({"ok": True, "created": created})


exports = {
    "_unreg_build_record": _unreg_build_record,
}
