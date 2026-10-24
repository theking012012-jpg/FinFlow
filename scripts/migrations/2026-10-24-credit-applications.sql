-- FA-M6b (2026-10-24): a credit note applied to an invoice / a vendor credit applied to a bill. Same statements
-- database.js runs at boot (idempotent). New table only; no existing row is changed. A replayed request (same
-- idempotency key) finds its first application (Rule 9).
CREATE TABLE IF NOT EXISTS credit_applications (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, entity_id INTEGER,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('credit_note', 'vendor_credit')),
  credit_id INTEGER NOT NULL, doc_id INTEGER NOT NULL, amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  applied_date DATE NOT NULL, idempotency_key VARCHAR(64), created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_credit_applications_doc ON credit_applications (user_id, kind, doc_id);
CREATE INDEX IF NOT EXISTS idx_credit_applications_credit ON credit_applications (user_id, kind, credit_id);
