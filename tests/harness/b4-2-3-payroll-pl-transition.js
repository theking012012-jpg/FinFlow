#!/usr/bin/env node
'use strict';
/**
 * b4-2-3-payroll-pl-transition.js — VERIFICATION checks **B4.2, B4.3 and B1.4**, executed as
 * DELTAS so they are immune to the NOW() clock drift that marks them BLOCKED in the static gates
 * (F110). The P&L twin of b4-4-payroll-cash-transition.js (which does the CASH side, B4.4).
 *
 *   node -r ./tests/harness/clock.js tests/harness/b4-2-3-payroll-pl-transition.js
 *
 * WHAT IT ASSERTS (all against `expenses` = P&L opex from GET /api/reports)
 *   B4.1  draft run              → opex UNCHANGED (draft contributes 0 — decision 2)
 *   B4.2  approve                → opex rises by EXACTLY Σ lines (recognition begins at approved)
 *   B1.4  approve AGAIN (double) → opex UNCHANGED (expense counted ONCE — the double-submit guard)
 *   B4.3  mark paid              → opex UNCHANGED (paid adds nothing; the decision-2 trap — the
 *                                  expense must NOT disappear, and must NOT be added a second time)
 *
 * WHY THIS IS ITS OWN PROBE AND NOT IN step2/step3-gate.js (F110)
 *   A run created through the real route is stamped by the database clock, and the node pin does
 *   not reach Postgres. Folding an app-created run into a gate that asserts July opex = 1,850 as a
 *   fixed constant would contaminate it. drift.js therefore marks B1.4/B4.2/B4.3 BLOCKED in the
 *   static gates. This probe removes that block the same way B4.4 did: every assertion is
 *   `after − before` on the SAME endpoint in the SAME process, so it is immune to the calendar
 *   date it runs on, to the clock pin moving, and to any future seed revision. The one absolute is
 *   Σ lines, derived from inputs THIS probe supplies — never read back from the endpoint under test
 *   (Rule 6, the code must not grade its own homework).
 *
 * RULE 4 — the amount identifies its own source. Σ lines = 5,888:
 *     Emp One gross 3,000 + bonus    777 = 3,777
 *     Emp Two gross 2,000 + overtime 111 = 2,111
 *   Every plausible mis-read gives a DIFFERENT number: roster-only 5,000 · gross-only 5,000 ·
 *   dropped overtime 5,777 · dropped bonus 5,111. 5,888 collides with no seeded figure, so a wrong
 *   delta cannot pass for the right one.
 *
 * RULE 11 / decision 2 — status vocabulary draft/approved/paid, walked in order through the real
 *   routes. Recognition BEGINS at approved and paid adds NOTHING further. The critical trap: a leg
 *   filtering `status = 'approved'` (not `IN ('approved','paid')`) would make the expense DISAPPEAR
 *   at mark-paid — section B4.3 (delta 0, not −Σ lines) is what catches it.
 *
 * RULE 14 — failure paths to reproduce when maintaining this probe (mirror b4-4's discipline):
 *   · make approve filter `status = 'approved'` only → B4.3 goes red (mark-paid shows −5,888).
 *   · make computeBooks count draft runs           → B4.1 goes red (draft shows +Σ its lines).
 *   · make approve non-idempotent (re-add lines)    → B1.4 goes red (2nd approve shows +5,888).
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const path = require('path');
const bcrypt = require('bcryptjs');
require('./clock.js');                       // network guard + pin/seed consistency assertion
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'seed-owner@example.test', password: 'harness-pw-1' };

// Inputs WE supply — the independent side of every expectation below.
// PERIOD must be recognised (≤ pinned today, 2026-07-25) — the P&L expense leg dates payroll on the
// run's `period` (server.js:3874), and a FUTURE period contributes 0 under D2. The pinned month is the
// safe choice; it collides with seeded runs R2/R3, but every assertion here is a DELTA on this one run,
// so seeded July activity is in the baseline and cancels out. (Contrast b4-4, whose CASH leg dates on
// run_date = NOW() and so uses a future period freely.)
const PERIOD = '2026-07';
const BONUS_ONE = 777;
const OVERTIME_TWO = 111;
const ROSTER_GROSS = { 'Emp One': 3000, 'Emp Two': 2000 };   // tests/harness/seedData.js ROSTER
const EXPECTED_SUM_LINES = ROSTER_GROSS['Emp One'] + BONUS_ONE + ROSTER_GROSS['Emp Two'] + OVERTIME_TWO; // 5888

let pass = 0, fail = 0;
const A = (name, got, want, bugWould) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else {
    fail++;
    console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) +
      '\n          want ' + JSON.stringify(want) +
      (bugWould ? '\n          (' + bugWould + ')' : ''));
  }
};

/** P&L opex (expenses) from the paramless GET /api/reports (legacy all-time year). */
async function opex(http, label) {
  const r = await http.get('/api/reports');
  if (r.status !== 200) throw new Error(`/api/reports (${label}): HTTP ${r.status} ${r.text.slice(0, 200)}`);
  const v = r.json?.expenses;
  if (typeof v !== 'number') throw new Error(`/api/reports (${label}): expenses not numeric → ${JSON.stringify(v)}`);
  return v;
}
const d2 = n => Math.round(n * 100) / 100;

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;

  try {
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Seed Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const { entityId } = await seed(c, userId);

    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    if (login.status !== 200) throw new Error(`login failed: HTTP ${login.status} ${login.text.slice(0, 200)}`);

    console.log('\n' + '='.repeat(78));
    console.log('  B4.2 / B4.3 / B1.4 — PAYROLL P&L TRANSITION (deltas, real server + real Postgres)');
    console.log('='.repeat(78));

    // ── Roster ids, so the overrides land on the employees we think they do ──
    const roster = await http.get('/api/payroll');
    if (roster.status !== 200) throw new Error(`GET /api/payroll: HTTP ${roster.status}`);
    const byName = {};
    for (const e of (roster.json || [])) byName[`${e.fname} ${e.lname}`.trim()] = e;
    const one = byName['Emp One'], two = byName['Emp Two'];
    if (!one || !two) throw new Error(`roster not as seeded: ${Object.keys(byName).join(', ')}`);

    console.log('\n-- 0 - seed fidelity: the roster this run will be built from --');
    A('Emp One gross', parseFloat(one.gross), ROSTER_GROSS['Emp One']);
    A('Emp Two gross', parseFloat(two.gross), ROSTER_GROSS['Emp Two']);

    const base = await opex(http, 'before create');

    // ── 1 · Create the run (draft) ──
    console.log('\n-- 1 - create a DRAFT run through the real route --');
    const created = await http.post(`/api/payroll-runs?entity_id=${entityId}`, {
      period: PERIOD,
      bonus_overrides:    { [one.id]: BONUS_ONE },
      overtime_overrides: { [two.id]: OVERTIME_TWO },
      notes: 'B4.2/B4.3/B1.4 P&L transition probe',
    });
    A('POST /api/payroll-runs → 201', created.status, 201, `body: ${created.text.slice(0, 200)}`);
    const runId = created.json?.id;
    A('run id returned', typeof runId === 'number' && runId > 0, true, `id: ${JSON.stringify(runId)}`);
    A('run status is draft', created.json?.status, 'draft');
    const sumLines = d2((created.json?.lines || []).reduce(
      (s, l) => s + (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0), 0));
    A('Σ lines (gross+bonus+overtime) == independently derived expectation',
      sumLines, EXPECTED_SUM_LINES,
      'roster-only would give 5000 · dropped overtime 5777 · dropped bonus 5111');

    // ── 2 · B4.1 — draft is NOT expense (decision 2) ──
    console.log('\n-- 2 - DRAFT: opex unchanged (B4.1, decision 2) --');
    const afterCreate = await opex(http, 'after create');
    A('B4.1  opex delta on draft == 0', d2(afterCreate - base), 0,
      `a leg counting draft runs would show +${EXPECTED_SUM_LINES}`);

    // ── 3 · B4.2 — approve recognises EXACTLY Σ lines ──
    console.log('\n-- 3 - APPROVE: opex rises by exactly Σ lines (B4.2) --');
    const approved = await http.put(`/api/payroll-runs/${runId}/approve`);
    A('PUT …/approve → 200', approved.status, 200, `body: ${approved.text.slice(0, 200)}`);
    A('run status is approved', approved.json?.status, 'approved');
    const afterApprove = await opex(http, 'after approve');
    A('B4.2  opex delta on approve == Σ lines', d2(afterApprove - afterCreate), EXPECTED_SUM_LINES,
      `deltas: base=${base} draft=${afterCreate} approved=${afterApprove}`);

    // ── 4 · B1.4 — approve AGAIN must not double-count ──
    console.log('\n-- 4 - APPROVE AGAIN: opex unchanged (B1.4, counted once) --');
    const approved2 = await http.put(`/api/payroll-runs/${runId}/approve`);
    A('PUT …/approve (2nd) → 200 or 4xx (idempotent, not a new expense)',
      approved2.status === 200 || (approved2.status >= 400 && approved2.status < 500), true,
      `status ${approved2.status}: ${approved2.text.slice(0, 160)}`);
    const afterApprove2 = await opex(http, 'after 2nd approve');
    A('B1.4  opex delta on 2nd approve == 0 (expense counted once)',
      d2(afterApprove2 - afterApprove), 0,
      `a non-idempotent approve would show +${EXPECTED_SUM_LINES}`);

    // ── 5 · B4.3 — mark paid must NOT change the expense (the decision-2 trap) ──
    console.log('\n-- 5 - MARK-PAID: opex UNCHANGED (B4.3, the decision-2 trap) --');
    const paid = await http.put(`/api/payroll-runs/${runId}/mark-paid`);
    A('PUT …/mark-paid → 200', paid.status, 200, `body: ${paid.text.slice(0, 200)}`);
    A('run status is paid', paid.json?.status, 'paid');
    const afterPaid = await opex(http, 'after mark-paid');
    A('B4.3  opex delta on mark-paid == 0 (must not disappear, must not re-add)',
      d2(afterPaid - afterApprove2), 0,
      `a leg filtering status='approved' only would show −${EXPECTED_SUM_LINES} here`);

    console.log('\n-- 6 - net effect: opex is up by exactly one Σ lines across the whole lifecycle --');
    A('net opex delta base→paid == Σ lines (recognised once, and only once)',
      d2(afterPaid - base), EXPECTED_SUM_LINES);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    try { if (appPool && appPool.end && !appPool.ended) await appPool.end(); } catch (_) { /* already closed */ }
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[b4.2-3] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
