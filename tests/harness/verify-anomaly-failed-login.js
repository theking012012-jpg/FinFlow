'use strict';
/**
 * verify-anomaly-failed-login.js — failed-login auditing + brute-force detection.
 *   (1) INSTRUMENTATION: a real HTTP login with the WRONG password writes a LOGIN_FAILED row w/ ip.
 *   (2) DETECTOR: failed_login_burst fires when one IP exceeds the failed-login threshold, silent
 *       below it and for out-of-window rows.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-anomaly-failed-login.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const { detectAuditAnomalies } = require('../../audit-anomalies.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function seedFail(c, ip, agoMin = 0) {
  await c.query(
    "INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, actor_type, actor_id, ip_address, changed_at) VALUES (NULL, NULL, 'users', NULL, 'LOGIN_FAILED', 'system', NULL, $1, NOW() - make_interval(mins => $2))",
    [ip, agoMin]);
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    console.log('\n' + '='.repeat(78));
    console.log('  FAILED-LOGIN AUDITING + brute-force (failed_login_burst) detection');
    console.log('='.repeat(78) + '\n');

    // (1) INSTRUMENTATION — real wrong-password login writes a LOGIN_FAILED row with an ip.
    console.log('-- instrumentation (real login route, wrong password) --');
    await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1)', [{ email: 'victim@finflow.test', role: 'owner', password: bcrypt.hashSync(PW, 10) }]);
    const r = await new HarnessHttp(server.baseUrl).post('/api/auth/login', { email: 'victim@finflow.test', password: 'WRONG-password' });
    A('wrong password → 401', r.status === 401, JSON.stringify(r.json));
    await new Promise(res => setTimeout(res, 80)); // fire-and-forget audit
    const fr = await c.query("SELECT ip_address, action FROM audit_trail WHERE action='LOGIN_FAILED'");
    A('a LOGIN_FAILED audit row was written', fr.rows.length >= 1, JSON.stringify(fr.rows));
    A('LOGIN_FAILED row captured an ip_address', fr.rows.length >= 1 && !!fr.rows[0].ip_address);
    // unknown-email attempt is also audited
    const r2 = await new HarnessHttp(server.baseUrl).post('/api/auth/login', { email: 'ghost@finflow.test', password: 'x' });
    A('unknown email → 401', r2.status === 401);
    await new Promise(res => setTimeout(res, 60));
    A('unknown-email attempt also audited', (await c.query("SELECT COUNT(*)::int n FROM audit_trail WHERE action='LOGIN_FAILED'")).rows[0].n >= 2);

    // (2) DETECTOR — burst from one IP fires; a few from another stays silent; out-of-window ignored.
    console.log('\n-- detector: failed_login_burst --');
    const OVER = { windowMinutes: 60, failedLogins: 10, crossClient: 9999, activity: 9999, massDelete: 9999, loginIps: 9999, massExport: 9999 };
    for (let i = 0; i < 11; i++) await seedFail(c, '203.0.113.7');        // attacker IP → burst
    for (let i = 0; i < 3; i++) await seedFail(c, '198.51.100.4');         // a few typos → silent
    for (let i = 0; i < 12; i++) await seedFail(c, '203.0.113.99', 120);   // burst but 2h ago → silent

    const { anomalies } = await detectAuditAnomalies(c, OVER);
    const burstIps = anomalies.filter(a => a.type === 'failed_login_burst').map(a => a.ip_address);
    A('attacker IP (11 fails) → failed_login_burst FIRES', burstIps.includes('203.0.113.7'));
    A('low-volume IP (3 fails) → silent (RED)', !burstIps.includes('198.51.100.4'));
    A('out-of-window burst IP → silent (RED)', !burstIps.includes('203.0.113.99'));
    A('burst anomaly is high severity + carries the IP + count', (a => a && a.severity === 'high' && a.count >= 11)(anomalies.find(a => a.type === 'failed_login_burst' && a.ip_address === '203.0.113.7')));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (failed-login auditing + brute-force detection)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
