-- FA-L3d (2026-10-24): referral pay sent by Stripe Connect transfer. Same statements database.js runs at boot
-- (idempotent). One new table and one new nullable column; no existing row is changed.
CREATE TABLE IF NOT EXISTS referral_payouts (
  id                 SERIAL PRIMARY KEY,
  accountant_id      INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
  period_month       DATE NOT NULL,
  amount_cents       INTEGER NOT NULL,
  currency           VARCHAR(3) NOT NULL DEFAULT 'usd',
  status             VARCHAR(12) NOT NULL DEFAULT 'claimed',
  stripe_transfer_id TEXT,
  attempts           INTEGER NOT NULL DEFAULT 1,
  last_error         TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  sent_at            TIMESTAMPTZ,
  UNIQUE (accountant_id, period_month)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_payouts_one_open ON referral_payouts (accountant_id) WHERE status IN ('claimed', 'failed');
ALTER TABLE accountant_earnings ADD COLUMN IF NOT EXISTS payout_id INTEGER REFERENCES referral_payouts(id) ON DELETE SET NULL;
