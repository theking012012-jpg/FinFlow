-- LR1 (owner decision 2026-10-21: a voided period may be run again — "void, then re-run" — with the new run linked to
-- the one it replaces). Schema only; no row is changed.
--
-- idx_payroll_runs_uniq (2026-07-25) allowed ONE run per (user, business, period) of ANY status, so a period whose
-- run had been voided could never be paid again. It now allows one LIVE run per period: voided runs are left out of
-- the index, so a double-click or a second tab still cannot create two live runs for the same month (Rule 9 — the
-- guarantee stays at the database). A run created for a period that has a voided run records it in replaces_run_id.
--
-- Idempotent. If a database somehow holds two live runs for one period the CREATE fails, this migration rolls back
-- as a whole (the old index stays) and boot continues — visible in the log, never a bricked boot.
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS replaces_run_id INTEGER;
DROP INDEX IF EXISTS idx_payroll_runs_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_live_period
  ON payroll_runs (user_id, COALESCE(entity_id, 0), period)
  WHERE lower(COALESCE(status, '')) <> 'voided';
