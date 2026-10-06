#!/usr/bin/env node
'use strict';
/**
 * verify-job-single-replica.js — N72. A scheduled job runs in one replica at a time.
 *
 * Defect: every replica ran the recurring scheduler, live-FX refresh, anomaly scan and GL reconcile scan on its
 * own timer — N replicas, N runs of every job (the reconcile scan computes books + ledger for every entity).
 * Executed: real Postgres, the real server's job wrappers (two "replicas" = two concurrent calls on separate
 * pool connections, exactly what two processes do through the advisory lock).
 *   two concurrent reconcile-scan ticks → exactly one runs, one skips      (bug: both run)
 *   after it finishes, the next tick runs (the lock is released)           (control)
 *   job-lock runExclusive: two concurrent slow jobs → one ran              (unit, executed)
 *   node -r ./tests/harness/clock.js tests/harness/verify-job-single-replica.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    A('server exposes the replica-exclusive job wrappers', app._jobs && typeof app._jobs.reconcile === 'function', 'no app._jobs');
    if (app._jobs) {
      // The two ticks must OVERLAP for the test to mean anything: on an empty database the scan finishes in a few
      // ms, so the second tick could find the lock already released and run AFTER the first — legitimately (that
      // is not two replicas at once) — which made this assertion pass or fail on timing. Hold the scan's first
      // query for 300 ms so the second tick always arrives while the first holds the lock.
      const { pool: _p } = require('../../database.js');
      const _realQ = _p.query.bind(_p);
      _p.query = (text, ...rest) => /FROM entities e ORDER BY e\.user_id/.test(String(text && text.text || text))
        ? new Promise(r => setTimeout(r, 300)).then(() => _realQ(text, ...rest)) : _realQ(text, ...rest);
      const _first = app._jobs.reconcile(null);
      await new Promise(r => setTimeout(r, 100));   // the first tick is inside the scan, holding the lock
      const [a, b] = await Promise.all([_first, app._jobs.reconcile(null)]);
      _p.query = _realQ;
      A('two concurrent reconcile ticks → exactly one ran (bug: both run)', [a, b].filter(x => x && x.ran).length === 1, JSON.stringify([a && a.ran, b && b.ran]));
      const c = await app._jobs.reconcile(null);
      A('control: the next tick runs (lock released)', c && c.ran === true, JSON.stringify(c && c.ran));
    }
    const { runExclusive } = require('../../job-lock.js');
    const { pool } = require('../../database.js');
    let runs = 0;
    const slow = () => new Promise(r => setTimeout(() => { runs++; r('done'); }, 200));
    const res = await Promise.all([runExclusive(pool, 'harness-job', slow), runExclusive(pool, 'harness-job', slow)]);
    A('runExclusive: two concurrent slow jobs → one ran', runs === 1 && res.filter(r => r.ran).length === 1, JSON.stringify({ runs, res }));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (job single replica)` : `  ALL GREEN — ${pass} passed, 0 failed  (job single replica)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
