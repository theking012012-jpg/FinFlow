'use strict';
/**
 * fullLegScenario.js — Phase 1.1 shared seed: ONE of every money leg, written through the REAL
 * endpoints (so each write also posts to the GL), on an EMPTY account. Amounts are < 1000 so the
 * dashboard's abbreviated money format shows exact whole dollars, and every leg has a DISTINCT value
 * so a surface that drops or double-counts one leg lands on a different number (Rule 4).
 *
 * Clock is pinned 2026-07-25 (clock.js); every dated row is in June 2026 (FY2026, Jan start).
 *
 * HAND-COMPUTED EXPECTED VALUES (Rule 6 — derived from the seed, not from the code under test):
 *   Revenue  = invoice 700 + sales receipt 20 + posted income JE 30 − credit note 5        = 745
 *   Opex     = expense 8 + issued bill 40 + orphan payment-made 7 − vendor credit 3
 *              + payroll (approved run 300 + paid run 250; draft 199 excluded) + expense JE 12 = 614
 *              (the bill-LINKED payment 15 settles AP — it is NOT an expense)
 *   Net      = 745 − 614                                                                  = 131
 *   AR       = invoice 700 − payment 60 − credit note 5                                    = 635
 *   AP       = bill 40 − linked payment 15 − vendor credit 3                               = 22
 *   Cash in  = invoice payment 60 + sales receipt 20                                       = 80
 *   Cash out = expense 8 + payments made 15 + 7 + paid payroll 250                         = 280
 *   Expense categories: Payroll 550 · Bills & vendors 44 (40 + 7 − 3) · Journal entries 12 · Office 8
 *   Tax-deductible: the Office expense is 'half' ⇒ 4 (a yes-only reader shows 0)
 */
const EXPECTED = Object.freeze({
  revenue: 745, opex: 614, net: 131, ar: 635, ap: 22, cashIn: 80, cashOut: 280,
  categories: { 'Payroll': 550, 'Bills & vendors': 44, 'Journal entries': 12, 'Office': 8 },
  deductible: 4,
});

async function postFullLegScenario({ http, client }) {
  const J = r => { try { return JSON.parse(r.text); } catch { return null; } };
  const ok = (r, what) => { if (r.status >= 300) throw new Error(`${what} → HTTP ${r.status}: ${String(r.text).slice(0, 200)}`); return J(r); };
  const P = async (p, b) => ok(await http.post(p, b), 'POST ' + p);
  const PUT = async p => ok(await http.put(p, {}), 'PUT ' + p);

  const ent = await P('/api/entities', { name: 'Full Leg Co', currency: 'USD', timezone: 'UTC', country: 'US' });
  await P('/api/entities/' + ent.id + '/activate', {});
  const inv = await P('/api/invoices', { client: 'Acme', amount: 700, status: 'pending', issue_date: '2026-06-05', due_date: '2026-08-05' });
  await P('/api/invoice-payments', { invoice_id: inv.id, amount: 60, payment_date: '2026-06-20', method: 'bank' });
  await P('/api/sales-receipts', { customer: 'Walk-in', num: 'SR-1', amount: 20, date: '2026-06-07', method: 'Cash' });
  await P('/api/credit-notes', { customer: 'Acme', num: 'CN-1', amount: 5, date: '2026-06-08' });
  await P('/api/expenses', { description: 'Office supplies', category: 'Office', amount: 8, expense_date: '2026-06-09', deductible: 'half' });
  const bill = await P('/api/bills', { vendor: 'Supplier', amount: 40, status: 'unpaid', issue_date: '2026-06-10', due_date: '2026-08-10' });
  await P('/api/payments-made', { vendor: 'Supplier', amount: 15, date: '2026-06-15', method: 'bank', bill_id: bill.id });
  await P('/api/payments-made', { vendor: 'Other', amount: 7, date: '2026-06-16', method: 'bank' });
  await P('/api/vendor-credits', { vendor: 'Supplier', num: 'VC-1', amount: 3, date: '2026-06-17' });
  await P('/api/journals', { date: '2026-06-18', description: 'Income adjustment', status: 'Posted',
    lines: [{ code: '1010', name: 'Checking', debit: 30, credit: 0 }, { code: '4000', name: 'Service Revenue', debit: 0, credit: 30 }] });
  await P('/api/journals', { date: '2026-06-19', description: 'Rent accrual', status: 'Posted',
    lines: [{ code: '5100', name: 'Rent', debit: 12, credit: 0 }, { code: '1010', name: 'Checking', debit: 0, credit: 12 }] });
  const emp = await P('/api/payroll', { fname: 'Ann', lname: 'Lee', gross: 111, deductions: [] });
  const runA = await P('/api/payroll-runs', { period: '2026-05', bonus_overrides: { [emp.id]: 189 } });   // 300, approved
  const runB = await P('/api/payroll-runs', { period: '2026-06', bonus_overrides: { [emp.id]: 139 } });   // 250, paid
  // run_date is the DB's NOW() (real time, not the pinned clock); date the two recognised runs inside
  // the pinned window so the cash-out leg (paid run, by run_date) lands in June like every other row.
  if (client) await client.query(`UPDATE payroll_runs SET run_date='2026-06-28' WHERE id IN ($1,$2)`, [runA.id, runB.id]);
  await PUT('/api/payroll-runs/' + runA.id + '/approve');
  await PUT('/api/payroll-runs/' + runB.id + '/approve');
  await PUT('/api/payroll-runs/' + runB.id + '/mark-paid');
  await P('/api/payroll-runs', { period: '2026-04', bonus_overrides: { [emp.id]: 88 } });                 // 199, draft
  return { entityId: ent.id, invoiceId: inv.id, billId: bill.id };
}

module.exports = { postFullLegScenario, EXPECTED };
