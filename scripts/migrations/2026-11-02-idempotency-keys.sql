-- C1 / F92 / Rule 9: the ONE idempotency store every mutating /api request goes through (idempotency.js). A key is
-- claimed once per actor (the unique key decides — no time window); the first request's response is stored and
-- replayed to any repeat. Rows are removed after 24 hours by the daily job. Idempotent; mirrored by database.js initDB().
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              BIGSERIAL PRIMARY KEY,
  actor           TEXT NOT NULL,
  key             TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  response_status INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  UNIQUE (actor, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys (created_at);
