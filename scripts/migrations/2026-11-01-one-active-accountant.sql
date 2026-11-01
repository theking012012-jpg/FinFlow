-- NEW-12 (2026-11-01): ONE active accountant per client. My Accountant shows one link, so a second activation hid the
-- first accountant's still-live books access (the client could neither see nor revoke it).
-- GUARDED (as idx_bank_line_*): where a client already has two active links the index is not built and a WARNING names
-- the read-only lister (tools/launch/list-multi-active-accountants.js) — nothing is changed here (Rule 8). Schema only.
-- initDB runs the same.
DO $oa$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_acc_clients_one_active') THEN
    IF EXISTS (SELECT 1 FROM accountant_clients WHERE status = 'active' GROUP BY user_id HAVING count(*) > 1) THEN
      RAISE WARNING 'idx_acc_clients_one_active NOT created: a client has two active accountants — run tools/launch/list-multi-active-accountants.js';
    ELSE
      CREATE UNIQUE INDEX idx_acc_clients_one_active ON accountant_clients (user_id) WHERE status = 'active';
    END IF;
  END IF;
END
$oa$;
