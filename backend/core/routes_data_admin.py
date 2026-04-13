from flask import jsonify, request
import pandas as pd

from core import state as S
from core.routes_auth import _require_admin


def _sheet_summary(sheet_name: str, df: pd.DataFrame) -> dict:
    columns = [str(col) for col in df.columns.tolist()]
    return {
        "sheet": sheet_name,
        "columns": columns,
        "row_count": int(len(df.index)),
    }


def _searchable_text(value) -> str:
    if value is None:
        return ""
    if pd.isna(value):
        return ""
    return str(value).strip()


def register_data_admin_routes(app):
    @app.get("/api/admin/data-tables")
    def list_data_tables():
        err = _require_admin()
        if err:
            return err

        tables = []
        for sheet_name in S.SHEETS:
            df = S.store.get(sheet_name, pd.DataFrame())
            tables.append(_sheet_summary(sheet_name, df))
        return jsonify({"tables": tables})

    @app.get("/api/admin/data-tables/search")
    def search_data_tables():
        err = _require_admin()
        if err:
            return err

        query = str(request.args.get("q") or "").strip()
        limit = max(1, min(int(request.args.get("limit") or 100), 250))
        if len(query) < 2:
            return jsonify({"query": query, "results": [], "total_matches": 0})

        query_lower = query.lower()
        results = []
        total_matches = 0

        for sheet_name in S.SHEETS:
            df = S.store.get(sheet_name, pd.DataFrame())
            if df.empty:
                continue

            columns = [str(col) for col in df.columns.tolist()]
            rows = df.to_dict(orient="records")
            for row_index, row in enumerate(rows):
                matching_columns = []
                preview_parts = []
                for column in columns:
                    text = _searchable_text(row.get(column))
                    if text and len(preview_parts) < 4:
                        preview_parts.append(f"{column}: {text}")
                    if query_lower in text.lower():
                        matching_columns.append(column)

                if not matching_columns:
                    continue

                total_matches += 1
                if len(results) >= limit:
                    continue

                results.append({
                    "sheet": sheet_name,
                    "row_index": row_index,
                    "matching_columns": matching_columns,
                    "preview": " | ".join(preview_parts[:4]),
                })

        return jsonify({"query": query, "results": results, "total_matches": total_matches})

    @app.get("/api/admin/data-tables/<sheet>")
    def get_data_table(sheet):
        err = _require_admin()
        if err:
            return err

        if sheet not in S.store:
            return jsonify({"error": "not found"}), 404

        df = S.store[sheet]
        return jsonify({
            "sheet": sheet,
            "columns": [str(col) for col in df.columns.tolist()],
            "rows": S.df_to_json(df),
            "row_count": int(len(df.index)),
        })

    @app.put("/api/admin/data-tables/<sheet>")
    def update_data_table(sheet):
        err = _require_admin()
        if err:
            return err

        if sheet not in S.store:
            return jsonify({"error": "not found"}), 404

        body = request.json
        if not isinstance(body, list):
            return jsonify({"error": "rows payload must be an array"}), 400

        with S.lock:
            S.store[sheet] = pd.DataFrame(body)
            S.save()

        return jsonify({"ok": True, "sheet": sheet, "row_count": int(len(body))})