#!/usr/bin/env node
'use strict';
/**
 * verify-owner-mfa.js — owner-account TOTP MFA, end-to-end against real Postgres + the real
 * /api/auth/login route. Mirrors verify-accountant-mfa but for owner accounts (secret in
 * users.data JSONB). RED-proves every deny path.
 *
 *   enroll: setup → enable(wrong)=400 → enable(correct)=200 → status enabled
 *   login (enabled): no token=401{mfaRequired} · wrong token=401 · correct token=200 (session)
 *   login (NOT enabled): no token=200 (byte-identical to the old flow)
 *   disable: wrong token=400 → correct token=200 → login now works with no token
 *   at-rest: mfa_secret is stored ENCRYPTED (not the base32 plaintext)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-owner-mfa.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const totp = require('../../totp.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function mkUser(c, email) {
  const data = {
    email, password: bcrypt.hashSync(PW, 10), name: 'Owner', role: 'owner', plan: 'trial',
    trial_ends: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  return (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1) RETURNING id', [data])).rows[0].id;
}
const login = (base, email, token) => new HarnessHttp(base).post('/api/auth/login', token === undefined ? { email, password: PW } : { email, password: PW, token });

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = await mkUser(c, 'owner@finflow.test');
    await mkUser(c, 'noumfa@finflow.test');

    console.log('\n' + '='.repeat(78));
    console.log('  OWNER MFA (TOTP) — enroll, login gate, disable (real PG, real /api/auth/login)');
    console.log('='.repeat(78) + '\n');

    // Authenticated session to enroll
    const owner = new HarnessHttp(server.baseUrl);
    A('login before MFA (no token) → 200', (await owner.post('/api/auth/login', { email: 'owner@finflow.test', password: PW })).status === 200);
    A('mfa/status → disabled', (await owner.get('/api/auth/mfa/status')).json.mfa_enabled === false);

    // Setup
    const setup = await owner.post('/api/auth/mfa/setup', {});
    const secret = setup.json && setup.json.secret;
    A('mfa/setup → 200 with base32 secret + otpauth', setup.status === 200 && /^[A-Z2-7]{16,}$/.test(secret || '') && /^otpauth:\/\/totp\//.test(setup.json.otpauth || ''), JSON.stringify(setup.json));
    A('setup does NOT flip mfa_enabled yet', (await owner.get('/api/auth/mfa/status')).json.mfa_enabled === false);

    // Enable — wrong then correct
    A('mfa/enable wrong code → 400 (RED)', (await owner.post('/api/auth/mfa/enable', { token: '000000' })).status === 400);
    A('mfa/enable correct code → 200', (await owner.post('/api/auth/mfa/enable', { token: totp.generate(secret) })).status === 200);
    A('mfa/status → enabled', (await owner.get('/api/auth/mfa/status')).json.mfa_enabled === true);

    // At-rest: stored secret must be encrypted, not the plaintext base32
    const stored = (await c.query("SELECT data->>'mfa_secret' AS s, data->>'mfa_pending_secret' AS p FROM users WHERE id = $1", [uid])).rows[0];
    A('mfa_secret stored ENCRYPTED (not plaintext base32)', !!stored.s && stored.s !== secret && stored.s.includes(':'), stored.s);
    A('mfa_pending_secret cleared after enable', stored.p == null);

    // Login gate
    console.log('\n-- login gate (MFA enabled) --');
    A('login no token → 401 {mfaRequired}', (r => r.status === 401 && r.json && r.json.mfaRequired === true)(await login(server.baseUrl, 'owner@finflow.test')));
    A('login wrong token → 401 (RED)', (await login(server.baseUrl, 'owner@finflow.test', '000000')).status === 401);
    A('login correct token → 200 (session)', (await login(server.baseUrl, 'owner@finflow.test', totp.generate(secret))).status === 200);

    // Non-MFA owner unaffected (byte-identical old flow)
    A('non-MFA owner logs in with no token → 200', (await login(server.baseUrl, 'noumfa@finflow.test')).status === 200);

    // Disable — wrong then correct
    console.log('\n-- disable --');
    A('mfa/disable wrong code → 400 (RED)', (await owner.post('/api/auth/mfa/disable', { token: '000000' })).status === 400);
    A('mfa/disable correct code → 200', (await owner.post('/api/auth/mfa/disable', { token: totp.generate(secret) })).status === 200);
    A('mfa/status → disabled again', (await owner.get('/api/auth/mfa/status')).json.mfa_enabled === false);
    A('login now works with NO token → 200', (await login(server.baseUrl, 'owner@finflow.test')).status === 200);
    const after = (await c.query("SELECT data->>'mfa_secret' AS s FROM users WHERE id = $1", [uid])).rows[0];
    A('mfa_secret cleared after disable', after.s == null);

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? `  ${pass} passed, ${fail} FAILED` : `  ALL GREEN - ${pass} passed, 0 failed  (owner MFA / TOTP)`);
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
