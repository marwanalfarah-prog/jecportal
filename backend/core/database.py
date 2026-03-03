import json
import os
import re
import secrets
from typing import Any

import pandas as pd


class Database:
    def __init__(self, backend_file: str):
        self.backend_dir = os.path.dirname(backend_file)
        self.workspace_dir = os.path.abspath(os.path.join(self.backend_dir, ".."))
        self.data_dir = os.path.join(self.backend_dir, "data")

        self.secret_key_path = os.path.join(self.data_dir, ".secret_key")
        self.excel_path = os.path.join(self.data_dir, "JECJordanData.xlsx")

        self.photos_root_dir = os.path.join(self.data_dir, "photos")
        self.profile_pictures_dir = os.path.join(self.photos_root_dir, "profile_pictures")
        self.photos_dir = self.profile_pictures_dir
        self.org_trees_dir = os.path.join(self.data_dir, "org_trees")

        self.auth_sheet = "auth_users"
        self.auth_columns = ["person_id", "username", "password_hash", "role"]
        self.legacy_auth_path = os.path.join(self.data_dir, "auth_users.json")
        self.promotions_path = os.path.join(self.data_dir, "promotions.json")
        self.questionnaires_path = os.path.join(self.data_dir, "questionnaires.json")
        self.notifications_path = os.path.join(self.data_dir, "notifications.json")

        self.ensure_directories()

    def ensure_directories(self):
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.photos_root_dir, exist_ok=True)
        os.makedirs(self.profile_pictures_dir, exist_ok=True)
        os.makedirs(self.org_trees_dir, exist_ok=True)

    def get_or_create_secret_key(self) -> str:
        if "JEC_SECRET_KEY" in os.environ:
            return os.environ["JEC_SECRET_KEY"]
        if os.path.exists(self.secret_key_path):
            with open(self.secret_key_path, encoding="utf-8") as f:
                key = f.read().strip()
                if key:
                    return key
        key = secrets.token_hex(32)
        with open(self.secret_key_path, "w", encoding="utf-8") as f:
            f.write(key)
        return key

    def load_excel_sheets(self, sheets: list[str]) -> dict[str, pd.DataFrame]:
        store: dict[str, pd.DataFrame] = {}
        xf = pd.ExcelFile(self.excel_path)
        for sheet in sheets:
            if sheet in xf.sheet_names:
                dtype_overrides = {}
                if sheet == "persons":
                    dtype_overrides = {"birth_date": str, "birth_year": str}
                store[sheet] = xf.parse(sheet, dtype=dtype_overrides)
        return store

    def save_excel_sheets(self, store: dict[str, pd.DataFrame]):
        with pd.ExcelWriter(self.excel_path, engine="openpyxl") as writer:
            for sheet, df in store.items():
                df.to_excel(writer, sheet_name=sheet, index=False)

    def load_json_file(self, path: str, default: Any):
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        return default

    def save_json_file(self, path: str, data: Any):
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _normalize_auth_person_id(self, value):
        if value is None:
            return None
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            if text.isdigit():
                return int(text)
            return text
        return value

    def _auth_users_from_df(self, df: pd.DataFrame) -> list[dict]:
        if df.empty:
            return []
        for col in self.auth_columns:
            if col not in df.columns:
                df[col] = None
        users = []
        for row in df[self.auth_columns].replace({pd.NA: None}).to_dict(orient="records"):
            username = (str(row.get("username") or "")).strip().lower()
            password_hash = str(row.get("password_hash") or "").strip()
            role = str(row.get("role") or "member").strip() or "member"
            person_id = self._normalize_auth_person_id(row.get("person_id"))
            if not username or not password_hash:
                continue
            users.append({
                "person_id": person_id,
                "username": username,
                "password_hash": password_hash,
                "role": role,
            })
        return users

    def load_auth(self) -> dict:
        users: list[dict] = []

        if os.path.exists(self.excel_path):
            xf = pd.ExcelFile(self.excel_path)
            if self.auth_sheet in xf.sheet_names:
                df = xf.parse(self.auth_sheet, dtype={"person_id": str, "username": str, "password_hash": str, "role": str})
                users = self._auth_users_from_df(df)

        if not users and os.path.exists(self.legacy_auth_path):
            legacy = self.load_json_file(self.legacy_auth_path, {"users": []})
            for row in legacy.get("users", []):
                username = (str(row.get("username") or "")).strip().lower()
                password_hash = str(row.get("password_hash") or "").strip()
                role = str(row.get("role") or "member").strip() or "member"
                person_id = self._normalize_auth_person_id(row.get("person_id"))
                if not username or not password_hash:
                    continue
                users.append({
                    "person_id": person_id,
                    "username": username,
                    "password_hash": password_hash,
                    "role": role,
                })
            if users:
                self.save_auth({"users": users})
                try:
                    os.remove(self.legacy_auth_path)
                except OSError:
                    pass

        return {"users": users}

    def save_auth(self, data: dict):
        users = []
        for row in data.get("users", []):
            username = (str(row.get("username") or "")).strip().lower()
            password_hash = str(row.get("password_hash") or "").strip()
            role = str(row.get("role") or "member").strip() or "member"
            person_id = self._normalize_auth_person_id(row.get("person_id"))
            if not username or not password_hash:
                continue
            users.append({
                "person_id": person_id,
                "username": username,
                "password_hash": password_hash,
                "role": role,
            })

        df = pd.DataFrame(users, columns=self.auth_columns)
        if os.path.exists(self.excel_path):
            with pd.ExcelWriter(self.excel_path, engine="openpyxl", mode="a", if_sheet_exists="replace") as writer:
                df.to_excel(writer, sheet_name=self.auth_sheet, index=False)
        else:
            with pd.ExcelWriter(self.excel_path, engine="openpyxl") as writer:
                df.to_excel(writer, sheet_name=self.auth_sheet, index=False)

    def load_promotions(self) -> dict:
        return self.load_json_file(self.promotions_path, {"promotions": []})

    def save_promotions(self, data: dict):
        self.save_json_file(self.promotions_path, data)

    def load_questionnaires(self) -> dict:
        return self.load_json_file(self.questionnaires_path, {"questionnaires": [], "responses": []})

    def save_questionnaires(self, data: dict):
        self.save_json_file(self.questionnaires_path, data)

    def load_notifications(self) -> dict:
        return self.load_json_file(self.notifications_path, {"notifications": []})

    def save_notifications(self, data: dict):
        self.save_json_file(self.notifications_path, data)

    def group_dir(self, group_name: str) -> str:
        safe = re.sub(r"[^\w\u0600-\u06FF]", "_", group_name)
        return os.path.join(self.org_trees_dir, safe)

    def index_path(self, group_name: str) -> str:
        return os.path.join(self.group_dir(group_name), "index.json")

    def period_path(self, group_name: str, period_id: str) -> str:
        safe_id = re.sub(r"[^\w\-]", "_", period_id)
        return os.path.join(self.group_dir(group_name), f"{safe_id}.json")

    def legacy_group_path(self, group_name: str) -> str:
        safe = re.sub(r"[^\w\u0600-\u06FF]", "_", group_name)
        return os.path.join(self.org_trees_dir, f"{safe}.json")

    def get_photo_path(self, person_id, allowed_extensions: set[str]):
        for ext in allowed_extensions:
            path = os.path.join(self.photos_dir, f"{person_id}.{ext}")
            if os.path.exists(path):
                return path, ext
        return None, None

    def get_unregistered_photo_path(self, uid, allowed_extensions: set[str]):
        for ext in allowed_extensions:
            path = os.path.join(self.photos_dir, f"{uid}.{ext}")
            if os.path.exists(path):
                return path, ext
        return None, None
