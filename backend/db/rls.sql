-- OPTIONAL, recommended for Supabase. Run after schema.sql.
-- Supabase exposes public-schema tables through its REST API using the anon key. Enabling RLS with
-- no policies blocks that API from reading or writing these tables. The FastAPI backend connects as
-- the table owner (postgres), which bypasses RLS, so the app keeps working.
-- Revert with: ALTER TABLE courses DISABLE ROW LEVEL SECURITY; (same for prerequisites)
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE prerequisites ENABLE ROW LEVEL SECURITY;
