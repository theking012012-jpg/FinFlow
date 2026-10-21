-- LC3c (owner decision 2026-10-20): Personal's own history, separate from the business audit trail (the wall).
-- No business column. Append-only: UPDATE always refused; DELETE only inside the account-erase transaction, which sets
-- the transaction-local flag finflow.erase_user to the user being erased. Schema only; idempotent. Same DDL as
-- personal-history.js (initDB).
CREATE TABLE IF NOT EXISTS personal_history (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  action      TEXT NOT NULL,
  record_id   INTEGER,
  before_data JSONB,
  after_data  JSONB,
  actor_type  TEXT NOT NULL DEFAULT 'user',
  actor_id    INTEGER,
  ip_address  TEXT,
  user_agent  TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personal_history_user ON personal_history (user_id, at DESC, id DESC);
CREATE OR REPLACE FUNCTION personal_history_no_mutate() RETURNS trigger LANGUAGE plpgsql AS $ph$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('finflow.erase_user', true) = OLD.user_id::text THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'personal_history is append-only (% refused)', TG_OP;
END $ph$;
DROP TRIGGER IF EXISTS personal_history_no_mutate ON personal_history;
CREATE TRIGGER personal_history_no_mutate BEFORE UPDATE OR DELETE ON personal_history
  FOR EACH ROW EXECUTE FUNCTION personal_history_no_mutate();
