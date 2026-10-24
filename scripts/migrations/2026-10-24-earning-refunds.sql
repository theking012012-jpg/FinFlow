-- FA-L3i (2026-10-24): the refunded / lost-dispute part of a client-paid accountant bill, minor units, cumulative.
-- Same statement database.js runs at boot. New column only; existing rows keep NULL (nothing was refunded in code).
ALTER TABLE accountant_earnings ADD COLUMN IF NOT EXISTS refunded_cents INTEGER;
