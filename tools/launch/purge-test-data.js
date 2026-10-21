'use strict';
/**
 * purge-test-data.js — LAUNCH_STATUS §1.6. OWNER-RUN (Rule 8). DRY RUN BY DEFAULT — changes nothing without --apply.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"
 *     node tools/launch/list-test-data.js                                  # review every line first
 *     node tools/launch/purge-test-data.js                                 # dry run: the exact plan, nothing changed
 *     node tools/launch/purge-test-data.js --apply --expect <fingerprint>  # the fingerprint the dry run printed
 *     Remove-Item Env:DATABASE_URL
 *
 * What it removes is EXACTLY what list-test-data.js lists (same finder). How — the app's own undo paths, so the books
 * stay balanced and every change is on record:
 *   - a money document is undone with a ledger REVERSAL (ledger-reverse.js — the same code the app's delete routes run;
 *     ledger history is never deleted), then the document is removed: invoice payments and bill payments before their
 *     invoices / bills
 *   - the paid Cowork test payroll run is VOIDED exactly as PUT /api/payroll-runs/:id/void does (status 'voided', the
 *     payroll_run / payroll_paid / payroll_remit reversals, the owner-salary row removed from Personal) — never deleted
 *   - the "Software" budget key is removed from its row; the rest of the row is untouched
 *   - each business removal writes one audit_trail row (actor system); each personal removal one personal_history row
 * Refusals (nothing changed): no --expect, or the fingerprint changed since the dry run (data moved — review again);
 * any record dated inside a LOCKED period (period-lock.js, the app's one lock reader — unlock it in the app first);
 * any listed record in a table this tool does not know how to undo safely.
 * One transaction: all of it or none of it. After an apply it prints the trial balance of every business it touched.
 */
const { Client } = require('pg');
const { findTestData, fingerprint } = require('./list-test-data.js');
const { reverseLedgerEntryBody } = require('../../ledger-reverse.js');
const { isLocked } = require('../../period-lock.js');

// table → ledger source type the app reverses on delete (null = the app posts nothing for it), and the record's date.
const MONEY = {
  invoice_payments: { src: 'invoice_payment', date: r => r.payment_date },
  payments_made:    { src: 'bill_payment',    date: r => r.date },
  invoices:         { src: 'invoice',         date: r => r.issue_date },
  expenses:         { src: 'expense',         date: r => r.expense_date },
  bills:            { src: 'bill',            date: r => r.issue_date },
  sales_receipts:   { src: 'sales_receipt',   date: r => r.date },
  credit_notes:     { src: 'credit_note',     date: r => r.date },
  vendor_credits:   { src: 'vendor_credit',   date: r => r.date },
  journals:         { src: 'journal',         date: r => r.date },
  payments_received:{ src: null,              date: r => r.date },
};
// No ledger entry; a plain removal is the app's own delete.
const PLAIN = new Set(['quotes', 'projects', 'timesheet', 'documents', 'customers', 'vendors', 'support_requests',
  'recurring_invoices', 'recurring_bills', 'accountant_clients']);
const PERSONAL = new Set(['personal_transactions', 'personal_accounts', 'goals', 'holdings', 'recurring_personal_transactions']);
// Removal order: payments before the documents they pay; time before projects.
const ORDER = ['invoice_payments', 'payments_made', 'payments_received', 'invoices', 'bills', 'expenses', 'sales_receipts',
  'credit_notes', 'vendor_credits', 'journals', 'timesheet', 'projects', 'quotes', 'documents', 'customers', 'vendors',
  'recurring_invoices', 'recurring_bills', 'support_requests', 'accountant_clients', ...PERSONAL];
const RELATIONAL = new Set(['invoice_payments', 'accountant_clients']);   // real columns, no `data`

async function loadRow(c, table, id) {
  const { rows: [r] } = await c.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!r) return null;
  return RELATIONAL.has(table) ? r : Object.assign({ id: r.id, user_id: r.user_id, entity_id: r.entity_id }, r.data || {});
}

