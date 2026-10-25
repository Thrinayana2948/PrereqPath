-- PrereqPath schema (PostgreSQL / Supabase). Safe to re-run: every statement is idempotent.
-- Run in the Supabase SQL Editor, or: python -m db.manage migrate

CREATE TABLE IF NOT EXISTS courses (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        VARCHAR(20)  NOT NULL,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    is_sample   BOOLEAN      NOT NULL DEFAULT FALSE,  -- lets "remove sample data" leave user courses alone
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT courses_code_key UNIQUE (code),
    CONSTRAINT courses_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
    CONSTRAINT courses_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS prerequisites (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- ON DELETE RESTRICT: a course with relationships cannot be deleted implicitly.
    -- The API removes its relationships explicitly (cascade=true) inside one transaction.
    prerequisite_id BIGINT NOT NULL REFERENCES courses (id) ON DELETE RESTRICT,
    dependent_id    BIGINT NOT NULL REFERENCES courses (id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT prerequisites_pair_key UNIQUE (prerequisite_id, dependent_id),  -- also indexes prerequisite_id
    CONSTRAINT prerequisites_no_self CHECK (prerequisite_id <> dependent_id)
);

CREATE INDEX IF NOT EXISTS prerequisites_dependent_idx ON prerequisites (dependent_id);

-- Project-specific name so an existing function in your database is never replaced.
CREATE OR REPLACE FUNCTION prereqpath_set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drops only this project's own trigger (no data is affected) so the script stays re-runnable.
DROP TRIGGER IF EXISTS courses_set_updated_at ON courses;
CREATE TRIGGER courses_set_updated_at
    BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION prereqpath_set_updated_at();

-- Security settings (Row Level Security) live separately in db/rls.sql.
