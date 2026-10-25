# PrereqPath — Smart Course Dependency Planner

A full-stack DSA mini-project that models courses as a directed graph (edge = **prerequisite → dependent**),
orders them with **Kahn's topological sort**, detects cycles with **DFS**, and separates actual cycle members
from courses that are merely **blocked downstream** of a cycle or of an **unresolved prerequisite code**.

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 6, plain CSS, hand-written SVG graph |
| Backend | Python 3.11+ (tested on 3.13), FastAPI, Uvicorn |
| Database | Supabase PostgreSQL via SQLAlchemy 2 + psycopg 3 |
| Tests | pytest, FastAPI TestClient, `npm run build` |

No graph libraries are used; the algorithms live in `backend/app/graph/` and have no database or UI imports.
**There is no authentication** — run it locally.

## Project structure

```
PrereqPath/
├─ backend/
│  ├─ app/
│  │  ├─ graph/          graph.py · kahn.py · cycles.py · analyzer.py   (pure algorithms)
│  │  ├─ routers/        courses.py · prerequisites.py · analysis.py
│  │  ├─ main.py         FastAPI app, CORS, error handlers, /api/health
│  │  ├─ db.py           engine/session, missing-config handling
│  │  ├─ models.py       SQLAlchemy models   ├─ schemas.py  Pydantic validation
│  │  ├─ sample.py       sample curriculum (additive load / scoped removal)
│  │  └─ config.py       environment variables
│  ├─ db/schema.sql      PostgreSQL schema (idempotent)   db/manage.py  migrate | seed
│  ├─ tests/             test_graph.py · test_api.py · conftest.py
│  ├─ requirements.txt   .env.example   pytest.ini
├─ frontend/             React app (src/App.jsx, src/api.js, src/components/*)
├─ README.md  REPORT.md  .gitignore
```

## Setup

### 1. Supabase database
1. Create a Supabase project.
2. Open **SQL Editor**, paste `backend/db/schema.sql`, and run it (safe to re-run).
3. Copy the connection string from **Connect → Connection string** (use **Session pooler** or **Direct**).

### 2. Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env           # macOS/Linux: cp .env.example .env
```
Edit `backend/.env` and set `DATABASE_URL` (URL-encode special characters in the password). Then:
```bash
python -m db.manage migrate      # optional alternative to the SQL Editor
python -m db.manage seed         # optional sample curriculum
uvicorn app.main:app --reload --port 8000
```
API docs: http://localhost:8000/docs. If `DATABASE_URL` is missing, `/api/health` reports
`not_configured` and data endpoints return **503** with setup instructions.

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```
Optional `frontend/.env`: `VITE_API_URL=http://localhost:8000`. The frontend never receives database credentials
or Supabase keys — it only talks to the FastAPI backend.

## Tests
```bash
cd backend
.venv\Scripts\python -m pytest -v
```
- `test_graph.py` — algorithm tests (no database).
- `test_api.py` — validation / error-handling tests (no database) plus PostgreSQL integration tests that run only
  when `TEST_DATABASE_URL` is set. They create a throwaway schema `prereqpath_test_xxxxxxxx`, run `schema.sql`
  inside it, and drop it afterwards, so existing data is not touched. Use a session-pooler or direct connection.

Frontend verification: `cd frontend && npm run build`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | API status + database state (`connected`, `not_configured`, `unreachable`, `schema_missing`) |
| GET / POST | `/api/courses` | List (with prerequisite/dependent counts) / create |
| GET / PATCH / DELETE | `/api/courses/{id}` | Read / partial update / delete (`?cascade=true` required when relationships exist) |
| GET / POST | `/api/prerequisites` | List / create (`prerequisite_id`, `dependent_id`) |
| PUT / DELETE | `/api/prerequisites/{id}` | Replace endpoints / delete |
| GET | `/api/graph` | Nodes and directed edges |
| GET | `/api/analysis` | Analysis of the current database graph |
| POST | `/api/analysis/custom` | Stateless what-if analysis (may reference unknown codes) |
| POST | `/api/sample/load` | Add missing sample rows; never overwrites existing courses |
| POST | `/api/sample/reset` | Remove sample rows + their links, then reload (one transaction) |
| DELETE | `/api/sample` | Remove sample rows + their links; user-created courses kept |

Errors: **404** missing resource, **409** duplicate code/edge or delete-with-relationships, **422** validation
(bad code format, blank name, self-dependency, duplicate course in custom input), **503** database not configured,
unreachable, or schema missing.

## Design notes
- Cycles **can** be saved on purpose so the analyser can demonstrate detection; self-loops cannot (API + DB `CHECK`).
- Deleting a course never silently removes relationships: FKs are `ON DELETE RESTRICT`; the API returns 409 unless
  `cascade=true` is passed, then deletes links and course in one transaction. The UI states how many links go.
- Unresolved prerequisite codes cannot exist in the database (FKs), so they are demonstrated with the what-if analyser.
- Optional `db/rls.sql` enables RLS with no policies so Supabase's public REST API cannot read these tables; the
  backend connects as the table owner and is unaffected.

See [REPORT.md](REPORT.md) for the algorithm write-up and results.
