'use strict';
/**
 * M28 (money audit 2026-10-09): AI quarter label, period-true "top client", and cash-card source shares.
 * BUG: the quarter insight hard-coded fiscal months 9–11 ("Oct–Dec"); "top client this month/quarter" was the
 * ALL-TIME ranking divided by the period's revenue (it can exceed 100%); the cash card's sources did the same.
 * Seed (clientMoneyKit, today 2026-07-25 = Q3): Acme Ltd invoices Jan 1,000 + Jul 600; Beta Co Jun 300.
 *   Q3 sales: Acme 600 only. correct: "Jul 2026–Sep 2026 revenue" · "Top client this quarter: Acme Ltd at $600
 *   (100% of this quarter's sales)" · cash card (Year) sources Acme 1,600 / Beta 300 → 84% / 16%
 *   bug: "Oct 2026–Dec 2026" · "Acme Ltd at $1,600 (308% of revenue)" (1,600 / Q3 revenue 520)
 */
const { run } = require('./clientMoneyKit.js');

run('M28 — AI quarter label and period-true top client', async ({ w, ev, all, settle, eq, d }) => {
  ev(`setPeriod(document.getElementById('pQ'),'quarter')`); await settle(30, 60);
  w.updateAI && w.updateAI(); await settle(5, 40);
  const ai = all('ai-insights-list') || '';
  eq('quarter insight names Q3', (ai.match(/^(\w+ \d{4})–(\w+ \d{4}) revenue/) || []).slice(1), ['Jul 2026', 'Sep 2026'], ['Oct 2026', 'Dec 2026']);
  eq('top client this quarter (Q3 sales only)', (ai.match(/Top client this quarter: (.+?) at (\$[0-9,]*[0-9]) \((\d+)%/) || []).slice(1), ['Acme Ltd', '$600', '100'], ['Acme Ltd', '$1,600', '308']);
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(30, 60);
  ev(`typeof updateCashflow==='function' && updateCashflow()`); await settle(5, 40);
  const widths = Array.from(d.querySelectorAll('#cf-sources .bar-fill')).map(e => e.style.width);
  eq('cash card source shares (Year: Acme 1,600 / Beta 300 of 1,900 sales)', widths, ['84%', '16%']);
});
