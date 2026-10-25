from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session

from . import config


class DatabaseNotConfigured(RuntimeError):
    pass


_engine: Engine | None = None


def normalize_url(url: str) -> str:
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def make_engine(url: str, schema: str | None = None) -> Engine:
    engine = create_engine(
        normalize_url(url),
        pool_pre_ping=True,
        pool_size=5, max_overflow=5,  # stays well inside Supabase Session Pooler client limits
        # prepare_threshold=None keeps psycopg compatible with Supabase's pgbouncer/Supavisor poolers.
        connect_args={"prepare_threshold": None, "connect_timeout": 10},
    )
    if schema:  # used by the test suite to isolate itself in a throwaway schema
        @event.listens_for(engine, "connect")
        def _set_search_path(dbapi_conn, _record):
            with dbapi_conn.cursor() as cur:
                cur.execute(f'SET search_path TO "{schema}"')
            dbapi_conn.commit()
    return engine


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = config.database_url()
        if not url:
            raise DatabaseNotConfigured(config.SETUP_HINT)
        _engine = make_engine(url)
    return _engine


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
