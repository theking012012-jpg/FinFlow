-- D-E (2026-10-23): Professional Conduct Policy acceptance. Same statements database.js runs at boot (idempotent).
-- Adds columns only; no existing row is changed. Existing accountants are asked to accept at their next sign-in.
ALTER TABLE accountants ADD COLUMN IF NOT EXISTS conduct_version VARCHAR(20);
ALTER TABLE accountants ADD COLUMN IF NOT EXISTS conduct_accepted_at TIMESTAMPTZ;
ALTER TABLE accountants ADD COLUMN IF NOT EXISTS conduct_prompted_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS conduct_acceptances (
  id            SERIAL PRIMARY KEY,
  accountant_id INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
  version       VARCHAR(20) NOT NULL,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip            TEXT,
  UNIQUE (accountant_id, version)
);
