'use strict';
/**
 * verify-gl-post-payment.js — GL Phase 2 (GL_DESIGN.md): invoice-payment posting, dual-write shadow.
 * Drives POST /api/invoices then POST /api/invoice-payments, and proves the payment posts a BALANCED
 * Dr Cash / Cr AR at the payment date, does NOT touch revenue, and that the ledger AR balance equals
 * computeBooks.outstanding while ledger Cash equals cash collected (computeBooks is the oracle). Also
 * asserts the trial balance still ties to zero after both postings.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-payment.js
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
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks } = require('../../server.js');
    console.log('\n' + '='.repeat(78));
    console.log('  GL PHASE 2 — invoice payment (Dr Cash / Cr AR), dual-write shadow');
    console.log('='.repeat(78) + '\n');

    const email = 'glpay@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.21' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Acme', amount: 100, status: 'pending', entity_id: eid, issue_date: '2026-06-01' })).text);
    const r = await http.post('/api/invoice-payments', { invoice_id: inv.id, amount: 40, payment_date: '2026-06-15', entity_id: eid });
    A('POST payment 201', r.status === 201, 'status=' + r.status + ' ' + (r.text || '').slice(0, 160));
    const pay = JSON.parse(r.text);

    const entry = (await c.query(`SELECT id, entry_date::text AS entry_date FROM ledger_entries WHERE source_type='invoice_payment' AND source_id=$1`, [pay.id])).rows;
    A('one ledger entry posted for the payment', entry.length === 1, 'got ' + entry.length);
    const lines = (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.entry_id=$1`, [entry[0] ? entry[0].id : -1])).rows;
    const byCode = Object.fromEntries(lines.map(l => [l.code, l]));
    A('Dr Cash (1000) = 40', byCode['1000'] && near(byCode['1000'].debit, 40) && near(byCode['1000'].credit, 0), JSON.stringify(byCode['1000']));
    A('Cr Accounts Receivable (1100) = 40', byCode['1100'] && near(byCode['1100'].credit, 40) && near(byCode['1100'].debit, 0), JSON.stringify(byCode['1100']));
    A('entry balances', near(lines.reduce((s, l) => s + +l.debit, 0), lines.reduce((s, l) => s + +l.credit, 0)));
    A('posted at the payment date 2026-06-15', entry[0] && entry[0].entry_date === '2026-06-15', entry[0] && entry[0].entry_date);
    A('NO revenue line on a payment (revenue untouched)', !byCode['4000']);

    // Net ledger balances by account, vs the oracle.
    const bal = async code => (await c.query(
      `SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`,
      [uid, eid, code])).rows[0].net;
    const arNet = await bal('1100'), cashNet = await bal('1000');
    const books = await computeBooks(uid, eid, 'year');
    A('ORACLE: ledger AR balance (60) == computeBooks.outstanding', near(arNet, books.outstanding) && near(arNet, 60), 'AR=' + arNet + ' outstanding=' + books.outstanding);
    A('ledger Cash balance == cash collected (40)', near(cashNet, 40), 'cash=' + cashNet);
    A('ORACLE: revenue unchanged (100)', near(books.revenue, 100), 'got ' + books.revenue);

    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE still ties to zero after invoice + payment', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL payment posting == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
