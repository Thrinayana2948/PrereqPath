"""API tests. The first group needs no database; the second runs against real PostgreSQL
(TEST_DATABASE_URL) inside an isolated schema that is dropped afterwards."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import db
from app.main import app
from app.sample import SAMPLE_COURSES, SAMPLE_PREREQUISITES


# ---------- no database required ----------

def test_health_reports_missing_configuration(client, no_database):
    body = client.get("/api/health").json()
    assert body["database"] == "not_configured"
    assert "DATABASE_URL" in body["detail"]


def test_data_endpoints_return_503_with_setup_hint(client, no_database):
    r = client.get("/api/courses")
    assert r.status_code == 503
    assert r.json()["code"] == "database_not_configured"


def test_cors_allows_vite_dev_server(client):
    r = client.options("/api/health", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_custom_analysis_reports_unresolved_and_normalizes_codes(client):
    r = client.post("/api/analysis/custom", json={
        "courses": ["cs101", "CS201"],
        "prerequisites": [{"prerequisite": "CS101", "dependent": "cs201"},
                          {"prerequisite": "MATH999", "dependent": "CS201"}]})
    assert r.status_code == 200
    body = r.json()
    assert body["unresolved"][0]["missing"] == ["MATH999"]
    assert body["order"] == ["CS101"]
    assert body["complete_order"] is None


def test_demo_data_is_valid_labelled_and_varied():
    from app.graph import analyze
    from app.sample import validate_sample
    validate_sample()
    codes = [c[0] for c in SAMPLE_COURSES]
    assert all("Demo data" in desc for _, _, desc in SAMPLE_COURSES)
    r = analyze(codes, SAMPLE_PREREQUISITES)
    assert r["summary"]["is_complete"] and r["summary"]["duplicate_edges"] == 0
    indegree = r["initial_indegree"]
    assert max(indegree.values()) >= 3                                  # multiple prerequisites
    assert any(code not in {p for e in SAMPLE_PREREQUISITES for p in e} for code in codes)  # independent course
    assert max(r["levels"].values()) >= 3                               # chains of length >= 4


@pytest.mark.parametrize("payload, fragment", [
    ({"courses": ["A"], "prerequisites": [{"prerequisite": "A", "dependent": "A"}]}, "own prerequisite"),
    ({"courses": ["A", "a"]}, "Duplicate course"),
])
def test_custom_analysis_rejects_invalid_graphs(client, payload, fragment):
    r = client.post("/api/analysis/custom", json=payload)
    assert r.status_code == 422 and fragment in r.json()["detail"]


@pytest.mark.parametrize("payload", [
    {"code": "", "name": "X"},
    {"code": "BAD CODE", "name": "X"},
    {"code": "A" * 21, "name": "X"},
    {"code": "CS1", "name": "   "},
    {"name": "missing code"},
])
def test_course_validation_errors(client, payload):
    app.dependency_overrides[db.get_session] = lambda: None  # validation runs before any DB access
    assert client.post("/api/courses", json=payload).status_code == 422


def test_prerequisite_self_dependency_rejected_by_validation(client):
    app.dependency_overrides[db.get_session] = lambda: None
    r = client.post("/api/prerequisites", json={"prerequisite_id": 3, "dependent_id": 3})
    assert r.status_code == 422


# ---------- PostgreSQL integration ----------

def _course(c, code, name=None):
    r = c.post("/api/courses", json={"code": code, "name": name or f"Course {code}"})
    assert r.status_code == 201, r.text
    return r.json()


def _link(c, pre, dep):
    return c.post("/api/prerequisites", json={"prerequisite_id": pre["id"], "dependent_id": dep["id"]})


def test_health_connected(db_client, pg_engine, monkeypatch):
    monkeypatch.setattr(db, "_engine", pg_engine)
    assert db_client.get("/api/health").json()["database"] == "connected"


def test_course_crud(db_client):
    created = _course(db_client, " cs101 ", "Intro")
    assert created["code"] == "CS101" and created["is_sample"] is False
    cid = created["id"]
    assert db_client.get(f"/api/courses/{cid}").json()["name"] == "Intro"
    r = db_client.patch(f"/api/courses/{cid}", json={"name": "Intro to Programming", "description": "Basics"})
    assert r.status_code == 200 and r.json()["description"] == "Basics"
    assert r.json()["updated_at"] >= created["updated_at"]
    assert [c["code"] for c in db_client.get("/api/courses").json()] == ["CS101"]
    assert db_client.delete(f"/api/courses/{cid}").status_code == 200
    assert db_client.get(f"/api/courses/{cid}").status_code == 404


def test_duplicate_course_code_conflict(db_client):
    _course(db_client, "CS101")
    assert db_client.post("/api/courses", json={"code": "cs101", "name": "Dup"}).status_code == 409
    other = _course(db_client, "CS102")
    assert db_client.patch(f"/api/courses/{other['id']}", json={"code": "CS101"}).status_code == 409


def test_prerequisite_crud_and_errors(db_client):
    a, b, c = (_course(db_client, x) for x in ("A1", "B1", "C1"))
    r = _link(db_client, a, b)
    assert r.status_code == 201 and r.json()["prerequisite_code"] == "A1"
    link_id = r.json()["id"]
    assert _link(db_client, a, b).status_code == 409                     # duplicate edge
    assert db_client.post("/api/prerequisites",
                          json={"prerequisite_id": a["id"], "dependent_id": 9999}).status_code == 404
    r = db_client.put(f"/api/prerequisites/{link_id}",
                      json={"prerequisite_id": a["id"], "dependent_id": c["id"]})
    assert r.status_code == 200 and r.json()["dependent_code"] == "C1"
    counts = {x["code"]: x for x in db_client.get("/api/courses").json()}
    assert counts["A1"]["dependent_count"] == 1 and counts["C1"]["prerequisite_count"] == 1
    assert db_client.delete(f"/api/prerequisites/{link_id}").status_code == 204
    assert db_client.delete(f"/api/prerequisites/{link_id}").status_code == 404


def test_delete_course_with_relationships_requires_explicit_cascade(db_client):
    a, b = _course(db_client, "A1"), _course(db_client, "B1")
    _link(db_client, a, b)
    r = db_client.delete(f"/api/courses/{a['id']}")
    assert r.status_code == 409 and "cascade=true" in r.json()["detail"]
    assert len(db_client.get("/api/prerequisites").json()) == 1          # nothing deleted
    r = db_client.delete(f"/api/courses/{a['id']}?cascade=true")
    assert r.json() == {"deleted": "A1", "removed_prerequisites": 1}
    assert db_client.get("/api/prerequisites").json() == []


def test_database_constraints_enforced(pg_engine):
    with pg_engine.begin() as conn:
        cid = conn.execute(text("INSERT INTO courses (code, name) VALUES ('X1', 'X') RETURNING id")).scalar()
    for sql in (
        "INSERT INTO prerequisites (prerequisite_id, dependent_id) VALUES (:i, :i)",        # self edge
        "INSERT INTO prerequisites (prerequisite_id, dependent_id) VALUES (:i, 999999)",    # dangling FK
        "INSERT INTO courses (code, name) VALUES ('X1', 'dup')",                            # unique code
        "INSERT INTO courses (code, name) VALUES ('bad code', 'x')",                        # format check
    ):
        with pytest.raises(IntegrityError), pg_engine.begin() as conn:
            conn.execute(text(sql), {"i": cid})


def test_failed_transaction_rolls_back_all_changes(pg_engine):
    with pytest.raises(IntegrityError), pg_engine.begin() as conn:
        conn.execute(text("INSERT INTO courses (code, name) VALUES ('T1', 'ok')"))
        conn.execute(text("INSERT INTO courses (code, name) VALUES ('T1', 'dup')"))
    with pg_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM courses WHERE code = 'T1'")).scalar() == 0


def test_graph_and_analysis_from_database_with_cycle(db_client):
    a, b, c, d = (_course(db_client, x) for x in ("A1", "B1", "C1", "D1"))
    for pre, dep in ((a, b), (b, c), (c, a), (c, d)):
        assert _link(db_client, pre, dep).status_code == 201
    graph = db_client.get("/api/graph").json()
    assert len(graph["nodes"]) == 4 and {"id", "source", "target"} <= graph["edges"][0].keys()
    body = db_client.get("/api/analysis").json()
    assert body["cycle_members"] == ["A1", "B1", "C1"]
    assert [x["course"] for x in body["blocked"]] == ["D1"]
    assert body["complete_order"] is None


def test_sample_load_is_repeatable_and_preserves_user_data(db_client):
    mine = _course(db_client, "ORB100", "My own ORB100")
    first = db_client.post("/api/sample/load").json()
    assert first["courses_added"] == len(SAMPLE_COURSES) - 1 and first["courses_skipped"] == 1
    again = db_client.post("/api/sample/load").json()
    assert again["courses_added"] == 0 and again["prerequisites_added"] == 0
    assert db_client.get(f"/api/courses/{mine['id']}").json()["name"] == "My own ORB100"
    links = db_client.get("/api/prerequisites").json()
    assert all(mine["id"] not in (l["prerequisite_id"], l["dependent_id"]) for l in links)


def test_sample_reset_and_remove_keep_user_courses(db_client):
    db_client.post("/api/sample/load")
    sample = next(c for c in db_client.get("/api/courses").json() if c["code"] == "ORB200")
    db_client.patch(f"/api/courses/{sample['id']}", json={"name": "edited"})
    mine = _course(db_client, "ME100")
    r = db_client.post("/api/sample/reset").json()
    assert r["courses_added"] == len(SAMPLE_COURSES) and r["prerequisites_added"] == len(SAMPLE_PREREQUISITES)
    names = {c["code"]: c["name"] for c in db_client.get("/api/courses").json()}
    assert names["ORB200"] != "edited" and "ME100" in names
    analysis = db_client.get("/api/analysis").json()
    assert analysis["summary"]["is_complete"] is True
    db_client.delete("/api/sample")
    assert [c["code"] for c in db_client.get("/api/courses").json()] == [mine["code"]]
