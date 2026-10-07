'use strict';
/**
 * verify-budget-actuals.js — L25 (prior audit F45, still present). Budget targets are stored as ANNUAL amounts
 * (the target modal converts monthly × 12), but "Spent" and each row's actual were Σ raw expense rows of ALL TIME
 * — so last year's spend counted against this year's budget, and payroll / bills / journal expense never counted
 * at all (a "Payroll" target always read 0 spent).
 *
 * Fix under test: actuals = this FISCAL YEAR's spend per category from the shared expense breakdown
 * (computeExpenseBreakdown('year') → _expenseCategoryRows, the D3 category list every other surface uses),
 * matched case-insensitively to the target names.
 *
 * Seed: fullLegScenario (FY categories Payroll 550 · Bills & vendors 44 · Journal entries 12 · Office 8) + an
 * Office expense 50 dated 2025-12-15 (prior fiscal year). Targets: Payroll 1200, office 100, Rent 500.
 * EXPECTED (Rule 6, by hand): Payroll 550 · Office 8 · Rent 0 ⇒ Spent 558 of 1800, Remaining 1242
 *   bug: Payroll 0 · Office 58 (8 + 50) · Rent 0 ⇒ Spent 58
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-budget-actuals.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const num = t => parseFloat(String(t || '').replace(/[^0-9.\-]/g, ''));

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L25 — Budget actuals are this fiscal year\'s spend, every leg\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async (o) => {
      const r = await postFullLegScenario(o);
      const e = await o.http.post('/api/expenses', { description: 'Old supplies', category: 'Office', amount: 50, expense_date: '2025-12-15' });
      if (e.status >= 300) throw new Error('prior-year expense ' + e.status);
      const t = await o.http.put('/api/budget-targets', { Payroll: 1200, office: 100, Rent: 500 });
      if (t.status >= 300) throw new Error('targets ' + t.status);
      return r;
    } });
    const { window: w, settle } = ctx;
    await settle(60, 100);
    w.showPage('budget'); await settle(40, 100);
    const rows = {}; (w.BUDGET_DATA || []).forEach(r => { rows[r.cat.toLowerCase()] = r.actual; });
    A('Payroll target: actual 550 (approved + paid runs; bug 0)', rows.payroll === 550, JSON.stringify(rows));
    A('office target: actual 8 — FY only, case-insensitive (bug 58, incl. the 2025 row)', rows.office === 8, JSON.stringify(rows));
    A('Rent target: actual 0', rows.rent === 0, JSON.stringify(rows));
    const t = id => (w.document.getElementById(id) || {}).textContent;
    A('"Spent" card = 558 (bug 58)', num(t('budget-spent')) === 558, 'budget-spent=' + t('budget-spent'));
    A('"Total budget" card = 1,800', num(t('budget-total')) === 1800, 'budget-total=' + t('budget-total'));
    A('"Remaining" card = 1,242', num(t('budget-remaining')) === 1242, 'budget-remaining=' + t('budget-remaining'));
    const rowTxt = (w.document.getElementById('budget-rows') || {}).textContent || '';
    A('Payroll row shows actual 550 (bug $0)', /Payroll\s*\$?550(\.00)?\s*\//.test(rowTxt.replace(/\s+/g, ' ')), rowTxt.replace(/\s+/g, ' ').slice(0, 240));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { if (ctx) await ctx.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (budget actuals)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
