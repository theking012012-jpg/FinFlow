-- FA-B1 (2026-10-24): every automatic customer email is claimed here once before it is sent (Rule 9). Same statement
-- database.js runs at boot (idempotent). New table only; no existing row is changed.
CREATE TABLE IF NOT EXISTS auto_email_log (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, entity_id INTEGER, kind VARCHAR(24) NOT NULL, ref_id TEXT NOT NULL,
  stage VARCHAR(24) NOT NULL, to_addr TEXT, status VARCHAR(12) NOT NULL DEFAULT 'claimed', created_at TIMESTAMPTZ DEFAULT NOW(), sent_at TIMESTAMPTZ,
  UNIQUE (user_id, entity_id, kind, ref_id, stage)
);
