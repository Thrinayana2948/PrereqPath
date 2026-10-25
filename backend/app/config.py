import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")  # never overrides variables already set in the environment

SETUP_HINT = (
    "Database is not configured. Copy backend/.env.example to backend/.env, set DATABASE_URL to "
    "your Supabase Session Pooler connection string (dashboard -> Connect -> Session pooler), "
    "run backend/db/schema.sql in the Supabase SQL Editor, then restart the API."
)


def database_url() -> str | None:
    return os.getenv("DATABASE_URL") or None


def cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [o.strip() for o in raw.split(",") if o.strip()]
