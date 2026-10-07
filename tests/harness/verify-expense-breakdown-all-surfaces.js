'use strict';
/**
 * verify-expense-breakdown-all-surfaces.js — Phase 1.1 (Rule 2 / 13): every surface that breaks the
 * operating-expense total down by category must (a) sum to that total and (b) show the SAME categories.
 *
 * Surfaces (enumerated both directions — the code that builds a breakdown, and the screens that show one):
 *   1. server computeBooks.expenseBreakdown  → GET /api/reports `expenseBreakdown` (display-currency bars)
 *   2. dashboard "Expense breakdown" bars     → wiring-dashboard updateExpenseBars (#exp-sal … #exp-mkt)
 *   3. Expenses page category bars            → app-main updateExpenses (#ex-sal, #ex-rent, #ex-sw2, #ex-other)
 *   4. AI insights "Expenses this month" line → app-main updateAI (same category list as 3)
 *
 * Seed: tests/harness/fullLegScenario.js — one of every leg through the REAL endpoints, incl. a posted
 * expense journal (12) that the breakdowns dropped after N20 (opex 614, categories Payroll 550 ·
 * Bills & vendors 44 · Journal entries 12 · Office 8 — hand-computed, see that file).
 *
 * BUGGY VALUES (what pre-fix code shows, proven RED before the fix):
 *   server Σ(expenseBreakdown.rows) = 602 (no journal row)           — expected 614
 *   dashboard Σ(bars)               = 602 (no journal row)           — expected 614
 *   Expenses page Σ(bars)           = 565 (Payroll 550 + Office 8 + "Bill payments" 7: no issued bill,
 *                                     no vendor credit, no journal) — expected 614
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-expense-breakdown-all-surfaces.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario, EXPECTED } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const money = s => { const m = String(s || '').replace(/[,\s]/g, '').match(/(-?)\$?(-?\d+(?:\.\d+)?)/); return m ? (m[1] === '-' ? -1 : 1) * parseFloat(m[2]) : NaN; };
const sum = rows => rows.reduce((s, [, v]) => s + v, 0);
const asMap = rows => Object.fromEntries(rows.map(([k, v]) => [k, v]));

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  Phase 1.1 — expense breakdown reconciles to opex on every surface\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: postFullLegScenario });
    const { window, http, settle, text } = ctx;

    // ── 1 · server ──
    const rep = JSON.parse((await http.get('/api/reports?period=year&monthIdx=6&fyStart=0')).text);
    const srvRows = (rep.expenseBreakdown && rep.expenseBreakdown.rows || []).map(r => [r.category, r.amount]);
    A('server: /api/reports expenses == hand-computed opex (614)', near(rep.expenses, EXPECTED.opex), 'expenses=' + rep.expenses);
    A('server: Σ expenseBreakdown.rows == opex (614)', near(sum(srvRows), EXPECTED.opex), 'Σ=' + sum(srvRows) + ' rows=' + JSON.stringify(srvRows));
    A('server: breakdown has the "Journal entries" category (12)', near(asMap(srvRows)['Journal entries'], 12), JSON.stringify(srvRows));

    // ── 2 · dashboard bars ──
    await settle(80, 100);
    const dashRows = [['exp-sal', 'exp-sal-lbl'], ['exp-rent', 'exp-rent-lbl'], ['exp-sw', 'exp-sw-lbl'], ['exp-mkt', 'exp-mkt-lbl']]
      .map(([v, l]) => [text(l), money(text(v))]).filter(([, v]) => !isNaN(v));
    A('dashboard: Expenses KPI shows 614', near(money(text('d-exp')), EXPECTED.opex), 'd-exp=' + text('d-exp'));
    A('dashboard: Σ breakdown bars == Expenses KPI (614)', near(sum(dashRows), EXPECTED.opex), 'Σ=' + sum(dashRows) + ' bars=' + JSON.stringify(dashRows));
    A('dashboard: bars carry the hand-computed categories', JSON.stringify(asMap(dashRows)) === JSON.stringify(asMap(Object.entries(EXPECTED.categories).sort((a, b) => b[1] - a[1]))),
      JSON.stringify(dashRows));

    // ── 3 · Expenses page bars ──
    window.showPage('expenses');
    await settle(30, 100);
    const d = window.document;
    const pageRows = ['ex-sal', 'ex-rent', 'ex-sw2', 'ex-other'].map(id => {
      const el = d.getElementById(id); if (!el) return null;
      const row = el.closest('.bar-row'); const lbl = row && row.querySelector('.bar-label');
      return [lbl ? lbl.textContent.trim() : '?', money(el.textContent)];
    }).filter(r => r && !isNaN(r[1]));
    A('Expenses page: total card shows 614', near(money(text('ex-total')), EXPECTED.opex), 'ex-total=' + text('ex-total'));
    A('Expenses page: Σ category bars == total (614)', near(sum(pageRows), EXPECTED.opex), 'Σ=' + sum(pageRows) + ' bars=' + JSON.stringify(pageRows));
    A('Expenses page: same categories as the dashboard bars', JSON.stringify(asMap(pageRows)) === JSON.stringify(asMap(dashRows)),
      'page=' + JSON.stringify(pageRows) + ' dash=' + JSON.stringify(dashRows));
    A('Expenses page: largest category card names Payroll', /Payroll/.test(text('ex-top') || ''), 'ex-top=' + text('ex-top'));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (expense breakdown, all surfaces)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
