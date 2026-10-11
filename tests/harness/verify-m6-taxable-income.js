'use strict';
/**
 * M6 (money audit 2026-10-09; owner decision): taxable income = revenue − every ordinary cost, with each expense
 * row's own deductible flag still applied (yes = 100%, half = 50%, no = 0%).
 * BUG: taxable = revenue − flagged expense rows only; payroll, COGS and bills were never deducted.
 * Seed (June 2026, values chosen so every leg changes the answer — Rule 4):
 *   revenue 1,000 (invoice) · rent 100 deductible=yes · meals 60 deductible=no · bill 200 · payroll run 500 ·
 *   COGS 40 (buy 10 @ 10, sell 4)
 *   net profit = 1000 − 40 − (100 + 60 + 200 + 500) = 100
 *   taxable    = net profit + non-deductible meals 60 = 160          (bug: 1000 − 100 = 900)
 *   deductions = 40 + 860 − 60 = 840                                 (bug: 100)
 * Read on BOTH surfaces: /api/tax-filing (owner worksheet) and the accountant /books summary (Tax Summary).
 */
const bcrypt = require('bcryptjs');
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

run('M6 — taxable income deducts every ordinary cost', async ({ newOwner, c, eq, A, server }) => {
  const { uid, J } = await newOwner('M6');
  await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-02', due_date: '2026-06-30', idempotency_key: 'm6-inv' });
  await J('POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 100, deductible: 'yes', expense_date: '2026-06-03', idempotency_key: 'm6-rent' });
  await J('POST', '/api/expenses', { description: 'Meals', category: 'Meals', amount: 60, deductible: 'no', expense_date: '2026-06-04', idempotency_key: 'm6-meal' });
  await J('POST', '/api/bills', { vendor: 'Supplier', amount: 200, status: 'unpaid', issue_date: '2026-06-05', due_date: '2026-06-30', idempotency_key: 'm6-bill' });
  await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Field', gross: 500 });
  const run1 = await J('POST', '/api/payroll-runs', { period: 'June 2026' });
  await J('PUT', '/api/payroll-runs/' + run1.id + '/approve', {});
  const item = await J('POST', '/api/inventory', { sku: 'W', name: 'Widget', units: 0, max_units: 100, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 4 });
  // Postgres NOW() is the real clock; the JS clock is pinned to 2026-07-25. Date the stock movements in June.
  await c.query(`UPDATE inventory_movements SET moved_at = '2026-06-10T12:00:00Z', movement_date = '2026-06-10' WHERE user_id = $1`, [uid]);

  const rep = await J('GET', '/api/reports');
  eq('net profit (control)', rep.netProfit, 100);
  const tf = await J('GET', '/api/tax-filing?fyStart=0');
  eq('owner worksheet: taxable income', tf.taxableIncome, 160, 900);
  eq('owner worksheet: deductions', tf.deductible, 840, 100);
  A('taxable = net profit + non-deductible expense rows', tf.taxableIncome === rep.netProfit + 60, `taxable ${tf.taxableIncome}, net ${rep.netProfit}`);

  // Accountant Tax Summary reads the same computeBooks figure.
  const PW = 'm6-acc-pw-not-a-secret';
  const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ('m6-acc@finflow.test', $1, 'M', 'Six', 'Firm', 'M6REF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
  const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.201' });
  A('accountant login', (await ACC.post('/api/accountants/login', { email: 'm6-acc@finflow.test', password: PW })).status === 200);
  const books = await ACC.get(`/api/accountants/clients/${uid}/books?period=year`);
  const sm = (books.json && books.json.summary) || {};
  eq('accountant Tax Summary: taxable income', Number(sm.taxableIncome), 160, undefined);
  eq('accountant Tax Summary: deductions', Number(sm.taxDeductions), 840, undefined);
});
