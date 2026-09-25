'use strict';
/*
 * verify-gl-paidoncreate.js - GL hardening: an invoice created already PAID records a real settling
 * invoice_payment (not just amount_paid), so the cash collection is first-class everywhere:
 *   - a settling invoice_payment row exists for the full amount (idem 'invoice_create_paid:<id>').
 *   - the GL carries BOTH legs: accrual (Cr Revenue) + cash (Dr Cash / Cr AR) -> AR nets to 0,
 *     Cash = amount, Revenue = amount (a paid invoice leaves NO receivable outstanding).
 *   - the cash-flow report reads invoice_payments (F95), so the inflow is now visible (row present).
 *   - a PENDING invoice creates NO settling payment (guard).
 *   - idempotent: recreating with the same token books no second payment.
 *   - reconciles to the reports; trial balance ties.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-paidoncreate.js
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
    console.log('\n' + '='.repeat(78) + '\n  GL HARDENING - paid-on-create records a real settling payment (cash leg first-class)\n' + '='.repeat(78) + '\n');
    const email = 'glpoc@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'POC Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.83' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const acctNet = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const paysFor = async invId => (await c.query(`SELECT * FROM invoice_payments WHERE user_id=$1 AND invoice_id=$2 ORDER BY id ASC`, [uid, invId])).rows;
    const tbDiff = async () => { const r = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0]; return r.d - r.cr; };

    // 1) paid-on-create invoice
    const paid = JSON.parse((await http.post('/api/invoices', { client: 'PaidCust', amount: 1000, status: 'paid', issue_date: '2026-06-01', entity_id: eid })).text);
    const pays = await paysFor(paid.id);
    A('paid-on-create booked exactly ONE settling invoice_payment = 1000', pays.length === 1 && near(pays[0].amount, 1000), JSON.stringify(pays.map(p => p.amount)));
    A('settling payment carries the deterministic idem key', pays[0] && pays[0].idempotency_key === ('invoice_create_paid:' + paid.id), pays[0] && pays[0].idempotency_key);
    A('GL Revenue(4000) credited 1000 (accrual)', near(await acctNet('4000'), -1000), 'net=' + (await acctNet('4000')));
    A('GL AR(1100) nets to 0 (accrual +1000, settled -1000)', near(await acctNet('1100'), 0), 'net=' + (await acctNet('1100')));
    A('GL Cash(1000) debited 1000 (collected)', near(await acctNet('1000'), 1000), 'net=' + (await acctNet('1000')));

    // 2) pending invoice creates NO settling payment (guard)
    const pend = JSON.parse((await http.post('/api/invoices', { client: 'PendCust', amount: 500, status: 'pending', issue_date: '2026-06-02', entity_id: eid })).text);
    A('pending invoice books NO settling payment', (await paysFor(pend.id)).length === 0);
    A('pending invoice leaves AR outstanding (Cash unchanged at 1000)', near(await acctNet('1000'), 1000) && near(await acctNet('1100'), 500), 'cash=' + (await acctNet('1000')) + ' ar=' + (await acctNet('1100')));

    // 3) idempotent: same token -> same invoice, no second payment
    const t = 'tok-poc-1';
    const r1 = JSON.parse((await http.post('/api/invoices', { client: 'IdemCust', amount: 250, status: 'paid', issue_date: '2026-06-03', entity_id: eid, idempotency_key: t })).text);
    const r2 = JSON.parse((await http.post('/api/invoices', { client: 'IdemCust', amount: 250, status: 'paid', issue_date: '2026-06-03', entity_id: eid, idempotency_key: t })).text);
    A('same-token recreate returns the same invoice', r1.id === r2.id, 'r1=' + r1.id + ' r2=' + r2.id);
    A('same-token recreate books exactly ONE settling payment', (await paysFor(r1.id)).length === 1);

    // 4) reconciliation + trial balance
    const books = await computeBooks(uid, eid, 'year');
    const rec = await glReconcile(uid, eid);
    A('computeBooks revenue = 1750 (1000 + 500 + 250)', near(books.revenue, 1750), 'rev=' + books.revenue);
    A('reconciled to reports + trial balance ties + booksBalanced', rec.reconciledToReports === true && rec.booksBalanced === true && near(await tbDiff(), 0), JSON.stringify(rec.detail));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (paid-on-create books a real settling payment; cash leg first-class)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
