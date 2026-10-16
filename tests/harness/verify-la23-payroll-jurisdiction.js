'use strict';
/**
 * verify-la23-payroll-jurisdiction.js — LA23 (Cowork live repro 2026-10-14; owner decision 2026-10-15: stop it + clear old rows).
 *
 * `payroll_runs.jurisdiction` is a DEAD column left by the removed multi-jurisdiction tax engine. Its schema default was
 * 'TT', nothing writes it (the INSERT omits it) and nothing reads it — so every payroll run, on any business in any
 * country, was labelled Trinidad & Tobago in its API responses (the "no home market" rule). No figure is affected.
 *
 * Real scratch Postgres, real server, real routes.
 *   LA23a (schema, scripts/migrations/2026-10-16-payroll-runs-jurisdiction-no-default.sql + database.js):
 *     fresh schema: the column has no default                                  bug: 'TT'::text
 *     a database still carrying the old default (live) loses it on migration     bug: 'TT'::text
 *     a run created through the real route carries no jurisdiction            bug: "TT"
 *   LA23b (data, scripts/migrations/2026-10-16-payroll-runs-jurisdiction-clear-tt.sql — separate commit, Rule 8):
 *     existing runs labelled 'TT' are cleared to NULL; a non-'TT' value is left exactly as it was
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la23-payroll-jurisdiction.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const MIG = path.join(__dirname, '..', '..', 'scripts', 'migrations');
const A_FILE = '2026-10-16-payroll-runs-jurisdiction-no-default.sql';
const B_FILE = '2026-10-16-payroll-runs-jurisdiction-clear-tt.sql';
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let scratch, server;
  console.log('\nLA23 — payroll runs no longer carry the dead jurisdiction "TT"\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const { runMigrations, pool } = require('../../database.js');
    await runMigrations(pool);   // as at production boot (idempotent)
    const dflt = async () => (await c.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'payroll_runs' AND column_name = 'jurisdiction'`)).rows[0].column_default;

    // ── LA23a ──
    eq('fresh schema: payroll_runs.jurisdiction has no default', await dflt(), null, "'TT'::text");

    // A database created before the fix (the live one) still has the default — the migration must remove it.
    await c.query(`ALTER TABLE payroll_runs ALTER COLUMN jurisdiction SET DEFAULT 'TT'`);
    await c.query(`DELETE FROM schema_migrations WHERE name = $1`, [A_FILE]);
    const r = await runMigrations(pool);
    eq('legacy database: the migration applies', r.applied.includes(A_FILE), true, false);
    eq('legacy database: the default is gone after the migration', await dflt(), null, "'TT'::text");

    const PW = 'harness-password-not-a-secret';
    await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: 'la23@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.123' });
    if ((await http.post('/api/auth/login', { email: 'la23@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (m, p, b) => { const x = await http.request(m, p, b); if (x.status >= 300) throw new Error(m + ' ' + p + ' ' + x.status + ' ' + x.text); return x.json; };
    const ent = await J('POST', '/api/entities', { name: 'Northwind US', currency: 'USD', timezone: 'America/New_York', country: 'US' });
    await J('POST', '/api/entities/' + ent.id + '/activate', {});
    await J('POST', '/api/payroll', { fname: 'Jordan', lname: 'Lee', gross: 3000, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
    const run = await J('POST', '/api/payroll-runs', { period: 'November 2026', idempotency_key: 'la23-nov' });
    eq('a new run on a US business carries no jurisdiction (response)', run.jurisdiction === undefined ? 'absent' : run.jurisdiction, null, 'TT');
    const stored = (await c.query(`SELECT jurisdiction FROM payroll_runs WHERE id = $1`, [run.id])).rows[0].jurisdiction;
    eq('a new run carries no jurisdiction (stored)', stored, null, 'TT');

    // ── LA23b ── (skipped until its migration file exists — it ships in its own commit)
    if (fs.existsSync(path.join(MIG, B_FILE))) {
      const mk = async (j, key) => (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, status, jurisdiction, idempotency_key) SELECT user_id, $1, 'Legacy ' || $3, 'draft', $2, $3 FROM payroll_runs WHERE id = $4 RETURNING id`, [ent.id, j, key, run.id])).rows[0].id;
      const tt1 = await mk('TT', 'la23-l1'), tt2 = await mk('TT', 'la23-l2'), jm = await mk('JM', 'la23-l3');
      await c.query(`DELETE FROM schema_migrations WHERE name = $1`, [B_FILE]);
      const rb = await runMigrations(pool);
      eq('LA23b: the clean-up migration applies', rb.applied.includes(B_FILE), true, false);
      const got = (await c.query(`SELECT id, jurisdiction FROM payroll_runs WHERE id = ANY($1::int[]) ORDER BY id`, [[tt1, tt2, jm]])).rows.map(x => x.jurisdiction);
      eq("LA23b: the two 'TT' runs are cleared; the 'JM' run is untouched", got, [null, null, 'JM'], ['TT', 'TT', 'JM']);
    } else console.log('  (LA23b clean-up migration not present yet — its checks run once it ships)');
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
