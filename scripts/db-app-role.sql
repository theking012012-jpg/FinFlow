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
-- Usage (as the database owner — AFTER `node scripts/migrate.js`, so the tables exist; re-run after any release that
-- adds a table only if default privileges were not in place):
--   psql "$OWNER_DATABASE_URL" -v app_pw='a-strong-password' -f scripts/db-app-role.sql
--   (no psql? OWNER_ACTIONS §11 has a node one-liner)
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

-- NEW-23 — the history tables. The app never deletes an audit row or edits the admin log, so it cannot. It keeps
-- UPDATE on audit_trail only for the 90-day sign-in IP removal (LC3d-b), which audit_trail_immutable() still limits to
-- exactly that change; DELETE on personal_history only for account erasure (personal_history_no_mutate limits it).
-- TRUNCATE (which skips row triggers) is never granted on any table; revoked here explicitly for these three.
-- (Each only if the table exists — run this after scripts/migrate.js so they do; re-running is harmless.)
DO $$
BEGIN
  IF to_regclass('public.audit_trail')      IS NOT NULL THEN REVOKE DELETE, TRUNCATE ON audit_trail FROM finflow_app; END IF;
  IF to_regclass('public.admin_log')        IS NOT NULL THEN REVOKE UPDATE, DELETE, TRUNCATE ON admin_log FROM finflow_app; END IF;
  IF to_regclass('public.personal_history') IS NOT NULL THEN REVOKE TRUNCATE ON personal_history FROM finflow_app; END IF;
END $$;
-- Not the owner of any table or function, so it cannot ALTER TABLE … DISABLE TRIGGER, DROP TRIGGER, or replace the
-- audit functions; SET session_replication_role (which skips triggers) needs superuser. All executed in
-- tests/harness/verify-new23-app-role-real-schema.js.

-- Explicitly NOT granted: CREATE on schema, ownership, SUPERUSER, CREATEROLE, CREATEDB.
-- Verify:  \du finflow_app     (should show no attributes / "Cannot login" false, no Superuser)
