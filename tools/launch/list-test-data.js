'use strict';
/**
 * list-test-data.js — READ-ONLY (Rule 7 / Rule 8). LAUNCH_STATUS §1.6: every test record on the live database, with its
 * id and the account it sits on, so the owner can review it before any clean-up. Changes NOTHING.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"; node tools/launch/list-test-data.js; Remove-Item Env:DATABASE_URL
 *   Add --json for machine-readable output (purge-test-data.js uses the same finder).
 *
 * What counts as test data (LAUNCH_STATUS 1.6, COWORK_RETEST_RESULTS_2026-10-20.md):
 *   MARKED   any business / personal record whose text contains ZZ-QA, AUDIT TEST or ZZ-LIVECHECK
 *   LINKED   payments on a marked invoice / bill; time entries on a marked project
 *   KEPT     (shown, never purged) a marked customer / vendor that a real, unmarked document is linked to
 *   NAMED    accountant links to "QA Tester" / "Claude TestCPA"; the November 2026 payroll run on a Cowork test account
 *            (e-mail contains "+cowork") with its owner-salary row in Personal; the FreshBooks integration request;
 *            the "Software" budget target key on a Cowork test account (REVIEW — a key inside a real row, see below)
 * Never listed for removal: audit_trail, admin_log, personal_history, ledger rows (append-only records — the purge
 * posts REVERSALS, it never deletes ledger history).
 *
 * Safety: SELECT only, bound parameters, a READ ONLY session (a write would be refused by Postgres), no transaction
 * control. Imports only `pg` — never database.js (its initDB would fire DDL).
 */
const { Client } = require('pg');

const MARKERS = ['%ZZ-QA%', '%AUDIT TEST%', '%ZZ-LIVECHECK%'];
// Business / personal JSONB record tables a marked row can live in. Logs and the ledger are deliberately absent.
const MARKED_TABLES = ['invoices', 'expenses', 'bills', 'quotes', 'projects', 'timesheet', 'sales_receipts',
  'payments_received', 'payments_made', 'credit_notes', 'vendor_credits', 'customers', 'vendors', 'items', 'inventory',
  'documents', 'journals', 'personal_transactions', 'personal_accounts', 'goals', 'holdings',
  'recurring_invoices', 'recurring_bills', 'recurring_personal_transactions', 'support_requests', 'payroll'];

