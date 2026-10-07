#!/usr/bin/env node
'use strict';
/**
 * verify-api-key-entity-scope.js — N27. An API key created for ONE entity only reads that entity.
 *
 * Defect: POST /api/api-keys stored the key's entity as data.key_entity_id (the entity_id column is
 * null), but requireApiKey read data.entity_id — never set — so every entity-scoped key behaved as an
 * ALL-entities key. A key handed to one business's integration read every business on the account.
 *
 * Executed against the real server + Postgres. Seed (Rule 4 — figures identify the source): entity A has
 * one pending invoice of 100, entity B one of 7000.
 *   A-scoped key: /api/v1/invoices → only A's (bug: A + B)
 *   A-scoped key: /api/v1/reports/summary revenue = 100 (bug: 7100)
 *   A-scoped key: /api/v1/me scope = A's id (bug: 'all')
 *   control: all-entities key sees both invoices
 *   node -r ./tests/harness/clock.js tests/harness/verify-api-key-entity-scope.js
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
    const PW = 'api-scope-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'apiscope@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { client: 'A-Client', amount: 100, status: 'pending', issue_date: '2026-07-10' }]);
    await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eB, { client: 'B-Client', amount: 7000, status: 'pending', issue_date: '2026-07-10' }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.27.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'apiscope@finflow.test', password: PW })).status === 200);

    const kA = await h.post('/api/api-keys', { name: 'A only', entity_id: eA });
    const kAll = await h.post('/api/api-keys', { name: 'all', entity_id: 'all' });
    A('keys created (201)', kA.status === 201 && kAll.status === 201 && kA.json.entity_id === eA, JSON.stringify(kA.json));
    const api = async (key, p) => { const r = await fetch(server.baseUrl + p, { headers: { Authorization: 'Bearer ' + key, 'X-Forwarded-For': '10.27.0.2' } }); return { status: r.status, json: await r.json().catch(() => null) }; };

    console.log('\n' + '='.repeat(78));
    console.log('  API KEY ENTITY SCOPE — an entity key reads only its entity');
    console.log('='.repeat(78));
    const inv = await api(kA.json.key, '/api/v1/invoices');
    const clients = (inv.json && inv.json.data || []).map(i => i.client).sort();
    A('A-scoped key: invoices = [A-Client] only (bug: A-Client + B-Client)', JSON.stringify(clients) === '["A-Client"]', JSON.stringify(clients));
    const sum = await api(kA.json.key, '/api/v1/reports/summary');
    A('A-scoped key: summary revenue = 100 (bug: 7100)', sum.json && Number(sum.json.revenue) === 100, JSON.stringify(sum.json));
    const me = await api(kA.json.key, '/api/v1/me');
    A('A-scoped key: /me scope = A (bug: "all")', me.json && me.json.scope === eA, JSON.stringify(me.json));
    const all = await api(kAll.json.key, '/api/v1/invoices');
    A('control: all-entities key sees both invoices', (all.json && all.json.data || []).length === 2, JSON.stringify(all.json));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (API key entity scope)` : `  ALL GREEN — ${pass} passed, 0 failed  (API key entity scope)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
