#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-fiscal-year.js — N109. The accountant portal windows a client's books on the CLIENT's
 * fiscal year — the setting the owner saves on the Settings page.
 *
 * Defect: _clientScope read users.data.fiscal_year, which nothing writes (PUT /api/settings stores it in
 * user_settings), so the accountant always saw a January–December year while the owner saw their own.
 *
 * Seed (today 2026-07-25): the owner saves fiscal year "April" through PUT /api/settings (the real write
 * path). Invoices 2026-02-10 1000 and 2026-05-10 300.
 *   owner dashboard (/api/reports?period=year&fyStart=3): revenue 300
 *   accountant /books?period=year: revenue 300 = the owner's      (bug: 1300 — January year)
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-fiscal-year.js
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
    const PW = 'acc-fy-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'afy@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    for (const [ymd, amt] of [['2026-02-10', 1000], ['2026-05-10', 300]]) {
      await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz)`, [uid, eA, { client: 'C', amount: amt, amount_paid: 0, status: 'pending', issue_date: ymd, due_date: ymd }, ymd + 'T16:00:00Z']);
    }
    const owner = new HarnessHttp(server.baseUrl, { xff: '10.109.0.1' });
    A('owner login', (await owner.post('/api/auth/login', { email: 'afy@finflow.test', password: PW })).status === 200);
    const sv = await owner.put('/api/settings', { fiscal_year: 'April' });
    A('owner saves fiscal year April (PUT /api/settings)', sv.status === 200, `status ${sv.status} ${sv.text.slice(0, 100)}`);
    const ownerRev = Number(((await owner.get(`/api/reports?entity_id=${eA}&period=year&fyStart=3`)).json || {}).revenue);
    A('owner dashboard (April FY): revenue 300 (hand-computed)', ownerRev === 300, 'revenue ' + ownerRev);

    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('afy-acc@finflow.test', $1, 'Acc', 'FY', 'Firm', 'AFYREF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','view')`, [accId, uid]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '10.109.0.2' });
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'afy-acc@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log("  ACCOUNTANT PORTAL USES THE CLIENT'S FISCAL YEAR");
    console.log('='.repeat(78));
    const bk = await acc.get('/api/accountants/clients/' + uid + '/books?period=year');
    const rev = Number(((bk.json || {}).summary || {}).revenue);
    A('accountant /books (year): revenue 300 = the owner\'s (bug: 1300, January year)', rev === 300, `status ${bk.status} revenue ${rev}`);
    const ai = await acc.get('/api/accountants/clients/' + uid + '/books?period=year&entity_id=' + eA);
    A('accountant /books for the entity: revenue 300', Number(((ai.json || {}).summary || {}).revenue) === 300, 'revenue ' + (((ai.json || {}).summary || {}).revenue));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (accountant fiscal year)` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant fiscal year)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
