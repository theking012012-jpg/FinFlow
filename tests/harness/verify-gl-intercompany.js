'use strict';
/*
 * verify-gl-intercompany.js - GL consolidation slice D/E: intercompany DETECTION + consolidated CERT.
 *   - a sale whose customer name matches another owned entity (and a bill whose vendor matches) is
 *     detected as intercompany; exposed as an `eliminated` group P&L view WITHOUT altering the reconciled
 *     primary totals (honest: no silent name-match elimination of certified numbers).
 *   - glReconcile(userId, null) certifies the CONSOLIDATED books (ties + reconciles), RED-provable.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-intercompany.js
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
    const { glConsolidated, glReconcile } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL CONSOLIDATION - intercompany detection + consolidated certification\n' + '='.repeat(78) + '\n');
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email: 'glic@finflow.test', role: 'owner', plan: 'business', base_currency: 'USD', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Alpha', currency: 'USD' }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Beta', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.120' });
    await http.post('/api/auth/login', { email: 'glic@finflow.test', password: PW });

    // Alpha sells to "Beta" (intercompany 400) and to a real customer (1000). Beta has an external
    // expense (100) and a bill from vendor "Alpha" (intercompany 50).
    await http.post('/api/invoices', { client: 'Beta', amount: 400, status: 'pending', issue_date: '2026-06-01', entity_id: eA });
    await http.post('/api/invoices', { client: 'RealCust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eA });
    await http.post('/api/expenses', { description: 'ext', amount: 100, expense_date: '2026-06-01', category: 'Office', entity_id: eB });
    await http.post('/api/bills', { vendor: 'Alpha', amount: 50, status: 'unpaid', issue_date: '2026-06-01', entity_id: eB });

    const con = await glConsolidated(uid, { entityId: null });
    A('primary consolidated revenue = 1400 (intercompany NOT removed)', near(con.incomeStatement.income, 1400), 'inc=' + con.incomeStatement.income);
    A('primary consolidated expenses = 150', near(con.incomeStatement.expenses, 150), 'exp=' + con.incomeStatement.expenses);
    A('intercompany detected: revenue 400 (Alpha->Beta)', near(con.intercompany.revenue, 400), JSON.stringify(con.intercompany));
    A('intercompany detected: expense 50 (Beta bill from Alpha)', near(con.intercompany.expense, 50), JSON.stringify(con.intercompany));
    A('eliminated group P&L: income 1000, expenses 100, net 900', near(con.eliminated.income, 1000) && near(con.eliminated.expenses, 100) && near(con.eliminated.netProfit, 900), JSON.stringify(con.eliminated));

    // Consolidated certification.
    let rec = await glReconcile(uid, null);
    A('consolidated glReconcile: booksBalanced TRUE (ties + reconciles)', rec.booksBalanced === true && rec.reconciledToReports === true && rec.trialBalanced === true, JSON.stringify(rec));

    // RED-provable: break one consolidated ledger line -> certification drops to false.
    const del = await c.query(`DELETE FROM ledger_lines WHERE user_id=$1 AND credit>0 AND account_id IN (SELECT id FROM ledger_accounts WHERE user_id=$1 AND code='4000') AND entity_id=$2`, [uid, eA]);
    A('broke a consolidated Revenue line', del.rowCount >= 1, 'deleted ' + del.rowCount);
    rec = await glReconcile(uid, null);
    A('broken -> consolidated booksBalanced FALSE (RED-provable)', rec.booksBalanced === false, JSON.stringify(rec));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (intercompany detection + honest consolidated certification)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
