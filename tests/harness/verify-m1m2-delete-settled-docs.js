'use strict';
/**
 * M1 / M2 (money audit 2026-10-09): deleting an invoice or bill that has settlements recorded against it.
 * BUG: the document went, its payments stayed. Revenue/expense vanished while the cash stayed in the
 * cash-flow report and the GL (AR / AP went negative and the balance-sheet gate fell back).
 * FIX: the delete is refused (409) while a payment is linked. Delete the payments first (each reverses
 * its own cash leg), then the document. An UNPAID document still deletes normally.
 */
const { run } = require('./moneyFixKit.js');

run('M1/M2 — a document with payments cannot be deleted out from under them', async ({ newOwner, eq, A }) => {
  // ── M1: invoice 1,000 fully paid ──
  {
    const { J, http } = await newOwner('M1');
    const inv = await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-06-30', idempotency_key: 'm1-inv' });
    const pay = await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 1000, payment_date: '2026-06-10', idempotency_key: 'm1-pay' });
    const del = await http.del('/api/invoices/' + inv.id);
    eq('M1 delete of a paid invoice is refused', del.status, 409, 200);
    A('M1 refusal tells the user what to do', /payment/i.test(String(del.json && del.json.error)), String(del.text).slice(0, 160));
    const rep = await J('GET', '/api/reports');
    eq('M1 revenue kept after the refused delete', rep.revenue, 1000, 0);
    const bs = await J('POST', '/api/reports/balance-sheet', {});
    eq('M1 balance sheet still GL-sourced (AR not driven negative)', bs.source, 'gl', 'computeBooks');
    // The supported path: remove the payment, then the invoice. No orphan cash remains.
    const pdel = await http.del('/api/invoice-payments/' + pay.id);
    eq('M1 the payment itself can be deleted', pdel.status, 200);
    const del2 = await http.del('/api/invoices/' + inv.id);
    eq('M1 the now-unpaid invoice deletes', del2.status, 200);
    const cf = await J('POST', '/api/reports/cash-flow', {});
    eq('M1 no orphan cash inflow after the supported path', cf.totalInflow, 0, 1000);
    // An invoice that never had a payment still deletes (the guard is not a blanket block).
    const inv2 = await J('POST', '/api/invoices', { client: 'Beta', amount: 250, status: 'pending', issue_date: '2026-06-02', due_date: '2026-06-30', idempotency_key: 'm1-inv2' });
    eq('M1 an unpaid invoice deletes normally', (await http.del('/api/invoices/' + inv2.id)).status, 200);
  }
  // ── M2: bill 400 paid by a linked payment made ──
  {
    const { J, http } = await newOwner('M2');
    const bill = await J('POST', '/api/bills', { vendor: 'Supplier', amount: 400, status: 'unpaid', issue_date: '2026-06-02', due_date: '2026-06-30', idempotency_key: 'm2-bill' });
    const pm = await J('POST', '/api/payments-made', { vendor: 'Supplier', amount: 400, date: '2026-06-05', bill_id: bill.id, idempotency_key: 'm2-pm' });
    const del = await http.del('/api/bills/' + bill.id);
    eq('M2 delete of a paid bill is refused', del.status, 409, 200);
    A('M2 refusal tells the user what to do', /payment/i.test(String(del.json && del.json.error)), String(del.text).slice(0, 160));
    const rep = await J('GET', '/api/reports');
    eq('M2 expense kept after the refused delete', rep.expenses, 400, 0);
    const bs = await J('POST', '/api/reports/balance-sheet', {});
    eq('M2 balance sheet still GL-sourced (AP not driven negative)', bs.source, 'gl', 'computeBooks');
    eq('M2 the payment made can be deleted', (await http.del('/api/payments-made/' + pm.id)).status, 200);
    eq('M2 the now-unpaid bill deletes', (await http.del('/api/bills/' + bill.id)).status, 200);
    const cf = await J('POST', '/api/reports/cash-flow', {});
    eq('M2 no orphan cash outflow after the supported path', cf.totalOutflow, 0, 400);
    const b2 = await J('POST', '/api/bills', { vendor: 'Other', amount: 90, status: 'unpaid', issue_date: '2026-06-03', due_date: '2026-06-30', idempotency_key: 'm2-bill2' });
    eq('M2 an unpaid bill deletes normally', (await http.del('/api/bills/' + b2.id)).status, 200);
  }
});
