'use strict';
/**
 * verify-payroll-approve-guard.js — payroll approve state guard. A PAID run has already been recognised
 * and settled; re-approving it must NOT revert status paid → approved (a backwards transition that would
 * un-settle the cash leg). The route must reject it (409) and leave the run 'paid'. A draft/approved run
 * must still be approvable.
 *
 * EXECUTED against real Postgres + the real PUT /api/payroll-runs/:id/approve route. Discriminating
 * (Rule 14): before the fix the UPDATE had no status precondition, so approving a paid run returned 200
 * and wrote status='approved'; after the fix it returns 409 and the row stays 'paid'.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-payroll-approve-guard.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'payroll-guard@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'Guard Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]
    )).rows[0].id;
    const E = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'USD Co', currency: 'USD', is_active: 1, sort_order: 0 }])).rows[0].id;

    const mkRun = async (status) => (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid, E, 'July 2026', '2026-07-25', status, 5000, 0, 5000]
    )).rows[0].id;
    const paidId = await mkRun('paid');
    const draftId = await mkRun('draft');

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    // 1 · re-approving a PAID run is rejected and does NOT revert status
    const res = await http.put('/api/payroll-runs/' + paidId + '/approve', {});
    A('re-approve paid run → 409 (not 200)', res.status === 409, `status=${res.status} body=${res.text && res.text.slice(0,120)}`);
    const paidNow = (await c.query(`SELECT status FROM payroll_runs WHERE id=$1`, [paidId])).rows[0].status;
    A('paid run status STAYS paid (not reverted to approved)', String(paidNow).toLowerCase() === 'paid', `status=${paidNow}`);

    // 2 · a draft run is still approvable (guard did not over-block)
    const ok = await http.put('/api/payroll-runs/' + draftId + '/approve', {});
    A('approve draft run → 200', ok.status === 200, `status=${ok.status}`);
    const draftNow = (await c.query(`SELECT status FROM payroll_runs WHERE id=$1`, [draftId])).rows[0].status;
    A('draft run transitions to approved', String(draftNow).toLowerCase() === 'approved', `status=${draftNow}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (payroll approve state guard)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
