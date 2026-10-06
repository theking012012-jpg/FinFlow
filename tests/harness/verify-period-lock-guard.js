#!/usr/bin/env node
'use strict';
/**
 * verify-period-lock-guard.js — N9 + the N8 class. A closed period refuses every money write dated into
 * it — create, edit (from OR into the period), delete, payroll actions — on every money table, judged by
 * the date the money is recognised on.
 *
 * Defects: only invoices, expenses and journal-create checked the lock. Bills, sales receipts, credit
 * notes, vendor credits, payments made, invoice payments, journal edits/deletes and payroll runs could be
 * written into a closed period. Invoices were checked on due_date although revenue is recognised on
 * issue_date (so a June invoice due in July slipped in, and a July invoice due in June was refused), and
 * edits only checked the OLD date (a July row could be moved into June).
 *
 * Executed against the real server + Postgres; books locked through 2026-06-30. Bug value stated per row.
 *   node -r ./tests/harness/clock.js tests/harness/verify-period-lock-guard.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'lock-guard-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'lg@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'LG Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO payroll (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { fname: 'Pat', lname: 'Lee', gross: 3000, deductions: [] }]);
    // June rows that already exist (seeded directly) — edits/deletes must be refused.
    const seed = async (t, d) => (await c.query(`INSERT INTO ${t} (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, d])).rows[0].id;
    const juneBill = await seed('bills', { vendor: 'V', amount: 100, status: 'unpaid', issue_date: '2026-06-10', due_date: '2026-07-10' });
    const juneCN = await seed('credit_notes', { customer: 'C', amount: 50, status: 'Open', date: '2026-06-12' });
    const juneJ = await seed('journals', { description: 'June adj', date: '2026-06-15', lines: '[]' });
    const juneRun = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net) VALUES ($1,$2,'2026-06','2026-06-28','draft',3000,0,3000) RETURNING id`, [uid, eid])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.9.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'lg@finflow.test', password: PW })).status === 200);
    A('lock books through 2026-06-30', (await h.post('/api/lock-settings', { enabled: true, lock_date: '2026-06-30' })).status === 200);
    const J = '2026-06-20', JL = '2026-07-20';
    const bal = [{ account: 'Rent', debit: 10, credit: 0 }, { account: 'Cash', debit: 0, credit: 10 }];
    const st = async (p) => (await p).status;

    console.log('\n' + '='.repeat(78));
    console.log('  CLOSED PERIOD — every money table, create / edit / delete');
    console.log('='.repeat(78));
    // invoices: recognised on issue_date
    A('invoice issued in June, due in July → 403 (bug: 201, checked due_date)', (await st(h.post('/api/invoices', { client: 'X', amount: 10, status: 'pending', issue_date: J, due_date: JL }))) === 403);
    const invJ = await h.post('/api/invoices', { client: 'Y', amount: 10, status: 'pending', issue_date: JL, due_date: J });
    A('invoice issued in July, due in June → 201 (bug: 403, checked due_date)', invJ.status === 201, 'status ' + invJ.status);
    A('edit a July invoice INTO June (issue_date) → 403 (bug: 200, only old date checked)', (await st(h.put('/api/invoices/' + invJ.json.id, { issue_date: J }))) === 403);
    // bills
    A('bill dated June → 403 (bug: 201)', (await st(h.post('/api/bills', { vendor: 'V', amount: 10, status: 'unpaid', issue_date: J, due_date: JL }))) === 403);
    A('edit the June bill → 403 (bug: 200)', (await st(h.put('/api/bills/' + juneBill, { amount: 999 }))) === 403);
    A('delete the June bill → 403 (bug: 200)', (await st(h.del('/api/bills/' + juneBill))) === 403);
    // receipts / credits / payments
    A('sales receipt dated June → 403 (bug: 201)', (await st(h.post('/api/sales-receipts', { customer: 'C', amount: 10, date: J }))) === 403);
    A('credit note dated June → 403 (bug: 201)', (await st(h.post('/api/credit-notes', { customer: 'C', amount: 10, date: J }))) === 403);
    A('delete the June credit note → 403 (bug: 200)', (await st(h.del('/api/credit-notes/' + juneCN))) === 403);
    A('vendor credit dated June → 403 (bug: 201)', (await st(h.post('/api/vendor-credits', { vendor: 'V', amount: 10, date: J }))) === 403);
    A('payment made dated June → 403 (bug: 200)', (await st(h.post('/api/payments-made', { vendor: 'V', amount: 10, date: J }))) === 403);
    A('invoice payment dated June → 403 (bug: 201)', (await st(h.post('/api/invoice-payments', { invoice_id: invJ.json.id, amount: 5, payment_date: J }))) === 403);
    // journals
    A('edit the June journal → 403 (bug: 200)', (await st(h.put('/api/journals/' + juneJ, { description: 'changed', date: J, lines: bal }))) === 403);
    A('delete the June journal → 403 (bug: 200)', (await st(h.del('/api/journals/' + juneJ))) === 403);
    // payroll
    A('payroll run for June → 403 (bug: 201)', (await st(h.post('/api/payroll-runs', { period: '2026-06', idempotency_key: 'lg-run-1' }))) === 403);
    A('approve the June run → 403 (bug: 200)', (await st(h.put('/api/payroll-runs/' + juneRun + '/approve', {}))) === 403);
    A('delete the June run → 403 (bug: 200)', (await st(h.del('/api/payroll-runs/' + juneRun))) === 403);
    // controls: the open period still works on every table
    A('control: July bill → 2xx', [200, 201].includes(await st(h.post('/api/bills', { vendor: 'V', amount: 10, status: 'unpaid', issue_date: JL, due_date: JL }))));
    A('control: July credit note → 2xx', [200, 201].includes(await st(h.post('/api/credit-notes', { customer: 'C', amount: 10, date: JL }))));
    A('control: July journal → 2xx', [200, 201].includes(await st(h.post('/api/journals', { description: 'July adj', date: JL, lines: bal }))));
    A('control: July payroll run → 201', (await st(h.post('/api/payroll-runs', { period: '2026-07', idempotency_key: 'lg-run-2' }))) === 201);
    A('control: July invoice payment → 201', (await st(h.post('/api/invoice-payments', { invoice_id: invJ.json.id, amount: 5, payment_date: JL }))) === 201);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (period lock guard)` : `  ALL GREEN — ${pass} passed, 0 failed  (period lock guard)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
