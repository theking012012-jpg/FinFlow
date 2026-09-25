'use strict';
/*
 * verify-gl-bs-readswap.js - GL Phase 5b (slice 3): the balance sheet reports a REAL cash balance from
 * the ledger when the entity's books provably reconcile, else the honest AR-only stub (F123). The gate:
 * trial balance ties + P&L reconciles + GL AR/AP == canonical AR/AP.
 *   - complete ledger: source 'gl', cashTracked true, real cash, assets = cash+AR (+inv), A = L + E.
 *   - broken ledger: source 'computeBooks', cash null, cashTracked false (safety net).
 *   - consolidated (entity null): source 'gl' with real cash (single-currency consolidation reconciles).
 *   - live POST /api/reports/balance-sheet?entity_id=<e> reflects the same.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-bs-readswap.js
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
    const { glBalanceSheet } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 5b - balance sheet reports REAL cash from the ledger when reconciled, else AR-only stub\n' + '='.repeat(78) + '\n');
    const email = 'glbs@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'BS Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.87' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    // Seed a COMPLETE, reconciling ledger: invoice 1000 + full payment (cash+1000, AR 0),
    // expense 200 (cash-200), bill 300 unpaid (AP 300). => cash 800, AR 0, AP 300, equity 500.
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).text);
    A('invoice payment 1000', (await http.post('/api/invoice-payments', { invoice_id: inv.id, amount: 1000, payment_date: '2026-06-05' })).status < 300);
    A('expense 200', (await http.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-02', category: 'Office', entity_id: eid })).status < 300);
    A('bill 300 unpaid', (await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-02', entity_id: eid })).status < 300);

    // 1) complete ledger -> GL balance sheet with real cash
    const bs = await glBalanceSheet(uid, eid);
    A('complete ledger -> source gl', bs.source === 'gl', JSON.stringify(bs));
    A('cashTracked true + real cash = 800', bs.cashTracked === true && near(bs.cash, 800), JSON.stringify({ cashTracked: bs.cashTracked, cash: bs.cash }));
    A('AR 0, AP 300', near(bs.accountsReceivable, 0) && near(bs.accountsPayable, 300), JSON.stringify({ ar: bs.accountsReceivable, ap: bs.accountsPayable }));
    A('totalAssets = 800 (cash+AR), excludesCash false', near(bs.totalAssets, 800) && bs.totalAssetsExcludesCash === false, JSON.stringify({ ta: bs.totalAssets, excl: bs.totalAssetsExcludesCash }));
    A('equity 500 and A = L + E', near(bs.equity, 500) && near(bs.totalAssets, bs.totalLiabilities + bs.equity), JSON.stringify({ eq: bs.equity, ta: bs.totalAssets, tl: bs.totalLiabilities }));

    // 2) live endpoint
    const ep = JSON.parse((await http.post('/api/reports/balance-sheet?entity_id=' + eid, {})).text);
    A('endpoint source gl + cash 800 + excludesCash false', ep.source === 'gl' && near(ep.cash, 800) && ep.cashTracked === true && ep.totalAssetsExcludesCash === false, JSON.stringify({ source: ep.source, cash: ep.cash, excl: ep.totalAssetsExcludesCash }));

    // 3) consolidated -> gl (real cash)
    const bsAll = await glBalanceSheet(uid, null);
    A('consolidated (entity null) -> source gl + real cash', bsAll.source === 'gl' && typeof bsAll.cash === 'number' && bsAll.cashTracked === true, JSON.stringify(bsAll));

    // 4) broken ledger -> fallback stub
    const del = await c.query(`DELETE FROM ledger_lines WHERE user_id=$1 AND account_id=(SELECT id FROM ledger_accounts WHERE user_id=$1 AND entity_id=$2 AND code='1000') AND debit>0`, [uid, eid]);
    A('broke the ledger (deleted a Cash debit line)', del.rowCount >= 1, 'deleted ' + del.rowCount);
    const bsBroken = await glBalanceSheet(uid, eid);
    A('broken ledger -> source computeBooks (safety net)', bsBroken.source === 'computeBooks', JSON.stringify(bsBroken));
    A('broken ledger -> cash null + cashTracked false + assets exclude cash', bsBroken.cash === null && bsBroken.cashTracked === false && bsBroken.totalAssetsExcludesCash === true, JSON.stringify(bsBroken));
    const epBroken = JSON.parse((await http.post('/api/reports/balance-sheet?entity_id=' + eid, {})).text);
    A('endpoint after break -> source computeBooks + cash null', epBroken.source === 'computeBooks' && epBroken.cash === null, JSON.stringify({ source: epBroken.source, cash: epBroken.cash }));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (balance sheet: real GL cash when reconciled, safe AR-only fallback)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
