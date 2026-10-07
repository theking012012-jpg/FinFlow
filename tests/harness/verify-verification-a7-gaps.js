'use strict';
/**
 * verify-verification-a7-gaps.js — Phase 2.3. VERIFICATION.md rows A7.5–8 and A7.18 had EMPTY result cells and —
 * contrary to the plan's note — NO gate executed them. This harness does, on the real VERIFICATION seed
 * (jsdomBoot default seed = seedData.js), reading the surfaces the user sees; expected values come from the rows
 * and from expected.js (the owner-derived single source the pre-commit hook keeps in sync with VERIFICATION.md).
 *   A7.5  Customer detail — per-customer balance: A 300 · B 7,000 · A+B 7,300 (== net AR). Surface: the
 *         "Accounts Receivable" report (F137-c, "Outstanding by customer").
 *   A7.6  Expenses page — period total, June. The row says 750 = manual expense rows only; under decisions 1+2
 *         (opex = manual expenses + bills issued + payroll) the page total IS the period opex = expected.js jun.opex.
 *         Asserted against expected.js; the row's 750 is flagged for the owner.
 *   A7.7  COGS page — period COGS, June: 200.
 *   A7.8  COGS page — no-period call: 1,650 all-time.
 *   A7.18 Cash Flow — FY cash out != FY opex: 3,200 vs expected.js fy.opex (the row's "8,200" predates a seed revision).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-verification-a7-gaps.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const EXPECTED = require('./expected.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const num = t => parseFloat(String(t || '').replace(/[^0-9.\-]/g, ''));
const flat = s => String(s || '').replace(/\s+/g, ' ');

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  2.3 — VERIFICATION A7.5–8, A7.18 executed on the real seed\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({});
    const { window: w, settle, http } = ctx;
    await settle(60, 100);
    const P = EXPECTED.PL || {};
    const junOpex = (P.jun || {}).opex, fyOpex = (P.fy || {}).opex;
    A('premise: expected.js carries jun / fy opex', Number.isFinite(junOpex) && Number.isFinite(fyOpex), 'keys=' + Object.keys(EXPECTED).join(','));

    await w.generateReport('Accounts Receivable'); await settle(25, 60);
    const ar = flat((w.document.getElementById('rpt-body') || {}).textContent);
    const amtAfter = name => { const m = ar.match(new RegExp(name + '\\D{0,40}?([\\d,]+(?:\\.\\d+)?)')); return m ? num(m[1]) : NaN; };
    A('A7.5 Customer A balance 300 (net of CN-1 1,200)', amtAfter('Customer A') === 300, ar.slice(0, 260));
    A('A7.5 Customer B balance 7,000', amtAfter('Customer B') === 7000, ar.slice(0, 260));
    A('A7.5 A + B = 7,300 = Total Receivable', /Total Receivable\D{0,20}7,300/.test(ar), ar.slice(0, 260));

    w.setPeriod(w.document.getElementById('pMonth'), 'month'); await settle(10, 100);
    for (let i = 0; i < 12 && w.eval('currentMonthIdx') > 5; i++) { w.shiftMonth(-1); await settle(3, 100); }
    for (let i = 0; i < 12 && w.eval('currentMonthIdx') < 5; i++) { w.shiftMonth(1); await settle(3, 100); }
    A('premise: active period is June (month, fiscal idx 5)', w.eval('currentPeriod') === 'month' && w.eval('currentMonthIdx') === 5, w.eval('currentPeriod') + '/' + w.eval('currentMonthIdx'));
    w.showPage('expenses'); await settle(30, 100);
    const ex = num((w.document.getElementById('ex-total') || {}).textContent);
    A(`A7.6 Expenses page June total = period opex ${junOpex} (expected.js; the row's 750 is manual rows only)`, ex === junOpex, 'ex-total=' + (w.document.getElementById('ex-total') || {}).textContent);
    w.showPage('cogs'); await settle(30, 100);
    if (typeof w.loadCOGS === 'function') { await w.loadCOGS(); await settle(20, 100); }
    const cg = num((w.document.getElementById('cogs-total') || {}).textContent);
    A('A7.7 COGS page June COGS = 200', cg === 200, 'cogs-total=' + (w.document.getElementById('cogs-total') || {}).textContent);
    const allT = await http.get('/api/cogs');
    A('A7.8 COGS no-period call = 1,650 all-time', allT.status === 200 && Math.abs(num(allT.json && allT.json.totalCOGS) - 1650) < 0.005, 'status=' + allT.status + ' ' + String(allT.text).slice(0, 120));

    w.setPeriod(w.document.getElementById('pY'), 'year'); await settle(10, 100);
    w.showPage('cashflow'); await settle(30, 100);
    const out = num((w.document.getElementById('cf-out') || {}).textContent);
    A(`A7.18 Cash Flow FY cash out 3,200 != FY opex ${fyOpex}`, out === 3200 && out !== fyOpex, 'cf-out=' + (w.document.getElementById('cf-out') || {}).textContent + ' fyOpex=' + fyOpex);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (ctx) await ctx.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (VERIFICATION A7 gaps)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
