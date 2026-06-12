# JEC Jordan Portal

Member management portal for a church youth organization in Jordan.

- **Backend**: Python + Flask, CSV files as database (pandas-loaded), session auth  
- **Frontend**: React 18 + Vite, JavaScript (no TypeScript), Arabic RTL UI

---

## Repository layout

```
backend/          Original backend (production)
frontend/         Original frontend (production)
backend_v2/       v2 rewrite — clean layered architecture
frontend_v2/      v2 frontend scaffold + test suite
data/             Single source of truth (shared by both backends)
```

Both `backend/` and `backend_v2/` read from and write to the **same** `data/`
directory. Never move, copy, or restructure files inside `data/`.

---

## Running the original stack

```bash
# Backend (port 5000)
cd backend
pip install flask flask-cors pandas numpy
python app.py

# Frontend dev server (port 5173)
cd frontend
npm install
npm run dev
```

Browse to http://localhost:5173 — login with `admin` / `admin123`.

---

## Running the v2 stack

### Backend (port 5001)

```bash
cd backend_v2
pip install -e ".[test,lint]"        # installs all pinned deps
python app.py                         # starts on PORT=5001

# Or with a custom port:
PORT=5002 python app.py
```

### Frontend dev server (port 5174)

```bash
cd frontend_v2
npm install
npm run dev                           # http://localhost:5174 → proxies API to :5001
```

To proxy to the original backend instead:
```bash
VITE_API_BASE_URL=http://localhost:5000 npm run dev
```

Both stacks can run side-by-side: original on `:5000`/`:5173`, v2 on `:5001`/`:5174`.

---

## Running the test suite

### Backend characterization tests

Tests live in `backend_v2/tests/` and run against either backend.

```bash
cd backend_v2

# Ground-truth mode (tests the original backend — establishes expected behavior)
pytest tests/ -m "not slow"

# Equivalence mode (tests backend_v2 — must match ground truth)
JEC_TEST_TARGET=v2 pytest tests/ -m "not slow"

# Skip mutation-heavy tests for a fast smoke run (< 30s)
JEC_TEST_TARGET=v2 pytest tests/test_auth.py tests/test_bible_reader.py \
    tests/test_privileges.py -m "not slow"

# With member-level tests (requires a real member account):
JEC_TEST_MEMBER_USERNAME=<username> JEC_TEST_MEMBER_PASSWORD=<password> \
    pytest tests/ -m "not slow"
```

**Results (v2):** 300 passed, 50 skipped, 0 failures  
**Skipped:** member-credential tests (set env vars above to enable)  
**Deselected:** `TestGenerateAll::test_shape` (marked `@pytest.mark.slow`, ~800s)

> Note: tests that create/delete real data (parish CRUD, motto CRUD, registration)
> write CSV files to `data/`. The full suite takes ~15 minutes due to this I/O.

### Frontend Vitest unit tests

```bash
cd frontend_v2
npm install
npm test                              # 57 tests, < 2s
npm run test:coverage                 # with lcov report
```

### Playwright E2E tests

Requires the stack to be running first.

```bash
# Start original stack:
#   backend:  cd backend && python app.py
#   frontend: cd frontend && npm run dev

cd frontend_v2
npx playwright install chromium       # first time only
npm run test:e2e

# Against v2 stack (port 5174):
PLAYWRIGHT_BASE_URL=http://localhost:5174 npm run test:e2e
```

---

## Linting and formatting

### Backend (ruff)

```bash
cd backend_v2
ruff check .                          # lint
ruff check . --fix                    # auto-fix
ruff format .                         # format
ruff format . --check                 # check without writing
```

### Frontend (ESLint + Prettier)

```bash
cd frontend_v2
npm run lint                          # ESLint
npm run lint:fix                      # ESLint auto-fix
npm run format                        # Prettier
npm run format:check                  # Prettier check
```

---

## Architecture (v2)

See [`backend_v2/ARCHITECTURE.md`](backend_v2/ARCHITECTURE.md) for the full
design document including layer contracts, API envelope specs, and preserved bugs.

### Key facts

- **Port**: v2 backend runs on `5001` (original on `5000`)
- **Data**: both backends share `data/` — identical behavior for all read+write ops
- **Auth**: SHA-256 password hashing, no salt (preserved from original for CSV compatibility)
- **Sessions**: `SameSite=Lax`, `HttpOnly=True`, `Secure=False`
- **CORS**: allows `localhost:5173` and `localhost:5174`

---

## Environment variables

### Backend v2 (`backend_v2/.env.example`)

| Variable | Default | Description |
|---|---|---|
| `JEC_SECRET_KEY` | auto-generated | Flask session signing key |
| `PORT` | `5001` | HTTP port |
| `FLASK_DEBUG` | `false` | Enable debug mode |
| `FRONTEND_DIST_DIR` | `../frontend_v2/dist` | SPA dist for production serving |

### Frontend v2 (`frontend_v2/.env.example`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:5001` | Backend to proxy `/api` calls to |

### Test variables

| Variable | Default | Description |
|---|---|---|
| `JEC_TEST_TARGET` | `original` | `original` or `v2` |
| `JEC_TEST_MEMBER_USERNAME` | — | Username for member-level tests |
| `JEC_TEST_MEMBER_PASSWORD` | — | Password for member-level tests |
