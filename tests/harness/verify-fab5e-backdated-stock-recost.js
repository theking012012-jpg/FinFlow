'use strict';
/**
 * verify-fab5e-backdated-stock-recost — FA-B5e (found 2026-11-01, Rule 13 from FA-B5c): a stock movement entered LATE
 * but dated EARLIER (a backdated sale or purchase) changes the FIFO cost of the sales dated after it. The reports walk
 * FIFO by date (fifoItemSales), but each sale's ledger cost was fixed when it was entered — so the ledger's COGS landed
 * in the wrong months. Now every stock movement re-costs that product's sales by date (recostItemLedger).
 * Real server, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fab5e-backdated-stock-recost.js
 *
 * Seed (Rule 4): Part 4 @ 10 (06-01), 6 @ 30 (06-02). Sale X 4 dated 07-20 entered FIRST (cost 40); sale Y 2 dated
 * 06-15 entered SECOND. FIFO by date: Y (June) 2×10 = 20, X (July) 2×10 + 2×30 = 80.
 * Old code (entry order): Y 2×30 = 60 in June, X 40 in July — the year agrees (100), the months do not.
 */
const { runBrowser } = require('./browserKit.js');
runBrowser('FA-B5e — a backdated stock movement re-costs the sales after it', async ({ eq, A, J, http, c, uid }) => {
  const w = await J('POST', '/api/inventory', { name: 'Part', qty: 0, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 4, unit_cost: 10, date: '2026-06-01', idempotency_key: 'p1' });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 6, unit_cost: 30, date: '2026-06-02', idempotency_key: 'p2' });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'sale', quantity: 4, date: '2026-07-20', idempotency_key: 'x' });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'sale', quantity: 2, date: '2026-06-15', idempotency_key: 'y' });
  const glMonth = async (ym) => Number((await c.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float s FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id JOIN ledger_entries e ON e.id = l.entry_id
      WHERE l.user_id = $1 AND a.code = '5000' AND to_char(e.entry_date, 'YYYY-MM') = $2`, [uid, ym])).rows[0].s);
  eq('ledger COGS in June = Y at 2×10 = 20', await glMonth('2026-06'), 20, 60);
  eq('ledger COGS in July = X at 2×10 + 2×30 = 80', await glMonth('2026-07'), 80, 40);
  // a backdated PURCHASE moves later costs too: 2 more @ 5 dated 05-31 become the oldest layer
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 2, unit_cost: 5, date: '2026-05-31', idempotency_key: 'p0' });
  eq('after a backdated purchase (2 @ 5 on 05-31): June Y = 2×5 = 10', await glMonth('2026-06'), 10, 60);
  eq('…July X = 4×10 = 40', await glMonth('2026-07'), 40, 40);
  const rc = (await http.get('/api/gl/reconcile-check')).json || {};
  A('GL reconcile check ok', rc.ok === true, JSON.stringify(rc.problems || rc).slice(0, 300));
}, {});
