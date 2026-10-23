'use strict';
/**
 * verify-g17-payment-doc-number.js — G17. The payment-received DOCUMENT read the invoice number from `inv.num`, but
 * invoices store it in `number` since B1b — so the document had no number and its note said "Payment for invoice".
 * clientMoneyKit seed (clock 2026-07-25): Acme 600 is INV-0002 with a 250 payment (Store B, invoice_id).
 * Bug values: no "#INV-0002" on the document; note "Payment for invoice".
 */
const { run } = require('./clientMoneyKit.js');

run('G17 — a payment received names the invoice it paid on its document', async ({ w, d, settle, A, http }) => {
  const pays = (await http.get('/api/invoice-payments')).json || [];
  const invs = (await http.get('/api/invoices')).json || [];
  const inv2 = invs.find(i => i.number === 'INV-0002') || {};
  const p = pays.find(x => Number(x.invoice_id) === Number(inv2.id));
  A('0  premise: INV-0002 has a payment', !!p, JSON.stringify(pays.map(x => [x.id, x.invoice_id])));
  try { w.showPage('payments-received'); } catch (_) {}
  await settle(20, 60);
  try { w.viewPaymentReceived(p && p.id); } catch (_) {}
  await settle(6, 40);
  const doc = String((d.getElementById('ff-docview-frame') || {}).srcdoc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  A('1  the payment document shows the invoice number #INV-0002 (bug: none)', /#INV-0002/.test(doc), (doc.match(/#\S+/g) || ['(no number)']).join(' '));
  // (The fallback note "Payment for …" shows only when a payment has no method; this seed's payment has one, so the
  // note is not asserted — it could not tell the fix from the bug here, Rule 4.)
});
