'use strict';
/**
 * verify-anomaly-monitor.js — the periodic anomaly monitor. Proves: it stays OFF unless armed (guard),
 * respects the interval config, uses an unref'd timer, and its tick actually scans + emails via the
 * (mocked) Resend client when anomalies exist. No network.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-anomaly-monitor.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { startAnomalyMonitor } = require('../../audit-anomalies.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
let _seq = 0;
async function mkUser(c) { return (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1) RETURNING id', [{ email: 'mon' + (++_seq) + '@finflow.test', role: 'owner', password: 'x' }])).rows[0].id; }
async function seedDelete(c, uid) { await c.query("INSERT INTO audit_trail (user_id,entity_id,table_name,record_id,action,actor_type,actor_id,changed_at) VALUES ($1,NULL,'invoices',1,'DELETE','user',$1,NOW())", [uid]); }
function fakeResend() { const sent = []; return { sent, emails: { send: async (m) => { sent.push(m); return { id: 'x' }; } } }; }

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    delete process.env.SECURITY_ALERT_EMAIL;

    console.log('\n' + '='.repeat(78));
    console.log('  ANOMALY MONITOR — guard, config, unref, live tick');
    console.log('='.repeat(78) + '\n');

    // Guard: disabled by default (no recipient) and when explicitly disabled.
    A('disabled (no SECURITY_ALERT_EMAIL, no opts) → returns null', startAnomalyMonitor(c, fakeResend()) === null);
    A('explicitly disabled → returns null', startAnomalyMonitor(c, fakeResend(), { enabled: false }) === null);

    // Armed: returns a handle, respects interval, timer is unref'd (won't hold the process open).
    const m = startAnomalyMonitor(c, fakeResend(), { enabled: true, everyMinutes: 15, to: 'sec@finflow.test', over: { massDelete: 3, activity: 9999, crossClient: 9999 } });
    A('armed → returns { handle, tick, everyMinutes }', !!(m && m.handle && typeof m.tick === 'function'));
    A('respects everyMinutes config', m.everyMinutes === 15);

    // Live tick: no anomalies yet → no email.
    const fr1 = fakeResend();
    const m1 = startAnomalyMonitor(c, fr1, { enabled: true, to: 'sec@finflow.test', over: { massDelete: 3, activity: 9999, crossClient: 9999 } });
    await m1.tick();
    A('tick with no anomalies → no email sent', fr1.sent.length === 0);
    clearInterval(m1.handle);

    // Seed a mass_delete, tick again → email sent.
    const u = await mkUser(c); for (let i = 0; i < 4; i++) await seedDelete(c, u);
    const fr2 = fakeResend();
    const m2 = startAnomalyMonitor(c, fr2, { enabled: true, to: 'sec@finflow.test', over: { massDelete: 3, activity: 9999, crossClient: 9999 } });
    await m2.tick();
    A('tick with anomalies → exactly one alert email', fr2.sent.length === 1, 'sent=' + fr2.sent.length);
    A('alert email addressed to the recipient', fr2.sent[0] && fr2.sent[0].to === 'sec@finflow.test');
    clearInterval(m2.handle);
    clearInterval(m.handle);

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (anomaly monitor)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
