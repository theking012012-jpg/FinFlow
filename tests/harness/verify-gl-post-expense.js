'use strict';
/**
 * verify-gl-post-expense.js — GL Phase 2: expense posting (Dr Operating Expenses / Cr Cash).
 * Drives POST /api/expenses; proves a balanced entry at the expense date, ledger Opex == computeBooks
 * expense leg (oracle), Cash reduced, trial balance ties to zero.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-expense.js
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
    const { computeBooks } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 2 — expense (Dr Operating Expenses / Cr Cash)\n' + '='.repeat(78) + '\n');
    const email = 'glexp@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.22' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const r = await http.post('/api/expenses', { description: 'Rent', amount: 70, expense_date: '2026-06-01', entity_id: eid });
    A('POST expense 201', r.status === 201, 'status=' + r.status + ' ' + (r.text || '').slice(0, 140));
    const exp = JSON.parse(r.text);
    const entry = (await c.query(`SELECT id, entry_date::text AS entry_date FROM ledger_entries WHERE source_type='expense' AND source_id=$1`, [exp.id])).rows;
    A('one ledger entry posted', entry.length === 1, 'got ' + entry.length);
    const lines = (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.entry_id=$1`, [entry[0] ? entry[0].id : -1])).rows;
    const byCode = Object.fromEntries(lines.map(l => [l.code, l]));
    A('Dr Operating Expenses (6000) = 70', byCode['6000'] && near(byCode['6000'].debit, 70) && near(byCode['6000'].credit, 0), JSON.stringify(byCode['6000']));
    A('Cr Cash (1000) = 70', byCode['1000'] && near(byCode['1000'].credit, 70) && near(byCode['1000'].debit, 0), JSON.stringify(byCode['1000']));
    A('entry balances', near(lines.reduce((s, l) => s + +l.debit, 0), lines.reduce((s, l) => s + +l.credit, 0)));
    A('posted at expense date 2026-06-01', entry[0] && entry[0].entry_date === '2026-06-01', entry[0] && entry[0].entry_date);
    const bal = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const books = await computeBooks(uid, eid, 'year');
    A('ORACLE: ledger Opex balance (70) == computeBooks.opex', near(await bal('6000'), books.opex) && near(books.opex, 70), 'opex=' + books.opex);
    A('ledger Cash reduced by 70', near(await bal('1000'), -70), 'cash=' + (await bal('1000')));
    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE ties to zero', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));
    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL expense == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
