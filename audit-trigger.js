'use strict';
// F90 — the audit trail is written AT THE DATABASE, in the same transaction as the change.
//
// Before: each route had to remember to call recordAudit() after its write, in a separate statement whose failure was
// swallowed. Measured 2026-11-02 (tests/harness/auditShadow.js over 54 harnesses): payments, stock movements, FX rates,
// period locks, accountant access changes and others landed with no audit row, and any new route could ship unrecorded.
//
// Now: an AFTER ROW trigger on every table that holds a business's books, its records, or who can see them writes one
// audit_trail row per real change — CREATE / UPDATE / DELETE, the record before and after (flattened: the JSONB `data`
// column's keys beside the typed columns), the fields that changed, and who did it (finflow.ctx, set by database.js from
// audit-context.js on the same connection right before the write). The change and its record commit or roll back
// together. A new route needs nothing to be recorded.
//
// Not recorded here, on purpose (each has its own trail or is not a change to the books):
//   · Personal (personal_*, goals, holdings, snapshots, recurring_personal_transactions) — Personal's own history
//     (LC3c); the business trail is shown on business pages (the wall).
//   · the general ledger (ledger_entries / ledger_lines / ledger_accounts) — postings DERIVED from a source document
//     whose own change is recorded; the posting is traced by source_type / source_id.
//   · users, api_keys, password_resets, user_settings, session, admin_*, accountants — sign-in / security / settings
//     events are written by their routes with secrets kept out (LC3d); admin actions go to admin_log (LC3g).
//   · operational tables (page_views, ai_*, idempotency_keys, auto_email_log, webhook ledgers, platform_*).
//
// Never stored in a snapshot: any key that looks like a secret (password / secret / token / *_hash / totp), and any
// text over 2,000 characters (an uploaded file's content) — replaced by its length.

const AUDITED_TABLES = [
  'invoices', 'invoice_payments', 'expenses', 'bills', 'payments_made', 'payments_received', 'sales_receipts',
  'credit_notes', 'vendor_credits', 'credit_applications', 'customers', 'vendors', 'items', 'inventory',
  'inventory_movements', 'payroll', 'payroll_runs', 'payroll_run_lines', 'journals', 'chart_of_accounts', 'quotes',
  'projects', 'timesheet', 'budget_targets', 'recurring_invoices', 'recurring_bills', 'bank_reconciliation',
  'bank_reconciliations', 'bank_ledger_accounts', 'fx_rates', 'fx_transactions', 'autocat_rules', 'entities',
  'lock_settings', 'accountant_clients', 'team_members', 'documents', 'templates', 'customer_portal_links',
];

const FUNCTIONS_SQL = `
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
`;

// F90 part 4 — TAMPER EVIDENCE. Every audit entry carries a hash of its own content and of the entry before it in the same
// account's chain (chain_seq 1, 2, 3, …), computed by the database as the entry is written (BEFORE INSERT, under a
// per-account lock, so two writes can never claim the same place). Altering any recorded value, or removing an entry,
// breaks the chain at that point — and verify (ff_audit_verify) says exactly where. The sign-in IP / device are left out
// of the hash on purpose: LC3d-b removes them 90 days after an account is deleted, which must not read as tampering.
// Entries written before the chain existed (chain_seq NULL) are reported as such, never as broken.
// Limit (stated, not hidden): someone able to rewrite the database could delete the NEWEST entries and leave a shorter
// chain that still verifies — the report shows the latest entry's number and hash so it can be noted elsewhere.
const CHAIN_SQL = `
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
`;

