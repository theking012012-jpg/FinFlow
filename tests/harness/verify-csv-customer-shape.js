#!/usr/bin/env node
'use strict';
/**
 * verify-csv-customer-shape.js — N112. A customer imported from CSV has the fields the customer list, invoices
 * and reminders read (fname, lname, company, status, revenue) — not a lone `name`.
 *
 * Defect: the CSV customer builder stored { name, email, phone }; renderCustomers shows fname + lname, company,
 * status and revenue, so an imported customer listed with a blank name, no status and NaN revenue.
 *   import "Acme Trading Ltd, ap@acme.test" → company "Acme Trading Ltd", fname "Acme", status active, revenue 0
 *   (bug: no company/fname/status/revenue — only `name`)
 *   node -r ./tests/harness/clock.js tests/harness/verify-csv-customer-shape.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'csv-cust-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'cc@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'CC Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.112.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'cc@finflow.test', password: PW })).status === 200);
    const r = await h.post(`/api/import/csv?entity_id=${eA}`, { type: 'customers', content: 'name,email\nAcme Trading Ltd,ap@acme.test\n' });
    A('import → 200, 1 added', r.status === 200 && r.json && r.json.added === 1, `status ${r.status} ${r.text.slice(0, 100)}`);
    const cust = ((await h.get(`/api/customers?entity_id=${eA}`)).json || [])[0] || {};
    A('company = "Acme Trading Ltd" (bug: missing)', cust.company === 'Acme Trading Ltd', JSON.stringify(cust));
    A('fname present for the list\'s name column (bug: missing → blank row)', typeof cust.fname === 'string' && cust.fname.length > 0, JSON.stringify(cust.fname));
    A('status active, revenue 0 (bug: missing → no badge, NaN revenue)', cust.status === 'active' && Number(cust.revenue) === 0, JSON.stringify({ s: cust.status, r: cust.revenue }));
    A('email kept', cust.email === 'ap@acme.test');
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (CSV customer shape)` : `  ALL GREEN — ${pass} passed, 0 failed  (CSV customer shape)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
