'use strict';
/**
 * M50 (money audit 2026-10-09): deleting a business removes its ledger with it.
 * BUG: its documents cascaded away, but its ledger entries / lines / accounts stayed, orphaned.
 * Seed: Real Co (invoice 1,000) + Test Co (invoice 9,999 paid 9,999; bill 400). Delete Test Co.
 *   correct: 0 ledger entries / lines / accounts left for Test Co · Real Co untouched (its entry still there,
 *            revenue 1,000, balance sheet GL-sourced)
 *   bug: Test Co's ledger entries remain (≥ 3: invoice, payment, bill)
 */
const { run } = require('./moneyFixKit.js');

run('M50 — deleting a business removes its ledger', async ({ newOwner, c, eq }) => {
  const { uid, J, ids } = await newOwner('M50', [{ name: 'Real Co', currency: 'USD' }, { name: 'Test Co', currency: 'USD' }]);
  const [real, test] = ids;
  await J('POST', '/api/invoices', { client: 'Real client', amount: 1000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-30', idempotency_key: 'm50-r' });
  await J('POST', '/api/entities/' + test + '/activate', {});
  const ti = await J('POST', '/api/invoices', { client: 'Test client', amount: 9999, status: 'pending', issue_date: '2026-07-02', due_date: '2026-07-30', idempotency_key: 'm50-t' });
  await J('POST', '/api/invoice-payments', { invoice_id: ti.id, amount: 9999, payment_date: '2026-07-03', idempotency_key: 'm50-tp' });
  await J('POST', '/api/bills', { vendor: 'Test vendor', amount: 400, status: 'unpaid', issue_date: '2026-07-04', due_date: '2026-07-30', idempotency_key: 'm50-tb' });
  await J('POST', '/api/entities/' + real + '/activate', {});
  const count = async (t, e) => (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1 AND entity_id = $2`, [uid, e])).rows[0].n;
  const before = await count('ledger_entries', test);
  eq('control: Test Co has ledger entries before the delete', before >= 3, true);
  await J('DELETE', '/api/entities/' + test);
  eq('Test Co ledger entries / lines / accounts after the delete',
    [await count('ledger_entries', test), await count('ledger_lines', test), await count('ledger_accounts', test)], [0, 0, 0], [before, '>0', '>0']);
  eq('Real Co ledger untouched', await count('ledger_entries', real) >= 1, true);
  const rep = await J('GET', '/api/reports');
  eq('Real Co revenue', rep.revenue, 1000);
  const bs = await J('POST', '/api/reports/balance-sheet', {});
  eq('Real Co balance sheet GL-sourced', bs.source, 'gl');
});
