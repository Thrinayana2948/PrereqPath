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
2. Open the SQL Editor and run `backend/db/schema.sql`.
3. Copy your database connection string from **Connect → Connection string**. Use the Session Pooler or Direct connection, as supported by your network.

### 2. Backend

Open a terminal in the project root and run these commands on Windows:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Open `backend/.env` and configure `DATABASE_URL`. If you intend to run PostgreSQL integration tests, also configure `TEST_DATABASE_URL`.

Then start the backend:

```powershell
python -m db.manage migrate
python -m db.manage seed
uvicorn app.main:app --reload --port 8000
```

The migration and seed commands are optional if you have already applied the schema and loaded the sample data. Run the seed command only when you want to load the demo curriculum.

API documentation: http://localhost:8000/docs

If the database is not configured, `/api/health` reports its status and data endpoints may return `503`.

### 3. Frontend

Open a second terminal from the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, usually http://localhost:5173.

Optional: create `frontend/.env` with:

```dotenv
VITE_API_URL=http://localhost:8000
```

The frontend communicates with the FastAPI backend; database credentials must remain on the backend.

### 4. Tests

From the project root, run the backend tests:

```powershell
cd backend
.venv\Scripts\Activate.ps1
python -m pytest -v
```

The graph tests run without a database. PostgreSQL integration tests run only when `TEST_DATABASE_URL` is configured.

The integration tests create a temporary schema for isolation and clean it up afterwards.

To verify the frontend build, open another terminal from the project root:

```powershell
cd frontend
npm run build
```



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
