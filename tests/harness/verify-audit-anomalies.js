'use strict';
/**
 * verify-audit-anomalies.js — the read-only anomaly detector over audit_trail. Seeds discriminating
 * patterns straight into the real (append-only) trail, then asserts each signal fires ABOVE its
 * threshold and stays silent below it, and that rows outside the time window are ignored.
 *
 *   accountant_cross_client · activity_spike · mass_delete
 *
 * RED-proof is built in: the just-under-threshold actors and the out-of-window actor MUST NOT appear.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-audit-anomalies.js
 *
 * Scratch Postgres only. audit_trail.user_id has an FK to users, so client ids are real user rows;
 * accountant actor_id has no FK and stays a plain integer.
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { detectAuditAnomalies } = require('../../audit-anomalies.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

let _seq = 0;
async function mkUser(c) {
  const data = { email: 'anom' + (++_seq) + '@finflow.test', password: 'x', role: 'owner' };
  return (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1) RETURNING id', [data])).rows[0].id;
}
async function seed(c, { actor_type, actor_id, user_id, action = 'CREATE', table = 'invoices', agoMin = 0 }) {
  await c.query(
    "INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, actor_type, actor_id, changed_at) VALUES ($1, NULL, $2, 1, $3, $4, $5, NOW() - make_interval(mins => $6))",
    [user_id, table, action, actor_type, actor_id, agoMin]);
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    const TH = { windowMinutes: 60, crossClient: 3, activity: 5, massDelete: 3 };
    const AC1 = 900001, AC2 = 900002, AC3 = 900003;

    for (let i = 0; i < 3; i++) { const u = await mkUser(c); await seed(c, { actor_type: 'accountant', actor_id: AC1, user_id: u }); }
    for (let i = 0; i < 2; i++) { const u = await mkUser(c); await seed(c, { actor_type: 'accountant', actor_id: AC2, user_id: u }); }
    for (let i = 0; i < 3; i++) { const u = await mkUser(c); await seed(c, { actor_type: 'accountant', actor_id: AC3, user_id: u, agoMin: 120 }); }

    const U300 = await mkUser(c); for (let i = 0; i < 6; i++) await seed(c, { actor_type: 'user', actor_id: U300, user_id: U300 });
    const U400 = await mkUser(c); for (let i = 0; i < 2; i++) await seed(c, { actor_type: 'user', actor_id: U400, user_id: U400 });
    const U500 = await mkUser(c); for (let i = 0; i < 4; i++) await seed(c, { actor_type: 'user', actor_id: U500, user_id: U500, action: 'DELETE' });

    const { anomalies } = await detectAuditAnomalies(c, TH);
    const has = (type, id) => anomalies.some(a => a.type === type && String(a.actor_id) === String(id));

    console.log('\n' + '='.repeat(78));
    console.log('  AUDIT ANOMALY DETECTION — real append-only trail, threshold + window discrimination');
    console.log('='.repeat(78) + '\n');

    console.log('-- accountant_cross_client --');
    A('AC1 (3 distinct clients) -> FIRES', has('accountant_cross_client', AC1));
    A('AC2 (2 clients, under threshold) -> silent (RED)', !has('accountant_cross_client', AC2));
    A('AC3 (3 clients but out of window) -> silent (RED)', !has('accountant_cross_client', AC3));

    console.log('\n-- activity_spike --');
    A('U300 (6 actions) -> FIRES', has('activity_spike', U300));
    A('U400 (2 actions, under threshold) -> silent (RED)', !has('activity_spike', U400));
    A('AC1 (3 actions, under threshold) -> no spike (RED)', !has('activity_spike', AC1));

    console.log('\n-- mass_delete --');
    A('U500 (4 deletes) -> FIRES', has('mass_delete', U500));
    A('U300 (0 deletes) -> silent (RED)', !has('mass_delete', U300));

    console.log('\n-- shape --');
    A('every anomaly carries type/severity/actor_id/count/message', anomalies.every(a => a.type && a.severity && a.actor_id != null && Number.isFinite(a.count) && a.message));
    A('severities are known values', anomalies.every(a => ['high', 'medium', 'low'].includes(a.severity)));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (audit anomaly detection)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
