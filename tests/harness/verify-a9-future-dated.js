#!/usr/bin/env node
'use strict';
/**
 * verify-a9-future-dated.js — VERIFICATION Part A check **A9** (D2), executed for the first time
 * under its own label. A future-dated document is SCHEDULED, not issued: it contributes ZERO to
 * every figure — Month, Quarter AND Year — and to AR, until its date arrives, while remaining
 * VISIBLE (not deleted). Decision D2 / F93; scheduled state F94.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-a9-future-dated.js
 *
 * D2 was long tracked as "not yet built / A9 fails by design". It is in fact implemented on both
 * sides: computeBooks' inPeriod carries a D2 upper bound (`ymd > _today → excluded`, server.js:4776)
 * applied to EVERY period, the AR leg has the same bound (server.js:5037), and `_today` is the SERVER
 * clock as a UTC string (viewer-independent, F87/F89). This probe closes A9 with explicit assertions.
 *
 * TWO independent proofs (Rule 6 + Rule 4/14):
 *   1. ORACLE baseline — the seeded future invoice INV-6 (2026-09-01, 5,000) is ALREADY excluded:
 *      FY revenue = 8,800 (not 13,800), Q3 revenue = 4,000 (not 9,000), AR = 8,500 (not 13,500).
 *      Each "would-be" figure is the oracle + INV-6's 5,000 — a D2 violation lands exactly there.
 *   2. SEED-INDEPENDENT DELTA — insert a BRAND-NEW future invoice through a direct seed and re-read:
 *      FY, Q3 and AR must all be UNCHANGED (delta 0). This proves ANY future invoice contributes 0,
 *      immune to the seed's exact values and to the monthIdx mapping. Rule 14 control: deleting the
 *      `> _today` clause in inPeriod turns every delta into +FUT_AMOUNT.
 *
 * A9.4 — the scheduled document is VISIBLE, not vanished: INV-6 is present in GET /api/invoices and
 *   is future-dated (issue_date > today), i.e. the row the F94 badge marks "scheduled".
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const path = require('path');
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const ROOT = path.resolve(__dirname, '../..');
const FinFlowDates = require(path.join(ROOT, 'public/finflow-dates.js'));
const EXPECTED = require('./expected.js');
const LOGIN = { email: 'seed-owner@example.test', password: 'harness-pw-1' };

// Oracle (Rule 6) — net revenue = gross − credit notes; the server reports revenue NET (F58).
const FY_REV = EXPECTED.COMPONENTS.fy.revenue - (EXPECTED.COMPONENTS.fy.creditNotes || 0);   // 8,800
const Q3_REV = EXPECTED.COMPONENTS.q3.revenue - (EXPECTED.COMPONENTS.q3.creditNotes || 0);   // 4,000
const AR_OUT = 8500;                                                                          // VERIFICATION.md
const INV6_AMOUNT = 5000;   // the seeded future invoice, for the "would-be" discriminators
const FUT_AMOUNT = 7777;    // a fresh future invoice we add for the seed-independent delta

let pass = 0, fail = 0;
const A = (name, got, want, bugWould) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else { fail++; console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want) + (bugWould ? '\n          (' + bugWould + ')' : '')); }
};
const d2 = n => Math.round((n || 0) * 100) / 100;

async function report(http, qs) {
  const r = await http.get('/api/reports' + (qs ? '?' + qs : ''));
  if (r.status !== 200) throw new Error(`/api/reports${qs ? '?' + qs : ''}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  return { revenue: r.json.revenue, outstanding: r.json.outstanding };
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
    const { entityId } = await seed(c, userId);

    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    if (login.status !== 200) throw new Error(`login: HTTP ${login.status} ${login.text.slice(0, 200)}`);

    console.log('\n' + '='.repeat(78));
    console.log('  A9 — FUTURE-DATED DOCUMENTS ARE NOT RECOGNISED (D2), real server + real Postgres');
    console.log('='.repeat(78));

    // ── 1 · ORACLE baseline: the seeded future INV-6 is already excluded ──
    console.log('\n-- 1 - the seeded future invoice INV-6 (2026-09-01, 5,000) is excluded --');
    const fy = await report(http, '');                       // no params ⇒ year (fiscal)
    A('A9.1  FY revenue excludes INV-6', fy.revenue, FY_REV, `a D2 violation would read ${FY_REV + INV6_AMOUNT}`);
    A('A9.3  AR outstanding excludes INV-6', fy.outstanding, AR_OUT, `a D2 violation would read ${AR_OUT + INV6_AMOUNT}`);

    // Q3 = the quarter containing the pinned month (July). fyStart = Jan (0); July = index 6.
    const q3 = await report(http, 'period=quarter&monthIdx=6&fyStart=0');
    A('A9.2  Q3 revenue excludes INV-6', q3.revenue, Q3_REV, `a D2 violation would read ${Q3_REV + INV6_AMOUNT}`);

    // ── 2 · SEED-INDEPENDENT DELTA: a brand-new future invoice contributes 0 everywhere ──
    console.log('\n-- 2 - a NEW future invoice (2026-12-01, 7,777) moves NOTHING (delta 0) --');
    await c.query(
      `INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
      [userId, entityId, { client: 'Future Co', amount: FUT_AMOUNT, status: 'pending', amount_paid: 0, issue_date: '2026-12-01' }]
    );
    const fy2 = await report(http, '');
    const q32 = await report(http, 'period=quarter&monthIdx=6&fyStart=0');
    A('A9.1Δ FY revenue unchanged by a new future invoice', d2(fy2.revenue - fy.revenue), 0, `a D2 violation would show +${FUT_AMOUNT}`);
    A('A9.2Δ Q3 revenue unchanged by a new future invoice', d2(q32.revenue - q3.revenue), 0, `a D2 violation would show +${FUT_AMOUNT}`);
    A('A9.3Δ AR unchanged by a new future invoice', d2(fy2.outstanding - fy.outstanding), 0, `a D2 violation would show +${FUT_AMOUNT}`);

    // ── 3 · A9.4 — scheduled, not deleted: INV-6 is present and future-dated ──
    console.log('\n-- 3 - the scheduled document is VISIBLE (A9.4, F94) --');
    const list = await http.get('/api/invoices');
    if (list.status !== 200) throw new Error(`GET /api/invoices: HTTP ${list.status}`);
    const today = FinFlowDates.resolvedToday(new Date());
    const inv6 = (list.json || []).find(i => FinFlowDates._toYmd(i.issue_date) === '2026-09-01');
    A('A9.4  the future invoice is present in the list (not deleted)', !!inv6, true,
      `invoices seen: ${(list.json || []).map(i => i.issue_date).join(', ')}`);
    A('A9.4  …and is future-dated (issue_date > today) — the row F94 badges "scheduled"',
      !!inv6 && FinFlowDates._toYmd(inv6.issue_date) > today, true, `today=${today}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (A9 / D2 future-dated exclusion)'
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
  console.error('\n[a9] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
