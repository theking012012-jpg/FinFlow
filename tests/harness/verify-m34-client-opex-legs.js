'use strict';
/**
 * M34 (fix pass round 2), BROWSER legs: a stock purchase's bill (inventory_movement_id) is never an operating expense on
 * any client surface — the expense breakdown (computeExpenseBreakdown), the provisional KPI cards and the provisional
 * monthly arrays. /api/reports is FAILED (jsdomBoot failMap) so the figures on screen are the browser's own.
 * Seed: clientMoneyKit (ordinary bill 400, July opex 2,900) + a stock-purchase bill 200 dated 2026-07-05.
 *   issued bills (opex)  400        (bug 600)
 *   Year expenses card   $2.9K      (bug $3.1K)
 *   AI July vs June from the arrays: (520 − 2,900) vs 300 ⇒ "down 893%"   (bug (520 − 3,100) ⇒ "down 960%")
 */
const { run } = require('./clientMoneyKit.js');

run('M34 — client opex legs exclude a stock purchase bill', async ({ w, ev, all, text, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(30, 60);
  eq('expense breakdown: issued bills (opex)', ev(`computeExpenseBreakdown('year').issuedBills`), 400, 600);
  eq('Year expenses card (provisional)', text('d-exp'), '$2.9K', '$3.1K');
  ev(`setPeriod(document.getElementById('pMonth'),'month')`); await settle(40, 60);
  w.updateAI && w.updateAI(); await settle(5, 40);
  const ai = all('ai-insights-list') || '';
  eq('AI July "vs last month" from the browser-built arrays', (ai.match(/(up|down) (\d+)% vs last month/) || []).slice(1), ['down', '893'], ['down', '960']);
}, { failMap: { '/api/reports': 500 }, extraSeed: async ({ client, userId }, { ent }) => {
  await client.query(`INSERT INTO bills (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [userId, ent,
    { vendor: 'Stock Supplier', amount: 200, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-05', due_date: '2026-08-04', inventory_movement_id: 999, notes: 'Stock purchase' }]);
} });
