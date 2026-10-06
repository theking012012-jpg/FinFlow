#!/usr/bin/env node
'use strict';
/**
 * verify-api-key-mint-rbac.js — N26. Only owner/admin can mint, list or revoke API keys, and a member
 * granted only some entities can mint keys only for those entities.
 *
 * Defect: POST /api/api-keys had requireAuth only — any non-viewer member, including the external
 * accountant and a per-entity admin (by omitting entity_id), could mint an ALL-entities key: a standing read credential over the
 * whole account that bypasses session RBAC and outlives the member's access.
 *
 * Executed against the real server + Postgres. Owner account with entities A and B; members:
 * accountant, viewer, admin scoped to [A], unscoped admin. Bug value stated:
 *   accountant mint (all)          → 403  (bug: 201)
 *   accountant list keys           → 403  (bug: 200)
 *   viewer mint                    → 403  (control: coarse gate)
 *   admin[A] mint, no entity_id    → 403  (bug: 201 — entityId null = an all-entities key)
 *   admin[A] mint 'all' / entity B → 403  (control — already refused by the entity resolver / gate)
 *   admin[A] mint for entity A     → 201  (control)
 *   unscoped admin mint all        → 201  (control); owner mint all → 201 (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-api-key-mint-rbac.js
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
    const PW = 'api-mint-pw-1';
    const mkUser = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const owner = await mkUser('mint-owner@finflow.test');
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [owner, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [owner, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    let ip = 1;
    const member = async (email, role, extra = {}) => {
      const id = await mkUser(email);
      await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [owner, Object.assign({ email, name: email, role, status: 'active', member_user_id: String(id) }, extra)]);
      const h = new HarnessHttp(server.baseUrl, { xff: '10.26.0.' + (ip++) });
      if ((await h.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + email);
      return h;
    };
    const O = new HarnessHttp(server.baseUrl, { xff: '10.26.0.200' });
    A('owner login', (await O.post('/api/auth/login', { email: 'mint-owner@finflow.test', password: PW })).status === 200);
    const ACC = await member('mint-acc@finflow.test', 'accountant');
    const VIEW = await member('mint-view@finflow.test', 'viewer');
    const ADA = await member('mint-adminA@finflow.test', 'admin', { entity_access: [eA] });
    const ADM = await member('mint-admin@finflow.test', 'admin');

    console.log('\n' + '='.repeat(78));
    console.log('  API KEY MINTING — owner/admin only, within the caller\'s entity grant');
    console.log('='.repeat(78));
    const st = async (h, body) => (await h.post('/api/api-keys', body)).status;
    A('accountant mint all-entities key → 403 (bug: 201)', (await st(ACC, { name: 'x' })) === 403);
    A('accountant list keys → 403 (bug: 200)', (await ACC.get('/api/api-keys')).status === 403);
    A('control: viewer mint → 403', (await st(VIEW, { name: 'x' })) === 403);
    A('admin scoped to [A]: mint with NO entity_id → 403 (bug: 201, an all-entities key)', (await st(ADA, { name: 'x' })) === 403);
    A('control: admin scoped to [A]: entity_id "all" → 403 (already refused by the entity resolver)', (await st(ADA, { name: 'x', entity_id: 'all' })) === 403);
    A('control: admin scoped to [A]: entity B → 403 (already refused by the per-entity gate)', (await st(ADA, { name: 'x', entity_id: eB })) === 403);
    A('control: admin scoped to [A]: mint for entity A → 201', (await st(ADA, { name: 'x', entity_id: eA })) === 201);
    A('control: unscoped admin mint all-entities → 201', (await st(ADM, { name: 'x' })) === 201);
    A('control: owner mint all-entities → 201', (await st(O, { name: 'x' })) === 201);
    const n = Number((await c.query(`SELECT COUNT(*) n FROM api_keys WHERE user_id=$1`, [owner])).rows[0].n);
    A('exactly the 3 permitted keys exist (bug: 5)', n === 3, 'keys=' + n);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (API key mint RBAC)` : `  ALL GREEN — ${pass} passed, 0 failed  (API key mint RBAC)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
