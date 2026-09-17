'use strict';
/**
 * verify-gl-bankrec.js - #4 IMPORT + BANK REC -> GL. Bank reconciliation actions that CREATE a
 * transaction must post to the ledger exactly as the normal routes do; actions that MATCH an
 * already-recorded transaction must post NOTHING (it is already on the books - matching is not a
 * second event). Proves:
 *   * /book-expense (bank debit -> expense) posts Dr Operating Expenses / Cr Cash, key 'expense:'+id.
 *   * /match-bill (bank debit -> settles a bill) posts Dr Accounts Payable / Cr Cash, key
 *     'payment_made:'+id (the bill already accrued the expense - no double count).
 *   * /match (bank credit -> existing invoice payment) posts NO new entry (already recorded).
 *   * trial balance ties to zero; re-booking the same bank line is idempotent (no second entry).
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-bankrec.js
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
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  #4 BANK REC -> GL - categorised lines post; matched lines do not\n' + '='.repeat(78) + '\n');
    const email = 'glbank@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.79' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const mkBank = (amt, type, desc) => c.query(`INSERT INTO personal_transactions (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [uid, eid, { source: 'banking', tx_type: type, amount: amt, tx_date: '2026-06-03', description: desc, category: 'Office' }]).then(r => r.rows[0].id);
    const linesFor = async (st, sid) => Object.fromEntries((await c.query(`SELECT la.code, ll.debit::float AS debit, ll.credit::float AS credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id JOIN ledger_entries le ON le.id=ll.entry_id WHERE le.user_id=$1 AND le.source_type=$2 AND le.source_id=$3`, [uid, st, sid])).rows.map(l => [l.code, l]));
    const entryCount = async () => (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1`, [uid])).rows[0].n;

    // 1) bank debit -> book-expense -> Dr 6000 / Cr 1000
    const bank1 = await mkBank(150, 'debit', 'Office supplies');
    const be = await http.post('/api/bank-reconciliation/book-expense', { banking_id: bank1, category: 'Office' });
    A('book-expense 2xx', be.status >= 200 && be.status < 300, 'status=' + be.status + ' ' + (be.text || '').slice(0, 140));
    const expId = JSON.parse(be.text).expense.id;
    const le1 = await linesFor('expense', expId);
    A('book-expense -> Dr Opex (6000)=150 / Cr Cash (1000)=150', le1['6000'] && near(le1['6000'].debit, 150) && le1['1000'] && near(le1['1000'].credit, 150), JSON.stringify(le1));

    // 2) bill (accrues Dr6000/Cr2000) + bank debit -> match-bill -> Dr 2000 / Cr 1000 (settle AP)
    const bill = JSON.parse((await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid })).text);
    const bank2 = await mkBank(300, 'debit', 'Acme payment');
    const mb = await http.post('/api/bank-reconciliation/match-bill', { banking_id: bank2, bill_id: bill.id });
    A('match-bill 2xx', mb.status >= 200 && mb.status < 300, 'status=' + mb.status + ' ' + (mb.text || '').slice(0, 140));
    const payId = JSON.parse(mb.text).payment.id;
    const le2 = await linesFor('bill_payment', payId);
    A('match-bill -> Dr Accounts Payable (2000)=300 / Cr Cash (1000)=300', le2['2000'] && near(le2['2000'].debit, 300) && le2['1000'] && near(le2['1000'].credit, 300), JSON.stringify(le2));
    // The bill still accrues its expense once (no double count): Opex from the bill entry only.
    const billLines = await linesFor('bill', bill.id);
    A('bill still accrues Dr Opex (6000)=300 once (no double count)', billLines['6000'] && near(billLines['6000'].debit, 300), JSON.stringify(billLines));

    // 3) money-in: invoice + invoice payment (already posts Dr1000/Cr1100) -> /match posts NOTHING new
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).text);
    const ipRes = await http.post('/api/invoice-payments', { invoice_id: inv.id, amount: 400, payment_date: '2026-06-05' });
    const ip = JSON.parse(ipRes.text);
    const beforeMatch = await entryCount();
    const bank3 = await mkBank(400, 'credit', 'Customer deposit');
    const m = await http.post('/api/bank-reconciliation/match', { banking_id: bank3, invoice_payment_id: ip.id });
    A('match (money-in) 2xx', m.status >= 200 && m.status < 300, 'status=' + m.status + ' ' + (m.text || '').slice(0, 140));
    A('match posts NO new ledger entry (already recorded)', (await entryCount()) === beforeMatch, 'before=' + beforeMatch + ' after=' + (await entryCount()));

    // 4) trial balance ties to zero
    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE ties to zero', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));

    // 5) idempotency: re-booking the same bank debit posts no second entry
    const cBefore = await entryCount();
    const be2 = await http.post('/api/bank-reconciliation/book-expense', { banking_id: bank1, category: 'Office' });
    A('re-book same bank line -> duplicate, no error', be2.status >= 200 && be2.status < 300);
    A('idempotent: no second ledger entry', (await entryCount()) === cBefore, 'before=' + cBefore + ' after=' + (await entryCount()));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (bank rec posts to the GL correctly)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
