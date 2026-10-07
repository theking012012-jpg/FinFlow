#!/usr/bin/env node
'use strict';
/**
 * verify-gl-atomic-posting.js — N62. A ledger entry and all its lines are written together, or not at
 * all, so a failure part-way can be healed by the normal re-post (backfill) path.
 *
 * Defect: postLedgerEntry inserted the entry, then each line in its own statement, outside any
 * transaction. If the 2nd line failed, an entry with ONE line (unbalanced) stayed in the ledger, and
 * because its idempotency key now existed, backfill skipped it forever — the trial balance never tied.
 *
 * Failure injection (Rule 14): a scratch-DB trigger rejects the 2nd line of the entry for one expense.
 * Discriminating checks (Rule 4):
 *   after the failed post: entries for that expense = 0     (bug: 1 entry with 1 line)
 *   expense itself still saved (ledger is best-effort)      (control)
 *   after the fault clears, backfill posts it: 2 lines, balanced, booksBalanced true  (bug: skipped, unbalanced)
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-atomic-posting.js
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
    const PW = 'gl-atomic-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'glatomic@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'Atomic Co', currency: 'USD', is_active: 1 }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.8.7.1' });
    A('login', (await h.post('/api/auth/login', { email: 'glatomic@finflow.test', password: PW })).status === 200);
    const ok = await h.post('/api/expenses', { description: 'Normal expense', amount: 40, expense_date: '2026-07-03' });
    A('control expense posts normally', ok.status === 201);

    console.log('\n' + '='.repeat(78));
    console.log('  LEDGER POSTING IS ATOMIC — entry + all lines, or nothing');
    console.log('='.repeat(78));

    await c.query(`CREATE OR REPLACE FUNCTION _harness_fail_2nd_gl_line() RETURNS trigger AS $$
      BEGIN
        IF (SELECT description FROM ledger_entries WHERE id = NEW.entry_id) LIKE '%Faulty%'
           AND (SELECT COUNT(*) FROM ledger_lines WHERE entry_id = NEW.entry_id) >= 1 THEN
          RAISE EXCEPTION 'injected ledger line failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await c.query(`CREATE TRIGGER _harness_fail_2nd_gl_line BEFORE INSERT ON ledger_lines FOR EACH ROW EXECUTE FUNCTION _harness_fail_2nd_gl_line()`);

    const bad = await h.post('/api/expenses', { description: 'Faulty expense', amount: 75, expense_date: '2026-07-04' });
    A('expense is still saved (ledger write is best-effort) → 201', bad.status === 201, 'status ' + bad.status);
    const entries = async () => (await c.query(`SELECT le.id, (SELECT COUNT(*) FROM ledger_lines ll WHERE ll.entry_id = le.id)::int AS n
      FROM ledger_entries le WHERE le.user_id=$1 AND le.source_type='expense' AND le.source_id=$2`, [uid, bad.json.id])).rows;
    const e1 = await entries();
    A('no half-written entry left behind (bug: 1 entry with 1 line)', e1.length === 0, JSON.stringify(e1));

    await c.query(`DROP TRIGGER _harness_fail_2nd_gl_line ON ledger_lines`);
    const bf = await h.post('/api/gl/backfill', {});
    A('backfill after the fault clears → 200', bf.status === 200, `status ${bf.status}: ${bf.text.slice(0, 120)}`);
    const e2 = await entries();
    A('entry now posted complete: 1 entry, 2 lines (bug: backfill skipped it, still 1 line)', e2.length === 1 && e2[0].n === 2, JSON.stringify(e2));
    const v = await h.get('/api/gl/verify');
    A('trial balance ties and books balance (bug: false)', v.json && v.json.booksBalanced === true, JSON.stringify(v.json && v.json.entities && v.json.entities[0] && v.json.entities[0].detail));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (GL atomic posting)` : `  ALL GREEN — ${pass} passed, 0 failed  (GL atomic posting)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
