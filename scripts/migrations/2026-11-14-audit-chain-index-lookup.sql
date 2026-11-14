-- N3-31 (2026-11-14): the audit trail's tamper-evidence chain (2026-11-02-audit-at-the-write.sql) found the account's
-- latest entry with `user_id IS NOT DISTINCT FROM NEW.user_id … ORDER BY chain_seq DESC LIMIT 1`. Its index,
-- idx_audit_trail_chain, is on (COALESCE(user_id, 0), chain_seq) — a form that predicate cannot use, so EVERY audit
-- entry (every audited write in the app) scanned and sorted the account's whole trail first: 2.4 ms at 10,000 entries,
-- growing for the life of the account (executed: 5,000 entries took 2.7 s into an empty account, 8.1 s into one holding
-- 5,000). Now looked up in the index's own form: one index step.
-- WHAT IS HASHED IS UNCHANGED (ff_audit_content is not touched), so every existing chain still verifies. The account
-- key is the one the unique index and the advisory lock already use (NULL and 0 are one chain; no user has id 0).
-- Function only — no row is read, changed or deleted (Rule 8). audit-trigger.js CHAIN_SQL (run at boot) holds the same.
CREATE OR REPLACE FUNCTION ff_audit_chain() RETURNS trigger AS $$
DECLARE last RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ff_audit_chain'), COALESCE(NEW.user_id, 0));
  SELECT chain_seq, row_hash INTO last FROM audit_trail
   WHERE COALESCE(user_id, 0) = COALESCE(NEW.user_id, 0) AND chain_seq IS NOT NULL
   ORDER BY COALESCE(user_id, 0) DESC, chain_seq DESC LIMIT 1;
  NEW.changed_at := COALESCE(NEW.changed_at, NOW());
  NEW.chain_seq := COALESCE(last.chain_seq, 0) + 1;
  NEW.prev_hash := last.row_hash;
  NEW.row_hash := encode(sha256(convert_to(ff_audit_content(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
