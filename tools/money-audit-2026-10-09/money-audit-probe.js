'use strict';
/**
 * money-audit-probe.js — READ-ONLY AUDIT INSTRUMENT (scratch database only, never production).
 * Seeds real rows through the real routes on a throwaway embedded Postgres, then MEASURES each
 * candidate defect from the 2026-10-09 money audit against a hand-computed expected value.
 * Each check prints: MEASURED, EXPECTED (correct books), and the value the suspected bug produces.
 * It asserts nothing about production data and writes nothing outside its own scratch cluster.
 * Clock: tests/harness/clock.js pins JS time to 2026-07-25T16:00Z. NOTE: Postgres NOW() is NOT pinned, so the
 * inventory checks (moved_at = NOW()) and the legacy NULL-entity check live in money-audit-probe2.js (real clock).
 * Run from the repo root as the non-root postgres user on a clean copy (LAUNCH_EXECUTION_PLAN D2):
 *   node tools/money-audit-2026-10-09/money-audit-probe.js
 */
require('../../tests/harness/clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('../../tests/harness/pgScratch.js');
const { bootServer } = require('../../tests/harness/boot.js');
const { HarnessHttp } = require('../../tests/harness/httpClient.js');

const PW = 'audit-probe-pw-not-a-secret';
const out = [];
const R = (id, measured, expected, buggy, note) => {
  const m = JSON.stringify(measured), e = JSON.stringify(expected), b = JSON.stringify(buggy);
  const verdict = m === e ? 'CORRECT' : (m === b ? 'DEFECT CONFIRMED (matches predicted bug value)' : 'DIFFERS FROM BOTH');
  out.push({ id, verdict, measured, expected, buggy, note });
  console.log(`\n[${id}] ${verdict}\n   measured: ${m}\n   expected: ${e}\n   bug-pred: ${b}${note ? '\n   note:     ' + note : ''}`);
};
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server; let n = 0;
  const newOwner = async (tag, ents = [{ name: tag + ' Co', currency: 'USD' }]) => {
    n++;
    const email = `probe-${tag.toLowerCase()}@finflow.test`;
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: tag, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.' + (20 + n) });
    if ((await http.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + tag);
    const J = async (method, p, b) => { const r = await http.request(method, p, b); if (r.status >= 300) throw new Error(method + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
    const ids = [];
    for (const e of ents) ids.push((await J('POST', '/api/entities', Object.assign({ timezone: 'UTC', country: 'US' }, e))).id);
    await J('POST', '/api/entities/' + ids[0] + '/activate', {});
    return { uid, http, J, ids };
  };
  try {
    server = await bootServer(scratch.url);

    // ── C7: delete a fully-paid invoice ───────────────────────────────────────────────────────────
    {
      const { J, http } = await newOwner('C7');
      const inv = await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-06-30', idempotency_key: 'c7-inv' });
      await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 1000, payment_date: '2026-06-10', idempotency_key: 'c7-pay' });
      const del = await http.del('/api/invoices/' + inv.id);
      const rep = await J('GET', '/api/reports');
      const cf = await J('POST', '/api/reports/cash-flow', {});
      const bs = await J('POST', '/api/reports/balance-sheet', {});
      const pays = await J('GET', '/api/invoice-payments');
      R('C7 delete of a PAID invoice', { deleteStatus: del.status, revenue: rep.revenue, cashInflow: cf.totalInflow, orphanPayments: pays.length, bsSource: bs.source, bsCash: bs.cash },
        { deleteStatus: 409, revenue: 1000, cashInflow: 1000, orphanPayments: 1, bsSource: 'gl', bsCash: 1000 },
        { deleteStatus: 200, revenue: 0, cashInflow: 1000, orphanPayments: 1, bsSource: 'computeBooks', bsCash: null },
        'expected = delete refused (or payment reversed with it); books must not keep 1,000 of cash received for an invoice that no longer exists');
    }

    // ── C8: delete a fully-paid bill ──────────────────────────────────────────────────────────────
    {
      const { J, http } = await newOwner('C8');
      const bill = await J('POST', '/api/bills', { vendor: 'Supplier', amount: 400, status: 'unpaid', issue_date: '2026-06-02', due_date: '2026-06-30', idempotency_key: 'c8-bill' });
      await J('POST', '/api/payments-made', { vendor: 'Supplier', amount: 400, date: '2026-06-05', bill_id: bill.id, idempotency_key: 'c8-pm' });
      const before = await J('GET', '/api/reports');
      const del = await http.del('/api/bills/' + bill.id);
      const rep = await J('GET', '/api/reports');
      const cf = await J('POST', '/api/reports/cash-flow', {});
      const bs = await J('POST', '/api/reports/balance-sheet', {});
      R('C8 delete of a PAID bill', { expensesBefore: before.expenses, deleteStatus: del.status, expensesAfter: rep.expenses, cashOutflow: cf.totalOutflow, bsSource: bs.source },
        { expensesBefore: 400, deleteStatus: 409, expensesAfter: 400, cashOutflow: 400, bsSource: 'gl' },
        { expensesBefore: 400, deleteStatus: 200, expensesAfter: 0, cashOutflow: 400, bsSource: 'computeBooks' },
        'the 400 left the bank; after the delete the P&L shows 0 expense for it');
    }

    // ── C9: Payments Received list across entities ─────────────────────────────────────────────────
    {
      const { J, ids } = await newOwner('C9', [{ name: 'A Co', currency: 'USD' }, { name: 'B Co', currency: 'EUR' }]);
      const ia = await J('POST', '/api/invoices?entity_id=' + ids[0], { client: 'A-client', amount: 300, status: 'pending', issue_date: '2026-07-01', entity_id: ids[0], idempotency_key: 'c9a' });
      await J('POST', '/api/invoice-payments?entity_id=' + ids[0], { invoice_id: ia.id, amount: 300, payment_date: '2026-07-02', idempotency_key: 'c9pa' });
      const ib = await J('POST', '/api/invoices?entity_id=' + ids[1], { client: 'B-client', amount: 700, status: 'pending', issue_date: '2026-07-01', entity_id: ids[1], idempotency_key: 'c9b' });
      await J('POST', '/api/invoice-payments?entity_id=' + ids[1], { invoice_id: ib.id, amount: 700, payment_date: '2026-07-03', idempotency_key: 'c9pb' });
      const listA = await J('GET', '/api/invoice-payments?entity_id=' + ids[0]);
      R('C9 Payments Received list for entity A (USD)', { rows: listA.length, sum: r2(listA.reduce((s, p) => s + Number(p.amount), 0)) },
        { rows: 1, sum: 300 }, { rows: 2, sum: 1000 }, 'entity B is EUR — its 700 lands on A\'s "Received · This month" card as if USD');
    }

    // ── CSV1: CSV-imported paid invoice / bill ───────────────────────────────────────────────────
    {
      const { J } = await newOwner('CSV1');
      const csvInv = 'Customer,Amount,Status,Invoice Date,Due Date,Invoice Number\nOldCo,500,Paid,2026-05-01,2026-05-31,INV-OLD-1\n';
      await J('POST', '/api/import/csv', { type: 'invoices', content: csvInv, mapping: { date_order: 'mdy' } });
      const csvBill = 'Vendor,Amount,Status,Bill Date,Due Date,Bill Number\nOldVendor,200,Paid,2026-05-03,2026-05-20,B-OLD-1\n';
      await J('POST', '/api/import/csv', { type: 'bills', content: csvBill, mapping: { date_order: 'mdy' } });
      const rep = await J('GET', '/api/reports');
      const bs = await J('POST', '/api/reports/balance-sheet', {});
      R('CSV1 imported "Paid" invoice + bill', { outstanding: rep.outstanding, overdue: rep.overdue, accountsPayable: bs.accountsPayable },
        { outstanding: 0, overdue: 0, accountsPayable: 0 }, { outstanding: 500, overdue: 500, accountsPayable: 200 },
        'both documents were PAID in the source system');
    }

    // ── T1: income-tax estimate ignores payroll / bills ──────────────────────────────────────────
    {
      const { J } = await newOwner('T1');
      await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', idempotency_key: 't1-inv' });
      await J('POST', '/api/expenses', { description: 'Rent', amount: 100, deductible: 'yes', expense_date: '2026-06-05', idempotency_key: 't1-exp' });
      await J('POST', '/api/bills', { vendor: 'Supplier', amount: 200, status: 'unpaid', issue_date: '2026-06-06', idempotency_key: 't1-bill' });
      await J('POST', '/api/payroll', { fname: 'Emp', lname: 'One', gross: 500 });
      const run = await J('POST', '/api/payroll-runs', { period: 'June 2026', idempotency_key: 't1-run' });
      await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
      const rep = await J('GET', '/api/reports');
      const tax = await J('GET', '/api/tax-filing');
      R('T1 tax estimate taxable income', { netProfit: rep.netProfit, taxableIncome: tax.taxableIncome },
        { netProfit: 200, taxableIncome: 200 }, { netProfit: 200, taxableIncome: 900 },
        'revenue 1,000 − rent 100 − bill 200 − payroll 500 = 200 profit; the estimate deducts only the flagged expense row');
    }

    // ── F1: 13-week forecast omits payroll ───────────────────────────────────────────────────────
    {
      const { J } = await newOwner('F1');
      await J('POST', '/api/payroll', { fname: 'Emp', lname: 'Two', gross: 3000 });
      const run = await J('POST', '/api/payroll-runs', { period: 'July 2026', idempotency_key: 'f1-run' });
      await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
      const fc = await J('GET', '/api/cashflow-forecast');
      const kinds = [...new Set(fc.periods.flatMap(p => p.items.map(i => i.kind)))];
      R('F1 forecast outflows with an approved-unpaid 3,000 payroll run + a 3,000/mo roster', { totalOutflow: fc.summary.total_outflow, kinds },
        { totalOutflow: '>= 3000 (approved run) + future months', kinds: ['payroll'] }, { totalOutflow: 0, kinds: [] },
        'measured value is the full truth; expected is directional (no payroll in a 13-week cash forecast)');
    }

    // ── C2: GL backfill reset re-dates paid payroll cash-out ──────────────────────────────────────
    {
      const { J, uid } = await newOwner('C2');
      await J('POST', '/api/payroll', { fname: 'Emp', lname: 'Three', gross: 800 });
      const run = await J('POST', '/api/payroll-runs', { period: 'June 2026', idempotency_key: 'c2-run' });
      await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
      await J('PUT', '/api/payroll-runs/' + run.id + '/mark-paid', {});
      const q = async () => (await c.query(`SELECT le.entry_date::text AS d FROM ledger_entries le WHERE le.user_id=$1 AND le.source_type='payroll_paid' AND le.reversal_of IS NULL ORDER BY id DESC LIMIT 1`, [uid])).rows[0];
      const pr = (await c.query(`SELECT paid_date::text AS paid, run_date::text AS run FROM payroll_runs WHERE id=$1`, [run.id])).rows[0];
      const live = await q();
      await J('POST', '/api/gl/backfill?reset=1', {});
      const rebuilt = await q();
      R('C2 payroll cash-out date: live vs after backfill reset', { paid_date: pr.paid, run_date: pr.run, liveEntry: live && live.d, afterReset: rebuilt && rebuilt.d },
        { paid_date: pr.paid, run_date: pr.run, liveEntry: pr.paid, afterReset: pr.paid },
        { paid_date: pr.paid, run_date: pr.run, liveEntry: pr.paid, afterReset: pr.run },
        'run_date = Postgres NOW() (real clock), paid_date = entity today (pinned clock) — the two differ here by construction');
    }

    // ── J2: re-dating a POSTED journal ───────────────────────────────────────────────────────────
    {
      const { J, uid } = await newOwner('J2');
      const j = await J('POST', '/api/journals', { date: '2026-06-15', description: 'Consulting accrual', status: 'Posted',
        lines: [{ code: '1100', name: 'AR', debit: 250, credit: 0 }, { code: '4000', name: 'Revenue', debit: 0, credit: 250 }] });
      await J('PUT', '/api/journals/' + j.id, { date: '2026-07-10' });
      const list = (await J('GET', '/api/journals')).find(x => x.id === j.id);
      const gl = (await c.query(`SELECT entry_date::text AS d FROM ledger_entries WHERE user_id=$1 AND source_type='journal' AND source_id=$2 AND reversal_of IS NULL`, [uid, j.id])).rows[0];
      R('J2 posted journal re-dated 06-15 → 07-10', { journalListDate: list.date, ledgerDate: gl && gl.d },
        { journalListDate: '2026-07-10', ledgerDate: '2026-07-10' }, { journalListDate: '2026-07-10', ledgerDate: '2026-06-15' },
        'the books (GL / computeBooks) keep June while the journal list says July');
    }

    // ── J1: accountant portal journal ────────────────────────────────────────────────────────────
    {
      const { J, uid } = await newOwner('J1');
      const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
        VALUES ('probe-acc@finflow.test', $1, 'P', 'A', 'Firm', 'PROBEACC1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','filing','client')`, [accId, uid]);
      const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.99' });
      if ((await ACC.post('/api/accountants/login', { email: 'probe-acc@finflow.test', password: PW })).status !== 200) throw new Error('acc login');
      const before = await J('GET', '/api/reports');
      // exactly what accountant-client.html submitJournal sends: { account, debit, credit }
      const post = await ACC.post(`/api/accountants/clients/${uid}/journal`, { date: '2026-07-01', description: 'Accrue consulting revenue',
        lines: [{ account: 'Accounts Receivable', debit: 900, credit: 0 }, { account: 'Consulting Revenue', debit: 0, credit: 900 }] });
      const after = await J('GET', '/api/reports');
      const jr = (await c.query(`SELECT data->>'status' AS st FROM journals WHERE user_id=$1`, [uid])).rows[0];
      const gl = (await c.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE user_id=$1 AND source_type='journal'`, [uid])).rows[0].n;
      R('J1 accountant "Journal entry posted" (Dr AR 900 / Cr Revenue 900)', { postStatus: post.status, storedStatus: jr && jr.st, glEntries: gl, revenueBefore: before.revenue, revenueAfter: after.revenue },
        { postStatus: 201, storedStatus: 'Posted', glEntries: 1, revenueBefore: 0, revenueAfter: 900 },
        { postStatus: 201, storedStatus: null, glEntries: 0, revenueBefore: 0, revenueAfter: 0 });
    }

    // ── C15: negative credit note ────────────────────────────────────────────────────────────────
    {
      const { J } = await newOwner('C15');
      await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', idempotency_key: 'c15-inv' });
      const cn = await J('POST', '/api/credit-notes', { customer: 'Acme', amount: -100, date: '2026-06-03', idempotency_key: 'c15-cn' }).catch(e => ({ error: e.message }));
      const rep = await J('GET', '/api/reports');
      R('C15 credit note of −100 accepted?', { created: !cn.error, revenue: rep.revenue, source: rep.source },
        { created: false, revenue: 1000, source: 'gl' }, { created: true, revenue: 1100, source: 'computeBooks' },
        'a credit note can only reduce revenue; −100 raises it and the ledger (which skips amt<=0) disagrees');
    }

    // ── L42: boolean deductible (what the receipt scanner produces) ──────────────────────────────
    {
      const { J } = await newOwner('L42');
      await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', idempotency_key: 'l42-inv' });
      await J('POST', '/api/expenses', { description: 'Software', amount: 100, deductible: true, expense_date: '2026-06-05', idempotency_key: 'l42-exp' });
      await J('POST', '/api/expenses', { description: 'Phone', amount: 40, deductible: 'Yes', expense_date: '2026-06-06', idempotency_key: 'l42-exp2' });
      const tax = await J('GET', '/api/tax-filing');
      R('L42 deductible true (boolean) + "Yes" (capitalised)', { deductible: tax.deductible },
        { deductible: 140 }, { deductible: 40 },
        'server lower-cases "Yes" (counts) but String(true)="true" is not in its vocabulary (0); the client Expenses-page engine counts neither ("Yes"!=="yes")');
    }

    // ── C10: bank debit booked as expense, then the expense deleted ──────────────────────────────
    {
      const { J, ids } = await newOwner('C10');
      const bt = await J('POST', '/api/banking?entity_id=' + ids[0], { desc: 'OFFICE DEPOT', amount: 75, type: 'debit', date: '2026-07-10' });
      const bk = await J('POST', '/api/bank-reconciliation/book-expense', { banking_id: bt.id, category: 'Office' });
      await J('DELETE', '/api/expenses/' + bk.expense.id);
      const rec = await J('GET', '/api/bank-reconciliation?entity_id=' + ids[0]);
      const stillTodo = (rec.unmatchedDebits || []).some(d => d.id === bt.id);
      R('C10 bank debit 75 → booked as expense → expense deleted', { bankDebitBackInToDo: stillTodo },
        { bankDebitBackInToDo: true }, { bankDebitBackInToDo: false }, 'the 75 left the bank and is now in no expense and in no to-do list');
    }

    // ── CSV2: bank CSV with two genuine identical same-day rows ──────────────────────────────────
    {
      const { J, ids } = await newOwner('CSV2');
      const csv = 'Date,Description,Amount\n2026-07-10,COFFEE SHOP,-4.50\n2026-07-10,COFFEE SHOP,-4.50\n';
      const r = await J('POST', '/api/banking/import?entity_id=' + ids[0], { format: 'csv', content: csv, mapping: { date_order: 'mdy' } });
      R('CSV2 bank statement with two identical same-day coffees', { imported: r.imported, skipped: r.skipped },
        { imported: 2, skipped: 0 }, { imported: 1, skipped: 1 });
    }
  } catch (e) {
    console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  console.log('\n==== SUMMARY ====');
  for (const o of out) console.log(o.verdict.padEnd(48) + ' ' + o.id);
})();
