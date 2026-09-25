'use strict';
/*
 * verify-gl-dashboard-readswap.js - GL Phase 5b (slice 4): the dashboard GET /api/reports sources its
 * P&L figures (revenue, expenses, netProfit, gross, cogs) from the LEDGER when it reconciles to
 * computeBooks, else computeBooks. Non-P&L fields (outstanding, monthly) stay computeBooks-derived.
 *   - complete ledger -> source 'gl', figures correct, outstanding + monthly still present.
 *   - broken ledger  -> source 'computeBooks', figures STILL correct (safety net).
 *   - consolidated (?entity_id=all) -> source 'gl' (glConsolidated reconciles).
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-dashboard-readswap.js
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
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 5b - dashboard GET /api/reports P&L from the ledger, oracle fallback\n' + '='.repeat(78) + '\n');
    const email = 'gldash@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Dash Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.88' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const rep = async q => JSON.parse((await http.request('GET', '/api/reports' + (q || ''))).text);

    // Seed: revenue 1000 (invoice unpaid -> AR 1000), expense 200, bill 300 unpaid. opex 500, net 500.
    A('invoice 1000', (await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).status < 300);
    A('expense 200', (await http.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-01', category: 'Office', entity_id: eid })).status < 300);
    A('bill 300', (await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid })).status < 300);

    // 1) complete ledger -> source gl, figures correct, non-P&L present
    const r = await rep('?entity_id=' + eid);
    A('source = gl', r.source === 'gl', JSON.stringify({ source: r.source }));
    A('P&L figures correct (rev 1000, expenses 500, net 500, gross 1000, cogs 0)',
      near(r.revenue, 1000) && near(r.expenses, 500) && near(r.netProfit, 500) && near(r.grossProfit, 1000) && near(r.cogs, 0),
      JSON.stringify({ rev: r.revenue, exp: r.expenses, net: r.netProfit, gross: r.grossProfit, cogs: r.cogs }));
    A('non-P&L fields intact (outstanding 1000, monthly + expenseBreakdown present)', near(r.outstanding, 1000) && ('monthly' in r) && ('expenseBreakdown' in r), JSON.stringify({ outstanding: r.outstanding, hasMonthly: 'monthly' in r, hasBreakdown: 'expenseBreakdown' in r }));

    // 2) consolidated -> gl
    const rAll = await rep('?entity_id=all');
    A('consolidated (entity_id=all) -> source gl', rAll.source === 'gl', JSON.stringify({ source: rAll.source }));

    // 3) broken ledger -> fallback, figures still correct
    const del = await c.query(`DELETE FROM ledger_lines WHERE user_id=$1 AND credit>0 AND account_id=(SELECT id FROM ledger_accounts WHERE user_id=$1 AND entity_id=$2 AND code='4000')`, [uid, eid]);
    A('broke the ledger (deleted a Revenue credit line)', del.rowCount === 1, 'deleted ' + del.rowCount);
    const rBroken = await rep('?entity_id=' + eid);
    A('broken ledger -> source computeBooks', rBroken.source === 'computeBooks', JSON.stringify({ source: rBroken.source }));
    A('broken ledger -> figures STILL correct (rev 1000, net 500)', near(rBroken.revenue, 1000) && near(rBroken.netProfit, 500), JSON.stringify({ rev: rBroken.revenue, net: rBroken.netProfit }));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (dashboard P&L from the ledger, safe fallback)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
