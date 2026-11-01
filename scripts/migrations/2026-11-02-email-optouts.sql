-- Product-news unsubscribes (owner decisions 2026-11-01, Privacy Policy rewrite): an address here never receives a
-- "product news" broadcast; service notices about the account still go. Keyed by lower-case email so it covers users,
-- accountants and anyone else. Idempotent; mirrors database.js initDB().
CREATE TABLE IF NOT EXISTS email_optouts (
  email      TEXT PRIMARY KEY,
  topic      TEXT NOT NULL DEFAULT 'news',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
