'use strict';
/**
 * verify-c6-fx-logging.js — EXECUTE the failure path (Rule 14) of the C6 FX fix in GET /api/reports.
 *
 * Forces ONLY the FX gain/loss block to throw (drop fx_transactions — the block's sole table;
 * computeBooks touches fx_rates only under a display currency, none here), then asserts:
 *   (a) the endpoint still returns 200 with fx=0  → the catch fires, graceful degradation, not a 500
 *   (b) the failure is now LOGGED ('[fx] ...')     → the fix; the pre-fix silent catch logged nothing
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c6-fx-logging.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'c6fx@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
  const logs = [];
  const origErr = console.error;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'C6', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // Control: the endpoint is healthy BEFORE the fault (proves the fault, not a pre-existing break).
    const ok = await http.get('/api/reports');
    A('control: /api/reports 200 with fx tables present', ok.status === 200, 'status=' + ok.status);

    // Inject the fault: drop the FX block's only table.
    await c.query(`DROP TABLE fx_transactions CASCADE`);

    // Spy on the server-process console.error (bootServer runs in-process).
    console.error = (...a) => { logs.push(a.map(x => (x && x.message) ? x.message : String(x)).join(' ')); };
    const res = await http.get('/api/reports');
    console.error = origErr;

    A('FAILURE PATH: endpoint still 200 — the catch fired, graceful (not a 500)', res.status === 200, 'status=' + res.status);
    const body = res.json || {};
    A('FAILURE PATH: fx_realised & fx_unrealised fall back to 0', body.fx_realised === 0 && body.fx_unrealised === 0,
      `fx_realised=${body.fx_realised} fx_unrealised=${body.fx_unrealised}`);
    A('FIX: the failure is now LOGGED ("[fx] ...") — pre-fix silent catch logged nothing', logs.some(l => /\[fx\]/.test(l)),
      'captured logs: ' + JSON.stringify(logs.slice(-3)));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error = origErr;
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