async function findTestData(c) {
  const out = { marked: [], linked: [], named: [], review: [], accounts: {} };
  const have = new Set((await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`)).rows.map(r => r.table_name));
  const label = d => String((d && (d.client || d.description || d.vendor || d.name || d.customer || d.project || d.notes || d.subject || d.message)) || '').slice(0, 70);
  for (const t of MARKED_TABLES) {
    if (!have.has(t)) continue;
    const { rows } = await c.query(`SELECT id, user_id, entity_id, data FROM ${t} WHERE data::text ILIKE ANY($1::text[]) ORDER BY id`, [MARKERS]);
    for (const r of rows) out.marked.push({ table: t, id: r.id, user_id: r.user_id, entity_id: r.entity_id, label: label(r.data), amount: r.data && r.data.amount != null ? Number(r.data.amount) : null });
  }
  // SW2 (2026-10-27): since batch 9 every invoice / bill saves its contact, so a test document leaves a marked contact
  // behind — that contact IS test data and is listed. But a marked contact that a REAL (unmarked) document links to
  // (its customer_id / vendor_id) is never listed for removal: it is shown under KEPT and the owner decides by hand.
  const LINKS = { customers: { key: 'customer_id', tables: ['invoices', 'sales_receipts', 'quotes', 'credit_notes', 'recurring_invoices', 'payments_received'] },
                  vendors:   { key: 'vendor_id',   tables: ['bills', 'payments_made', 'vendor_credits', 'recurring_bills', 'expenses'] } };
  out.kept = [];
  for (const [ct, ln] of Object.entries(LINKS)) {
    const mine = out.marked.filter(m => m.table === ct);
    if (!mine.length) continue;
    const users = new Map();
    for (const t of ln.tables) {
      if (!have.has(t)) continue;
      const { rows } = await c.query(`SELECT id, (data->>'${ln.key}')::int AS cid FROM ${t} WHERE (data->>'${ln.key}') ~ '^[0-9]+$' AND (data->>'${ln.key}')::int = ANY($1::int[]) AND NOT (data::text ILIKE ANY($2::text[])) ORDER BY id`, [mine.map(m => m.id), MARKERS]);
      rows.forEach(r => { if (!users.has(r.cid)) users.set(r.cid, []); users.get(r.cid).push(t + ' #' + r.id); });
    }
    for (const m of mine) if (users.has(m.id)) {
      out.marked.splice(out.marked.indexOf(m), 1);
      out.kept.push(Object.assign({}, m, { why: 'marked, but real ' + users.get(m.id).join(', ') + ' use' + (users.get(m.id).length === 1 ? 's' : '') + ' it — never purged; fix by hand' }));
    }
  }
  const ids = t => out.marked.filter(m => m.table === t).map(m => m.id);
  const seen = new Set(out.marked.map(m => m.table + ':' + m.id));
  const addLinked = (table, r, why) => { const k = table + ':' + r.id; if (seen.has(k)) return; seen.add(k); out.linked.push({ table, id: r.id, user_id: r.user_id, entity_id: r.entity_id, why, amount: r.amount != null ? Number(r.amount) : null }); };
  if (have.has('invoice_payments') && ids('invoices').length) {
    const { rows } = await c.query(`SELECT id, user_id, entity_id, amount, invoice_id FROM invoice_payments WHERE invoice_id = ANY($1::int[]) ORDER BY id`, [ids('invoices')]);
    rows.forEach(r => addLinked('invoice_payments', r, 'payment on test invoice #' + r.invoice_id));
  }
  if (ids('bills').length) {
    const { rows } = await c.query(`SELECT id, user_id, entity_id, data->>'amount' AS amount, data->>'bill_id' AS bill_id FROM payments_made WHERE (data->>'bill_id') ~ '^[0-9]+$' AND (data->>'bill_id')::int = ANY($1::int[]) ORDER BY id`, [ids('bills')]);
    rows.forEach(r => addLinked('payments_made', r, 'payment on test bill #' + r.bill_id));
  }
  if (ids('projects').length) {
    const { rows } = await c.query(`SELECT id, user_id, entity_id, data->>'hours' AS amount, data->>'project_id' AS pid FROM timesheet WHERE (data->>'project_id') ~ '^[0-9]+$' AND (data->>'project_id')::int = ANY($1::int[]) ORDER BY id`, [ids('projects')]);
    rows.forEach(r => addLinked('timesheet', r, 'time on test project #' + r.pid));
  }
  // NAMED
  if (have.has('accountants') && have.has('accountant_clients')) {
    const { rows } = await c.query(
      `SELECT ac.id, ac.user_id, a.id AS accountant_id, (a.first_name || ' ' || a.last_name) AS name
         FROM accountant_clients ac JOIN accountants a ON a.id = ac.accountant_id
        WHERE (a.first_name || ' ' || a.last_name) ILIKE ANY(ARRAY['%QA Tester%', '%Claude TestCPA%']) ORDER BY ac.id`);
    rows.forEach(r => out.named.push({ table: 'accountant_clients', id: r.id, user_id: r.user_id, entity_id: null, why: 'link to test accountant "' + r.name + '" (accountant #' + r.accountant_id + ')' }));
  }
  const { rows: cw } = await c.query(`SELECT id, data->>'email' AS email FROM users WHERE (data->>'email') ILIKE '%+cowork%' ORDER BY id`);
  const cowork = cw.map(r => r.id);
  if (cowork.length) {
    const { rows: runs } = await c.query(`SELECT id, user_id, entity_id, period, status, total_gross FROM payroll_runs WHERE user_id = ANY($1::int[]) AND period ILIKE 'November 2026' AND lower(status) <> 'voided' ORDER BY id`, [cowork]);   // a voided run is already undone (kept as history)
    for (const r of runs) {
      out.named.push({ table: 'payroll_runs', id: r.id, user_id: r.user_id, entity_id: r.entity_id, why: 'Cowork test payroll run "' + r.period + '" (' + r.status + ')', amount: r.total_gross != null ? Number(r.total_gross) : null });
      const { rows: sal } = await c.query(`SELECT id, user_id, data->>'amount' AS amount FROM personal_transactions WHERE entity_id IS NULL AND data->>'source' = 'payroll' AND data->>'payroll_run_id' = $1::text`, [String(r.id)]);
      sal.forEach(s => out.named.push({ table: 'personal_transactions', id: s.id, user_id: s.user_id, entity_id: null, why: 'owner salary from test run #' + r.id, amount: Number(s.amount) }));
    }
    if (have.has('budget_targets')) {
      const { rows: bt } = await c.query(`SELECT id, user_id, entity_id, data->'targets'->'Software' AS sw FROM budget_targets WHERE user_id = ANY($1::int[]) AND data->'targets' ? 'Software'`, [cowork]);
      bt.forEach(b => out.review.push({ table: 'budget_targets', id: b.id, user_id: b.user_id, entity_id: b.entity_id, why: 'key "Software" = ' + JSON.stringify(b.sw) + ' inside a real budget row — the purge removes ONLY this key' }));
    }
  }
  if (have.has('support_requests')) {
    const { rows } = await c.query(`SELECT id, user_id, entity_id FROM support_requests WHERE data::text ILIKE '%FreshBooks%' ORDER BY id`);
    rows.forEach(r => { if (!seen.has('support_requests:' + r.id)) out.named.push({ table: 'support_requests', id: r.id, user_id: r.user_id, entity_id: r.entity_id, why: 'FreshBooks integration request' }); });
  }
  const uids = [...new Set([...out.marked, ...out.linked, ...out.named, ...out.review].map(x => x.user_id).filter(x => x != null))];
  if (uids.length) {
    const { rows } = await c.query(`SELECT id, data->>'email' AS email FROM users WHERE id = ANY($1::int[])`, [uids]);
    rows.forEach(r => { out.accounts[r.id] = r.email; });
  }
  return out;
}

// A stable fingerprint of exactly what was listed (purge --expect refuses if the data changed after review).
function fingerprint(found) {
  const keys = [...found.marked, ...found.linked, ...found.named, ...found.review].map(x => x.table + ':' + x.id).sort();
  return require('crypto').createHash('sha256').update(keys.join(',')).digest('hex').slice(0, 16);
}

module.exports = { findTestData, fingerprint, MARKERS };

if (require.main === module) {
  (async () => {
    if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/list-test-data.js [--json]'); process.exit(2); }
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    try {
      await c.connect();
      await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      const f = await findTestData(c);
      if (process.argv.includes('--json')) { console.log(JSON.stringify(Object.assign({ fingerprint: fingerprint(f) }, f), null, 2)); return; }
      const acct = id => (id == null ? '—' : id + ' ' + (f.accounts[id] || ''));
      const show = (title, rows) => { console.log('\n' + title + ' (' + rows.length + ')'); if (rows.length) console.table(rows.map(r => ({ table: r.table, id: r.id, account: acct(r.user_id), business: r.entity_id, amount: r.amount, what: r.label || r.why }))); };
      show('MARKED — text contains ZZ-QA / AUDIT TEST / ZZ-LIVECHECK', f.marked);
      show('LINKED — attached to a marked record', f.linked);
      show('NAMED — test records with no marker', f.named);
      show('REVIEW — part of a real row', f.review);
      show('KEPT — marked, but a real document uses it (NOT removed by the purge)', f.kept);
      const n = f.marked.length + f.linked.length + f.named.length + f.review.length;
      console.log(`\n${n} test records · fingerprint ${fingerprint(f)}`);
      console.log('If ANY line above is a real record, stop — do not run the purge. Otherwise: node tools/launch/purge-test-data.js');
    } catch (err) {
      console.error('FAILED:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
      if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
      process.exitCode = 1;
    } finally { try { await c.end(); } catch (_) {} }
  })();
}
