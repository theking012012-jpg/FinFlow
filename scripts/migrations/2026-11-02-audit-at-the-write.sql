-- F90 (2026-11-02): the audit trail is written AT THE DATABASE, in the same transaction as each change.
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

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'invoice_payments', 'expenses', 'bills', 'payments_made', 'payments_received', 'sales_receipts', 'credit_notes', 'vendor_credits', 'credit_applications', 'customers', 'vendors', 'items', 'inventory', 'inventory_movements', 'payroll', 'payroll_runs', 'payroll_run_lines', 'journals', 'chart_of_accounts', 'quotes', 'projects', 'timesheet', 'budget_targets', 'recurring_invoices', 'recurring_bills', 'bank_reconciliation', 'bank_reconciliations', 'bank_ledger_accounts', 'fx_rates', 'fx_transactions', 'autocat_rules', 'entities', 'lock_settings', 'accountant_clients', 'team_members', 'documents', 'templates', 'customer_portal_links'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS ff_audit ON %I', t);
      EXECUTE format('CREATE TRIGGER ff_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ff_audit_row()', t);
    END IF;
  END LOOP;
END $$;
