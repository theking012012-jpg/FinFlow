'use strict';
/**
 * sweep-client.js — WHOLE-APP SWEEP, CLIENT (browser-rendered) figures via jsdom.
 * Companion to sweep-businessA.js (which read the server endpoints). Boots the REAL SPA in jsdom with
 * a CLEAN database (baseSeed:false) seeded with dataset A1–A21 through the real routes, then reads the
 * figures the BROWSER renders — the native dashboard KPIs (d-rev/d-exp/d-profit/d-outstanding) and
 * page cards — to catch client-mirror divergence (M10/M27/M29/M37). Scratch only; never production.
 *
 *   node -r ./tests/harness/clock-oct.js tools/money-audit-2026-10-09/sweep-client.js
 */
require('../../tests/harness/clock-oct.js');
const { bootSpaInJsdom } = require('../../tests/harness/jsdomBoot.js');

const num = (s) => { if (s == null) return null; let str = String(s).replace(/−/g, '-'); const mult = /k/i.test(str) ? 1000 : /m/i.test(str) ? 1e6 : 1; const m = str.replace(/[^0-9.\-]/g, ''); const n = parseFloat(m); return Number.isFinite(n) ? n * mult : null; };
// Abbreviated KPI cards ($2.1K) carry ~1-decimal precision, so compare magnitude within a K-rounding band.
const near = (a, b) => a != null && Math.abs(a - b) <= 100;

async function seedA(http) {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0,200)}`); return r.json; };
  const entId = (await J('POST', '/api/entities', { name: 'Business A', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
  await J('POST', '/api/entities/' + entId + '/activate', {});
  await J('POST', '/api/customers', { fname: 'Ann', lname: 'Lee', company: 'Acme Ltd' });
  await J('POST', '/api/vendors', { name: 'Supply Co' }); await J('POST', '/api/vendors', { name: 'Net Host' });
  await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 1000, status: 'pending', issue_date: '2026-09-05', due_date: '2026-09-20' });
  const a4 = await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 600, status: 'pending', issue_date: '2026-10-02', due_date: '2026-11-01' });
  await J('POST', '/api/invoice-payments', { invoice_id: a4.id, amount: 250, payment_date: '2026-10-03' });
  const a5 = await J('POST', '/api/invoices', { client: 'Beta Co', amount: 300, status: 'pending', issue_date: '2026-10-04', due_date: '2026-10-30' });
  await J('POST', '/api/invoice-payments', { invoice_id: a5.id, amount: 300, payment_date: '2026-10-05' });
  await J('POST', '/api/invoices', { client: 'Gamma', amount: 9999, status: 'draft', issue_date: '2026-10-06' });
  await J('POST', '/api/invoices', { client: 'Delta', amount: 450, status: 'pending', issue_date: '2026-12-01', due_date: '2026-12-31' });
  await J('POST', '/api/invoices', { client: 'Old Client', amount: 777, status: 'pending', issue_date: '2025-11-15', due_date: '2025-12-15' });
  await J('POST', '/api/sales-receipts', { customer: 'Walk-in', amount: 120, date: '2026-10-07', method: 'Cash' });
  await J('POST', '/api/credit-notes', { customer: 'Acme Ltd', amount: 80, date: '2026-10-07', status: 'Open' });
  await J('POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 500, expense_date: '2026-10-01', deductible: 'Yes' });
  await J('POST', '/api/expenses', { description: 'Lunch', category: 'Meals', amount: 60, expense_date: '2026-09-12', deductible: 'Half' });
  const a13 = await J('POST', '/api/bills', { vendor: 'Supply Co', amount: 400, status: 'unpaid', issue_date: '2026-09-10', due_date: '2026-09-25' });
  await J('POST', '/api/payments-made', { vendor: 'Supply Co', amount: 150, date: '2026-10-02', bill_id: a13.id });
  await J('POST', '/api/bills', { vendor: 'Net Host', amount: 90, status: 'unpaid', issue_date: '2026-10-03', due_date: '2026-11-15' });
  await J('POST', '/api/payments-made', { vendor: 'Courier', amount: 35, date: '2026-10-04' });
  await J('POST', '/api/vendor-credits', { vendor: 'Supply Co', amount: 25, date: '2026-10-05', status: 'Open' });
  await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Field', gross: 2000, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
  const rSep = await J('POST', '/api/payroll-runs', { period: 'September 2026' });
  await J('PUT', '/api/payroll-runs/' + rSep.id + '/approve', {}); await J('PUT', '/api/payroll-runs/' + rSep.id + '/mark-paid', {});
  const rOct = await J('POST', '/api/payroll-runs', { period: 'October 2026' });
  await J('PUT', '/api/payroll-runs/' + rOct.id + '/approve', {});
  const item = await J('POST', '/api/inventory', { sku: 'WID', name: 'Widget', units: 0, max_units: 1000, cost: 5 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 20, unit_cost: 5 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 8 });
  await J('POST', '/api/journals', { date: '2026-10-08', description: 'Sweep JE', status: 'Posted', lines: [{ code: '1010', debit: 200, credit: 0 }, { code: '4000', debit: 0, credit: 200 }] });
  await J('PUT', '/api/budget-targets', { Rent: 6000 });
  await J('POST', '/api/fx-rates', { from_currency: 'USD', to_currency: 'EUR', rate: 0.90, rate_date: '2026-01-01' });
}

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => { await seedA(http); } });
    const { window, settle } = boot;
    const doc = window.document;
    await settle(90, 60);
    const txt = (id) => { const el = doc.getElementById(id); return el ? el.textContent : '<no-el>'; };

    // jsdomBoot pins the WINDOW clock to 2026-07-25 (standard clock.js), but this dataset is October.
    // Re-pin the window clock to 2026-10-09 so the client's period window matches the dataset and the
    // server (node clock, clock-oct.js). Without this the client treats all Oct rows as future (D2).
    const OCT = Date.parse('2026-10-09T16:00:00.000Z');
    const BaseD = window.Date;
    class OctDate extends BaseD { constructor(...a) { if (a.length === 0) { super(OCT); return; } super(...a); } static now() { return OCT; } }
    window.Date = OctDate;

    // ── Dashboard NATIVE KPIs (Year) — the client's own computeRevenue path, not /api/reports ──
    try { if (typeof window.updateDashboard === 'function') window.updateDashboard(); } catch (_) {}
    await settle(20, 50);
    const rev = num(txt('d-rev')), exp = num(txt('d-exp')), prof = num(txt('d-profit')), outs = num(txt('d-outstanding'));
    console.log(`\n  CLIENT dashboard (Year, native): d-rev=${txt('d-rev')} d-exp=${txt('d-exp')} d-profit=${txt('d-profit')} d-outstanding=${txt('d-outstanding')}`);
    A('[M-mirror] native dashboard Revenue ≈ server 2,140 (card abbreviates)', near(rev, 2140), 'client=' + rev);
    A('[M-mirror] native dashboard Expenses ≈ server 5,060 (card abbreviates)', near(exp, 5060), 'client=' + exp);
    A('[M-mirror] native dashboard Net ≈ server −2,960 (card abbreviates)', near(prof, -2960), 'client=' + prof);
    A('[M-mirror] native dashboard Outstanding == server 2,047 (exact)', outs === 2047, 'client=' + outs);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (client dashboard native)\n`);
  } catch (e) { console.error('\n  CLIENT SWEEP FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
