#!/usr/bin/env node
'use strict';
/**
 * verify-boot-modes.js — F202 regression on the REAL production boot path (require.main === module),
 * which the module-based harnesses never exercise. Confirms:
 *   (1) default boot still builds schema itself and serves,
 *   (2) SKIP_INIT_DDL=1 boot serves against an already-migrated DB without running DDL.
 * Spawns `node server.js` as a child, waits for /healthz, then kills it.
 *
 *   node tests/harness/verify-boot-modes.js
 */
const path = require('path');
const { spawn } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootAndProbe(scratchUrl, port, extraEnv) {
  const child = spawn('node', [path.join(__dirname, '..', '..', 'server.js')], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: scratchUrl, PORT: String(port),
           SESSION_SECRET: 'boot-mode-test-secret', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let status = 0;
  for (let i = 0; i < 40; i++) {           // up to ~20s
    await sleep(500);
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.status) { status = r.status; break; } } catch (_) {}
  }
  try { child.kill('SIGKILL'); } catch (_) {}
  return { status, out };
}

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  try {
    // (1) default boot on a FRESH db → boot builds schema, serves.
    const r1 = await bootAndProbe(scratch.url, 4801, {});
    A('default boot serves /healthz (200)', r1.status === 200, 'status=' + r1.status + ' ' + r1.out.split('\n').slice(-3).join(' | '));

    // (2) SKIP_INIT_DDL boot on the now-migrated db → serves, and logs that it skipped DDL.
    const r2 = await bootAndProbe(scratch.url, 4802, { SKIP_INIT_DDL: '1' });
    A('SKIP_INIT_DDL boot serves /healthz (200)', r2.status === 200, 'status=' + r2.status + ' ' + r2.out.split('\n').slice(-3).join(' | '));
    A('SKIP_INIT_DDL boot logged that it skipped initDB', /SKIP_INIT_DDL/.test(r2.out));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (both boot modes serve)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[boot-modes] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
