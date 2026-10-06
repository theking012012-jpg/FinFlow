#!/usr/bin/env node
'use strict';
/**
 * verify-money-date-format.js — N63. Money writes take ISO calendar dates only, and the ledger never
 * posts an entry without a date.
 *
 * Defect: a malformed/ambiguous date ('07/10/2026', 'garbage') was stored on the document; the ledger
 * coerced anything not YYYY-MM-DD to a NULL entry_date — outside every period window and the balance
 * sheet — while computeBooks parsed the same value as a real date, so ledger and books disagreed.
 *
 * Executed against the real server + Postgres. Bug value stated:
 *   expense_date '07/10/2026' → 400 INVALID_DATE      (bug: 201, ledger entry_date NULL)
 *   bill issue_date '2026-02-30' (no such day) → 400   (bug: 201)
 *   control: ISO date → 201, ledger entry_date = that date
 *   legacy document already holding '07/10/2026' → backfill posts entry_date 2026-07-10 (bug: NULL)
 *   no ledger entry anywhere with a NULL entry_date
 *   node -r ./tests/harness/clock.js tests/harness/verify-money-date-format.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'date-fmt-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'df@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'DF Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const legacy = (await c.query(`INSERT INTO expenses (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, { description: 'legacy', amount: 30, expense_date: '07/10/2026' }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.63.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'df@finflow.test', password: PW })).status === 200);
    console.log('\n' + '='.repeat(78));
    console.log('  MONEY DATES — ISO only; the ledger never posts a dateless entry');
    console.log('='.repeat(78));
    const r1 = await h.post('/api/expenses', { description: 'ambiguous', amount: 10, expense_date: '07/10/2026' });
    A("expense_date '07/10/2026' → 400 INVALID_DATE (bug: 201)", r1.status === 400 && r1.json && r1.json.code === 'INVALID_DATE', `status ${r1.status}`);
    const r2 = await h.post('/api/bills', { vendor: 'V', amount: 10, status: 'unpaid', issue_date: '2026-02-30' });
    A("bill issue_date '2026-02-30' → 400 (bug: 201)", r2.status === 400, `status ${r2.status}`);
    const r3 = await h.post('/api/expenses', { description: 'iso', amount: 20, expense_date: '2026-07-11' });
    const ed = async (id) => ((await c.query(`SELECT entry_date::text d FROM ledger_entries WHERE source_type='expense' AND source_id=$1 AND reversal_of IS NULL`, [id])).rows[0] || {}).d;
    A('control: ISO date → 201, ledger entry_date 2026-07-11', r3.status === 201 && (await ed(r3.json.id)) === '2026-07-11', `status ${r3.status} entry=${await ed(r3.json.id)}`);
    A('backfill → 200', (await h.post('/api/gl/backfill', {})).status === 200);
    A("legacy '07/10/2026' document posts entry_date 2026-07-10 (bug: NULL)", (await ed(legacy)) === '2026-07-10', 'entry=' + await ed(legacy));
    const nulls = Number((await c.query(`SELECT COUNT(*) n FROM ledger_entries WHERE user_id=$1 AND entry_date IS NULL`, [uid])).rows[0].n);
    A('no ledger entry with a NULL entry_date', nulls === 0, 'null-dated=' + nulls);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (money date format)` : `  ALL GREEN — ${pass} passed, 0 failed  (money date format)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
