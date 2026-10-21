-- LR1 follow-up (owner decision 2026-10-21, option B): a period whose run was VOIDED may get a new run.
-- idx_payroll_runs_uniq enforced one run per (user, business, period) INCLUDING voided runs, so a voided period could
-- never be re-run. Recreate it partial: voided runs no longer count; every other status still allows one run per period.
-- Safe on existing data: the new rule is strictly looser than the old one, so the build cannot fail. Schema only.
-- (The 2026-07-25 one-shot created the old index; this file sorts after it, so a fresh database ends with this one.)
DROP INDEX IF EXISTS idx_payroll_runs_uniq;
CREATE UNIQUE INDEX idx_payroll_runs_uniq
  ON payroll_runs (user_id, COALESCE(entity_id, 0), period)
  WHERE lower(COALESCE(status, '')) <> 'voided';
