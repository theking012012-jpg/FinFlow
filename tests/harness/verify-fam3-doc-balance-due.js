'use strict';
/**
 * verify-fam3-doc-balance-due.js — FA-M3 (full app audit 2026-10-22 M3). The invoice DOCUMENT — the page the customer
 * is sent / prints — showed "Balance Due" = the full total, ignoring payments already received (live: INV-1008 $777 with
 * $40 paid printed Balance Due $777), and had no line saying what was paid. Same class (Rule 13): the bill document's
 * "Amount Due" ignored payments made against the bill.
 * Root: the renderer nets `amount_paid`, but neither viewer passed it (viewInvoice → invoiceToDoc, viewBill).
 * After: Total, a "Payments received" (invoice) / "Paid" (bill) line, and the balance net of them.
 * The REAL SPA + real server. Seed (clientMoneyKit base + through the real routes):
 *   invoice "Docs Co" 777, a 40 payment (invoice-payments)         ⇒ Balance Due 737.00   (bug 777.00)
 *   bill "Docs Vendor" 500, a 120 payment (payments-made, bill_id)    ⇒ Amount Due  380.00   (bug 500.00)
 *   invoice "Docs Unpaid" 250, no payment                            ⇒ Balance Due 250.00, no payments line
 */
const { run } = require('./clientMoneyKit.js');
let billId = null;

run('FA-M3 — the invoice and bill documents show what was paid and the balance actually due', async ({ w, d, settle, eq, A }) => {
  const docText = () => String((d.getElementById('ff-docview-frame') || {}).srcdoc || '').replace(/<[^>]+>/g, ' ').replace(/&minus;/g, '−').replace(/\s+/g, ' ');
  try { w.showPage('invoices'); } catch (_) {}
  await settle(20, 60);
  const idxOf = n => (w.userInvoices || []).findIndex(i => (i.client || i.customer) === n);

  try { w.viewInvoice(idxOf('Docs Co')); } catch (_) {}
  await settle(6, 40);
  const inv = docText();
  A('1  invoice 777 with 40 paid: "Balance Due $737.00" (bug: $777.00)', /Balance Due \$737\.00/.test(inv), (inv.match(/(Total|Payments received|Balance Due)[^A-Z]{0,24}/g) || []).join(' | '));
  A('1b …and a "Payments received −$40.00" line above it', /Payments received −\$40\.00/.test(inv), (inv.match(/Payments received[^A-Z]{0,24}/g) || ['(no line)']).join(' | '));
  A('1c …and the document total is still $777.00', /Total \$777\.00/.test(inv), (inv.match(/Total[^A-Z]{0,24}/g) || []).join(' | '));

  try { w.viewInvoice(idxOf('Docs Unpaid')); } catch (_) {}
  await settle(6, 40);
  const un = docText();
  A('2  an unpaid invoice: "Balance Due $250.00" and no payments line', /Balance Due \$250\.00/.test(un) && !/Payments received/.test(un), (un.match(/(Payments received|Balance Due)[^A-Z]{0,24}/g) || []).join(' | '));

  try { w.showPage('bills'); } catch (_) {}
  await settle(20, 60);
  try { w.viewBill(billId); } catch (_) {}
  await settle(6, 40);
  const bill = docText();
  A('3  bill 500 with 120 paid: "Amount Due $380.00" (bug: $500.00)', /Amount Due \$380\.00/.test(bill), (bill.match(/(Total|Paid|Amount Due)[^A-Z]{0,24}/g) || []).join(' | '));
  A('3b …and a "Paid −$120.00" line', /Paid −\$120\.00/.test(bill), (bill.match(/Paid[^A-Z]{0,24}/g) || ['(no line)']).join(' | '));
}, { extraSeed: async ({ http }) => {
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + String(r.text).slice(0, 160)); return r.json; };
  const i1 = J(await http.post('/api/invoices', { client: 'Docs Co', amount: 777, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-31', idempotency_key: 'fam3-i1' }));
  J(await http.post('/api/invoice-payments', { invoice_id: (i1.row || i1).id, amount: 40, payment_date: '2026-07-10', idempotency_key: 'fam3-p1' }));
  J(await http.post('/api/invoices', { client: 'Docs Unpaid', amount: 250, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01', idempotency_key: 'fam3-i2' }));
  const b = J(await http.post('/api/bills', { vendor: 'Docs Vendor', amount: 500, status: 'unpaid', issue_date: '2026-07-03', due_date: '2026-08-02', idempotency_key: 'fam3-b1' }));
  billId = (b.row || b).id;
  J(await http.post('/api/payments-made', { vendor: 'Docs Vendor', amount: 120, date: '2026-07-12', method: 'bank', bill_id: billId, idempotency_key: 'fam3-pb' }));
} });