async function plan(c) {
  const f = await findTestData(c);
  const items = [...f.marked, ...f.linked, ...f.named, ...f.review];
  const steps = [], refused = [];
  const seen = new Set();
  const runs = items.filter(x => x.table === 'payroll_runs');
  const runIds = new Set(runs.map(x => String(x.id)));
  for (const x of items) {
    const k = x.table + ':' + x.id; if (seen.has(k)) continue; seen.add(k);
    if (x.table === 'payroll_runs' || x.table === 'budget_targets') continue;   // handled below
    const row = await loadRow(c, x.table, x.id);
    if (!row) continue;
    // the owner-salary row of a test run is removed BY the void (as the app does), not on its own
    if (x.table === 'personal_transactions' && row.source === 'payroll' && runIds.has(String(row.payroll_run_id))) continue;
    if (MONEY[x.table]) {
      const d = MONEY[x.table].date(row);
      if (row.entity_id != null && await isLocked(c, row.user_id, row.entity_id, d)) { refused.push(k + ' is dated ' + d + ', inside a LOCKED period'); continue; }
      steps.push({ kind: 'money', table: x.table, id: x.id, row });
    } else if (PLAIN.has(x.table)) steps.push({ kind: 'plain', table: x.table, id: x.id, row });
    else if (PERSONAL.has(x.table)) steps.push({ kind: 'personal', table: x.table, id: x.id, row });
    else refused.push(k + ' — no safe undo path in this tool (remove it in the app by hand)');
  }
  for (const x of runs) {
    const { rows: [run] } = await c.query(`SELECT * FROM payroll_runs WHERE id = $1`, [x.id]);
    if (!run) continue;
    if (await isLocked(c, run.user_id, run.entity_id, String(run.run_date || '').slice(0, 10) || null)) { refused.push('payroll_runs:' + run.id + ' is inside a LOCKED period'); continue; }
    steps.push({ kind: String(run.status).toLowerCase() === 'draft' ? 'run-delete' : 'run-void', table: 'payroll_runs', id: run.id, row: run });
  }
  for (const x of items.filter(i => i.table === 'budget_targets')) steps.push({ kind: 'budget-key', table: 'budget_targets', id: x.id, row: await loadRow(c, 'budget_targets', x.id) });
  steps.sort((a, b) => ORDER.indexOf(a.table) - ORDER.indexOf(b.table));
  return { found: f, fp: fingerprint(f), steps, refused };
}

const audit = (c, uid, eid, table, id, action, oldData, newData) => c.query(
  `INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, old_data, new_data, actor_type, actor_id)
   VALUES ($1,$2,$3,$4,$5,$6,$7,'system',NULL)`, [uid, eid, table, id, action, oldData ? JSON.stringify(oldData) : null, newData ? JSON.stringify(newData) : null]);
const persHist = (c, uid, kind, action, before) => c.query(
  `INSERT INTO personal_history (user_id, kind, action, record_id, before_data, actor_type) VALUES ($1,$2,$3,$4,$5,'system')`,
  [uid, kind, action, before && before.id, JSON.stringify(before)]);

async function apply(c, steps) {
  const touched = new Set();
  for (const s of steps) {
    const r = s.row;
    if (s.kind === 'money') {
      const src = MONEY[s.table].src;
      if (src) await reverseLedgerEntryBody(c, { userId: r.user_id, sourceType: src, sourceId: r.id });
      await c.query(`DELETE FROM ${s.table} WHERE id = $1`, [r.id]);
      await audit(c, r.user_id, r.entity_id, s.table, r.id, 'DELETE', Object.assign({ purge: 'test data (§1.6)' }, RELATIONAL.has(s.table) ? { amount: r.amount, invoice_id: r.invoice_id } : r), null);
    } else if (s.kind === 'plain') {
      await c.query(`DELETE FROM ${s.table} WHERE id = $1`, [r.id]);
      await audit(c, r.user_id, r.entity_id == null ? null : r.entity_id, s.table, r.id, 'DELETE', Object.assign({ purge: 'test data (§1.6)' }, s.table === 'documents' ? { name: r.name } : r), null);
    } else if (s.kind === 'personal') {
      await c.query(`DELETE FROM ${s.table} WHERE id = $1`, [r.id]);
      await persHist(c, r.user_id, s.table, 'DELETE', r);   // personal → Personal's own history, never the business trail
    } else if (s.kind === 'run-void') {
      // == PUT /api/payroll-runs/:id/void
      await c.query(`UPDATE payroll_runs SET status = 'voided' WHERE id = $1`, [r.id]);
      for (const src of ['payroll_run', 'payroll_paid', 'payroll_remit']) await reverseLedgerEntryBody(c, { userId: r.user_id, sourceType: src, sourceId: r.id });
      const { rows: gone } = await c.query(`DELETE FROM personal_transactions WHERE user_id = $1 AND entity_id IS NULL AND data->>'source' = 'payroll' AND data->>'payroll_run_id' = $2::text RETURNING id, user_id, data`, [r.user_id, String(r.id)]);
      for (const g of gone) await persHist(c, g.user_id, 'owner_salary', 'DELETE', Object.assign({ id: g.id }, g.data));
      await audit(c, r.user_id, r.entity_id, 'payroll_runs', r.id, 'VOID', { purge: 'test data (§1.6)', period: r.period, status: r.status }, null);
    } else if (s.kind === 'run-delete') {
      await c.query(`DELETE FROM payroll_run_lines WHERE run_id = $1`, [r.id]);
      await c.query(`DELETE FROM payroll_runs WHERE id = $1`, [r.id]);
      await audit(c, r.user_id, r.entity_id, 'payroll_runs', r.id, 'DELETE', { purge: 'test data (§1.6)', period: r.period }, null);
    } else if (s.kind === 'budget-key') {
      const before = r.targets || {};
      const after = Object.assign({}, before); delete after.Software;
      await c.query(`UPDATE budget_targets SET data = jsonb_set(data, '{targets}', $2::jsonb), updated_at = NOW() WHERE id = $1`, [r.id, JSON.stringify(after)]);
      await audit(c, r.user_id, r.entity_id, 'budget_targets', r.id, 'UPDATE', before, after);
    }
    if (r && r.entity_id != null) touched.add(r.user_id + ':' + r.entity_id);
  }
  return touched;
}

