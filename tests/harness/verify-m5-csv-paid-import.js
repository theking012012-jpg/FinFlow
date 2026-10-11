'use strict';
/**
 * M5 (money audit 2026-10-09): CSV-imported Paid / Partial invoices and bills.
 * BUG: the importer stored status 'paid' with no amount_paid (invoices) or amount_paid 0 (bills) and no payment
 * row, so a "Paid" invoice of 500 sat in Outstanding at 500 forever, and a "Paid" bill of 200 stayed in AP.
 * FIX: the paid part is settled through the real payment writers (an invoice_payment / a bill-linked payment
 * made, with its GL cash leg), so AR / AP / cash-flow / ledger all agree. A "Partial" row needs the amount paid
 * (an "Amount Paid" or "Balance" column); without it the row is rejected rather than guessed.
 * Seed values differ so each figure identifies its source (Rule 4):
 *   invoices: Paid 500 · Partial 300 with Amount Paid 120 · Pending 70 · Partial 90 with no paid column (rejected)
 *   correct Outstanding = 0 + 180 + 70 = 250;  bug = 500 + 300 + 70 + 90 = 960
 *   bills: Paid 200 · Partial 150 with Balance 40 · Unpaid 60 ;  correct AP = 0 + 40 + 60 = 100; bug = 410
 */
const { run } = require('./moneyFixKit.js');

run('M5 — CSV-imported Paid / Partial documents are settled, not left owing', async ({ newOwner, eq }) => {
  const { J } = await newOwner('M5');
  const inv = await J('POST', '/api/import/csv', { type: 'invoices', mapping: { date_order: 'mdy' }, content:
    'Customer,Amount,Status,Invoice Date,Amount Paid\n' +
    'PaidCo,500,Paid,05/01/2026,\n' +
    'PartCo,300,Partial,05/02/2026,120\n' +
    'OpenCo,70,Pending,05/03/2026,\n' });
  eq('3 invoice rows imported', inv.added, 3);
  const noPaid = await J('POST', '/api/import/csv', { type: 'invoices', mapping: { date_order: 'mdy' }, content:
    'Customer,Amount,Status,Invoice Date\nGuessCo,90,Partial,05/04/2026\n' });
  eq('a Partial row with no amount paid is rejected, not guessed', [noPaid.added, noPaid.failed], [0, 1], [1, 0]);

  const rep = await J('GET', '/api/reports');
  eq('Outstanding (AR) after import', rep.outstanding, 250, 960);
  const pays = await J('GET', '/api/invoice-payments');
  const paySum = Math.round(pays.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
  eq('invoice payments recorded for the paid parts (500 + 120)', paySum, 620, 0);
  const list = await J('GET', '/api/invoices');
  const st = Object.fromEntries(list.map(i => [i.client, [i.status, Number(i.amount_paid || 0)]]));
  eq('PaidCo status / amount_paid', st.PaidCo, ['paid', 500], ['paid', 0]);
  eq('PartCo status / amount_paid', st.PartCo, ['partial', 120], ['partial', 0]);

  const bills = await J('POST', '/api/import/csv', { type: 'bills', mapping: { date_order: 'mdy' }, content:
    'Vendor,Amount,Status,Bill Date,Balance\n' +
    'PaidV,200,Paid,05/05/2026,\n' +
    'PartV,150,Partial,05/06/2026,40\n' +
    'OpenV,60,Unpaid,05/07/2026,\n' });
  eq('3 bill rows imported', bills.added, 3);
  const bs = await J('POST', '/api/reports/balance-sheet', {});
  eq('balance-sheet AP after import', bs.accountsPayable != null ? bs.accountsPayable : (bs.liabilities && bs.liabilities.accountsPayable), 100, 410);
  eq('balance sheet stays GL-sourced (ledger and documents agree)', bs.source, 'gl');
  const cf = await J('POST', '/api/reports/cash-flow', { period: 'year' });
  eq('cash-flow sees the imported cash in (620) and out (200 + 110)', [cf.totalInflow, cf.totalOutflow], [620, 310], [0, 0]);
});
