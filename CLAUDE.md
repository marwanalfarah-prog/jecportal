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
- **No SQL database.** The primary data store is a single Excel workbook: [backend/data/JECJordanData.xlsx](backend/data/JECJordanData.xlsx), loaded into memory with pandas on startup.
- Routes are split by domain into 12+ `routes_*.py` files, all registered in [backend/app.py](backend/app.py).
- [backend/core/state.py](backend/core/state.py) (~195KB) is the central module — it defines every Excel sheet name and column mapping, holds in-memory state after load, and provides helper functions used across all route files.
- [backend/core/database.py](backend/core/database.py) handles loading/reloading the Excel workbook with pandas, including sheet-to-column renaming.

### Data storage

All member data lives in `JECJordanData.xlsx` with sheets for: persons, addresses, mobile numbers, emails, jobs, schools, higher education, youth groups, churches, responsibilities, hobbies/skills, health conditions, org trees, logos, and more.

Supplementary JSON files in `backend/data/`:
- `config.json` — active year, name-variation mappings for fuzzy matching
- `org_trees/` — per-youth-group leadership hierarchy trees
- `questionnaires.json`, `notifications.json` — survey and notification definitions
- `mottos.json`, `youth_group_social_media.json` — organization metadata
- `bible_books/` — Bible content for the reader feature

Photos (logos, profile pictures) are stored under `backend/data/photos/`.

### Auth & roles

Session-based auth via Flask sessions. Two roles: **admin** and **member**. Admins have a "view-as" capability to see member views. Role checks happen in route handlers.

### Key cross-cutting patterns

- **Fuzzy name matching** — `config.json` stores name variations; `state.py` normalizes Arabic text before comparisons.
- **Active year** — `config.json` controls which year's data is active; most queries filter by this.
- **Excel as DB** — data is loaded once into pandas DataFrames on startup; mutations write back to the xlsx file. There is no migration system.
