'use strict';
/**
 * M30 (money audit 2026-10-09): the Health Score "Receivables" sub-score = collected ÷ billed over RECOGNISED invoices.
 * BUG: Σ face of status-'paid' invoices ÷ Σ of EVERY invoice (drafts and future-dated included), part-payments ignored.
 * Seed (clientMoneyKit): issued 1,000 (Jan) + 600 (Jul, 250 paid) + 300 (Jun, paid) = 1,900 billed, 550 collected;
 *   a 9,999 DRAFT. correct 550/1,900 = 29/100 · bug 300/11,899 = 3/100
 */
const { run } = require('./clientMoneyKit.js');

run('M30 — Health receivables over recognised invoices', async ({ w, ev, text, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(30, 60);
  w.updateHealthScore && w.updateHealthScore(); await settle(5, 40);
  eq('Health "Receivables"', text('hs-rec-v'), '29/100', '3/100');
});
