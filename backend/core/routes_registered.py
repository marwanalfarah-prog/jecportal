import os
import re
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd
from flask import jsonify, request, send_from_directory

from core import state as S
from core.routes_auth import _require_admin, _require_auth
from core.routes_profile_common import (
    build_location_only_address_rows,
    build_profile_record,
    get_profile_sub_rows,
    profile_edit_scope,
    require_profile_view_access,
    replace_profile_sub_rows,
    validate_responsibility_membership_groups,
)


def _is_allowed_google_maps_host(hostname: str | None) -> bool:
    host = (hostname or "").strip().lower()
    if not host:
        return False
    if host == "goo.gl" or host.endswith(".goo.gl"):
        return True
    return host == "google.com" or host.endswith(".google.com") or ".google." in host


def _extract_coordinate_pair(text: str | None):
    source = str(text or "")
    patterns = [
        (re.compile(r"!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)"), False),
        (re.compile(r"!4d(-?\d{1,3}(?:\.\d+)?)!3d(-?\d{1,3}(?:\.\d+)?)"), True),
        (re.compile(r"@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)"), False),
        (re.compile(r"(-?\d{1,3}(?:\.\d+)?),\+(-?\d{1,3}(?:\.\d+)?)"), False),
        (re.compile(r"(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)"), False),
    ]

    for pattern, reversed_order in patterns:
        match = pattern.search(source)
        if not match:
            continue
        lat_raw = match.group(2) if reversed_order else match.group(1)
        lng_raw = match.group(1) if reversed_order else match.group(2)
        lat = S._normalize_coordinate(lat_raw, "lat")
        lng = S._normalize_coordinate(lng_raw, "lng")
        if lat is not None and lng is not None:
            return lat, lng
    return None, None


def _parse_google_maps_coordinates(raw_url: str):
    text = str(raw_url or "").strip()
    if not text:
        return None, None, False

    try:
        parsed = urlparse(text)
    except ValueError:
        return None, None, False

    if parsed.scheme not in {"http", "https"}:
        return None, None, False

    if not _is_allowed_google_maps_host(parsed.hostname):
        return None, None, False

    candidates = [text, unquote(text), parsed.path, unquote(parsed.path)]
    query_pairs = parsed.query.split("&") if parsed.query else []
    for pair in query_pairs:
        if "=" not in pair:
            continue
        _, value = pair.split("=", 1)
        if value:
            candidates.append(value)
            candidates.append(unquote(value))

    for candidate in candidates:
        lat, lng = _extract_coordinate_pair(candidate)
        if lat is not None and lng is not None:
            return lat, lng, True

    return None, None, True


def _resolve_google_maps_coordinates(raw_url: str):
    lat, lng, allowed = _parse_google_maps_coordinates(raw_url)
    if lat is not None and lng is not None:
        return lat, lng
    if not allowed:
        return None, None

    request_obj = Request(str(raw_url).strip(), headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request_obj, timeout=10) as response:
        final_url = response.geturl()
        if not _is_allowed_google_maps_host(urlparse(final_url).hostname):
            return None, None
        lat, lng, _ = _parse_google_maps_coordinates(final_url)
        if lat is not None and lng is not None:
            return lat, lng
        try:
            content = response.read(65536).decode("utf-8", errors="ignore")
        except Exception:
            return None, None
        return _extract_coordinate_pair(content)


def _person_full_name(person: dict | None) -> str:
    payload = person if isinstance(person, dict) else {}
    parts = [
        payload.get("title"),
        payload.get("ar_first_name"),
        payload.get("ar_second_name"),
        payload.get("ar_third_name"),
        payload.get("ar_last_name"),
    ]
    return " ".join(str(part).strip() for part in parts if str(part or "").strip())


def _membership_rows_by_person(df: pd.DataFrame):
    lookup = {}
    if df is None or df.empty or "person_id" not in df.columns:
        return lookup

    for pid, grp in df.groupby("person_id", sort=False):
        entries = []
        for _, row in grp.iterrows():
            youth_group_id = S._normalize_text(row.get(S.YOUTH_GROUP_ID_COL))
            if not youth_group_id:
                continue
            archived = row.get("archived")
            if archived is not None and str(archived) not in ("nan", "None", "") and bool(archived):
                continue
            entries.append({
                "youth_group_id": youth_group_id,
                "age_group": S._normalize_text(row.get("age_group")) or "",
            })
        lookup[str(S._normalize_person_id(pid))] = entries
    return lookup


