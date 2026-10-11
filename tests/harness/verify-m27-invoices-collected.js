'use strict';
/**
 * M27 (money audit 2026-10-09): the Invoices page "% collected" has ONE writer, and "Total billed" is labelled for
 * what it covers.
 * BUG: two writers with two formulas — the Invoices writer (collected 550 ÷ billed 1,900 = 29%) and the dashboard
 * writer (550 ÷ (550 + net AR 1,270) = 30%) — so the card changed with whichever ran last; "Billed" (all-time)
 * carried the dashboard's period label.
 * Seed: clientMoneyKit (billed 1,900 · collected 550 · open credit note 80).
 *   correct: 29% after BOTH writers · label "All time, to date" in Month view
 *   bug: 29% then 30% · label "Jul 2026"
 */
const { run } = require('./clientMoneyKit.js');

run('M27 — one "% collected" writer; Billed labelled honestly', async ({ w, ev, text, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pMonth'),'month')`); await settle(30, 60);
  w.updateInvoices && w.updateInvoices(); await settle(5, 40);
  const a = text('inv-paid-pct');
  ev(`window._refreshDashboardUI && window._refreshDashboardUI()`); await settle(10, 50);
  const b = text('inv-paid-pct');
  eq('% collected after the Invoices writer, then after the dashboard refresh', [a, b], ['29% collected', '29% collected'], ['29% collected', '30% collected']);
  eq('"Total billed" label (Month view)', text('inv-billed-lbl'), 'All time, to date', 'Jul 2026');
});
