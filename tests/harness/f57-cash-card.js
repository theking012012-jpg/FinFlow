#!/usr/bin/env node
'use strict';
/**
 * f57-cash-card.js — the dashboard cash-flow card, decision D3 (genuine cash basis).
 *
 * WHAT THIS PROVES. The card's In/Out/Net now come from POST /api/reports/cash-flow summed by
 * `cashForPeriod`. This probe takes the REAL rows from the REAL endpoint against the REAL seeded
 * database, feeds them to the REAL `cashForPeriod` extracted from app-main.js, and asserts the
 * three period totals. So it tests the integration, not a hand-rebuilt copy of the seed — a
 * reconstruction would be a second implementation of the server written by the person trying to
 * prove the client right (Rule 3's reasoning, applied to a fixture).
 *
 * Runtime winner (Rule 1): `updateCashflow` is defined once (app-main.js) and no wiring file
 * assigns `window.updateCashflow`, so the app-main copy is what executes.
 *
 * ⚠️ DISCRIMINATION WARNING — READ BEFORE ADDING PERIODS.
 * FY cash net (−1,700) is now NUMERICALLY IDENTICAL to FY accrual netProfit (−1,700). That
 * collision did not exist before F58 (accrual FY netProfit was −800); the credit-note contra
 * moved it onto the cash figure. So THE FY NET CANNOT DISCRIMINATE cash basis from accrual —
 * a card wired to the old accrual source still reads −1,700 there and looks correct.
 * June is the discriminating period: cash net −250 vs accrual netProfit −1,850.
 * Every failure-path assertion below is therefore anchored on JUNE, never on FY net.
 *
 * Read-only: SELECTs and one read-only POST (the endpoint is in server.js's READ_ONLY_POST set).
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const clock = require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');
const EXPECTED = require('./expected.js');

const ROOT = path.resolve(__dirname, '../..');
const LOGIN = { email: 'seed-owner@example.test', password: 'harness-pw-1' };

let pass = 0, fail = 0;
const A = (name, got, want, bugWould) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else {
    fail++;
    console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) +
      '\n          want ' + JSON.stringify(want) +
      (bugWould ? '\n          (accrual source would give ' + JSON.stringify(bugWould) + ')' : ''));
  }
};

/**
 * Load the REAL cashForPeriod + _periodWindow from app-main.js.
 * Contiguous verbatim spans, not a per-function slicer (Rule 5 corollary: source slicing has
 * failed four times). Each span is located by its own opening line and closed by brace-counting.
 */
function loadClientCash() {
  const src = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
  const span = (openLine) => {
    const at = src.indexOf(openLine);
    if (at < 0) throw new Error(`[f57] span not found: ${openLine} — probe is stale, fix the probe.`);
    let i = src.indexOf('{', at + openLine.length - 1), depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
    }
    throw new Error(`[f57] unbalanced braces for ${openLine}`);
  };
  const parts = [span('function _fyContext()'), span('function _periodWindow(period, monthIdx)'),
                 span('function cashForPeriod(rows, period, monthIdx)')].join('\n');
  const win = { FinFlowDates: require(path.join(ROOT, 'public/finflow-dates.js')) };
  const document = { getElementById: () => null };   // no #s-fy ⇒ January fiscal year, as seeded
  return new Function('window', 'document', 'currentPeriod', 'currentMonthIdx',
    parts + '\n; return { cashForPeriod, _periodWindow };')(win, document, 'year', 6);
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
    await seed(c, userId);

    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    if (login.status !== 200) throw new Error(`login failed: HTTP ${login.status} ${login.text.slice(0, 200)}`);

    const cf = await http.post('/api/reports/cash-flow', {});
    if (cf.status !== 200) throw new Error(`cash-flow endpoint: HTTP ${cf.status} ${cf.text.slice(0, 200)}`);
    const rows = cf.json?.rows || [];

    console.log('\n' + '='.repeat(78));
    console.log('  F57 — DASHBOARD CASH-FLOW CARD (decision D3, genuine cash basis)');
    console.log('='.repeat(78));
    console.log('\n-- server rows (POST /api/reports/cash-flow, real seeded DB) --');
    for (const r of rows) console.log(`     ${r.key}  in ${String(r.inflow).padStart(6)}  out ${String(r.outflow).padStart(6)}  net ${String(r.net).padStart(7)}`);

    const { cashForPeriod } = loadClientCash();

    // ── 1 · The card's three cells, per period, from the REAL rows ──
    console.log('\n-- 1 - cashForPeriod over the real rows == VERIFICATION cash expecteds --');
    const CASES = [
      ['jun', 'month',   5, EXPECTED.CASHFLOW.jun, { netProfit: EXPECTED.PL.jun.netProfit }],
      ['jul', 'month',   6, EXPECTED.CASHFLOW.jul, { netProfit: EXPECTED.PL.jul.netProfit }],
      ['fy',  'year', null, EXPECTED.CASHFLOW.fy,  { netProfit: EXPECTED.PL.fy.netProfit }],
    ];
    for (const [label, period, idx, want, accrual] of CASES) {
      const got = cashForPeriod(rows, period, idx);
      A(`${label}: in`,  got.in,  want.cashIn);
      A(`${label}: out`, got.out, want.cashOut);
      A(`${label}: net`, got.net, want.net, accrual.netProfit);
    }

    // ── 2 · FAILURE PATH (Rule 14) — the OLD accrual source, on the discriminating period ──
    // getPeriodData()'s accrual buckets are what the card read before. June is the period where
    // cash and accrual genuinely differ, so this is the assertion that has teeth.
    console.log('\n-- 2 - failure path: the accrual source must NOT produce the cash answer (June) --');
    const junCash = cashForPeriod(rows, 'month', 5).net;
    const junAccrual = EXPECTED.PL.jun.netProfit;
    A('June cash net is -250',            junCash, -250);
    A('June accrual netProfit is -1850',  junAccrual, -1850);
    A('the two DIFFER (card is testable)', junCash !== junAccrual, true);

    // The collision this probe exists to warn about. Asserted, not commented, so that if a
    // future seed change removes it the assertion fails loudly and the warning gets revisited.
    console.log('\n-- 3 - FY net collides with accrual netProfit (why FY must not be the discriminator) --');
    A('FY cash net == FY accrual netProfit (COLLISION)',
      EXPECTED.CASHFLOW.fy.net === EXPECTED.PL.fy.netProfit, true);

    // ── 4 · Empty/absent rows must not fabricate a zero ──
    console.log('\n-- 4 - absent cache is not a confident zero --');
    A('null rows → zeros from the pure fn (card renders "…" instead)',
      cashForPeriod(null, 'month', 5), { in: 0, out: 0, net: 0 });

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    // bootServer may already have ended the schema pool; ending twice throws and would mask a
    // real assertion failure behind a teardown error.
    if (server && server.close) await server.close();
    try { if (appPool && appPool.end && !appPool.ended) await appPool.end(); } catch (_) { /* already closed */ }
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[f57] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
