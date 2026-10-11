'use strict';
/**
 * M31 (money audit 2026-10-09): the Recurring Bills / Recurring Invoices "YTD" cards are the documents the schedules
 * ACTUALLY generated in this fiscal year to date.
 * BUG: Recurring Bills YTD = monthly profile cost × calendar month number (a projection: 100 × 7 = 700 in July);
 * Recurring Invoices YTD = all-time Σ of scheduler-generated invoices.
 * Seed (clientMoneyKit + generated docs, FY Jan–Dec, today 2026-07-25): profile Net Host 100/month (first run Aug);
 *   generated bills 100 (2026-03-01) and 100 (2025-12-01, last FY); generated invoices 250 (2026-05-01) and 999
 *   (2025-11-01, last FY).
 *   correct: bills YTD $100 · invoices YTD $250      bug: bills $700 · invoices $1,249
 */
const { run } = require('./clientMoneyKit.js');

run('M31 — recurring YTD cards count generated documents this fiscal year', async ({ w, d, settle, eq }) => {
  w.showPage('recurring-bills'); await settle(20, 60); w.renderRecurringBills && w.renderRecurringBills(); await settle(5, 40);
  const rb = Array.from(d.querySelectorAll('#page-recurring-bills .mc-val')).map(e => e.textContent.trim());
  eq('Recurring Bills YTD', rb[3], '$100', '$700');
  w.showPage('recurring-invoices'); await settle(20, 60); w.renderRecurringInvoices && w.renderRecurringInvoices(); await settle(5, 40);
  const ri = Array.from(d.querySelectorAll('#page-recurring-invoices .mc-val')).map(e => e.textContent.trim());
  eq('Recurring Invoices YTD', ri[3], '$250', '$1,249');
}, { extraSeed: async ({ client, userId }, { ent }) => {
  const ins = (t, data) => client.query(`INSERT INTO ${t} (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [userId, ent, data]);
  await ins('bills', { vendor: 'Net Host', amount: 100, amount_paid: 0, status: 'unpaid', issue_date: '2026-03-01', due_date: '2026-03-31', recurring_bill_id: 999, notes: 'Auto-generated from recurring schedule' });
  await ins('bills', { vendor: 'Net Host', amount: 100, amount_paid: 0, status: 'unpaid', issue_date: '2025-12-01', due_date: '2025-12-31', recurring_bill_id: 999, notes: 'Auto-generated from recurring schedule' });
  await ins('invoices', { client: 'Retainer Co', amount: 250, amount_paid: 0, status: 'pending', issue_date: '2026-05-01', due_date: '2026-05-31', recurring_invoice_id: 998, notes: 'Auto-generated from recurring schedule' });
  await ins('invoices', { client: 'Retainer Co', amount: 999, amount_paid: 0, status: 'pending', issue_date: '2025-11-01', due_date: '2025-11-30', recurring_invoice_id: 998, notes: 'Auto-generated from recurring schedule' });
} });
