'use strict';
/**
 * LR19 (live retest C7): the Budget page showed the same annual figures for Month, Quarter and Year. Read
 * (finflow-api-wiring-medium.js loadBudgetFromDB): actuals were ALWAYS computeExpenseBreakdown('year') against the ANNUAL
 * targets, and nothing re-ran it when the period changed. Fix: the page follows the selected period — actuals for that
 * period (the same breakdown every expense surface uses), the annual target scaled to it (month ÷ 12, quarter ÷ 4), and
 * the cards name the period.
 *
 * clientMoneyKit seed (hand-computed, clock 2026-07-25, FY Jan–Dec): Rent expense 500 on 2026-07-01, nothing else in
 * Rent. Target Rent 6,000 / year.
 *   Month (July)  budget 500    spent 500   remaining 0         bug: 6,000 / 500 / 5,500
 *   Quarter (Q3)  budget 1,500  spent 500   remaining 1,000     bug: 6,000 / 500 / 5,500
 *   Year          budget 6,000  spent 500   remaining 5,500     (unchanged — control)
 */
const { run } = require('./clientMoneyKit.js');

run('LR19 — the Budget page follows the selected period', async ({ w, d, ev, settle, eq, A, http }) => {
  await http.put('/api/budget-targets', { Rent: 6000 });
  try { w.showPage('budget'); } catch (_) {}
  await settle(20, 60);
  const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
  const read = async (p, btn) => {
    ev(`setPeriod(document.getElementById('${btn}'), '${p}')`); await settle(20, 60);
    if (typeof w._loadBudgetFromDB === 'function') await w._loadBudgetFromDB();
    await settle(10, 40);
    return [t('budget-total'), t('budget-spent'), t('budget-remaining')];
  };
  eq('Month: budget 500 · spent 500 · remaining 0', await read('month', 'pMonth'), ['$500', '$500', '$0'], ['$6,000', '$500', '$5,500']);
  A('Month: the card names the month', /Jul/.test(t('budget-total-sub')), JSON.stringify(t('budget-total-sub')));
  eq('Quarter: budget 1,500 · spent 500 · remaining 1,000', await read('quarter', 'pQ'), ['$1,500', '$500', '$1,000'], ['$6,000', '$500', '$5,500']);
  eq('Year: budget 6,000 · spent 500 · remaining 5,500 (control)', await read('year', 'pY'), ['$6,000', '$500', '$5,500']);
  const row = ((d.getElementById('budget-rows') || {}).textContent || '').replace(/\s+/g, ' ');
  A('Year: the Rent row reads 500 / 6,000', /\$500\s*\/\s*\$6,000/.test(row), row.slice(0, 120));
});
