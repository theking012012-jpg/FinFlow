#!/usr/bin/env node
'use strict';
/**
 * verify-import-size.js — N39. A CSV / bank-statement file up to the advertised ~5 MB reaches the import
 * routes; only a file over that is refused, with the routes' own message.
 *
 * Defect: /api/import/csv and /api/banking/import check content.length ≤ 5,000,000 themselves, but were not in
 * LARGE_PAYLOAD_PATHS, so the global 500 KB JSON cap answered 413 to any file over ~0.5 MB.
 *
 * Executed: real server + Postgres. A ~1.2 MB expense CSV (≈ 20,000 rows) as a DRY RUN, and a ~1.2 MB bank CSV.
 *   /api/import/csv dry run 1.2 MB → 200, rows parsed      (bug: 413)
 *   /api/banking/import 1.2 MB      → not 413              (bug: 413)
 *   6 MB CSV                        → 400 "File too large" (the route's own limit)
 *   node -r ./tests/harness/clock.js tests/harness/verify-import-size.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'import-size-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'is@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'IS Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.39.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'is@finflow.test', password: PW })).status === 200);
    let csv = 'date,description,amount,category\n';
    for (let i = 0; csv.length < 1_200_000; i++) csv += `2026-0${1 + (i % 6)}-1${i % 9},Office supplies purchase number ${i},${(i % 97) + 1}.25,Office\n`;
    const rows = csv.trim().split('\n').length - 1;
    const r1 = await h.post(`/api/import/csv?entity_id=${eA}`, { type: 'expenses', content: csv, dryRun: true });
    A(`CSV import dry run, ${(csv.length / 1e6).toFixed(2)} MB → 200 (bug: 413)`, r1.status === 200, `status ${r1.status} ${r1.text.slice(0, 100)}`);
    A(`  all ${rows} rows parsed`, r1.json && (Number(r1.json.added) + Number(r1.json.skipped || 0) + Number(r1.json.duplicates || 0)) >= rows - 1, JSON.stringify(r1.json && { added: r1.json.added, skipped: r1.json.skipped, duplicates: r1.json.duplicates }));
    const r2 = await h.post(`/api/banking/import?entity_id=${eA}`, { format: 'csv', content: csv });
    A('bank statement import, 1.2 MB → reaches the route (bug: 413)', r2.status !== 413, `status ${r2.status} ${r2.text.slice(0, 100)}`);
    const big = csv.repeat(5);
    const r3 = await h.post(`/api/import/csv?entity_id=${eA}`, { type: 'expenses', content: big, dryRun: true });
    A(`${(big.length / 1e6).toFixed(1)} MB CSV → 400 "File too large" (the route's own limit)`, r3.status === 400 && /too large/i.test(r3.text), `status ${r3.status} ${r3.text.slice(0, 80)}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (import size)` : `  ALL GREEN — ${pass} passed, 0 failed  (import size)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
