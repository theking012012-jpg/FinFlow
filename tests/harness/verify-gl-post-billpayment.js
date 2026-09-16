'use strict';
/**
 * verify-gl-post-billpayment.js — GL Phase 2: payments-made posting.
 * LINKED payment settles AP (Dr AP / Cr Cash); ORPHAN payment is a direct expense (Dr Opex / Cr Cash).
 * Proves both against computeBooks: a linked payment drives AP to 0 without changing opex; an orphan
 * payment increases opex. Trial balance ties to zero throughout.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-billpayment.js
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
    const { computeBooks } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 2 — payments made (linked settles AP · orphan = expense)\n' + '='.repeat(78) + '\n');
    const email = 'glbp@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.24' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const bal = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const tbZero = async () => { const t = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0]; return near(t.d - t.cr, 0); };

    // Bill (Dr Opex/Cr AP 80), then a LINKED payment settling it.
    const bill = JSON.parse((await http.post('/api/bills', { vendor: 'Acme', amount: 80, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid })).text);
    A('AP = 80 after bill', near(await bal('2000'), -80), 'ap=' + (await bal('2000')));
    const rl = await http.post('/api/payments-made', { vendor: 'Acme', amount: 80, date: '2026-06-20', bill_id: bill.id, entity_id: eid });
    A('POST linked payment 2xx', rl.status >= 200 && rl.status < 300, 'status=' + rl.status);
    const payL = JSON.parse(rl.text);
    const el = (await c.query(`SELECT id FROM ledger_entries WHERE source_type='bill_payment' AND source_id=$1`, [payL.id])).rows;
    const ll = (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.entry_id=$1`, [el[0] ? el[0].id : -1])).rows;
    const bcL = Object.fromEntries(ll.map(l => [l.code, l]));
    A('linked: Dr AP (2000) = 80', bcL['2000'] && near(bcL['2000'].debit, 80));
    A('linked: Cr Cash (1000) = 80', bcL['1000'] && near(bcL['1000'].credit, 80));
    A('linked: no Opex line (settlement, not expense)', !bcL['6000']);
    A('AP driven to 0 after settlement', near(await bal('2000'), 0), 'ap=' + (await bal('2000')));
    let books = await computeBooks(uid, eid, 'year');
    A('ORACLE: opex unchanged by linked payment (still 80)', near(books.opex, 80), 'opex=' + books.opex);

    // ORPHAN payment (no bill) → direct expense.
    const ro = await http.post('/api/payments-made', { vendor: 'Cash Misc', amount: 30, date: '2026-06-21', entity_id: eid });
    const payO = JSON.parse(ro.text);
    const eo = (await c.query(`SELECT id FROM ledger_entries WHERE source_type='bill_payment' AND source_id=$1`, [payO.id])).rows;
    const lo = (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.entry_id=$1`, [eo[0] ? eo[0].id : -1])).rows;
    const bcO = Object.fromEntries(lo.map(l => [l.code, l]));
    A('orphan: Dr Operating Expenses (6000) = 30', bcO['6000'] && near(bcO['6000'].debit, 30));
    A('orphan: Cr Cash (1000) = 30', bcO['1000'] && near(bcO['1000'].credit, 30));
    books = await computeBooks(uid, eid, 'year');
    A('ORACLE: ledger Opex == computeBooks.opex (80 bill + 30 orphan = 110)', near(await bal('6000'), books.opex) && near(books.opex, 110), 'opex=' + books.opex + ' ledger6000=' + (await bal('6000')));
    A('TRIAL BALANCE ties to zero', await tbZero());

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL payments-made == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
