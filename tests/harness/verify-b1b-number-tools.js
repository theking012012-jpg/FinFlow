'use strict';
/**
 * verify-b1b-number-tools.js — B1b data step (Rule 8). The read-only lister (tools/launch/list-invoice-numbers.js) and
 * the owner-run numbering tool (tools/launch/number-existing-invoices.js) run as child processes against a real scratch
 * Postgres, exactly as the owner runs them; plus the GUARDED migration against a database that holds a duplicate.
 *
 * Seed (invoices from before numbering — no number):
 *   A (prefix INV-, counter 0): a1 issued 2026-03-01, a2 2026-01-15, a3 2026-02-10, and a4 already "INV-0002" (imported)
 *   B (prefix IT-, counter 7 — seven numbers already issued): b1
 *   C: two invoices both numbered "X-1" (a CSV duplicate), so the unique index cannot exist
 * EXPECTED (by hand): oldest first, skipping the taken INV-0002 → a2 INV-0001, a3 INV-0003, a1 INV-0004 (A counter → 4);
 * b1 IT-0008 (B counter → 8); C untouched. A naive "renumber from 1 by id" would give a1 INV-0001 and reuse INV-0002.
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

const ROOT = path.join(__dirname, '..', '..');
const LIST = path.join(ROOT, 'tools', 'launch', 'list-invoice-numbers.js');
const NUM = path.join(ROOT, 'tools', 'launch', 'number-existing-invoices.js');
const MIG = path.join(ROOT, 'scripts', 'migrations', '2026-10-23-invoice-numbers.sql');
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let scratch, server;
  console.log('\nB1b — invoice-number lister + owner-run numbering tool + guarded migration\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);   // initDB: the real schema
    await server.close(); server = null;
    await c.query(`DROP INDEX IF EXISTS idx_invoices_number`);   // a database from before B1b
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,'{"email":"b1btools@finflow.test"}',NOW(),NOW()) RETURNING id`)).rows[0].id;
    const ent = async d => (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, d])).rows[0].id;
    const eA = await ent({ name: 'A Co', currency: 'USD' }), eB = await ent({ name: 'B Co', currency: 'USD', invoice_prefix: 'IT-', invoice_seq: 7 }), eC = await ent({ name: 'C Co', currency: 'USD' });
    const inv = async (eid, d) => (await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`, [uid, eid, Object.assign({ client: 'X', amount: 100, status: 'pending' }, d)])).rows[0].id;
    const a1 = await inv(eA, { client: 'a1', issue_date: '2026-03-01' }), a2 = await inv(eA, { client: 'a2', issue_date: '2026-01-15' }), a3 = await inv(eA, { client: 'a3', issue_date: '2026-02-10' });
    await inv(eA, { client: 'a4', issue_date: '2026-01-20', number: 'INV-0002' });
    const b1 = await inv(eB, { client: 'b1', issue_date: '2026-04-01' });
    const c1 = await inv(eC, { client: 'c1', number: 'X-1' }), c2 = await inv(eC, { client: 'c2', number: 'X-1' });
    const fp = async () => (await c.query(`SELECT md5(string_agg(id || ':' || data::text, '|' ORDER BY id)) AS h FROM (SELECT id, data FROM invoices UNION ALL SELECT -id, data FROM entities) x`)).rows[0].h
      + '/' + (await c.query(`SELECT count(*)::int AS n FROM audit_trail`)).rows[0].n;
    const run = (script, args) => spawnSync(process.execPath, [script, ...(args || [])], { env: Object.assign({}, process.env, { DATABASE_URL: scratch.url }), encoding: 'utf8', timeout: 60000 });
    const f0 = await fp();

    let migErr = null;
    try { await c.query(fs.readFileSync(MIG, 'utf8')); } catch (e) { migErr = e.message; }
    const idx = (await c.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='idx_invoices_number'`)).rows[0].n;
    eq('0  the migration on a database WITH a duplicate: no error, index not built (a plain CREATE would fail the deploy)', [migErr, idx], [null, 0]);

    const L = run(LIST);
    eq('1  lister exits 0', L.status, 0, L.stderr.slice(0, 200));
    eq('1b …reports 4 without a number and 1 duplicate (X-1), index NOT BUILT', [/Invoices without a number: 4/.test(L.stdout), /Duplicate numbers: 1/.test(L.stdout), /NOT BUILT/.test(L.stdout)], [true, true, true], L.stdout.slice(-400));
    eq('1c …and changed nothing', await fp(), f0);

    const D = run(NUM);
    eq('2  dry run: WOULD NUMBER 4, changes nothing', [D.status, /WOULD NUMBER: 4/.test(D.stdout), await fp() === f0], [0, true, true], D.stdout.slice(-300));
    const R1 = run(NUM, ['--apply']);
    eq('3  --apply without --expect → refused, nothing changed', [R1.status, await fp() === f0], [2, true]);
    const R2 = run(NUM, ['--apply', '--expect', '3']);
    eq('4  --apply --expect 3 (data says 4) → refused, nothing changed', [R2.status, await fp() === f0], [3, true]);
    const R3 = run(NUM, ['--apply', '--expect', '4']);
    eq('5  --apply --expect 4 → applied', [R3.status, /APPLIED: numbered 4/.test(R3.stdout)], [0, true], R3.stderr.slice(0, 300));
    const n = async id => (await c.query(`SELECT data->>'number' AS n FROM invoices WHERE id=$1`, [id])).rows[0].n;
    eq('5b oldest first, skipping the taken INV-0002: a2 INV-0001, a3 INV-0003, a1 INV-0004', [await n(a2), await n(a3), await n(a1)], ['INV-0001', 'INV-0003', 'INV-0004'], ['INV-0002', 'INV-0003', 'INV-0001']);
    eq('5c B continues its own sequence and prefix: b1 IT-0008', await n(b1), 'IT-0008', 'INV-0001');
    const seq = async e => (await c.query(`SELECT (data->>'invoice_seq')::int AS s FROM entities WHERE id=$1`, [e])).rows[0].s;
    eq('5d the counters moved on (A 4, B 8) so the next new invoice cannot repeat a number', [await seq(eA), await seq(eB)], [4, 8]);
    eq('5e duplicates are NOT touched (owner\'s decision): C still X-1, X-1', [await n(c1), await n(c2)], ['X-1', 'X-1']);
    eq('5f one audit row per numbered invoice (actor system)', (await c.query(`SELECT count(*)::int AS n FROM audit_trail WHERE table_name='invoices' AND field_name='number' AND actor_type='system'`)).rows[0].n, 4);
    const D2 = run(NUM);
    eq('6  a second dry run → WOULD NUMBER 0 (idempotent)', /WOULD NUMBER: 0/.test(D2.stdout), true, D2.stdout.slice(-200));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (server) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (B1b number tools)\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
