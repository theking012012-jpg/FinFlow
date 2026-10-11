'use strict';
/**
 * clientMoneyKit.js — shared boot + seed for the money-audit CLIENT fix harnesses (verify-m*-client-*.js).
 * Boots the REAL SPA in jsdom against a real scratch Postgres seeded through the real routes (the seed of
 * tools/money-audit-2026-10-09/client-items.js, whose hand-computed values are below). Reads rendered DOM text
 * (jsdomBoot rule); driving the app's own controls (setPeriod, showPage, generateReport, form saves) simulates
 * a click.
 *
 * HAND-COMPUTED (clock pinned 2026-07-25, fiscal year Jan–Dec):
 *   revenue  Year 1,820 (Jan 1,000 + Jun 300 + Jul 600 − credit note 80) · July 520 · June 300
 *   opex     Year 2,900 (rent 500 + payroll 2,000 + bill 400) · July 2,900 · June 0
 *   COGS     June 20 (4 @ 5) · July 10 (2 @ 5) · Year 30
 *   net      Year −1,110 · July −2,390 · June 280
 *   AR       billed 1,900 (draft 9,999 excluded) · collected 550 (250 + 300)
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

async function seed({ http }) {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0, 200)}`); return r.json; };
  const ent = (await J('POST', '/api/entities', { name: 'Business A', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
  await J('POST', '/api/entities/' + ent + '/activate', {});
  await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 1000, status: 'pending', issue_date: '2026-01-10', due_date: '2026-02-10', idempotency_key: 'i1' });
  const i2 = await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 600, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-15', idempotency_key: 'i2' });
  await J('POST', '/api/invoice-payments', { invoice_id: i2.id, amount: 250, payment_date: '2026-07-03', idempotency_key: 'p2' });
  const i3 = await J('POST', '/api/invoices', { client: 'Beta Co', amount: 300, status: 'pending', issue_date: '2026-06-04', due_date: '2026-06-30', idempotency_key: 'i3' });
  await J('POST', '/api/invoice-payments', { invoice_id: i3.id, amount: 300, payment_date: '2026-06-05', idempotency_key: 'p3' });
  await J('POST', '/api/invoices', { client: 'Gamma', amount: 9999, status: 'draft', issue_date: '2026-07-06', idempotency_key: 'i4' });
  await J('POST', '/api/credit-notes', { customer: 'Acme Ltd', amount: 80, date: '2026-07-07', status: 'Open', idempotency_key: 'cn' });
  await J('POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 500, deductible: 'yes', expense_date: '2026-07-01', idempotency_key: 'e1' });
  await J('POST', '/api/bills', { vendor: 'Supply Co', amount: 400, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-10', idempotency_key: 'b1' });
  await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Field', gross: 2000, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
  const run = await J('POST', '/api/payroll-runs', { period: 'July 2026', idempotency_key: 'run-jul' });   // the UI's default period format
  await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
  const item = await J('POST', '/api/inventory', { sku: 'W1', name: 'Widget', units: 0, max_units: 100, cost: 5 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 5, date: '2026-06-01', idempotency_key: 'mv1' });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 4, date: '2026-06-15', idempotency_key: 'mv2' });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 2, date: '2026-07-10', idempotency_key: 'mv3' });
  await J('POST', '/api/recurring-bills', { vendor: 'Net Host', amount: 100, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' });
  const prof = await J('POST', '/api/recurring-personal-transactions', { description: 'Side gig', amount: 1000, currency: 'USD', category: 'Salary', tx_type: 'income', frequency: 'Monthly', status: 'active', next_run: '2026-08-01' });
  await J('POST', '/api/personal-transactions', { description: 'Side gig', amount: 1000, currency: 'USD', category: 'Salary', tx_type: 'income', tx_date: '2026-07-15', recurring_profile_id: prof.id });
  await J('POST', '/api/personal-transactions', { description: 'Groceries', amount: 200, currency: 'USD', category: 'Groceries', tx_type: 'expense', tx_date: '2026-07-20' });
  await J('POST', '/api/personal-accounts', { name: 'Car', kind: 'asset', type: 'other', value: 1000 });
  return { ent };
}

// run(title, body, { extraSeed }) — boots, seeds, hands body({ w, d, ev, all, text, settle, http, A, eq }).
function run(title, body, opts = {}) {
  (async () => {
    let boot, pass = 0, fail = 0;
    const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  ' + det : ''))); };
    const eq = (n, measured, expected, bug) => {
      const m = JSON.stringify(measured), e = JSON.stringify(expected);
      A(n + `  [measured ${m}, correct ${e}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`, m === e);
    };
    console.log('\n' + title + '\n');
    try {
      boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async (ctx) => { const r = await seed(ctx); if (opts.extraSeed) await opts.extraSeed(ctx, r); } });
      const { window: w, settle, text, http } = boot;
      const d = w.document;
      const ev = (src) => w.eval(src);
      const all = (id) => { const el = d.getElementById(id); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; };
      await settle(80, 75);
      await body({ w, d, ev, all, text, settle, http, A, eq });
    } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
    finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
    process.exitCode = fail === 0 ? 0 : 1;
  })();
}

module.exports = { run, seed };
