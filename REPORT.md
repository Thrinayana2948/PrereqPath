# PrereqPath — Smart Course Dependency Planner

**Project report · Data Structures & Algorithms mini-project**

## 1. Overview and problem statement

Students must take courses in an order that satisfies every prerequisite. As a curriculum grows, it becomes
hard to tell by inspection whether a valid order exists. Three things can prevent one:

1. **Cycles.** For example, A requires B, B requires C, and C requires A. No course in the cycle can ever be taken.
2. **Courses blocked downstream.** These are not in a cycle themselves but depend, directly or indirectly, on a
   course that is.
3. **Unresolved references.** A prerequisite names a course code that does not exist.

PrereqPath models a curriculum as a directed graph. It computes a valid course order with Kahn's topological
sort, detects cycles independently with depth-first search (DFS), and reports exactly which courses are cycle
members, which are only blocked, and which references are unresolved. It reports a **complete** order only when
every course is eligible and every reference resolves.

### Objectives
- Implement the graph algorithms from scratch: no graph libraries, no database or UI dependencies.
- Persist courses and relationships in a normalized PostgreSQL schema on Supabase.
- Expose the data and analysis through a validated REST API.
- Present the results in an interactive dashboard with a directed-graph view.
- Verify the system with automated tests, including tests against a real PostgreSQL database.

## 2. Features

- **Course management:** create, read, update and delete courses, with code format validation, unique codes and
  confirmation before destructive actions.
- **Prerequisite management:** create, update and delete relationships, with self-dependency and duplicate checks.
  Cycles may be saved on purpose so the analyser can detect and explain them.
- **Analysis of saved data**, shown in five tabs:
  - **Order:** topological order and suggested terms
  - **Queue trace:** Kahn's queue processing, with initial indegrees
  - **Cycles & blocked:** cycle groups, the cycles found by DFS, and blocked downstream courses with reasons
  - **Unresolved:** missing course codes and duplicate relationships
  - **Complexity:** a reference table of analytical bounds
- **What-if sandbox:** analyses pasted input on the server without saving it. Invalid scenarios (cycles, unknown
  codes, duplicates) are demonstrated here only.
- **Interactive graph:**
  - columns follow topological levels; cycle members are placed by a layering heuristic
  - pan, zoom, fit-to-view and node dragging
  - selecting a course highlights its prerequisites and dependents
  - status shown by colour and by symbol (↻ cycle, ⊘ blocked, ? missing)
- **Overview:** plan status, statistics, entry courses and the most depended-on courses, all from live API data.
- **Demo data:** load, reset and remove a fictional demo curriculum. Courses created by the user are never changed.
- **Themes and layout:** dark and light themes (the choice is remembered), responsive layout, keyboard-accessible
  graph nodes.

No authentication is implemented; the application is intended for local use.

## 3. Architecture

```
React + Vite SPA  ──HTTP/JSON──▶  FastAPI (Uvicorn)  ──SQLAlchemy + psycopg 3──▶  Supabase PostgreSQL
 (frontend/)                       (backend/app/)                                  (Session Pooler, sslmode=require)
                                        │
                                        └──▶ app/graph/  (pure Python algorithms, no DB/UI imports)
```

| Layer | Components |
|---|---|
| Frontend | `App.jsx` (shell, views, data loading), `GraphView.jsx` (custom SVG graph), `AnalysisPanel.jsx`, `CoursePanel.jsx`, `PrereqPanel.jsx`, `CustomAnalysis.jsx` (sandbox), `Overview.jsx`, `api.js` |
| API | `routers/courses.py`, `routers/prerequisites.py`, `routers/analysis.py` (graph, analysis, sandbox, demo data), `/api/health` in `main.py` |
| Data access | `db.py` (engine, session and missing-configuration handling), `models.py` (ORM), `schemas.py` (Pydantic validation) |
| Algorithms | `graph/graph.py`, `graph/kahn.py`, `graph/cycles.py`, `graph/analyzer.py` |

Database credentials are read only by the backend, from `backend/.env`, which is listed in `.gitignore`. The
frontend reads only `VITE_API_URL` and never receives database credentials or Supabase keys.

Errors are returned with clear status codes:

