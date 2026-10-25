import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, OperationalError, ProgrammingError

from . import config
from .db import DatabaseNotConfigured, get_engine
from .routers import analysis, courses, prerequisites

log = logging.getLogger("prereqpath")
SCHEMA_HINT = "Database tables are missing. Run backend/db/schema.sql in the Supabase SQL Editor (or `python -m db.manage migrate`)."

app = FastAPI(title="PrereqPath API", version="1.0.0",
              description="Smart Course Dependency Planner. No authentication is implemented.")
app.add_middleware(CORSMiddleware, allow_origins=config.cors_origins(),
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(DatabaseNotConfigured)
def _not_configured(_: Request, exc: DatabaseNotConfigured):
    return JSONResponse(status_code=503, content={"detail": str(exc), "code": "database_not_configured"})


@app.exception_handler(OperationalError)
def _unreachable(_: Request, exc: OperationalError):
    log.error("Database unreachable: %s", exc.orig.__class__.__name__)
    return JSONResponse(status_code=503, content={
        "detail": "Database is unreachable. Check DATABASE_URL, network access and that the Supabase project is running.",
        "code": "database_unreachable"})


@app.exception_handler(ProgrammingError)
def _programming(_: Request, exc: ProgrammingError):
    if getattr(exc.orig, "sqlstate", None) == "42P01":  # undefined_table
        return JSONResponse(status_code=503, content={"detail": SCHEMA_HINT, "code": "schema_missing"})
    log.exception("Database error")
    return JSONResponse(status_code=500, content={"detail": "Database error"})


@app.get("/api/health", tags=["health"])
def health():
    try:
        engine = get_engine()
    except DatabaseNotConfigured as exc:
        return {"status": "ok", "database": "not_configured", "detail": str(exc)}
    try:
        with engine.connect() as conn:
            ready = conn.execute(text("SELECT to_regclass('courses') IS NOT NULL "
                                      "AND to_regclass('prerequisites') IS NOT NULL")).scalar()
    except DBAPIError:
        return {"status": "ok", "database": "unreachable",
                "detail": "Database is unreachable. Check DATABASE_URL and network access."}
    if not ready:
        return {"status": "ok", "database": "schema_missing", "detail": SCHEMA_HINT}
    return {"status": "ok", "database": "connected"}


app.include_router(courses.router)
app.include_router(prerequisites.router)
app.include_router(analysis.router)
