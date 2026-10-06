#!/usr/bin/env node
'use strict';
/**
 * verify-payroll-run-atomic.js — N59. Creating a payroll run writes the header and ALL its lines
 * together, or nothing.
 *
 * Defect: the header was inserted, then each line in its own statement. A failure part-way left a run
 * whose total_gross disagreed with Σ payroll_run_lines (Rule 12: basis C reads the lines).
 *
 * Failure injection (Rule 14): a scratch-DB trigger rejects the SECOND line insert. Roster: two
 * employees (3000 + 2000). Discriminating checks (Rule 4):
 *   failed create → 0 runs for the period, 0 orphan lines   (bug: 1 run, total_gross 5000, 1 line)
 *   after the trigger is dropped, a retry → 1 run, 2 lines, Σ lines = total_gross = 5000
 *   node -r ./tests/harness/clock.js tests/harness/verify-payroll-run-atomic.js
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
    const PW = 'payroll-atomic-pw';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'patomic@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Pay Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    for (const [fname, gross] of [['Ana', 3000], ['Ben', 2000]]) {
      await c.query(`INSERT INTO payroll (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { fname, lname: 'X', gross, deductions: [] }]);
    }
    const h = new HarnessHttp(server.baseUrl, { xff: '10.8.6.1' });
    A('login', (await h.post('/api/auth/login', { email: 'patomic@finflow.test', password: PW })).status === 200);
    const runs = async () => (await c.query(`SELECT id, total_gross FROM payroll_runs WHERE user_id=$1 AND period='2026-07'`, [uid])).rows;
    const lines = async () => Number((await c.query(`SELECT COUNT(*) n FROM payroll_run_lines`)).rows[0].n);

    console.log('\n' + '='.repeat(78));
    console.log('  PAYROLL RUN CREATE IS ATOMIC — header + all lines, or nothing');
    console.log('='.repeat(78));

    await c.query(`CREATE OR REPLACE FUNCTION _harness_fail_2nd_line() RETURNS trigger AS $$
      BEGIN IF (SELECT COUNT(*) FROM payroll_run_lines WHERE run_id = NEW.run_id) >= 1 THEN RAISE EXCEPTION 'injected line failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await c.query(`CREATE TRIGGER _harness_fail_2nd_line BEFORE INSERT ON payroll_run_lines FOR EACH ROW EXECUTE FUNCTION _harness_fail_2nd_line()`);

    const r1 = await h.post('/api/payroll-runs', { period: '2026-07', idempotency_key: 'run-atomic-1' });
    A('create with an injected line failure → 500', r1.status === 500, 'status ' + r1.status);
    const after = await runs();
    A('no run header left behind (bug: 1 header, total_gross 5000)', after.length === 0, JSON.stringify(after));
    A('no orphan lines left behind (bug: 1)', (await lines()) === 0, 'lines=' + await lines());

    await c.query(`DROP TRIGGER _harness_fail_2nd_line ON payroll_run_lines`);
    const r2 = await h.post('/api/payroll-runs', { period: '2026-07', idempotency_key: 'run-atomic-1' });
    A('retry with the same token after the fault clears → 201', r2.status === 201, `status ${r2.status}: ${r2.text.slice(0, 100)}`);
    const ok = await runs();
    const sumLines = Number((await c.query(`SELECT COALESCE(SUM(gross+bonus+overtime),0) s FROM payroll_run_lines WHERE run_id=$1`, [ok[0] && ok[0].id])).rows[0].s);
    A('exactly one run with 2 lines', ok.length === 1 && (await lines()) === 2, `runs=${ok.length} lines=${await lines()}`);
    A('Σ lines = header total_gross = 5000', ok[0] && Number(ok[0].total_gross) === 5000 && sumLines === 5000, `header=${ok[0] && ok[0].total_gross} lines=${sumLines}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (payroll run atomic)` : `  ALL GREEN — ${pass} passed, 0 failed  (payroll run atomic)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
