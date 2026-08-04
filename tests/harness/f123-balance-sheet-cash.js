#!/usr/bin/env node
'use strict';
/**
 * f123-balance-sheet-cash.js — the balance sheet reports cash as NOT TRACKED, never a number.
 *
 *   node tests/harness/f123-balance-sheet-cash.js
 *
 * POST /api/reports/balance-sheet returned `cash = Math.max(0, books.netProfit)` — the ACCRUAL
 * bottom line, clamped at zero, labelled cash — and fed it into totalAssets and equity. There is
 * no cash account in the schema to compute a real figure from, so per decision D1's discipline the
 * honest answer is "not tracked", not a better guess.
 *
 * Real server, real scratch Postgres, real HTTP, real seed.
 *
 * ⚠️ WHAT DISCRIMINATES AND WHAT DOES NOT — read before adding assertions here.
 * The seed's FY netProfit is −1,700, so the OLD formula's clamp already produced cash = 0, and
 * totalAssets was therefore 8,500 (AR alone) both before and after this fix. **totalAssets cannot
 * tell the two implementations apart on this seed** — asserting it and calling the fix proven
 * would be a green check that proves nothing (Rule 4). The discriminating assertion is on the
 * `cash` FIELD: `null` + `cashTracked:false` after, a NUMBER before. Section 3 asserts the
 * collision explicitly, so a future seed change cannot silently remove this warning.
 *
 * RULE 14 CONTROL, EXECUTED when this probe was written: the old formula was restored in
 * server.js (`cash = Math.max(0, books.netProfit)`, `totalAssets = cash + ar`) and the probe re-run
 * against it —
 *     response: {"cash":0,...,"totalAssets":8500,...,"equity":7400}
 *     FAIL  cash is null                    got 0     want null
 *     FAIL  cash is NOT a number of any kind got true  want false
 *     PASS  totalAssets is AR alone         → 8500     ← UNCHANGED by the bug
 * Two assertions moved, and totalAssets did not — the collision demonstrated, not predicted.
 * server.js was restored and the probe re-verified 13/13.
 *
 * That the clamp turns a real loss into a confident 0 is not a side note — it is the third of the
 * three defects in the row (wrong basis, flow-as-balance, loss erased), and this seed demonstrates
 * it: a business that lost 1,700 was told its cash was 0.
 *
 * Read-only: SELECTs plus one read-only POST. Scratch Postgres only — enforced by guard.js.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');
const EXPECTED = require('./expected.js');

const ROOT = path.resolve(__dirname, '../..');
const LOGIN = { email: 'seed-owner@example.test', password: 'harness-pw-1' };

let pass = 0, fail = 0;
const A = (name, got, want, note) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else {
    fail++;
    console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) +
      '\n          want ' + JSON.stringify(want) + (note ? '\n          (' + note + ')' : ''));
  }
};

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

    console.log('\n' + '='.repeat(78));
    console.log('  F123 — BALANCE-SHEET CASH IS "NOT TRACKED" (real server, real seed)');
    console.log('='.repeat(78));

    const bs = await http.post('/api/reports/balance-sheet', {});
    if (bs.status !== 200) throw new Error(`balance-sheet: HTTP ${bs.status} ${bs.text.slice(0, 200)}`);
    const j = bs.json || {};
    console.log('\n  response: ' + JSON.stringify(j));

    // ── 1 · cash is not a number, and says so ──
    console.log('\n-- 1 - cash is reported as untracked, not computed --');
    A('cash is null', j.cash, null, 'the old formula returned Math.max(0, netProfit)');
    A('cash is NOT a number of any kind', typeof j.cash === 'number', false);
    A('cashTracked flags it explicitly', j.cashTracked, false);
    A('the response advertises that assets exclude cash', j.totalAssetsExcludesCash, true);

    // ── 2 · the rest of the balance sheet is unchanged and still correct ──
    console.log('\n-- 2 - AR / AP / assets / equity --');
    A('accountsReceivable == VERIFICATION AR',  j.accountsReceivable, EXPECTED.BALANCES.arOutstanding);
    A('accountsPayable == VERIFICATION AP',     j.accountsPayable,    EXPECTED.BALANCES.apOutstanding);
    A('totalAssets is AR alone',                j.totalAssets,        EXPECTED.BALANCES.arOutstanding);
    A('equity == assets − liabilities',         j.equity,
      Math.round((EXPECTED.BALANCES.arOutstanding - EXPECTED.BALANCES.apOutstanding) * 100) / 100);

    // The collision this probe exists to warn about, asserted rather than commented.
    console.log('\n-- 3 - DISCRIMINATION: totalAssets CANNOT tell the two implementations apart --');
    const fyNet = EXPECTED.PL.fy.netProfit;
    A('FY netProfit is a LOSS on this seed', fyNet < 0, true);
    A('…so the OLD clamp would also have produced cash = 0', Math.max(0, fyNet), 0,
      'if a future seed makes FY profitable this assertion fails and the warning must be revisited');
    A('…and totalAssets would be identical either way (COLLISION)',
      Math.round((Math.max(0, fyNet) + EXPECTED.BALANCES.arOutstanding) * 100) / 100, j.totalAssets);
    console.log('        ^ therefore only the `cash` FIELD discriminates. Section 1 is the real check.');
    console.log('        ^ and note what the old code told this user: cash 0, on a year they lost ' +
                Math.abs(fyNet) + '.');

    // ── 4 · STRUCTURAL (Rule 5, labelled) — no LIVE surface renders this figure ──
    // Rated on this: the endpoint is live and authenticated, but the only client fetch of it sits
    // inside app-main.js's generateReport, which finflow-api-wiring-extra.js REPLACES at runtime
    // (bundle source #7, loads after app-main) — see F128. No value can express "this code is
    // unreachable", so this is a structural assertion and is labelled as one.
    console.log('\n-- 4 - STRUCTURAL: the only client fetch of this route is in shadowed code (F128) --');
    const appMain = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
    const extra   = fs.readFileSync(path.join(ROOT, 'public/finflow-api-wiring-extra.js'), 'utf8');
    const fetches = (appMain.match(/\/api\/reports\/balance-sheet/g) || []).length;
    A('STRUCTURAL: app-main is the only client file fetching the route', fetches, 1);
    A('STRUCTURAL: a wiring file overrides generateReport (replacement, no _orig)',
      /window\.generateReport\s*=\s*async function/.test(extra) && !/_origGenerateReport/.test(extra), true);

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
  console.error('\n[f123] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