def _build_people_location_rows(persons_df: pd.DataFrame, addresses_df: pd.DataFrame, memberships_df: pd.DataFrame, person_type: str):
    if persons_df is None or persons_df.empty or "person_id" not in persons_df.columns:
        return []
    if addresses_df is None or addresses_df.empty or "person_id" not in addresses_df.columns:
        return []

    person_lookup = {}
    for person in persons_df.replace({np.nan: None}).to_dict(orient="records"):
        pid = str(S._normalize_person_id(person.get("person_id")))
        if pid:
            person_lookup[pid] = person

    memberships_lookup = _membership_rows_by_person(memberships_df)
    rows = []
    for index, address in enumerate(addresses_df.replace({np.nan: None}).to_dict(orient="records")):
        pid = str(S._normalize_person_id(address.get("person_id")))
        person = person_lookup.get(pid)
        if not pid or person is None:
            continue

        lat = S._normalize_coordinate(address.get("lat"), "lat")
        lng = S._normalize_coordinate(address.get("lng"), "lng")
        if lat is None or lng is None:
            continue

        memberships = memberships_lookup.get(pid, [])
        youth_groups = []
        age_groups = []
        for membership in memberships:
            youth_group_id = membership.get("youth_group_id")
            youth_group_name = S.youth_group_name(youth_group_id) or youth_group_id
            if youth_group_name and youth_group_name not in youth_groups:
                youth_groups.append(youth_group_name)
            age_group = membership.get("age_group")
            if age_group and age_group not in age_groups:
                age_groups.append(age_group)

        country = S._normalize_text(address.get("country")) or S.DEFAULT_COUNTRY
        governorate = S._normalize_text(address.get("governorate"))
        city = S._normalize_text(address.get("city"))
        full_address_line = S._normalize_text(address.get(S.STREET_ADDRESS_COL) or address.get("address"))

        rows.append({
            "location_key": f"{person_type}:{pid}:{index}",
            "person_id": person.get("person_id"),
            "person_type": person_type,
            "full_name": _person_full_name(person),
            "youth_groups": youth_groups,
            "age_groups": age_groups,
            "country": country,
            "governorate": governorate,
            "city": city,
            "address": full_address_line,
            "full_address": "، ".join(part for part in [country, governorate, city, full_address_line] if part),
            "lat": lat,
            "lng": lng,
            "is_primary": S._to_bool(address.get("is_primary")),
        })

    rows.sort(key=lambda item: (
        str(item.get("governorate") or ""),
        str(item.get("city") or ""),
        str(item.get("full_name") or ""),
        0 if item.get("is_primary") else 1,
    ))
    return rows


def _active_registered_person_ids() -> set[str]:
    persons = S._registered_persons_df()
    if persons.empty or "person_id" not in persons.columns:
        return set()

    pyg = S._sheet_for_registered("person_youth_group")
    if pyg.empty or "person_id" not in pyg.columns:
        return {str(S._normalize_person_id(pid)) for pid in persons["person_id"].dropna()}

    membership_person_ids: set[str] = set()
    active_person_ids: set[str] = set()
    for _, row in pyg.iterrows():
        person_id = S._normalize_person_id(row.get("person_id"))
        if person_id in (None, ""):
            continue
        person_key = str(person_id)
        membership_person_ids.add(person_key)

        archived = row.get("archived")
        if archived is not None and str(archived) not in ("nan", "None", "") and bool(archived):
            continue
        active_person_ids.add(person_key)

    registered_person_ids = {str(S._normalize_person_id(pid)) for pid in persons["person_id"].dropna()}
    no_membership_person_ids = registered_person_ids - membership_person_ids
    return active_person_ids | no_membership_person_ids


def _active_registered_persons_df() -> pd.DataFrame:
    persons = S._registered_persons_df()
    if persons.empty or "person_id" not in persons.columns:
        return persons

    active_person_ids = _active_registered_person_ids()
    if not active_person_ids:
        return persons.iloc[0:0].copy()
    return persons[persons["person_id"].astype(str).isin(active_person_ids)].copy()


