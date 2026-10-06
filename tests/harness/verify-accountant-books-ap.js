#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-books-ap.js — N75 + N74. The accountant's /books shows the client's canonical
 * accounts payable, and only the customers of entities the accountant may see.
 *
 * Defects:
 *   N75 — /books AP = Σ amount of bills with status === 'unpaid' only: overdue / partial / due_soon
 *         bills, amounts already paid and vendor credits were ignored, so the accountant's AP disagreed
 *         with the client's balance sheet (Rule 2).
 *   N74 — allCustomers was not entity-filtered: an accountant granted only entity A saw entity B's customers.
 *
 * Executed against the real server + Postgres (client grants the accountant entity A only, B 'none').
 * Hand-computed expected AP for entity A (Rule 6 — independent of the code):
 *   unpaid 1000 + overdue 400 + partial (600 − 200 paid) 400 − open vendor credit 150 = 1650
 *   (buggy implementation: 1000). Entity B bill 9000 must not appear.
 *   /books accountsPayable (scope A) = 1650                      (bug: 1000)
 *   client's own balance sheet AP (entity A) = 1650               (control — same canonical figure)
 *   allCustomers = [Alpha Cust] only                              (bug: also Beta Hidden from entity B)
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-books-ap.js
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
    const PW = 'books-ap-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'ap-owner@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const bill = (eid, d) => c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, Object.assign({ vendor: 'V', issue_date: '2026-07-01', due_date: '2026-07-31' }, d)]);
    await bill(eA, { amount: 1000, status: 'unpaid' });
    await bill(eA, { amount: 400, status: 'overdue' });
    await bill(eA, { amount: 600, amount_paid: 200, status: 'partial' });
    await bill(eB, { amount: 9000, status: 'unpaid' });
    await c.query(`INSERT INTO vendor_credits (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { vendor: 'V', amount: 150, status: 'open', date: '2026-07-05' }]);
    await c.query(`INSERT INTO customers (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { company: 'Alpha Cust' }]);
    await c.query(`INSERT INTO customers (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eB, { company: 'Beta Hidden' }]);
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('ap-acc@finflow.test', $1, 'A', 'P', 'Firm', 'APREF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
    const O = new HarnessHttp(server.baseUrl, { xff: '10.75.0.1' });
    const ACC = new HarnessHttp(server.baseUrl, { xff: '10.75.0.2' });
    A('owner login', (await O.post('/api/auth/login', { email: 'ap-owner@finflow.test', password: PW })).status === 200);
    A('owner grants entity A only', (await O.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [eA]: 'view', [eB]: 'none' }, personal: 'none' } })).status === 200);
    A('accountant login', (await ACC.post('/api/accountants/login', { email: 'ap-acc@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT /books — canonical AP, permitted customers only');
    console.log('='.repeat(78));
    const b = await ACC.get(`/api/accountants/clients/${uid}/books?entity_id=${eA}`);
    A('/books 200', b.status === 200, `status ${b.status}: ${b.text.slice(0, 120)}`);
    const ap = b.json && b.json.balanceSheet && Number(b.json.balanceSheet.accountsPayable);
    A('/books AP (entity A) = 1650 hand-computed (bug: 1000)', ap === 1650, 'ap=' + ap);
    const all = await ACC.get(`/api/accountants/clients/${uid}/books`);
    const apAll = all.json && all.json.balanceSheet && Number(all.json.balanceSheet.accountsPayable);
    A('/books AP, all permitted entities = 1650 (entity B 9000 excluded)', apAll === 1650, 'ap=' + apAll);
    const bs = await O.post('/api/reports/balance-sheet?entity_id=' + eA, {});
    const ownerAp = bs.json && Number((bs.json.liabilities && bs.json.liabilities.accountsPayable) ?? bs.json.accountsPayable);
    A('control: client\'s own balance sheet AP (entity A) = 1650', ownerAp === 1650, JSON.stringify(bs.json).slice(0, 200));
    const cust = (all.json && all.json.allCustomers || []).map(x => x.company).sort();
    A('allCustomers = [Alpha Cust] only (bug: also Beta Hidden)', JSON.stringify(cust) === '["Alpha Cust"]', JSON.stringify(cust));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (accountant books AP + customers)` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant books AP + customers)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
