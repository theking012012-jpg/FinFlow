'use strict';
/**
 * verify-gl-backfill.js — GL PHASE 4: historical backfill reproduces the dual-write ledger EXACTLY.
 * Seeds one of every source type via the API (dual-write posts entries) → snapshots the ledger →
 * WIPES ledger_entries + ledger_lines → rebuilds via the REAL owner-gated POST /api/gl/backfill →
 * proves the rebuilt ledger is BYTE-IDENTICAL to the dual-write ledger (same idempotency keys, dates,
 * accounts, debits, credits), that the backfill reconciles to computeBooks, ties the trial balance to
 * zero, and is IDEMPOTENT (a second run posts nothing). The dual-write path is the independent oracle
 * for the backfill (Rule 6): if backfill drifts from a live route by a cent or a date, the snapshots
 * diverge. Snapshot excludes serial ids (they renumber on rebuild); it keys on the stable fields.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-backfill.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
const snap = async (c, uid) => JSON.stringify((await c.query(
  `SELECT le.idempotency_key AS k, le.entry_date::text AS d, le.source_type AS st, le.source_id AS sid, la.code AS code, ll.debit::float AS dr, ll.credit::float AS cr
     FROM ledger_entries le JOIN ledger_lines ll ON ll.entry_id=le.id JOIN ledger_accounts la ON la.id=ll.account_id
    WHERE le.user_id=$1 ORDER BY le.idempotency_key, la.code, ll.debit, ll.credit`, [uid])).rows);
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 4 — backfill reproduces the dual-write ledger, byte-identical + idempotent\n' + '='.repeat(78) + '\n');
    const email = 'glbf@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.77' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const ok = r => r.status >= 200 && r.status < 300;

    // Seed one of every source type (dual-write posts a ledger entry for each).
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).text);
    A('seed invoice', !!inv.id);
    A('seed invoice payment', ok(await http.post('/api/invoice-payments', { invoice_id: inv.id, amount: 400, payment_date: '2026-06-20' })));
    A('seed sales receipt', ok(await http.post('/api/sales-receipts', { customer: 'Cust', amount: 500, date: '2026-06-01', entity_id: eid })));
    A('seed credit note', ok(await http.post('/api/credit-notes', { customer: 'Cust', amount: 100, status: 'Open', date: '2026-06-05', entity_id: eid })));
    A('seed expense', ok(await http.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-01', category: 'Office', entity_id: eid })));
    const bill = JSON.parse((await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid })).text);
    A('seed bill', !!bill.id);
    A('seed payment made (linked)', ok(await http.post('/api/payments-made', { vendor: 'Acme', amount: 300, date: '2026-06-20', bill_id: bill.id, entity_id: eid })));
    A('seed vendor credit', ok(await http.post('/api/vendor-credits', { vendor: 'Acme', amount: 50, status: 'Open', date: '2026-06-05', entity_id: eid })));
    const emp = JSON.parse((await http.post('/api/payroll', { fname: 'Ada', lname: 'L', gross: 1000, entity_id: eid })).text);
    const run = JSON.parse((await http.post('/api/payroll-runs', { period: '2026-06', entity_id: eid, bonus_overrides: { [emp.id]: 250 }, overtime_overrides: { [emp.id]: 100 } })).text);
    A('seed payroll + approve', ok(await http.put('/api/payroll-runs/' + run.id + '/approve', {})));
    const item = JSON.parse((await http.post('/api/inventory', { name: 'Widget', sku: 'W1', cost: 5, entity_id: eid })).text);
    const mv = (t, q, u) => http.post('/api/inventory-movements', { inventory_id: item.id, type: t, quantity: q, unit_cost: u, entity_id: eid });
    await mv('purchase', 10, 5); const saleRes = JSON.parse((await mv('sale', 4, 0)).text);
    A('seed inventory (FIFO cogs 20)', near(saleRes.cogs, 20), 'cogs=' + saleRes.cogs);
    const fx = JSON.parse((await http.post('/api/fx-transactions', { foreign_currency: 'EUR', foreign_amount: 1000, rate_at_transaction: 1.10, entity_id: eid })).text);
    A('seed fx settle (gain 50)', ok(await http.post('/api/fx-transactions/' + fx.id + '/settle', { rate_at_settlement: 1.15 })));

    // Snapshot the dual-write ledger, then WIPE it.
    const dualWrite = await snap(c, uid);
    const beforeCount = (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1`, [uid])).rows[0].n;
    A('dual-write posted entries for every type (12 entries)', beforeCount === 12, 'got ' + beforeCount);
    await c.query(`DELETE FROM ledger_lines WHERE user_id=$1`, [uid]);
    await c.query(`DELETE FROM ledger_entries WHERE user_id=$1`, [uid]);
    A('ledger wiped', (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1`, [uid])).rows[0].n === 0);

    // Rebuild from the source documents via the REAL owner-gated endpoint.
    const bf = JSON.parse((await http.post('/api/gl/backfill?entity_id=' + eid, {})).text);
    A('backfill posted from empty (12)', bf.posted === 12 && bf.existing === 0, 'posted=' + bf.posted + ' existing=' + bf.existing);
    A('backfill covered all 11 source types', Object.keys(bf.byType).length === 11, 'types=' + Object.keys(bf.byType).join(','));
    const rebuilt = await snap(c, uid);
    A('REBUILT ledger is BYTE-IDENTICAL to the dual-write ledger', rebuilt === dualWrite, rebuilt === dualWrite ? '' : 'snapshots differ');

    // Reconciliation report + trial balance.
    const rec = bf.reconciliation.find(r => r.entityId === eid);
    A('reconciliation: GL revenue == oracle (1400)', rec && near(rec.glRevenue, rec.oracleRevenue) && near(rec.glRevenue, 1400), JSON.stringify(rec));
    A('reconciliation: GL expenses(ex-FX) == oracle cogs+opex (1800)', rec && near(rec.glExpensesExFx, rec.oracleCogsOpex) && near(rec.glExpensesExFx, 1800), JSON.stringify(rec));
    A('reconciliation: entity reconciled + trial-balanced + BS-balanced', rec && rec.reconciled && rec.trialBalanced && rec.balanceSheetBalanced, JSON.stringify(rec));
    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1`, [uid])).rows[0];
    A('trial balance ties to zero after backfill', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));

    // Idempotency: run it again — nothing new posts, ledger unchanged.
    const bf2 = JSON.parse((await http.post('/api/gl/backfill?entity_id=' + eid, {})).text);
    A('re-run is idempotent (0 posted, 12 existing)', bf2.posted === 0 && bf2.existing === 12, 'posted=' + bf2.posted + ' existing=' + bf2.existing);
    A('ledger unchanged after idempotent re-run', (await snap(c, uid)) === dualWrite);

    // Dry-run reports without writing.
    const dry = JSON.parse((await http.post('/api/gl/backfill?entity_id=' + eid + '&dry=1', {})).text);
    A('dry-run: dryRun flag + reports all existing, writes nothing', dry.dryRun === true && dry.posted === 0 && dry.existing === 12, JSON.stringify({ dryRun: dry.dryRun, posted: dry.posted, existing: dry.existing }));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (backfill == dual-write, idempotent, reconciled)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
