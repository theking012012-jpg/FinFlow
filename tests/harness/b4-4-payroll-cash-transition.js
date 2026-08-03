#!/usr/bin/env node
'use strict';
/**
 * b4-4-payroll-cash-transition.js — VERIFICATION check **B4.4**, executed for the first time.
 *
 *   node tests/harness/b4-4-payroll-cash-transition.js
 *
 * B4.4: "Mark Paid → Cash Flow **out** increases by Σ lines."
 *
 * WHY THIS IS ITS OWN PROBE AND NOT PART OF step3-gate.js
 *   A run created through the real route gets `run_date = NOW()` (server.js:3968) — the ONE
 *   money write in this codebase fed by the database clock (F110), and the node clock pin does
 *   not reach Postgres. So the run lands in the REAL current month, inside FY 2026, and would
 *   move the A5 (P&L opex, at `approved`) and A7.12-17 (cash out) figures step3 asserts as fixed
 *   constants. Folding this transition into step3 would contaminate every one of them. It is a
 *   TRANSITION check; the static seed cannot express it and the static gate must not carry it.
 *
 * WHY THE ASSERTIONS ARE DELTAS
 *   Nothing here asserts an absolute figure. Every assertion is `after − before` on the SAME
 *   endpoint in the SAME process, so the probe is immune to the calendar date it runs on, to the
 *   clock pin moving (F110), and to any future seed revision. The one absolute is Σ lines, which
 *   is derived from inputs this probe supplies, never from the endpoint under test (Rule 6 — the
 *   code must not grade its own homework).
 *
 * WHAT IT GUARDS — both controls EXECUTED, not reasoned (Rule 14), when this probe was written:
 *
 *   (a) F122 leg DELETED (server.js:3574 commented out) → 4 FAILED, 15 passed:
 *         exactly ONE month changed        got 0        want 1
 *         changed by exactly Σ lines       got undefined want 5888   (deltas seen: {})
 *         totalOutflow rose by Σ lines     got 0        want 5888
 *       So section 4 IS the F122 guard: remove the leg and it goes red.
 *
 *   (b) cash leg given the P&L's filter, `IN ('approved','paid')` (server.js:3548) → 6 FAILED:
 *         section 3  no month changed its cash out   got {"2026-08":5888}  want {}
 *         section 3  totalOutflow unchanged          got 5888             want 0
 *       plus section 4 red, because the cash had already moved at `approved`. The two sections
 *       therefore separate the two bugs rather than both firing on either.
 *
 *   server.js was restored with `git checkout -- server.js` after each control and re-verified
 *   green (19/19). Neither control is left in the tree.
 *
 * RULE 4 — the amount identifies its own source. Σ lines = 5,888, built as
 *     Emp One  gross 3,000 + bonus    777  = 3,777
 *     Emp Two  gross 2,000 + overtime 111  = 2,111
 *   Every plausible mis-read gives a DIFFERENT number: roster-only 5,000 · gross-only 5,000 ·
 *   dropped overtime 5,777 · dropped bonus 5,111 · net-pay-instead-of-gross ≠ 5,888 (deductions).
 *   5,888 collides with no seeded figure (900 / 1,100 / 3,300 / 4,200 / 5,000 / …), so a wrong
 *   delta cannot be mistaken for the right one.
 *
 * RULE 11 — the status vocabulary is `draft` / `approved` / `paid`, walked in that order through
 *   the real routes. `approved` must NOT move cash (that is accrual recognition, decision 2);
 *   only `paid` moves cash (decision 3). A leg that reused the P&L's `IN ('approved','paid')`
 *   filter goes red at section 3, not section 4 — the two sections separate the two bugs.
 *
 * Read-only against the app's own data: it creates ONE payroll run through the real route and
 * transitions it. Scratch Postgres only — enforced by guard.js, not by intention.
 */

const path = require('path');
const bcrypt = require('bcryptjs');
require('./clock.js');                       // network guard + pin/seed consistency assertion
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const ROOT = path.resolve(__dirname, '../..');
const FinFlowDates = require(path.join(ROOT, 'public/finflow-dates.js'));
const LOGIN = { email: 'seed-owner@example.test', password: 'harness-pw-1' };

// Inputs WE supply — the independent side of every expectation below.
const PERIOD = '2026-08';                    // distinct from every seeded period (04 / 06 / 07 x2)
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

/** month-key → {inflow, outflow} plus the endpoint's own totals. */
async function snapshot(http, label) {
  const r = await http.post('/api/reports/cash-flow', {});
  if (r.status !== 200) throw new Error(`cash-flow (${label}): HTTP ${r.status} ${r.text.slice(0, 200)}`);
  const map = {};
  for (const row of (r.json?.rows || [])) map[row.key] = { inflow: row.inflow, outflow: row.outflow, net: row.net };
  return { map, totalOutflow: r.json?.totalOutflow, totalInflow: r.json?.totalInflow };
}

