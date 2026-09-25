'use strict';
/*
 * verify-gl-status-reversal.js - GL hardening: a source doc's EDIT (PUT) keeps the ledger in lockstep
 * with computeBooks, so certification stays honest across the full lifecycle - not just on DELETE.
 *   - invoice pending -> draft  : de-recognised -> ledger REVERSED (revenue nets 0), books drop it.
 *   - invoice draft -> pending  : re-recognised -> ledger RE-INSTATED (revenue back), reconciled.
 *   - invoice amount edit (live): ledger TRUES-UP to the new amount, reconciled.
 *   - bill amount edit (live)   : ledger TRUES-UP to the new amount, reconciled.
 *   - backfill after a draft-reverse is idempotent (canonical key preserved) - no double post.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-status-reversal.js
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
    const { computeBooks, glReconcile, backfillLedgerForUser } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL HARDENING - edit (PUT) keeps the ledger in lockstep (recognise/de-recognise/true-up)\n' + '='.repeat(78) + '\n');
    const email = 'glstat@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.81' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const acctNet = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const tbDiff = async () => { const r = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0]; return r.d - r.cr; };
    const liveEntries = async (st, sid) => (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries e WHERE e.user_id=$1 AND e.source_type=$2 AND e.source_id=$3 AND e.reversal_of IS NULL AND e.status='posted' AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of=e.id)`, [uid, st, sid])).rows[0].n;

    // Seed invoice 1000 pending -> posts Dr AR / Cr Revenue.
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).text);
    A('invoice posts: Revenue(4000) credit = 1000', near(await acctNet('4000'), -1000), 'net=' + (await acctNet('4000')));
    let rec = await glReconcile(uid, eid);
    A('baseline reconciled + TB=0', rec.reconciledToReports && near(await tbDiff(), 0), JSON.stringify(rec));

    // 1) pending -> draft : de-recognised -> reversed.
    A('PUT status=draft 2xx', (await http.put('/api/invoices/' + inv.id, { status: 'draft' })).status < 300);
    A('after draft: Revenue nets to 0 (reversed)', near(await acctNet('4000'), 0), 'net=' + (await acctNet('4000')));
    A('after draft: 0 live entries for invoice', (await liveEntries('invoice', inv.id)) === 0);
    let books = await computeBooks(uid, eid, 'year');
    A('after draft: computeBooks revenue = 0 (draft dropped)', near(books.revenue, 0), 'rev=' + books.revenue);
    rec = await glReconcile(uid, eid);
    A('after draft: still reconciled + TB=0', rec.reconciledToReports === true && near(await tbDiff(), 0), JSON.stringify(rec.detail));

    // 2) draft -> pending : re-recognised -> re-instated.
    A('PUT status=pending 2xx', (await http.put('/api/invoices/' + inv.id, { status: 'pending' })).status < 300);
    A('after re-issue: Revenue credit = 1000 again', near(await acctNet('4000'), -1000), 'net=' + (await acctNet('4000')));
    A('after re-issue: exactly 1 live entry', (await liveEntries('invoice', inv.id)) === 1);
    books = await computeBooks(uid, eid, 'year');
    A('after re-issue: computeBooks revenue = 1000', near(books.revenue, 1000), 'rev=' + books.revenue);
    rec = await glReconcile(uid, eid);
    A('after re-issue: reconciled + TB=0', rec.reconciledToReports === true && near(await tbDiff(), 0), JSON.stringify(rec.detail));

    // 3) amount edit while live : true-up 1000 -> 1500.
    A('PUT amount=1500 2xx', (await http.put('/api/invoices/' + inv.id, { amount: 1500 })).status < 300);
    A('after amount edit: Revenue credit = 1500 (trued up)', near(await acctNet('4000'), -1500), 'net=' + (await acctNet('4000')));
    A('after amount edit: still exactly 1 live entry', (await liveEntries('invoice', inv.id)) === 1);
    books = await computeBooks(uid, eid, 'year');
    rec = await glReconcile(uid, eid);
    A('after amount edit: computeBooks==GL, reconciled', near(books.revenue, 1500) && rec.reconciledToReports === true, 'rev=' + books.revenue + ' ' + JSON.stringify(rec.detail));

    // 4) bill amount edit true-up.
    const bill = JSON.parse((await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid })).text);
    A('bill posts: Opex(6000) debit = 300', near(await acctNet('6000'), 300), 'net=' + (await acctNet('6000')));
    A('PUT bill amount=450 2xx', (await http.put('/api/bills/' + bill.id, { amount: 450 })).status < 300);
    A('after bill edit: Opex debit = 450 (trued up)', near(await acctNet('6000'), 450), 'net=' + (await acctNet('6000')));
    A('after bill edit: exactly 1 live entry', (await liveEntries('bill', bill.id)) === 1);
    rec = await glReconcile(uid, eid);
    A('after bill edit: reconciled + TB=0', rec.reconciledToReports === true && near(await tbDiff(), 0), JSON.stringify(rec.detail));

    // 5) draft a doc, then backfill must NOT double-post (canonical key preserved -> idempotent).
    A('PUT invoice back to draft 2xx', (await http.put('/api/invoices/' + inv.id, { status: 'draft' })).status < 300);
    const beforeBf = (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1`, [uid])).rows[0].n;
    const bf = await backfillLedgerForUser(uid, { entityId: eid });
    const afterBf = (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1`, [uid])).rows[0].n;
    A('backfill after draft posts NO new entries (idempotent)', beforeBf === afterBf, 'before=' + beforeBf + ' after=' + afterBf + ' report=' + JSON.stringify(bf.byType || bf));
    rec = await glReconcile(uid, eid);
    A('post-backfill: reconciled + TB=0', rec.reconciledToReports === true && near(await tbDiff(), 0), JSON.stringify(rec.detail));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (edits keep the ledger in lockstep with the books)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
