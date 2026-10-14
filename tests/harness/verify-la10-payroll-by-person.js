'use strict';
/**
 * verify-la10-payroll-by-person.js — LA10 (owner decision 2026-10-14): the "1099 / W-2 Summary" report is renamed
 * "Payroll by person". FinFlow is multi-region and estimates-only; US tax-form names implied a filing artefact. The
 * report shows each person's pay from approved + paid payroll runs — it moves from "Tax reports" to the main list.
 * The old name still opens the same report (a saved or scheduled reference must not break).
 *
 * Real SPA, real scratch Postgres, clientMoneyKit seed (clock 2026-07-25): one approved July run — Sam Field gross
 * 2,000, 10% deduction → net 1,800.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la10-payroll-by-person.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA10 — "Payroll by person" replaces "1099 / W-2 Summary"', async ({ w, d, settle, eq }) => {
  w.showPage('reports');
  await settle(30, 50);
  const names = sel => [...d.querySelectorAll(sel + ' > div')].map(r => ((r.querySelector('span + div > div') || {}).textContent || '').trim()).filter(Boolean);
  eq('main reports list includes "Payroll by person"', names('#reports-list').includes('Payroll by person'), true, false);
  eq('tax reports no longer list a US form', names('#tax-reports-list'), ['Income Tax Estimate', 'Tax-Deductible Expenses'], ['Income Tax Estimate', '1099 / W-2 Summary', 'Tax-Deductible Expenses']);
  eq('no "1099" or "W-2" anywhere on the Reports page', /1099|W-2/.test(d.getElementById('page-reports').textContent), false, true);

  const body = async name => { await w.generateReport(name); await settle(22, 60); const el = d.getElementById('rpt-body'); return el ? el.textContent.replace(/\s+/g, ' ') : ''; };
  const b = await body('Payroll by person');
  eq('report: Sam Field listed with gross and net', /Sam Field.*gross \$2,000 · net \$1,800/.test(b), true);
  eq('report: Total Wages $2,000', /Total Wages\s*\$2,000/.test(b), true);
  eq('report body has no US form names', /1099|W-2/.test(b), false, true);
  const old = await body('1099 / W-2 Summary');
  eq('the old name still opens the same report', old, b);
});