| Status | Meaning |
|---|---|
| 404 | Missing resource |
| 409 | Duplicate code or relationship, or deleting a course that still has relationships |
| 422 | Validation failure |
| 503 | Database not configured, unreachable, or schema missing (with setup instructions) |

## 4. Data structures and algorithms

### 4.1 Graph representation
- **Vertices** are course codes. An **edge** points from a prerequisite to its dependent course.
- The graph stores **adjacency lists** (prerequisite → dependents) and **reverse adjacency lists**
  (dependent → prerequisites) as hash maps of lists.
- Building the graph:
  - rejects duplicate course codes, blank codes and self-dependencies
  - counts a duplicate edge once and reports it
  - keeps edges that name an unknown course out of the adjacency lists and reports them as unresolved
- Neighbour lists are sorted, so the output is deterministic.

### 4.2 Kahn's topological sort (`kahn.py`)
1. Compute each vertex's indegree. Each unresolved prerequisite adds one requirement that can never be met, so
   that course and everything after it can never become eligible.
2. Put every vertex with indegree 0 into a FIFO queue (`collections.deque`).
3. Repeatedly dequeue a vertex, append it to the order, and decrement the indegree of each of its dependents.
   Enqueue any dependent whose indegree reaches 0. Record the step in the trace.
4. A course's **level** (the earliest term it can be taken) is the longest path to it, updated during the same loop.
5. Any vertex never dequeued lies in a cycle, is downstream of one, or is blocked by an unresolved reference.

### 4.3 DFS cycle detection (`cycles.py`)
- **Three-colour DFS** (white = unvisited, gray = on the current path, black = finished). An edge u → v where v
  is gray is a back edge, which proves a cycle. The cycle is read off the current path from v to u.
  - This runs independently of Kahn's algorithm, and the tests check that the two agree.
- **Tarjan's strongly connected components** (unvisited / on-stack / done states) give the exact set of cycle
  members: a course is a cycle member if and only if its component contains more than one course.
  - Collecting back-edge paths alone can miss members that are reached only through cross edges. A dedicated
    test (`test_scc_membership_catches_cross_edge_member`) covers this case.
- **Blocked courses** are found by forward breadth-first search (BFS) from cycle members and from courses with
  missing prerequisites. The result is reported per course, with its reasons and what it is waiting on.
- Both DFS routines are **iterative**, so a 5,000-course chain is processed without hitting Python's recursion limit.

### 4.4 Complexity (V = courses, E = prerequisite relationships)

These are **analytical worst-case bounds** derived from the code. They were not measured by benchmarks.

| Step | Time | Auxiliary space |
|---|---|---|
| Build adjacency lists | O(V + E), plus O(V log V + E log V) to sort vertices and neighbours | O(V + E) |
| Kahn's topological sort | O(V + E) | O(V) for indegree, queue and levels |
| Three-colour DFS (detection) | O(V + E) | O(V) |
| Cycle path reconstruction | O(length) per reported cycle; worst case O(V·E) of output | O(V) |
| Tarjan's strongly connected components | O(V + E) | O(V) |
| Blocked-course BFS | O(V + E) | O(V) |
| **Full analysis** | **O(V + E)**, excluding sorting and cycle-path output | **O(V + E)** |

The queue trace in the response is O(V + E) in size (one entry per dequeue and per indegree update) and is not
counted as auxiliary space.

## 5. Database design

The schema is defined in `backend/db/schema.sql` and is idempotent (safe to re-run).

**`courses`**: `id` (BIGINT identity primary key), `code` VARCHAR(20) UNIQUE, `name` VARCHAR(200),
`description` TEXT nullable, `is_sample` BOOLEAN (marks demo rows), `created_at`, `updated_at` (TIMESTAMPTZ).

**`prerequisites`**: `id` (BIGINT identity primary key), `prerequisite_id` and `dependent_id` (foreign keys to
`courses.id`, `ON DELETE RESTRICT`), `created_at`.

**Integrity rules**

