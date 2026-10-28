'use strict';
/**
 * M52 (fix pass round 2), BROWSER leg: a business expense can be edited from the Expenses page.
 * BUG: no Edit button ever rendered — the wrapper looked for `#expense-list tr / .expense-row` but rows are `.tx-row`
 * divs; its populate/save code read `exp-*` ids that do not exist (the modal is `bexp-*`) and looked rows up in
 * `window.expenses`, not `bizExpenses`. A wrong expense could only be deleted and re-entered.
 * Seed (clientMoneyKit): Rent 500 dated 2026-07-01. Edit → 650 dated 2026-06-20.
 *   correct: stored 650 / 2026-06-20; June opex 650, July opex drops by 500 (2,900 → 2,400)
 *   bug:     no Edit button (0), nothing changes
 */
const { run } = require('./clientMoneyKit.js');

run('M52 — edit a business expense from the Expenses page', async ({ w, d, ev, settle, http, eq, A }) => {
  w.showPage('expenses'); await settle(30, 60);
  const rentRow = () => Array.from(d.querySelectorAll('#expense-list .tx-row')).find(r => /Rent/.test(r.textContent));
  const row = rentRow();
  A('Rent row rendered', !!row);
  const editBtn = row && row.querySelector('button[data-on-click^="editExpense"]');
  eq('Rent row has an Edit button', editBtn ? 1 : 0, 1, 0);
  if (!editBtn) return;
  editBtn.click(); await settle(5, 40);
  const val = id => (d.getElementById(id) || {}).value;
  eq('modal opens populated (description, amount, date)', [val('bexp-desc'), val('bexp-amount'), val('bexp-date')], ['Rent', '500', '2026-07-01']);
  eq('modal is in edit mode', d.querySelector('#expense-modal .modal-title').textContent.trim(), 'Edit expense');
  ev(`document.getElementById('bexp-amount').value='650'; document.getElementById('bexp-date').value='2026-06-20';`);
  await w.saveExpense(); await settle(40, 60);
  const rows = ((await http.request('GET', '/api/expenses')).json || []).filter(x => x.description === 'Rent');
  eq('one Rent expense, stored as edited', rows.map(x => [Number(x.amount), String(x.expense_date).slice(0, 10)]), [[650, '2026-06-20']], [[500, '2026-07-01']]);
  const june = (await http.request('GET', '/api/reports?period=month&monthIdx=5')).json || {};
  const july = (await http.request('GET', '/api/reports?period=month&monthIdx=6')).json || {};
  eq('June opex (the edited Rent)', june.expenses, 650, 0);
  eq('July opex (2,900 − the 500 Rent moved out)', july.expenses, 2400, 2900);
  eq('the list row shows the new amount', /650/.test((rentRow() || {}).textContent || ''), true, false);
  w.openExpenseModal(); await settle(5, 40);
  eq('a fresh Add expense after an edit is back in add mode', [d.querySelector('#expense-modal .modal-title').textContent.trim(), val('expense-edit-id') || ''], ['Add expense', '']);
});
