#!/usr/bin/env node
'use strict';
/**
 * verify-admin-security-log.js — N89. The admin security log contains what the SERVER observed, and
 * nobody can write into it from outside.
 *
 * Defect: failed admin logins were never logged by the server. Instead admin.html called an
 * UNAUTHENTICATED endpoint, POST /api/admin/log-security, after a failure — so anyone could write
 * arbitrary entries into the security log, and an attacker scripting the login (never calling it) left
 * no trace at all.
 *
 * Executed against the real server + Postgres. Discriminating checks (Rule 4), bug value stated:
 *   anonymous POST /api/admin/log-security with forged notes → no row written   (bug: 1 forged row)
 *   scripted wrong-password login (no follow-up call)        → 1 failed_login row, reason + client IP  (bug: 0)
 *   correct login                                            → no failed_login row added            (control)
 *   GET /api/admin/security-log (as admin) shows the server-written row                            (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-admin-security-log.js
 */
process.env.ADMIN_PASSWORD = 'harness-admin-password';
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
    const rows = async () => (await c.query(`SELECT action, notes FROM admin_log WHERE target_type='security' ORDER BY id`)).rows;

    console.log('\n' + '='.repeat(78));
    console.log('  ADMIN SECURITY LOG — written by the server, not by callers');
    console.log('='.repeat(78));

    const anon = new HarnessHttp(server.baseUrl, { xff: '10.66.0.1' });
    const forged = await anon.post('/api/admin/log-security', { action: 'suspicious_activity', notes: 'FORGED: admin logged in from 1.2.3.4' });
    const r1 = await rows();
    A('anonymous log-security write → no row (bug: forged row inserted)', !r1.some(r => /FORGED/.test(r.notes || '')), JSON.stringify(r1) + ' status ' + forged.status);

    const attacker = new HarnessHttp(server.baseUrl, { xff: '10.66.0.2' });
    const bad = await attacker.post('/api/admin/login', { password: 'guess-1' });
    A('wrong password → 401', bad.status === 401, 'status ' + bad.status);
    await new Promise(r => setTimeout(r, 100));   // the log insert is fire-and-forget after the 401
    const r2 = (await rows()).filter(r => r.action === 'failed_login');
    A('scripted failed login is logged by the server: 1 row (bug: 0)', r2.length === 1, JSON.stringify(r2));
    A('  the row records the reason and the client IP', r2[0] && /Wrong password/.test(r2[0].notes) && /10\.66\.0\.2/.test(r2[0].notes), JSON.stringify(r2[0]));

    const admin = new HarnessHttp(server.baseUrl, { xff: '10.66.0.3' });
    const ok = await admin.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    A('control: correct login → 200', ok.status === 200, 'status ' + ok.status);
    await new Promise(r => setTimeout(r, 100));
    A('control: no failed_login row added for a successful login', (await rows()).filter(r => r.action === 'failed_login').length === 1);
    const log = await admin.get('/api/admin/security-log');
    A('control: admin security-log shows the server-written entry', log.status === 200 && Array.isArray(log.json) && log.json.some(r => /Wrong password from .*10\.66\.0\.2/.test(r.notes || '')), JSON.stringify(log.json).slice(0, 200));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (admin security log)` : `  ALL GREEN — ${pass} passed, 0 failed  (admin security log)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
