'use strict';
/**
 * verify-b7e-edit-invoice-bill.js — plan batch 7 (B1a + B4a; gap audit 2026-10-22: invoices and bills could only be
 * viewed / paid / deleted — no edit). The server routes existed with no caller; G3 made them safe first.
 * Better than standard: the edit opens the same form pre-filled WITH its line items, saves to the SAME document (never
 * a second one), keeps its number, a refused edit shows the server's reason, and the document shows what changed
 * (old → new, who, when).
 *
 * The REAL SPA in jsdom against the real server. clientMoneyKit seed + extra: invoice "Edit Me" 700 (7 × 100 design),
 * bill "Edit Vendor" 500. EXPECTED:
 *   every invoice row has Edit                                        bug: no Edit
 *   Edit "Edit Me" → form shows client + 1 line (7 × 100)              bug: nothing to open
 *   change to 8 × 100, save → the SAME invoice is 800, number kept, no 2nd invoice   bug: (no edit) / a 2nd invoice via POST
 *   Edit Acme 600 (250 paid) → amount 200 → refused, saying 250.00 paid; still 600
 *   View "Edit Me" → its history shows amount 700.00 → 800.00
 *   "+ New invoice" after an edit creates a NEW invoice (edit mode cleared)
 *   every bill row has Edit; Edit "Edit Vendor" 500 → 450 → the same bill is 450, no 2nd bill
 */
const { run } = require('./clientMoneyKit.js');

