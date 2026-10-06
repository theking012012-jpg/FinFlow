#!/usr/bin/env node
'use strict';
/**
 * verify-networth-snapshot.js — N16. The stored net-worth / portfolio snapshot equals the figure the page
 * shows: GET /api/personal-accounts (personal + the viewed business's rows) and the personal portfolio
 * (GET /api/holdings?scope=personal).
 *
 * Defect: POST /api/snapshots/capture summed accounts whose entity EXACTLY equals the viewed business (so a
 * personal, entity-less account was left out) and holdings of personal + business (the page shows personal
 * only). The stored series — and the month-over-month change computed from it — never matched the screen.
 *
 * Seed (business A viewed): accounts — personal asset 1000, A-tagged asset 500, personal liability 200;
 * holdings — personal 10 × 10 = 100, business(A) 3 × 100 = 300.
 *   networth snapshot = 1000 + 500 + 100 − 200 = 1400    (bug: 500 + 400 − 0 = 900)
 *   portfolio snapshot = 100                              (bug: 400)
 *   accountant portal personal net worth = 1400, portfolio 100   (bug: 1700 / 400)
 *   node -r ./tests/harness/clock.js tests/harness/verify-networth-snapshot.js
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
    const PW = 'networth-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'nw@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const ins = (t, e, d) => c.query(`INSERT INTO ${t} (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, e, d]);
    await ins('personal_accounts', null, { kind: 'asset', name: 'Savings', type: 'bank', value: 1000 });
    await ins('personal_accounts', eA, { kind: 'asset', name: 'Car', type: 'vehicle', value: 500 });
    await ins('personal_accounts', null, { kind: 'liability', name: 'Card', type: 'credit', value: 200 });
    await ins('holdings', null, { ticker: 'PER', name: 'Personal fund', shares: 10, price: 10, cost_per: 8 });
    await ins('holdings', eA, { ticker: 'BIZ', name: 'Business fund', shares: 3, price: 100, cost_per: 90 });
    const h = new HarnessHttp(server.baseUrl, { xff: '10.16.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'nw@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  NET-WORTH SNAPSHOT = the net worth on screen');
    console.log('='.repeat(78));
    // What the page adds up, from the endpoints it reads (hand-checked: 1500 assets, 200 liabilities, 100 portfolio).
    const accts = (await h.get(`/api/personal-accounts?entity_id=${eA}`)).json || [];
    const holds = (await h.get(`/api/holdings?scope=personal&entity_id=${eA}`)).json || [];
    const page = accts.filter(a => a.kind === 'asset').reduce((s, a) => s + Number(a.value), 0) - accts.filter(a => a.kind === 'liability').reduce((s, a) => s + Number(a.value), 0)
      + holds.reduce((s, x) => s + Number(x.shares) * Number(x.price), 0);
    A('page net worth (from the endpoints it reads) = 1400 (hand-computed)', page === 1400, 'page=' + page);
    const nw = await h.post(`/api/snapshots/capture?entity_id=${eA}`, { kind: 'networth' });
    A('networth snapshot = 1400 (bug: 900)', nw.json && Number(nw.json.value) === 1400, `status ${nw.status} value=${nw.json && nw.json.value}`);
    const pf = await h.post(`/api/snapshots/capture?entity_id=${eA}`, { kind: 'portfolio' });
    A('portfolio snapshot = 100 (bug: 400 — business holding included)', pf.json && Number(pf.json.value) === 100, `value=${pf.json && pf.json.value}`);
    const nw2 = await h.post(`/api/snapshots/capture?entity_id=${eA}`, { kind: 'networth' });
    A('control: re-capture upserts the same month (updated, still 1400)', nw2.json && nw2.json.updated === true && Number(nw2.json.value) === 1400, JSON.stringify(nw2.json));

    // Third surface: the accountant portal's personal summary (personal access granted). Accounts: all of
    // the client's personal accounts (no business is being viewed there) = 1500 − 200; portfolio = the
    // personal holding only = 100 → net worth 1400.   (bug: portfolio 400 incl. the business holding → 1700)
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('nw-acc@finflow.test', $1, 'Acc', 'NW', 'Firm', 'NWREF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, entity_access) VALUES ($1,$2,'active','view',$3)`,
      [accId, uid, JSON.stringify({ entities: { [eA]: 'view' }, personal: 'view' })]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '10.16.0.2' });
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'nw-acc@finflow.test', password: PW })).status === 200);
    const bk = (await acc.get('/api/accountants/clients/' + uid + '/books')).json || {};
    const pers = bk.personal || {};
    A('accountant portal: personal portfolio 100 (bug: 400 — business holding counted)', Number(pers.portfolio) === 100, JSON.stringify({ portfolio: pers.portfolio, netWorth: pers.netWorth }));
    A('accountant portal: personal net worth 1400 = the owner\'s figure (bug: 1700)', Number(pers.netWorth) === 1400, 'netWorth=' + pers.netWorth);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (net-worth snapshot)` : `  ALL GREEN — ${pass} passed, 0 failed  (net-worth snapshot)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
