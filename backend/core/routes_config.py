import os

from flask import jsonify, request

from core import state as S
from core.routes_auth import exports as auth_exports


def _config_path() -> str:
    return os.path.join(S.db.data_dir, "config.json")


def _clean_text(value):
    if value is None:
        return ""
    text = str(value).strip()
    if text in ("", "nan", "None", "null"):
        return ""
    return text


def _normalize_name_variations(raw):
    """
    Accepts both supported structures:
    - {"base": ["alt1", "alt2"]}
    - [{"name": "base", "variations": ["alt1"]}, ...]
    Returns canonical dict[str, list[str]].
    """
    result = {}
    if isinstance(raw, dict):
        items = raw.items()
    elif isinstance(raw, list):
        items = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            items.append((entry.get("name"), entry.get("variations", [])))
    else:
        items = []

    for base_raw, vars_raw in items:
        base = _clean_text(base_raw)
        if not base:
            continue

        if isinstance(vars_raw, str):
            vals = [vars_raw]
        elif isinstance(vars_raw, list):
            vals = vars_raw
        else:
            vals = []

        cleaned = []
        seen = set()
        for value in vals:
            text = _clean_text(value)
            if not text or text == base or text in seen:
                continue
            seen.add(text)
            cleaned.append(text)

        if base in result:
            existing = set(result[base])
            for value in cleaned:
                if value not in existing:
                    result[base].append(value)
                    existing.add(value)
        else:
            result[base] = cleaned

    return result


def _default_config():
    return {
        "name_variations": {},
    }


def _load_config():
    data = S.db.load_json_file(_config_path(), _default_config())
    if not isinstance(data, dict):
        data = _default_config()
    config = dict(data)
    config["name_variations"] = _normalize_name_variations(config.get("name_variations", {}))
    return config


def _save_config(config):
    payload = {
        "name_variations": _normalize_name_variations(config.get("name_variations", {})),
    }
    S.db.save_json_file(_config_path(), payload)
    return payload


def register_config_routes(app):
    @app.get("/api/config")
    def get_config():
        err = auth_exports["_require_auth"]()
        if err:
            return err
        return jsonify({"ok": True, "config": _load_config()})

    @app.put("/api/config")
    def put_config():
        err = auth_exports["_require_admin"]()
        if err:
            return err

        body = request.json or {}
        if not isinstance(body, dict):
            return jsonify({"error": "invalid payload"}), 400

        with S.lock:
            current = _load_config()
            merged = dict(current)
            if "name_variations" in body:
                merged["name_variations"] = _normalize_name_variations(body.get("name_variations"))
            saved = _save_config(merged)
        return jsonify({"ok": True, "config": saved})

    @app.put("/api/config/reset")
    def reset_config():
        err = auth_exports["_require_admin"]()
        if err:
            return err
        with S.lock:
            saved = _save_config(_default_config())
        return jsonify({"ok": True, "config": saved})

    @app.get("/api/config/youth-groups")
    def list_config_youth_groups_placeholder():
        return jsonify({"groups": []})

    @app.post("/api/config/youth-groups")
    def create_config_youth_groups_placeholder():
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.put("/api/config/youth-groups/<gid>")
    def update_config_youth_groups_placeholder(gid):
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.delete("/api/config/youth-groups/<gid>")
    def delete_config_youth_groups_placeholder(gid):
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.delete("/api/config/maintenance/notifications")
    def clear_notifications_placeholder():
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.delete("/api/config/maintenance/promotions")
    def clear_promotions_placeholder():
        return jsonify({"ok": False, "message": "Not implemented in this workspace snapshot"}), 501

    @app.post("/api/config/maintenance/reload")
    def reload_data_placeholder():
        return jsonify({"ok": True})
