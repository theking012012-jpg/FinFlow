'use strict';
/**
 * verify-b1b-invoice-numbers-ui.js — B1b on the screens (the REAL SPA in jsdom against the real server).
 *   Invoices list shows each invoice's number                       bug: client name only
 *   Payments Received shows the paid invoice's number               bug: "Invoice # —" (it read a field nothing wrote)
 *   View (the document) shows the REAL number                       bug: a fabricated "INV-" + (1000 + id)
 *   Settings → Invoice prefix shows this business's prefix and saving it changes the next number
 * clientMoneyKit seed (clock 2026-07-25): invoices created through the real route — Acme 1,000 (Jan) is INV-0001,
 * Acme 600 (Jul, 250 paid) is INV-0002, Beta 300 (Jun, paid) INV-0003, Gamma draft 9,999 INV-0004.
 */
const { run } = require('./clientMoneyKit.js');

run('B1b UI — invoice numbers on the list, Payments Received, the document and Settings', async ({ w, d, settle, eq, A, http }) => {
  try { w.showPage('invoices'); } catch (_) {}
  await settle(20, 60); try { w.renderInvoices(); } catch (_) {} await settle(4, 40);
  const list = ((d.getElementById('invoice-list') || {}).textContent || '').replace(/\s+/g, ' ');
  A('1  the Invoices list shows the numbers (INV-0001 … INV-0004)', ['INV-0001', 'INV-0002', 'INV-0003', 'INV-0004'].every(n => list.indexOf(n) >= 0), list.slice(0, 300));

  try { w.showPage('payments-received'); } catch (_) {}
  await settle(20, 60); try { w.renderPaymentsReceived(); } catch (_) {} await settle(4, 40);
  const pr = ((d.getElementById('payments-recv-list') || {}).textContent || '').replace(/\s+/g, ' ');
  A('2  Payments Received names the invoice each payment paid (INV-0002, INV-0003)', /INV-0002/.test(pr) && /INV-0003/.test(pr) && !/Invoice # —/.test(pr), pr.slice(0, 300));

  const idx = (w.userInvoices || []).findIndex(i => i.amount == 600);
  try { w.viewInvoice(idx); } catch (_) {}
  await settle(8, 40);
  const _frame = d.getElementById('ff-docview-frame');   // the document renders into this frame's srcdoc
  const doc = String((_frame && _frame.srcdoc) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const inv = (w.userInvoices || [])[idx] || {};
  A('3  the invoice document shows its real number #INV-0002, never a made-up INV-1xxx', /#INV-0002/.test(doc) && !new RegExp('INV-' + (1000 + Number(inv._dbId))).test(doc), 'doc mentions: ' + (doc.match(/#INV-\d+/g) || []).join(', '));
  try { w.closeModal && w.closeModal('docview-modal'); } catch (_) {}

  try { w.showPage('settings'); } catch (_) {}
  await settle(10, 50); try { w._ffApplyEntityProfile && w._ffApplyEntityProfile(); } catch (_) {}
  const pfx = d.getElementById('s-inv-prefix');
  eq('4  Settings shows this business\'s prefix (INV- by default)', pfx && pfx.value, 'INV-');
  if (pfx) pfx.value = 'BA-';
  await w.saveSettings(); await settle(15, 60);
  const next = (await http.post('/api/invoices', { client: 'After prefix', amount: 10, status: 'pending', issue_date: '2026-07-20', idempotency_key: 'b1b-ui-1' })).json || {};
  eq('4b saving it changes the next number (BA-0005)', next.number, 'BA-0005', undefined);
});
