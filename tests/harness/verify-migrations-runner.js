#!/usr/bin/env node
'use strict';
/**
 * verify-migrations-runner.js — the versioned migration runner is tracked, ordered, idempotent, and
 * boot-safe (a bad migration fails alone without throwing / bricking boot).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-migrations-runner.js
 */
require('./clock.js');
const fs = require('fs'), path = require('path'), os = require('os');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmig-'));
  try {
    server = await bootServer(scratch.url);
    const { runMigrations, pool } = require('../../database.js');

    fs.writeFileSync(path.join(dir, '2026-01-01-a.sql'), 'CREATE TABLE IF NOT EXISTS _mig_a (id int);');
    fs.writeFileSync(path.join(dir, '2026-01-02-b.sql'), 'CREATE TABLE IF NOT EXISTS _mig_b (id int);');

    // First run: both apply and are recorded.
    const r1 = await runMigrations(pool, dir);
    A('first run applies both pending migrations', r1.applied.length === 2 && r1.failed.length === 0, JSON.stringify(r1));
    A('schema_migrations table records them', Number((await c.query(`SELECT COUNT(*)::int n FROM schema_migrations WHERE name IN ('2026-01-01-a.sql','2026-01-02-b.sql')`)).rows[0].n) === 2);
    A('the migrations actually ran (tables exist)', Number((await c.query(`SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_name IN ('_mig_a','_mig_b')`)).rows[0].n) === 2);

    // Second run: nothing re-applies (tracked / idempotent).
    const r2 = await runMigrations(pool, dir);
    A('re-run applies nothing (already tracked)', r2.applied.length === 0 && r2.alreadyApplied >= 2, JSON.stringify(r2));

    // A broken migration fails ALONE, does not throw, is not recorded (so it retries next boot).
    fs.writeFileSync(path.join(dir, '2026-01-03-bad.sql'), 'THIS IS NOT VALID SQL;;;');
    const r3 = await runMigrations(pool, dir);
    A('a broken migration fails without throwing (boot-safe)', r3.failed.length === 1 && r3.failed[0].name === '2026-01-03-bad.sql', JSON.stringify(r3.failed));
    A('the broken migration is NOT recorded (will retry next boot)', Number((await c.query(`SELECT COUNT(*)::int n FROM schema_migrations WHERE name='2026-01-03-bad.sql'`)).rows[0].n) === 0);
    A('the earlier good migrations stay applied', Number((await c.query(`SELECT COUNT(*)::int n FROM schema_migrations WHERE name LIKE '2026-01-0%'`)).rows[0].n) === 2);

    // The REAL repo migration applies idempotently against the live schema (payroll_runs exists post-initDB).
    const rReal = await runMigrations();   // default pool + scripts/migrations dir
    A('the real repo migration(s) apply with zero failures (idempotent)', rReal.failed.length === 0, JSON.stringify(rReal.failed));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (versioned migration runner: tracked, idempotent, boot-safe)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[migrations] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
