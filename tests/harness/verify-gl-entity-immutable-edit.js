'use strict';
/*
 * verify-gl-entity-immutable-edit.js - GL / multi-entity safety: an invoice or bill's ENTITY is immutable
 * on edit. A PUT that carries a different entity_id must NOT move the document (or its ledger entry) to
 * another entity - that would silently corrupt multi-entity books (revenue/expense leaking across
 * entities, GL on the wrong entity). Locks the invariant so a future whitelist change can't regress it:
 *   - invoice created in entity A, PUT { entity_id: B, amount: 1500 } -> row stays in A; GL invoice entry
 *     stays in A and trues-up to 1500; entity B has ZERO ledger rows; A still reconciles.
 *   - same for a bill (A -> attempted B).
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-entity-immutable-edit.js
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
    const { glReconcile } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL / MULTI-ENTITY - a document\'s entity is immutable on edit (no cross-entity move)\n' + '='.repeat(78) + '\n');
    const email = 'glimm@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Entity A', currency: 'USD' }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Entity B', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.84' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const rowEntity = async (tbl, id) => (await c.query(`SELECT entity_id FROM ${tbl} WHERE id=$1`, [id])).rows[0].entity_id;
    const glOnEntity = async (st, sid, eid) => (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1 AND source_type=$2 AND source_id=$3 AND entity_id=$4 AND reversal_of IS NULL`, [uid, st, sid, eid])).rows[0].n;
    const acctNet = async (eid, code) => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const entityLedgerRows = async eid => (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0].n;

    // INVOICE: create in A, try to move to B via PUT.
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eA })).text);
    A('invoice posts revenue to Entity A', near(await acctNet(eA, '4000'), -1000), 'net=' + (await acctNet(eA, '4000')));
    A('PUT invoice {entity_id: B, amount: 1500} 2xx', (await http.put('/api/invoices/' + inv.id, { entity_id: eB, amount: 1500 })).status < 300);
    A('invoice row stays in Entity A (entity ignored on edit)', (await rowEntity('invoices', inv.id)) === eA, 'entity=' + (await rowEntity('invoices', inv.id)));
    A('invoice GL entry stays in A (1 entry), NONE in B', (await glOnEntity('invoice', inv.id, eA)) === 1 && (await glOnEntity('invoice', inv.id, eB)) === 0);
    A('invoice revenue trued-up to 1500 in A', near(await acctNet(eA, '4000'), -1500), 'net=' + (await acctNet(eA, '4000')));
    A('Entity B has ZERO ledger rows after the attempted move', (await entityLedgerRows(eB)) === 0, 'rows=' + (await entityLedgerRows(eB)));

    // BILL: create in A, try to move to B via PUT.
    const bill = JSON.parse((await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eA })).text);
    A('bill posts opex to Entity A', near(await acctNet(eA, '6000'), 300), 'net=' + (await acctNet(eA, '6000')));
    A('PUT bill {entity_id: B, amount: 450} 2xx', (await http.put('/api/bills/' + bill.id, { entity_id: eB, amount: 450 })).status < 300);
    A('bill row stays in Entity A', (await rowEntity('bills', bill.id)) === eA, 'entity=' + (await rowEntity('bills', bill.id)));
    A('bill GL entry stays in A (1 entry), NONE in B', (await glOnEntity('bill', bill.id, eA)) === 1 && (await glOnEntity('bill', bill.id, eB)) === 0);
    A('bill opex trued-up to 450 in A', near(await acctNet(eA, '6000'), 450), 'net=' + (await acctNet(eA, '6000')));
    A('Entity B STILL has ZERO ledger rows', (await entityLedgerRows(eB)) === 0, 'rows=' + (await entityLedgerRows(eB)));

    // A still reconciles; B is empty and trivially balanced.
    const recA = await glReconcile(uid, eA);
    A('Entity A reconciles to reports + trial balance ties', recA.reconciledToReports === true && recA.trialBalanced === true, JSON.stringify(recA.detail));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (document entity is immutable on edit; no cross-entity GL move)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
