'use strict';
/**
 * sweep-businessA.js — WHOLE-APP SWEEP, scratch run (task 4 of the audit-completion brief).
 * Seeds dataset A1–A21 into a throwaway Postgres THROUGH THE REAL ROUTES, then reads every report
 * endpoint per period and dumps the raw JSON. Compares headline figures to the expected-values sheet
 * ("FinFlow Money Audit — Scratch + Live Results"). Scratch only; never production.
 *
 *   node -r ./tests/harness/clock-oct.js tools/money-audit-2026-10-09/sweep-businessA.js
 */
require('../../tests/harness/clock-oct.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('../../tests/harness/pgScratch.js');
const { bootServer } = require('../../tests/harness/boot.js');
const { HarnessHttp } = require('../../tests/harness/httpClient.js');

const PW = 'sweep-pw-not-a-secret';
const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server;
  const dump = {};
  try {
    server = await bootServer(scratch.url);
    const email = 'sweep-a@finflow.test';
    const uid = (await c.query(
      `INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: 'Sweep A', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.77' });
    if ((await http.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login failed');

    // J: throw-on-error request; S: soft request that records the error instead of throwing (so one
    // bad seed row does not abort the whole sweep — we want to see everything that lands).
    const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0, 300)}`); return r.json; };
    const S = async (tag, m, p, b) => { try { const r = await http.request(m, p, b); if (r.status >= 300) { say(`  SEED-FAIL ${tag}: ${m} ${p} -> ${r.status} ${String(r.text).slice(0,200)}`); return null; } return r.json; } catch (e) { say(`  SEED-ERR ${tag}: ${e.message}`); return null; } };

    // Business A: USD, fiscal year January (default). Entity tz UTC so explicit dates are unambiguous.
    const entId = (await J('POST', '/api/entities', { name: 'Business A', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
    await J('POST', '/api/entities/' + entId + '/activate', {});
    say('=== seeded owner + Business A (USD, FY Jan), entity id ' + entId + ' ===');

    // ── A1–A21 (exact names/amounts/dates; dates are YYYY-MM-DD) ───────────────────────────────
    await S('A1 customer', 'POST', '/api/customers', { fname: 'Ann', lname: 'Lee', company: 'Acme Ltd' });
    await S('A2 vendor SupplyCo', 'POST', '/api/vendors', { name: 'Supply Co' });
    await S('A2 vendor NetHost', 'POST', '/api/vendors', { name: 'Net Host' });

    await S('A3 inv', 'POST', '/api/invoices', { client: 'Acme Ltd', amount: 1000, status: 'pending', issue_date: '2026-09-05', due_date: '2026-09-20' });
    const a4 = await S('A4 inv', 'POST', '/api/invoices', { client: 'Acme Ltd', amount: 600, status: 'pending', issue_date: '2026-10-02', due_date: '2026-11-01' });
    if (a4) await S('A4 pay', 'POST', '/api/invoice-payments', { invoice_id: a4.id, amount: 250, payment_date: '2026-10-03' });
    const a5 = await S('A5 inv', 'POST', '/api/invoices', { client: 'Beta Co', amount: 300, status: 'pending', issue_date: '2026-10-04', due_date: '2026-10-30' });
    if (a5) await S('A5 pay', 'POST', '/api/invoice-payments', { invoice_id: a5.id, amount: 300, payment_date: '2026-10-05' });
    await S('A6 inv draft', 'POST', '/api/invoices', { client: 'Gamma', amount: 9999, status: 'draft', issue_date: '2026-10-06' });
    await S('A7 inv future', 'POST', '/api/invoices', { client: 'Delta', amount: 450, status: 'pending', issue_date: '2026-12-01', due_date: '2026-12-31' });
    await S('A8 inv old', 'POST', '/api/invoices', { client: 'Old Client', amount: 777, status: 'pending', issue_date: '2025-11-15', due_date: '2025-12-15' });

    await S('A9 sales-receipt', 'POST', '/api/sales-receipts', { customer: 'Walk-in', amount: 120, date: '2026-10-07', method: 'Cash' });
    await S('A10 credit-note', 'POST', '/api/credit-notes', { customer: 'Acme Ltd', amount: 80, date: '2026-10-07', status: 'Open' });

    await S('A11 expense Rent', 'POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 500, expense_date: '2026-10-01', deductible: 'Yes' });
    await S('A12 expense Lunch', 'POST', '/api/expenses', { description: 'Lunch', category: 'Meals', amount: 60, expense_date: '2026-09-12', deductible: 'Half' });

    const a13 = await S('A13 bill', 'POST', '/api/bills', { vendor: 'Supply Co', amount: 400, status: 'unpaid', issue_date: '2026-09-10', due_date: '2026-09-25' });
    if (a13) await S('A13 pay', 'POST', '/api/payments-made', { vendor: 'Supply Co', amount: 150, date: '2026-10-02', bill_id: a13.id });
    await S('A14 bill', 'POST', '/api/bills', { vendor: 'Net Host', amount: 90, status: 'unpaid', issue_date: '2026-10-03', due_date: '2026-11-15' });
    await S('A15 payment-made', 'POST', '/api/payments-made', { vendor: 'Courier', amount: 35, date: '2026-10-04' });
    await S('A16 vendor-credit', 'POST', '/api/vendor-credits', { vendor: 'Supply Co', amount: 25, date: '2026-10-05', status: 'Open' });

    // A17 payroll: Sam Field gross 2000, Tax 10% → net 1800. Sep run approve+paid; Oct run approve only.
    await S('A17 employee', 'POST', '/api/payroll', { fname: 'Sam', lname: 'Field', gross: 2000, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
    const runSep = await S('A17 run Sep', 'POST', '/api/payroll-runs', { period: 'September 2026' });
    if (runSep) { await S('A17 approve Sep', 'PUT', '/api/payroll-runs/' + runSep.id + '/approve', {}); await S('A17 paid Sep', 'PUT', '/api/payroll-runs/' + runSep.id + '/mark-paid', {}); }
    const runOct = await S('A17 run Oct', 'POST', '/api/payroll-runs', { period: 'October 2026' });
    if (runOct) await S('A17 approve Oct', 'PUT', '/api/payroll-runs/' + runOct.id + '/approve', {});

    // A18 inventory: Widget cost 5, stock in 20 @ 5, stock out 8 → on hand 12, COGS 40.
    const item = await S('A18 item', 'POST', '/api/inventory', { sku: 'WID', name: 'Widget', units: 0, max_units: 1000, cost: 5 });
    if (item) { await S('A18 purchase', 'POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 20, unit_cost: 5 }); await S('A18 sale', 'POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 8 }); }

    // A19 journal POSTED: Dr 1010 Checking 200 / Cr 4000 Revenue 200.
    await S('A19 journal', 'POST', '/api/journals', { date: '2026-10-08', description: 'Sweep JE', status: 'Posted', lines: [{ code: '1010', debit: 200, credit: 0 }, { code: '4000', debit: 0, credit: 200 }] });

    // A20 budget: annual Rent target 6000.
    await S('A20 budget', 'PUT', '/api/budget-targets', { Rent: 6000 });
    // A21 FX USD->EUR 0.90 dated 1 Jan 2026.
    await S('A21 fx', 'POST', '/api/fx-rates', { from_currency: 'USD', to_currency: 'EUR', rate: 0.90, rate_date: '2026-01-01' });

    say('=== seeding complete; reading figures ===');

    // ── READ every report endpoint, per period ────────────────────────────────────────────────
    const g = async (key, p) => { try { dump[key] = (await http.request('GET', p)).json; } catch (e) { dump[key] = { _error: e.message }; } };
    const po = async (key, p, b) => { try { dump[key] = (await http.request('POST', p, b || {})).json; } catch (e) { dump[key] = { _error: e.message }; } };
    await g('reports_year', '/api/reports?period=year&fyStart=0');
    await g('reports_oct', '/api/reports?period=month&monthIdx=9&fyStart=0');
    await g('reports_sep', '/api/reports?period=month&monthIdx=8&fyStart=0');
    await g('reports_q4', '/api/reports?period=quarter&monthIdx=9&fyStart=0');
    await g('reports_eur', '/api/reports?period=year&fyStart=0&display=EUR');
    await po('pl_year', '/api/reports/profit-loss?period=year&fyStart=0');
    await po('balance_sheet', '/api/reports/balance-sheet?period=year&fyStart=0');
    await po('cash_flow', '/api/reports/cash-flow?period=year&fyStart=0');
    await g('tax_filing', '/api/tax-filing');
    await g('cogs', '/api/cogs');
    await g('top_clients', '/api/reports/top-clients');
    await g('ar_by_customer', '/api/reports/ar-by-customer');
    await g('forecast', '/api/cashflow-forecast');
    await g('payroll_runs', '/api/payroll-runs');
    await g('invoices', '/api/invoices');
    await g('bills', '/api/bills');
    await g('vendors', '/api/vendors');
    await g('inventory', '/api/inventory');

    fs.writeFileSync(__dirname + '/_sweep_dump.json', JSON.stringify(dump, null, 2));
    say('=== wrote raw dump to tools/money-audit-2026-10-09/_sweep_dump.json ===');

    // ── Headline figures I can map confidently now (rest mapped from the dump) ───────────────────
    const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const ry = dump.reports_year || {}, ro = dump.reports_oct || {}, rs = dump.reports_sep || {};
    say('\n--- HEADLINE (measured) ---');
    say(`reports_year keys: ${Object.keys(ry).join(', ')}`);
    say(`Year  revenue=${ry.revenue} expenses=${ry.expenses} net=${ry.netProfit!=null?ry.netProfit:ry.net} outstanding=${ry.outstanding} overdue=${ry.overdue}`);
    say(`Oct   revenue=${ro.revenue} expenses=${ro.expenses} net=${ro.netProfit!=null?ro.netProfit:ro.net}`);
    say(`Sep   revenue=${rs.revenue} expenses=${rs.expenses} net=${rs.netProfit!=null?rs.netProfit:rs.net}`);
    say(`P&L year keys: ${Object.keys(dump.pl_year||{}).join(', ')}`);
    say(`BS keys: ${Object.keys(dump.balance_sheet||{}).join(', ')}`);
    say(`cash_flow keys: ${Object.keys(dump.cash_flow||{}).join(', ')}`);
    say(`tax_filing keys: ${Object.keys(dump.tax_filing||{}).join(', ')}`);
    say(`cogs: ${JSON.stringify(dump.cogs).slice(0,200)}`);
    say(`payroll_runs count: ${Array.isArray(dump.payroll_runs)?dump.payroll_runs.length:'n/a'}`);

    fs.writeFileSync(__dirname + '/_sweep_log.txt', log.join('\n'));
  } catch (e) {
    console.error('\n  SWEEP FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.errors) for (const se of e.errors) console.error('   sub:', se && se.message);
    fs.writeFileSync(__dirname + '/_sweep_log.txt', log.join('\n') + '\n\nFATAL: ' + (e && e.stack || e));
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
})();
