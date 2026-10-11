'use strict';
/**
 * M43 (money audit 2026-10-09): the 13-week forecast nets open credits and counts orphan payments in its run-rate.
 * BUG: AR / AP were gross of credit notes / vendor credits, and the opex run-rate ignored payments made with no bill.
 * Seed (today pinned 2026-07-25):
 *   invoices 1,000 (due 08-10) + 400 (due 08-20) · open credit note 300 (07-01)  → AR in 700 + 400 = 1,100 (bug 1,400)
 *   bill 500 (due 08-15) · open vendor credit 120 (07-01)                        → AP out 380 (bug 500)
 *   expense 90 (07-01) + orphan payment made 270 (07-10) in the last 90 days     → 360/90×7 = 28/week × 13 = 364 (bug 91)
 */
const { run } = require('./moneyFixKit.js');

run('M43 — forecast nets credits and counts orphan payments', async ({ newOwner, eq }) => {
  const { J } = await newOwner('M43');
  await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-07-05', due_date: '2026-08-10', idempotency_key: 'm43-i1' });
  await J('POST', '/api/invoices', { client: 'Beta', amount: 400, status: 'pending', issue_date: '2026-07-06', due_date: '2026-08-20', idempotency_key: 'm43-i2' });
  await J('POST', '/api/credit-notes', { customer: 'Acme', amount: 300, date: '2026-07-01', status: 'Open', idempotency_key: 'm43-cn' });
  await J('POST', '/api/bills', { vendor: 'Supplier', amount: 500, status: 'unpaid', issue_date: '2026-07-02', due_date: '2026-08-15', idempotency_key: 'm43-b' });
  await J('POST', '/api/vendor-credits', { vendor: 'Supplier', amount: 120, date: '2026-07-01', status: 'Open', idempotency_key: 'm43-vc' });
  await J('POST', '/api/expenses', { description: 'Fuel', category: 'Travel', amount: 90, expense_date: '2026-07-01', idempotency_key: 'm43-e' });
  await J('POST', '/api/payments-made', { vendor: 'Courier', amount: 270, date: '2026-07-10', idempotency_key: 'm43-pm' });
  const f = await J('GET', '/api/cashflow-forecast');
  const items = (f.periods || []).flatMap(p => p.items || []);
  const sum = (dir, kind) => Math.round(items.filter(i => i.direction === dir && i.kind === kind).reduce((s, i) => s + i.amount, 0) * 100) / 100;
  eq('AR inflow net of the open credit note', sum('in', 'ar'), 1100, 1400);
  eq('AP outflow net of the open vendor credit', sum('out', 'ap'), 380, 500);
  eq('opex run-rate includes the orphan payment made', sum('out', 'opex_estimate'), 364, 91);
});
