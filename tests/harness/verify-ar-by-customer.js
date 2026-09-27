#!/usr/bin/env node
'use strict';
/**
 * verify-ar-by-customer.js — F204: GET /api/reports/ar-by-customer returns per-customer AR built from
 * the SAME recognized+D2 set and FX path as computeBooks.outstanding, so Σ(rows) == outstanding
 * (the F58 invariant). This is the server foundation that lets the AR report drop its full-invoice-list
 * dependency (which is what blocks invoice-list pagination).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-ar-by-customer.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');
const EXPECTED = require('./expected.js');

let pass = 0, fail = 0;
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const LOGIN = { email: 'seed@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    await initSchema(scratch.url);
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Seed Owner', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }])).rows[0].id;
    await seed(c, userId);

    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, 'HTTP ' + login.status);

    const res = await http.get('/api/reports/ar-by-customer');
    A('endpoint returns 200', res.status === 200, 'HTTP ' + res.status);
    const rows = res.json?.rows || [];
    const total = res.json?.total;

    // Canonical total from the golden master.
    A('reported total == canonical net AR (arNet 7,300)', near(total, EXPECTED.BALANCES.arNet), 'total=' + total);
    const sumRows = rows.reduce((s, r) => s + r.amount, 0);
    A('Σ(per-customer rows) == total (F58 invariant)', near(sumRows, total), 'Σrows=' + sumRows + ' total=' + total);

    const byName = Object.fromEntries(rows.map(r => [r.customer, r.amount]));
    A('Customer A netted of CN-1 == 300', near(byName['Customer A'], EXPECTED.BALANCES.customerANet), JSON.stringify(byName));
    A('Customer B == 7,000 (INV-6 future-dated is D2-excluded)', near(byName['Customer B'], 7000), JSON.stringify(byName));
    A('no draft invoice leaked in (INV-4 draft excluded)', rows.every(r => r.amount > 0) && !rows.some(r => near(r.amount, 9999)));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (per-customer AR reconciles to canonical outstanding)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[ar-cust] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
