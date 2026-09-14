'use strict';
/**
 * verify-anomaly-events.js — login/export event auditing + the two signals they unlock.
 *   (1) INSTRUMENTATION: a real HTTP owner login writes a LOGIN audit row with an ip_address.
 *   (2) DETECTOR: login_multi_ip (one principal, many distinct login IPs) and mass_export fire above
 *       threshold and stay silent below it.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-anomaly-events.js
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

let _seq = 0;
async function mkOwner(c, withPw) {
  const data = { email: 'evt' + (++_seq) + '@finflow.test', role: 'owner', password: withPw ? bcrypt.hashSync(PW, 10) : 'x' };
  return (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1) RETURNING id', [data])).rows[0].id;
}
async function seed(c, { actor_type, actor_id, user_id, action, ip = null, agoMin = 0 }) {
  await c.query(
    "INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, actor_type, actor_id, ip_address, changed_at) VALUES ($1, NULL, 'x', 1, $2, $3, $4, $5, NOW() - make_interval(mins => $6))",
    [user_id, action, actor_type, actor_id, ip, agoMin]);
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    console.log('\n' + '='.repeat(78));
    console.log('  ANOMALY EVENTS — login/export auditing + login_multi_ip & mass_export signals');
    console.log('='.repeat(78) + '\n');

    // (1) INSTRUMENTATION — a real HTTP login must write a LOGIN audit row with an ip.
    console.log('-- instrumentation (real login route) --');
    const owner = await mkOwner(c, true);
    const r = await new HarnessHttp(server.baseUrl).post('/api/auth/login', { email: 'evt' + _seq + '@finflow.test', password: PW });
    A('owner login → 200', r.status === 200, JSON.stringify(r.json));
    await new Promise(res => setTimeout(res, 80)); // logAudit is fire-and-forget
    const lr = await c.query("SELECT action, ip_address, actor_type, actor_id FROM audit_trail WHERE action='LOGIN' AND actor_id=$1", [owner]);
    A('login wrote a LOGIN audit row', lr.rows.length >= 1, JSON.stringify(lr.rows));
    A('LOGIN row captured an ip_address', lr.rows.length >= 1 && !!lr.rows[0].ip_address, JSON.stringify(lr.rows[0]));
    A('LOGIN row attributed to the owner (actor_type=user)', lr.rows.length >= 1 && lr.rows[0].actor_type === 'user');

    // (2) DETECTOR — seed discriminating patterns. Isolate the two new signals with high other thresholds.
    console.log('\n-- detector: login_multi_ip & mass_export --');
    const OVER = { windowMinutes: 60, loginIps: 3, massExport: 5, crossClient: 9999, activity: 9999, massDelete: 9999 };

    const U1 = await mkOwner(c); for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) await seed(c, { actor_type: 'user', actor_id: U1, user_id: U1, action: 'LOGIN', ip });
    const U2 = await mkOwner(c); for (const ip of ['9.9.9.9', '8.8.8.8']) await seed(c, { actor_type: 'user', actor_id: U2, user_id: U2, action: 'LOGIN', ip });
    const U1o = await mkOwner(c); for (const ip of ['5.5.5.5', '6.6.6.6', '7.7.7.7']) await seed(c, { actor_type: 'user', actor_id: U1o, user_id: U1o, action: 'LOGIN', ip, agoMin: 120 }); // out of window

    const U3 = await mkOwner(c); for (let i = 0; i < 6; i++) await seed(c, { actor_type: 'user', actor_id: U3, user_id: U3, action: 'EXPORT' });
    const U4 = await mkOwner(c); for (let i = 0; i < 2; i++) await seed(c, { actor_type: 'user', actor_id: U4, user_id: U4, action: 'EXPORT' });

    const { anomalies } = await detectAuditAnomalies(c, OVER);
    const has = (type, id) => anomalies.some(a => a.type === type && String(a.actor_id) === String(id));

    A('U1 (3 distinct login IPs) → login_multi_ip FIRES', has('login_multi_ip', U1));
    A('U2 (2 IPs, under threshold) → silent (RED)', !has('login_multi_ip', U2));
    A('U1o (3 IPs but out of window) → silent (RED)', !has('login_multi_ip', U1o));
    A('U3 (6 exports) → mass_export FIRES', has('mass_export', U3));
    A('U4 (2 exports, under threshold) → silent (RED)', !has('mass_export', U4));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (anomaly events: login/export auditing + signals)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
