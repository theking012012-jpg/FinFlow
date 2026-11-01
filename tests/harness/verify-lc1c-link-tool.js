#!/usr/bin/env node
'use strict';
/**
 * verify-lc1c-link-tool — LC1c (owner decision 2026-11-01: link the old time entries). Executes the PREPARED owner-run
 * data fix tools/fix-2026-10-19/fix1-link-exact-matches.js against a scratch Postgres with the real schema (Rule 3 /
 * Rule 14 — it had never been run). Never production.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc1c-link-tool.js
 *
 * Seed (Rule 4 — each entry tests one branch of the rule):
 *   e1 "Website Build"  → exactly one same-business project "website build " → LINKED
 *   e2 "Shared"         → two projects named "Shared" in its business       → not linked (ambiguous)
 *   e3 "Nothing"        → no project of that name                            → not linked
 *   e4 "Website Build"  → in ANOTHER business (whose only project is "Other") → not linked (never across businesses)
 *   e5 already linked (project_id set)                                       → untouched
 */
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const eq = (n, g, w) => A(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`);
const TOOL = require('path').join(__dirname, '../../tools/fix-2026-10-19/fix1-link-exact-matches.js');

async function main() {
  const s = await startScratchPostgres({ keep: false });
  const c = s.client;
  const { pool } = await initSchema(s.url);
  try {
    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email: 'lc1c@finflow.test', password: bcrypt.hashSync('x', 4) }])).rows[0].id;
    const ent = async n => (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: n, currency: 'USD' }])).rows[0].id;
    const b1 = await ent('B1'), b2 = await ent('B2');
    const proj = async (eid, name) => (await c.query(`INSERT INTO projects (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`, [uid, eid, { name }])).rows[0].id;
    const pWeb = await proj(b1, 'website build '); await proj(b1, 'Shared'); await proj(b1, 'Shared'); await proj(b2, 'Other');
    const te = async (eid, data) => (await c.query(`INSERT INTO timesheet (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`, [uid, eid, Object.assign({ hours: 2, employee: 'Sam', date: '2026-07-01' }, data)])).rows[0].id;
    const e1 = await te(b1, { project: 'Website Build' }), e2 = await te(b1, { project: 'Shared' }), e3 = await te(b1, { project: 'Nothing' });
    const e4 = await te(b2, { project: 'Website Build' }), e5 = await te(b1, { project: 'Website Build', project_id: 999 });
    const run = (...args) => { try { return { code: 0, out: execFileSync('node', [TOOL, ...args], { env: { ...process.env, DATABASE_URL: s.url }, stdio: ['ignore', 'pipe', 'pipe'] }).toString() }; } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
    const pids = async () => (await c.query(`SELECT id, data->>'project_id' AS p FROM timesheet ORDER BY id`)).rows.map(r => [r.id, r.p]);
    const hash = async () => (await c.query(`SELECT md5(string_agg(data::text, ',' ORDER BY id)) h FROM timesheet`)).rows[0].h;

    const h0 = await hash();
    const dry = run();
    A('dry run: WOULD LINK 1', /WOULD LINK: 1\b/.test(dry.out), dry.out.slice(-300));
    eq('dry run changes nothing', await hash(), h0);
    const wrong = run('--apply', '--expect', '3');
    A('apply with the wrong --expect is refused, nothing changed', wrong.code === 3 && /REFUSED/.test(wrong.out) && (await hash()) === h0, wrong.out.slice(-200));
    const none = run('--apply');
    A('apply without --expect is refused', none.code === 2 && (await hash()) === h0, none.out.slice(-200));
    const ok = run('--apply', '--expect', '1');
    A('apply --expect 1: linked 1', ok.code === 0 && /APPLIED: linked 1 time entry/.test(ok.out), ok.out.slice(-200));
    eq('only e1 linked (to "website build"); e2 ambiguous, e3 no match, e4 other business, e5 untouched',
      await pids(), [[e1, String(pWeb)], [e2, null], [e3, null], [e4, null], [e5, '999']]);
    eq('e1 keeps its label', (await c.query(`SELECT data->>'project' p FROM timesheet WHERE id = $1`, [e1])).rows[0].p, 'Website Build');
    const au = (await c.query(`SELECT entity_id, action, actor_type, new_data->>'project_id' AS p FROM audit_trail WHERE table_name = 'timesheet' AND record_id = $1`, [e1])).rows;
    eq('one audit row on e1\'s own business (UPDATE, system)', au.map(r => [r.entity_id, r.action, r.actor_type, r.p]), [[b1, 'UPDATE', 'system', String(pWeb)]]);
    const again = run();
    A('re-run: WOULD LINK 0', /WOULD LINK: 0\b/.test(again.out), again.out.slice(-200));
  } finally {
    try { await pool.end(); } catch (_) {}
    await s.stop();
  }
  console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (LC1c link tool)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('[lc1c] PROBE ERROR — ' + (e && e.stack)); process.exit(1); });
