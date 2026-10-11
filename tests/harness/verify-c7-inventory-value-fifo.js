'use strict';
/**
 * C7 (Cowork end-to-end test): the Inventory page's value card shows the same figure as the Balance Sheet.
 * BUG: the card was units × the item's current cost field (Cowork: 5 × 15 = $75) while the Balance Sheet carried the
 * FIFO layers actually left (5 × 18 = $90). Two calculations of one figure.
 * Seed (Rule 4): clientMoneyKit Widget — bought 10 @ 5 (Jun 1), sold 4 (Jun 15) + 2 (Jul 10) — plus a second purchase
 *   of 10 @ 8 (Jun 20). The item's cost field stays 5.
 *   on hand 14 = 4 left of the first layer @ 5 (20) + 10 @ 8 (80) = 100     bug: 14 × 5 = 70
 */
const { run } = require('./clientMoneyKit.js');

run('C7 — inventory value is FIFO, one figure with the Balance Sheet', async ({ w, d, settle, eq, http }) => {
  const api = (await http.get('/api/cogs')).json || {};
  eq('server: stock on hand at FIFO cost', api.inventoryValue, 100, undefined);
  try { w.showPage('inventory'); } catch (_) {}
  await settle(30, 60);
  eq('Inventory page value card', (d.getElementById('inv-value') || {}).textContent, '$100', '$70');
}, { extraSeed: async ({ http }) => {
  const items = (await http.request('GET', '/api/inventory')).json || [];
  const wdg = items.find(i => i.name === 'Widget');
  const r = await http.request('POST', '/api/inventory-movements', { inventory_id: wdg.id, type: 'purchase', quantity: 10, unit_cost: 8, date: '2026-06-20', idempotency_key: 'c7-mv' });
  if (r.status >= 300) throw new Error('purchase ' + r.status + ' ' + r.text);
} });
