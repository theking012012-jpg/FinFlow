-- F90 (2026-11-02): the audit trail is written AT THE DATABASE, in the same transaction as each change (part 1),
-- and every entry is fingerprinted and chained to the one before (part 4 — tamper evidence).
-- Mirrors audit-trigger.js ensureSchema() (initDB runs the same). Idempotent; reads and changes no existing row.
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS changed_fields TEXT[];
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS request_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_trail_record ON audit_trail (table_name, record_id);

-- the record as people read it: typed columns + the JSONB data column's keys (columns win), secrets and blobs out
CREATE OR REPLACE FUNCTION ff_audit_flat(j JSONB) RETURNS JSONB AS $$
DECLARE r JSONB; k TEXT; v JSONB;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  r := j;
  IF jsonb_typeof(j -> 'data') = 'object' THEN r := (j -> 'data') || (j - 'data'); END IF;
  FOR k, v IN SELECT * FROM jsonb_each(r) LOOP
    IF k ~* '(password|secret|token|_hash$|totp)' THEN
      r := r - k;
    ELSIF k IN ('file_data', 'att_data', 'content_base64', 'data_url') THEN
      r := r - k;                                       -- an uploaded file's bytes, whatever their size (its name / size stay)
    ELSIF jsonb_typeof(v) = 'string' AND length(v #>> '{}') > 2000 THEN
      r := jsonb_set(r, ARRAY[k], to_jsonb('[' || length(v #>> '{}') || ' characters]'));
    END IF;
  END LOOP;
  RETURN r;
END $$ LANGUAGE plpgsql IMMUTABLE;

-- keys whose change is bookkeeping by the app itself, not a change anyone made to the record (a document's NUMBER is
-- recorded: it is given right after creation, in the same request, so the trail shows it as part of the creation)
CREATE OR REPLACE FUNCTION ff_audit_ignored(tbl TEXT, k TEXT, oldv JSONB) RETURNS BOOLEAN AS $$
  SELECT k IN ('updated_at', 'created_at')
      OR (tbl = 'entities' AND (k = 'is_active' OR k ~ '_seq$'))                      -- the business in view; number counters
      OR (tbl = 'accountant_clients' AND k IN ('client_last_read', 'accountant_last_read'))   -- read receipts
      OR (tbl = 'customer_portal_links' AND k IN ('last_viewed_at', 'view_count'))   -- a customer looking at a link
      OR (tbl = 'inventory' AND k IN ('last_restock_qty', 'last_restock_at'))       -- the restock double-click marker (B8)
      OR (k IN ('customer_id', 'vendor_id') AND (oldv IS NULL OR oldv = 'null'::jsonb))   -- the contact record linked at creation
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION ff_audit_row() RETURNS trigger AS $$
DECLARE ctx JSONB; o JSONB; n JSONB; rec JSONB; chg TEXT[]; uid INT; eid INT;
BEGIN
  BEGIN ctx := NULLIF(current_setting('finflow.ctx', true), '')::jsonb; EXCEPTION WHEN others THEN ctx := NULL; END;
  IF TG_OP <> 'INSERT' THEN o := ff_audit_flat(to_jsonb(OLD)); END IF;
  IF TG_OP <> 'DELETE' THEN n := ff_audit_flat(to_jsonb(NEW)); END IF;
  rec := COALESCE(n, o);
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO chg
      FROM (SELECT jsonb_object_keys(n) AS k UNION SELECT jsonb_object_keys(o)) ks
     WHERE (n -> k) IS DISTINCT FROM (o -> k) AND NOT ff_audit_ignored(TG_TABLE_NAME, k, o -> k);
    IF chg IS NULL THEN RETURN NULL; END IF;          -- nothing anyone changed
  END IF;
  uid := CASE WHEN rec ->> 'user_id' ~ '^[0-9]+$' THEN (rec ->> 'user_id')::int END;
  eid := CASE WHEN rec ->> 'entity_id' ~ '^[0-9]+$' THEN (rec ->> 'entity_id')::int END;
  IF TG_TABLE_NAME = 'payroll_run_lines' THEN
    SELECT r.user_id, r.entity_id INTO uid, eid FROM payroll_runs r WHERE r.id = (rec ->> 'run_id')::int;
  END IF;
  IF uid IS NULL THEN RETURN NULL; END IF;            -- not any account's books (e.g. the shared live FX table)
  IF current_setting('finflow.erase_user', true) = uid::text THEN RETURN NULL; END IF;   -- the account is being erased (N18): ACCOUNT_DELETED is its record
  INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, old_data, new_data, changed_fields,
                           actor_type, actor_id, ip_address, user_agent, source, request_id)
  VALUES (uid, eid, TG_TABLE_NAME, CASE WHEN rec ->> 'id' ~ '^[0-9]+$' THEN (rec ->> 'id')::int END,
          CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'UPDATE' THEN 'UPDATE' ELSE 'DELETE' END,
          o, n, chg,
          COALESCE(ctx ->> 't', 'system'),
          CASE WHEN ctx ->> 'a' ~ '^[0-9]+$' THEN (ctx ->> 'a')::int END,
          ctx ->> 'ip', ctx ->> 'ua', COALESCE(ctx ->> 'src', 'database'), ctx ->> 'rid');
  RETURN NULL;
END $$ LANGUAGE plpgsql;

ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS chain_seq BIGINT;
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS row_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_trail_chain ON audit_trail (COALESCE(user_id, 0), chain_seq) WHERE chain_seq IS NOT NULL;

CREATE OR REPLACE FUNCTION ff_audit_content(a audit_trail) RETURNS TEXT AS $$
  SELECT jsonb_build_object(
    'u', a.user_id, 'e', a.entity_id, 't', a.table_name, 'r', a.record_id, 'a', a.action, 'f', a.field_name,
    'ov', a.old_value, 'nv', a.new_value, 'od', a.old_data, 'nd', a.new_data, 'at', a.actor_type, 'ai', a.actor_id,
    'w', to_char(a.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 's', a.source, 'cf', a.changed_fields,
    'q', a.request_id, 'n', a.chain_seq, 'p', a.prev_hash)::text
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION ff_audit_chain() RETURNS trigger AS $$
DECLARE last RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ff_audit_chain'), COALESCE(NEW.user_id, 0));
  SELECT chain_seq, row_hash INTO last FROM audit_trail
   WHERE user_id IS NOT DISTINCT FROM NEW.user_id AND chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1;
  NEW.changed_at := COALESCE(NEW.changed_at, NOW());
  NEW.chain_seq := COALESCE(last.chain_seq, 0) + 1;
  NEW.prev_hash := last.row_hash;
  NEW.row_hash := encode(sha256(convert_to(ff_audit_content(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Walk one account's chain: the first entry that does not hold (its own hash, or the link to the one before it, or a
-- missing number), with what was found.
CREATE OR REPLACE FUNCTION ff_audit_verify(acct INTEGER)
RETURNS TABLE (entries BIGINT, legacy BIGINT, bad_id INTEGER, bad_seq BIGINT, reason TEXT, head_seq BIGINT, head_hash TEXT) AS $$
  WITH c AS (
    SELECT a.id, a.chain_seq, a.prev_hash, a.row_hash,
           encode(sha256(convert_to(ff_audit_content(a), 'UTF8')), 'hex') AS recomputed,
           lag(a.row_hash) OVER (ORDER BY a.chain_seq) AS prev_row_hash,
           lag(a.chain_seq) OVER (ORDER BY a.chain_seq) AS prev_seq
      FROM audit_trail a WHERE a.user_id IS NOT DISTINCT FROM acct AND a.chain_seq IS NOT NULL),
  bad AS (
    SELECT id, chain_seq,
           CASE WHEN recomputed IS DISTINCT FROM row_hash THEN 'changed'
                WHEN chain_seq <> COALESCE(prev_seq, 0) + 1 THEN 'missing_before'
                WHEN prev_hash IS DISTINCT FROM prev_row_hash THEN 'missing_before' END AS reason
      FROM c)
  SELECT (SELECT count(*) FROM c),
         (SELECT count(*) FROM audit_trail WHERE user_id IS NOT DISTINCT FROM acct AND chain_seq IS NULL),
         b.id, b.chain_seq, b.reason,
         (SELECT max(chain_seq) FROM c), (SELECT row_hash FROM c ORDER BY chain_seq DESC LIMIT 1)
    FROM (SELECT * FROM bad WHERE reason IS NOT NULL ORDER BY chain_seq LIMIT 1) b
   RIGHT JOIN (SELECT 1) one ON true
$$ LANGUAGE sql STABLE;

DROP TRIGGER IF EXISTS audit_trail_chain ON audit_trail;
CREATE TRIGGER audit_trail_chain BEFORE INSERT ON audit_trail FOR EACH ROW EXECUTE FUNCTION ff_audit_chain();

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'invoice_payments', 'expenses', 'bills', 'payments_made', 'payments_received', 'sales_receipts', 'credit_notes', 'vendor_credits', 'credit_applications', 'customers', 'vendors', 'items', 'inventory', 'inventory_movements', 'payroll', 'payroll_runs', 'payroll_run_lines', 'journals', 'chart_of_accounts', 'quotes', 'projects', 'timesheet', 'budget_targets', 'recurring_invoices', 'recurring_bills', 'bank_reconciliation', 'bank_reconciliations', 'bank_ledger_accounts', 'fx_rates', 'fx_transactions', 'autocat_rules', 'entities', 'lock_settings', 'accountant_clients', 'team_members', 'documents', 'templates', 'customer_portal_links'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS ff_audit ON %I', t);
      EXECUTE format('CREATE TRIGGER ff_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ff_audit_row()', t);
    END IF;
  END LOOP;
END $$;
