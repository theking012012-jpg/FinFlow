'use strict';
/**
 * verify-f40-cashflow-route-gone.js — PROVE (Rule 14) that the dead-but-wrong GET /api/cashflow
 * route is gone (executed: 404, not merely grepped absent — Rule 5) AND that deleting it did not
 * disturb its neighbour, the canonical cash-basis route POST /api/reports/cash-flow (still 200).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f40-cashflow-route-gone.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f40@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    server = await bootServer(scratch.url);
    await scratch.client.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: LOGIN.email, name: 'F40', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]);

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // The deleted route: must 404 (Express falls through to the catch-all when no handler matches).
    const gone = await http.get('/api/cashflow');
    A('GET /api/cashflow → 404 (route deleted; pre-fix it returned 200 with due-date buckets)',
      gone.status === 404, `status ${gone.status}`);

    // Control: the canonical cash-basis route (the one F95 fixed) still mounts and responds.
    const canonical = await http.post('/api/reports/cash-flow', {});
    A('POST /api/reports/cash-flow → 200 (neighbour intact; deletion was surgical)',
      canonical.status === 200 && canonical.json && Array.isArray(canonical.json.rows),
      `status ${canonical.status}`);

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
