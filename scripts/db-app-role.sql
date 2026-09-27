-- ============================================================================
-- FinFlow — least-privilege application DB role  (Ops hardening, F202)
-- ============================================================================
-- Goal: the app connects as a role that can READ/WRITE DATA but cannot DROP or
-- ALTER schema, manage roles, or superuser anything — so a leaked app credential
-- cannot destroy the books or the schema.
--
-- initDB() runs CREATE TABLE IF NOT EXISTS + migrations at boot, which need DDL.
-- Recommended prod split:
--   • run migrations as the OWNER (a deploy/admin step), and
--   • run the app as finflow_app (no DDL).
-- The migration runner (database.js runMigrations) can run under the owner in CI/deploy;
-- the web process uses DATABASE_URL pointed at finflow_app.
--
-- Usage (as the database owner):
--   psql "$OWNER_DATABASE_URL" -v app_pw='a-strong-password' -f scripts/db-app-role.sql
-- Then set the app's DATABASE_URL to connect as finflow_app.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finflow_app') THEN
    EXECUTE format('CREATE ROLE finflow_app LOGIN PASSWORD %L', :'app_pw');
  ELSE
    EXECUTE format('ALTER ROLE finflow_app LOGIN PASSWORD %L', :'app_pw');
  END IF;
END $$;

-- Schema usage, but NOT create/drop objects. (CONNECT is granted to PUBLIC by default on managed
-- Postgres incl. Railway; if your DB revoked it, run:  GRANT CONNECT ON DATABASE <dbname> TO finflow_app;)
GRANT USAGE ON SCHEMA public TO finflow_app;
-- Belt-and-braces: make sure finflow_app can never create objects directly in the public schema.
REVOKE CREATE ON SCHEMA public FROM finflow_app;

-- Data-plane rights on everything that exists now …
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO finflow_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES  IN SCHEMA public TO finflow_app;

-- … and on everything the owner creates later (so new tables from migrations are usable
-- without re-granting). Run as the role that OWNS the tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO finflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT                  ON SEQUENCES TO finflow_app;

-- Explicitly NOT granted: CREATE on schema, ownership, SUPERUSER, CREATEROLE, CREATEDB.
-- Verify:  \du finflow_app     (should show no attributes / "Cannot login" false, no Superuser)
