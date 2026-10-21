-- LR11 (2026-10-21): manual bank lines (POST /api/banking → personal_transactions, source 'banking') carry a per-submit
-- idempotency token; this partial unique index makes a retried / double-clicked submit land once (Rule 9).
-- Partial on non-NULL keys: no existing row carries a token, so it builds over current data unchanged. Schema only.
CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_transactions_idem_key
  ON personal_transactions (user_id, (data->>'idempotency_key'))
  WHERE data->>'idempotency_key' IS NOT NULL;
