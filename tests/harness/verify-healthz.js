'use strict';
/**
 * verify-healthz.js — the public /healthz uptime endpoint. Proves: unauthenticated 200 with a healthy
 * body + no-store caching, and — RED-proven — a 503 "degraded" when the DB is actually down (we stop
 * the scratch Postgres and hit it again).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-healthz.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  let server = null, dbStopped = false;
  try {
    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);

    console.log('\n' + '='.repeat(78));
    console.log('  HEALTHZ — public uptime endpoint (healthy 200, DB-down 503)');
    console.log('='.repeat(78) + '\n');

    // Healthy — no cookie/auth sent.
    const r = await http.get('/healthz');
    A('GET /healthz (unauthenticated) → 200', r.status === 200, JSON.stringify(r.json));
    A('body: status ok + db up', r.json && r.json.status === 'ok' && r.json.db === 'up', JSON.stringify(r.json));
    A('body: reports uptime + latency', r.json && Number.isFinite(r.json.uptime_s) && Number.isFinite(r.json.latency_ms));
    A('Cache-Control: no-store', String(r.headers.get('cache-control') || '').includes('no-store'));

    // RED proof: kill the DB, then the same endpoint must report degraded (503), not lie 200.
    await scratch.stop(); dbStopped = true;
    const d = await http.get('/healthz');
    A('DB down → 503 (not a false 200)', d.status === 503, 'status=' + d.status);
    A('DB down → body status degraded + db down', d.json && d.json.status === 'degraded' && d.json.db === 'down', JSON.stringify(d.json));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (healthz)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    if (!dbStopped) { try { await scratch.stop(); } catch (_) {} }
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
