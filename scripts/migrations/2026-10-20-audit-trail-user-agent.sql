-- LC3d (owner decision 2026-10-20): every audit row records the browser / device it came from, so the security log
-- can show "Safari on iPhone" and detect a sign-in from a device never seen before. Schema only; idempotent.
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS user_agent TEXT;
