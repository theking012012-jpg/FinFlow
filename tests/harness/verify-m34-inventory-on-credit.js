'use strict';
/**
 * M34 (fix pass round 2): a stock purchase can be ON CREDIT — it creates the supplier's bill, linked to the purchase, and
 * books Dr 1200 Inventory / Cr 2000 AP (the QuickBooks / Xero "bill with item lines" model). The cost reaches the P&L
 * ONCE, as COGS when the stock is sold — never also as an operating expense.
 * BUG: stock-in always credited Cash. A business that buys on credit also entered the supplier's bill (the normal
 * workflow), which booked the same cost again as an operating expense and took the cash out twice in the ledger.
 * Seed (Rule 4): Widget bought 10 @ 20 = 200 on credit from Supply Co on 2026-07-05 (due 2026-08-04); 4 sold
 *   2026-07-10 ⇒ COGS 80; the bill paid 200 on 2026-07-20.
 *   before payment: cash 0 (bug −200) · AP 200 (bug 0) · inventory 120 · July opex 0 · one linked bill 200
 *   after payment:  cash −200 · AP 0 · July opex still 0 (bug when the bill is entered too: 200) · bill paid
 *   tax deductions: COGS 80 only (bug with the bill entered too: 280)
 * M54 (found in this pass, same mechanism): a ledger REBUILD posted every purchase as Cr 1000 Cash — including OPENING
 *   stock, which the live path posts to 3100 Equity. Seed: an item opened with 5 @ 10 = 50.
 *   after a rebuild: cash −200 (bug −250) · the opening stock stays in equity
 */
const { run } = require('./moneyFixKit.js');

run('M34 — stock bought on credit books one bill, Dr Inventory / Cr AP, never opex', async ({ newOwner, c, eq, A, r2 }) => {
  const { uid, J, http } = await newOwner('M34');
  const item = await J('POST', '/api/inventory', { sku: 'W', name: 'Widget', units: 0, max_units: 100, cost: 20 });
  const buy = await http.post('/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 20, date: '2026-07-05',
    funding: 'bill', vendor: 'Supply Co', due_date: '2026-08-04', idempotency_key: 'm34-buy' });
  A('credit purchase accepted', buy.status === 201, buy.status + ' ' + buy.text);
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 4, date: '2026-07-10', idempotency_key: 'm34-sale' });

  const bal = async (code) => r2((await c.query(`SELECT COALESCE(SUM(ll.debit - ll.credit),0)::float AS b FROM ledger_lines ll JOIN ledger_accounts la ON la.id = ll.account_id
     JOIN ledger_entries le ON le.id = ll.entry_id WHERE ll.user_id = $1 AND la.code = $2 AND le.status = 'posted'`, [uid, code])).rows[0].b);
  const bills = async () => (await J('GET', '/api/bills')).filter(b => b.vendor === 'Supply Co');

  const b0 = await bills();
  eq('one supplier bill, linked to the purchase', b0.map(b => [r2(b.amount), b.status, String(b.issue_date).slice(0, 10), String(b.due_date).slice(0, 10), Number(b.inventory_movement_id) === Number(buy.json && buy.json.id)]),
    [[200, 'unpaid', '2026-07-05', '2026-08-04', true]], []);
  eq('cash before paying the supplier', await bal('1000'), 0, -200);
  eq('accounts payable owes the supplier', await bal('2000'), -200, 0);
  eq('inventory = 200 bought − 80 sold', await bal('1200'), 120);
  const july = await J('GET', '/api/reports?period=month&monthIdx=6');
  eq('July: COGS 80, operating expenses 0 (the stock is not an expense)', [july.cogs, july.expenses], [80, 0], [80, 200]);
  const bs = await J('POST', '/api/reports/balance-sheet', {});
  eq('balance sheet (ledger): cash 0, AP 200', [bs.source, r2(bs.cash), r2(bs.accountsPayable)], ['gl', 0, 200], ['gl', -200, 0]);

  // The bill is the purchase's — its amount and date come from the stock movement; it cannot be edited or deleted alone.
  const billId = b0[0] && b0[0].id;
  eq('amount edit on the purchase bill refused', (await http.put('/api/bills/' + billId, { amount: 999 })).status, 409, 200);
  eq('deleting the purchase bill refused', (await http.request('DELETE', '/api/bills/' + billId)).status, 409, 200);
  eq('vendor / due-date edit allowed', (await http.put('/api/bills/' + billId, { due_date: '2026-08-10' })).status, 200);
  eq('…and books no expense in the ledger (no 6000 entry)', await bal('6000'), 0, 200);

  // Paying it settles AP — never a second expense.
  await J('POST', '/api/payments-made', { vendor: 'Supply Co', amount: 200, date: '2026-07-20', bill_id: billId, idempotency_key: 'm34-pay' });
  eq('after paying: cash −200, AP 0', [await bal('1000'), await bal('2000')], [-200, 0]);
  const july2 = await J('GET', '/api/reports?period=month&monthIdx=6');
  eq('after paying: July operating expenses still 0', july2.expenses, 0, 200);
  eq('bill now paid', ((await bills())[0] || {}).status, 'paid');
  const tf = await J('GET', '/api/tax-filing?fyStart=0');
  eq('tax deductions: COGS 80 only', tf.deductions, 80, 280);

  // M54 + rebuild: opening stock stays in equity; the credit purchase keeps its AP contra.
  await J('POST', '/api/inventory', { sku: 'G', name: 'Gadget', units: 5, max_units: 100, cost: 10 });   // opening stock 50 → Cr 3100
  eq('live: opening stock is not cash', await bal('1000'), -200);
  await J('POST', '/api/gl/backfill?reset=1', {});
  eq('after a ledger rebuild: cash −200 (opening stock not cash, purchase on credit)', await bal('1000'), -200, -450);
  eq('after a ledger rebuild: AP 0, inventory 170', [await bal('2000'), await bal('1200')], [0, 170]);
  eq('after a ledger rebuild: no operating-expense entry for the purchase bill', await bal('6000'), 0, 200);
});
