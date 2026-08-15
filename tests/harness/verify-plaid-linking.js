#!/usr/bin/env node
'use strict';
/**
 * verify-plaid-linking.js — the REAL bank-linking surface (Plaid), env-gated. Runs with NO Plaid
 * keys set (the sandbox default), so it verifies exactly what can be verified without a Plaid
 * account:
 *   - the env gate: link-token / exchange / sync return a clean 502 (PLAID_NOT_CONFIGURED),
 *     NEVER a fake "linked" state (F51/F65 honesty rule)
 *   - RBAC: bank:manage is owner-only — a viewer/admin/accountant member is 403 on every write
 *     (owner passes the gate and only then hits the 502 env wall — proving it's RBAC, not the gate)
 *   - GET /api/plaid/items shape: {configured:false, items:[]}; unauth → 401
 *   - unlink validation without keys (local op): 400 (no item_id) / 404 (unknown item)
 *   - access-token encryption at rest (AES-256-GCM): round-trips, ciphertext != plaintext,
 *     and a tampered token FAILS the GCM auth tag (so a corrupted/forged token cannot decrypt)
 *
 * The live Plaid handshake (link-token→exchange→sync with real keys) is NOT exercised here — it
 * requires a Plaid account. That path ships UNEXECUTED until PLAID_CLIENT_ID/PLAID_SECRET are set
 * and a sandbox link is run (Rule 14 — labelled, not silently claimed).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-plaid-linking.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  // Ensure the env gate is genuinely OFF for this run.
  delete process.env.PLAID_CLIENT_ID; delete process.env.PLAID_SECRET;
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const app = require('../../server.js');

    const mkUser = async (email, name) => (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email, name, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;

    const ownerId = await mkUser('plaid-owner@finflow.test', 'Owner');
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [ownerId, { name: 'Plaid Co', currency: 'USD', is_active: 1 }]);
    // A viewer member of the owner's account (should be blocked by bank:manage owner-only).
    const viewerId = await mkUser('plaid-viewer@finflow.test', 'Viewer');
    await c.query(`INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [ownerId, { member_user_id: String(viewerId), status: 'active', role: 'viewer', name: 'Viewer', email: 'plaid-viewer@finflow.test' }]);

    console.log('\n' + '='.repeat(78));
    console.log('  PLAID BANK LINKING — env gate + RBAC + token-at-rest (no keys set)');
    console.log('='.repeat(78));

    // ── env-gate configured() ──
    A('plaidConfigured() is false with no keys', app.plaidConfigured() === false);

    // ── unauth ──
    const anon = new HarnessHttp(server.baseUrl);
    A('unauth GET /api/plaid/items → 401', (await anon.get('/api/plaid/items')).status === 401);
    A('unauth POST /api/plaid/link-token → 401', (await anon.post('/api/plaid/link-token', {})).status === 401);

    // ── owner: passes RBAC, hits the env gate (502), never a fake link ──
    const owner = new HarnessHttp(server.baseUrl);
    A('owner login', (await owner.post('/api/auth/login', { email: 'plaid-owner@finflow.test', password: PW })).status === 200);
    const items0 = await owner.get('/api/plaid/items');
    A('owner GET items → 200', items0.status === 200, `status ${items0.status}`);
    A('  items shape = {configured:false, items:[]}', items0.json && items0.json.configured === false && Array.isArray(items0.json.items) && items0.json.items.length === 0, JSON.stringify(items0.json));
    const lt = await owner.post('/api/plaid/link-token', {});
    A('owner link-token → 502 PLAID_NOT_CONFIGURED (owner PASSED rbac)', lt.status === 502 && lt.json && lt.json.code === 'PLAID_NOT_CONFIGURED', `status ${lt.status}: ${lt.text.slice(0,120)}`);
    const ex = await owner.post('/api/plaid/exchange', { public_token: 'x' });
    A('owner exchange → 502 (env gate before work)', ex.status === 502, `status ${ex.status}`);
    const sy = await owner.post('/api/plaid/sync', {});
    A('owner sync → 502', sy.status === 502, `status ${sy.status}`);
    // unlink is a LOCAL op (no keys needed) → validates input
    A('owner unlink (no item_id) → 400', (await owner.post('/api/plaid/unlink', {})).status === 400);
    A('owner unlink (unknown item) → 404', (await owner.post('/api/plaid/unlink', { item_id: 'nope' })).status === 404);

    // ── viewer: bank:manage is owner-only → 403 on every write (NOT 502; RBAC fires first) ──
    const viewer = new HarnessHttp(server.baseUrl);
    A('viewer login', (await viewer.post('/api/auth/login', { email: 'plaid-viewer@finflow.test', password: PW })).status === 200);
    A('viewer GET items → 200 (read allowed)', (await viewer.get('/api/plaid/items')).status === 200);
    A('viewer link-token → 403 (bank:manage owner-only)', (await viewer.post('/api/plaid/link-token', {})).status === 403);
    A('viewer exchange → 403', (await viewer.post('/api/plaid/exchange', { public_token: 'x' })).status === 403);
    A('viewer sync → 403', (await viewer.post('/api/plaid/sync', {})).status === 403);
    A('viewer unlink → 403', (await viewer.post('/api/plaid/unlink', { item_id: 'x' })).status === 403);

    // ── token-at-rest encryption (AES-256-GCM) ──
    console.log('\n-- access-token encryption at rest --');
    const secret = 'access-sandbox-abc123-super-secret-token';
    const enc = app._encTok(secret);
    A('ciphertext != plaintext', enc !== secret && !enc.includes(secret));
    A('has iv:tag:data structure', enc.split(':').length === 3);
    A('decrypt round-trips to the original', app._decTok(enc) === secret, `got ${app._decTok(enc)}`);
    let tampered = false;
    try {
      const parts = enc.split(':');
      const data = Buffer.from(parts[2], 'hex'); data[0] ^= 0xff; // flip a byte
      app._decTok(parts[0] + ':' + parts[1] + ':' + data.toString('hex'));
    } catch (_) { tampered = true; }
    A('a tampered ciphertext FAILS the GCM auth tag (throws)', tampered);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (plaid linking — env-gated paths)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  NOTE: the LIVE Plaid handshake (with real keys) is UNEXECUTED here — needs a Plaid account.');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[plaid] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
