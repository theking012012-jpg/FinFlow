'use strict';
/**
 * verify-la6-outstanding-credit-caption.js — LA6 (live audit 2026-10-13 M3): "Outstanding $2,400 · 2 invoices" while
 * those two invoices total $2,700. The $2,400 is right — an issued credit note reduces what the customer owes
 * whether or not it has been applied to an invoice yet (QuickBooks / Xero treat a credit memo the same way) — but the
 * caption hid the credit, so the card read as if two invoices summed to $2,400.
 *
 * The amounts do not change. The caption now says what makes up the figure. Real SPA, real scratch Postgres.
 * Seed: clientMoneyKit (clock 2026-07-25) + the January invoice (1,000, overdue) paid in full, so the dashboard shows
 * its count caption rather than the overdue one. Left: Jul invoice 600 − 250 paid = 350; open credit note 80.
 *   Outstanding 350 − 80 = 270
 *   Invoices card caption   "1 invoice · $350 less $80 in credit notes"          bug: "1 invoice"
 *   Dashboard caption       "1 unpaid invoice · $350 less $80 in credit notes"   bug: "1 unpaid invoice"
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la6-outstanding-credit-caption.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA6 — the Outstanding caption shows the credit notes netted into it', async ({ w, all, settle, eq }) => {
  eq('dashboard Outstanding (unchanged figure)', all('d-outstanding'), '$270');
  eq('dashboard caption', all('d-outstanding-chg'), '1 unpaid invoice · $350 less $80 in credit notes', '1 unpaid invoice');
  w.showPage('invoices');
  await settle(30, 50);
  eq('Invoices Outstanding (unchanged figure)', all('inv-out'), '$270');
  eq('Invoices caption', all('inv-out-cnt'), '1 invoice · $350 less $80 in credit notes', '1 invoice');
}, { extraSeed: async ({ http }) => {
  const invs = (await http.request('GET', '/api/invoices')).json || [];
  const jan = invs.find(i => Number(i.amount) === 1000);
  const r = await http.request('POST', '/api/invoice-payments', { invoice_id: jan.id, amount: 1000, payment_date: '2026-07-20', idempotency_key: 'la6-p1' });
  if (r.status >= 300) throw new Error('payment ' + r.status + ' ' + r.text);
} });
