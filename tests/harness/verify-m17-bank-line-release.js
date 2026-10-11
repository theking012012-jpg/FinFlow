'use strict';
/**
 * M17 (money audit 2026-10-09): deleting the expense / payment a bank line was booked to must put the bank line
 * back in the reconciliation to-do list. BUG: the line stayed marked 'expense' / 'bill' forever — the money had
 * left the bank and was in no expense and no list.
 * Seed: bank debit 75 → "book as expense" → delete the expense ⇒ the 75 is back in unmatchedDebits (bug: gone).
 *       bank debit 120 → "match to bill" (bill 120) → delete the payment made ⇒ back in unmatchedDebits.
 *       Control: a booked line whose expense still exists stays matched.
 */
const { run } = require('./moneyFixKit.js');

run('M17 — deleting a booked expense / payment releases its bank line', async ({ newOwner, eq }) => {
  const { J, ids } = await newOwner('M17');
  const e = ids[0];
  const todo = async () => ((await J('GET', '/api/bank-reconciliation?entity_id=' + e)).unmatchedDebits || []).map(d => d.id);
  const b1 = await J('POST', '/api/banking?entity_id=' + e, { desc: 'OFFICE DEPOT', amount: 75, type: 'debit', date: '2026-07-10' });
  const bk1 = await J('POST', '/api/bank-reconciliation/book-expense', { banking_id: b1.id, category: 'Office' });
  const b3 = await J('POST', '/api/banking?entity_id=' + e, { desc: 'PRINTER INK', amount: 33, type: 'debit', date: '2026-07-12' });
  await J('POST', '/api/bank-reconciliation/book-expense', { banking_id: b3.id, category: 'Office' });
  eq('booked lines leave the to-do list', [(await todo()).includes(b1.id), (await todo()).includes(b3.id)], [false, false]);
  await J('DELETE', '/api/expenses/' + bk1.expense.id);
  eq('after the expense is deleted, the 75 bank debit is back in the to-do list', (await todo()).includes(b1.id), true, false);
  eq('control: a line whose expense still exists stays matched', (await todo()).includes(b3.id), false);

  const bill = await J('POST', '/api/bills', { vendor: 'Supplier', amount: 120, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-30', idempotency_key: 'm17-bill' });
  const b2 = await J('POST', '/api/banking?entity_id=' + e, { desc: 'SUPPLIER LTD', amount: 120, type: 'debit', date: '2026-07-11' });
  const mb = await J('POST', '/api/bank-reconciliation/match-bill', { banking_id: b2.id, bill_id: bill.id });
  eq('matched line leaves the to-do list', (await todo()).includes(b2.id), false);
  await J('DELETE', '/api/payments-made/' + mb.payment.id);
  eq('after the payment made is deleted, the 120 bank debit is back in the to-do list', (await todo()).includes(b2.id), true, false);
  // The released line can be actioned again (no stale idempotency marker left behind).
  const again = await J('POST', '/api/bank-reconciliation/book-expense', { banking_id: b1.id, category: 'Office' });
  eq('the released line can be booked again', !!(again.expense && again.expense.id) && !again.duplicate, true, false);
});
