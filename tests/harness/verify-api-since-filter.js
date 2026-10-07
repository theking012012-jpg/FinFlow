#!/usr/bin/env node
'use strict';
/**
 * verify-api-since-filter.js — N28. /api/v1/{invoices,expenses}?since=… returns only rows created at or
 * after that instant.
 *
 * Defect: the filter compared String(created_at) — for a Postgres timestamptz that is a Date, which
 * stringifies as "Wed Jul 01 2026 …" — against the caller's ISO string. "W"/"S"/… sort after every
 * digit, so every row passed: ?since never filtered anything, and an incremental sync re-pulled
 * everything every time. A garbage value was silently accepted.
 *
 * Executed against the real server + Postgres. Seed: invoices created 2026-07-01T00:00Z ("old") and
 * 2026-07-20T00:00Z ("new"); expenses likewise. Bug value stated:
 *   ?since=2026-07-10            → invoices [new] only    (bug: [new, old])
 *   ?since=2026-07-10T00:00:00Z  → expenses [new] only    (bug: both)
 *   ?since=2026-07-20T00:00:00Z  → [new] (boundary inclusive)
 *   ?since=not-a-date            → 400                    (bug: 200, everything)
 *   no since                     → both (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-api-since-filter.js
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
    const PW = 'api-since-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'apisince@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Since Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    for (const [label, ts] of [['old', '2026-07-01T00:00:00Z'], ['new', '2026-07-20T00:00:00Z']]) {
      await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at) VALUES ($1,$2,$3,$4)`, [uid, eid, { client: label, amount: 10, status: 'pending', issue_date: '2026-07-01' }, ts]);
      await c.query(`INSERT INTO expenses (user_id,entity_id,data,created_at) VALUES ($1,$2,$3,$4)`, [uid, eid, { description: label, amount: 5, expense_date: '2026-07-01' }, ts]);
    }
    const h = new HarnessHttp(server.baseUrl, { xff: '10.28.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'apisince@finflow.test', password: PW })).status === 200);
    const key = (await h.post('/api/api-keys', { name: 'since' })).json.key;
    const api = async (p) => { const r = await fetch(server.baseUrl + p, { headers: { Authorization: 'Bearer ' + key, 'X-Forwarded-For': '10.28.0.2' } }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const labels = (r, f) => (r.json && r.json.data || []).map(x => x[f]).sort().join(',');

    console.log('\n' + '='.repeat(78));
    console.log('  /api/v1 ?since — filters by creation instant');
    console.log('='.repeat(78));
    const r1 = await api('/api/v1/invoices?since=2026-07-10');
    A('invoices ?since=2026-07-10 → [new] (bug: new,old)', labels(r1, 'client') === 'new', labels(r1, 'client'));
    const r2 = await api('/api/v1/expenses?since=2026-07-10T00:00:00Z');
    A('expenses ?since=2026-07-10T00:00:00Z → [new] (bug: new,old)', labels(r2, 'description') === 'new', labels(r2, 'description'));
    const r3 = await api('/api/v1/invoices?since=2026-07-20T00:00:00Z');
    A('boundary inclusive: ?since=2026-07-20T00:00:00Z → [new]', labels(r3, 'client') === 'new', labels(r3, 'client'));
    const r4 = await api('/api/v1/invoices?since=not-a-date');
    A('?since=not-a-date → 400 (bug: 200, everything)', r4.status === 400, 'status ' + r4.status);
    const r5 = await api('/api/v1/invoices');
    A('control: no since → both', labels(r5, 'client') === 'new,old', labels(r5, 'client'));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (API since filter)` : `  ALL GREEN — ${pass} passed, 0 failed  (API since filter)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
