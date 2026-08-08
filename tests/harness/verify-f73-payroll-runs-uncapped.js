'use strict';
/**
 * verify-f73-payroll-runs-uncapped.js — PROVE (Rule 14) that GET /api/payroll-runs returns ALL runs
 * (no LIMIT 50), so window.payrollRuns — which feeds the client payroll total and the F33-C chart
 * buckets — is complete. Seed 60 runs → the endpoint must return 60. Pre-fix it returned 50.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f73-payroll-runs-uncapped.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f73@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F73', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    // 60 lifetime payroll runs
    for (let i = 0; i < 60; i++) {
      await c.query(
        `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
         VALUES ($1, NULL, $2, $3, 'approved', 1000, 0, 1000)`,
        [uid, '2020-' + String((i % 12) + 1).padStart(2, '0'), '2020-01-15']);
    }

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}`);

    const res = await http.get('/api/payroll-runs');
    const rows = Array.isArray(res.json) ? res.json : [];
    A('GET /api/payroll-runs returns ALL 60 runs (LIMIT 50 removed)', rows.length === 60,
      `got ${rows.length} rows (pre-fix this capped at 50)`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
