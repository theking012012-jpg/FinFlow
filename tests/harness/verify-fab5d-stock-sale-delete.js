'use strict';
/**
 * verify-fab5d-stock-sale-delete — FA-B5d (found 2026-11-01 building FA-B5c): a Stock Out SALE (FA-B7) makes its revenue
 * document with it — an invoice (on credit) or a sales receipt (paid now), linked by inventory_movement_id. Deleting that
 * document removed the revenue and LEFT the stock out and its COGS booked. Now the stock comes back with the delete, and
 * the product's later sales are re-costed. Real server, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fab5d-stock-sale-delete.js
 *
 * Seed (Rule 4): Gizmo 4 @ 10 (07-01) then 6 @ 30 (07-02). Sale A 3 on credit (07-10) = 3×10 = 30; sale B 2 paid now
 * (07-11) = 1×10 + 1×30 = 40; COGS 70, 5 on hand. Delete A's invoice → 8 on hand; B re-costed to 2×10 = 20 (old code:
 * 5 on hand, COGS 70). Delete B's receipt → 10 on hand, COGS 0 (old: 5, 70).
 */
const { runBrowser } = require('./browserKit.js');
runBrowser('FA-B5d — deleting a Stock Out sale\'s document puts the stock back', async ({ eq, A, J, http, c, uid }) => {
  const w = await J('POST', '/api/inventory', { name: 'Gizmo', qty: 0, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 4, unit_cost: 10, date: '2026-07-01', idempotency_key: 'p1' });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 6, unit_cost: 30, date: '2026-07-02', idempotency_key: 'p2' });
  const sA = await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'sale', quantity: 3, date: '2026-07-10', idempotency_key: 'sa', sale: { price: 25, customer: 'Ann', paid: 'invoice' } });
  const sB = await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'sale', quantity: 2, date: '2026-07-11', idempotency_key: 'sb', sale: { price: 25, customer: 'Bo', paid: 'now', method: 'Cash' } });
  const units = async () => Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id = $1`, [w.id])).rows[0].u);
  const cogs = async () => Number((await c.query(`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float s FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id WHERE l.user_id = $1 AND a.code = '5000'`, [uid])).rows[0].s);
  eq('premise: 5 on hand, COGS 30 + 40 = 70', [await units(), await cogs()], [5, 70]);
  eq('an invoice a Stock Out sale made cannot go back to draft (409)', (await http.put('/api/invoices/' + sA.sale.id, { status: 'draft' })).status, 409);
  eq('delete sale A\'s invoice → 200', (await http.del('/api/invoices/' + sA.sale.id)).status, 200);
  eq('…its 3 come back: 8 on hand', await units(), 8, 5);
  eq('…and B is re-costed to 2×10 = 20 (COGS 20)', await cogs(), 20, 70);
  eq('delete sale B\'s receipt → 200', (await http.del('/api/sales-receipts/' + sB.sale.id)).status, 200);
  eq('…10 on hand, COGS 0', [await units(), await cogs()], [10, 0], [5, 70]);
  const rc = (await http.get('/api/gl/reconcile-check')).json || {};
  A('GL reconcile check ok', rc.ok === true, JSON.stringify(rc.problems || rc).slice(0, 300));
}, {});
