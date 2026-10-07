#!/usr/bin/env node
'use strict';
/**
 * verify-roster-entity.js — N13 / N13b / N13c. Every roster employee belongs to one business, and a
 * payroll run pays each employee once — never once per business.
 *
 * Defects: POST /api/payroll took entity_id from the body only (the client sends null when its entity
 * list has not loaded), creating entity-less roster rows; the payroll run included every entity-less
 * row in EVERY entity's run, so such an employee was paid and expensed once per business.
 *
 * Executed against the real server + Postgres. Account with entities A and B; legacy entity-less roster
 * row "Legacy Lee" (4000) plus A's own "Ana" (3000). Bug value stated:
 *   POST /api/payroll with entity_id null (active entity A) → row stamped A        (bug: entity null)
 *   POST with another account's entity id → refused (control — already refused by the entity middleware)
 *   July run for A → lines [Ana, Nina] only, unassigned_employees 1               (bug: + Legacy Lee)
 *   July run for B → no Legacy Lee                                                (bug: Legacy Lee again)
 *   total payroll expense across A + B = 3000 + 2500 (hand-computed)              (bug: + 4000 × 2)
 *   control: single-entity account → the entity-less row is still paid (unambiguous)
 *   node -r ./tests/harness/clock.js tests/harness/verify-roster-entity.js
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
    const PW = 'roster-ent-pw-1';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const U = await mk('re-u@finflow.test'), S = await mk('re-s@finflow.test'), X = await mk('re-x@finflow.test');
    const ent = async (u, n, a) => (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [u, { name: n, currency: 'USD', is_active: a }])).rows[0].id;
    const eA = await ent(U, 'A Co', 1), eB = await ent(U, 'B Co', 0), eS = await ent(S, 'Solo Co', 1), eX = await ent(X, 'X Co', 1);
    await c.query(`INSERT INTO payroll (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [U, { fname: 'Legacy', lname: 'Lee', gross: 4000, deductions: [] }]);
    await c.query(`INSERT INTO payroll (user_id,entity_id,data) VALUES ($1,$2,$3)`, [U, eA, { fname: 'Ana', lname: 'A', gross: 3000, deductions: [] }]);
    await c.query(`INSERT INTO payroll (user_id,entity_id,data) VALUES ($1,$2,$3)`, [U, eB, { fname: 'Bo', lname: 'B', gross: 2500, deductions: [] }]);
    await c.query(`INSERT INTO payroll (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [S, { fname: 'Solo', lname: 'Sam', gross: 1500, deductions: [] }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.13.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 're-u@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  ROSTER ROWS BELONG TO A BUSINESS; EACH EMPLOYEE PAID ONCE');
    console.log('='.repeat(78));
    const cr = await h.post('/api/payroll', { fname: 'Nina', lname: 'N', gross: 0.01, entity_id: null });
    const nina = (await c.query(`SELECT entity_id FROM payroll WHERE data->>'fname'='Nina'`)).rows[0];
    A('roster create with entity_id null → stamped with active entity A (bug: null)', cr.status === 201 && nina && nina.entity_id === eA, `status ${cr.status} entity=${nina && nina.entity_id}`);
    const _ev = await h.post('/api/payroll', { fname: 'Evil', gross: 1, entity_id: eX });
    A('control: roster create with another account\'s entity → refused 4xx, no row (the entity middleware already refused it before this fix)', _ev.status >= 400 && _ev.status < 500 && (await c.query(`SELECT 1 FROM payroll WHERE data->>'fname'='Evil'`)).rowCount === 0, 'status ' + _ev.status + ' ' + _ev.text.slice(0, 100));
    await c.query(`UPDATE payroll SET data = data || '{"gross":0}' WHERE data->>'fname'='Nina'`);   // keep the totals about the legacy row

    const runA = await h.post('/api/payroll-runs?entity_id=' + eA, { period: '2026-07', idempotency_key: 're-a' });
    const namesA = (runA.json && runA.json.lines || []).map(l => l.employee_name).sort();
    A('A\'s July run excludes the entity-less row (bug: includes Legacy Lee)', runA.status === 201 && !namesA.some(n => /Legacy/.test(n)), JSON.stringify(namesA));
    A('  and reports it as unassigned (1)', runA.json && runA.json.unassigned_employees === 1, JSON.stringify(runA.json && runA.json.unassigned_employees));
    const runB = await h.post('/api/payroll-runs?entity_id=' + eB, { period: '2026-07', idempotency_key: 're-b' });
    const namesB = (runB.json && runB.json.lines || []).map(l => l.employee_name);
    A('B\'s July run excludes it too (bug: Legacy Lee paid again)', runB.status === 201 && !namesB.some(n => /Legacy/.test(n)), JSON.stringify(namesB));
    const tot = Number((await c.query(`SELECT COALESCE(SUM(l.gross+l.bonus+l.overtime),0) s FROM payroll_run_lines l JOIN payroll_runs r ON r.id=l.run_id WHERE r.user_id=$1`, [U])).rows[0].s);
    A('total payroll across A + B = 5500 hand-computed (bug: 13500)', tot === 5500, 'total=' + tot);

    const hs = new HarnessHttp(server.baseUrl, { xff: '10.13.0.2' });
    await hs.post('/api/auth/login', { email: 're-s@finflow.test', password: PW });
    const rs = await hs.post('/api/payroll-runs', { period: '2026-07', idempotency_key: 're-s' });
    A('control: single-entity account still pays its entity-less row', rs.status === 201 && (rs.json.lines || []).some(l => /Solo/.test(l.employee_name)), JSON.stringify(rs.json && rs.json.lines));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (roster entity)` : `  ALL GREEN — ${pass} passed, 0 failed  (roster entity)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
