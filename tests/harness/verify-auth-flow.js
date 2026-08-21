#!/usr/bin/env node
'use strict';
/**
 * verify-auth-flow.js — the authentication surface (Appendix A: previously UNVERIFIED). Register,
 * login, logout, session persistence, and the full password-reset flow, executed against the real
 * server + real Postgres session store.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-auth-flow.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const EMAIL = 'auth-user@finflow.test';
const PW = 'orig-password-123';
const NEWPW = 'brand-new-password-456';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    // authLimiter is max:10 per 15-min window and the pinned clock never advances that window, so
    // give every logical client its OWN X-Forwarded-For bucket (trust proxy:1) — otherwise the
    // harness's own volume trips the limiter and masks the auth logic.
    let _ip = 0;
    const H = () => new HarnessHttp(server.baseUrl, { xff: '10.9.' + ((++_ip >> 8) & 255) + '.' + (_ip & 255) });

    console.log('\n' + '='.repeat(78));
    console.log('  AUTH FLOW — register / login / logout / session / password reset');
    console.log('='.repeat(78));

    // ── 1 · register ──
    console.log('\n-- 1 - register --');
    const reg = H();
    const r = await reg.post('/api/auth/register', { email: EMAIL, password: PW, name: 'Auth User' });
    A('register → 201', r.status === 201, `status ${r.status}: ${r.text.slice(0,120)}`);
    A('a users row was created', (await c.query(`SELECT 1 FROM users WHERE lower(data->>'email')=lower($1)`, [EMAIL])).rowCount === 1);
    A('register set a session (me → 200 on same client)', (await reg.get('/api/auth/me')).status === 200);
    A('register rejects a duplicate email → 409', (await H().post('/api/auth/register', { email: EMAIL, password: PW, name: 'Dup' })).status === 409);
    A('register rejects a weak password → 400', (await H().post('/api/auth/register', { email: 'weak@finflow.test', password: 'short', name: 'W' })).status === 400);
    A('register rejects an invalid email → 400', (await H().post('/api/auth/register', { email: 'not-an-email', password: PW })).status === 400);

    // ── 2 · session persistence + auth guard ──
    console.log('\n-- 2 - session + guard --');
    A('anonymous /api/auth/me → 401', (await H().get('/api/auth/me')).status === 401);
    A('session persisted to Postgres (connect-pg-simple wrote a row)',
      Number((await c.query(`SELECT COUNT(*) n FROM session`)).rows[0].n) >= 1);

    // ── 3 · login (bad then good) ──
    console.log('\n-- 3 - login --');
    A('login wrong password → 401', (await H().post('/api/auth/login', { email: EMAIL, password: 'wrong' })).status === 401);
    A('login unknown email → 401', (await H().post('/api/auth/login', { email: 'nobody@finflow.test', password: PW })).status === 401);
    const li = H();
    A('login correct → 200', (await li.post('/api/auth/login', { email: EMAIL, password: PW })).status === 200);
    A('logged-in client /api/auth/me → 200', (await li.get('/api/auth/me')).status === 200);

    // ── 4 · logout ──
    console.log('\n-- 4 - logout --');
    A('logout → 200', (await li.post('/api/auth/logout', {})).status === 200);
    A('after logout, /api/auth/me → 401 (session destroyed)', (await li.get('/api/auth/me')).status === 401);

    // ── 5 · password reset (forgot → consume → single-use) ──
    console.log('\n-- 5 - password reset --');
    const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
    // Capture the RAW token the way a real user would — from the reset LINK the server logs when no
    // email provider is configured (server + harness share this process's stdout). The DB stores only
    // the hash (L2), so reading the row can no longer shortcut the token.
    const _log = console.log; let _cap = '';
    console.log = (...a) => { _cap += a.join(' ') + '\n'; _log(...a); };
    const fp = await H().post('/api/auth/forgot-password', { email: EMAIL });
    console.log = _log;
    A('forgot-password (real email) → 200 (no enumeration)', fp.status === 200);
    A('forgot-password (unknown email) → 200, no reset row created',
      (await H().post('/api/auth/forgot-password', { email: 'ghost@finflow.test' })).status === 200
      && (await c.query(`SELECT 1 FROM password_resets pr JOIN users u ON u.id=pr.user_id WHERE lower(u.data->>'email')='ghost@finflow.test'`)).rowCount === 0);
    const tok = (_cap.match(/token=([a-f0-9]+)/) || [])[1];
    A('a reset token was issued (captured from the reset link)', !!tok, `token=${tok}`);
    const storedTok = (await c.query(`SELECT pr.data->>'token' AS t FROM password_resets pr JOIN users u ON u.id=pr.user_id WHERE lower(u.data->>'email')=lower($1) ORDER BY pr.id DESC LIMIT 1`, [EMAIL])).rows[0]?.t;
    A('reset token stored HASHED, not raw (L2)', !!storedTok && storedTok !== tok && storedTok === sha(tok),
      `stored=${storedTok && storedTok.slice(0,12)}… raw=${tok && tok.slice(0,12)}…`);
    A('reset with a short password → 400', (await H().post('/api/auth/reset-password', { token: tok, password: 'short' })).status === 400);
    A('reset with the token → 200', (await H().post('/api/auth/reset-password', { token: tok, password: NEWPW })).status === 200);
    A('single-use: reusing the consumed token → 400', (await H().post('/api/auth/reset-password', { token: tok, password: NEWPW })).status === 400);
    A('OLD password no longer works → 401', (await H().post('/api/auth/login', { email: EMAIL, password: PW })).status === 401);
    A('NEW password works → 200', (await H().post('/api/auth/login', { email: EMAIL, password: NEWPW })).status === 200);

    // ── 6 · expired reset token rejected ──
    console.log('\n-- 6 - expired reset token --');
    const uid = (await c.query(`SELECT id FROM users WHERE lower(data->>'email')=lower($1)`, [EMAIL])).rows[0].id;
    // store the HASH of a known raw token (L2) and submit the RAW value, so we exercise the
    // EXPIRY branch (row found, past expiry) rather than merely "not found".
    await c.query(`INSERT INTO password_resets (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { token: sha('EXPIRED-TOKEN'), expires: new Date(Date.now() - 3600e3).toISOString() }]);
    A('expired token → 400', (await H().post('/api/auth/reset-password', { token: 'EXPIRED-TOKEN', password: NEWPW })).status === 400);
    A('garbage token → 400', (await H().post('/api/auth/reset-password', { token: 'no-such', password: NEWPW })).status === 400);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (auth flow)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[auth] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
