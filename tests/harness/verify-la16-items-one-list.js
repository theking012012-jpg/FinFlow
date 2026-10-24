'use strict';
/**
 * verify-la16-items-one-list.js — LA16 (HANDOVER C19 Items; owner decision 2026-10-14: ONE product list). Items is
 * the catalogue (`items` table) and stock lives on Inventory (`inventory` table), so a business with stock but no
 * catalogue entries read "0 items". Items now also lists each stocked product as a read-only "Stock item" row that
 * opens Inventory. A product that is in both (same SKU) is listed once — as the catalogue item.
 *
 * Real SPA, real scratch Postgres, clientMoneyKit seed (clock 2026-07-25): inventory Widget (W1, 4 units on hand).
 * Extra seed: inventory Gadget (G1, 0 units → low stock); catalogue items "Consulting" (Service, 150) and
 * "Gadget" (Product, sku G1, 25).
 *   All      → Consulting, Gadget (catalogue), Widget (stock)  = 3   bug: 2 (no Widget)
 *   Products → Gadget, Widget                                         bug: Gadget only
 *   Services → Consulting
 *   Low stock card: Widget (4 units) + Gadget (0 of 50) = 2 — G5 (2026-10-24): the card is Inventory's low-stock
 *   alerts, ONE rule (FinFlowDates.isLowStock); it used to count only stock-only rows below 10 (1), missing Gadget,
 *   which is low but listed as its catalogue item.                  bug: 0 (catalogue items carry no stock)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la16-items-one-list.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA16 — Items lists stocked products too (one product list)', async ({ w, d, all, settle, eq }) => {
  w.showPage('items');
  await settle(40, 50);
  const rows = () => [...d.querySelectorAll('#items-list .table-row')].map(r => [
    r.children[0].childNodes[0].textContent.trim(), r.children[1].textContent.trim(), r.children[3].textContent.trim()]).sort();
  eq('Total Items', all('items-total'), '3', '2');
  eq('All: catalogue items + the stock-only product, Gadget once', rows(),
    [['Consulting', 'Service', '—'], ['Gadget', 'Product', '—'], ['Widget', 'Stock item', '4 units']],
    [['Consulting', 'Service', '—'], ['Gadget', 'Product', '—']]);
  eq('Low Stock card = the Inventory low-stock alerts (Widget, Gadget)', all('items-lowstock'), '2', '0');
  w.filterItems('product'); await settle(5, 30);
  eq('Products filter includes the stock item', rows().map(r => r[0]), ['Gadget', 'Widget'], ['Gadget']);
  w.filterItems('service'); await settle(5, 30);
  eq('Services filter', rows().map(r => r[0]), ['Consulting']);
  w.filterItems('all'); await settle(5, 30);
  const btn = [...d.querySelectorAll('#items-list .table-row')].find(r => /Widget/.test(r.textContent)).querySelector('button');
  btn.click(); await settle(10, 40);
  eq('the stock row opens Inventory', d.getElementById('page-inventory').classList.contains('active'), true);
}, { extraSeed: async ({ http }) => {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
  await J('POST', '/api/inventory', { sku: 'G1', name: 'Gadget', units: 0, max_units: 50, cost: 9 });
  await J('POST', '/api/items', { name: 'Consulting', type: 'Service', price: 150, unit: 'hr', status: 'Active' });
  await J('POST', '/api/items', { name: 'Gadget', type: 'Product', price: 25, unit: 'ea', sku: 'G1', status: 'Active' });
} });
