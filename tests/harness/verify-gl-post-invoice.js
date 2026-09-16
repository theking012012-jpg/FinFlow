'use strict';
/**
 * verify-gl-post-invoice.js — GL Phase 2 (GL_DESIGN.md): invoice posting, dual-write shadow.
 * Drives the REAL POST /api/invoices route, then proves the ledger posting: an issued invoice posts a
 * BALANCED Dr AR / Cr Revenue at its issue date, the Revenue credit EQUALS computeBooks' revenue for
 * the entity (computeBooks is the oracle), and a DRAFT invoice posts NOTHING (matches recognition).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-invoice.js
 * Scratch Postgres only.
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
    console.log('  GL PHASE 2 — invoice posting (Dr AR / Cr Revenue), dual-write shadow');
    console.log('='.repeat(78) + '\n');

    const email = 'glinv@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.20' });
    const login = await http.post('/api/auth/login', { email, password: PW });
    A('login 200', login.status === 200, 'status=' + login.status + ' ' + (login.text || '').slice(0, 120));

    // Issue a recognized invoice.
    const r1 = await http.post('/api/invoices', { client: 'Acme', amount: 100, status: 'pending', entity_id: eid, issue_date: '2026-06-01' });
    A('POST invoice 201', r1.status === 201, 'status=' + r1.status + ' ' + (r1.text || '').slice(0, 160));
    const inv = JSON.parse(r1.text);

    const entryRows = (await c.query(`SELECT id, entry_date::text AS entry_date FROM ledger_entries WHERE source_type='invoice' AND source_id=$1`, [inv.id])).rows;
    A('one ledger entry posted for the invoice', entryRows.length === 1, 'got ' + entryRows.length);
    const lines = (await c.query(
      `SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.entry_id=$1 ORDER BY la.code`,
      [entryRows[0] ? entryRows[0].id : -1])).rows;
    const byCode = Object.fromEntries(lines.map(l => [l.code, l]));
    A('Dr Accounts Receivable (1100) = 100', byCode['1100'] && near(byCode['1100'].debit, 100) && near(byCode['1100'].credit, 0), JSON.stringify(byCode['1100']));
    A('Cr Revenue (4000) = 100', byCode['4000'] && near(byCode['4000'].credit, 100) && near(byCode['4000'].debit, 0), JSON.stringify(byCode['4000']));
    const totD = lines.reduce((s, l) => s + (+l.debit), 0), totC = lines.reduce((s, l) => s + (+l.credit), 0);
    A('entry balances (Σdebit == Σcredit)', near(totD, totC), 'd=' + totD + ' c=' + totC);
    A('posted at the issue date 2026-06-01', entryRows[0] && entryRows[0].entry_date === '2026-06-01', entryRows[0] && entryRows[0].entry_date);

    // ORACLE PARITY: posted Revenue credit == computeBooks revenue for the entity.
    const books = await computeBooks(uid, eid, 'year');
    A('ORACLE: computeBooks revenue = 100', near(books.revenue, 100), 'got ' + books.revenue);
    A('ORACLE: posted Cr Revenue == computeBooks revenue', near(byCode['4000'] ? byCode['4000'].credit : NaN, books.revenue), 'ledger=' + (byCode['4000'] && byCode['4000'].credit) + ' oracle=' + books.revenue);

    // A DRAFT invoice recognizes nothing → posts nothing, and revenue is unchanged.
    const r2 = await http.post('/api/invoices', { client: 'DraftCo', amount: 500, status: 'draft', entity_id: eid, issue_date: '2026-06-01' });
    A('POST draft invoice 201', r2.status === 201, 'status=' + r2.status);
    const draft = JSON.parse(r2.text);
    const draftEntries = (await c.query(`SELECT id FROM ledger_entries WHERE source_type='invoice' AND source_id=$1`, [draft.id])).rows;
    A('DRAFT posts NO ledger entry (matches non-recognition)', draftEntries.length === 0, 'got ' + draftEntries.length);
    const books2 = await computeBooks(uid, eid, 'year');
    A('ORACLE: draft did not change revenue (still 100)', near(books2.revenue, 100), 'got ' + books2.revenue);

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL invoice posting == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