async function trialBalance(c, touched) {
  const out = [];
  for (const k of touched) {
    const [uid, eid] = k.split(':').map(Number);
    const { rows: [t] } = await c.query(`SELECT COALESCE(SUM(debit),0)::numeric d, COALESCE(SUM(credit),0)::numeric cr FROM ledger_lines WHERE user_id = $1 AND entity_id = $2`, [uid, eid]);
    out.push({ account: uid, business: eid, debits: Number(t.d), credits: Number(t.cr), balanced: Number(t.d).toFixed(2) === Number(t.cr).toFixed(2) });
  }
  return out;
}

module.exports = { plan, apply, trialBalance };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const doApply = args.includes('--apply');
    const ei = args.indexOf('--expect'); const expect = ei >= 0 ? args[ei + 1] : null;
    if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/purge-test-data.js [--apply --expect <fingerprint>]'); process.exit(2); }
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    try {
      await c.connect();
      if (!doApply) await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');   // the dry run cannot write
      else await c.query('BEGIN');
      const p = await plan(c);
      console.log((doApply ? 'APPLY' : 'DRY RUN — nothing changed') + ` · ${p.steps.length} steps · fingerprint ${p.fp}`);
      console.table(p.steps.map(s => ({ do: s.kind === 'money' ? 'reverse + delete' : s.kind === 'run-void' ? 'VOID run (+ reversals, owner salary out)' : s.kind === 'budget-key' ? 'remove key "Software"' : 'delete', table: s.table, id: s.id, account: s.row.user_id, business: s.row.entity_id })));
      if (p.refused.length) { console.log('REFUSED — fix these first (nothing will be applied while any remain):'); p.refused.forEach(x => console.log('  - ' + x)); }
      if (!doApply) { console.log(`\nTo apply exactly this plan: node tools/launch/purge-test-data.js --apply --expect ${p.fp}`); return; }
      if (!expect) { await c.query('ROLLBACK'); console.error('REFUSED: --apply needs --expect <fingerprint> from the dry run you reviewed.'); process.exitCode = 2; return; }
      if (expect !== p.fp) { await c.query('ROLLBACK'); console.error(`REFUSED: the test data changed since your dry run (fingerprint now ${p.fp}, you approved ${expect}). Run the dry run again.`); process.exitCode = 3; return; }
      if (p.refused.length) { await c.query('ROLLBACK'); process.exitCode = 4; return; }
      const touched = await apply(c, p.steps);
      const tb = await trialBalance(c, touched);
      if (tb.some(t => !t.balanced)) { await c.query('ROLLBACK'); console.table(tb); console.error('REFUSED: a business would not balance after the purge — nothing changed.'); process.exitCode = 5; return; }
      await c.query('COMMIT');
      console.log(`APPLIED: ${p.steps.length} steps. Trial balance of every business touched:`); console.table(tb);
    } catch (err) {
      try { await c.query('ROLLBACK'); } catch (_) {}
      console.error('FAILED — nothing changed:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
      if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
      process.exitCode = 1;
    } finally { try { await c.end(); } catch (_) {} process.exit(process.exitCode || 0); }
  })();
}
