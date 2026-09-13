#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-mfa.js — accountant TOTP MFA, end-to-end against real Postgres + the real
 * login route. Proves enrollment, the login gate, and disable, RED-proving every deny path.
 *
 *   enroll: setup → enable(wrong)=400 → enable(correct)=200 → status enabled
 *   login (enabled): no token=401{mfaRequired} · wrong token=401 · correct token=200 (session)
 *   login (NOT enabled): no token=200 (unchanged)
 *   disable: wrong token=400 → correct token=200 → login now works with no token
 *   at-rest: mfa_secret is stored ENCRYPTED (not the base32 plaintext)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-mfa.js
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

async function mkAcc(c, email) {
  return (await c.query(
    `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
     VALUES ($1,$2,'A','B','F',$3,'verified') RETURNING id`,
    [email, bcrypt.hashSync(PW, 10), 'RC' + Math.random().toString(36).slice(2, 8)]
  )).rows[0].id;
}
const login = (base, email, token) => new HarnessHttp(base).post('/api/accountants/login', token === undefined ? { email, password: PW } : { email, password: PW, token });

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const accId = await mkAcc(c, 'mfa@finflow.test');
    await mkAcc(c, 'nomfa@finflow.test');

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT MFA (TOTP) — enroll, login gate, disable (real PG, real login route)');
    console.log('='.repeat(78) + '\n');

    // Authenticated session to enroll
    const acc = new HarnessHttp(server.baseUrl);
    A('login before MFA (no token) → 200', (await acc.post('/api/accountants/login', { email: 'mfa@finflow.test', password: PW })).status === 200);
    A('mfa/status → disabled', (await acc.get('/api/accountants/mfa/status')).json.mfa_enabled === false);

    // Setup
    const setup = await acc.post('/api/accountants/mfa/setup', {});
    const secret = setup.json && setup.json.secret;
    A('mfa/setup → 200 with base32 secret + otpauth', setup.status === 200 && /^[A-Z2-7]{16,}$/.test(secret || '') && /^otpauth:\/\/totp\//.test(setup.json.otpauth || ''), JSON.stringify(setup.json));
    A('setup does NOT flip mfa_enabled yet', (await acc.get('/api/accountants/mfa/status')).json.mfa_enabled === false);

    // Enable — wrong then correct
    A('mfa/enable wrong code → 400 (RED)', (await acc.post('/api/accountants/mfa/enable', { token: '000000' })).status === 400);
    A('mfa/enable correct code → 200', (await acc.post('/api/accountants/mfa/enable', { token: totp.generate(secret) })).status === 200);
    A('mfa/status → enabled', (await acc.get('/api/accountants/mfa/status')).json.mfa_enabled === true);

    // At-rest: stored secret must be encrypted, not the plaintext base32
    const stored = (await c.query('SELECT mfa_secret, mfa_pending_secret FROM accountants WHERE id = $1', [accId])).rows[0];
    A('mfa_secret stored ENCRYPTED (not plaintext base32)', !!stored.mfa_secret && stored.mfa_secret !== secret && stored.mfa_secret.includes(':'), stored.mfa_secret);
    A('mfa_pending_secret cleared after enable', stored.mfa_pending_secret == null);

    // Login gate
    console.log('\n-- login gate (MFA enabled) --');
    A('login no token → 401 {mfaRequired}', (r => r.status === 401 && r.json && r.json.mfaRequired === true)(await login(server.baseUrl, 'mfa@finflow.test')));
    A('login wrong token → 401 (RED)', (await login(server.baseUrl, 'mfa@finflow.test', '000000')).status === 401);
    A('login correct token → 200 (session)', (await login(server.baseUrl, 'mfa@finflow.test', totp.generate(secret))).status === 200);

    // Non-MFA accountant unaffected
    A('non-MFA accountant logs in with no token → 200', (await login(server.baseUrl, 'nomfa@finflow.test')).status === 200);

    // Disable
    console.log('\n-- disable --');
    A('mfa/disable wrong code → 400 (RED)', (await acc.post('/api/accountants/mfa/disable', { token: '000000' })).status === 400);
    A('mfa/disable correct code → 200', (await acc.post('/api/accountants/mfa/disable', { token: totp.generate(secret) })).status === 200);
    A('after disable: login with no token → 200', (await login(server.baseUrl, 'mfa@finflow.test')).status === 200);
    const cleared = (await c.query('SELECT mfa_enabled, mfa_secret FROM accountants WHERE id = $1', [accId])).rows[0];
    A('after disable: mfa_enabled false + secret cleared', cleared.mfa_enabled === false && cleared.mfa_secret == null);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (accountant MFA / TOTP)' : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('\n[acc-mfa] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
