import os

import numpy as np
import pandas as pd
from flask import jsonify, request, send_from_directory

from core import state as S


def _unreg_sub(sheet, uid):
    df = S.unreg_store.get(sheet, pd.DataFrame())
    if df.empty or "person_id" not in df.columns:
        return []
    return S.df_to_json(df[df["person_id"].astype(str) == str(uid)])


def _unreg_build_record(uid):
    persons_df = S.unreg_store.get("persons", pd.DataFrame())
    if persons_df.empty or "person_id" not in persons_df.columns:
        return None
    row = persons_df[persons_df["person_id"].astype(str) == str(uid)]
    if row.empty:
        return None
    person_data = S.df_to_json(row)[0]
    _, ext = S.get_unreg_photo_path(uid)
    return {
        "person": person_data,
        "photo": f"/api/unregistered/{uid}/photo" if ext else None,
        "nationality": _unreg_sub("nationality", uid),
        "mobile_numbers": _unreg_sub("mobile_numbers", uid),
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
            persons_df = S.unreg_store.get("persons", pd.DataFrame()).replace({np.nan: None})
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

            nat_map = pid_to_list_u(nat, "nationality")
            sch_map = pid_to_list_u(sch, "school")
            yg_map = pid_to_list_u(pyg, "youth_group_name")
            ag_map = pid_to_list_u(pyg, "age_group")
            yjy_map = pid_to_list_u(pyg, "youth_join_year")
            ryg_map = pid_to_list_u(resp, "youth_group_name")
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
                row["_nationalities"] = nat_map.get(uid, [])
                row["_schools"] = sch_map.get(uid, [])
                row["_youth_groups"] = yg_map.get(uid, [])
                row["_age_groups"] = ag_map.get(uid, [])
                row["_youth_join_years"] = yjy_map.get(uid, [])
                row["_responsibility_youth_groups"] = ryg_map.get(uid, [])
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
                archived = row.get("archived")
                row["archived"] = bool(archived) if archived is not None and str(archived) not in ('nan', 'None', '') else False
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
            p = body.get("person") or {}
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
            for sheet in ("nationality", "mobile_numbers", "schools", "higher_education", "jobs", "responsibilities", "person_youth_group", "hobbies_skills"):
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
            p = body.get("person", {})
            for k, v in p.items():
                S.unreg_store["persons"].at[idx[0], k] = v
            for sheet in ("nationality", "mobile_numbers", "schools", "higher_education", "jobs", "responsibilities", "person_youth_group", "hobbies_skills"):
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

            for sheet in ("nationality", "mobile_numbers", "schools", "higher_education", "jobs", "responsibilities", "person_youth_group", "hobbies_skills"):
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
