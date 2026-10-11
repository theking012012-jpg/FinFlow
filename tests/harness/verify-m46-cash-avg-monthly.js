'use strict';
/**
 * M46 (money audit 2026-10-09): the cash card's "Avg monthly net" divides by the months that have HAPPENED.
 * BUG: it divided by the period's nominal length (Year = 12, Quarter = 3) — on 25 July, seven months of cash ÷ 12.
 * Seed: clientMoneyKit + a 700 cash sale (2026-03-15). Year cash: in 550 (payments) + 700 (receipt) · out 500 (rent)
 *   + 50 (stock bought) = net 700. Fiscal months so far (Jan…Jul) = 7.
 *   correct "$100" · bug "$58" (700 / 12). (On the pre-fix code the net itself was 750 — the stock purchase was
 *   missing from cash, M16 — so it measured $63 = 750 / 12.)
 */
const { run } = require('./clientMoneyKit.js');

run('M46 — cash card average over elapsed months', async ({ ev, text, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(40, 60);
  ev(`typeof updateCashflow==='function' && updateCashflow()`); await settle(10, 40);
  eq('Year cash net (control)', text('cf-net'), '$700');
  eq('Avg monthly net', text('cf-avg'), '$100', '$58');
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/sales-receipts', { customer: 'Walk-in', amount: 700, date: '2026-03-15', method: 'Cash', idempotency_key: 'm46-sr' });
  if (r.status >= 300) throw new Error('receipt ' + r.status + ' ' + r.text);
} });
