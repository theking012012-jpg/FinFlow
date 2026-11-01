-- LC3g-b (owner decision 2026-11-01): named admin accounts, each with its own password and REQUIRED 2FA, and every
-- admin_log row names the admin who acted. Idempotent; no existing row is changed. Mirrors database.js initDB().
CREATE TABLE IF NOT EXISTS admin_users (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin')),
  password_hash  TEXT NOT NULL,
  totp_secret    TEXT,
  totp_last_step BIGINT,
  must_setup     BOOLEAN NOT NULL DEFAULT TRUE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by     INTEGER,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users (lower(email));
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS admin_id   INTEGER;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS admin_name TEXT;
