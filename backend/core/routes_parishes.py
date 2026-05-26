import os
import pandas as pd

from flask import jsonify, request, send_from_directory

from core import state as S
from core.routes_auth import exports as auth_exports


PARISH_LOGOS_DIR = os.path.join(S.PHOTOS_ROOT_DIR, "logos", "parishes")
VALID_REGIONS = {"الشمال", "الوسط", "الجنوب"}
VALID_GOVERNORATES = {
    "عمان", "إربد", "الزرقاء", "البلقاء", "مادبا", "الكرك",
    "الطفيلة", "معان", "العقبة", "جرش", "عجلون", "المفرق",
}

SPECIAL_PARISHES = {
    "CH001": {
        S.PARISH_ID_COL: "PA001",
        "name": "رعية قلب مريم الطاهر - الفحيص",
        "area": "الفحيص",
        "member_church_ids": {"CH001", "CH015"},
    },
    "CH029": {
        S.PARISH_ID_COL: "PA029",
        "name": "رعية قطع رأس يوحنا المعمدان - مادبا",
        "area": "مادبا",
        "member_church_ids": {"CH029", "CH030"},
    },
}

os.makedirs(PARISH_LOGOS_DIR, exist_ok=True)


def _parish_logo_filename(parish_id: str):
    pid = _clean_text(parish_id)
    if not pid:
        return None
    for ext in S.ALLOWED_EXTENSIONS:
        filename = f"{pid}.{ext}"
        path = os.path.join(PARISH_LOGOS_DIR, filename)
        if os.path.exists(path):
            return filename
    return None


def _parishes_with_logos(parishes: list[dict]) -> list[dict]:
    out = []
    for parish in parishes:
        pid = _clean_text(parish.get(S.PARISH_ID_COL) or parish.get("id"))
        logo_url = f"/api/parishes/{pid}/logo" if _parish_logo_filename(pid) else None
        out.append({**parish, S.PARISH_ID_COL: pid, "id": pid, "logo_url": logo_url})
    return out


def _parish_id_value(parish: dict | None) -> str:
    row = parish if isinstance(parish, dict) else {}
    return _clean_text(row.get(S.PARISH_ID_COL) or row.get("id"))


def _church_id_value(church: dict | None) -> str:
    row = church if isinstance(church, dict) else {}
    return _clean_text(row.get(S.CHURCH_ID_COL) or row.get("id"))


def _changed_by_from_current_user() -> str:
    user = auth_exports["_current_user"]()
    if not user or user.get("role") == "admin":
        return "admin"
    person_id = user.get("person_id")
    return str(person_id) if person_id is not None and str(person_id).strip() else "admin"


def _youth_groups_by_parish() -> dict[str, list[dict]]:
    yg = S._scd_filter_active(S.store.get(S.YOUTH_GROUP_SHEET, pd.DataFrame()).copy())
    if yg.empty:
        return {}
    if S.YOUTH_GROUP_ID_COL not in yg.columns or S.YOUTH_GROUP_PARISH_ID_COL not in yg.columns:
        return {}

    out: dict[str, list[dict]] = {}
    for row in yg.replace({pd.NA: None}).to_dict(orient="records"):
        parish_id = _clean_text(row.get(S.YOUTH_GROUP_PARISH_ID_COL))
        group_id = _clean_text(row.get(S.YOUTH_GROUP_ID_COL))
        if not parish_id or not group_id:
            continue

        group_name = _clean_text(S.youth_group_name(group_id) or group_id)
        out.setdefault(parish_id, []).append({
            "group_id": group_id,
            "group_name": group_name,
        })

    for parish_id in out:
        out[parish_id].sort(key=lambda g: _clean_text(g.get("group_name")))
    return out


def _clean_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text in ("", "nan", "None", "null"):
        return ""
    return text


def _to_float(value):
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "nan", "None", "null"):
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _clean_url(value) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return ""


def _clean_region(value) -> str:
    text = _clean_text(value)
    return text if text in VALID_REGIONS else ""


def _clean_governorate(value) -> str:
    text = _clean_text(value)
    return text if text in VALID_GOVERNORATES else ""


def _church_id_key(church: dict) -> int:
    cid = _church_id_value(church)
    digits = "".join(ch for ch in cid if ch.isdigit())
    if not digits:
        return 0
    try:
        return int(digits)
    except ValueError:
        return 0


