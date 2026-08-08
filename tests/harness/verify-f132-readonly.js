'use strict';
/* F132 — expired trial is READ-ONLY: reads (GET + report POSTs) pass, mutations 402 TRIAL_EXPIRED.
 * Pre-fix: checkPlan 402'd EVERY request, so the GET/report assertions FAIL (proving discrimination). */
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const LOGIN = { email: 'f132@finflow.test', password: 'harness-password-not-a-secret' };
(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const past = new Date(Date.now() - 5 * 864e5).toISOString();
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F132', plan: 'trial', trial_ends: past, role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200 (auth open even when expired)', login.status === 200, `status=${login.status} ${(login.text||'').slice(0,120)}`);
    const g = await http.get('/api/invoices');
    A('READ  GET /api/invoices → 200 (read-only allows viewing)  [pre-fix: 402]', g.status === 200, `status=${g.status} ${(g.text||'').slice(0,120)}`);
    const rep = await http.post('/api/reports/profit-loss', {});
    A('READ  POST /api/reports/profit-loss → 200 (report read allowed)  [pre-fix: 402]', rep.status === 200, `status=${rep.status} ${(rep.text||'').slice(0,120)}`);
    const w = await http.post('/api/invoices', { client: 'X', amount: 100 });
    A('WRITE POST /api/invoices → 402 TRIAL_EXPIRED (mutation blocked)', w.status === 402 && /TRIAL_EXPIRED/.test(w.text || ''), `status=${w.status} ${(w.text||'').slice(0,120)}`);
    const w2 = await http.post('/api/expenses', { description: 'X', amount: 50 });
    A('WRITE POST /api/expenses → 402 (mutation blocked)', w2.status === 402, `status=${w2.status}`);
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
