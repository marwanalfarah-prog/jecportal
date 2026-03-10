import os

import numpy as np
import pandas as pd
from flask import jsonify, request, send_from_directory

from core import state as S


def register_registered_routes(app):
    def _normalize_membership_rows(rows):
        out = []
        for row in rows:
            normalized = dict(row)
            archived = normalized.get("archived")
            normalized["archived"] = bool(archived) if archived is not None and str(archived) not in ("nan", "None", "") else False
            out.append(normalized)
        return out

    @app.get("/api/stats")
    def stats():
        persons = S._registered_persons_df()
        pyg = S._sheet_for_registered("person_youth_group")
        yg_count = 0
        if not pyg.empty and S.YOUTH_GROUP_ID_COL in pyg.columns:
            yg_count = int(pyg[S.YOUTH_GROUP_ID_COL].dropna().astype(str).nunique())
        return jsonify({
            "total_members": int(len(persons)),
            "youth_groups": yg_count,
            "higher_ed": int(len(S._sheet_for_registered("higher_education"))),
            "employed": int(len(S._sheet_for_registered("jobs")),),
            "governorates": int(persons["governorate"].nunique()),
            "nationalities": int(S._sheet_for_registered("nationality")["nationality"].nunique()),
        })

    @app.get("/api/chart/governorate")
    def chart_gov():
        data = S._registered_persons_df()["governorate"].value_counts().reset_index()
        data.columns = ["label", "value"]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/gender")
    def chart_gender():
        data = S._registered_persons_df()["gender"].value_counts().reset_index()
        data.columns = ["label", "value"]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/youth_group")
    def chart_yg():
        pyg = S._sheet_for_registered("person_youth_group")
        if pyg.empty or S.YOUTH_GROUP_ID_COL not in pyg.columns:
            return jsonify([])
        data = pyg[S.YOUTH_GROUP_ID_COL].dropna().astype(str).value_counts().head(15).reset_index()
        data.columns = ["group_id", "value"]
        data["label"] = data["group_id"].apply(lambda gid: S.youth_group_name(gid) or gid)
        data = data[["label", "value", "group_id"]]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/age_group")
    def chart_ag():
        data = S._sheet_for_registered("person_youth_group")["age_group"].value_counts().reset_index()
        data.columns = ["label", "value"]
        return jsonify(S.df_to_json(data))

    @app.get("/api/persons/enriched")
    def get_persons_enriched():
        cached_payload, cached_version, data_version = S.cache_state()
        if cached_payload is not None and cached_version == data_version:
            return jsonify(cached_payload)
        payload = S.build_enriched()
        S.set_enriched_cache(payload, data_version)
        return jsonify(payload)

    @app.get("/api/filters")
    def filters():
        persons = S._registered_persons_df()
        pyg = S._sheet_for_registered("person_youth_group")
        resp = S._sheet_for_registered("responsibilities")
        nat = S._sheet_for_registered("nationality")
        sch = S._sheet_for_registered("schools")
        he = S._sheet_for_registered("higher_education")
        jobs = S._sheet_for_registered("jobs")
        hob = S._sheet_for_registered("hobbies_skills")

        youth_group_counts = []
        if not pyg.empty and S.YOUTH_GROUP_ID_COL in pyg.columns:
            counts = (
                pyg[["person_id", S.YOUTH_GROUP_ID_COL]]
                .dropna(subset=[S.YOUTH_GROUP_ID_COL])
                .drop_duplicates()
                .groupby(S.YOUTH_GROUP_ID_COL)["person_id"].count()
                .sort_values(ascending=False)
            )
            youth_group_counts = [
                {"value": str(gid), "label": S.youth_group_name(gid) or str(gid), "count": int(c)}
                for gid, c in counts.items()
            ]

        return jsonify({
            "first_name": S.value_counts_json(persons["first_name"]),
            "second_name": S.value_counts_json(persons["second_name"]),
            "third_name": S.value_counts_json(persons["third_name"]),
            "last_name": S.value_counts_json(persons["last_name"]),
            "gender": S.value_counts_json(persons["gender"]),
            "governorate": S.value_counts_json(persons["governorate"]),
            "birth_year": S.value_counts_json(persons["birth_year"].astype(str)),
            "nationality": S.pid_counts(nat, "nationality"),
            "youth_group": youth_group_counts,
            "age_group": S.pid_counts(pyg, "age_group"),
            "youth_join_year": S.pid_counts(pyg, "youth_join_year"),
            "responsibility": S.pid_counts(resp, "responsibility"),
            "school": S.pid_counts(sch, "school"),
            "university": S.pid_counts(he, "university_college"),
            "major": S.pid_counts(he, "major"),
            "degree": S.pid_counts(he, "degree"),
            "job_title": S.pid_counts(jobs, "job_title"),
            "company": S.pid_counts(jobs, "company"),
            "hobby_skill": S.pid_counts(hob, "hobby_skill"),
        })

    @app.get("/api/persons")
    def get_persons():
        df = S._registered_persons_df().copy().replace({np.nan: None})
        df["_avatar_initial"] = df.apply(lambda r: S.avatar_initial_from_person(r), axis=1)
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 50))
        total = len(df)
        df = df.iloc[(page - 1) * per_page: page * per_page]
        return jsonify({"total": total, "page": page, "per_page": per_page, "data": S.df_to_json(df)})

    @app.get("/api/person/<int:pid>")
    def get_person(pid):
        def sub(sheet):
            rows = S.df_to_json(S._sheet_for_registered(sheet)[S._sheet_for_registered(sheet)["person_id"] == pid])
            if sheet == "person_youth_group":
                return _normalize_membership_rows(rows)
            return rows

        persons_row = S._registered_persons_df()[S._registered_persons_df()["person_id"] == pid]
        if persons_row.empty:
            return jsonify({"error": "not found"}), 404
        person_payload = S.df_to_json(persons_row)[0]
        _, ext = S.get_photo_path(pid)
        return jsonify({
            "person": person_payload,
            "avatar_initial": S.avatar_initial_from_person(person_payload),
            "photo": f"/api/person/{pid}/photo" if ext else None,
            "nationality": sub("nationality"),
            "mobile_numbers": sub("mobile_numbers"),
            "schools": sub("schools"),
            "higher_education": sub("higher_education"),
            "jobs": sub("jobs"),
            "timestamps": sub("timestamps"),
            "responsibilities": sub("responsibilities"),
            "person_youth_group": sub("person_youth_group"),
            "hobbies_skills": sub("hobbies_skills"),
        })

    @app.post("/api/person/<int:pid>/photo")
    def upload_photo(pid):
        if "photo" not in request.files:
            return jsonify({"error": "no file"}), 400
        file = request.files["photo"]
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in S.ALLOWED_EXTENSIONS:
            return jsonify({"error": "unsupported file type"}), 400
        for old_ext in S.ALLOWED_EXTENSIONS:
            old = os.path.join(S.PROFILE_PHOTOS_DIR, f"{pid}.{old_ext}")
            if os.path.exists(old):
                os.remove(old)
        dest = os.path.join(S.PROFILE_PHOTOS_DIR, f"{pid}.{ext}")
        file.save(dest)
        S.invalidate_enriched_cache()
        return jsonify({"ok": True, "photo": f"/api/person/{pid}/photo"})

    @app.get("/api/person/<int:pid>/photo")
    def serve_photo(pid):
        path, ext = S.get_photo_path(pid)
        if not path:
            return jsonify({"error": "not found"}), 404
        return send_from_directory(S.PROFILE_PHOTOS_DIR, f"{pid}.{ext}")

    @app.get("/api/table/<sheet>")
    def get_table(sheet):
        if sheet not in S.store:
            return jsonify({"error": "not found"}), 404
        return jsonify(S.df_to_json(S.store[sheet]))

    @app.put("/api/table/<sheet>")
    def put_table(sheet):
        if sheet not in S.store:
            return jsonify({"error": "not found"}), 404
        body = request.json
        with S.lock:
            S.store[sheet] = pd.DataFrame(body)
            S.save()
        return jsonify({"ok": True})

    @app.put("/api/person/<int:pid>")
    def update_person(pid):
        body = request.json
        with S.lock:
            p = S.normalize_person_birth_fields(body.get("person", {}))
            persons = S._registered_persons_df()
            idx = persons[persons["person_id"] == pid].index
            if not idx.empty:
                for k, v in p.items():
                    S.store["persons"].at[idx[0], k] = v

            def replace_sub(sheet, rows):
                df = S.store[sheet]
                df = df[df["person_id"] != pid]
                if rows:
                    new_df = pd.DataFrame(rows)
                    if sheet == "person_youth_group":
                        if "archived" not in new_df.columns:
                            new_df["archived"] = False
                        new_df["archived"] = new_df["archived"].fillna(False).astype(bool)
                    if "person_id" not in new_df.columns:
                        new_df.insert(0, "person_id", pid)
                    df = pd.concat([df, new_df], ignore_index=True)
                S.store[sheet] = df

            replace_sub("nationality", body.get("nationality", []))
            replace_sub("mobile_numbers", body.get("mobile_numbers", []))
            replace_sub("schools", body.get("schools", []))
            replace_sub("higher_education", body.get("higher_education", []))
            replace_sub("jobs", body.get("jobs", []))
            replace_sub("responsibilities", body.get("responsibilities", []))
            replace_sub("person_youth_group", body.get("person_youth_group", []))
            replace_sub("hobbies_skills", body.get("hobbies_skills", []))
            S.save()
        return jsonify({"ok": True})

    @app.post("/api/person")
    def add_person():
        body = request.json
        with S.lock:
            new_id = S._next_person_id()
            p = S.normalize_person_birth_fields(body.get("person", {}))
            p["person_id"] = new_id
            p["registered"] = True
            if "title" not in p:
                p["title"] = None
            S.store["persons"] = pd.concat([S.store["persons"], pd.DataFrame([p])], ignore_index=True)

            def add_sub(sheet, rows):
                if rows:
                    df = pd.DataFrame(rows)
                    if sheet == "person_youth_group":
                        if "archived" not in df.columns:
                            df["archived"] = False
                        df["archived"] = df["archived"].fillna(False).astype(bool)
                    df["person_id"] = new_id
                    S.store[sheet] = pd.concat([S.store[sheet], df], ignore_index=True)

            add_sub("nationality", body.get("nationality", []))
            add_sub("mobile_numbers", body.get("mobile_numbers", []))
            add_sub("schools", body.get("schools", []))
            add_sub("higher_education", body.get("higher_education", []))
            add_sub("jobs", body.get("jobs", []))
            add_sub("responsibilities", body.get("responsibilities", []))
            add_sub("person_youth_group", body.get("person_youth_group", []))
            add_sub("hobbies_skills", body.get("hobbies_skills", []))
            S.save()
        return jsonify({"ok": True, "person_id": new_id})

    @app.delete("/api/person/<int:pid>")
    def delete_person(pid):
        with S.lock:
            persons = S.store["persons"]
            reg_mask = (persons["person_id"] == pid) & (persons["registered"].apply(S._bool_registered))
            if reg_mask.any():
                S.store["persons"] = persons[~reg_mask].reset_index(drop=True)
            for sheet in S.store:
                if sheet == "persons":
                    continue
                if "person_id" in S.store[sheet].columns:
                    S.store[sheet] = S.store[sheet][S.store[sheet]["person_id"] != pid].reset_index(drop=True)
            for ext in S.ALLOWED_EXTENSIONS:
                p = os.path.join(S.PROFILE_PHOTOS_DIR, f"{pid}.{ext}")
                if os.path.exists(p):
                    os.remove(p)
            S.save()
        return jsonify({"ok": True})

    @app.patch("/api/person/<int:pid>/archive")
    def archive_person(pid):
        body = request.json or {}
        youth_group_id = str(body.get("youth_group_id") or "").strip()
        if not youth_group_id:
            return jsonify({"error": "youth_group_id is required"}), 400

        with S.lock:
            persons = S._registered_persons_df()
            if persons[persons["person_id"] == pid].empty:
                return jsonify({"error": "not found"}), 404

            pyg = S.store.get("person_youth_group", pd.DataFrame())
            if pyg.empty or "person_id" not in pyg.columns or S.YOUTH_GROUP_ID_COL not in pyg.columns:
                return jsonify({"error": "membership not found"}), 404

            mask = (
                (pyg["person_id"] == pid)
                & (pyg[S.YOUTH_GROUP_ID_COL].astype(str) == youth_group_id)
            )
            if not mask.any():
                return jsonify({"error": "membership not found"}), 404

            if "archived" not in S.store["person_youth_group"].columns:
                S.store["person_youth_group"]["archived"] = False
            S.store["person_youth_group"].loc[mask, "archived"] = True
            S.save()
        return jsonify({"ok": True})

    @app.patch("/api/person/<int:pid>/unarchive")
    def unarchive_person(pid):
        body = request.json or {}
        youth_group_id = str(body.get("youth_group_id") or "").strip()
        if not youth_group_id:
            return jsonify({"error": "youth_group_id is required"}), 400

        with S.lock:
            persons = S._registered_persons_df()
            if persons[persons["person_id"] == pid].empty:
                return jsonify({"error": "not found"}), 404

            pyg = S.store.get("person_youth_group", pd.DataFrame())
            if pyg.empty or "person_id" not in pyg.columns or S.YOUTH_GROUP_ID_COL not in pyg.columns:
                return jsonify({"error": "membership not found"}), 404

            mask = (
                (pyg["person_id"] == pid)
                & (pyg[S.YOUTH_GROUP_ID_COL].astype(str) == youth_group_id)
            )
            if not mask.any():
                return jsonify({"error": "membership not found"}), 404

            if "archived" not in S.store["person_youth_group"].columns:
                S.store["person_youth_group"]["archived"] = False
            S.store["person_youth_group"].loc[mask, "archived"] = False
            S.save()
        return jsonify({"ok": True})
