#!/usr/bin/env node
'use strict';
/**
 * verify-personal-account-scope.js — N16b. A personal asset/liability belongs to the person, not to whichever
 * business was selected when it was added.
 *
 * Defect: POST /api/personal-accounts stored entity_id = the ACTIVE business, so the account showed on the
 * personal page (and in net worth) only while that business was selected.
 *   add "Savings" 1000 while viewing business A → stored entity-less; listed while viewing B   (bug: tagged A, hidden under B)
 *   net-worth snapshot while viewing B includes it (1000)                                     (bug: 0)
 *   node -r ./tests/harness/clock.js tests/harness/verify-personal-account-scope.js
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
    const PW = 'pers-scope-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'ps@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.116.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'ps@finflow.test', password: PW })).status === 200);
    const cr = await h.post(`/api/personal-accounts?entity_id=${eA}`, { kind: 'asset', name: 'Savings', type: 'bank', value: 1000 });
    const row = (await c.query(`SELECT entity_id FROM personal_accounts WHERE user_id=$1 AND data->>'name'='Savings'`, [uid])).rows[0];
    A('added while viewing A → stored entity-less (bug: tagged with A)', cr.status === 201 && row && row.entity_id == null, `status ${cr.status} entity ${row && row.entity_id}`);
    const listB = (await h.get(`/api/personal-accounts?entity_id=${eB}`)).json || [];
    A('listed on the personal page while viewing B (bug: hidden)', listB.some(a => a.name === 'Savings'), JSON.stringify(listB.map(a => a.name)));
    const nw = await h.post(`/api/snapshots/capture?entity_id=${eB}`, { kind: 'networth' });
    A('net worth while viewing B includes it: 1000 (bug: 0)', nw.json && Number(nw.json.value) === 1000, 'value ' + (nw.json && nw.json.value));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (personal account scope)` : `  ALL GREEN — ${pass} passed, 0 failed  (personal account scope)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
