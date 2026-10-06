#!/usr/bin/env node
'use strict';
/**
 * verify-gl-resync-on-edit.js — N12 class. Editing a posted money record must keep the general ledger
 * equal to the record. Before the fix, five PUT routes (expenses, sales receipts, credit notes, payments
 * made, vendor credits) updated the row but never the ledger, so the books stopped balancing against
 * the reports and the balance sheet silently fell back to "cash not tracked".
 *
 * Each record is created and edited through the real routes; the ledger is then summed per source
 * (original + any reversal). Discriminating seeds (Rule 4), bug value stated per check:
 *   expense 100 → 250                     6000 net 250            (bug 100)
 *   sales receipt 200 → 260               4000 net −260           (bug −200)
 *   credit note 50 → Void                 contra net 0            (bug 50)
 *   vendor credit 40 → 70                 6000 net −70            (bug −40)
 *   payment made 80, then linked to bill  6000 net 0, 2000 net 80 (bug 6000 80, 2000 0)
 *   GET /api/gl/verify booksBalanced      true                    (bug false)
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-resync-on-edit.js
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - b) < 0.005;

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'gl-edit-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'gledit@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'GL Co', currency: 'USD', is_active: 1 }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.8.5.1' });
    A('login', (await h.post('/api/auth/login', { email: 'gledit@finflow.test', password: PW })).status === 200);
    const net = async (sourceType, id, code) => Number((await c.query(
      `SELECT COALESCE(SUM(ll.debit - ll.credit),0)::float n FROM ledger_lines ll
         JOIN ledger_entries le ON le.id = ll.entry_id JOIN ledger_accounts la ON la.id = ll.account_id
        WHERE le.user_id=$1 AND le.source_type=$2 AND le.source_id=$3 AND la.code=$4 AND le.status='posted'`, [uid, sourceType, id, code])).rows[0].n);

    console.log('\n' + '='.repeat(78));
    console.log('  LEDGER FOLLOWS EDITS — five money record types');
    console.log('='.repeat(78));

    const e = await h.post('/api/expenses', { description: 'Office chairs', amount: 100, expense_date: '2026-07-05' });
    await h.put('/api/expenses/' + e.json.id, { amount: 250 });
    A('expense 100→250: ledger 6000 net 250 (bug 100)', near(await net('expense', e.json.id, '6000'), 250), 'net=' + await net('expense', e.json.id, '6000'));

    const sr = await h.post('/api/sales-receipts', { customer: 'Walk-in', amount: 200, date: '2026-07-06' });
    await h.put('/api/sales-receipts/' + sr.json.id, { amount: 260 });
    A('sales receipt 200→260: ledger 4000 net −260 (bug −200)', near(await net('sales_receipt', sr.json.id, '4000'), -260), 'net=' + await net('sales_receipt', sr.json.id, '4000'));

    const cn = await h.post('/api/credit-notes', { customer: 'Acme', amount: 50, date: '2026-07-07', status: 'Open' });
    await h.put('/api/credit-notes/' + cn.json.id, { status: 'Void' });
    A('credit note 50→Void: contra net 0 (bug 50)', near(await net('credit_note', cn.json.id, '4000'), 0), 'net=' + await net('credit_note', cn.json.id, '4000'));

    const vc = await h.post('/api/vendor-credits', { vendor: 'Supplier', amount: 40, date: '2026-07-08', status: 'Open' });
    await h.put('/api/vendor-credits/' + vc.json.id, { amount: 70 });
    A('vendor credit 40→70: ledger 6000 net −70 (bug −40)', near(await net('vendor_credit', vc.json.id, '6000'), -70), 'net=' + await net('vendor_credit', vc.json.id, '6000'));

    const bill = await h.post('/api/bills', { vendor: 'Supplier', amount: 80, issue_date: '2026-07-01', due_date: '2026-08-01', status: 'unpaid' });
    const pm = await h.post('/api/payments-made', { vendor: 'Supplier', amount: 80, date: '2026-07-09' });
    await h.put('/api/payments-made/' + pm.json.id, { bill_id: bill.json.id });
    A('payment linked to bill: direct-expense leg removed, 6000 net 0 (bug 80)', near(await net('bill_payment', pm.json.id, '6000'), 0), 'net=' + await net('bill_payment', pm.json.id, '6000'));
    A('payment linked to bill: settles AP, 2000 net 80 (bug 0)', near(await net('bill_payment', pm.json.id, '2000'), 80), 'net=' + await net('bill_payment', pm.json.id, '2000'));

    // An open bill the vendor credit can net against. (A credit exceeding open AP is a separate,
    // pre-existing edge — canonical AP clamps at 0 while the ledger goes negative — logged as N96.)
    await h.post('/api/bills', { vendor: 'Supplier', amount: 200, issue_date: '2026-07-02', due_date: '2026-08-02', status: 'unpaid' });
    const v = await h.get('/api/gl/verify');
    A('books still balance against the reports after the edits (bug: false)', v.json && v.json.booksBalanced === true, JSON.stringify(v.json && v.json.entities && v.json.entities[0] && v.json.entities[0].detail));
    const bs = await h.post('/api/reports/balance-sheet', {});
    A('balance sheet still served from the ledger (real cash), not the fallback', bs.json && bs.json.source === 'gl', 'source=' + (bs.json && bs.json.source));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (GL resync on edit)` : `  ALL GREEN — ${pass} passed, 0 failed  (GL resync on edit)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
