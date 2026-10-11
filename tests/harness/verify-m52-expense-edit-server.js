'use strict';
/**
 * M52 (fix pass round 2), SERVER leg: an expense edit is validated like a create, moves the books and the ledger, and
 * cannot silently break a bank reconciliation.
 * BUG (as EXECUTED): an edit to an amount of 0 or a blank description was stored and booked; a create with an amount
 * of 0 was booked; an expense booked from a bank line could have its amount changed so the expense and the bank line
 * disagreed while both stayed "matched". (Negative amounts and impossible dates were already refused by the
 * body-shape check on every write — kept here as controls.)
 * Seed (June / July 2026, clock 2026-07-25):
 *   Rent 100 dated 2026-06-10, edited to 160 dated 2026-07-02 ⇒ June opex 0, July opex 160, ledger 160 on 2026-07-02
 *   bank line 75 booked as an expense ⇒ amount edit 409 (bug 200); description edit 200
 */
const { run } = require('./moneyFixKit.js');

run('M52 — expense edits: validated, booked, reconciliation-safe', async ({ newOwner, c, eq, A }) => {
  const { uid, J, http, ids } = await newOwner('M52');
  const e = await J('POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 100, deductible: 'yes', expense_date: '2026-06-10', idempotency_key: 'm52-rent' });

  // Valid edit moves the figure between periods and re-posts the ledger.
  const ok = await http.put('/api/expenses/' + e.id, { amount: 160, expense_date: '2026-07-02' });
  eq('valid edit accepted', ok.status, 200);
  const june = await J('GET', '/api/reports?period=month&monthIdx=5'), july = await J('GET', '/api/reports?period=month&monthIdx=6');
  eq('June opex after moving the expense out', june.expenses, 0, 100);
  eq('July opex after moving the expense in', july.expenses, 160, 0);
  const { rows: gl } = await c.query(`SELECT le.entry_date::text AS d, SUM(ll.debit)::float AS dr FROM ledger_entries le JOIN ledger_lines ll ON ll.entry_id = le.id
     WHERE le.user_id=$1 AND le.source_type='expense' AND le.source_id=$2 AND le.status='posted' GROUP BY 1`, [uid, e.id]);
  eq('ledger entry re-dated and re-valued', gl.map(r => [r.d, r.dr]), [['2026-07-02', 160]], [['2026-06-10', 100]]);

  // Invalid edits are refused and change nothing.
  eq('edit to a negative amount refused (control: body-shape already refused it)', (await http.put('/api/expenses/' + e.id, { amount: -50 })).status, 400);
  eq('edit to a zero amount refused', (await http.put('/api/expenses/' + e.id, { amount: 0 })).status, 400, 200);
  eq('edit to an impossible date refused (control: body-shape already refused it)', (await http.put('/api/expenses/' + e.id, { expense_date: '2026-13-45' })).status, 400);
  eq('edit to an empty description refused', (await http.put('/api/expenses/' + e.id, { description: '   ' })).status, 400, 200);
  const after = (await J('GET', '/api/expenses')).find(x => x.id === e.id);
  eq('the stored expense is unchanged by the refused edits', [Number(after.amount), String(after.expense_date).slice(0, 10), after.description], [160, '2026-07-02', 'Rent']);

  // Create uses the same rules.
  eq('create with a zero amount refused', (await http.post('/api/expenses', { description: 'Zero', amount: 0, expense_date: '2026-07-03' })).status, 400, 201);
  eq('create with a malformed date refused (control: body-shape already refused it)', (await http.post('/api/expenses', { description: 'Bad date', amount: 10, expense_date: 'banana' })).status, 400);

  // An expense matched to a bank line keeps the bank's amount.
  const line = await J('POST', '/api/banking?entity_id=' + ids[0], { desc: 'OFFICE DEPOT', amount: 75, type: 'debit', date: '2026-07-10' });
  const bk = await J('POST', '/api/bank-reconciliation/book-expense', { banking_id: line.id, category: 'Office' });
  const bkId = (bk.expense && bk.expense.id) || bk.expense_id || bk.id;
  A('bank line booked as an expense', !!bkId, JSON.stringify(bk));
  eq('amount edit on a bank-matched expense refused', (await http.put('/api/expenses/' + bkId, { amount: 90 })).status, 409, 200);
  eq('description edit on a bank-matched expense allowed', (await http.put('/api/expenses/' + bkId, { description: 'Office Depot — toner' })).status, 200);
});
