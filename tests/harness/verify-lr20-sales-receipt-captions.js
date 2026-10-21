'use strict';
/**
 * LR20 (live retest C2): Sales receipts card "CARD SALES $50 · Via Stripe" for a receipt recorded by hand with method
 * Card. Read (finflow-api-wiring-pages.js): Card Sales = Σ receipts whose method is card OR stripe (all time) — the
 * figure is right, the static caption "Via Stripe" is wrong. Same card row (Rule 13): Cash / Card / Refunds are
 * ALL-TIME sums while the first card counts "This month"; the captions never said so. Labels only; figures unchanged.
 *
 * clientMoneyKit seed + two receipts through the real route: Card 50 (manual), Cash 30 — dated June (not this month).
 *   1  Card Sales caption does not say "Via Stripe"; it says card (manual + Stripe), all time     bug: "Via Stripe"
 *   2  Cash Sales / Refunds captions say all time
 *   3  figures unchanged: Card $50, Cash $30, Total receipts this month 0 (both are June)          (control)
 */
const { run } = require('./clientMoneyKit.js');

run('LR20 — Sales receipt cards say what they add up', async ({ w, d, settle, eq, A, http }) => {
  await http.post('/api/sales-receipts', { customer: 'LR20 card', amount: 50, date: '2026-06-10', method: 'Card', idempotency_key: 'lr20-c' });
  await http.post('/api/sales-receipts', { customer: 'LR20 cash', amount: 30, date: '2026-06-11', method: 'Cash', idempotency_key: 'lr20-k' });
  try { w.showPage('sales-receipts'); } catch (_) {}
  await settle(40, 60);
  const cards = [...d.querySelectorAll('#page-sales-receipts .metrics-grid .mc')].map(mc => ({
    label: (mc.querySelector('.mc-label') || {}).textContent, val: (mc.querySelector('.mc-val') || {}).textContent, cap: ((mc.querySelector('.mc-change') || {}).textContent || '').trim() }));
  const by = l => cards.find(c => c.label === l) || {};
  A('1  Card Sales caption: card (manual + Stripe), all time — not "Via Stripe"', !/Via Stripe/.test(by('Card Sales').cap) && /card/i.test(by('Card Sales').cap) && /all time/i.test(by('Card Sales').cap), JSON.stringify(by('Card Sales').cap));
  A('2  Cash Sales caption says all time', /all time/i.test(by('Cash Sales').cap), JSON.stringify(by('Cash Sales').cap));
  A('2  Refunds caption says all time', /all time/i.test(by('Refunds').cap), JSON.stringify(by('Refunds').cap));
  eq('3  figures unchanged (Card $50 · Cash $30 · receipts this month 0)', [by('Card Sales').val, by('Cash Sales').val, by('Total Receipts').val], ['$50', '$30', '0']);
});
