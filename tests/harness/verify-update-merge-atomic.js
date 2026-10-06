#!/usr/bin/env node
'use strict';
/**
 * verify-update-merge-atomic.js — N92. Two concurrent updates to different fields of the same row both survive.
 *
 * Defect: db.updateById read the whole JSONB document, merged the patch in JavaScript and wrote the whole
 * document back. Two updates in flight together (e.g. recalcInvoiceStatus setting status/amount_paid while a PUT
 * sets notes) each wrote back the other's stale copy — one field change was lost.
 * Executed: real Postgres through the real database.js. The read is slowed (50 ms) so the two updates interleave
 * deterministically; with an atomic in-database merge there is no read to slow.
 *   updateById(notes:'A') ‖ updateById(amount_paid: 300) → both present   (bug: one lost)
 *   ten concurrent updates of ten different keys → all ten present          (bug: most lost)
 *   control: a single update still sets its field and keeps the others
 *   node -r ./tests/harness/clock.js tests/harness/verify-update-merge-atomic.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let database;
  try {
    installEnv(scratch.url);
    database = require('../../database.js');
    await database.initDB();
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'um@finflow.test' }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'UM Co', currency: 'USD' }])).rows[0].id;
    const inv = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, { client: 'C', amount: 500, amount_paid: 0, status: 'pending', issue_date: '2026-07-01' }])).rows[0].id;
    // Slow every whole-row read of this table so two read-merge-write updates interleave.
    const realQuery = database.pool.query.bind(database.pool);
    database.pool.query = async (text, params) => {
      if (typeof text === 'string' && /^SELECT \* FROM invoices WHERE id = \$1/.test(text.trim())) { const r = await realQuery(text, params); await new Promise(res => setTimeout(res, 50)); return r; }
      return realQuery(text, params);
    };
    const data = async () => (await c.query(`SELECT data FROM invoices WHERE id=$1`, [inv])).rows[0].data;
    await Promise.all([database.db.updateById('invoices', inv, { notes: 'A' }), database.db.updateById('invoices', inv, { amount_paid: 300 })]);
    const d1 = await data();
    A('two concurrent updates of different fields both survive (bug: one lost)', d1.notes === 'A' && Number(d1.amount_paid) === 300, JSON.stringify({ notes: d1.notes, amount_paid: d1.amount_paid }));
    await Promise.all(Array.from({ length: 10 }, (_, i) => database.db.updateById('invoices', inv, { ['k' + i]: i })));
    const d2 = await data();
    const kept = Array.from({ length: 10 }, (_, i) => d2['k' + i] === i).filter(Boolean).length;
    A('ten concurrent updates of ten keys → all ten present (bug: most lost)', kept === 10, 'kept ' + kept + '/10');
    await database.db.updateById('invoices', inv, { status: 'partial' });
    const d3 = await data();
    // Independent of the two cases above (it must pass on the old code too): only fields no concurrent update touched.
    A('control: a single update sets its field and keeps the rest', d3.status === 'partial' && d3.client === 'C' && Number(d3.amount) === 500 && d3.issue_date === '2026-07-01', JSON.stringify({ s: d3.status, c: d3.client, a: d3.amount, d: d3.issue_date }));
    database.pool.query = realQuery;
  } finally {
    try { if (database) await database.pool.end(); } catch (_) {}
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (atomic update merge)` : `  ALL GREEN — ${pass} passed, 0 failed  (atomic update merge)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
