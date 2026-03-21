# JEC Data Manager

A full-stack internal management system for JEC data, including:
- Registered and unregistered member records
- Authentication and user management
- Organization trees by group and period
- Promotions workflow
- Questionnaires and notifications
- Dashboard analytics and charts

The project is split into a Flask backend and a React + Vite frontend.

---

## Project Structure

```text
backend/     Flask API + data access + business logic
frontend/    React application (Vite)
backend/data/Excel + JSON persistent data
```

Key runtime data files:
- `backend/data/JECJordanData.xlsx` (main workbook)
- `backend/data/promotions.json`
- `backend/data/questionnaires.json`
- `backend/data/notifications.json`
- `backend/data/org_trees/` (tree periods and indexes per group)
- `backend/data/photos/profile_pictures/` (member photos)

---

## Tech Stack

### Backend
- Python
- Flask
- Flask-CORS
- pandas
- numpy
- openpyxl

### Frontend
- React 18
- Vite 5
- Recharts
- lucide-react

---

## Prerequisites

- Python 3.10+ (recommended)
- Node.js 18+ and npm

---

## Run Locally

Open two terminals from the workspace root.

### 1) Backend (Flask on port 5000)

```powershell
cd backend
python -m pip install flask flask-cors pandas numpy openpyxl
python app.py
```

Backend starts at: `http://localhost:5000`

### 2) Frontend (Vite on port 5173)

```powershell
cd frontend
npm install
npm run dev
```

Frontend starts at: `http://localhost:5173`

The frontend is configured to proxy `/api/*` requests to `http://localhost:5000`.

---

## Authentication

- Session-based auth via Flask session cookies.
- Default admin user is auto-created if missing:
  - Username: `admin`
  - Password: `admin123`

> For security, change the default admin password immediately after first login.

Roles in the system:
- `admin`: full management access
- `member`: profile- and council-scoped access

---

## Main Features

- Member management (registered + unregistered)
- Person profile editing, archiving, photo upload
- Dynamic filters, charts, and enriched records
- Organization trees with multiple periods per group
- Promotions scanning and approval/rejection flow
- Questionnaire creation, responses, and read tracking
- In-app notifications and mark-as-read flows
- Admin user CRUD and generated member accounts

---

## API Overview

Base path: `/api`

### Auth
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/users`, `GET /auth/users/basic`
- `POST /auth/users`, `PUT /auth/users/<username>`, `DELETE /auth/users/<username>`
- `POST /auth/generate-all`
- `GET /auth/council-members`

### Registered Members + Dashboard
- `GET /stats`
- `GET /chart/governorate`, `/chart/gender`, `/chart/youth_group`, `/chart/age_group`
- `GET /filters`
- `GET /persons`, `GET /persons/enriched`
- `GET /person/<pid>`, `POST /person`, `PUT /person/<pid>`, `DELETE /person/<pid>`
- `PATCH /person/<pid>/archive`, `PATCH /person/<pid>/unarchive` (JSON body: `{ "youth_group_id": "<group_id>" }`)
- `POST /person/<pid>/photo`, `GET /person/<pid>/photo`
- `GET /table/<sheet>`, `PUT /table/<sheet>`

### Unregistered Members
- `GET /unregistered`, `GET /unregistered/<uid>`
- `POST /unregistered`, `PUT /unregistered/<uid>`, `DELETE /unregistered/<uid>`
- `PATCH /unregistered/<uid>/archive`, `PATCH /unregistered/<uid>/unarchive` (JSON body: `{ "youth_group_id": "<group_id>" }`)
- `POST /unregistered/<uid>/photo`, `GET /unregistered/<uid>/photo`
- `POST /unregistered/<uid>/promote`
- `POST /unregistered/sync`

### Organization Tree
- `GET /org-tree/<group_name>`
- `GET /org-tree/<group_name>/periods`
- `GET /org-tree/<group_name>/<period_id>`
- `PUT /org-tree/<group_name>`
- `PATCH /org-tree/<group_name>/period/<period_id>`
- `DELETE /org-tree/<group_name>/period/<period_id>`

### Promotions
- `GET /promotions`
- `POST /promotions/scan`
- `PATCH /promotions/<promo_id>`
- `DELETE /promotions/<promo_id>`

### Questionnaires + Notifications
- `GET /questionnaires`, `POST /questionnaires`
- `PUT /questionnaires/<qid>`, `DELETE /questionnaires/<qid>`
- `GET /questionnaires/<qid>/responses`
- `POST /questionnaires/<qid>/respond`
- `PATCH /questionnaires/responses/<resp_id>/read`
- `GET /notifications`
- `PATCH /notifications/<nid>/read`
- `PATCH /notifications/read-all`

---

## Data & Persistence Notes

- Core person data is stored in `backend/data/JECJordanData.xlsx`.
- Member addresses are persisted in the `addresses` sheet, including the primary address selection.
- Auth users are persisted in an Excel sheet (`auth_users`) in the same workbook.
- Some modules persist to JSON files (`promotions`, `questionnaires`, `notifications`, org tree files).
- Profile photos are stored in `backend/data/photos/profile_pictures/`.
- Flask secret key is stored in `backend/data/.secret_key` unless `JEC_SECRET_KEY` is set.

---

## Development Notes

- Backend CORS is enabled for:
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
- Session cookies are currently configured for local development.
- Org tree data is grouped by youth group with per-period JSON files plus an `index.json`.

---

## Troubleshooting

- If frontend API calls fail, ensure backend is running on port `5000`.
- If Excel-related errors occur, verify `openpyxl` is installed.
- If login/session issues occur, clear browser cookies for localhost and retry.
- If file permissions fail on Windows, run terminal with sufficient permissions and verify write access to `backend/data/`.
