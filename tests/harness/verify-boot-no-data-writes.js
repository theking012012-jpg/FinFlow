#!/usr/bin/env node
'use strict';
/**
 * verify-boot-no-data-writes.js — N90 (Rule 8). Booting the app (initDB) changes NO money data, and the
 * read-only report lists rows marked paid without covering payments.
 *
 * Defect: initDB re-ran the F48/F135 backfills on every boot — 'paid' invoices/bills had amount_paid stamped
 * to amount with no payment row behind it, each deploy, without approval.
 * Executed: real Postgres. A bill and an invoice marked 'paid' with amount_paid 0 and no payments; initDB run.
 *   after initDB: both still amount_paid 0 (bug: stamped to amount)
 *   scripts/report-paid-without-payment.js lists both and writes nothing (row data unchanged)
 *   node -r ./tests/harness/clock.js tests/harness/verify-boot-no-data-writes.js
 */
require('./clock.js');
const path = require('path');
const { execFileSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  try {
    installEnv(scratch.url);
    const db = require('../../database.js');
    await db.initDB();   // schema
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'bd@finflow.test', plan: 'business' }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'BD Co', currency: 'USD' }])).rows[0].id;
    const inv = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, { client: 'C', amount: 300, amount_paid: 0, status: 'paid', issue_date: '2026-06-01' }])).rows[0].id;
    const bill = (await c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, { vendor: 'V', amount: 200, amount_paid: 0, status: 'paid', issue_date: '2026-06-01' }])).rows[0].id;
    await db.initDB();   // a "deploy"
    const ap = async (t, id) => Number((await c.query(`SELECT data->>'amount_paid' a FROM ${t} WHERE id=$1`, [id])).rows[0].a);
    A('after a boot, the paid invoice still has amount_paid 0 (bug: stamped 300)', (await ap('invoices', inv)) === 0, 'amount_paid ' + await ap('invoices', inv));
    A('after a boot, the paid bill still has amount_paid 0 (bug: stamped 200)', (await ap('bills', bill)) === 0, 'amount_paid ' + await ap('bills', bill));
    const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'report-paid-without-payment.js')], { env: Object.assign({}, process.env, { DATABASE_URL: scratch.url }), encoding: 'utf8' });
    A('report lists the invoice and the bill', /invoice #\d+ .*amount 300/.test(out) && /bill #\d+ .*amount 200/.test(out), out.slice(0, 300));
    A('report wrote nothing (amount_paid still 0 on both)', (await ap('invoices', inv)) === 0 && (await ap('bills', bill)) === 0);
    try { await db.pool.end(); } catch (_) {}
  } finally {
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (boot writes no data)` : `  ALL GREEN — ${pass} passed, 0 failed  (boot writes no data)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