def _next_church_id(churches: list[dict]) -> str:
    max_num = 0
    for church in churches:
        max_num = max(max_num, _church_id_key(church))
    return f"CH{max_num + 1:03d}"


def _parish_id_key(parish: dict) -> int:
    pid = _parish_id_value(parish)
    digits = "".join(ch for ch in pid if ch.isdigit())
    if not digits:
        return 0
    try:
        return int(digits)
    except ValueError:
        return 0


def _next_parish_id(parishes: list[dict]) -> str:
    max_num = 0
    for parish in parishes:
        max_num = max(max_num, _parish_id_key(parish))
    return f"PA{max_num + 1:03d}"


def _parish_name_from_fields(patron_saint: str, area: str) -> str:
    return f"رعية {patron_saint} - {area}"


def _church_special_parish(church_row: dict):
    cid = _church_id_value(church_row)
    if cid in {"CH001", "CH015"}:
        return SPECIAL_PARISHES["CH001"]
    if cid in {"CH029", "CH030"}:
        return SPECIAL_PARISHES["CH029"]
    return None


def _normalize_church_rows(rows, valid_parish_ids: set[str]) -> list[dict]:
    if not isinstance(rows, list):
        rows = []

    cleaned = []
    for idx, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue

        patron = _clean_text(row.get("patron_saint"))
        area = _clean_text(row.get("area"))
        lat = _to_float(row.get("lat"))
        lng = _to_float(row.get("lng"))
        parish_id = _clean_text(row.get("parish_id"))
        if not patron or not area or lat is None or lng is None or parish_id not in valid_parish_ids:
            continue

        cid = _church_id_value(row)
        num = _church_id_key({S.CHURCH_ID_COL: cid})
        if num <= 0:
            num = idx
        cid = f"CH{num:03d}"

        cleaned.append({
            S.CHURCH_ID_COL: cid,
            S.PARISH_ID_COL: parish_id,
            "patron_saint": patron,
            "area": area,
            "lat": lat,
            "lng": lng,
        })

    cleaned.sort(key=_church_id_key)

    # Ensure IDs are unique after normalization.
    seen = set()
    next_num = 1
    normalized = []
    for row in cleaned:
        cid = row[S.CHURCH_ID_COL]
        if cid in seen:
            while f"CH{next_num:03d}" in seen:
                next_num += 1
            cid = f"CH{next_num:03d}"
        seen.add(cid)
        normalized.append({**row, S.CHURCH_ID_COL: cid, "id": cid})

    normalized.sort(key=_church_id_key)
    return normalized


def _normalize_parish_rows(rows) -> list[dict]:
    if not isinstance(rows, list):
        rows = []

    cleaned = []
    for idx, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue

        patron = _clean_text(row.get("patron_saint"))
        area = _clean_text(row.get("area"))
        name = _parish_name_from_fields(patron, area) if patron and area else ""

        lpj_url = _clean_url(row.get("lpj_url"))
        facebook_url = _clean_url(row.get("facebook_url"))
        instagram_url = _clean_url(row.get("instagram_url"))
        linkedin_url = _clean_url(row.get("linkedin_url"))
        region = _clean_region(row.get("region"))
        governorate = _clean_governorate(row.get("governorate"))
        if not patron or not area or not name:
            continue

        pid = _parish_id_value(row)
        num = _parish_id_key({S.PARISH_ID_COL: pid})
        if num <= 0:
            num = idx
        pid = f"PA{num:03d}"

        cleaned.append({
            S.PARISH_ID_COL: pid,
            "name": name,
            "patron_saint": patron,
            "area": area,
            "lpj_url": lpj_url,
            "facebook_url": facebook_url,
            "instagram_url": instagram_url,
            "linkedin_url": linkedin_url,
            "region": region,
            "governorate": governorate,
        })

    cleaned.sort(key=_parish_id_key)

    seen = set()
    next_num = 1
    normalized = []
    for row in cleaned:
        pid = row[S.PARISH_ID_COL]
        if pid in seen:
            while f"PA{next_num:03d}" in seen:
                next_num += 1
            pid = f"PA{next_num:03d}"
        seen.add(pid)
        normalized.append({**row, S.PARISH_ID_COL: pid, "id": pid})

    normalized.sort(key=_parish_id_key)
    return normalized


