'use strict';
/**
 * verify-f79b-bad-status-400 — F79b (owner's sweep 2026-11-02). Sending a status a record's vocabulary does not have
 * must be answered 400 — "That status is not allowed … Allowed: …" — and change nothing. Found by the sweep:
 * POST /api/quotes with status "draft" answered **500** (the database's F79 CHECK refused the row; no route validated
 * first). The class (Rule 13): every route that takes a status from the caller.
 *
 * Executed: real server + scratch Postgres (Rule 3). For each route: create with a nonsense status → 400 with the
 * allowed values, no row; edit a real row to a nonsense status → 400, the row unchanged. Bug value: 500 (or, worse, 200
 * with the nonsense stored).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f79b-bad-status-400.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };

// route · table · a valid create body (its own vocabulary). Customer name is unique: invoices/bills auto-create a
// contact from their client/vendor name, so reusing it would be refused as a duplicate (409) before status is read.
// Credit notes / vendor credits already refuse any create status but Open with their own 400 (STATUS_AT_CREATE).
const ROUTES = [
  ['/api/quotes', 'quotes', { client: 'Bad Status Co', amount: 100, expiry_date: '2026-12-31', status: 'pending' }],
  ['/api/invoices', 'invoices', { client: 'Bad Status Co', amount: 100, issue_date: '2026-07-01', due_date: '2026-08-01', status: 'pending' }],
  ['/api/bills', 'bills', { vendor: 'Bad Status Co', amount: 100, issue_date: '2026-07-01', due_date: '2026-08-01', status: 'unpaid' }],
  ['/api/credit-notes', 'credit_notes', { customer: 'Bad Status Co', amount: 10, date: '2026-07-01', status: 'Open' }],
  ['/api/vendor-credits', 'vendor_credits', { vendor: 'Bad Status Co', amount: 10, date: '2026-07-01', status: 'Open' }],
  ['/api/recurring-invoices', 'recurring_invoices', { client: 'Bad Status Co', amount: 10, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' }],
  ['/api/recurring-bills', 'recurring_bills', { vendor: 'Bad Status Co', amount: 10, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' }],
  ['/api/customers', 'customers', { name: 'Status Lane Ltd', company: 'Status Lane Ltd', email: 'lane@finflow.test', status: 'active' }],
];

(async () => {
  let scratch, server;
  console.log('\nF79b — a status the record does not have is a 400, never a 500\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1)`, [{ email: 'f79b@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.79' });
    if ((await http.post('/api/auth/login', { email: 'f79b@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const ent = (await http.post('/api/entities', { name: 'Status Co', currency: 'USD', timezone: 'UTC', country: 'US' })).json;
    await http.post('/api/entities/' + ent.id + '/activate', {});
    const count = async t => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
    for (const [route, table, body] of ROUTES) {
      const n0 = await count(table);
      const bad = await http.post(route, Object.assign({}, body, { status: 'nonsense-status' }));
      const n1 = await count(table);
      A(`POST ${route} with status "nonsense-status" → 400 naming what is allowed, no row (bug: 500)`,
        bad.status === 400 && /status|starts Open/i.test((bad.json && bad.json.error) || '') && n1 === n0, `status ${bad.status} ${String(bad.text).slice(0, 160)} rows ${n0}→${n1}`);
      const ok = await http.post(route, body);
      const id = ok.json && (ok.json.id || (ok.json.row && ok.json.row.id));
      if (!(ok.status < 300 && id)) { A(`control: POST ${route} with its own status works`, false, `status ${ok.status} ${String(ok.text).slice(0, 160)}`); continue; }
      const before = JSON.stringify((await c.query(`SELECT data FROM ${table} WHERE id = $1`, [id])).rows[0]);
      const put = await http.request('PUT', route + '/' + id, { status: 'nonsense-status' });
      const after = JSON.stringify((await c.query(`SELECT data FROM ${table} WHERE id = $1`, [id])).rows[0]);
      A(`PUT ${route}/:id to "nonsense-status" → 400, the row unchanged (bug: 500)`, put.status === 400 && before === after, `status ${put.status} ${String(put.text).slice(0, 160)} changed=${before !== after}`);
    }
    const q = await http.post('/api/quotes', { client: 'Draft Co', amount: 5, expiry_date: '2026-12-31', status: 'draft' });
    A('the sweep\'s case: a quote "draft" → 400 listing pending, accepted, declined, converted', q.status === 400 && q.json && q.json.code === 'BAD_STATUS'
      && JSON.stringify(q.json.allowed) === JSON.stringify(['pending', 'accepted', 'declined', 'converted']), JSON.stringify(q.json));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (server) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F79b bad status → 400)\n`);
  process.exit(fail ? 1 : 0);
})();
