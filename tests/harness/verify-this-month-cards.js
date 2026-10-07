'use strict';
/**
 * verify-this-month-cards.js — Phase 1.1 / L5 (Rule 13 class): every summary card LABELLED "This month"
 * must show this calendar month's value, not an all-time total.
 *
 * Class, enumerated both directions (index.html cards whose sub-label is "This month" ↔ their writers):
 *   Payments Received · Received        wiring-pages renderPaymentsReceived   (was Σ all payments)
 *   Vendors · Paid                      wiring-pages renderVendors            (was Σ all payments made)
 *   Bills · Paid                        wiring-pages renderBills              (was Σ amount of FULLY-paid bills, all-time)
 *   Payments Made · Paid, Vendors Paid  wiring-pages renderPaymentsMade       (was all-time)
 *   Sales Receipts · Total Receipts     wiring-pages renderReceipts           (was all-time count)
 *   Quotes · Total Quotes               wiring-pages renderQuotes             (was all-time count)
 *   Manual Journals · Total Debits/Credits  app-main renderJournalsLive       (was all-time)
 *   Projects · Billable Hours           wiring-extra renderProjectsList       (was all-time)
 *   Timesheet · Hours Logged (+ Billable / Non-Billable / Avg per Day)  wiring-extra updateTimesheetMetrics (was all-time)
 *   Already correct, kept as controls: Credit Notes · This Month, Vendor Credits · This Month.
 *
 * Seed: fullLegScenario (June 2026 rows) + July 2026 rows below; clock pinned 2026-07-25, so "this month"
 * is July. Hand-computed July values, and what the buggy all-time code shows instead:
 *   Received 9 (bug 69) · Vendors Paid 5 (bug 27) · Bills Paid 5 (bug 0) · Payments Made Paid 5 (bug 27),
 *   Vendors Paid 1 (bug 2) · Receipts 1 (bug 2) · Quotes 1 (bug 2) · JE debits 4 (bug 46) ·
 *   Billable hours 2.0 (bug 5.0) · Hours logged 3 (bug 6) · CN This Month 0 · VC This Month 0.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-this-month-cards.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const num = s => { const m = String(s == null ? '' : s).replace(/[,\s]/g, '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

async function seed({ http, client }) {
  const ids = await postFullLegScenario({ http, client });
  const ok = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
  await ok('/api/invoice-payments', { invoice_id: ids.invoiceId, amount: 9, payment_date: '2026-07-12', method: 'bank' });
  await ok('/api/payments-made', { vendor: 'Supplier', amount: 5, date: '2026-07-10', method: 'bank', bill_id: ids.billId });
  await ok('/api/sales-receipts', { customer: 'Walk-in', num: 'SR-2', amount: 6, date: '2026-07-11', method: 'Card' });
  await ok('/api/journals', { date: '2026-07-13', description: 'July accrual', status: 'Posted',
    lines: [{ code: '5100', name: 'Rent', debit: 4, credit: 0 }, { code: '1010', name: 'Checking', debit: 0, credit: 4 }] });
  const q1 = await ok('/api/quotes', { client: 'Acme', amount: 50, expiry_date: '2026-08-30' });
  const q2 = await ok('/api/quotes', { client: 'Beta', amount: 70, expiry_date: '2026-08-30' });
  // quotes carry no business date — created_at is the DB's real NOW(); place them in June and July
  await client.query(`UPDATE quotes SET created_at = $2 WHERE id = $1`, [q1.id, '2026-06-03T12:00:00Z']);
  await client.query(`UPDATE quotes SET created_at = $2 WHERE id = $1`, [q2.id, '2026-07-03T12:00:00Z']);
  await ok('/api/timesheet', { employee: 'Ann Lee', project: '', date: '2026-06-20', hours: 3, billable: 'Yes', rate: 0 });
  await ok('/api/timesheet', { employee: 'Ann Lee', project: '', date: '2026-07-14', hours: 2, billable: 'Yes', rate: 0 });
  await ok('/api/timesheet', { employee: 'Ann Lee', project: '', date: '2026-07-15', hours: 1, billable: 'No', rate: 0 });
  return ids;
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L5 — "This month" cards show this month (July), not all-time\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window, settle } = ctx;
    const d = window.document;
    await settle(60, 100);
    const card = (page, label) => {
      const pg = d.getElementById('page-' + page); if (!pg) return null;
      const c = [...pg.querySelectorAll('.mc')].find(m => (m.querySelector('.mc-label') || {}).textContent === label);
      return c ? { val: c.querySelector('.mc-val').textContent.trim(), sub: (c.querySelector('.mc-change') || {}).textContent } : null;
    };
    const visit = async p => { window.showPage(p); await settle(25, 100); };
    const check = (page, label, want, bug) => {
      const c = card(page, label);
      A(`${page} · ${label} (${c && c.sub}) == ${want}  [all-time bug: ${bug}]`, c && Math.abs(num(c.val) - want) < 0.01, 'shown=' + (c && c.val));
    };

    await visit('payments-received'); check('payments-received', 'Received', 9, 69);
    await visit('vendors');           check('vendors', 'Paid', 5, 27);
    await visit('bills');             check('bills', 'Paid', 5, 0);
    await visit('payments-made');     check('payments-made', 'Paid', 5, 27); check('payments-made', 'Vendors Paid', 1, 2);
    await visit('sales-receipts');    check('sales-receipts', 'Total Receipts', 1, 2);
    await visit('quotes');            check('quotes', 'Total Quotes', 1, 2);
    await visit('manual-journals');   check('manual-journals', 'Total Debits', 4, 46); check('manual-journals', 'Total Credits', 4, 46);
    await visit('projects');          check('projects', 'Billable Hours', 2, 5);
    await visit('timesheet');         check('timesheet', 'Hours Logged', 3, 6);
    // controls — already month-filtered before this fix; must stay right
    await visit('credit-notes');      check('credit-notes', 'This Month', 0, 'n/a (control)');
    await visit('vendor-credits');    check('vendor-credits', 'This Month', 0, 'n/a (control)');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (This-month cards)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
