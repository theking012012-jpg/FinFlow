-- D-E (2026-10-24): a concern report carries the date FinFlow promised to acknowledge it by (2 business days, conduct
-- policy §9), when it was acknowledged, and when the accountant was told. Same statements database.js runs at boot
-- (idempotent). New columns only; existing reports keep NULLs (no deadline was promised in code before).
ALTER TABLE accountant_reports ADD COLUMN IF NOT EXISTS respond_by TIMESTAMPTZ;
ALTER TABLE accountant_reports ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE accountant_reports ADD COLUMN IF NOT EXISTS accountant_notified_at TIMESTAMPTZ;
