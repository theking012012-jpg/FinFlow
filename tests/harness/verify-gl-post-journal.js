'use strict';
/**
 * verify-gl-post-journal.js — N20: a POSTED manual journal posts to the GL and flows into the P&L,
 * a DRAFT journal does nothing, and glReconcile stays green (GL income/expense == computeBooks).
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-journal.js
 * Discriminating: FAILS on pre-N20 code (journals never posted / never hit computeBooks).
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
    const { computeBooks, glReconcile } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  N20 — manual journals post to the GL + flow into the P&L\n' + '='.repeat(78) + '\n');
    const email = 'glje@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'JE Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.24' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    const base = await computeBooks(uid, eid, 'year');

    // JE1 expense: Dr Rent(5100) 100 / Cr Checking(1010) 100  → opex +100
    const je1 = await http.post('/api/journals', { entity_id: eid, date: '2026-06-10', description: 'Rent accrual', status: 'Posted',
      lines: [{ code: '5100', name: 'Rent', debit: 100, credit: 0 }, { code: '1010', name: 'Checking', debit: 0, credit: 100 }] });
    A('JE1 posted 2xx', je1.status >= 200 && je1.status < 300, 'status=' + je1.status + ' ' + (je1.text || '').slice(0, 160));
    // JE2 income: Dr Checking(1010) 200 / Cr Service Revenue(4000) 200 → revenue +200
    const je2 = await http.post('/api/journals', { entity_id: eid, date: '2026-06-11', description: 'Service income adj', status: 'Posted',
      lines: [{ code: '1010', name: 'Checking', debit: 200, credit: 0 }, { code: '4000', name: 'Service Revenue', debit: 0, credit: 200 }] });
    A('JE2 posted 2xx', je2.status >= 200 && je2.status < 300, 'status=' + je2.status);
    // JE3 draft: must NOT affect anything
    const je3 = await http.post('/api/journals', { entity_id: eid, date: '2026-06-12', description: 'Draft only', status: 'Draft',
      lines: [{ code: '5100', name: 'Rent', debit: 50, credit: 0 }, { code: '1010', name: 'Checking', debit: 0, credit: 50 }] });
    A('JE3 draft 2xx', je3.status >= 200 && je3.status < 300, 'status=' + je3.status);

    const je1id = JSON.parse(je1.text || '{}').id, je2id = JSON.parse(je2.text || '{}').id, je3id = JSON.parse(je3.text || '{}').id;
    const led = async id => (await c.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE source_type='journal' AND source_id=$1`, [id])).rows[0].n;
    A('JE1 posted to the GL', (await led(je1id)) === 1, 'entries=' + (await led(je1id)));
    A('JE2 posted to the GL', (await led(je2id)) === 1, 'entries=' + (await led(je2id)));
    A('JE3 (draft) NOT in the GL', (await led(je3id)) === 0, 'entries=' + (await led(je3id)));

    const bk = await computeBooks(uid, eid, 'year');
    A('revenue +200 (income JE in the P&L)', near(bk.revenue - base.revenue, 200), 'Δrev=' + (bk.revenue - base.revenue));
    A('opex +100 (expense JE in the P&L)', near(bk.opex - base.opex, 100), 'Δopex=' + (bk.opex - base.opex));
    A('netProfit moved +100 (200 rev − 100 opex)', near(bk.netProfit - base.netProfit, 100), 'Δnet=' + (bk.netProfit - base.netProfit));

    const rec = await glReconcile(uid, eid);
    A('reconcile: trial balance ties', rec.trialBalanced, JSON.stringify(rec.detail));
    A('reconcile: balance sheet balances', rec.balanceSheetBalanced, JSON.stringify(rec.detail));
    A('reconcile: GL income==books revenue & GL expense==books cogs+opex', rec.reconciledToReports, JSON.stringify(rec.detail));
    A('reconcile: booksBalanced TRUE', rec.booksBalanced === true, JSON.stringify(rec.detail));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N20 journals → GL + P&L)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