| Rule | Enforced by |
|---|---|
| Unique course code | `courses_code_key` |
| Code format `^[A-Z0-9][A-Z0-9_-]{0,19}$` | `courses_code_format` CHECK |
| Non-blank name | `courses_name_not_blank` CHECK |
| No self-dependency | `prerequisites_no_self` CHECK |
| No duplicate relationship | `prerequisites_pair_key` UNIQUE (also indexes `prerequisite_id`) |
| Referential integrity | Foreign keys with `ON DELETE RESTRICT` |
| Fast dependent lookups | `prerequisites_dependent_idx` |
| `updated_at` maintenance | Trigger `courses_set_updated_at` → `prereqpath_set_updated_at()` |

**Normalization:** course attributes live only in `courses`. `prerequisites` is a pure association table of
foreign-key pairs.

**Explicit deletion:** the database refuses to delete a course that still has relationships. The API returns 409
unless the client passes `cascade=true`. It then deletes the relationships and the course in a single transaction,
and the UI states how many relationships will be removed.

**Transactions:**
- Each create, update and delete commits as one unit.
- Resetting the demo data (remove, then reload) is a single transaction.
- A test confirms that a failed transaction leaves no partial rows.

**Deployment notes:**
- The schema was applied to the Supabase project through the Session Pooler (port 5432) with `sslmode=require`.
- **Row Level Security (unconfirmed cause):** a read-only check after applying the schema found RLS enabled on
  both tables. `schema.sql` does not enable RLS and `db/rls.sql` was not run, so a Supabase project-level default
  is the likely cause. This was not confirmed in the project settings.
- The backend connects as the table owner. The API and integration tests worked with RLS enabled.

## 6. Demo dataset

The demo data is a **fictional "Orbital Systems" programme** (`backend/app/sample.py`). It is invented for
demonstration and **does not represent any real or official university curriculum**. Every course description
begins with "Demo data (fictional course)", and the UI labels these courses **demo**.

- **13 courses, 18 prerequisite relationships.** The graph is acyclic and the analysis yields a complete
  4-term plan:

| Term | Courses |
|---|---|
| 1 | CMP120, HUM105, MTH110, ORB100 |
| 2 | CMP210, ORB200, PRP230, SNS220 |
| 3 | CMP320, ORB310, PRP330, SAF340 |
| 4 | CAP400 |

- **Variety:**
  - Chains of up to 4 courses, e.g. CMP120 → CMP210 → SAF340 → CAP400.
  - Courses with 2, 3 and 4 prerequisites (CAP400 has 4).
  - One independent elective (HUM105).
