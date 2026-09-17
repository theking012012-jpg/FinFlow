'use strict';
/**
 * verify-gl-verify.js — GL PHASE 5: the live "books balanced ✓" trust signal (GET /api/gl/verify).
 * Proves the signal is HONEST and RED-provable, not decorative:
 *   1. dual-write ledger present  → booksBalanced TRUE  (TB ties, BS balances, GL == reports).
 *   2. ledger WIPED (behind the source docs) → reconciledToReports FALSE → booksBalanced FALSE,
 *      even though an empty ledger's trial balance trivially ties — the signal catches a stale ledger.
 *   3. backfill              → booksBalanced TRUE again.
 *   4. a ledger entry BROKEN (one line deleted) → trialBalanced FALSE → booksBalanced FALSE.
 * A signal that cannot go RED proves nothing; steps 2 and 4 are the discriminating failures (Rule 6).
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-verify.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 5 — "books balanced ✓" signal is honest + RED-provable\n' + '='.repeat(78) + '\n');
    const email = 'glver@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.78' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const verify = async () => JSON.parse((await http.get('/api/gl/verify?entity_id=' + eid)).text);

    // Seed → dual-write posts a balanced ledger that matches the reports.
    A('seed invoice 1000', (await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).status < 300);
    A('seed expense 200', (await http.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-01', category: 'Office', entity_id: eid })).status < 300);

    // 1) Healthy: books balanced.
    let v = verify(); v = await v; const e1 = v.entities[0];
    A('1) dual-write ledger → booksBalanced TRUE', v.booksBalanced === true && e1.trialBalanced && e1.balanceSheetBalanced && e1.reconciledToReports, JSON.stringify(e1));

    // 2) Ledger behind the source docs (wiped) → signal must drop.
    await c.query(`DELETE FROM ledger_lines WHERE user_id=$1`, [uid]);
    await c.query(`DELETE FROM ledger_entries WHERE user_id=$1`, [uid]);
    const e2 = (await verify()).entities[0];
    A('2) WIPED ledger → reconciledToReports FALSE (GL 0 vs reports 1000)', e2.reconciledToReports === false, JSON.stringify(e2.detail));
    A('2) WIPED ledger → booksBalanced FALSE (even though empty TB ties)', e2.booksBalanced === false && e2.trialBalanced === true, JSON.stringify({ bb: e2.booksBalanced, tb: e2.trialBalanced }));

    // 3) Backfill → signal restored.
    A('3) backfill posts', (await http.post('/api/gl/backfill?entity_id=' + eid, {})).status < 300);
    const e3 = (await verify()).entities[0];
    A('3) after backfill → booksBalanced TRUE', e3.booksBalanced === true && e3.reconciledToReports, JSON.stringify(e3));

    // 4) Break one entry (delete the Revenue credit line) → trial balance no longer ties.
    const del = await c.query(`DELETE FROM ledger_lines WHERE user_id=$1 AND credit>0 AND account_id=(SELECT id FROM ledger_accounts WHERE user_id=$1 AND entity_id=$2 AND code='4000')`, [uid, eid]);
    A('4) deleted one Revenue credit line', del.rowCount === 1, 'deleted ' + del.rowCount);
    const e4 = (await verify()).entities[0];
    A('4) BROKEN entry → trialBalanced FALSE', e4.trialBalanced === false, 'trialDebit=' + e4.detail.trialDebit + ' trialCredit=' + e4.detail.trialCredit);
    A('4) BROKEN entry → booksBalanced FALSE (signal detects it)', e4.booksBalanced === false, JSON.stringify({ bb: e4.booksBalanced }));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (books-balanced signal is honest + RED-provable)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
