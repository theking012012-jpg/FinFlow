#!/usr/bin/env node
'use strict';
/**
 * verify-entity-activate-ownership.js — N10. Switching the active entity only works for the account's
 * own entities, and a session can never act inside another account's entity.
 *
 * Defect: POST /api/entities/:id/activate deactivated ALL the caller's entities, then activated id WHERE
 * user_id = caller (0 rows for a foreign id), and stored the foreign id in session.entityId anyway. The
 * entity resolver trusted session.entityId, so subsequent writes were stamped with the OTHER tenant's
 * entity id and the caller's own books went "empty".
 *
 * Executed against the real server + Postgres; tenants U (entity EU) and V (entity EV). Bug value stated:
 *   U activates EV → 404                                    (bug: 200)
 *   U's EU still is_active=1                                (bug: 0 — every own entity deactivated)
 *   U then creates an expense → stamped entity EU            (bug: EV, the other tenant's entity)
 *   a session holding a foreign entity id (stale) → snaps back to U's own entity
 *   control: U activates its own second entity EU2 → 200, EU2 active, EU inactive
 *   node -r ./tests/harness/clock.js tests/harness/verify-entity-activate-ownership.js
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
    const PW = 'ent-act-pw-1';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const U = await mk('ea-u@finflow.test'), V = await mk('ea-v@finflow.test');
    const ent = async (u, name, active) => (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [u, { name, currency: 'USD', is_active: active }])).rows[0].id;
    const EU = await ent(U, 'U main', 1), EU2 = await ent(U, 'U second', 0), EV = await ent(V, 'V main', 1);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.10.0.1' });
    A('U login', (await h.post('/api/auth/login', { email: 'ea-u@finflow.test', password: PW })).status === 200);
    const active = async (id) => Number((await c.query(`SELECT (data->>'is_active')::int a FROM entities WHERE id=$1`, [id])).rows[0].a);
    const lastExpEntity = async () => (await c.query(`SELECT entity_id FROM expenses WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [U])).rows[0].entity_id;

    console.log('\n' + '='.repeat(78));
    console.log('  ENTITY ACTIVATE — own entities only');
    console.log('='.repeat(78));
    const r = await h.post(`/api/entities/${EV}/activate`, {});
    A('U activates V\'s entity → 404 (bug: 200)', r.status === 404, 'status ' + r.status);
    A('U\'s own entity still active (bug: deactivated)', (await active(EU)) === 1);
    A('V\'s entity untouched', (await active(EV)) === 1);
    await h.post('/api/expenses', { description: 'after foreign activate', amount: 5, expense_date: '2026-07-10' });
    A('U\'s next expense is stamped with U\'s entity (bug: V\'s entity id)', (await lastExpEntity()) === EU, 'entity_id=' + await lastExpEntity());

    // Stale/forged session value: write the foreign id straight into U's stored session.
    await c.query(`UPDATE session SET sess = jsonb_set(sess::jsonb, '{entityId}', to_jsonb($1::int))::json WHERE (sess::jsonb->>'userId')::int = $2`, [EV, U]);
    await h.post('/api/expenses', { description: 'stale session entity', amount: 6, expense_date: '2026-07-10' });
    A('a session holding a foreign entity id falls back to U\'s own entity (bug: writes into V\'s)', (await lastExpEntity()) === EU, 'entity_id=' + await lastExpEntity());

    const ok = await h.post(`/api/entities/${EU2}/activate`, {});
    A('control: U activates its own second entity → 200', ok.status === 200);
    A('control: EU2 active, EU inactive', (await active(EU2)) === 1 && (await active(EU)) === 0);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (entity activate ownership)` : `  ALL GREEN — ${pass} passed, 0 failed  (entity activate ownership)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
