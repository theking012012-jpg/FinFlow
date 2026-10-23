-- B7b / G2 (2026-10-23): saved statement reconciliations per business. "Finish reconciliation" used to keep the result
-- in browser memory only. Each bank line it clears also carries data.reconciliation_id (personal_transactions JSONB —
-- no column needed), which locks the line. Undone reconciliations stay (status 'undone'). Schema only: a NEW table and
-- its indexes; no existing row is touched.
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL,
  entity_id         INTEGER NOT NULL,
  statement_date    DATE NOT NULL,
  statement_balance NUMERIC(14,2) NOT NULL,
  cleared_total     NUMERIC(14,2) NOT NULL,
  line_ids          INTEGER[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'complete',
  created_by        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  undone_by         TEXT,
  undone_at         TIMESTAMPTZ,
  idempotency_key   TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_recons_scope ON bank_reconciliations(user_id, entity_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_recons_idem ON bank_reconciliations(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
