'use strict';
/**
 * verify-entity-leakage-sweep.js — DUAL-ENTITY DATA-LEAKAGE SWEEP (Rule 13: enumerate the class).
 *
 * For every list endpoint whose table stores entity_id, seed ONE row in entity E1 and ONE row in
 * entity E2 (distinct probe markers), then GET the list as E1 and as E2. A correctly-scoped list
 * returns only its own entity's row (null-inclusive scoping); a LEAKING list returns the other
 * entity's row too. Real HTTP against the real server + real Postgres — no stubs (Rule 3).
 *
 * The discriminator is the _probe marker: if E1's list contains a row marked 'E2', that is a leak.
 *
 *   node -r ./tests/harness/clock.js -r /tmp/pg-shim.cjs tests/harness/verify-entity-leakage-sweep.js
 */
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'leak@finflow.test', password: 'harness-password-not-a-secret' };

// table → GET path. Every table here stores entity_id (verified from its INSERT).
const SURFACES = [
  ['invoices',          '/api/invoices'],
  ['expenses',          '/api/expenses'],
  ['customers',         '/api/customers'],
  ['inventory',         '/api/inventory'],
  ['items',             '/api/items'],
  ['payroll',           '/api/payroll'],
  ['holdings',          '/api/holdings'],
  ['journals',          '/api/journals'],
  ['chart_of_accounts', '/api/chart-of-accounts'],
  ['quotes',            '/api/quotes'],
  ['vendors',           '/api/vendors'],
  ['bills',             '/api/bills'],
  ['recurring_bills',   '/api/recurring-bills'],
  ['recurring_invoices','/api/recurring-invoices'],
  ['sales_receipts',    '/api/sales-receipts'],
  ['payments_received', '/api/payments-received'],
  ['payments_made',     '/api/payments-made'],
];

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const leaks = [];
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '  ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Leak', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const mkEnt = async (name) => (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name, is_active: 0 }]
    )).rows[0].id;
    const E1 = await mkEnt('Entity One');
    const E2 = await mkEnt('Entity Two');

    // Seed one row per table in each entity. A superset of fields keeps every GET's sort comparator
    // safe (code/name/revenue), and _probe identifies the owning entity.
    const seed = async (table, eid, probe) => c.query(
      `INSERT INTO ${table} (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      // no `status` — F79 CHECK constraints (invoices/bills/credit_notes) have differing
      // vocabularies (Rule 11); a leak test doesn't need it, so omit it to satisfy every table.
      [uid, eid, { _probe: probe, amount: 100, revenue: 100, code: '1000-' + probe, name: 'N-' + probe, date: '2026-07-10' }]);

    for (const [table] of SURFACES) { await seed(table, E1, 'E1'); await seed(table, E2, 'E2'); }

    const http = new HarnessHttp(server.baseUrl);
    A('login 200 (business plan)', (await http.post('/api/auth/login', LOGIN)).status === 200);

    console.log('\n── per-surface cross-entity leak check (E1 list must NOT contain E2 rows) ──');
    for (const [table, path] of SURFACES) {
      const r1 = await http.get(`${path}?entity_id=${E1}`);
      const r2 = await http.get(`${path}?entity_id=${E2}`);
      const a1 = Array.isArray(r1.json) ? r1.json : (r1.json && Array.isArray(r1.json.rows) ? r1.json.rows : []);
      const a2 = Array.isArray(r2.json) ? r2.json : (r2.json && Array.isArray(r2.json.rows) ? r2.json.rows : []);
      const e1SeesE2 = a1.some(x => x && x._probe === 'E2');
      const e2SeesE1 = a2.some(x => x && x._probe === 'E1');
      const ok = r1.status === 200 && r2.status === 200 && !e1SeesE2 && !e2SeesE1;
      if (!ok && (e1SeesE2 || e2SeesE1)) leaks.push(table);
      A(`${table.padEnd(20)} scoped`, ok,
        r1.status !== 200 || r2.status !== 200 ? `status ${r1.status}/${r2.status}` : (e1SeesE2 || e2SeesE1 ? `LEAK — E1 sees E2:${e1SeesE2} E2 sees E1:${e2SeesE1}` : ''));
    }

    console.log(`\n  ${fail === 0 ? 'ALL SCOPED — no leaks' : fail + ' FAILED'} — ${pass} passed, ${fail} failed`);
    if (leaks.length) console.log('  LEAKING TABLES: ' + leaks.join(', '));
    console.log('');
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
