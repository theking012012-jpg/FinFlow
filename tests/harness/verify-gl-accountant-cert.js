'use strict';
/**
 * verify-gl-accountant-cert.js — MARKETPLACE MOAT: FinFlux GL certification in the accountant portal.
 * When an accountant opens a client's books (GET /api/accountants/clients/:id/books), the response
 * carries a `certification` block: per permitted entity, FinFlux's own ledger says whether the books
 * tie out (trial balance to zero, balance sheet balances, GL P&L == the canonical reports ex-FX), and
 * an overall `certified`. A trust signal no competitor has. Proves it is HONEST + RED-provable:
 *   1. dual-write ledger present → certified TRUE (every sub-flag true).
 *   2. one ledger line deleted   → certified FALSE (trial balance breaks).
 *   3. ledger wiped (behind the source docs) → certified FALSE (reconciledToReports breaks) even though
 *      an empty trial balance trivially ties.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-accountant-cert.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  MARKETPLACE MOAT — GL "books certified" in the accountant client-books view\n' + '='.repeat(78) + '\n');
    const clientId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email: 'certclient@finflow.test', name: 'Client Co', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [clientId, { name: 'Client Co', currency: 'USD' }])).rows[0].id;
    const accId = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status) VALUES ('certacc@finflow.test',$1,'Acc','Cert','Firm','CERTCODE','verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id,user_id,status,access_level) VALUES ($1,$2,'active','view')`, [accId, clientId]);

    const owner = new HarnessHttp(server.baseUrl, { xff: '203.0.113.90' });
    const acc = new HarnessHttp(server.baseUrl, { xff: '203.0.113.91' });
    A('owner login', (await owner.post('/api/auth/login', { email: 'certclient@finflow.test', password: PW })).status === 200);
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'certacc@finflow.test', password: PW })).status === 200);

    // Client activity → dual-write posts a balanced ledger.
    A('client posts invoice 1000', (await owner.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).status < 300);
    A('client posts expense 200', (await owner.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-01', category: 'Office', entity_id: eid })).status < 300);

    const books = async () => (await acc.get('/api/accountants/clients/' + clientId + '/books')).json;

    // 1) Certified.
    const b1 = await books();
    A('certification block present in books response', b1 && b1.certification != null, JSON.stringify(b1 && Object.keys(b1)));
    const c1 = b1.certification;
    A('1) certified TRUE (dual-write ledger balances + reconciles)', c1.certified === true, JSON.stringify(c1));
    A('1) entity sub-flags all true', c1.entities[eid] && c1.entities[eid].booksBalanced && c1.entities[eid].trialBalanced && c1.entities[eid].balanceSheetBalanced && c1.entities[eid].reconciledToReports, JSON.stringify(c1.entities[eid]));

    // 2) Break one entry → trial balance no longer ties.
    const del = await c.query(`DELETE FROM ledger_lines WHERE user_id=$1 AND credit>0 AND account_id=(SELECT id FROM ledger_accounts WHERE user_id=$1 AND entity_id=$2 AND code='4000')`, [clientId, eid]);
    A('2) deleted one Revenue credit line', del.rowCount === 1, 'deleted ' + del.rowCount);
    const c2 = (await books()).certification;
    A('2) BROKEN ledger → certified FALSE', c2.certified === false, JSON.stringify(c2));
    A('2) BROKEN ledger → entity trialBalanced FALSE', c2.entities[eid] && c2.entities[eid].trialBalanced === false, JSON.stringify(c2.entities[eid]));

    // 3) Wipe the ledger → behind the source docs → reconciledToReports FALSE.
    await c.query(`DELETE FROM ledger_lines WHERE user_id=$1`, [clientId]);
    await c.query(`DELETE FROM ledger_entries WHERE user_id=$1`, [clientId]);
    const c3 = (await books()).certification;
    A('3) WIPED ledger → certified FALSE', c3.certified === false, JSON.stringify(c3));
    A('3) WIPED ledger → reconciledToReports FALSE, trialBalanced TRUE (empty ties)', c3.entities[eid] && c3.entities[eid].reconciledToReports === false && c3.entities[eid].trialBalanced === true, JSON.stringify(c3.entities[eid]));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (accountant sees honest, RED-provable GL certification)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