run('Batch 7 — edit invoices and bills in place, with line items, refusals and history', async ({ w, d, settle, eq, A, http }) => {
  const msgs = []; const _n = w.notify; w.notify = (m, e) => { msgs.push(String(m)); try { _n(m, e); } catch (_) {} };
  const invs = async () => ((await http.get('/api/invoices')).json || []);
  try { w.showPage('invoices'); } catch (_) {}
  await settle(20, 60); try { w.renderInvoices(); } catch (_) {} await settle(4, 40);
  const rows = [...d.querySelectorAll('#invoice-list .table-row.inv-cols')];
  A('1  every invoice row has an Edit button', rows.length > 0 && rows.every(r => [...r.querySelectorAll('button')].some(b => /^\s*Edit\s*$/.test(b.textContent))), rows.length + ' rows');

  const idxOf = client => (w.userInvoices || []).findIndex(i => i.client === client);
  const before = await invs();
  const em = before.find(i => i.client === 'Edit Me') || {};
  if (typeof w.editInvoice === 'function') await w.editInvoice(idxOf('Edit Me'));
  await settle(6, 40);
  const li = (w.ffInvLineItems && w.ffInvLineItems.get && w.ffInvLineItems.get()) || [];
  eq('2  Edit opens the form with the client and its line (7 × 100)', [(d.getElementById('inv-client') || {}).value, li.map(l => [Number(l.qty), Number(l.rate)])], ['Edit Me', [[7, 100]]], ['', []]);
  if (w.ffInvLineItems && w.ffInvLineItems.load) w.ffInvLineItems.load([{ desc: 'Design', qty: 8, rate: 100 }]);
  await w.saveInvoice(); await settle(15, 50);
  const after = await invs();
  const em2 = after.find(i => i.id === em.id) || {};
  eq('3  saved to the SAME invoice: 800, number kept, no second "Edit Me"', [Number(em2.amount), em2.number, after.filter(i => i.client === 'Edit Me').length], [800, em.number, 1], [700, em.number, 1]);

  msgs.length = 0;
  if (typeof w.editInvoice === 'function') await w.editInvoice(idxOf('Acme Ltd') >= 0 ? (w.userInvoices || []).findIndex(i => i.client === 'Acme Ltd' && Number(i.amount) === 600) : -1);
  await settle(4, 40);
  if (w.ffInvLineItems && w.ffInvLineItems.reset) w.ffInvLineItems.reset();
  const amt = d.getElementById('inv-amount'); if (amt) amt.value = '200';
  await w.saveInvoice(); await settle(10, 50);
  const acme = (await invs()).find(i => i.client === 'Acme Ltd' && Number(i.amount_paid) === 250) || {};
  A('4  an edit below what is paid is refused with the reason (250.00 paid)', /250\.00/.test(msgs.join(' | ')) && Number(acme.amount) === 600, JSON.stringify({ msgs, amount: acme.amount }));
  try { w.closeModal('invoice-modal'); } catch (_) {}

  try { w.viewInvoice(idxOf('Edit Me')); } catch (_) {}
  await settle(15, 50);
  // History sits BESIDE the document (never inside it — a customer's PDF must not carry internal edit history).
  const hist = ((d.getElementById('ff-docview-history') || {}).textContent || '').replace(/\s+/g, ' ');
  A('5  the viewer shows the invoice\'s history: Amount 700.00 → 800.00', /Amount 700\.00 → 800\.00/.test(hist), JSON.stringify(hist.slice(0, 300)));
  const fr = d.getElementById('ff-docview-frame');
  A('5b …and the printed document itself carries no edit history', !/→/.test(String((fr && fr.srcdoc) || '')), 'history found inside the printable document');

  try { w.openInvoiceModal(); } catch (_) {}
  const cl = d.getElementById('inv-client'); if (cl) cl.value = 'Fresh Co';
  const am = d.getElementById('inv-amount'); if (am) am.value = '55';
  const n0 = (await invs()).length;
  await w.saveInvoice(); await settle(12, 50);
  eq('6  "+ New invoice" after an edit makes a NEW invoice', [(await invs()).length, (await invs()).some(i => i.client === 'Fresh Co')], [n0 + 1, true]);

  // removing the lines on an edit clears them on the invoice (no stale 8 × 100 left beside a typed 650)
  try { w.showPage('invoices'); } catch (_) {}
  await settle(8, 40);
  if (typeof w.editInvoice === 'function') await w.editInvoice(idxOf('Edit Me'));
  await settle(4, 40);
  if (w.ffInvLineItems && w.ffInvLineItems.reset) w.ffInvLineItems.reset();
  const am2 = d.getElementById('inv-amount'); if (am2) am2.value = '650';
  await w.saveInvoice(); await settle(12, 50);
  const em3 = (await invs()).find(i => i.id === em.id) || {};
  eq('6b lines removed on an edit are cleared: 650, no line items left', [Number(em3.amount), Array.isArray(em3.line_items) ? em3.line_items.length : 0], [650, 0], [650, 1]);

  try { w.showPage('bills'); } catch (_) {}
  await settle(20, 60); try { w.renderBills(); } catch (_) {} await settle(4, 40);
  const brows = [...d.querySelectorAll('#bills-list .table-row')];
  A('7  every bill row has an Edit button', brows.length > 0 && brows.every(r => [...r.querySelectorAll('button')].some(b => /^\s*Edit\s*$/.test(b.textContent))), brows.length + ' rows');
  const bills = async () => ((await http.get('/api/bills')).json || []);
  const ev = (await bills()).find(b => b.vendor === 'Edit Vendor') || {};
  if (typeof w.editBill === 'function') await w.editBill(ev.id);
  await settle(4, 40);
  eq('7b Edit opens the bill form filled in', [(d.getElementById('bill-vendor') || {}).value, Number((d.getElementById('bill-amount') || {}).value)], ['Edit Vendor', 500], ['', 0]);
  const ba = d.getElementById('bill-amount'); if (ba) ba.value = '450';
  await w.saveBill(); await settle(12, 50);
  const after2 = await bills();
  eq('7c saved to the SAME bill: 450, no second "Edit Vendor"', [Number((after2.find(b => b.id === ev.id) || {}).amount), after2.filter(b => b.vendor === 'Edit Vendor').length], [450, 1], [500, 1]);
}, { extraSeed: async ({ http }) => {
  const P = async (p, b) => { const r = await http.request('POST', p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return r.json; };
  await P('/api/invoices', { client: 'Edit Me', status: 'pending', issue_date: '2026-07-05', due_date: '2026-08-05', line_items: [{ desc: 'Design', qty: 7, rate: 100 }], amount: 700, idempotency_key: 'b7e-i' });
  await P('/api/bills', { vendor: 'Edit Vendor', amount: 500, status: 'unpaid', issue_date: '2026-07-06', due_date: '2026-08-06', idempotency_key: 'b7e-b' });
} });