async function ensureChain(client) {
  await client.query(`ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS chain_seq BIGINT`);
  await client.query(`ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS prev_hash TEXT`);
  await client.query(`ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS row_hash TEXT`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_trail_chain ON audit_trail (COALESCE(user_id, 0), chain_seq) WHERE chain_seq IS NOT NULL`);
  await client.query(CHAIN_SQL);
  await client.query(`DROP TRIGGER IF EXISTS audit_trail_chain ON audit_trail`);
  await client.query(`CREATE TRIGGER audit_trail_chain BEFORE INSERT ON audit_trail FOR EACH ROW EXECUTE FUNCTION ff_audit_chain()`);
}

async function ensureSchema(client) {
  await client.query(`ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS changed_fields TEXT[]`);
  await client.query(`ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS source TEXT`);
  await client.query(`ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS request_id TEXT`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_trail_record ON audit_trail (table_name, record_id)`);
  await client.query(FUNCTIONS_SQL);
  await ensureChain(client);
  for (const t of AUDITED_TABLES) {
    const { rows: [has] } = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`, [t]);
    if (!has) continue;
    await client.query(`DROP TRIGGER IF EXISTS ff_audit ON ${client.escapeIdentifier ? client.escapeIdentifier(t) : '"' + t + '"'}`);
    await client.query(`CREATE TRIGGER ff_audit AFTER INSERT OR UPDATE OR DELETE ON "${t}" FOR EACH ROW EXECUTE FUNCTION ff_audit_row()`);
  }
}

// Writes to these tables get the actor context first (database.js). Matches INSERT INTO / UPDATE / DELETE FROM <table>,
// quoted or not, anywhere in the statement (a CTE that writes counts).
const WRITE_RE = new RegExp('\\b(?:insert\\s+into|update|delete\\s+from)\\s+(?:only\\s+)?(?:public\\.)?"?(?:' + AUDITED_TABLES.join('|') + ')"?(?![\\w])', 'i');

// Reading the trail (both /api/audit-log and /api/audit-trail). The trail itself is append-only and keeps every row; for
// PEOPLE, one action is one line:
//   · the row changes one request / job made to one record (e.g. a role change, then its business access) are one
//     event — the record before the first and after the last, every field that changed;
//   · a route that names its business event (INVITE, APPROVE, MARK_PAID, CLIENT_REVOKE, …) gives that event its name
//     and its actor (the route knows who — e.g. the person accepting an invite before they are signed in).
// Paired by the same record and the same request / job run (request_id), within 10 s. Input and output newest first.
const _ROW_ACTIONS = new Set(['CREATE', 'UPDATE', 'DELETE', 'RECALC']);
const _AUDITED = new Set(AUDITED_TABLES);
function mergeEvents(rows) {
  const ms = r => new Date(r.changed_at || r.created_at).getTime();
  const isRowChange = r => _ROW_ACTIONS.has(String(r.action || '').toUpperCase());
  const groups = [], open = new Map(), loose = [], unnamedRecord = [];
  for (const r of rows.slice().reverse()) {                       // oldest → newest
    if (r.request_id == null || !_AUDITED.has(r.table_name)) { loose.push(r); continue; }
    if (r.record_id == null) { (isRowChange(r) ? loose : unnamedRecord).push(r); continue; }
    const k = r.table_name + '|' + r.record_id + '|' + r.request_id;
    let g = open.get(k);
    if (!g || ms(r) - g.last > 10000) { g = { rows: [], last: 0, table: r.table_name, rid: r.request_id }; open.set(k, g); groups.push(g); }
    g.rows.push(r); g.last = ms(r);
  }
  // a named event that did not say which record (e.g. CLIENT_REVOKE): it is that request's change to that table, when
  // the request changed exactly one record of it
  for (const r of unnamedRecord) {
    const cand = groups.filter(g => g.table === r.table_name && g.rid === r.request_id && g.rows.some(isRowChange));
    if (cand.length === 1) cand[0].rows.push(r); else loose.push(r);
  }
  const out = loose.slice();
  for (const g of groups) {
    // within one request, entry order is the id (rows written in one transaction share its timestamp)
    g.rows.sort((x, y) => (x.id || 0) - (y.id || 0));
    const ch = g.rows.filter(isRowChange), named = g.rows.filter(r => !isRowChange(r));
    if (!ch.length) { out.push(...named); continue; }
    const first = ch[0], last = ch[ch.length - 1], ev = Object.assign({}, last);
    const a0 = String(first.action).toUpperCase(), a1 = String(last.action).toUpperCase();
    ev.row_action = a0 === 'CREATE' ? 'CREATE' : a1 === 'DELETE' ? 'DELETE' : 'UPDATE';
    ev.action = ev.row_action;
    ev.old_data = a0 === 'CREATE' ? null : first.old_data;
    ev.new_data = a1 === 'DELETE' ? null : last.new_data;
    ev.changed_fields = [...new Set(ch.flatMap(r => r.changed_fields || []))].sort();
    ev.row_ids = ch.map(r => r.id);
    if (named.length) {                                           // the route's name for it, and the route's actor
      const n = named[named.length - 1];
      Object.assign(ev, { action: n.action, event_id: n.id, actor_type: n.actor_type, actor_id: n.actor_id });
      if ('actor_name' in n) ev.actor_name = n.actor_name;
      out.push(...named.slice(0, -1));
    }
    out.push(ev);
  }
  return out.sort((x, y) => ms(y) - ms(x) || (y.id || 0) - (x.id || 0));
}

module.exports = { AUDITED_TABLES, FUNCTIONS_SQL, CHAIN_SQL, ensureSchema, WRITE_RE, mergeEvents };