def _build_parishes_from_flat_rows(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    parishes = []
    churches = []
    parish_by_key = {}

    for row in rows:
        if not isinstance(row, dict):
            continue

        cid = _church_id_value(row)
        patron = _clean_text(row.get("patron_saint"))
        area = _clean_text(row.get("area"))
        lat = _to_float(row.get("lat"))
        lng = _to_float(row.get("lng"))
        lpj_url = _clean_url(row.get("lpj_url"))
        facebook_url = _clean_url(row.get("facebook_url"))
        instagram_url = _clean_url(row.get("instagram_url"))
        region = _clean_region(row.get("region"))
        governorate = _clean_governorate(row.get("governorate"))
        if not patron or not area or lat is None or lng is None:
            continue

        special = _church_special_parish({S.CHURCH_ID_COL: cid})
        if special:
            pkey = special[S.PARISH_ID_COL]
            pid = special[S.PARISH_ID_COL]
            pname = special["name"]
            parea = special["area"]
        else:
            pkey = f"{patron}::{area}"
            pid = ""
            pname = _parish_name_from_fields(patron, area)
            parea = area

        if pkey not in parish_by_key:
            parish_by_key[pkey] = {
                S.PARISH_ID_COL: pid,
                "name": pname,
                "patron_saint": patron,
                "area": parea,
                "lpj_url": lpj_url,
                "facebook_url": facebook_url,
                "instagram_url": instagram_url,
                "region": region,
                "governorate": governorate,
            }
            parishes.append(parish_by_key[pkey])
        elif lpj_url and not parish_by_key[pkey].get("lpj_url"):
            parish_by_key[pkey]["lpj_url"] = lpj_url

        churches.append({
            S.CHURCH_ID_COL: cid,
            S.PARISH_ID_COL: pkey,
            "patron_saint": patron,
            "area": area,
            "lat": lat,
            "lng": lng,
        })

    normalized_parishes = _normalize_parish_rows(parishes)

    # Assign generated IDs back to churches by temporary pkey.
    pkey_to_pid = {}
    for p in normalized_parishes:
        parish_id = _parish_id_value(p)
        if parish_id in {"PA001", "PA029"}:
            pkey_to_pid[parish_id] = parish_id
        else:
            pkey = f"{p.get('patron_saint', '')}::{p.get('area', '')}"
            pkey_to_pid[pkey] = parish_id

    mapped_churches = []
    for c in churches:
        key = c.get(S.PARISH_ID_COL)
        pid = pkey_to_pid.get(key, key if key in pkey_to_pid else "")
        mapped_churches.append({**c, S.PARISH_ID_COL: pid, "parish_id": pid})

    valid_parish_ids = {_parish_id_value(p) for p in normalized_parishes}
    normalized_churches = _normalize_church_rows(mapped_churches, valid_parish_ids)
    return normalized_parishes, normalized_churches


def _normalize_payload(payload) -> dict:
    if not isinstance(payload, dict):
        payload = {}

    # New shape takes precedence.
    if isinstance(payload.get("parishes"), list) and isinstance(payload.get("churches"), list):
        parishes = _normalize_parish_rows(payload.get("parishes", []))
        valid_parish_ids = {_parish_id_value(p) for p in parishes}
        churches = _normalize_church_rows(payload.get("churches", []), valid_parish_ids)
        return {"parishes": parishes, "churches": churches}

    # Flat shape: only churches list with per-church lpj_url.
    flat_rows = payload.get("churches", []) if isinstance(payload.get("churches"), list) else []
    return dict(zip(["parishes", "churches"], _build_parishes_from_flat_rows(flat_rows)))


def _parish_rows_df(rows: list[dict]) -> pd.DataFrame:
    normalized = _normalize_parish_rows(rows)
    pared = []
    for row in normalized:
        pared.append({col: row.get(col, "") for col in S.PARISH_COLUMNS})
    return pd.DataFrame(pared, columns=S.PARISH_COLUMNS)


def _church_rows_df(rows: list[dict], valid_parish_ids: set[str]) -> pd.DataFrame:
    normalized = _normalize_church_rows(rows, valid_parish_ids)
    pared = []
    for row in normalized:
        pared.append({col: row.get(col) for col in S.CHURCH_COLUMNS})
    return pd.DataFrame(pared, columns=S.CHURCH_COLUMNS)


def _ensure_church_sheets() -> None:
    parishes_df = S._scd_filter_active(S.store.get(S.PARISH_SHEET, pd.DataFrame()).copy())
    churches_df = S._scd_filter_active(S.store.get(S.CHURCH_SHEET, pd.DataFrame()).copy())

    if parishes_df.empty:
        parishes_df = pd.DataFrame(columns=S.PARISH_COLUMNS)
    if churches_df.empty:
        churches_df = pd.DataFrame(columns=S.CHURCH_COLUMNS)

    for col in S.PARISH_COLUMNS:
        if col not in parishes_df.columns:
            parishes_df[col] = None
    for col in S.CHURCH_COLUMNS:
        if col not in churches_df.columns:
            churches_df[col] = None

    parish_rows = parishes_df[S.PARISH_COLUMNS].where(pd.notna(parishes_df[S.PARISH_COLUMNS]), None).to_dict(orient="records")
    normalized_parishes = _normalize_parish_rows(parish_rows)
    valid_parish_ids = {_parish_id_value(row) for row in normalized_parishes}
    church_rows = churches_df[S.CHURCH_COLUMNS].where(pd.notna(churches_df[S.CHURCH_COLUMNS]), None).to_dict(orient="records")
    normalized_churches = _normalize_church_rows(church_rows, valid_parish_ids)

    S._scd_replace_rows_by_key(
        S.store,
        S.PARISH_SHEET,
        _parish_rows_df(normalized_parishes).replace({pd.NA: None}).to_dict(orient="records"),
        S.PARISH_COLUMNS,
        [S.PARISH_ID_COL],
        changed_by="admin",
    )
    S._scd_replace_rows_by_key(
        S.store,
        S.CHURCH_SHEET,
        _church_rows_df(normalized_churches, valid_parish_ids).replace({pd.NA: None}).to_dict(orient="records"),
        S.CHURCH_COLUMNS,
        [S.CHURCH_ID_COL],
        changed_by="admin",
    )


def _load_payload() -> dict:
    _ensure_church_sheets()
    parishes_df = S._scd_filter_active(S.store.get(S.PARISH_SHEET, pd.DataFrame()).copy())
    churches_df = S._scd_filter_active(S.store.get(S.CHURCH_SHEET, pd.DataFrame()).copy())

    parishes = _normalize_parish_rows(
        parishes_df[S.PARISH_COLUMNS].where(pd.notna(parishes_df[S.PARISH_COLUMNS]), None).to_dict(orient="records")
        if not parishes_df.empty else []
    )
    valid_parish_ids = {_parish_id_value(row) for row in parishes}
    churches = _normalize_church_rows(
        churches_df[S.CHURCH_COLUMNS].where(pd.notna(churches_df[S.CHURCH_COLUMNS]), None).to_dict(orient="records")
        if not churches_df.empty else [],
        valid_parish_ids,
    )
    return {"parishes": parishes, "churches": churches}


def _save_payload(payload: dict, *, changed_by: str = "admin"):
    normalized = _normalize_payload(payload)
    valid_parish_ids = {_parish_id_value(row) for row in normalized["parishes"]}
    S._scd_replace_rows_by_key(
        S.store,
        S.PARISH_SHEET,
        _parish_rows_df(normalized["parishes"]).replace({pd.NA: None}).to_dict(orient="records"),
        S.PARISH_COLUMNS,
        [S.PARISH_ID_COL],
        changed_by=changed_by,
    )
    S._scd_replace_rows_by_key(
        S.store,
        S.CHURCH_SHEET,
        _church_rows_df(normalized["churches"], valid_parish_ids).replace({pd.NA: None}).to_dict(orient="records"),
        S.CHURCH_COLUMNS,
        [S.CHURCH_ID_COL],
        changed_by=changed_by,
    )
    S.db.save_excel_sheets(S.store)


def register_churches_routes(app):
    @app.get("/api/churches")
    def list_churches():
        err = auth_exports["_require_auth"]()
        if err:
            return err
        payload = _load_payload()
        parish_by_id = {_parish_id_value(p): p for p in payload["parishes"]}
        youth_groups_by_parish = _youth_groups_by_parish()
        churches = []
        for church in payload["churches"]:
            parish = parish_by_id.get(church.get("parish_id"), {})
            parish_id = _parish_id_value(parish)
            churches.append({
                **church,
                S.CHURCH_ID_COL: _church_id_value(church),
                "id": _church_id_value(church),
                "parish_name": _clean_text(parish.get("name")),
                "parish_lpj_url": _clean_url(parish.get("lpj_url")),
                "parish_facebook_url": _clean_url(parish.get("facebook_url")),
                "parish_instagram_url": _clean_url(parish.get("instagram_url")),
                "parish_logo_url": f"/api/parishes/{parish_id}/logo" if _parish_logo_filename(parish_id) else None,
                "parish_youth_groups": youth_groups_by_parish.get(parish_id, []),
                "region": _clean_region(parish.get("region")),
                "governorate": _clean_governorate(parish.get("governorate")),
            })
        return jsonify({"churches": churches, "parishes": _parishes_with_logos(payload["parishes"])})

    @app.get("/api/parishes")
    def list_parishes():
        err = auth_exports["_require_admin"]()
        if err:
            return err
        payload = _load_payload()
        return jsonify({"parishes": _parishes_with_logos(payload["parishes"])})

    @app.post("/api/parishes")
    def create_parish():
        err = auth_exports["_require_admin"]()
        if err:
            return err

        body = request.json or {}
        patron = _clean_text(body.get("patron_saint"))
        area = _clean_text(body.get("area"))
        lpj_url = _clean_url(body.get("lpj_url"))
        facebook_url = _clean_url(body.get("facebook_url"))
        instagram_url = _clean_url(body.get("instagram_url"))
        linkedin_url = _clean_url(body.get("linkedin_url"))
        region = _clean_region(body.get("region"))
        governorate = _clean_governorate(body.get("governorate"))

        if not patron or not area:
            return jsonify({"error": "patron_saint and area are required"}), 400
        if not region:
            return jsonify({"error": "region is required and must be one of: الشمال، الوسط، الجنوب"}), 400
        if not governorate:
            return jsonify({"error": "governorate is required and must be a valid Jordanian governorate"}), 400

        with S.lock:
            payload = _load_payload()
            parishes = payload["parishes"]
            parish = {
                S.PARISH_ID_COL: _next_parish_id(parishes),
                "name": _parish_name_from_fields(patron, area),
                "patron_saint": patron,
                "area": area,
                "lpj_url": lpj_url,
                "facebook_url": facebook_url,
                "instagram_url": instagram_url,
                "linkedin_url": linkedin_url,
                "region": region,
                "governorate": governorate,
            }
            parishes.append(parish)
            _save_payload({"parishes": parishes, "churches": payload["churches"]}, changed_by=_changed_by_from_current_user())

        parish_id_value = _parish_id_value(parish)
        logo_url = f"/api/parishes/{parish_id_value}/logo" if _parish_logo_filename(parish_id_value) else None
        return jsonify({"ok": True, "parish": {**parish, S.PARISH_ID_COL: parish_id_value, "id": parish_id_value, "logo_url": logo_url}})

    @app.delete("/api/parishes/<parish_id>")
    def delete_parish(parish_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        target = _clean_text(parish_id)
        if not target:
            return jsonify({"error": "invalid parish id"}), 400

        with S.lock:
            payload = _load_payload()
            parishes = payload["parishes"]
            churches = payload["churches"]

            if any(_clean_text(c.get("parish_id")) == target for c in churches):
                return jsonify({"error": "cannot delete parish with linked churches"}), 400

            next_rows = [p for p in parishes if _parish_id_value(p) != target]
            if len(next_rows) == len(parishes):
                return jsonify({"error": "not found"}), 404
            _save_payload({"parishes": next_rows, "churches": churches}, changed_by=_changed_by_from_current_user())

        return jsonify({"ok": True})

    @app.put("/api/parishes/<parish_id>")
    def update_parish(parish_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        target = _clean_text(parish_id)
        if not target:
            return jsonify({"error": "invalid parish id"}), 400

        body = request.json or {}
        patron = _clean_text(body.get("patron_saint"))
        area = _clean_text(body.get("area"))
        lpj_url = _clean_url(body.get("lpj_url"))
        facebook_url = _clean_url(body.get("facebook_url"))
        instagram_url = _clean_url(body.get("instagram_url"))
        linkedin_url = _clean_url(body.get("linkedin_url"))
        region = _clean_region(body.get("region"))
        governorate = _clean_governorate(body.get("governorate"))

        if not patron or not area:
            return jsonify({"error": "patron_saint and area are required"}), 400
        if not region:
            return jsonify({"error": "region is required and must be one of: الشمال، الوسط، الجنوب"}), 400
        if not governorate:
            return jsonify({"error": "governorate is required and must be a valid Jordanian governorate"}), 400

        with S.lock:
            payload = _load_payload()
            parishes = payload["parishes"]
            idx = next((i for i, p in enumerate(parishes) if _parish_id_value(p) == target), None)
            if idx is None:
                return jsonify({"error": "not found"}), 404

            updated = {
                S.PARISH_ID_COL: target,
                "name": _parish_name_from_fields(patron, area),
                "patron_saint": patron,
                "area": area,
                "lpj_url": lpj_url,
                "facebook_url": facebook_url,
                "instagram_url": instagram_url,
                "linkedin_url": linkedin_url,
                "region": region,
                "governorate": governorate,
            }
            parishes[idx] = updated
            _save_payload({"parishes": parishes, "churches": payload["churches"]}, changed_by=_changed_by_from_current_user())

        updated_parish_id = _parish_id_value(updated)
        logo_url = f"/api/parishes/{updated_parish_id}/logo" if _parish_logo_filename(updated_parish_id) else None
        return jsonify({"ok": True, "parish": {**updated, S.PARISH_ID_COL: updated_parish_id, "id": updated_parish_id, "logo_url": logo_url}})

    @app.post("/api/churches")
    def create_church():
        err = auth_exports["_require_admin"]()
        if err:
            return err

        body = request.json or {}
        parish_id = _clean_text(body.get("parish_id"))
        patron = _clean_text(body.get("patron_saint"))
        area = _clean_text(body.get("area"))
        lat = _to_float(body.get("lat"))
        lng = _to_float(body.get("lng"))

        if not parish_id or not patron or not area:
            return jsonify({"error": "parish_id, patron_saint and area are required"}), 400
        if lat is None or lng is None:
            return jsonify({"error": "lat and lng are required"}), 400
        if lat < -90 or lat > 90:
            return jsonify({"error": "lat out of range"}), 400
        if lng < -180 or lng > 180:
            return jsonify({"error": "lng out of range"}), 400

        with S.lock:
            payload = _load_payload()
            churches = payload["churches"]
            parishes = payload["parishes"]
            parish_by_id = {_parish_id_value(p): p for p in parishes}
            parish = parish_by_id.get(parish_id)
            if parish is None:
                return jsonify({"error": "invalid parish_id"}), 400

            church = {
                S.CHURCH_ID_COL: _next_church_id(churches),
                S.PARISH_ID_COL: parish_id,
                "patron_saint": patron,
                "area": area,
                "lat": lat,
                "lng": lng,
            }
            churches.append(church)
            _save_payload({"parishes": parishes, "churches": churches}, changed_by=_changed_by_from_current_user())

        response_church = {
            **church,
            S.CHURCH_ID_COL: _church_id_value(church),
            "id": _church_id_value(church),
            "parish_name": _clean_text(parish.get("name")),
            "parish_lpj_url": _clean_url(parish.get("lpj_url")),
            "parish_facebook_url": _clean_url(parish.get("facebook_url")),
            "parish_instagram_url": _clean_url(parish.get("instagram_url")),
            "parish_logo_url": f"/api/parishes/{parish_id}/logo" if _parish_logo_filename(parish_id) else None,
            "parish_youth_groups": _youth_groups_by_parish().get(parish_id, []),
            "region": _clean_region(parish.get("region")),
            "governorate": _clean_governorate(parish.get("governorate")),
        }
        return jsonify({"ok": True, "church": response_church})

    @app.delete("/api/churches/<church_id>")
    def delete_church(church_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        target = _clean_text(church_id)
        if not target:
            return jsonify({"error": "invalid church id"}), 400

        with S.lock:
            payload = _load_payload()
            churches = payload["churches"]
            next_rows = [c for c in churches if _church_id_value(c) != target]
            if len(next_rows) == len(churches):
                return jsonify({"error": "not found"}), 404
            _save_payload({"parishes": payload["parishes"], "churches": next_rows}, changed_by=_changed_by_from_current_user())

        return jsonify({"ok": True})

    @app.put("/api/churches/<church_id>")
    def update_church(church_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        target = _clean_text(church_id)
        if not target:
            return jsonify({"error": "invalid church id"}), 400

        body = request.json or {}
        parish_id = _clean_text(body.get("parish_id"))
        patron = _clean_text(body.get("patron_saint"))
        area = _clean_text(body.get("area"))
        lat = _to_float(body.get("lat"))
        lng = _to_float(body.get("lng"))

        if not parish_id or not patron or not area:
            return jsonify({"error": "parish_id, patron_saint and area are required"}), 400
        if lat is None or lng is None:
            return jsonify({"error": "lat and lng are required"}), 400
        if lat < -90 or lat > 90:
            return jsonify({"error": "lat out of range"}), 400
        if lng < -180 or lng > 180:
            return jsonify({"error": "lng out of range"}), 400

        with S.lock:
            payload = _load_payload()
            churches = payload["churches"]
            parishes = payload["parishes"]
            parish_by_id = {_parish_id_value(p): p for p in parishes}
            parish = parish_by_id.get(parish_id)
            if parish is None:
                return jsonify({"error": "invalid parish_id"}), 400

            idx = next((i for i, c in enumerate(churches) if _church_id_value(c) == target), None)
            if idx is None:
                return jsonify({"error": "not found"}), 404

            church = {
                S.CHURCH_ID_COL: target,
                S.PARISH_ID_COL: parish_id,
                "patron_saint": patron,
                "area": area,
                "lat": lat,
                "lng": lng,
            }
            churches[idx] = church
            _save_payload({"parishes": parishes, "churches": churches}, changed_by=_changed_by_from_current_user())

        response_church = {
            **church,
            S.CHURCH_ID_COL: _church_id_value(church),
            "id": _church_id_value(church),
            "parish_name": _clean_text(parish.get("name")),
            "parish_lpj_url": _clean_url(parish.get("lpj_url")),
            "parish_facebook_url": _clean_url(parish.get("facebook_url")),
            "parish_instagram_url": _clean_url(parish.get("instagram_url")),
            "parish_logo_url": f"/api/parishes/{parish_id}/logo" if _parish_logo_filename(parish_id) else None,
            "parish_youth_groups": _youth_groups_by_parish().get(parish_id, []),
            "region": _clean_region(parish.get("region")),
            "governorate": _clean_governorate(parish.get("governorate")),
        }
        return jsonify({"ok": True, "church": response_church})

    @app.post("/api/parishes/<parish_id>/logo")
    def upload_parish_logo(parish_id):
        err = auth_exports["_require_admin"]()
        if err:
            return err

        target = _clean_text(parish_id)
        if not target:
            return jsonify({"error": "invalid parish id"}), 400

        payload = _load_payload()
        if not any(_parish_id_value(p) == target for p in payload["parishes"]):
            return jsonify({"error": "not found"}), 404

        if "logo" not in request.files:
            return jsonify({"error": "no file"}), 400

        file = request.files["logo"]
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in S.ALLOWED_EXTENSIONS:
            return jsonify({"error": "unsupported file type"}), 400

        os.makedirs(PARISH_LOGOS_DIR, exist_ok=True)
        for old_ext in S.ALLOWED_EXTENSIONS:
            old = os.path.join(PARISH_LOGOS_DIR, f"{target}.{old_ext}")
            if os.path.exists(old):
                os.remove(old)

        dest_name = f"{target}.{ext}"
        file.save(os.path.join(PARISH_LOGOS_DIR, dest_name))

        return jsonify({"ok": True, "logo_url": f"/api/parishes/{target}/logo"})

    @app.get("/api/parishes/<parish_id>/logo")
    def serve_parish_logo(parish_id):
        target = _clean_text(parish_id)
        if not target:
            return jsonify({"error": "invalid parish id"}), 400
        logo_name = _parish_logo_filename(target)
        if not logo_name:
            return jsonify({"error": "not found"}), 404
        return send_from_directory(PARISH_LOGOS_DIR, logo_name)


def register_parishes_routes(app):
    # Backward-compatible alias for any stale imports.
    return register_churches_routes(app)