/** Keys whose outflow differs, with the delta. Missing month ⇒ 0, so a NEW month row is a delta. */
function outflowDeltas(before, after) {
  const keys = new Set([...Object.keys(before.map), ...Object.keys(after.map)]);
  const out = {};
  for (const k of keys) {
    const d = Math.round((((after.map[k]?.outflow) || 0) - ((before.map[k]?.outflow) || 0)) * 100) / 100;
    if (d !== 0) out[k] = d;
  }
  return out;
}
function inflowDeltas(before, after) {
  const keys = new Set([...Object.keys(before.map), ...Object.keys(after.map)]);
  const out = {};
  for (const k of keys) {
    const d = Math.round((((after.map[k]?.inflow) || 0) - ((before.map[k]?.inflow) || 0)) * 100) / 100;
    if (d !== 0) out[k] = d;
  }
  return out;
}

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
    console.log('  B4.4 — MARK-PAID → CASH FLOW OUT (transition, real server + real Postgres)');
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

    const before = await snapshot(http, 'before create');

    // ── 1 · Create the run (draft) ──
    console.log('\n-- 1 - create a DRAFT run through the real route --');
    const created = await http.post(`/api/payroll-runs?entity_id=${entityId}`, {
      period: PERIOD,
      bonus_overrides:    { [one.id]: BONUS_ONE },
      overtime_overrides: { [two.id]: OVERTIME_TWO },
      notes: 'B4.4 transition probe',
    });
    A('POST /api/payroll-runs → 201', created.status, 201, `body: ${created.text.slice(0, 200)}`);
    const runId = created.json?.id;
    A('run id returned', typeof runId === 'number' && runId > 0, true, `id: ${JSON.stringify(runId)}`);
    A('run status is draft', created.json?.status, 'draft');
    const sumLines = Math.round((created.json?.lines || []).reduce(
      (s, l) => s + (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0), 0) * 100) / 100;
    A('Σ lines (gross+bonus+overtime) == independently derived expectation',
      sumLines, EXPECTED_SUM_LINES,
      'roster-only would give 5000 · dropped overtime 5777 · dropped bonus 5111');

    const runYmd = FinFlowDates._toYmd(created.json?.run_date);
    const runKey = runYmd ? runYmd.slice(0, 7) : null;
    console.log(`     run_date ${JSON.stringify(created.json?.run_date)} → month key ${runKey}`);

    // ── 2 · draft is not cash (and not accrual either — decision 2) ──
    console.log('\n-- 2 - DRAFT: cash out unchanged --');
    const afterCreate = await snapshot(http, 'after create');
    A('no month changed its cash out', outflowDeltas(before, afterCreate), {});
    A('totalOutflow unchanged', afterCreate.totalOutflow - before.totalOutflow, 0);

    // ── 3 · approved is ACCRUAL recognition, NOT cash (decision 2 vs decision 3) ──
    // This is the section that catches a cash leg wrongly reusing the P&L's
    // `status IN ('approved','paid')` filter — it would book cash for an unpaid run.
    console.log('\n-- 3 - APPROVED: still not cash (the wrong-filter trap) --');
    const approved = await http.put(`/api/payroll-runs/${runId}/approve`);
    A('PUT …/approve → 200', approved.status, 200, `body: ${approved.text.slice(0, 200)}`);
    A('run status is approved', approved.json?.status, 'approved');
    const afterApprove = await snapshot(http, 'after approve');
    A('no month changed its cash out', outflowDeltas(afterCreate, afterApprove), {},
      `a leg filtering IN ('approved','paid') would show +${EXPECTED_SUM_LINES} here`);
    A('totalOutflow unchanged', afterApprove.totalOutflow - afterCreate.totalOutflow, 0);

    // ── 4 · mark-paid IS cash. THE B4.4 assertion, and the F122 leg's guard. ──
    console.log('\n-- 4 - MARK-PAID: cash out rises by exactly Σ lines (B4.4) --');
    const paid = await http.put(`/api/payroll-runs/${runId}/mark-paid`);
    A('PUT …/mark-paid → 200', paid.status, 200, `body: ${paid.text.slice(0, 200)}`);
    A('run status is paid', paid.json?.status, 'paid');
    const afterPaid = await snapshot(http, 'after mark-paid');
    const deltas = outflowDeltas(afterApprove, afterPaid);
    A('exactly ONE month changed', Object.keys(deltas).length, 1,
      `remove the F122 payroll leg (server.js:3542-3552,3574) and this reads 0`);
    A('…and it changed by exactly Σ lines', deltas[runKey], EXPECTED_SUM_LINES,
      `deltas seen: ${JSON.stringify(deltas)}`);
    A('totalOutflow rose by exactly Σ lines',
      Math.round((afterPaid.totalOutflow - afterApprove.totalOutflow) * 100) / 100, EXPECTED_SUM_LINES);
    A('cash IN untouched by a payroll transition', inflowDeltas(afterApprove, afterPaid), {});

    // The month the cash lands in is `run_date`, not the run's own `period`. Asserted rather than
    // assumed, because it is the F122 KNOWN APPROXIMATION (no paid_date column exists — F85 class):
    // a run created in one month and paid in the next books its cash in the CREATION month. If a
    // `paid_date` is ever added, this assertion is the one that must be revisited.
    console.log('\n-- 5 - the cash lands on run_date (F122 known approximation, F85 class) --');
    A('changed month key == run_date month', Object.keys(deltas)[0], runKey);

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
  console.error('\n[b4.4] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