def _filter_to_active_registered_people(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty or "person_id" not in df.columns:
        return df

    active_person_ids = _active_registered_person_ids()
    if not active_person_ids:
        return df.iloc[0:0].copy()
    return df[df["person_id"].astype(str).isin(active_person_ids)].copy()


def _active_registered_membership_df() -> pd.DataFrame:
    pyg = _filter_to_active_registered_people(S._sheet_for_registered("person_youth_group"))
    if pyg.empty:
        return pyg

    archived_series = pyg["archived"] if "archived" in pyg.columns else pd.Series(False, index=pyg.index)
    archived_mask = archived_series.apply(
        lambda value: value is not None and str(value) not in ("nan", "None", "") and bool(value)
    )
    return pyg[~archived_mask].copy()


def register_registered_routes(app):
    @app.get("/api/stats")
    def stats():
        persons = _active_registered_persons_df()
        pyg = _active_registered_membership_df()
        higher_education = _filter_to_active_registered_people(S._sheet_for_registered("higher_education"))
        jobs = _filter_to_active_registered_people(S._sheet_for_registered("jobs"))
        nationality = _filter_to_active_registered_people(S._sheet_for_registered("nationality"))
        yg_count = 0
        if not pyg.empty and S.YOUTH_GROUP_ID_COL in pyg.columns:
            yg_count = int(pyg[S.YOUTH_GROUP_ID_COL].dropna().astype(str).nunique())
        return jsonify({
            "total_members": int(len(persons)),
            "youth_groups": yg_count,
            "higher_ed": int(len(higher_education)),
            "employed": int(len(jobs)),
            "governorates": int(persons["governorate"].nunique()),
            "nationalities": int(nationality["nationality"].nunique()) if not nationality.empty and "nationality" in nationality.columns else 0,
        })

    @app.get("/api/chart/governorate")
    def chart_gov():
        data = _active_registered_persons_df()["governorate"].value_counts().reset_index()
        data.columns = ["label", "value"]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/gender")
    def chart_gender():
        data = _active_registered_persons_df()["gender"].value_counts().reset_index()
        data.columns = ["label", "value"]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/youth_group")
    def chart_yg():
        pyg = _active_registered_membership_df()
        if pyg.empty or S.YOUTH_GROUP_ID_COL not in pyg.columns:
            return jsonify([])
        data = (
            pyg[["person_id", S.YOUTH_GROUP_ID_COL]]
            .dropna(subset=[S.YOUTH_GROUP_ID_COL])
            .drop_duplicates()
            .groupby(S.YOUTH_GROUP_ID_COL)["person_id"].count()
            .sort_values(ascending=False)
            .head(15)
            .reset_index()
        )
        data.columns = ["group_id", "value"]
        data["label"] = data["group_id"].apply(lambda gid: S.youth_group_name(gid) or gid)
        data = data[["label", "value", "group_id"]]
        return jsonify(S.df_to_json(data))

    @app.get("/api/chart/age_group")
    def chart_ag():
        data = _active_registered_membership_df()["age_group"].value_counts().reset_index()
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

    @app.get("/api/persons/members-index")
    def get_persons_members_index():
        cached_payload, cached_version, data_version = S.members_index_cache_state()
        if cached_payload is not None and cached_version == data_version:
            return jsonify(cached_payload)
        payload = S.build_members_index()
        S.set_members_index_cache(payload, data_version)
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
        youth_group_count_map = {}
        if not pyg.empty and S.YOUTH_GROUP_ID_COL in pyg.columns:
            counts = (
                pyg[["person_id", S.YOUTH_GROUP_ID_COL]]
                .dropna(subset=[S.YOUTH_GROUP_ID_COL])
                .drop_duplicates()
                .groupby(S.YOUTH_GROUP_ID_COL)["person_id"].count()
            )
            youth_group_count_map = {
                str(gid): int(count)
                for gid, count in counts.items()
                if str(gid).strip()
            }

        seen_youth_group_ids = set()
        for option in S.youth_group_options():
            group_id = str(option.get("value") or "").strip()
            if not group_id:
                continue
            seen_youth_group_ids.add(group_id)
            youth_group_counts.append({
                "value": group_id,
                "label": S.youth_group_name(group_id) or str(option.get("label") or group_id),
                "count": youth_group_count_map.get(group_id, 0),
            })

        for group_id, count in youth_group_count_map.items():
            if group_id in seen_youth_group_ids:
                continue
            youth_group_counts.append({
                "value": group_id,
                "label": S.youth_group_name(group_id) or group_id,
                "count": count,
            })

        youth_group_counts.sort(key=lambda item: (-int(item.get("count") or 0), str(item.get("label") or item.get("value") or "")))

        return jsonify({
            "ar_first_name": S.value_counts_json(persons["ar_first_name"]),
            "ar_second_name": S.value_counts_json(persons["ar_second_name"]),
            "ar_third_name": S.value_counts_json(persons["ar_third_name"]),
            "ar_last_name": S.value_counts_json(persons["ar_last_name"]),
            "en_first_name": S.value_counts_json(persons["en_first_name"]),
            "en_second_name": S.value_counts_json(persons["en_second_name"]),
            "en_third_name": S.value_counts_json(persons["en_third_name"]),
            "en_last_name": S.value_counts_json(persons["en_last_name"]),
            "mother_ar_first_name": S.value_counts_json(persons["mother_ar_first_name"]),
            "mother_ar_second_name": S.value_counts_json(persons["mother_ar_second_name"]),
            "mother_ar_last_name": S.value_counts_json(persons["mother_ar_last_name"]),
            "mother_en_first_name": S.value_counts_json(persons["mother_en_first_name"]),
            "mother_en_second_name": S.value_counts_json(persons["mother_en_second_name"]),
            "mother_en_last_name": S.value_counts_json(persons["mother_en_last_name"]),
            "gender": S.value_counts_json(persons["gender"]),
            "school_system": S.value_counts_json(persons["school_system"]),
            "governorate": S.value_counts_json(persons["governorate"]),
            "birth_year": S.value_counts_json(persons["birth_year"].astype(str)),
            "nationality": S.pid_counts(nat, "nationality"),
            "youth_group": youth_group_counts,
            "age_group": S.pid_counts(pyg, "age_group"),
            "youth_join_year": S.pid_counts(pyg, "youth_join_year"),
            "responsibility": S.pid_counts(resp, "responsibility_name"),
            "school": S.pid_counts(sch, S.SCHOOL_NAME_COL),
            "university": S.pid_counts(he, S.HIGHER_EDUCATION_INSTITUTION_COL),
            "major": S.pid_counts(he, "major"),
            "degree": S.pid_counts(he, "degree"),
            "job_title": S.pid_counts(jobs, "job_title"),
            "company": S.pid_counts(jobs, S.EMPLOYER_NAME_COL),
            "hobby_skill": S.pid_counts(hob, "hobby_skill"),
        })

    @app.get("/api/nationality-iso-codes")
    def get_nationality_iso_codes():
        err = _require_auth()
        if err:
            return err
        lookup = S.nationality_iso_lookup()
        entries = [
            {
                "nationality": nationality,
                "iso_alpha2": payload.get("iso_alpha2"),
            }
            for nationality, payload in lookup.items()
            if nationality
        ]
        entries.sort(key=lambda item: str(item.get("nationality") or ""))
        return jsonify({"entries": entries})

    @app.get("/api/persons")
    def get_persons():
        df = S._registered_persons_df().copy().replace({np.nan: None})
        df["_avatar_initial"] = df.apply(lambda r: S.avatar_initial_from_person(r), axis=1)
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 50))
        total = len(df)
        df = df.iloc[(page - 1) * per_page: page * per_page]
        return jsonify({"total": total, "page": page, "per_page": per_page, "data": S.df_to_json(df)})

    @app.get("/api/people-locations")
    def get_people_locations():
        registered_rows = _build_people_location_rows(
            S._registered_persons_df(),
            S.store.get("addresses", pd.DataFrame()),
            S._sheet_for_registered("person_youth_group"),
            "registered",
        )

        unregistered_rows = _build_people_location_rows(
            S.unregistered_persons_view_df(),
            S.unreg_store.get("addresses", pd.DataFrame()),
            S.unreg_store.get("person_youth_group", pd.DataFrame()),
            "unregistered",
        )

        return jsonify({"locations": registered_rows + unregistered_rows})

    @app.get("/api/person/<int:pid>")
    def get_person(pid):
        err = require_profile_view_access("registered", pid)
        if err:
            return err
        record = build_profile_record(
            S._registered_persons_df(),
            S.store,
            pid,
            compare_as_string=False,
            photo_path_getter=S.get_photo_path,
            photo_url_template="/api/person/{pid}/photo",
        )
        if not record:
            return jsonify({"error": "not found"}), 404
        return jsonify(record)

    @app.post("/api/person/<int:pid>/photo")
    def upload_photo(pid):
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
            old = os.path.join(S.PROFILE_PHOTOS_DIR, f"{pid}.{old_ext}")
            if os.path.exists(old):
                os.remove(old)
        dest = os.path.join(S.PROFILE_PHOTOS_DIR, f"{pid}.{ext}")
        file.save(dest)
        S.invalidate_enriched_cache()
        return jsonify({"ok": True, "photo": f"/api/person/{pid}/photo"})

    @app.get("/api/person/<int:pid>/photo")
    def serve_photo(pid):
        err = require_profile_view_access("registered", pid)
        if err:
            return err
        path, ext = S.get_photo_path(pid)
        if not path:
            return jsonify({"error": "not found"}), 404
        return send_from_directory(S.PROFILE_PHOTOS_DIR, f"{pid}.{ext}")

    @app.get("/api/table/<sheet>")
    def get_table(sheet):
        err = _require_admin()
        if err:
            return err
        if sheet not in S.store:
            return jsonify({"error": "not found"}), 404
        return jsonify(S.df_to_json(S.store[sheet]))

    @app.put("/api/table/<sheet>")
    def put_table(sheet):
        err = _require_admin()
        if err:
            return err
        if sheet not in S.store:
            return jsonify({"error": "not found"}), 404
        body = request.json
        with S.lock:
            S.store[sheet] = pd.DataFrame(body)
            S.save()
        return jsonify({"ok": True})

    @app.post("/api/location/resolve-google-maps")
    def resolve_google_maps_location():
        err = _require_auth()
        if err:
            return err
        body = request.json or {}
        raw_url = str(body.get("url") or "").strip()
        if not raw_url:
            return jsonify({"error": "url is required"}), 400
        try:
            lat, lng = S.resolve_google_maps_coordinates(raw_url)
        except Exception:
            return jsonify({"error": "failed to resolve location"}), 400
        if lat is None or lng is None:
            return jsonify({"error": "coordinates not found"}), 400
        return jsonify({"lat": lat, "lng": lng})

    @app.put("/api/person/<int:pid>")
    def update_person(pid):
        scope = profile_edit_scope("registered", pid)
        if not scope:
            return jsonify({"error": "unauthorized"}), 403

        body = request.json or {}
        if scope == "location_only":
            if set(body.keys()) - {"addresses"}:
                return jsonify({"error": "forbidden"}), 403
            try:
                addresses_rows = build_location_only_address_rows(S.store, pid, body.get("addresses"), compare_as_string=False)
            except ValueError:
                return jsonify({"error": "invalid google maps location"}), 400

            with S.lock:
                df = S.store.get("addresses", pd.DataFrame())
                if not df.empty and "person_id" in df.columns:
                    df = df[df["person_id"] != pid]
                if addresses_rows:
                    new_df = pd.DataFrame(addresses_rows)
                    if "person_id" not in new_df.columns:
                        new_df.insert(0, "person_id", pid)
                    df = pd.concat([df, new_df], ignore_index=True)
                S.store["addresses"] = df
                S.save()
            return jsonify({"ok": True})

        with S.lock:
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
            persons = S._registered_persons_df()
            idx = persons[persons["person_id"] == pid].index
            if not idx.empty:
                for k, v in p.items():
                    S.store["persons"].at[idx[0], k] = v
                if title_in_payload:
                    S.replace_person_title(S.store, pid, person_title)
                if school_system_sector_in_payload:
                    S.replace_person_school_system_sector(S.store, pid, school_system_sector)

            job_rows_payload = body.get("jobs", [])
            prepared_job_rows, job_id_map = S.prepare_job_rows_for_person(S.store, pid, job_rows_payload)
            mobile_rows_payload = S.remap_job_links_in_mobile_rows(body.get("mobile_numbers", []), job_id_map)
            email_rows_payload = S.prepare_email_rows_for_person(S.store, pid, S.remap_job_links_in_email_rows(body.get("emails", []), job_id_map))
            invalid_responsibility_groups = validate_responsibility_membership_groups(
                S.store,
                pid,
                body.get("responsibilities", []),
                compare_as_string=False,
                membership_rows=body.get("person_youth_group", []),
            )
            if invalid_responsibility_groups:
                return jsonify({
                    "error": "responsibility youth_group_id must match one of the person's youth-group memberships",
                    "invalid_youth_group_ids": invalid_responsibility_groups,
                }), 400

            def replace_sub(sheet, rows):
                replace_profile_sub_rows(S.store, pid, sheet, rows, compare_as_string=False)

            replace_sub("nationality", body.get("nationality", []))
            replace_sub("jobs", prepared_job_rows)
            replace_sub("mobile_numbers", mobile_rows_payload)
            replace_sub("emails", email_rows_payload)
            replace_sub("social_media", body.get("social_media", []))
            if addresses_rows is not None:
                replace_sub("addresses", addresses_rows)
            replace_sub("schools", body.get("schools", []))
            replace_sub("higher_education", body.get("higher_education", []))
            replace_sub("responsibilities", body.get("responsibilities", []))
            replace_sub("person_youth_group", body.get("person_youth_group", []))
            replace_sub("hobbies_skills", body.get("hobbies_skills", []))
            replace_sub(S.PERSON_HEALTH_CONDITION_SHEET, body.get(S.PERSON_HEALTH_CONDITION_SHEET, []))
            replace_sub(S.PERSON_SPECIAL_NOTE_SHEET, body.get(S.PERSON_SPECIAL_NOTE_SHEET, []))
            S.save()
        return jsonify({"ok": True})

    @app.post("/api/person")
    def add_person():
        body = request.json or {}
        with S.lock:
            new_id = S._next_person_id()
            raw_person = body.get("person", {})
            p = S.normalize_person_birth_fields(raw_person)
            person_title = p.pop("title", None)
            school_system_sector = p.pop("school_system_sector", None)
            addresses_rows = body.get("addresses") if "addresses" in body else S.address_rows_from_legacy_person_payload(raw_person)
            for legacy_col in ("governorate", "city", "country", "address"):
                p.pop(legacy_col, None)
            p["person_id"] = new_id
            p["registered"] = True
            S.store["persons"] = pd.concat([S.store["persons"], pd.DataFrame([p])], ignore_index=True)
            S.replace_person_title(S.store, new_id, person_title)
            S.replace_person_school_system_sector(S.store, new_id, school_system_sector)

            prepared_job_rows, job_id_map = S.prepare_job_rows_for_person(S.store, new_id, body.get("jobs", []))
            mobile_rows_payload = S.remap_job_links_in_mobile_rows(body.get("mobile_numbers", []), job_id_map)
            email_rows_payload = S.prepare_email_rows_for_person(S.store, new_id, S.remap_job_links_in_email_rows(body.get("emails", []), job_id_map))
            invalid_responsibility_groups = validate_responsibility_membership_groups(
                S.store,
                new_id,
                body.get("responsibilities", []),
                compare_as_string=False,
                membership_rows=body.get("person_youth_group", []),
            )
            if invalid_responsibility_groups:
                return jsonify({
                    "error": "responsibility youth_group_id must match one of the person's youth-group memberships",
                    "invalid_youth_group_ids": invalid_responsibility_groups,
                }), 400

            def add_sub(sheet, rows):
                replace_profile_sub_rows(S.store, new_id, sheet, rows, compare_as_string=False)

            add_sub("nationality", body.get("nationality", []))
            add_sub("jobs", prepared_job_rows)
            add_sub("mobile_numbers", mobile_rows_payload)
            add_sub("emails", email_rows_payload)
            add_sub("social_media", body.get("social_media", []))
            add_sub("addresses", addresses_rows)
            add_sub("schools", body.get("schools", []))
            add_sub("higher_education", body.get("higher_education", []))
            add_sub("responsibilities", body.get("responsibilities", []))
            add_sub("person_youth_group", body.get("person_youth_group", []))
            add_sub("hobbies_skills", body.get("hobbies_skills", []))
            add_sub(S.PERSON_HEALTH_CONDITION_SHEET, body.get(S.PERSON_HEALTH_CONDITION_SHEET, []))
            add_sub(S.PERSON_SPECIAL_NOTE_SHEET, body.get(S.PERSON_SPECIAL_NOTE_SHEET, []))
            S.save()
        return jsonify({"ok": True, "person_id": new_id})

    @app.delete("/api/person/<int:pid>")
    def delete_person(pid):
        err = _require_admin()
        if err:
            return err
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
        err = _require_admin()
        if err:
            return err
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
        err = _require_admin()
        if err:
            return err
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
