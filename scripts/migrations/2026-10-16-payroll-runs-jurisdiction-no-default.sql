-- LA23a (live audit follow-up; owner decision 2026-10-15). payroll_runs.jurisdiction is a dead column left by the
-- removed multi-jurisdiction tax engine: nothing writes or reads it, but its default 'TT' labelled EVERY new payroll
-- run — on any business, in any country — as Trinidad & Tobago. Schema only: new runs carry NULL. Existing rows are
-- cleared separately (2026-10-16-payroll-runs-jurisdiction-clear-tt.sql, Rule 8). Idempotent.
ALTER TABLE payroll_runs ALTER COLUMN jurisdiction DROP DEFAULT;
