#!/usr/bin/env node
'use strict';
/**
 * verify-a8c-fx-reconcile.js — VERIFICATION Part A **A8c** + Appendix B (FX). Display currency is a
 * viewer's LENS over the entity's native books: converting to a foreign currency and reading back
 * must **reconcile exactly** at the stated rate, and a **blocked rate must yield "—"**, never a
 * native number presented as converted.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-a8c-fx-reconcile.js
 *
 * WHY A FLAT RATE. computeBooks converts EACH leg at its OWN recognition-date rate (server.js:4812,
 * sumFX). With a single USD→EUR rate carried forward across all dates (pickRate carry-forward), every
 * leg is × RATE, so the converted figure equals native × RATE **exactly** — the clean reconciliation
 * A8c asks for. (Date-sensitivity of the rate is a separate concern; here we fix the rate to isolate
 * "does conversion reconcile".)
 *
 * DISCRIMINATION (Rule 4): RATE = 0.90 on the seed's whole-dollar figures gives distinct numbers for
 * every plausible bug — identity/relabel (native, ×1), a units/rate inversion (×1/0.90 = 1.111…), or a
 * dropped conversion — none collide with native × 0.90.
 *
 * EXECUTED FAILURE PATH (Rule 14): a display currency with NO seeded rate (GBP) must flag
 * fxCoverage.complete=false and exclude the rows (the "—" path), NOT silently relabel native as GBP.
 *
 * Native (no ?display) is the authoritative, viewer-independent figure — that is what every other
 * gate asserts; this probe only adds the CONVERSION layer on top.
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'seed-owner@example.test', password: 'harness-pw-1' };
const RATE = 0.90;                 // USD → EUR, flat (one rate, carried forward across all dates)
const LEGS = ['revenue', 'cogs', 'grossProfit', 'expenses', 'netProfit', 'outstanding']; // A8c.1–6

let pass = 0, fail = 0;
const A = (name, got, want, bugWould) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else { fail++; console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want) + (bugWould ? '\n          (' + bugWould + ')' : '')); }
};
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

async function reports(http, qs) {
  const r = await http.get('/api/reports' + (qs ? '?' + qs : ''));
  if (r.status !== 200) throw new Error(`/api/reports${qs ? '?' + qs : ''}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;
  try {
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Seed Owner', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const { entityId } = await seed(c, userId);   // USD-native entity + the full VERIFICATION seed

    // One USD→EUR rate, dated before every seed row so pickRate carry-forward converts the whole history.
    await c.query(
      `INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date, source)
       VALUES ($1, $2, 'USD', 'EUR', $3, '2025-01-01', 'harness')`,
      [userId, entityId, RATE]
    );

    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    if (login.status !== 200) throw new Error(`login: HTTP ${login.status} ${login.text.slice(0, 200)}`);

    console.log('\n' + '='.repeat(78));
    console.log('  A8c / Appendix B — DISPLAY-CURRENCY RECONCILIATION (real server + real Postgres)');
    console.log('='.repeat(78));

    // ── 0 · native is the authoritative figure (identity path) ──
    const nat = await reports(http, '');                     // no ?display ⇒ native (USD)
    console.log('\n-- native (USD) --');
    for (const k of LEGS) console.log(`     ${k.padEnd(12)} ${nat[k]}`);
    A('native path is identity — fxCoverage.complete', nat.fxCoverage ? nat.fxCoverage.complete : true, true);

    // ── 1 · convert to EUR — every leg reconciles to native × RATE, exactly ──
    console.log(`\n-- 1 - display=EUR at flat rate ${RATE}: converted == native × ${RATE} --`);
    const eur = await reports(http, 'display=EUR');
    A('conversion actually engaged (EUR revenue ≠ native, not a relabel)',
      !near(eur.revenue, nat.revenue), true, `eur ${eur.revenue} vs native ${nat.revenue}`);
    A('fxCoverage.complete (every row had a rate)', eur.fxCoverage && eur.fxCoverage.complete === true, true,
      `coverage ${JSON.stringify(eur.fxCoverage)}`);
    for (const k of LEGS) {
      const want = Math.round(nat[k] * RATE * 100) / 100;
      A(`A8c  ${k} reconciles: EUR == native × ${RATE}  (${nat[k]} → ${want})`,
        near(eur[k], want), true, `got ${eur[k]}; identity would be ${nat[k]}, inverse ${Math.round(nat[k] / RATE * 100) / 100}`);
    }
    // consistency: the SAME ratio across every non-zero leg (reconciles the same way, not per-day drift here)
    const ratios = LEGS.filter(k => Math.abs(nat[k]) > 0.005).map(k => Math.round((eur[k] / nat[k]) * 1000) / 1000);
    A('A8c  the conversion ratio is IDENTICAL across all legs (consistent)',
      ratios.every(x => Math.abs(x - RATE) < 0.001), true, `ratios ${JSON.stringify(ratios)}`);

    // ── 2 · blocked rate (GBP, none seeded) → "—" path, NOT a native number relabelled ──
    console.log('\n-- 2 - display=GBP (no rate seeded): coverage incomplete, not a silent relabel --');
    const gbp = await reports(http, 'display=GBP');
    A('blocked rate → fxCoverage.complete === false', gbp.fxCoverage && gbp.fxCoverage.complete === false, true,
      `coverage ${JSON.stringify(gbp.fxCoverage)}`);
    A('blocked rate → at least one unconvertible leg recorded',
      !!(gbp.fxCoverage && Array.isArray(gbp.fxCoverage.unconvertible) && gbp.fxCoverage.unconvertible.length > 0), true);
    A('blocked rate → revenue is NOT the native figure relabelled as GBP',
      !near(gbp.revenue, nat.revenue), true, `gbp.revenue ${gbp.revenue} vs native ${nat.revenue}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (A8c / Appendix B FX reconciliation)'
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
  console.error('\n[a8c] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
