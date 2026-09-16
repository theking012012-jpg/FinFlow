'use strict';
/**
 * verify-gl-post-bill.js — GL Phase 2: bill posting (Dr Operating Expenses / Cr Accounts Payable).
 * Drives POST /api/bills; proves a balanced entry at the issue date, ledger Opex == computeBooks.opex
 * (bills accrue), ledger AP == bill amount, trial balance ties to zero.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-bill.js
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
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 2 — bill (Dr Operating Expenses / Cr Accounts Payable)\n' + '='.repeat(78) + '\n');
    const email = 'glbill@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.23' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const r = await http.post('/api/bills', { vendor: 'Acme Supplies', amount: 80, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid });
    A('POST bill 2xx', r.status >= 200 && r.status < 300, 'status=' + r.status + ' ' + (r.text || '').slice(0, 140));
    const bill = JSON.parse(r.text);
    const entry = (await c.query(`SELECT id, entry_date::text AS entry_date FROM ledger_entries WHERE source_type='bill' AND source_id=$1`, [bill.id])).rows;
    A('one ledger entry posted', entry.length === 1, 'got ' + entry.length);
    const lines = (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.entry_id=$1`, [entry[0] ? entry[0].id : -1])).rows;
    const byCode = Object.fromEntries(lines.map(l => [l.code, l]));
    A('Dr Operating Expenses (6000) = 80', byCode['6000'] && near(byCode['6000'].debit, 80) && near(byCode['6000'].credit, 0), JSON.stringify(byCode['6000']));
    A('Cr Accounts Payable (2000) = 80', byCode['2000'] && near(byCode['2000'].credit, 80) && near(byCode['2000'].debit, 0), JSON.stringify(byCode['2000']));
    A('entry balances', near(lines.reduce((s, l) => s + +l.debit, 0), lines.reduce((s, l) => s + +l.credit, 0)));
    A('posted at issue date 2026-06-01', entry[0] && entry[0].entry_date === '2026-06-01', entry[0] && entry[0].entry_date);
    const bal = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const books = await computeBooks(uid, eid, 'year');
    A('ORACLE: ledger Opex (80) == computeBooks.opex (bill accrues)', near(await bal('6000'), books.opex) && near(books.opex, 80), 'opex=' + books.opex);
    A('ledger AP balance == 80 (credit)', near(await bal('2000'), -80), 'ap=' + (await bal('2000')));
    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE ties to zero', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));
    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL bill == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
