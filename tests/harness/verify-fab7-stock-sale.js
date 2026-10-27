'use strict';
/**
 * FA-B7 (2026-10-27) — a Stock Out sale records what it sold for and to whom: its sales receipt (paid now) or invoice (on
 * credit) is made with the stock movement, numbered, linked to the customer and posted; a write-off books only the cost.
 *
 * BUG (read 2026-10-24, executed here on the old code): Stock Out took a quantity and a free-text reference only, so a
 * "sale" booked its cost of goods and NO revenue, customer or receivable — gross profit fell by the cost of every unit sold.
 *
 * Seed "B7 Co" (USD, terms unset → 30): Widget bought 4 @ 10 (2026-07-01) then 10 @ 20 (2026-07-02) — two cost layers.
 * Hand-computed:
 *   Sale A, paid now: 6 @ 35 to "Shop A" (2026-07-05) → sales receipt 210; FIFO cost 4×10 + 2×20 = 80
 *   Sale B, on credit: 3 @ 40 to "Shop B" (2026-07-06) → invoice 120, due 2026-08-05; FIFO cost 3×20 = 60
 *   Revenue 330 (bug: 0) · COGS 140 · gross profit 190 (bug: −140) · AR 120 (bug: 0)
 *   Write-off 1 → no document; units 14 − 6 − 3 − 1 = 4
 *   FA-B7b: a sale of 99 with 5 on hand → 400 "Only 5 in stock", no receipt, count still 5 (bug: 201, count 0)
 */
const { run } = require('./moneyFixKit.js');

run('FA-B7 — a stock-out sale makes its receipt / invoice; a write-off does not', async ({ newOwner, c, eq }) => {
  const { J, http, ids: [eid] } = await newOwner('B7');
  const item = await J('POST', '/api/inventory', { sku: 'W1', name: 'Widget', units: 0, max_units: 100, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 4, unit_cost: 10, date: '2026-07-01', idempotency_key: 'b7-p1' });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 20, date: '2026-07-02', idempotency_key: 'b7-p2' });
  const count = async t => (await c.query(`SELECT count(*)::int n FROM ${t} WHERE entity_id = $1`, [eid])).rows[0].n;

  const a = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 6, date: '2026-07-05', idempotency_key: 'b7-sa',
    sale: { price: 35, customer: 'Shop A', paid: 'now', method: 'Card' } });
  const b = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 3, date: '2026-07-06', idempotency_key: 'b7-sb',
    sale: { price: 40, customer: 'Shop B', paid: 'invoice' } });
  eq('1  sale A: FIFO cost 80 (4×10 + 2×20), sale B: 60 (3×20)', [Number(a.cogs), Number(b.cogs)], [80, 60]);
  const rA = a.sale ? (await c.query(`SELECT data FROM sales_receipts WHERE id = $1`, [a.sale.id])).rows[0].data : null;
  eq('1  sale A made a sales receipt: 210, Card, one line Widget × 6 @ 35, linked to the movement', rA ? [Number(rA.amount), rA.method, (rA.line_items || []).map(l => ({ desc: l.desc, qty: l.qty, rate: l.rate })), rA.inventory_movement_id] : null,
    [210, 'Card', [{ desc: 'Widget', qty: 6, rate: 35 }], a.id], null);
  const iB = b.sale ? (await c.query(`SELECT data FROM invoices WHERE id = $1`, [b.sale.id])).rows[0].data : null;
  eq('1  sale B made an invoice: 120, unpaid, due 2026-08-05 (issue + 30), numbered', iB ? [Number(iB.amount), iB.status, String(iB.due_date).slice(0, 10), /^INV-/.test(iB.number || '')] : null,
    [120, 'pending', '2026-08-05', true], null);
  const mvRef = (await c.query(`SELECT reference FROM inventory_movements WHERE id = $1`, [a.id])).rows[0].reference;
  eq('1  the movement\'s reference is the receipt\'s number', mvRef === (rA && rA.num) && !!mvRef, true, false);
  eq('1  the buyers are saved customers, linked', [(await c.query(`SELECT data->>'company' n FROM customers WHERE entity_id = $1 ORDER BY id`, [eid])).rows.map(r => r.n), rA && rA.customer_id != null, iB && iB.customer_id != null],
    [['Shop A', 'Shop B'], true, true], [[], false, false]);

  const rep = await J('GET', '/api/reports');
  eq('2  the books: revenue 330 · COGS 140 · gross profit 190', [rep.revenue, rep.cogs, Math.round((rep.revenue - rep.cogs) * 100) / 100], [330, 140, 190], [0, 140, -140]);
  const bs = await J('POST', '/api/reports/balance-sheet', {});
  eq('2  accounts receivable 120 (the on-credit sale)', bs.accountsReceivable, 120, 0);
  // The documents are in the LEDGER, not only in their tables (the report figures above would read the tables even if
  // the posting were skipped — a tamper that skipped it passed this harness before these two checks).
  const gl = (await c.query(`SELECT source_type, source_id FROM ledger_entries WHERE status = 'posted' AND ((source_type = 'sales_receipt' AND source_id = $1) OR (source_type = 'invoice' AND source_id = $2)) ORDER BY source_type`, [a.sale && a.sale.id, b.sale && b.sale.id])).rows.map(r => r.source_type);
  eq('2  the receipt and the invoice are posted to the ledger', gl, ['invoice', 'sales_receipt'], []);
  eq('2  the books tie: the balance sheet is served from the ledger (gate passed)', bs.source, 'gl', 'computeBooks');

  const docs0 = [await count('sales_receipts'), await count('invoices')];
  const units0 = (await c.query(`SELECT data->>'units' u FROM inventory WHERE id = $1`, [item.id])).rows[0].u;
  const noPrice = await http.request('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 1, date: '2026-07-07', sale: { price: 0, customer: 'Shop C', paid: 'now' } });
  eq('3  a sale with no price is refused, and nothing moves', [noPrice.status, (await c.query(`SELECT data->>'units' u FROM inventory WHERE id = $1`, [item.id])).rows[0].u], [400, units0], [201, String(Number(units0) - 1)]);
  const tooMany = await http.request('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 99, date: '2026-07-07', idempotency_key: 'b7-big', sale: { price: 5, customer: 'Shop C', paid: 'now' } });
  // FA-B7b: the server refuses a sale the stock cannot cover (old code: 201 — it sold 99 of 5 and clamped the count to 0).
  eq('3  a sale the stock cannot cover is refused (400, says what is on hand) AND leaves no receipt behind', [tooMany.status, /Only 5 in stock/.test(String(tooMany.text)), await count('sales_receipts'), await count('invoices')], [400, true, ...docs0], [201, false, docs0[0] + 1, docs0[1]]);
  eq('3  …and the stock count is untouched (5)', Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id = $1`, [item.id])).rows[0].u), 5, 0);
  const replay = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 6, date: '2026-07-05', idempotency_key: 'b7-sa', sale: { price: 35, customer: 'Shop A', paid: 'now', method: 'Card' } });
  eq('3  the same sale sent twice (same key) → one movement, one receipt', [replay.id, await count('sales_receipts')], [a.id, docs0[0]]);

  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'adjustment', quantity: 1, date: '2026-07-08', idempotency_key: 'b7-wo' });
  eq('4  a write-off makes no sales document; units 14 − 6 − 3 − 1 = 4', [await count('sales_receipts'), await count('invoices'), Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id = $1`, [item.id])).rows[0].u)], [...docs0, 4]);
});
