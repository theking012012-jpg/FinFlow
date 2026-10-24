-- D-D (2026-10-23): closed months' SaaS figures, frozen per business. Same statement database.js runs at boot (idempotent).
-- New table only; no existing row is changed.
CREATE TABLE IF NOT EXISTS saas_snapshots (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  entity_id  INTEGER NOT NULL,
  month      VARCHAR(7) NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, entity_id, month)
);
