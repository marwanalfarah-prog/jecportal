import json
import os
import re
import secrets
import shutil
import tempfile
import zipfile
from typing import Any

import pandas as pd


WORKBOOK_COLUMN_RENAMES: dict[str, dict[str, str]] = {
    "persons": {
        "first_name": "ar_first_name",
        "second_name": "ar_second_name",
        "third_name": "ar_third_name",
        "last_name": "ar_last_name",
        "english_first_name": "en_first_name",
        "english_second_name": "en_second_name",
        "english_third_name": "en_third_name",
        "english_last_name": "en_last_name",
        "mother_first_name": "mother_ar_first_name",
        "mother_second_name": "mother_ar_second_name",
        "mother_third_name": "mother_ar_last_name",
        "mother_english_first_name": "mother_en_first_name",
        "mother_english_second_name": "mother_en_second_name",
        "mother_english_third_name": "mother_en_last_name",
        "mother_ar_third_name": "mother_ar_last_name",
        "mother_en_third_name": "mother_en_last_name",
    },
    "mobile_numbers": {
        "type": "mobile_number_type",
    },
    "schools": {
        "school": "school_name",
    },
    "higher_education": {
        "university_college": "institution_name",
        "state": "education_state",
    },
    "jobs": {
        "company": "employer_name",
        "state": "employment_state",
    },
    "responsibilities": {
        "responsibility": "responsibility_name",
    },
    "person_health_conditions": {
        "type": "condition_type",
    },
    "addresses": {
        "address": "street_address",
    },
    "emails": {
        "type": "email_type",
    },
    "school_logos": {
        "id": "school_logo_id",
        "type": "institution_type",
        "name": "institution_name",
        "section": "institution_section",
    },
    "parishes": {
        "id": "parish_id",
    },
    "churches": {
        "id": "church_id",
    },
    "youth_group_social_media": {
        "id": "youth_group_social_media_id",
    },
    "youth_group_special_logos": {
        "id": "special_logo_id",
        "file_name": "logo_file_name",
    },
}


