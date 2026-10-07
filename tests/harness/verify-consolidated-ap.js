#!/usr/bin/env node
'use strict';
/**
 * verify-consolidated-ap.js — N99. Accounts payable in the all-businesses (consolidated) view includes every
 * business's bills, converted to the base currency — on the balance sheet and in the accountant portal.
 *
 * Defects: canonicalAP(user, null) filtered entity_id IS NULL rows only, so every business's bills fell out of
 * the consolidated balance sheet's AP; the accountant all-entities AP summed per-entity native amounts across
 * currencies (USD 100 + TTD 1000 = "1100").
 * Seed: base USD. A (USD) bill 100 unpaid; B (TTD) bill 1000 unpaid; rate TTD→USD 0.15 (dated before the bills).
 *   consolidated AP = 100 + 1000 × 0.15 = 250       (bug: 0 — only entity-less bills)
 *   accountant all-view AP = 250                     (bug: 1100 raw sum)
 *   single business A: AP 100 (control) · B: AP 1000 TTD native (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-consolidated-ap.js
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
    const PW = 'cons-ap-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'cap@finflow.test', plan: 'business', role: 'owner', base_currency: 'USD', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'TTD', is_active: 0 }])).rows[0].id;
    await c.query(`INSERT INTO fx_rates (user_id,entity_id,from_currency,to_currency,rate,rate_date) VALUES ($1,NULL,'TTD','USD',0.15,'2026-01-01')`, [uid]);
    await c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { vendor: 'VA', amount: 100, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-08-01' }]);
    await c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eB, { vendor: 'VB', amount: 1000, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-02', due_date: '2026-08-02' }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.99.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'cap@finflow.test', password: PW })).status === 200);
    const bs = async (q) => (await h.post('/api/reports/balance-sheet?entity_id=' + q, {})).json || {};
    const all = await bs('all');
    A('consolidated balance sheet AP = 100 + 1000 × 0.15 = 250 (bug: 0)', Number(all.accountsPayable) === 250, JSON.stringify({ ap: all.accountsPayable, source: all.source }));
    A('control: business A AP 100', Number((await bs(eA)).accountsPayable) === 100);
    A('control: business B AP 1000 (native TTD)', Number((await bs(eB)).accountsPayable) === 1000);

    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('cap-acc@finflow.test', $1, 'Acc', 'AP', 'Firm', 'CAPREF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','view')`, [accId, uid]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '10.99.0.2' });
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'cap-acc@finflow.test', password: PW })).status === 200);
    const bk = (await acc.get('/api/accountants/clients/' + uid + '/books')).json || {};
    A('accountant all-businesses AP = 250 (bug: 1100 — USD 100 + TTD 1000 summed raw)', Number(bk.balanceSheet && bk.balanceSheet.accountsPayable) === 250, JSON.stringify(bk.balanceSheet && { ap: bk.balanceSheet.accountsPayable, byEntity: bk.balanceSheet.accountsPayableByEntity }));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (consolidated AP)` : `  ALL GREEN — ${pass} passed, 0 failed  (consolidated AP)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