- **Validation before insert:** `validate_sample()` checks:
  - the code format
  - duplicate codes and duplicate relationships
  - self-dependencies
  - unresolved references
  - acyclicity (using the project's own analyzer)
- **Safe loading:**
  - Loading is additive and repeatable.
  - An existing course with the same code is left untouched.
  - Demo relationships are never attached to user-created courses.
  - Reset and remove affect demo rows only.
- Intentionally invalid graphs exist only as what-if sandbox presets and are never stored.

## 7. Testing

This section separates three kinds of evidence: **automated tests** (pytest), **build verification**, and
**manual browser checks**. The complexity figures in §4.4 are analytical and are not test results.

### Automated test suite (42 tests)
- **Algorithm tests** (`tests/test_graph.py`, 19 tests): pure unit tests with no database. They cover:
  - a valid DAG and prerequisite ordering
  - the queue trace
  - independent courses, and empty and disconnected graphs
  - a cycle versus the courses blocked downstream of it
  - two separate cycles with a course between them
  - cycle membership reached through a cross edge
  - agreement between Kahn's algorithm and DFS
  - unresolved prerequisite and dependent codes
  - duplicate courses and duplicate edges
  - self-dependencies, and blank or non-string codes
  - a 5,000-course chain
- **API tests without a database** (`tests/test_api.py`, 13 tests): FastAPI TestClient tests of:
  - health and 503 responses when the database is not configured
  - CORS
  - sandbox analysis, including unresolved references and rejection of invalid graphs
  - course and prerequisite validation (422)
  - demo-data validity and labelling
- **PostgreSQL integration tests** (`tests/test_api.py`, 10 tests): run against the real Supabase database when
  `TEST_DATABASE_URL` is set. They cover:
  - the connected health state
  - course and prerequisite create/read/update/delete
  - 409 conflicts
  - explicit cascade deletion
  - CHECK, UNIQUE and foreign-key enforcement
  - transaction rollback
  - analysis of a stored cycle
  - repeatable demo loading that preserves user data
  - demo reset and removal

### Test isolation (integration tests)
- Each run creates a uniquely named schema `prereqpath_test_<8 hex>` and points every test connection at that
  schema only.
- Before each `TRUNCATE`, the tests confirm the connection's active schema. The `TRUNCATE` also names the test
  schema explicitly.
- A connection URL using the Supabase transaction pooler (port 6543) is refused.
- Cleanup runs in `try/finally` and drops only a schema this run created and whose name matches the pattern.
- After the last reported run, a read-only check found no `prereqpath_test_*` schemas, and the stored row counts
  were unchanged (13 courses, 18 relationships).

### Results (historical; the suite was not re-run while writing this report)
- **Last reported automated run:** `pytest` gave **42 passed** in 21.42 s, with `TEST_DATABASE_URL` pointing at
  Supabase. No failures were reported, and no tests were skipped, so the 10 integration tests ran.
  - The only warning was a third-party deprecation notice from Starlette's test client.
  - The run came after the final code changes made in this verification session.
- **Bug found by automated testing:** the first integration run produced 3 failures, caused by a real defect in
  `GET /api/courses` (`dict()` applied directly to a SQLAlchemy `Result`). It was fixed in one line, and later runs
  passed.
- **Build verification:** `npm run build` (Vite) completed successfully in the last reported build. There are no
  automated frontend tests.

### Manual browser checks
These were done by hand against the live database during development. They are not repeatable automated tests.

- Overview statistics matched the API (13 courses, 18 relationships, complete 4-term plan).
- Course create, client-side validation errors, duplicate code (409) and edit.
- Self-dependency rejected in the relationship form.
- A deliberately saved cycle (temporary test course) flagged the 8 actual cycle members and kept the other
  6 courses ordered. The temporary course was then deleted with explicit cascade.
- Graph rendering and selection highlighting. With no cycle, the graph's columns matched Kahn's levels for all
  13 courses.
- All five analysis tabs showed live data.
- The what-if sandbox reported unresolved codes, and the stored course count was unchanged afterwards.
- Light and dark themes rendered.
- Browser console: the only error was the deliberate 409 response. The backend log showed no 5xx responses.

## 8. Limitations

- **No authentication or authorization.** Any client that can reach the API can modify data. Run locally only.
- **One shared curriculum.** There are no per-student plans, completed-course tracking or credit limits.
- **Terms are earliest-possible levels.** They ignore course availability, credit-per-term limits and
  co-requisites.
- **Prerequisites are strictly AND.** "Either A or B" requirements cannot be expressed.
- **Graph layout is simple.** Columns are layered with fixed spacing and there is no edge-crossing minimization.
  Large or cyclic graphs open at a small zoom level.
- **The sandbox cannot use saved data directly.** Unresolved references cannot exist in the database because
  foreign keys prevent them, so they can only be demonstrated in the sandbox.
- **Coverage gaps.**
  - There are no automated frontend tests; the UI was verified manually and by a production build.
  - The integration tests use the same Supabase project, isolated in a temporary schema, rather than a dedicated
    test database.

## 9. Future improvements

- Authentication (e.g. Supabase Auth) with per-user curricula and policies based on Row Level Security.
- Completed-course tracking and a personal "what can I take next?" view.
- Credit-limited term planning (bin-packing the topological levels), and OR-group / co-requisite support.
- Suggested fixes for cycles, e.g. the minimum set of relationships to remove (feedback arc set heuristics).
- Graph layout with crossing reduction (Sugiyama-style barycentric ordering).
- Frontend component and end-to-end tests (e.g. Vitest + Playwright) and a CI pipeline.
- Import and export of curricula as CSV or JSON.

## 10. Conclusion

PrereqPath shows how standard graph algorithms solve a practical planning problem. Kahn's algorithm produces a
valid course order and a term-by-term plan in O(V + E) time (an analytical bound). An independent DFS, with Tarjan's strongly connected
components, separates real cycle members from courses that are only blocked downstream. Unresolved references are
reported explicitly instead of failing silently.

The algorithms are isolated from the persistence and presentation layers. A normalized PostgreSQL schema enforces
integrity at the database level. In the last reported run, all 42 automated tests passed against the Supabase
database.
