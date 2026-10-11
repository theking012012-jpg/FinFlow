'use strict';
/**
 * M9 (money audit 2026-10-09): the Payments Received list (GET /api/invoice-payments, no invoice_id) must show
 * only the ACTIVE business's payments. BUG: it was user-scoped — business A (USD) listed business B's (EUR)
 * payments too, and the page's "Received" card summed both currencies.
 * Seed: A invoice 300 paid 300 · B invoice 700 paid 700. Viewing A: correct 1 row / 300; bug 2 rows / 1,000.
 * Viewing B: 1 row / 700.
 */
const { run } = require('./moneyFixKit.js');

run('M9 — Payments Received is scoped to the active business', async ({ newOwner, eq }) => {
  const { J, ids } = await newOwner('M9', [{ name: 'A Co', currency: 'USD' }, { name: 'B Co', currency: 'EUR' }]);
  const [a, b] = ids;
  const ia = await J('POST', '/api/invoices', { client: 'Acme', amount: 300, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-30', idempotency_key: 'm9-a' });
  await J('POST', '/api/invoice-payments', { invoice_id: ia.id, amount: 300, payment_date: '2026-07-05', idempotency_key: 'm9-pa' });
  await J('POST', '/api/entities/' + b + '/activate', {});
  const ib = await J('POST', '/api/invoices', { client: 'Bern', amount: 700, status: 'pending', issue_date: '2026-07-02', due_date: '2026-07-30', idempotency_key: 'm9-b' });
  await J('POST', '/api/invoice-payments', { invoice_id: ib.id, amount: 700, payment_date: '2026-07-06', idempotency_key: 'm9-pb' });
  const sum = rows => Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  const onB = await J('GET', '/api/invoice-payments');
  eq('viewing B: rows / total', [onB.length, sum(onB)], [1, 700], [2, 1000]);
  await J('POST', '/api/entities/' + a + '/activate', {});
  const onA = await J('GET', '/api/invoice-payments');
  eq('viewing A: rows / total', [onA.length, sum(onA)], [1, 300], [2, 1000]);
  const byInv = await J('GET', '/api/invoice-payments?invoice_id=' + ia.id);
  eq('per-invoice branch unchanged', byInv.length, 1);
});
