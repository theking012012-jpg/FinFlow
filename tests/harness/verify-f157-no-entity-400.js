'use strict';
/**
 * verify-f157-no-entity-400.js (Rule 9 + Rule 13 + Rule 14) — a business-create request by a user
 * with NO active entity must return a clean 400, not a generic 500.
 *
 * Register creates no default entity; business inserts stamp entity_id = req.entityId (NULL here),
 * and chk_<table>_entity_nn then throws — surfacing as an opaque 500. The F157 fix guards this in the
 * single shared write path (db.insert, database.js) so a new create route cannot bypass it, and the
 * global error handler exposes the typed status.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f157-no-entity-400.js
 *
 * Discriminates (Rule 14): the assertion is 400 AND an entity-naming body. Before the fix the same
 * request returns 500 with the generic "An unexpected error occurred" message (both halves fail).
 */
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f157@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`)); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    // A user with NO entity — exactly what POST /api/auth/register produces (it creates no default entity).
    await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: LOGIN.email, name: 'F157', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    );
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // One create per constrained surface. Each must be a clean 400 that names the entity, never a 500.
    const cases = [
      ['/api/invoices',        { client: 'C', amount: 100, status: 'pending' }],
      ['/api/expenses',        { description: 'R', category: 'Other', amount: 50, expense_date: '2026-06-10' }],
      ['/api/bills',           { vendor: 'V', amount: 200, status: 'unpaid' }],
      ['/api/customers',       { fname: 'A', lname: 'B' }],
      ['/api/vendors',         { name: 'V Co' }],
      ['/api/journals',        { description: 'J', date: '2026-06-10', lines: [{ debit: 100 }, { credit: 100 }] }],
      ['/api/chart-of-accounts', { code: '1000', name: 'Cash', category: 'Assets' }],
    ];
    for (const [route, body] of cases) {
      const r = await http.post(route, body);
      A(`${route} with no active entity → 400 (not 500)`, r.status === 400, `status ${r.status}: ${r.text?.slice(0, 140)}`);
      A(`${route} 400 body names the entity (client-safe message)`, r.status === 400 && /entity/i.test(r.text || ''), `body ${r.text?.slice(0, 140)}`);
    }

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : 'RED'} — ${pass} passed, ${fail} failed  (F157 no-entity → 400)`);
  } catch (e) {
    console.error('FATAL', e && (e.stack || e.message || e));
    fail++;
  } finally {
    try { await server?.close(); } catch {}
    try { await scratch?.stop(); } catch {}
    process.exit(fail ? 1 : 0);
  }
})();
