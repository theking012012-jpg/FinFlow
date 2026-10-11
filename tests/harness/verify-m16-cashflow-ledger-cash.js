'use strict';
/**
 * M16 (money audit 2026-10-09): the Cash Flow report must include cash that moves with no document it reads.
 * BUG: a stock purchase posts Dr Inventory / Cr Cash; the balance sheet's cash included it, the Cash Flow report
 * did not — so "cash out" understated by every inventory purchase.
 * Seed (June 2026): invoice 500 paid 500 (in) · expense 30 (out) · stock bought 10 @ 7 = 70 (out)
 *   correct: in 500 · out 100 · net 400 == balance-sheet cash 400
 *   bug:     in 500 · out 30  · net 470 (≠ balance-sheet cash 400)
 * Only Cash (1000) lines are read, so opening stock (contra equity 3100) never counts as cash.
 */
const { run } = require('./moneyFixKit.js');

run('M16 — Cash Flow report includes inventory purchases', async ({ newOwner, c, eq }) => {
  const { uid, J } = await newOwner('M16');
  const inv = await J('POST', '/api/invoices', { client: 'Acme', amount: 500, status: 'pending', issue_date: '2026-06-02', due_date: '2026-06-30', idempotency_key: 'm16-inv' });
  await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 500, payment_date: '2026-06-05', idempotency_key: 'm16-pay' });
  await J('POST', '/api/expenses', { description: 'Fuel', category: 'Travel', amount: 30, deductible: 'yes', expense_date: '2026-06-06', idempotency_key: 'm16-exp' });
  const item = await J('POST', '/api/inventory', { sku: 'S', name: 'Stock', units: 0, max_units: 100, cost: 7 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 7, idempotency_key: 'm16-buy' });
  // Postgres NOW() is the real clock; date the purchase in June and rebuild the ledger from the documents.
  await c.query(`UPDATE inventory_movements SET moved_at = '2026-06-08T12:00:00Z' WHERE user_id = $1`, [uid]);
  await J('POST', '/api/gl/backfill?reset=1', {});
  const cf = await J('POST', '/api/reports/cash-flow', {});
  eq('cash in / out', [cf.totalInflow, cf.totalOutflow], [500, 100], [500, 30]);
  const bs = await J('POST', '/api/reports/balance-sheet', {});
  eq('balance-sheet cash (control)', bs.cash, 400);
  eq('cash-flow net equals balance-sheet cash', Math.round((cf.totalInflow - cf.totalOutflow) * 100) / 100, bs.cash, 470);
});
