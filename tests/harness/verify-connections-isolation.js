'use strict';
/**
 * verify-connections-isolation.js — per-scope connector independence.
 *
 * Every business entity AND personal (entity_id NULL) must hold its OWN provider connections,
 * fully independent: a scope with no connection of its own reads "not connected" — it NEVER
 * falls back to reading another scope's (previously the account-level NULL) blob. This covers the
 * OAuth driver (stripe_conn as the exemplar), Plaid linked items, and the /api/connections toggle
 * state — the three storage shapes.
 *
 * Discriminating (Rule 14): the assertions that a sibling scope returns connected:FALSE / 0 items /
 * empty toggles are exactly the ones that FAILED under the old read-fallback (they returned the
 * personal/legacy blob). Connecting one scope never surfaces on another; disconnecting one scope
 * leaves the others intact.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-connections-isolation.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'conn-iso@finflow.test', password: 'harness-password-not-a-secret' };
(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);   // builds the real schema in-process (same path the server uses)

    const ownerId = (await c.query(
      `INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Conn Iso', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const entA = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [ownerId, { name: 'Acme', currency: 'USD' }])).rows[0].id;
    const entB = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [ownerId, { name: 'Beta', currency: 'USD' }])).rows[0].id;

    // Seed a provider blob exactly as the real callback would (user_settings: data.key + data.value is a JSON string).
    const seedBlob = (eid, key, valObj) => c.query(
      `INSERT INTO user_settings (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3::jsonb,NOW(),NOW())`,
      [ownerId, eid, JSON.stringify({ key, value: JSON.stringify(valObj) })]
    );

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // Scope selector. Personal = the entity_id NULL blob, reached explicitly via ?entity_id=all
    // (the resolver maps 'all' → entityId null); a business = its numeric id. Omitting entity_id
    // would let the resolver auto-default to the first entity, so every call here is explicit.
    const PERSONAL = 'all';
    const q = (scope) => '?entity_id=' + scope;
    const stripeStatus = async (scope) => (await http.get('/api/stripe/status' + q(scope))).json || {};

    // ── OAuth driver (stripe_conn): personal connected, business scopes independent ──────
    await seedBlob(null, 'stripe_conn', { stripe_user_id: 'acct_personal' });
    let s = await stripeStatus(PERSONAL);
    A('personal (entity_id NULL) reads its OWN stripe connection', s.connected === true && s.account === 'acct_personal', JSON.stringify(s));
    s = await stripeStatus(entA);
    A('[DISCRIMINATING] business A with no connection → NOT connected (no fallback to personal)', s.connected === false && !s.account, JSON.stringify(s));

    await seedBlob(entA, 'stripe_conn', { stripe_user_id: 'acct_A' });
    s = await stripeStatus(entA);
    A('business A now reads its OWN connection (acct_A, not acct_personal)', s.connected === true && s.account === 'acct_A', JSON.stringify(s));
    s = await stripeStatus(entB);
    A('[DISCRIMINATING] business B still NOT connected (A\'s connect never leaked to B)', s.connected === false && !s.account, JSON.stringify(s));
    s = await stripeStatus(PERSONAL);
    A('personal unchanged after A connected (still acct_personal)', s.connected === true && s.account === 'acct_personal', JSON.stringify(s));

    // ── disconnect isolation ─────────────────────────────────────────────────────────
    A('disconnect business A → 200', (await http.post('/api/stripe/disconnect' + q(entA), {})).status === 200);
    A('A is now disconnected', (await stripeStatus(entA)).connected === false);
    A('[DISCRIMINATING] disconnecting A left personal connected (per-scope delete)', (await stripeStatus(PERSONAL)).connected === true);

    // ── Plaid linked items: per-scope ──────────────────────────────────────────────────
    await seedBlob(null, 'plaid_items', [{ item_id: 'itm_personal', institution_name: 'Personal Bank', linked_at: '2026-01-01' }]);
    const pPersonal = (await http.get('/api/plaid/items' + q(PERSONAL))).json || {};
    A('personal has its own linked bank', Array.isArray(pPersonal.items) && pPersonal.items.length === 1 && pPersonal.items[0].item_id === 'itm_personal', JSON.stringify(pPersonal.items));
    const pA = (await http.get('/api/plaid/items' + q(entA))).json || {};
    A('[DISCRIMINATING] business A has ZERO linked banks (no fallback to personal\'s bank)', Array.isArray(pA.items) && pA.items.length === 0, JSON.stringify(pA.items));

    // ── /api/connections toggle state: per-scope ────────────────────────────────────────
    A('save A toggles → 200', (await http.post('/api/connections' + q(entA), { stripe: true, quickbooks: true })).status === 200);
    const tgA = (await http.get('/api/connections' + q(entA)).then(r => r.json)) || {};
    A('business A reads back its OWN toggles', tgA.stripe === true && tgA.quickbooks === true, JSON.stringify(tgA));
    const tgPersonal = (await http.get('/api/connections' + q(PERSONAL)).then(r => r.json)) || {};
    A('[DISCRIMINATING] personal toggles are empty (A\'s toggles did not bleed to personal)', !tgPersonal.stripe && !tgPersonal.quickbooks, JSON.stringify(tgPersonal));
    const tgB = (await http.get('/api/connections' + q(entB)).then(r => r.json)) || {};
    A('[DISCRIMINATING] business B toggles are empty (independent of A)', !tgB.stripe && !tgB.quickbooks, JSON.stringify(tgB));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (connector isolation: OAuth + Plaid + toggles, per-scope)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
