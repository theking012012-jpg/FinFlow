'use strict';
/*
 * verify-gl-pl-readswap.js - GL Phase 5b: the P&L statement reads from the LEDGER when it reconciles to
 * computeBooks, else falls back to computeBooks (the oracle) so the user never sees a wrong number.
 *   - complete ledger, single entity, native ccy -> source 'gl', totals == computeBooks.
 *   - POST /api/reports/profit-loss?entity_id=<e> returns source 'gl' with the same totals + shape.
 *   - BROKEN ledger (a line deleted -> trial balance breaks) -> source 'computeBooks', numbers STILL
 *     correct (served from source docs, unaffected by the ledger corruption). The safety net works.
 *   - consolidated (entity_id=all -> null) -> source 'computeBooks' (glFinancials is single-entity).
 *   - FX/display-currency -> source 'computeBooks'.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-pl-readswap.js
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
    const { computeBooks, glProfitLoss } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 5b - P&L reads from the ledger when reconciled, else falls back to computeBooks\n' + '='.repeat(78) + '\n');
    const email = 'glpl@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'PL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.85' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    // Seed: revenue 1000 (invoice), opex 500 (expense 200 + bill 300). cogs 0.
    A('invoice 1000', (await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).status < 300);
    A('expense 200', (await http.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-01', category: 'Office', entity_id: eid })).status < 300);
    A('bill 300', (await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid })).status < 300);

    const books = await computeBooks(uid, eid, 'year');
    A('oracle baseline: revenue 1000, opex 500, net 500', near(books.revenue, 1000) && near(books.opex, 500) && near(books.netProfit, 500), 'rev=' + books.revenue + ' opex=' + books.opex + ' net=' + books.netProfit);

    // 1) complete ledger -> source 'gl', numbers == computeBooks
    const pl = await glProfitLoss(uid, eid, { period: 'year' });
    A('complete ledger -> source = gl', pl.source === 'gl', JSON.stringify(pl));
    A('gl P&L == oracle (rev 1000, opex 500, gross 1000, net 500, cogs 0)',
      near(pl.totalRevenue, 1000) && near(pl.totalExpenses, 500) && near(pl.grossProfit, 1000) && near(pl.netProfit, 500) && near(pl.cogs, 0), JSON.stringify(pl));

    // 2) live endpoint returns source 'gl' + same totals + unchanged shape
    const ep = JSON.parse((await http.post('/api/reports/profit-loss?entity_id=' + eid, {})).text);
    A('endpoint source = gl', ep.source === 'gl', JSON.stringify({ source: ep.source }));
    A('endpoint totals correct + shape intact (rows/totalRevenue/netProfit present)',
      Array.isArray(ep.rows) && near(ep.totalRevenue, 1000) && near(ep.totalExpenses, 500) && near(ep.netProfit, 500), JSON.stringify({ tr: ep.totalRevenue, te: ep.totalExpenses, np: ep.netProfit, rows: Array.isArray(ep.rows) }));

    // 3) consolidated + FX -> oracle fallback
    A('consolidated (entityId null) -> source computeBooks', (await glProfitLoss(uid, null, { period: 'year' })).source === 'computeBooks');
    A('FX/display -> source computeBooks', (await glProfitLoss(uid, eid, { period: 'year', display: 'EUR' })).source === 'computeBooks');
    const epAll = JSON.parse((await http.post('/api/reports/profit-loss?entity_id=all', {})).text);
    A('endpoint consolidated -> source computeBooks', epAll.source === 'computeBooks', JSON.stringify({ source: epAll.source }));

    // 4) BROKEN ledger -> fallback to computeBooks, numbers STILL correct
    const del = await c.query(`DELETE FROM ledger_lines WHERE user_id=$1 AND credit>0 AND account_id=(SELECT id FROM ledger_accounts WHERE user_id=$1 AND entity_id=$2 AND code='4000')`, [uid, eid]);
    A('broke the ledger (deleted a Revenue credit line)', del.rowCount === 1, 'deleted ' + del.rowCount);
    const plBroken = await glProfitLoss(uid, eid, { period: 'year' });
    A('broken ledger -> source computeBooks (safety net)', plBroken.source === 'computeBooks', JSON.stringify(plBroken));
    A('broken ledger -> numbers STILL correct (rev 1000, net 500 from source docs)', near(plBroken.totalRevenue, 1000) && near(plBroken.netProfit, 500), JSON.stringify(plBroken));
    const epBroken = JSON.parse((await http.post('/api/reports/profit-loss?entity_id=' + eid, {})).text);
    A('endpoint after break -> source computeBooks + correct totals', epBroken.source === 'computeBooks' && near(epBroken.totalRevenue, 1000) && near(epBroken.netProfit, 500), JSON.stringify({ source: epBroken.source, tr: epBroken.totalRevenue, np: epBroken.netProfit }));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (P&L reads from the ledger, safe oracle fallback)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
