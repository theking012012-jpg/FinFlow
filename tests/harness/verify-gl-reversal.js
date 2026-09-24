'use strict';
/*
 * verify-gl-reversal.js - GL hardening: voiding/deleting a recognised source doc REVERSES its ledger
 * entry, so the certified books stay correct through a document's full lifecycle. Seeds an invoice
 * (revenue), a bill (opex) and an approved payroll run (opex); confirms they post; then DELETEs the
 * invoice + bill and VOIDs the payroll run and proves:
 *   - a reversal entry (reversal_of set) appears for each - exactly one, idempotent;
 *   - each account nets to ZERO across original+reversal (revenue 4000, opex 6000/6100 all net 0);
 *   - computeBooks drops the docs (revenue 0, opex 0) AND the GL nets to 0 -> still reconciled;
 *   - trial balance still ties to zero.
 * Baseline first (non-zero) so the reversal is a real state change (Rule 4/14 - the deny path runs).
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-reversal.js
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
    console.log('\n' + '='.repeat(78) + '\n  GL HARDENING - reversal on void/delete keeps the books correct\n' + '='.repeat(78) + '\n');
    const email = 'glrev@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.80' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const acctNet = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const tbDiff = async () => { const r = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0]; return r.d - r.cr; };
    const revCount = async () => (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1 AND reversal_of IS NOT NULL`, [uid])).rows[0].n;

    // Seed: invoice 1000 (revenue), bill 300 (opex), payroll 1350 (opex).
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).text);
    const bill = JSON.parse((await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid })).text);
    const emp = JSON.parse((await http.post('/api/payroll', { fname: 'Ada', lname: 'L', gross: 1350, entity_id: eid })).text);
    const run = JSON.parse((await http.post('/api/payroll-runs', { period: '2026-06', entity_id: eid })).text);
    A('approve payroll', (await http.put('/api/payroll-runs/' + run.id + '/approve', {})).status < 300);

    // Baseline: books recognise everything, GL balances, reconciled.
    let books = await computeBooks(uid, eid, 'year');
    A('baseline revenue=1000, opex=1650', near(books.revenue, 1000) && near(books.opex, 1650), 'rev=' + books.revenue + ' opex=' + books.opex);
    let rec = await glReconcile(uid, eid);
    A('baseline reconciled + trial-balanced', rec.reconciledToReports && rec.trialBalanced && near(await tbDiff(), 0), JSON.stringify(rec));
    A('baseline: no reversal entries yet', (await revCount()) === 0);

    // Void / delete.
    A('DELETE invoice', await fetchDel(http, '/api/invoices/' + inv.id));
    A('DELETE bill', await fetchDel(http, '/api/bills/' + bill.id));
    A('VOID payroll run', (await http.put('/api/payroll-runs/' + run.id + '/void', {})).status < 300);

    // Each doc reversed exactly once.
    A('exactly 3 reversal entries posted (one per doc)', (await revCount()) === 3, 'got ' + (await revCount()));

    // Every P&L account nets to zero across original + reversal.
    A('Revenue (4000) nets to 0', near(await acctNet('4000'), 0), 'net=' + (await acctNet('4000')));
    A('Operating Expenses (6000) nets to 0', near(await acctNet('6000'), 0), 'net=' + (await acctNet('6000')));
    A('Payroll Expense (6100) nets to 0', near(await acctNet('6100'), 0), 'net=' + (await acctNet('6100')));

    // computeBooks dropped the docs; GL nets to 0; still reconciled; TB ties.
    books = await computeBooks(uid, eid, 'year');
    A('after void/delete: revenue 0, opex 0 (docs gone from source)', near(books.revenue, 0) && near(books.opex, 0), 'rev=' + books.revenue + ' opex=' + books.opex);
    rec = await glReconcile(uid, eid);
    A('still reconciled to reports (GL nets to 0 == computeBooks)', rec.reconciledToReports === true, JSON.stringify(rec.detail));
    A('trial balance still ties to zero', near(await tbDiff(), 0), 'diff=' + (await tbDiff()));
    A('books balanced signal TRUE post-reversal', rec.booksBalanced === true, JSON.stringify(rec));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (void/delete reverses the ledger; books stay correct)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
async function fetchDel(http, path) { const r = await http.request('DELETE', path); return r.status >= 200 && r.status < 300; }
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
