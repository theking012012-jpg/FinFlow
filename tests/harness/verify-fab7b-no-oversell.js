'use strict';
/**
 * FA-B7b (found 2026-10-27 building FA-B7) — stock leaves only if it is on hand, checked at the write.
 *
 * BUG (executed): only the browser compared the quantity with the units on hand. The server took any sale or write-off:
 * 99 sold of 5 → 201, the count clamped to 0, and the FIFO cost covered only the 5 it had. Two sales racing for the last
 * units both went through.
 *
 * Seed: Widget bought 5 @ 10. Hand-computed:
 *   sale 99            → 400 "Only 5 in stock", count stays 5, no movement            (bug: 201, count 0)
 *   write-off 6        → 400, count stays 5                                          (bug: 201, count 0)
 *   two sales of 4, sent at once → exactly one 201 and one 400; count 1; one movement (bug: both 201, count 0)
 *   the same sale replayed with its key → the original returned, count still 1 (the decrement is undone)
 */
const { run } = require('./moneyFixKit.js');

run('FA-B7b — no sale or write-off beyond the stock on hand', async ({ newOwner, c, eq }) => {
  const { J, http } = await newOwner('B7b');
  const item = await J('POST', '/api/inventory', { sku: 'W1', name: 'Widget', units: 0, max_units: 100, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 5, unit_cost: 10, date: '2026-07-01', idempotency_key: 'b7b-p' });
  const units = async () => Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id = $1`, [item.id])).rows[0].u);
  const outs = async () => (await c.query(`SELECT count(*)::int n FROM inventory_movements WHERE inventory_id = $1 AND type <> 'purchase'`, [item.id])).rows[0].n;

  const big = await http.request('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 99, date: '2026-07-02' });
  eq('1  a sale of 99 with 5 on hand is refused, naming what is on hand', [big.status, /Only 5 in stock/.test(String(big.text))], [400, true], [201, false]);
  eq('1  …the count stays 5 and no movement is recorded', [await units(), await outs()], [5, 0], [0, 1]);
  const wo = await http.request('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'adjustment', quantity: 6, date: '2026-07-02' });
  eq('2  a write-off of 6 with 5 on hand is refused; count 5', [wo.status, await units()], [400, 5], [201, 0]);

  const [r1, r2] = await Promise.all([
    http.request('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 4, date: '2026-07-03', idempotency_key: 'b7b-r1' }),
    http.request('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 4, date: '2026-07-03', idempotency_key: 'b7b-r2' }),
  ]);
  eq('3  two sales of 4 sent at once: one goes through, one is refused (Rule 9 — the check is the write)', [r1.status, r2.status].sort(), [201, 400], [201, 201]);
  eq('3  …count 1, one movement', [await units(), await outs()], [1, 1], [0, 2]);
  const ok = r1.status === 201 ? r1 : r2, key = r1.status === 201 ? 'b7b-r1' : 'b7b-r2';
  const again = await http.request('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 1, date: '2026-07-03', idempotency_key: key });
  eq('4  the same sale replayed with its key returns the original; the count stays 1 (the decrement is undone)', [again.status < 300, again.json && again.json.id === ok.json.id, await units()], [true, true, 1], [true, true, 0]);
});
