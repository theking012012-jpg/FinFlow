'use strict';
/**
 * verify-g13-deposits-prepayments — G13 (owner decision 2026-11-01, the V1 pattern): on the balance sheet, a customer's
 * credit beyond what they owe is a LIABILITY ("Customer deposits") and a vendor credit beyond what is billed is an ASSET
 * ("Vendor prepayments") — not netted into Accounts Receivable / Payable for everyone else. Real server, scratch PG.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-g13-deposits-prepayments.js
 *
 * Seed (Rule 4 — distinct amounts): invoice Acme 1,000 (owed) · credit note Bolt 300 (Bolt owes nothing) · bill Supply
 * 500 (owed) · vendor credit Vend 200 (no bill from Vend).
 * Hand-computed: AR 1,000, Customer deposits 300, AP 500, Vendor prepayments 200 (old: AR 700, AP 300, no deposit / prepay
 * lines). Equity unchanged by the presentation; both totals rise by 500.
 */
const { runBrowser } = require('./browserKit.js');
runBrowser('G13 — customer deposits and vendor prepayments on their own lines', async ({ eq, A, J, http }) => {
  await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-07-01', idempotency_key: 'g13-i' });
  await J('POST', '/api/credit-notes', { customer: 'Bolt', amount: 300, date: '2026-07-02', status: 'Open', idempotency_key: 'g13-cn' });
  await J('POST', '/api/bills', { vendor: 'Supply', amount: 500, status: 'unpaid', issue_date: '2026-07-03', due_date: '2026-08-03', idempotency_key: 'g13-b' });
  await J('POST', '/api/vendor-credits', { vendor: 'Vend', amount: 200, date: '2026-07-04', status: 'Open', idempotency_key: 'g13-vc' });
  const bs = (await http.post('/api/reports/balance-sheet', {})).json || {};
  eq('served from the ledger', bs.source, 'gl');
  eq('Accounts Receivable = Acme\'s 1,000', bs.accountsReceivable, 1000, 700);
  eq('Customer deposits = Bolt\'s 300', bs.customerDeposits, 300, undefined);
  eq('Accounts Payable = Supply\'s 500', bs.accountsPayable, 500, 300);
  eq('Vendor prepayments = Vend\'s 200', bs.vendorPrepayments, 200, undefined);
  const lab = k => ((bs.lines && [].concat(bs.lines.assets, bs.lines.liabilities)) || []).find(l => l.key === k);
  eq('lines: "Customer deposits" 300 (liability), "Vendor prepayments" 200 (asset)', [lab('customerDeposits') && lab('customerDeposits').amount, bs.lines.liabilities.some(l => l.key === 'customerDeposits'), lab('vendorPrepayments') && lab('vendorPrepayments').amount, bs.lines.assets.some(l => l.key === 'vendorPrepayments')], [300, true, 200, true]);
  eq('equity = assets − liabilities, unchanged by the presentation', Math.round((bs.totalAssets - bs.totalLiabilities) * 100) / 100, bs.equity);
  const sumL = arr => Math.round(arr.reduce((x, l) => x + l.amount, 0) * 100) / 100;
  eq('the lines foot to the totals', [sumL(bs.lines.assets), sumL(bs.lines.liabilities)], [bs.totalAssets, bs.totalLiabilities]);
}, {});
