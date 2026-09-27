#!/usr/bin/env node
'use strict';
/**
 * verify-migrate-entrypoint.js — F202: scripts/migrate.js (the owner-run release step) builds the full
 * schema and applies migrations against a fresh database, and is idempotent on a second run. This is
 * what lets the web process run as the least-privilege finflow_app role (SKIP_INIT_DDL=1).
 *
 *   node tests/harness/verify-migrate-entrypoint.js
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  try {
    const run = () => execFileSync('node', [path.join(__dirname, '..', '..', 'scripts', 'migrate.js')],
      { env: { ...process.env, DATABASE_URL: scratch.url, NODE_ENV: 'test' }, encoding: 'utf8', stdio: 'pipe' });

    // Fresh DB → migrate builds everything.
    const out1 = run();
    A('migrate.js exits 0 and reports schema ready', /schema ready/.test(out1), out1.trim().split('\n').pop());
    const coreTables = ['users', 'entities', 'invoices', 'ledger_entries', 'ledger_lines', 'schema_migrations'];
    const n = Number((await c.query(
      `SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`, [coreTables])).rows[0].n);
    A('all core tables exist after migrate', n === coreTables.length, 'found ' + n + '/' + coreTables.length);

    // Second run → idempotent (no error, 0 new migrations).
    const out2 = run();
    A('re-run is idempotent (0 new migrations, exit 0)', /0 new migration/.test(out2), out2.trim().split('\n').pop());

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (owner migrate entrypoint builds schema, idempotent)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[migrate-ep] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
