-- FA-B10b (2026-10-27): a customer's private portal link (see invoices, statement, pay online). Same statements
-- database.js runs at boot (idempotent). A new table only; no existing row is touched.
CREATE TABLE IF NOT EXISTS customer_portal_links (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, entity_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, token_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ, view_count INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_customer_portal_links_customer ON customer_portal_links (user_id, customer_id);
