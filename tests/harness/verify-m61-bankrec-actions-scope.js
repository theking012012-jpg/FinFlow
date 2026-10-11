'use strict';
/**
 * M61 (personal/business wall, 2026-10-11): every bank-reconcile ACTION acts only on a bank line of the business in
 * view. M57 limited match / match-batch; the other actions were not limited.
 * BUG:
 *   - book-expense / match-bill looked the line up by user only. From business A, business B's bank line could be booked
 *     as an expense, or matched to B's bill, into B's books (the expense takes the line's own business).
 *   - ignore had no scope check at all: from a business it stamped reconcile_state 'ignored' on a PERSONAL bank line
 *     (business → personal write) or on another business's line.
 *   - unmatch (DELETE /api/bank-reconciliation/:id) deleted any of the user's matches, another business's included.
 * Seed (Rule 4 — every amount differs, and each action gets its OWN line, so one wrong action cannot mask the next):
 *   businesses A (in view) and B. B: bank debits 140 / 155 / 170 · B: bill 155 · B: bank credit 220 matched to B's
 *   invoice payment 220 · Personal: bank line 65 · A: bank debit 90 (control)
 *   from A: book-expense(B 140) → 404           bug 200 and an expense of 140 in B
 *           match-bill(B 155 ↔ B bill 155) → 404 bug 200 and a payment of 155 on B's bill
 *           ignore(personal 65) → refused       bug 200 and the personal line stamped 'ignored'
 *           ignore(B 170) → 404                 bug 200 and B's line stamped 'ignored'
 *           unmatch(B's 220 match) → 404        bug 200 and the match gone
 *   controls: A books its own 90 (200, expense in A); B ignores / unmatches its own (200); personal → PERSONAL_TXN
 */
const { run } = require('./moneyFixKit.js');

run('M61 — bank-reconcile actions stay inside the business in view', async ({ newOwner, c, eq, A }) => {
  const o = await newOwner('M61', [{ name: 'A Co', currency: 'USD' }, { name: 'B Co', currency: 'USD' }]);
  const [eA, eB] = o.ids;
  const qa = '?entity_id=' + eA, qb = '?entity_id=' + eB;
  const lineB = await o.J('POST', '/api/banking' + qb, { desc: 'B SUPPLIER', amount: 140, type: 'debit', date: '2026-07-10' });
  const lineB2 = await o.J('POST', '/api/banking' + qb, { desc: 'B BILL PAY', amount: 155, type: 'debit', date: '2026-07-10' });
  const lineB3 = await o.J('POST', '/api/banking' + qb, { desc: 'B FEE', amount: 170, type: 'debit', date: '2026-07-10' });
  const billB = await o.J('POST', '/api/bills' + qb, { vendor: 'B Supplier', amount: 155, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-30', idempotency_key: 'm61-bill' });
  const lineA = await o.J('POST', '/api/banking' + qa, { desc: 'A STATIONERY', amount: 90, type: 'debit', date: '2026-07-11' });
  const pers = await o.J('POST', '/api/banking?scope=personal', { desc: 'PERSONAL CAFE', amount: 65, type: 'debit', date: '2026-07-12' });
  const invB = await o.J('POST', '/api/invoices' + qb, { client: 'B Cust', amount: 220, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-30', idempotency_key: 'm61-inv' });
  const payB = await o.J('POST', '/api/invoice-payments' + qb, { invoice_id: invB.id, amount: 220, payment_date: '2026-07-05', idempotency_key: 'm61-pay' });
  const credB = await o.J('POST', '/api/banking' + qb, { desc: 'B DEPOSIT', amount: 220, type: 'credit', date: '2026-07-06' });
  const mB = await o.J('POST', '/api/bank-reconciliation/match' + qb, { banking_id: credB.id, invoice_payment_id: payB.id });

  const post = (q, p, b) => o.http.post('/api/bank-reconciliation/' + p + q, b);
  const state = async id => ((await c.query(`SELECT data->>'reconcile_state' AS s FROM personal_transactions WHERE id=$1`, [id])).rows[0] || {}).s || null;
  const n = async (sql, p) => (await c.query(sql, p)).rows[0].n;

  eq("A books B's bank line as an expense: refused", (await post(qa, 'book-expense', { banking_id: lineB.id })).status, 404, 200);
  eq('…no expense created in B', await n(`SELECT COUNT(*)::int AS n FROM expenses WHERE user_id=$1 AND entity_id=$2`, [o.uid, eB]), 0, 1);
  eq("A matches B's bank line to B's bill: refused", (await post(qa, 'match-bill', { banking_id: lineB2.id, bill_id: billB.id })).status, 404, 200);
  eq("…no payment on B's bill", await n(`SELECT COUNT(*)::int AS n FROM payments_made WHERE user_id=$1 AND data->>'bill_id'=$2`, [o.uid, String(billB.id)]), 0, 1);
  const ip = await post(qa, 'ignore', { banking_id: pers.id });
  eq('A ignores a PERSONAL bank line: refused', ip.status >= 400, true, false);
  eq('…refused as personal', ip.json && ip.json.code, 'PERSONAL_TXN', undefined);
  eq('…the personal line is untouched', await state(pers.id), null, 'ignored');
  eq("A ignores B's bank line: refused", (await post(qa, 'ignore', { banking_id: lineB3.id })).status, 404, 200);
  eq("…B's line is untouched", await state(lineB3.id), null, 'ignored');
  eq("…and B's other lines too", [await state(lineB.id), await state(lineB2.id)], [null, null], ['expense', 'bill']);
  eq("A unmatches B's match: refused", (await o.http.request('DELETE', '/api/bank-reconciliation/' + mB.id + qa)).status, 404, 200);
  eq("…B's match still exists", await n(`SELECT COUNT(*)::int AS n FROM bank_reconciliation WHERE id=$1`, [mB.id]), 1, 0);

  // Controls — each business acts on its own lines; a personal line is refused as personal everywhere.
  eq('control: A books its own line', (await post(qa, 'book-expense', { banking_id: lineA.id })).status, 200);
  eq('control: …the expense is in A (90)', Number((await c.query(`SELECT data->>'amount' AS a FROM expenses WHERE user_id=$1 AND entity_id=$2`, [o.uid, eA])).rows.map(r => r.a)), 90);
  eq('control: A books a personal line → PERSONAL_TXN', ((await post(qa, 'book-expense', { banking_id: pers.id })).json || {}).code, 'PERSONAL_TXN');
  eq('control: B ignores its own line', (await post(qb, 'ignore', { banking_id: lineB3.id })).status, 200);
  eq('control: B unmatches its own match', (await o.http.request('DELETE', '/api/bank-reconciliation/' + mB.id + qb)).status, 200);
  // The browser sends no entity_id — the server resolves the ACTIVE business (A, activated by newOwner).
  const lineA2 = await o.J('POST', '/api/banking' + qa, { desc: 'A BANK FEE', amount: 12, type: 'debit', date: '2026-07-13' });
  eq("control: the browser's call (no entity_id) ignores the active business's line", (await o.http.post('/api/bank-reconciliation/ignore', { banking_id: lineA2.id })).status, 200);
  eq("control: …and still refuses B's line", (await o.http.post('/api/bank-reconciliation/book-expense', { banking_id: lineB.id })).status, 404, 200);
});
