'use strict';
/*
 * verify-gl-readswap-consistency.js - GL Phase 5b (slice 5, migration): with a COMPLETE, route-seeded
 * ledger, every swapped read reports source:'gl' AND the surfaces AGREE - the dashboard, the P&L
 * statement and the balance sheet are one coherent set of ledger-sourced numbers. Also proves the
 * consolidated view falls back consistently (all three source:'computeBooks').
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-readswap-consistency.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 5b - all swapped reads are ledger-sourced AND agree (dashboard = P&L = balance sheet)\n' + '='.repeat(78) + '\n');
    const email = 'glcon@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Con Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.89' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const getRep = async q => JSON.parse((await http.request('GET', '/api/reports' + q)).text);
    const pnl = async q => JSON.parse((await http.post('/api/reports/profit-loss' + q, {})).text);
    const bsheet = async q => JSON.parse((await http.post('/api/reports/balance-sheet' + q, {})).text);

    // Complete, reconciling ledger: invoice 1000 + partial payment 400 (AR 600, cash +400),
    // expense 200 (cash -200), bill 300 unpaid (AP 300). revenue 1000, opex 500, net 500.
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).text);
    A('partial payment 400', (await http.post('/api/invoice-payments', { invoice_id: inv.id, amount: 400, payment_date: '2026-06-05' })).status < 300);
    A('expense 200', (await http.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-02', category: 'Office', entity_id: eid })).status < 300);
    A('bill 300 unpaid', (await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-02', entity_id: eid })).status < 300);

    const q = '?entity_id=' + eid;
    const dash = await getRep(q), pl = await pnl(q), bs = await bsheet(q);

    // 1) all three ledger-sourced
    A('dashboard source = gl', dash.source === 'gl', JSON.stringify({ source: dash.source }));
    A('P&L statement source = gl', pl.source === 'gl', JSON.stringify({ source: pl.source }));
    A('balance sheet source = gl', bs.source === 'gl', JSON.stringify({ source: bs.source }));

    // 2) surfaces agree on the shared P&L figures
    A('dashboard revenue == P&L totalRevenue (1000)', near(dash.revenue, pl.totalRevenue) && near(dash.revenue, 1000), 'dash=' + dash.revenue + ' pl=' + pl.totalRevenue);
    A('dashboard expenses == P&L totalExpenses (500)', near(dash.expenses, pl.totalExpenses) && near(dash.expenses, 500), 'dash=' + dash.expenses + ' pl=' + pl.totalExpenses);
    A('dashboard netProfit == P&L netProfit (500)', near(dash.netProfit, pl.netProfit) && near(dash.netProfit, 500), 'dash=' + dash.netProfit + ' pl=' + pl.netProfit);
    A('dashboard cogs == P&L cogs (0)', near(dash.cogs, pl.cogs) && near(dash.cogs, 0));

    // 3) balance sheet is coherent + ties to the P&L net (equity = retained earnings = net for the period)
    A('balance sheet real cash tracked = 200', bs.cashTracked === true && near(bs.cash, 200), JSON.stringify({ cashTracked: bs.cashTracked, cash: bs.cash }));
    A('balance sheet AR 600 (== dashboard outstanding)', near(bs.accountsReceivable, 600) && near(dash.outstanding, 600), 'bsAR=' + bs.accountsReceivable + ' dashOut=' + dash.outstanding);
    A('balance sheet AP 300', near(bs.accountsPayable, 300));
    A('balance sheet A = L + E (800 = 300 + 500)', near(bs.totalAssets, bs.totalLiabilities + bs.equity) && near(bs.totalAssets, 800) && near(bs.equity, 500), JSON.stringify({ ta: bs.totalAssets, tl: bs.totalLiabilities, eq: bs.equity }));
    A('balance sheet equity == P&L netProfit (retained earnings)', near(bs.equity, pl.netProfit), 'eq=' + bs.equity + ' net=' + pl.netProfit);

    // 4) consolidated view falls back consistently across all three
    const qa = '?entity_id=all';
    const dashA = await getRep(qa), plA = await pnl(qa), bsA = await bsheet(qa);
    A('consolidated: all three source = computeBooks', dashA.source === 'computeBooks' && plA.source === 'computeBooks' && bsA.source === 'computeBooks', JSON.stringify({ dash: dashA.source, pl: plA.source, bs: bsA.source }));
    A('consolidated balance sheet reverts to AR-only stub (cash not tracked)', bsA.cashTracked === false && bsA.totalAssetsExcludesCash === true, JSON.stringify({ cashTracked: bsA.cashTracked }));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (all reads ledger-sourced + coherent; consolidated falls back)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
