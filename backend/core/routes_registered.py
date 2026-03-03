import os

import numpy as np
import pandas as pd
from flask import jsonify, request, send_from_directory

from core import state as S


def register_registered_routes(app):
    @app.get("/api/stats")
    def stats():
        persons = S._registered_persons_df()
        return jsonify({
            "total_members": int(len(persons)),
            "youth_groups": int(S._sheet_for_registered("person_youth_group")["youth_group_name"].nunique()),
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
        data = S._sheet_for_registered("person_youth_group")["youth_group_name"].value_counts().head(15).reset_index()
        data.columns = ["label", "value"]
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

        return jsonify({
            "first_name": S.value_counts_json(persons["first_name"]),
            "second_name": S.value_counts_json(persons["second_name"]),
            "third_name": S.value_counts_json(persons["third_name"]),
            "last_name": S.value_counts_json(persons["last_name"]),
            "gender": S.value_counts_json(persons["gender"]),
            "governorate": S.value_counts_json(persons["governorate"]),
            "birth_year": S.value_counts_json(persons["birth_year"].astype(str)),
            "nationality": S.pid_counts(nat, "nationality"),
            "youth_group": S.pid_counts(pyg, "youth_group_name"),
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
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 50))
        total = len(df)
        df = df.iloc[(page - 1) * per_page: page * per_page]
        return jsonify({"total": total, "page": page, "per_page": per_page, "data": S.df_to_json(df)})

    @app.get("/api/person/<int:pid>")
    def get_person(pid):
        def sub(sheet):
            return S.df_to_json(S._sheet_for_registered(sheet)[S._sheet_for_registered(sheet)["person_id"] == pid])

        persons_row = S._registered_persons_df()[S._registered_persons_df()["person_id"] == pid]
        if persons_row.empty:
            return jsonify({"error": "not found"}), 404
        _, ext = S.get_photo_path(pid)
        return jsonify({
            "person": S.df_to_json(persons_row)[0],
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
            p = body.get("person", {})
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
            p = body.get("person", {})
            p["person_id"] = new_id
            p["registered"] = True
            if "title" not in p:
                p["title"] = None
            S.store["persons"] = pd.concat([S.store["persons"], pd.DataFrame([p])], ignore_index=True)

            def add_sub(sheet, rows):
                if rows:
                    df = pd.DataFrame(rows)
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
        with S.lock:
            persons = S._registered_persons_df()
            idx = persons[persons["person_id"] == pid].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404
            S.store["persons"].at[idx[0], "archived"] = True
            S.save()
        return jsonify({"ok": True})

    @app.patch("/api/person/<int:pid>/unarchive")
    def unarchive_person(pid):
        with S.lock:
            persons = S._registered_persons_df()
            idx = persons[persons["person_id"] == pid].index
            if idx.empty:
                return jsonify({"error": "not found"}), 404
            S.store["persons"].at[idx[0], "archived"] = False
            S.save()
        return jsonify({"ok": True})
