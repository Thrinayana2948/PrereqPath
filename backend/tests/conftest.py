import os
import re
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import make_url, text
from sqlalchemy.orm import Session

from app import db
from app.main import app

SCHEMA_SQL = (Path(__file__).resolve().parent.parent / "db" / "schema.sql").read_text(encoding="utf-8")


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def no_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(db, "_engine", None)


TEST_SCHEMA_RE = re.compile(r"^prereqpath_test_[0-9a-f]{8}$")
TRANSACTION_POOLER_PORT = 6543  # session-level SET search_path is not reliable there


def _assert_test_schema(conn, schema: str) -> None:
    """Abort unless this connection resolves unqualified names to the temporary test schema."""
    current = conn.execute(text("SELECT current_schema()")).scalar()
    if not TEST_SCHEMA_RE.fullmatch(schema) or current != schema:
        pytest.exit(f"Safety check failed: connection targets schema {current!r}, expected the "
                    "temporary test schema. Aborting before touching any data.", returncode=3)


@pytest.fixture(scope="session")
def pg_engine():
    """Engine bound to a throwaway schema; requires TEST_DATABASE_URL, otherwise DB tests skip."""
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set; skipping PostgreSQL integration tests")
    if make_url(db.normalize_url(url)).port == TRANSACTION_POOLER_PORT:
        pytest.exit("TEST_DATABASE_URL uses the Supabase transaction pooler (port 6543). Use the "
                    "Session Pooler (port 5432) so the test schema isolation is reliable.", returncode=3)

    schema = f"prereqpath_test_{uuid.uuid4().hex[:8]}"
    admin = db.make_engine(url)
    created = False
    try:
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))  # fails if it exists, so we never adopt one
        created = True
        engine = db.make_engine(url, schema=schema)
        engine.test_schema = schema
        try:
            with engine.connect() as conn:
                _assert_test_schema(conn, schema)
            # Without parameters, psycopg sends the whole script as one simple query, which
            # allows multiple statements (including the $$-quoted function body).
            raw = engine.raw_connection()
            try:
                with raw.cursor() as cur:
                    cur.execute(SCHEMA_SQL)
                raw.commit()
            finally:
                raw.close()
            yield engine
        finally:
            engine.dispose()
    finally:
        # Drop only the schema this fixture created, and only if its name matches the test pattern.
        if created and TEST_SCHEMA_RE.fullmatch(schema):
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.fixture
def db_client(pg_engine, client):
    schema = pg_engine.test_schema
    with pg_engine.begin() as conn:
        _assert_test_schema(conn, schema)
        # Schema-qualified, so it can only ever reach the temporary schema's tables.
        conn.execute(text(f'TRUNCATE "{schema}".prerequisites, "{schema}".courses RESTART IDENTITY'))

    def session_override():
        with Session(pg_engine) as s:
            yield s

    app.dependency_overrides[db.get_session] = session_override
    return client
