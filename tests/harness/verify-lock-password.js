#!/usr/bin/env node
'use strict';
/**
 * verify-lock-password.js — N19. A password-protected period lock cannot be loosened without the
 * password — by the owner, an admin member, or the accountant portal — and the UI shows the refusal.
 *
 * Defect: lock_settings.password_hash was written and never read. Anyone with settings:manage (owner or
 * admin member) could disable the lock or pull its date back; the password was decorative. The UI
 * toasted "Lock settings saved" whatever the server answered.
 *
 * Executed against the real server + Postgres (owner, admin member, accountant). Bug value stated:
 *   owner disables without the password            → 403, June stays closed      (bug: 200, June open)
 *   owner moves the date earlier, no / wrong pw     → 403                         (bug: 200)
 *   admin member disables without the password      → 403                         (bug: 200)
 *   accountant reopens 2026-06                      → 403                         (bug: 200)
 *   control: tightening (later date) needs no password → 200
 *   control: owner disables WITH the password      → 200, June open
 *   node -r ./tests/harness/clock.js tests/harness/verify-lock-password.js
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
    const PW = 'lockpw-harness-1', LOCKPW = 'the-lock-password';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const O = await mk('lp-owner@finflow.test'), M = await mk('lp-admin@finflow.test');
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [O, { name: 'LP Co', currency: 'USD', is_active: 1 }]);
    await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [O, { email: 'lp-admin@finflow.test', role: 'admin', status: 'active', member_user_id: String(M) }]);
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status) VALUES ('lp-acc@finflow.test',$1,'L','P','F','LPREF1','verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','filing','client')`, [accId, O]);
    let ip = 1; const H = () => new HarnessHttp(server.baseUrl, { xff: '10.19.0.' + (ip++) });
    const ho = H(), hm = H(), ha = H();
    A('logins', (await ho.post('/api/auth/login', { email: 'lp-owner@finflow.test', password: PW })).status === 200
      && (await hm.post('/api/auth/login', { email: 'lp-admin@finflow.test', password: PW })).status === 200
      && (await ha.post('/api/accountants/login', { email: 'lp-acc@finflow.test', password: PW })).status === 200);
    const lock = (h, body) => h.post('/api/lock-settings', body);
    const june = async () => (await ho.post('/api/expenses', { description: 'June', amount: 5, expense_date: '2026-06-15' })).status;

    console.log('\n' + '='.repeat(78));
    console.log('  PASSWORD-PROTECTED PERIOD LOCK');
    console.log('='.repeat(78));
    A('owner locks through 2026-06-30 with a password → 200', (await lock(ho, { enabled: true, lock_date: '2026-06-30', password: LOCKPW })).status === 200);
    const d1 = await lock(ho, { enabled: false });
    A('owner disables WITHOUT the password → 403 (bug: 200)', d1.status === 403 && d1.json.code === 'LOCK_PASSWORD_REQUIRED', `status ${d1.status}`);
    A('  June stays closed (expense → 403) (bug: 201)', (await june()) === 403);
    A('owner moves the date earlier without the password → 403 (bug: 200)', (await lock(ho, { enabled: true, lock_date: '2026-05-31' })).status === 403);
    A('owner moves the date earlier with a WRONG password → 403 (bug: 200)', (await lock(ho, { enabled: true, lock_date: '2026-05-31', password: 'nope' })).status === 403);
    A('admin member disables without the password → 403 (bug: 200)', (await lock(hm, { enabled: false })).status === 403);
    const ar = await ha.post(`/api/accountants/clients/${O}/lock`, { period: '2026-06', locked: false });
    A('accountant reopens 2026-06 → 403 (bug: 200)', ar.status === 403, `status ${ar.status}: ${ar.text.slice(0, 100)}`);
    A('  June still closed', (await june()) === 403);
    A('control: tightening to 2026-07-15 needs no password → 200', (await lock(ho, { enabled: true, lock_date: '2026-07-15' })).status === 200);
    A('control: owner disables WITH the password → 200', (await lock(ho, { enabled: false, password: LOCKPW })).status === 200);
    A('control: June open again (expense → 201)', (await june()) === 201);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (lock password)` : `  ALL GREEN — ${pass} passed, 0 failed  (lock password)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
