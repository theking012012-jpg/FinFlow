-- LA23b — DATA CLEAN-UP (Rule 8: its own commit; owner approved 2026-10-15: "stop it + clear old rows").
-- Clears the dead 'TT' label that the old column default stamped on every existing payroll run. Touches ONLY rows whose
-- jurisdiction is exactly 'TT' (the default's value); any other value is left as it is. No figure reads this column.
-- Known on production before this runs (owner's audit account, read-only probes / Cowork 2026-10-14): runs #1, #2, #3.
-- Idempotent: a second run finds nothing to change.
UPDATE payroll_runs SET jurisdiction = NULL WHERE jurisdiction = 'TT';
