'use strict';
/**
 * M8 (money audit 2026-10-09): an inventory write-off ('adjustment') must be expensed at its FIFO cost.
 * BUG: units went down but no cost was expensed, no GL entry was posted (the ledger kept the stock), and the
 * FIFO walk ignored the write-off, so the next sale was costed from layers already written off.
 * Seed (two layers at different prices so the bug changes every number — Rule 4):
 *   buy 4 @ 10 (June 1) · buy 6 @ 20 (June 2) · write off 4 (June 10) · sell 6 (June 20)
 *   correct: write-off cost 40 (the 4 @ 10 layer) · sale COGS 120 (6 @ 20) · total COGS 160 · inventory 0
 *   bug:     write-off cost 0 · sale COGS 80 (4 @ 10 + 2 @ 20) · total COGS 80 · ledger inventory 80
 */
const { run } = require('./moneyFixKit.js');

run('M8 — inventory write-offs are expensed at FIFO cost', async ({ newOwner, c, eq, A }) => {
  const { uid, J, http } = await newOwner('M8');
  const item = await J('POST', '/api/inventory', { sku: 'WO', name: 'Widget', units: 0, max_units: 100, cost: 10 });
  const p1 = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 4, unit_cost: 10, idempotency_key: 'm8-p1' });
  const p2 = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 6, unit_cost: 20, idempotency_key: 'm8-p2' });
  const wo = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'adjustment', quantity: 4, notes: 'damaged', idempotency_key: 'm8-wo' });
  eq('write-off is costed at the oldest layer (point of entry)', wo.cogs, 40, null);
  const { rows: [{ n: woGl }] } = await c.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE user_id=$1 AND source_type='inventory_movement' AND source_id=$2`, [uid, wo.id]);
  eq('write-off posts a ledger entry', woGl, 1, 0);
  const sale = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 6, idempotency_key: 'm8-s1' });
  eq('the sale after the write-off is costed from the remaining layer', sale.cogs, 120, 80);
  const bad = await http.post('/api/inventory-movements', { inventory_id: item.id, type: 'adjustment', quantity: -5, idempotency_key: 'm8-neg' });
  eq('a negative write-off (which would ADD stock) is refused', bad.status, 400);

  // Postgres NOW() is the real clock; the JS clock is pinned to 2026-07-25. Date the movements in June, then
  // rebuild the ledger from the documents (also exercises the backfill path for write-offs).
  for (const [id, d] of [[p1.id, '2026-06-01'], [p2.id, '2026-06-02'], [wo.id, '2026-06-10'], [sale.id, '2026-06-20']])
    await c.query(`UPDATE inventory_movements SET moved_at = $2::date + time '12:00' WHERE id = $1`, [id, d]);
  await J('POST', '/api/gl/backfill?reset=1', {});
  const rep = await J('GET', '/api/reports');
  eq('P&L COGS for the year (write-off 40 + sale 120)', rep.cogs, 160, 80);
  const cogsPage = await J('GET', '/api/cogs');
  const row = (cogsPage.breakdown || [])[0] || {};
  eq('COGS page: units sold 6, written off 4, write-off cost 40', [row.units_sold, row.units_written_off, row.write_off_cost], [6, 4, 40]);
  const bs = await J('POST', '/api/reports/balance-sheet', {});
  const inv = bs.inventory != null ? bs.inventory : (bs.assets && bs.assets.inventory);
  eq('balance-sheet inventory after selling out', inv, 0, 80);
  eq('balance sheet is GL-sourced (ledger and documents agree)', bs.source, 'gl');
  const units = (await J('GET', '/api/inventory')).find(i => i.id === item.id);
  eq('units on hand', Number(units && units.units), 0);
});