class Database:
    person_sheet_address_projection_columns = (
        "country", "governorate", "city", "address", "street_address", "lat", "lng",
    )

    def __init__(self, backend_file: str):
        self.backend_dir = os.path.dirname(backend_file)
        self.workspace_dir = os.path.abspath(os.path.join(self.backend_dir, ".."))
        self.data_dir = os.path.join(self.workspace_dir, "data")

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

    def _open_excel_file(self) -> tuple[pd.ExcelFile, str]:
        if not os.path.exists(self.excel_path):
            raise zipfile.BadZipFile("Unable to open Excel workbook.")
        try:
            return pd.ExcelFile(self.excel_path), self.excel_path
        except Exception as exc:
            raise zipfile.BadZipFile(
                f"Unable to open Excel workbook. {os.path.basename(self.excel_path)} -> {type(exc).__name__}: {exc}"
            ) from exc

    def _write_sheets_atomically(self, sheets: dict[str, pd.DataFrame]):
        temp_handle = tempfile.NamedTemporaryFile(
            suffix=".xlsx",
            dir=self.data_dir,
            delete=False,
        )
        temp_path = temp_handle.name
        temp_handle.close()

        try:
            if os.path.exists(self.excel_path):
                workbook, _ = self._open_excel_file()
                workbook.close()
                shutil.copy2(self.excel_path, temp_path)
                with pd.ExcelWriter(temp_path, engine="openpyxl", mode="a", if_sheet_exists="replace") as writer:
                    for sheet_name, df in sheets.items():
                        df.to_excel(writer, sheet_name=sheet_name, index=False)
            else:
                with pd.ExcelWriter(temp_path, engine="openpyxl") as writer:
                    for sheet_name, df in sheets.items():
                        df.to_excel(writer, sheet_name=sheet_name, index=False)

            os.replace(temp_path, self.excel_path)
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

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

    def _normalize_mobile_number(self, value):
        if value is None:
            return None
        text = str(value).strip()
        if text in ("", "nan", "None", "null"):
            return None
        # Excel/pandas sometimes round-trips plain digits as a float-like string (e.g. 079... -> 079....0).
        if text.endswith(".0") and text.replace(".", "", 1).replace("-", "", 1).isdigit():
            text = text[:-2]
        return text

    def _is_boolean_column_name(self, column_name: Any) -> bool:
        name = str(column_name or "").strip().lower()
        if not name:
            return False
        if name in {"registered", "archived", "school_graduated"}:
            return True
        if name.startswith(("is_", "has_", "use_", "inherit_")):
            return True
        if name.endswith(("_flag", "_active", "_enabled", "_disabled")):
            return True
        return False

    def _normalize_boolean_value(self, value: Any):
        if isinstance(value, bool):
            return value
        if value is None or pd.isna(value):
            return None
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if float(value) == 1.0:
                return True
            if float(value) == 0.0:
                return False
            return value
        text = str(value).strip().lower()
        if text in ("1", "1.0", "true", "yes", "y", "t"):
            return True
        if text in ("0", "0.0", "false", "no", "n", "f"):
            return False
        return value

    def normalize_boolean_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        if df is None or df.empty:
            return df
        normalized = df.copy()
        for column in normalized.columns:
            if not self._is_boolean_column_name(column):
                continue
            normalized[column] = normalized[column].apply(self._normalize_boolean_value)
        return normalized

    def _canonicalize_sheet_columns(self, sheet: str, df: pd.DataFrame) -> pd.DataFrame:
        if df is None or df.empty:
            return df
        mapping = WORKBOOK_COLUMN_RENAMES.get(sheet, {})
        if not mapping:
            return df

        normalized = df.copy()
        for legacy_name, canonical_name in mapping.items():
            if legacy_name not in normalized.columns:
                continue
            if canonical_name in normalized.columns:
                normalized[canonical_name] = normalized[canonical_name].where(
                    normalized[canonical_name].notna(),
                    normalized[legacy_name],
                )
                normalized = normalized.drop(columns=[legacy_name])
                continue
            normalized = normalized.rename(columns={legacy_name: canonical_name})
        return normalized

    def _add_runtime_alias_columns(self, sheet: str, df: pd.DataFrame) -> pd.DataFrame:
        if df is None or df.empty:
            return df
        mapping = WORKBOOK_COLUMN_RENAMES.get(sheet, {})
        if not mapping:
            return df

        normalized = df.copy()
        for legacy_name, canonical_name in mapping.items():
            if canonical_name in normalized.columns and legacy_name not in normalized.columns:
                normalized[legacy_name] = normalized[canonical_name]
        return normalized

    def _strip_legacy_sheet_columns(self, sheet: str, df: pd.DataFrame) -> pd.DataFrame:
        if df is None or df.empty:
            return df
        legacy_columns = [column for column in WORKBOOK_COLUMN_RENAMES.get(sheet, {}) if column in df.columns]
        runtime_only_columns: list[str] = []
        if sheet == "person_youth_group":
            runtime_only_columns = [column for column in ("age_group", "current_age_group", "age_group_history") if column in df.columns]
        columns_to_drop = legacy_columns + runtime_only_columns
        if not columns_to_drop:
            return df
        return df.drop(columns=columns_to_drop)

    def load_excel_sheets(self, sheets: list[str]) -> dict[str, pd.DataFrame]:
        store: dict[str, pd.DataFrame] = {}
        xf, _ = self._open_excel_file()
        try:
            for sheet in sheets:
                if sheet in xf.sheet_names:
                    if sheet == "mobile_numbers":
                        df = xf.parse(sheet, dtype={"mobile_number_record_id": str, "mobile_number": str, "type": str, "mobile_number_type": str})
                    elif sheet == "mobile_number_family_relations":
                        df = xf.parse(sheet, dtype={"mobile_number_record_id": str, "family_relation": str})
                    elif sheet == "personal_mobile_number_primary":
                        df = xf.parse(sheet, dtype={"mobile_number_record_id": str})
                    elif sheet == "mobile_number_linked_jobs":
                        df = xf.parse(sheet, dtype={"mobile_number_record_id": str, "linked_job_ids": str})
                    elif sheet == "nationality":
                        df = xf.parse(sheet, dtype={"nationality": str})
                    elif sheet == "person_youth_group":
                        df = xf.parse(sheet, dtype={"person_youth_group_record_id": str, "youth_join_year": "Int64", "youth_group_id": str, "age_group": str})
                    elif sheet == "person_youth_group_age_history":
                        df = xf.parse(sheet, dtype={"person_youth_group_record_id": str, "age_group": str, "start_date": str, "end_date": str})
                    elif sheet == "schools":
                        df = xf.parse(sheet, dtype={"school_record_id": str})
                    elif sheet == "school_sections":
                        df = xf.parse(sheet, dtype={"school_record_id": str, "section": str})
                    elif sheet == "school_grades":
                        df = xf.parse(sheet, dtype={"school_record_id": str, "grade": str})
                    elif sheet == "school_logos":
                        df = xf.parse(sheet, dtype={"id": str, "school_logo_id": str, "type": str, "institution_type": str, "name": str, "institution_name": str, "section": str, "institution_section": str, "logo_file_name": str})
                    elif sheet == "emails":
                        df = xf.parse(sheet, dtype={"email_record_id": str, "email": str, "type": str, "email_type": str})
                    elif sheet == "email_family_relations":
                        df = xf.parse(sheet, dtype={"email_record_id": str, "family_relation": str})
                    elif sheet == "personal_email_primary":
                        df = xf.parse(sheet, dtype={"email_record_id": str})
                    elif sheet == "email_linked_jobs":
                        df = xf.parse(sheet, dtype={"email_record_id": str, "linked_job_ids": str})
                    elif sheet == "social_media":
                        df = xf.parse(sheet, dtype={"platform": str, "url": str})
                    elif sheet == "parishes":
                        df = xf.parse(sheet, dtype={"id": str, "parish_id": str, "patron_saint": str, "area": str, "lpj_url": str, "facebook_url": str, "instagram_url": str, "linkedin_url": str, "region": str, "governorate": str})
                    elif sheet == "churches":
                        df = xf.parse(sheet, dtype={"id": str, "church_id": str, "parish_id": str, "patron_saint": str, "area": str, "lat": float, "lng": float})
                    elif sheet == "youth_group_social_media":
                        df = xf.parse(sheet, dtype={"youth_group_id": str, "id": str, "youth_group_social_media_id": str, "platform": str, "url": str, "age_groups": str})
                    elif sheet == "youth_group_social_media_ages":
                        df = xf.parse(sheet, dtype={"id": str, "youth_group_social_media_id": str, "age_group": str})
                    elif sheet == "youth_group_special_logos":
                        df = xf.parse(sheet, dtype={"youth_group_id": str, "id": str, "special_logo_id": str, "occasion": str, "start_date": str, "end_date": str, "file_name": str, "logo_file_name": str})
                    elif sheet == "jobs":
                        df = xf.parse(sheet, dtype={"job_id": str, "job_title": str, "company": str, "employer_name": str, "start_date": str, "end_date": str, "state": str, "employment_state": str})
                    elif sheet == "responsibilities":
                        df = xf.parse(sheet, dtype={"responsibility_period": str, "time": str, "jec_year": str, "is_current": object, "is_active": object, "responsibility_name": str, "responsibility": str, "start_date": str, "end_date": str, "youth_group_id": str})
                    else:
                        df = xf.parse(sheet)
                    df = self._canonicalize_sheet_columns(sheet, df)
                    df = self._add_runtime_alias_columns(sheet, df)
                    if sheet == "persons":
                        if "birth_date" in df.columns:
                            df["birth_date"] = df["birth_date"].where(df["birth_date"].isna(), df["birth_date"].astype(str))
                    if sheet == "mobile_numbers" and "mobile_number" in df.columns:
                        df["mobile_number"] = df["mobile_number"].apply(self._normalize_mobile_number)
                    df = self.normalize_boolean_columns(df)
                    store[sheet] = df
        finally:
            xf.close()
        return store

    def save_excel_sheets(self, store: dict[str, pd.DataFrame]):
        prepared: dict[str, pd.DataFrame] = {}
        for sheet, df in store.items():
            df = self._canonicalize_sheet_columns(sheet, df)
            df = self._strip_legacy_sheet_columns(sheet, df)
            df = self.normalize_boolean_columns(df)
            if sheet == "persons":
                drop_cols = [col for col in self.person_sheet_address_projection_columns if col in df.columns]
                if drop_cols:
                    df = df.drop(columns=drop_cols)
            prepared[sheet] = df
        self._write_sheets_atomically(prepared)

    def load_json_file(self, path: str, default: Any):
        if os.path.exists(path):
            # Use utf-8-sig to tolerate files accidentally saved with BOM.
            with open(path, encoding="utf-8-sig") as f:
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

    def _load_auth_json_users(self, path: str) -> list[dict]:
        payload = self.load_json_file(path, {"users": []})
        users: list[dict] = []
        for row in payload.get("users", []):
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
        workbook_error: zipfile.BadZipFile | None = None

        if os.path.exists(self.excel_path):
            try:
                xf, _ = self._open_excel_file()
                try:
                    if self.auth_sheet in xf.sheet_names:
                        df = xf.parse(self.auth_sheet, dtype={"person_id": str, "username": str, "password_hash": str, "role": str})
                        users = self._auth_users_from_df(df)
                finally:
                    xf.close()
            except zipfile.BadZipFile as exc:
                workbook_error = exc

        if users:
            return {"users": users}

        if os.path.exists(self.legacy_auth_path):
            users = self._load_auth_json_users(self.legacy_auth_path)

        if users:
            if workbook_error is None:
                self.save_auth({"users": users})
                try:
                    os.remove(self.legacy_auth_path)
                except OSError:
                    pass
            return {"users": users}

        if workbook_error is not None:
            raise workbook_error

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
        self._write_sheets_atomically({self.auth_sheet: df})

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
