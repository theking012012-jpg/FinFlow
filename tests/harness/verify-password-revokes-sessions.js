#!/usr/bin/env node
'use strict';
/**
 * verify-password-revokes-sessions.js — N6 / N6b. Resetting or changing a password ends the account's
 * other sessions — on every route, not only those behind requireAuth.
 *
 * Defect: reset-password and change-password only rewrote the hash. Anyone already holding a session
 * (a stolen cookie, a shared computer) stayed logged in after the owner reset or changed the password.
 *
 * Executed against the real server + Postgres with three independent sessions (S1, S2 = other devices,
 * S3 = the device doing the change). Bug value stated:
 *   change-password on S3 → S1 /api/auth/me 401 SESSION_REVOKED        (bug: 200)
 *   … and S1 on a raw-session route (/api/accountants/my-accountant) → 401 (bug: 200)
 *   S3 (the changer) still works                                        (control)
 *   login with the new password works                                   (control)
 *   reset-password via emailed token → S2 and S3 401                    (bug: 200)
 *   node -r ./tests/harness/clock.js tests/harness/verify-password-revokes-sessions.js
 */
const crypto = require('crypto');
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
    const EMAIL = 'pw-rev@finflow.test', P1 = 'first-password-1', P2 = 'second-password-2', P3 = 'third-password-3';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: EMAIL, plan: 'business', role: 'owner', password: bcrypt.hashSync(P1, 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'Rev Co', currency: 'USD', is_active: 1 }]);
    let ip = 1; const H = () => new HarnessHttp(server.baseUrl, { xff: '10.6.0.' + (ip++) });
    const login = async (pw) => { const h = H(); const r = await h.post('/api/auth/login', { email: EMAIL, password: pw }); return r.status === 200 ? h : null; };
    const S1 = await login(P1), S2 = await login(P1), S3 = await login(P1);
    A('three sessions logged in', S1 && S2 && S3 && (await S1.get('/api/auth/me')).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  PASSWORD CHANGE / RESET ENDS OTHER SESSIONS');
    console.log('='.repeat(78));
    const ch = await S3.put('/api/auth/change-password', { currentPassword: P1, newPassword: P2 });
    A('change-password on S3 → 200', ch.status === 200, `status ${ch.status}: ${ch.text.slice(0, 100)}`);
    const m1 = await S1.get('/api/auth/me');
    A('S1 after the change → 401 SESSION_REVOKED (bug: 200)', m1.status === 401 && m1.json && m1.json.code === 'SESSION_REVOKED', `status ${m1.status}: ${m1.text.slice(0, 100)}`);
    const S2b = await login(P2);   // S2 is revoked too; keep a fresh second device for the reset step
    A('S2 after the change → 401 on a raw-session route (my-accountant) (bug: 200)', (await S2.get('/api/accountants/my-accountant')).status === 401);
    A('control: S3 (the device that changed it) still works', (await S3.get('/api/auth/me')).status === 200);
    A('control: login with the new password works', !!S2b);
    A('old password no longer logs in', !(await login(P1)));

    const token = crypto.randomBytes(16).toString('hex');
    await c.query(`INSERT INTO password_resets (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { token: crypto.createHash('sha256').update(token).digest('hex'), expires: new Date(Date.now() + 3600e3).toISOString() }]);
    const rs = await H().post('/api/auth/reset-password', { token, password: P3 });
    A('reset-password → 200', rs.status === 200, `status ${rs.status}: ${rs.text.slice(0, 100)}`);
    A('S2b after the reset → 401 (bug: 200)', (await S2b.get('/api/auth/me')).status === 401);
    A('S3 after the reset → 401 (bug: 200)', (await S3.get('/api/auth/me')).status === 401);
    A('control: login with the reset password works', !!(await login(P3)));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (password revokes sessions)` : `  ALL GREEN — ${pass} passed, 0 failed  (password revokes sessions)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
