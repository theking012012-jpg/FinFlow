'use strict';
/**
 * verify-f90-phaseB3-business.js — PROVE (Rule 14) audit coverage of the business-record tables
 * (customers, vendors, inventory, items, chart_of_accounts) across CREATE/UPDATE/DELETE, plus a
 * money-record DELETE (bills). Each mutation must appear in the append-only audit_trail.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90-phaseB3-business.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f90b3@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  const idOf = j => (j && (j.id ?? j._dbId));

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F90B3', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    // F150 seed-debt fix: create an active entity so req.entityId resolves (production onboarding
    // POSTs /api/entities); without it, business-route writes stamp entity_id NULL → chk_*_entity_nn.
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { name: 'F90B3 Co', currency: 'USD', is_active: 1 }]);
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // customer C/U/D
    const cu = idOf((await http.post('/api/customers', { fname: 'A', lname: 'B', email: 'a@b.io' })).json);
    await http.put(`/api/customers/${cu}`, { company: 'Acme' });
    await http.del(`/api/customers/${cu}`);
    // vendor C/U/D
    const ve = idOf((await http.post('/api/vendors', { name: 'V' })).json);
    await http.put(`/api/vendors/${ve}`, { category: 'legal' });
    await http.del(`/api/vendors/${ve}`);
    // inventory C/U/D
    const iv = idOf((await http.post('/api/inventory', { name: 'Widget', units: 5, cost: 10 })).json);
    await http.put(`/api/inventory/${iv}`, { cost: 12 });
    await http.del(`/api/inventory/${iv}`);
    // item C/U/D
    const it = idOf((await http.post('/api/items', { name: 'Svc', price: 100 })).json);
    await http.put(`/api/items/${it}`, { price: 120 });
    await http.del(`/api/items/${it}`);
    // COA C/U/D
    const co = idOf((await http.post('/api/chart-of-accounts', { code: '1000', name: 'Cash', category: 'Assets' })).json);
    await http.put(`/api/chart-of-accounts/${co}`, { balance: 500 });
    await http.del(`/api/chart-of-accounts/${co}`);
    // money DELETE: bill
    const bl = idOf((await http.post('/api/bills', { vendor: 'V', amount: 300 })).json);
    await http.del(`/api/bills/${bl}`);

    const rows = (await c.query(`SELECT table_name, action FROM audit_trail WHERE user_id=$1`, [uid])).rows;
    const has = (t, a) => rows.some(r => r.table_name === t && r.action === a);
    const want = [
      ['customers', 'CREATE'], ['customers', 'UPDATE'], ['customers', 'DELETE'],
      ['vendors', 'CREATE'], ['vendors', 'UPDATE'], ['vendors', 'DELETE'],
      ['inventory', 'CREATE'], ['inventory', 'UPDATE'], ['inventory', 'DELETE'],
      ['items', 'CREATE'], ['items', 'UPDATE'], ['items', 'DELETE'],
      ['chart_of_accounts', 'CREATE'], ['chart_of_accounts', 'UPDATE'], ['chart_of_accounts', 'DELETE'],
      ['bills', 'DELETE'],
    ];
    for (const [t, a] of want) A(`${t} ${a} audited`, has(t, a), `trail=${JSON.stringify(rows.map(r => r.table_name + '/' + r.action))}`);

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
