#!/usr/bin/env node
'use strict';
/**
 * verify-api-key-member-revoke.js — N97 (revocation half). An API key minted by a team member stops
 * working when that member loses access; owner keys are unaffected.
 *
 * Defect: keys carried no creator. A member (admin) could mint a key, be removed from the team, and keep
 * reading the account's books through /api/v1 indefinitely.
 *
 * Executed against the real server + Postgres. Bug value stated:
 *   admin member mints a key → /api/v1/invoices 200                       (control)
 *   member revoked → same key → 401 API_KEY_REVOKED                         (bug: 200)
 *   member re-added but demoted to viewer → key still 401                   (bug: 200)
 *   control: the owner's own key keeps working throughout
 *   node -r ./tests/harness/clock.js tests/harness/verify-api-key-member-revoke.js
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
    const PW = 'key-revoke-pw-1';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const O = await mk('kr-owner@finflow.test'), M = await mk('kr-admin@finflow.test');
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [O, { name: 'KR Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [O, eid, { client: 'C', amount: 10, status: 'pending', issue_date: '2026-07-01' }]);
    const tm = (await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [O, { email: 'kr-admin@finflow.test', role: 'admin', status: 'active', member_user_id: String(M) }])).rows[0].id;
    const ho = new HarnessHttp(server.baseUrl, { xff: '10.97.0.1' }), hm = new HarnessHttp(server.baseUrl, { xff: '10.97.0.2' });
    await ho.post('/api/auth/login', { email: 'kr-owner@finflow.test', password: PW });
    await hm.post('/api/auth/login', { email: 'kr-admin@finflow.test', password: PW });
    const mKey = (await hm.post('/api/api-keys', { name: 'member key' })).json.key;
    const oKey = (await ho.post('/api/api-keys', { name: 'owner key' })).json.key;
    const v1 = async (k) => (await fetch(server.baseUrl + '/api/v1/invoices', { headers: { Authorization: 'Bearer ' + k, 'X-Forwarded-For': '10.97.0.9' } })).status;

    console.log('\n' + '='.repeat(78));
    console.log('  MEMBER-MINTED API KEYS DIE WITH THE MEMBER\'S ACCESS');
    console.log('='.repeat(78));
    A('control: member key works while the member is an admin', (await v1(mKey)) === 200);
    await c.query(`UPDATE team_members SET data = data || '{"status":"revoked"}' WHERE id=$1`, [tm]);
    A('member revoked → their key → 401 (bug: 200)', (await v1(mKey)) === 401);
    await c.query(`UPDATE team_members SET data = data || '{"status":"active","role":"viewer"}' WHERE id=$1`, [tm]);
    A('member back but only a viewer → key still 401 (bug: 200)', (await v1(mKey)) === 401);
    A('control: the owner\'s key keeps working', (await v1(oKey)) === 200);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (API key member revoke)` : `  ALL GREEN — ${pass} passed, 0 failed  (API key member revoke)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
