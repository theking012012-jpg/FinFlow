-- FA-L3e: accountant bills can be in the client's currency, so every earning records its currency; all amounts on the
-- row (billed, fee, commission, net, refunded) are in it. Rows before this are USD by construction (the bill form sent
-- no currency, bill-client defaulted to 'usd'; referral pay is USD). Idempotent; mirrors database.js initDB().
ALTER TABLE accountant_earnings ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'usd';
