import os
from pathlib import Path

from flask import jsonify

from core import state as S
from core.routes_auth import exports as auth_exports


def _clean_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text in ("", "nan", "None", "null"):
        return ""
    return text


def _section_headings(section: dict) -> list[str]:
    headings: list[str] = []

    def add(value):
        text = _clean_text(value)
        if text and text not in headings:
            headings.append(text)

    # Keep explicit headings as the source of truth.
    add(section.get("t"))

    raw_list = section.get("headings") if isinstance(section.get("headings"), list) else []
    for value in raw_list:
        add(value)

    return headings


def _normalize_chapters(chapters: list) -> list[dict]:
    out: list[dict] = []

    for chapter in chapters:
        row = chapter if isinstance(chapter, dict) else {}
        sections = row.get("s") if isinstance(row.get("s"), list) else []

        normalized_sections = []
        for section in sections:
            sec = dict(section) if isinstance(section, dict) else {}
            sec["headings"] = _section_headings(sec)
            sec.pop("hl", None)
            sec.pop("t", None)
            normalized_sections.append(sec)

        chapter_row = dict(row)
        chapter_row["s"] = normalized_sections
        out.append(chapter_row)

    return out


def _bible_books_tree_path() -> str:
    return os.path.join(S.db.data_dir, "bible_books_tree.json")


def _bible_books_root_dir() -> str:
    return os.path.join(S.db.data_dir, "bible_books")


def _load_bible_books_tree() -> list[dict]:
    raw = S.db.load_json_file(_bible_books_tree_path(), [])
    if not isinstance(raw, list):
        return []
    return raw


def _book_meta_index() -> tuple[dict[str, dict], list[str]]:
    out: dict[str, dict] = {}
    order: list[str] = []

    def visit_section(testament_id: str, testament_name: str, section_row: dict):
        section = section_row if isinstance(section_row, dict) else {}
        section_id = _clean_text(section.get("id"))
        section_name = _clean_text(section.get("name"))

        books = section.get("books") if isinstance(section.get("books"), list) else []
        for row in books:
            if not isinstance(row, dict):
                continue
            book_id = _clean_text(row.get("id"))
            if not book_id:
                continue
            out[book_id] = {
                "book_id": book_id,
                "name": _clean_text(row.get("name")),
                "abbr": _clean_text(row.get("abbr")),
                "testament_id": testament_id,
                "testament_name": testament_name,
                "section_id": section_id,
                "section_name": section_name,
            }
            order.append(book_id)

        subsections = section.get("subsections") if isinstance(section.get("subsections"), list) else []
        for subsection in subsections:
            visit_section(testament_id, testament_name, subsection)

    for testament in _load_bible_books_tree():
        if not isinstance(testament, dict):
            continue
        testament_id = _clean_text(testament.get("id"))
        testament_name = _clean_text(testament.get("name"))
        sections = testament.get("sections") if isinstance(testament.get("sections"), list) else []
        for section in sections:
            visit_section(testament_id, testament_name, section)

    return out, order


def _enriched_bible_books_tree(meta_index: dict[str, dict], files_by_id: dict[str, str]) -> list[dict]:
    def enrich_section(section_row: dict) -> dict:
        section = section_row if isinstance(section_row, dict) else {}
        out = dict(section)

        raw_books = section.get("books") if isinstance(section.get("books"), list) else []
        books: list[dict] = []
        for row in raw_books:
            book = row if isinstance(row, dict) else {}
            book_id = _clean_text(book.get("id"))
            meta = dict(meta_index.get(book_id) or {})
            has_content = bool(files_by_id.get(book_id))
            books.append({
                **book,
                "book_id": book_id,
                "name": _clean_text(book.get("name")) or _clean_text(meta.get("name")),
                "abbr": _clean_text(book.get("abbr")) or _clean_text(meta.get("abbr")),
                "has_content": has_content,
            })
        out["books"] = books

        raw_subsections = section.get("subsections") if isinstance(section.get("subsections"), list) else []
        out["subsections"] = [enrich_section(subsection) for subsection in raw_subsections]
        return out

    tree: list[dict] = []
    for testament_row in _load_bible_books_tree():
        testament = testament_row if isinstance(testament_row, dict) else {}
        out_testament = dict(testament)
        raw_sections = testament.get("sections") if isinstance(testament.get("sections"), list) else []
        out_testament["sections"] = [enrich_section(section) for section in raw_sections]
        tree.append(out_testament)

    return tree


def _discover_books_from_directory() -> list[dict]:
    root = Path(_bible_books_root_dir())
    if not root.exists() or not root.is_dir():
        return []

    rows = []
    for path in root.rglob("*.json"):
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            continue
        rows.append({
            "book_id": path.stem,
            "rel_file": rel,
        })
    return rows


def _resolve_book_files() -> dict[str, str]:
    root = Path(_bible_books_root_dir()).resolve()
    out: dict[str, str] = {}

    for row in _discover_books_from_directory():
        book_id = _clean_text(row.get("book_id"))
        rel_file = _clean_text(row.get("rel_file"))
        if not book_id or not rel_file:
            continue

        full_path = (root / rel_file).resolve()
        if root not in full_path.parents and full_path != root:
            continue
        if not full_path.exists() or not full_path.is_file():
            continue
        out[book_id] = str(full_path)

    return out


def _load_book_payload(path: str) -> dict | None:
    raw = S.db.load_json_file(path, None)
    if not isinstance(raw, dict):
        return None

    chapters = raw.get("chapters") if isinstance(raw.get("chapters"), list) else []
    return {
        "chapters": _normalize_chapters(chapters),
    }


def register_bible_reader_routes(app):
    @app.get("/api/bible-reader/books")
    def list_bible_reader_books():
        err = auth_exports["_require_auth"]()
        if err:
            return err

        meta_index, order = _book_meta_index()
        files_by_id = _resolve_book_files()

        books = []
        for book_id in order:
            file_path = files_by_id.get(book_id)
            meta = dict(meta_index.get(book_id) or {"book_id": book_id})
            payload = _load_book_payload(file_path) if file_path else None
            chapter_count = len(payload.get("chapters", [])) if payload else 0
            meta["has_content"] = bool(file_path)
            meta["chapter_count"] = chapter_count
            books.append(meta)

        tree = _enriched_bible_books_tree(meta_index, files_by_id)
        return jsonify({"ok": True, "books": books, "tree": tree})

    @app.get("/api/bible-reader/books/<book_id>")
    def get_bible_reader_book(book_id):
        err = auth_exports["_require_auth"]()
        if err:
            return err

        bid = _clean_text(book_id)
        if not bid:
            return jsonify({"error": "invalid book id"}), 400

        meta_index, _ = _book_meta_index()
        if bid not in meta_index:
            return jsonify({"error": "book not found"}), 404

        files_by_id = _resolve_book_files()
        file_path = files_by_id.get(bid)
        if not file_path:
            return jsonify({"error": "book not found"}), 404

        payload = _load_book_payload(file_path)
        if payload is None:
            return jsonify({"error": "invalid book payload"}), 500

        meta = dict(meta_index.get(bid) or {"book_id": bid})

        return jsonify({
            "ok": True,
            "book": {
                **meta,
                "chapters": payload.get("chapters", []),
            },
        })
