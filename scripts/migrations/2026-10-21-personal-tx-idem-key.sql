-- LR11 (owner decision 2026-10-21): the manual bank line form sends a per-submit idempotency key; this makes the
-- database refuse a second row with the same key (Rule 9 — protection at the write, not a guard on the button), so a
-- double-click, a retry or a second tab books the line once. Owner-salary rows already carry a unique per-run-line
-- key (syncOwnerSalaryFromRun) and are unaffected. Schema only; no row is changed. Idempotent; if a duplicate key
-- already existed the CREATE fails and this migration rolls back alone (boot continues, visible in the log).
CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_tx_idem_key
  ON personal_transactions (user_id, (data->>'idempotency_key'))
  WHERE data->>'idempotency_key' IS NOT NULL;
