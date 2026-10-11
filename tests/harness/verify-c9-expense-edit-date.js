'use strict';
/**
 * C9 (Cowork end-to-end test 2.4a): editing an expense opens with its date filled in, and an amount-only edit saves.
 * BUG: three loaders built the Expenses list; only one (M52's) carried the editable date. refreshFinancials('expenses') —
 * which runs after every expense save (Cowork added three, then edited) — rebuilt window.bizExpenses WITHOUT it, so
 * Edit opened with the date blank and Save was refused "Enter a valid date".
 * Seed: clientMoneyKit (expense "Rent" 500, dated 2026-07-01). Run refreshFinancials('expenses') (the post-save
 * refresh) and the business-load path, open Edit on Rent, change only the amount to 525, save.
 *   date field "2026-07-01"     bug: ""
 *   saved amount 525, date kept  bug: refused, amount stays 500
 */
const { run } = require('./clientMoneyKit.js');

run('C9 — expense edit keeps its date after a business reload', async ({ w, d, ev, settle, eq, http }) => {
  try { w.showPage('expenses'); } catch (_) {}
  await settle(20, 60);
  await w.loadEntityData(ev(`(window.ENTITIES||[]).findIndex(e=>e.active)`)); await settle(30, 60);
  await w.refreshFinancials('expenses'); await settle(30, 60);   // the post-save refresh Cowork's flow ran
  if (typeof w.renderExpenses === 'function') w.renderExpenses();
  await settle(10, 40);
  const idx = ev(`(window.bizExpenses||[]).findIndex(e=>e.desc==='Rent')`);
  ev(`editExpense(${idx})`); await settle(10, 40);
  eq('the edit form carries the expense date', (d.getElementById('bexp-date') || {}).value, '2026-07-01', '');
  ev(`document.getElementById('bexp-amount').value='525';`);
  await w.saveExpense(); await settle(30, 60);
  const row = ((await http.get('/api/expenses')).json || []).find(e => e.description === 'Rent') || {};
  eq('amount-only edit saved; date kept', [Number(row.amount), String(row.expense_date || '').slice(0, 10)], [525, '2026-07-01'], [500, '2026-07-01']);
});
