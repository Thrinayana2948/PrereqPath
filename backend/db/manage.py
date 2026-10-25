"""Database helper. Run from backend/:  python -m db.manage migrate | seed"""
import sys
from pathlib import Path

from sqlalchemy.orm import Session

from app.db import DatabaseNotConfigured, get_engine
from app.sample import load_sample

SCHEMA = Path(__file__).with_name("schema.sql")


def migrate(engine) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql(SCHEMA.read_text(encoding="utf-8"))
    print("Schema applied.")


def seed(engine) -> None:
    with Session(engine) as session, session.begin():
        print("Sample data:", load_sample(session))


def main() -> int:
    commands = {"migrate": migrate, "seed": seed}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print("usage: python -m db.manage [migrate|seed]")
        return 2
    try:
        engine = get_engine()
    except DatabaseNotConfigured as exc:
        print(exc)
        return 1
    commands[sys.argv[1]](engine)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
