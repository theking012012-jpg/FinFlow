'use strict';
/**
 * verify-la8-expense-card-labels.js — LA8 (live audit 2026-10-13, minor): on the Expenses page the card labelled
 * "Business" is only the recorded expense ENTRIES (bills and payroll are left out — the data has no
 * business/personal split), and "89% of expenses deductible" was a share of that subtotal, not of total expenses.
 * The figures are unchanged; the labels say what they are.
 *
 * Real SPA, real scratch Postgres, clientMoneyKit seed (clock 2026-07-25, Year): expenses 2,900 = rent entry 500
 * (deductible) + payroll run 2,000 + bill 400. Entries 500 = 17% of total; deductible 500 = 100% of the entries.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la8-expense-card-labels.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA8 — Expenses cards say what their figures are', async ({ w, d, all, settle, eq }) => {
  w.showPage('expenses');
  await settle(30, 50);
  const label = id => { const el = d.getElementById(id); return el && el.parentElement.querySelector('.mc-label').textContent.trim(); };
  eq('total (unchanged)', all('ex-total'), '$2,900');
  eq('entries card value (unchanged)', all('ex-biz'), '$500');
  eq('entries card label', label('ex-biz'), 'Expense entries', 'Business');
  eq('entries card caption', all('ex-biz-pct'), 'Excl. bills & payroll · 17% of total', '17% of total');
  eq('deductible caption names its base', all('ex-ded-save'), '100% of expense entries', '100% of expenses deductible');
});
