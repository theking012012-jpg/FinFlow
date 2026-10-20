-- LC3g (owner decision 2026-10-20): every admin action records who / where / what changed / outcome, and the
-- admin log is APPEND-ONLY (the same database-level guarantee as audit_trail). Idempotent; no data is changed.
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS ip          TEXT;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS user_agent  TEXT;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS session_ref TEXT;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS before_data JSONB;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS after_data  JSONB;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS outcome     TEXT;
CREATE OR REPLACE FUNCTION admin_log_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'admin_log is append-only: % is not permitted', TG_OP; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS admin_log_no_mutate ON admin_log;
CREATE TRIGGER admin_log_no_mutate BEFORE UPDATE OR DELETE ON admin_log FOR EACH ROW EXECUTE FUNCTION admin_log_immutable();
