# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Frontend** (run from `frontend/`):
```bash
npm run dev        # Dev server at http://localhost:5173 (hot reload)
npm run build      # Production build → dist/
npm run preview    # Preview production build
```

**Backend** (run from repo root):
```bash
python backend/app.py   # Flask dev server at http://localhost:5000
```

**Full stack local dev:** start both servers. Vite proxies `/api/*` to Flask on port 5000.

## Architecture

This is a full-stack member management portal for JEC Jordan (a Coptic youth organization). The UI is fully in Arabic (RTL).

### Frontend

- **React 18 + Vite** — no TypeScript, plain JSX
- **Single CSS file:** [frontend/src/index.css](frontend/src/index.css) (~50KB) with RTL layout throughout
- **All routing is manual** inside [frontend/src/App.jsx](frontend/src/App.jsx) — no React Router. The active page is tracked in component state; navigation is handled by a `currentPage` state variable.
- **API calls** are centralized in [frontend/src/api.js](frontend/src/api.js). All calls go through fetch to relative `/api/` paths (proxied by Vite).
- **19 page components** in `frontend/src/pages/`. Some are very large (Profile.jsx ~343KB, GeneralSecretariatTree.jsx ~136KB, Config.jsx ~92KB) — they are monolithic with all subviews inlined.
- **No component library** — all UI is hand-written CSS.

### Backend

- **Flask** REST API — all routes prefixed with `/api/`
- **No SQL database.** The primary data store is a directory of CSV files: [data/JECJordanData/](data/JECJordanData/), loaded into memory with pandas on startup.
- Routes are split by domain into 12+ `routes_*.py` files, all registered in [backend/app.py](backend/app.py).
- [backend/core/state.py](backend/core/state.py) (~195KB) is the central module — it defines every sheet name and column mapping, holds in-memory state after load, and provides helper functions used across all route files.
- [backend/core/database.py](backend/core/database.py) handles loading/saving CSV files with pandas, including sheet-to-column renaming.

### Data storage

All member data lives in `data/JECJordanData/` as UTF-8-sig encoded CSV files (one file per logical sheet). All named sheets use `scd_`-prefixed filenames (e.g. `scd_persons.csv`, `scd_youth_groups.csv`). A few long SCD names use shorter aliases; the full mapping is in `SCD_WORKBOOK_SHEET_NAMES` in `backend/core/database.py`.

#### SCD (Slowly Changing Dimension) system

Every CSV sheet carries four metadata columns: `scd_active_from`, `scd_active_to`, `scd_currently_active_flag`, `scd_changed_by_user`. The invariants are:
- **Active rows**: `scd_currently_active_flag=True`, `scd_active_to` is empty.
- **Closed rows**: `scd_currently_active_flag=False`, `scd_active_to` has a timestamp.
- **Mutations follow a close+insert pattern**: mark the old row inactive, insert a new active row; never update in place.
- **`_scd_filter_active(df)`** in `state.py` is the canonical filter — call it on any DataFrame before using it for read/display. It is a no-op for legacy DataFrames that lack the flag column.
- **`store`** (main in-memory store) holds ALL rows — active and inactive — intentionally, to preserve history. Always apply `_scd_filter_active()` before querying.
- **`unreg_store`** (unregistered-person view) is rebuilt by `_sync_unreg_view_from_store()` after every save; it receives only active rows (SCD-filtered at rebuild time). Routes that read `unreg_store` for display should still call `_scd_filter_active()` defensively.
- **`auth_users`** SCD is handled separately in `db.save_auth()` / `db.load_auth()` in `database.py`.
- **Org-tree sheets** (`scd_org_tree_periods/nodes/edges/hulls.csv`) are managed directly in `routes_org_tree.py` via `_read_csv_records(active_only=True)` — they are intentionally NOT in `SCD_LOGICAL_SHEETS` because they bypass the standard Database loader.

Supplementary JSON files in `data/`:
- `config/` — per-option JSON files for active year, name-variation mappings, person titles, school branches, and mottos
- `org_trees/` — per-youth-group leadership hierarchy trees
- `questionnaires.json`, `notifications.json` — survey and notification definitions
- `bible_books/` — Bible content for the reader feature

Youth-group social media metadata is stored in `youth_group_social_media.csv`.
Specific age-group targeting for those links is stored in `youth_group_social_media_ages.csv`. If a youth-group social-media row has no related age-group rows, it applies to all age groups.

Photos (logos, profile pictures) are stored under `data/photos/`.

### Auth & roles

Session-based auth via Flask sessions. Two roles: **admin** and **member**. Admins have a "view-as" capability to see member views. Role checks happen in route handlers.

### Key cross-cutting patterns

- **Fuzzy name matching** — `data/config/name_variations.json` stores name variations; `state.py` normalizes Arabic text before comparisons.
- **Active year** — `data/config/active_jec_year.json` controls which year's data is active; most queries filter by this.
- **CSV as DB** — data is loaded once into pandas DataFrames on startup; mutations write back to individual CSV files atomically (temp-file + rename). There is no migration system.
