'use strict';
/**
 * verify-la5-inventory-row-value.js — LA5 (live audit 2026-10-13 M2): Inventory value card $90 but the only SKU's row
 * $75. C7 moved the CARD to FIFO; each ROW still multiplied units by the item's current cost field.
 *
 * Real SPA in jsdom, real scratch Postgres. Seed (Rule 4 — each item's bug value differs from its FIFO value, and
 * the two items differ from each other):
 *   Widget (clientMoneyKit) — bought 10 @ 5 (Jun 1), sold 4 (Jun 15) + 2 (Jul 10); plus 10 @ 8 (Jun 20). cost field 5.
 *     on hand 14 = 4 @ 5 (20) + 10 @ 8 (80) = 100                 bug: 14 × 5 = 70
 *   Gadget — created with cost field 9, 0 units; bought 3 @ 7 (Jul 1).
 *     on hand 3 @ 7 = 21                                          bug: 3 × 9 = 27
 *   Card = 121; rows add up to the card (bug rows: 70 + 27 = 97 under a card of 121).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la5-inventory-row-value.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA5 — each inventory row shows its FIFO stock value, adding up to the card', async ({ w, d, settle, eq, http }) => {
  const api = (await http.get('/api/cogs')).json || {};
  eq('server: total stock value (FIFO)', api.inventoryValue, 121);
  const items = (await http.get('/api/inventory')).json || [];
  const byName = n => (items.find(i => i.name === n) || {}).id;
  eq('server: per-item values', api.inventoryValueByItem && [api.inventoryValueByItem[byName('Widget')], api.inventoryValueByItem[byName('Gadget')]], [100, 21], undefined);

  w.showPage('inventory');
  await settle(40, 60);
  eq('card', (d.getElementById('inv-value') || {}).textContent, '$121');
  const rows = [...d.querySelectorAll('#inventory-list .inv-item-row')].map(r => {
    const s = r.querySelectorAll(':scope > span');
    return [s[1].textContent.trim(), s[3].textContent.trim()];
  }).sort();
  eq('rows: Widget $100, Gadget $21', rows, [['Gadget', '$21'], ['Widget', '$100']], [['Gadget', '$27'], ['Widget', '$70']]);
}, { extraSeed: async ({ http }) => {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
  const wdg = (await J('GET', '/api/inventory')).find(i => i.name === 'Widget');
  await J('POST', '/api/inventory-movements', { inventory_id: wdg.id, type: 'purchase', quantity: 10, unit_cost: 8, date: '2026-06-20', idempotency_key: 'la5-w' });
  const g = await J('POST', '/api/inventory', { sku: 'G1', name: 'Gadget', units: 0, max_units: 100, cost: 9 });
  await J('POST', '/api/inventory-movements', { inventory_id: g.id, type: 'purchase', quantity: 3, unit_cost: 7, date: '2026-07-01', idempotency_key: 'la5-g' });
} });
