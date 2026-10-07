#!/usr/bin/env node
'use strict';
/**
 * verify-recurring-exactly-once.js — N37. Each recurring schedule step generates exactly one document,
 * even when the scheduler runs concurrently (two replicas, overlapping intervals, a restart mid-loop),
 * and one bad recurring row does not stop the others.
 *
 * Defect: the scheduler inserted the document, then advanced next_run in a separate write, with no claim
 * or transaction; concurrent runs each generated the document. A row that threw aborted the whole run.
 *
 * Discriminating checks (Rule 4):
 *   3 concurrent runs → exactly 1 invoice, 1 bill, 1 personal txn; next_run advanced once  (bug: up to 3 each)
 *   a recurring invoice with no entity (processed first) fails alone; the good one is still generated
 *     (bug: the whole run aborts, the good invoice is never created)
 *   node -r ./tests/harness/clock.js tests/harness/verify-recurring-exactly-once.js
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const srv = require('../../server.js');
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'once@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Once Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    // Bad row FIRST (no entity), then the good rows.
    await c.query(`ALTER TABLE recurring_invoices DROP CONSTRAINT IF EXISTS chk_recurring_invoices_entity_nn`);   // seed-only: allow the legacy NULL-entity row
    await c.query(`INSERT INTO recurring_invoices (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { client: 'Broken Row', amount: 10, frequency: 'Monthly', next_run: '2026-07-01', status: 'active' }]);
    await c.query(`INSERT INTO recurring_invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { client: 'Good Client', amount: 500, frequency: 'Monthly', next_run: '2026-07-01', status: 'active' }]);
    await c.query(`INSERT INTO recurring_bills (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { vendor: 'Good Vendor', amount: 200, frequency: 'Monthly', next_run: '2026-07-01', status: 'active' }]);
    await c.query(`INSERT INTO recurring_personal_transactions (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { description: 'Rent', amount: 1200, tx_type: 'expense', frequency: 'Monthly', next_run: '2026-07-01', status: 'active' }]);

    console.log('\n' + '='.repeat(78));
    console.log('  RECURRING SCHEDULER — exactly once under concurrency, bad rows isolated');
    console.log('='.repeat(78));

    await Promise.all([srv.runRecurringScheduler(), srv.runRecurringScheduler(), srv.runRecurringScheduler()]);
    const n = async (sql) => Number((await c.query(sql, [uid])).rows[0].n);
    const goodInv = await n(`SELECT COUNT(*) n FROM invoices WHERE user_id=$1 AND data->>'client'='Good Client'`);
    const bills = await n(`SELECT COUNT(*) n FROM bills WHERE user_id=$1 AND data->>'vendor'='Good Vendor'`);
    const pts = await n(`SELECT COUNT(*) n FROM personal_transactions WHERE user_id=$1 AND data->>'description'='Rent'`);
    A('good recurring invoice generated despite the bad row before it (bug: run aborted → 0)', goodInv >= 1, 'count=' + goodInv);
    A('3 concurrent runs → exactly 1 invoice (bug: up to 3)', goodInv === 1, 'count=' + goodInv);
    A('3 concurrent runs → exactly 1 bill (bug: up to 3)', bills === 1, 'count=' + bills);
    A('3 concurrent runs → exactly 1 personal txn (bug: up to 3)', pts === 1, 'count=' + pts);
    const nr = (await c.query(`SELECT data->>'next_run' n FROM recurring_invoices WHERE user_id=$1 AND data->>'client'='Good Client'`, [uid])).rows[0].n;
    A('next_run advanced exactly one step (2026-08-01)', nr === '2026-08-01', 'next_run=' + nr);
    A('the broken row generated nothing', (await n(`SELECT COUNT(*) n FROM invoices WHERE user_id=$1 AND data->>'client'='Broken Row'`)) === 0);
    const gl = await n(`SELECT COUNT(*) n FROM ledger_entries WHERE user_id=$1 AND source_type='invoice'`);
    A('exactly one ledger entry for the generated invoice', gl === 1, 'entries=' + gl);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (recurring exactly once)` : `  ALL GREEN — ${pass} passed, 0 failed  (recurring exactly once)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
