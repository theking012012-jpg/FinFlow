'use strict';
/**
 * M48 + M49 (money audit 2026-10-09; OBSERVED live), driven through the real SPA in jsdom (clock pinned 2026-07-25).
 *
 * M48: the Bills page "Pay" button takes an amount and a date (partial payments).
 *   BUG: one click posted the WHOLE outstanding balance, dated the browser's today, and the bill went straight to paid.
 *   Seed: bill Supply Co 400 (unpaid). Pay 150 dated 2026-07-20.
 *     correct: bill partial, amount_paid 150; one linked payment 150 dated 2026-07-20; Pay again offers 250
 *     bug:     bill paid,    amount_paid 400; one linked payment 400 dated 2026-07-25
 *   Overpaying the remaining 250 with 300 is refused by the server (no payment lands).
 * M49: the Add expense form has a date field (default today, editable).
 *   BUG: no date field; every expense stamped today. Seed: a 75 receipt dated 2026-06-10.
 *     correct expense_date 2026-06-10 · bug 2026-07-25 (June P&L misses it, July carries it)
 */
const { run } = require('./clientMoneyKit.js');

run('M48 / M49 — bill Pay takes amount + date; Add expense takes a date', async ({ w, d, ev, settle, http, eq, A }) => {
  const get = async (p) => (await http.request('GET', p)).json || [];
  const val = (id) => (d.getElementById(id) || {}).value;

  // ── M48 ──
  w.showPage('bills'); await settle(30, 60);
  const bill = (await get('/api/bills')).find(b => b.vendor === 'Supply Co');
  A('seed bill present', !!bill);
  await w.markBillPaid(bill.id); await settle(20, 60);
  const modal = d.getElementById('modal-payment-made');
  A('Pay opens the payment form (amount + date) instead of paying in full', !!modal && !modal.classList.contains('hidden'));
  eq('the form is linked to this bill', val('pm-bill'), String(bill.id), undefined);
  eq('amount defaults to the outstanding balance', val('pm-amount'), '400', undefined);
  ev(`document.getElementById('pm-amount').value='150'; document.getElementById('pm-date').value='2026-07-20';`);
  await w.savePaymentMade(); await settle(40, 60);
  const b1 = (await get('/api/bills')).find(b => b.id === bill.id);
  eq('bill status after paying 150 of 400', b1.status, 'partial', 'paid');
  eq('bill amount_paid', Number(b1.amount_paid), 150, 400);
  const pays = (await get('/api/payments-made')).filter(p => Number(p.bill_id) === bill.id);
  eq('linked payments: one, 150, dated as entered', pays.map(p => [Number(p.amount), String(p.date).slice(0, 10)]), [[150, '2026-07-20']], [[400, '2026-07-25']]);
  await w.markBillPaid(bill.id); await settle(20, 60);
  eq('Pay again offers the remaining 250', val('pm-amount'), '250', undefined);
  ev(`document.getElementById('pm-amount').value='300';`);
  await w.savePaymentMade(); await settle(40, 60);
  const pays2 = (await get('/api/payments-made')).filter(p => Number(p.bill_id) === bill.id);
  eq('overpaying (300 > 250 remaining) books nothing', pays2.length, 1, undefined);
  try { w.closeModal('modal-payment-made'); } catch (_) {}

  // ── M49 ──
  w.showPage('expenses'); await settle(20, 60);
  w.openExpenseModal(); await settle(5, 40);
  A('Add expense has a date field', !!d.getElementById('bexp-date'));
  eq('date defaults to today', val('bexp-date'), '2026-07-25', undefined);
  ev(`(function(){ const s=(id,v)=>{document.getElementById(id).value=v;}; s('bexp-desc','Old receipt'); s('bexp-amount','75'); s('bexp-date','2026-06-10'); })()`);
  await w.saveExpense(); await settle(40, 60);
  const ex = (await get('/api/expenses')).find(e => e.description === 'Old receipt');
  eq('expense filed on the date entered', ex && String(ex.expense_date).slice(0, 10), '2026-06-10', '2026-07-25');
});
