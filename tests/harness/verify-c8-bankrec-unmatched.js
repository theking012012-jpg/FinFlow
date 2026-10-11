'use strict';
/**
 * C8 (Cowork end-to-end test 3.2a): Bank Rec counts only lines still needing attention, and its money-in list shows
 * money in, signed and dated.
 * BUG: after all four bank lines were dealt with (one matched to a payment, one booked as an expense, one matched to a
 * bill, one ignored) Bank Rec still said "3 unmatched": the server's unmatched list only knew about invoice matches,
 * not lines actioned on the money-out side. That list also showed the debits, as "+$", with no date (it read `date`;
 * bank lines carry `tx_date`).
 * Seed: clientMoneyKit Business A (payment 250 on 2026-07-03, bill Supply Co 400) + bank lines:
 *   ACME DEPOSIT +250 (Jul 4) · SUPPLY CO −400 (Jul 5) · BANK FEE −12 (Jul 6) · TRANSFER OUT −99 (Jul 7)
 *   before: the money-in list holds ACME DEPOSIT only, "+$250", dated   bug: all four lines, debits as "+", no date
 *           the unmatched card says 4 (1 credit to match + 3 debits)
 *   after matching / booking / bill-matching / ignoring all four: unmatched 0                        bug: 3
 */
const { run } = require('./clientMoneyKit.js');

run('C8 — Bank Rec unmatched count and money-in list', async ({ w, d, settle, eq, A, http }) => {
  const open = async () => { try { w.showPage('bank-rec'); } catch (_) {} await settle(20, 60); if (typeof w.loadBankRec === 'function') { await w.loadBankRec(); await settle(10, 40); } };
  await open();
  const rows = Array.from(d.querySelectorAll('#brec-bank-list .tx-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim());
  eq('money-in list: the one credit only', rows.length, 1, 4);
  A('…signed + and dated', rows.length === 1 && /ACME DEPOSIT/.test(rows[0]) && /\+\$250/.test(rows[0]) && /Jul 4,? 2026/.test(rows[0]), JSON.stringify(rows));
  eq('unmatched card before: 1 credit + 3 debits', (d.getElementById('brec-unmatched-bank') || {}).textContent, '4');

  const lines = (await http.get('/api/banking')).json || [];
  const L = n => (lines.find(l => l.description === n) || {}).id;
  const rec = (await http.get('/api/bank-reconciliation')).json || {};
  const pay = (rec.unmatchedPayments || []).find(p => Number(p.amount) === 250);
  const bill = (rec.openBills || []).find(b => b.vendor === 'Supply Co');
  const ok = r => r.status < 300;
  A('match the deposit to the 250 payment', ok(await http.post('/api/bank-reconciliation/match', { banking_id: L('ACME DEPOSIT'), invoice_payment_id: pay && pay.id })));
  A('match SUPPLY CO to the bill', ok(await http.post('/api/bank-reconciliation/match-bill', { banking_id: L('SUPPLY CO'), bill_id: bill && bill.id })));
  A('book the fee as an expense', ok(await http.post('/api/bank-reconciliation/book-expense', { banking_id: L('BANK FEE') })));
  A('ignore the transfer', ok(await http.post('/api/bank-reconciliation/ignore', { banking_id: L('TRANSFER OUT') })));
  await open();
  eq('unmatched card after all four are dealt with', (d.getElementById('brec-unmatched-bank') || {}).textContent, '0', '3');
}, { extraSeed: async ({ http }) => {
  const csv = 'Date,Description,Amount\n2026-07-04,ACME DEPOSIT,250.00\n2026-07-05,SUPPLY CO,-400.00\n2026-07-06,BANK FEE,-12.00\n2026-07-07,TRANSFER OUT,-99.00\n';
  const r = await http.request('POST', '/api/banking/import', { format: 'csv', content: csv });
  if (r.status >= 300) throw new Error('import ' + r.status + ' ' + r.text);
} });
