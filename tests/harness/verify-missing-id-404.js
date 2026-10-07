#!/usr/bin/env node
'use strict';
/**
 * verify-missing-id-404.js — N30 class. Every PUT / DELETE on /api/<resource>/:id answers 404 for an id
 * that does not exist (or belongs to another tenant) — never a fake-success 2xx.
 *
 * Defect (N30): PUT sales-receipts / credit-notes / vendor-credits / payments-made / payments-received
 * returned {ok:true} for a nonexistent id, so a client "saved" an edit that went nowhere.
 *
 * EXECUTED CLASS ENUMERATION (Rule 13): the route list is read from the live Express router — every
 * PUT/DELETE path with a single trailing :id under /api — and each is called with an id that does not
 * exist. Any 2xx is reported by path. (Cross-tenant ids are covered by verify-tenant-isolation.js.)
 * Found on the code before this fix: 13 routes, not the 5 N30 named — the DELETEs of quotes, vendors,
 * recurring bills/invoices/personal transactions, and PUT+DELETE of sales receipts, credit notes,
 * payments made and vendor credits.
 *   node -r ./tests/harness/clock.js tests/harness/verify-missing-id-404.js
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
    const app = require('../../server.js');
    const PW = 'missing-id-pw-1';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const me = await mk('mi-me@finflow.test'), other = await mk('mi-other@finflow.test');
    for (const u of [me, other]) await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [u, { name: 'Co ' + u, currency: 'USD', is_active: 1 }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.30.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'mi-me@finflow.test', password: PW })).status === 200);

    // Routes from the live router: METHOD /api/<seg>/:id (exactly one param, last segment).
    const routes = [];
    for (const layer of app._router.stack) {
      const r = layer.route; if (!r || typeof r.path !== 'string') continue;
      if (!/^\/api\/[a-z0-9-]+(\/[a-z0-9-]+)?\/:id$/.test(r.path)) continue;
      for (const m of Object.keys(r.methods)) if (m === 'put' || m === 'delete') routes.push([m.toUpperCase(), r.path]);
    }
    A('router exposes PUT/DELETE :id routes to check', routes.length > 20, 'n=' + routes.length);
    const bad = [];
    for (const [m, path] of routes) {
      const url = path.replace(':id', '999999');
      const r = m === 'PUT' ? await h.put(url, { amount: 1, name: 'x', status: 'paid' }) : await h.del(url);
      if (r.status >= 200 && r.status < 300) bad.push(`${m} ${path} → ${r.status}`);
    }
    console.log('\n' + '='.repeat(78));
    console.log(`  NONEXISTENT ID → 404 on every PUT/DELETE :id route (${routes.length} checked)`);
    console.log('='.repeat(78));
    A('no PUT/DELETE :id route returns 2xx for a nonexistent id (bug: fake success)', bad.length === 0, bad.join('\n          '));
    // Controls: the guard must not block a real owned row, and must refuse another tenant's real row.
    const mine = await h.post('/api/credit-notes', { customer: 'Ctl', amount: 5, date: '2026-07-01', status: 'Open' });
    const myId = mine.json && (mine.json.id || (mine.json.row && mine.json.row.id));
    A('control: own credit note created', mine.status < 300 && myId, `status ${mine.status}: ${mine.text.slice(0, 120)}`);
    A('control: PUT own credit note → 2xx', (await h.put('/api/credit-notes/' + myId, { customer: 'Ctl2', amount: 6, date: '2026-07-01', status: 'Open' })).status < 300);
    const otherEnt = (await c.query(`SELECT id FROM entities WHERE user_id=$1`, [other])).rows[0].id;
    const theirs = (await c.query(`INSERT INTO credit_notes (user_id,entity_id,data) VALUES ($1,$3,$2) RETURNING id`, [other, { customer: 'Theirs', amount: 9, date: '2026-07-01', status: 'Open' }, otherEnt])).rows[0].id;
    A("another tenant's credit note: DELETE → 404 (bug: 200)", (await h.del('/api/credit-notes/' + theirs)).status === 404);
    A("  their row still exists", (await c.query(`SELECT 1 FROM credit_notes WHERE id=$1`, [theirs])).rowCount === 1);
    A('control: DELETE own credit note → 2xx and row gone', (await h.del('/api/credit-notes/' + myId)).status < 300 && (await c.query(`SELECT 1 FROM credit_notes WHERE id=$1`, [myId])).rowCount === 0);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (missing id → 404)` : `  ALL GREEN — ${pass} passed, 0 failed  (missing id → 404)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
