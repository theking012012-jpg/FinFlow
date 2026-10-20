'use strict';
/**
 * verify-lc3d-security-log.js — LC3d (owner decision 2026-10-20: "industry standard, but better").
 *
 * Before: only LOGIN, LOGIN_FAILED and CHANGE_PASSWORD were recorded — and a failed sign-in on a REAL account was stored
 * with no account (user_id NULL), so the owner could never see attempts on their own account. Sign-up, sign-out, 2FA
 * set-up / on / off, a wrong 2FA code at sign-in, a sign-in to a suspended account, a reset request, a completed reset
 * and account deletion left no record; no row carried the browser; nothing alerted the owner.
 *
 * Standard (OWASP ASVS V7 / logging cheat sheet): every authentication and credential event, success AND failure, with
 * time, IP and device; never a secret (password, reset token, one-time code) in the log; append-only (audit_trail is).
 * Better: (1) failed attempts are recorded ON the account they targeted, so its owner sees them; (2) the owner gets a
 * "Recent security activity" list (event, when, IP, device); (3) an e-mail alert for the high-risk events — 2FA turned
 * off, password changed, password reset, a sign-in from a device never seen before — each alert itself recorded
 * (sent or why not).
 *
 * Real scratch Postgres, real server, real routes, real sessions with distinct IPs and browsers; Resend replaced by a
 * capturing fake at the module boundary (never the network). Each check names the event and the value that proves it.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc3d-security-log.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const totp = require('../../totp.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

const UA1 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const UA2 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const EMAIL = 'lc3d@finflow.test', PW1 = 'first-password-1', PW2 = 'second-password-2', PW3 = 'third-password-3';

(async () => {
  let scratch, server;
  console.log('\nLC3d — sign-in, 2FA and password events are on an attributed security log, with alerts\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    try { const { runMigrations, pool } = require('../../database.js'); await runMigrations(pool); } catch (_) {}
    const srv = require('../../server.js');
    const sent = [];
    const seam = typeof srv._setResendClientForTest === 'function';
    if (seam) srv._setResendClientForTest({ emails: { send: async m => { sent.push(m); return { id: 'fake_' + sent.length }; } } });
    eq('a test seam to capture outgoing e-mail exists', seam, true, false);

    const laptop = new HarnessHttp(server.baseUrl, { xff: '203.0.113.10', ua: UA1 });
    const phone  = new HarnessHttp(server.baseUrl, { xff: '198.51.100.20', ua: UA2 });
    const ev = async (uid, action) => (await c.query(`SELECT * FROM audit_trail WHERE user_id IS NOT DISTINCT FROM $1 AND action = $2 ORDER BY id DESC LIMIT 1`, [uid, action])).rows[0] || null;
    const where = r => r ? [r.ip_address || null, r.user_agent ? /Chrome/.test(r.user_agent) ? 'Chrome' : /iPhone/.test(r.user_agent) ? 'iPhone' : 'other' : null] : null;

    // ── sign-up / sign-out / sign-in ──
    eq('sign-up succeeds', (await laptop.post('/api/auth/register', { email: EMAIL, password: PW1, name: 'Sec Owner' })).status, 201);
    const uid = (await c.query(`SELECT id FROM users WHERE lower(data->>'email') = $1`, [EMAIL])).rows[0].id;
    eq('SIGNUP recorded with IP and browser', where(await ev(uid, 'SIGNUP')), ['203.0.113.10', 'Chrome'], null);
    await laptop.post('/api/auth/logout', {});
    eq('LOGOUT recorded', where(await ev(uid, 'LOGOUT')), ['203.0.113.10', 'Chrome'], null);
    eq('wrong password refused', (await laptop.post('/api/auth/login', { email: EMAIL, password: 'guess-1234' })).status, 401);
    let r = await ev(uid, 'LOGIN_FAILED');
    eq('…the failed attempt is recorded ON the account it targeted, with the reason', r ? [r.user_id, r.new_data && r.new_data.reason] : null, [uid, 'wrong_password'], null);
    eq('sign-in from the laptop', (await laptop.post('/api/auth/login', { email: EMAIL, password: PW1 })).status, 200);
    eq('LOGIN recorded with IP and browser', where(await ev(uid, 'LOGIN')), ['203.0.113.10', 'Chrome'], null);
    eq('no "new device" alert for the device the account signed up on', sent.filter(m => /new device/i.test(m.subject || '')).length, 0);

    // ── a sign-in from a device never seen before ──
    eq('sign-in from a phone', (await phone.post('/api/auth/login', { email: EMAIL, password: PW1 })).status, 200);
    const nd = sent.filter(m => /new device/i.test(m.subject || ''));
    eq('a new-device sign-in e-mails the owner (to their address, naming the device and IP)', nd.length === 1 ? [nd[0].to, /iPhone/.test(String(nd[0].html)), /198\.51\.100\.20/.test(String(nd[0].html))] : nd.length, [EMAIL, true, true], 0);
    r = await ev(uid, 'SECURITY_ALERT');
    eq('…and the alert itself is recorded (event, sent)', r ? [r.new_data && r.new_data.event, r.new_data && r.new_data.sent] : null, ['NEW_DEVICE_LOGIN', true], null);

    // ── 2FA ──
    const setup = await laptop.post('/api/auth/mfa/setup', {});
    eq('MFA_SETUP_STARTED recorded', !!(await ev(uid, 'MFA_SETUP_STARTED')), true, false);
    const secret = setup.json && setup.json.secret;
    eq('a wrong 2FA code at enrolment is refused', (await laptop.post('/api/auth/mfa/enable', { token: '000000' })).status, 400);
    r = await ev(uid, 'MFA_CODE_REJECTED');
    eq('…and recorded (where: enable)', r ? r.new_data && r.new_data.step : null, 'enable', null);
    eq('2FA turned on', (await laptop.post('/api/auth/mfa/enable', { token: totp.generate(secret) })).status, 200);
    eq('MFA_ENABLED recorded', where(await ev(uid, 'MFA_ENABLED')), ['203.0.113.10', 'Chrome'], null);
    const fresh = new HarnessHttp(server.baseUrl, { xff: '203.0.113.10', ua: UA1 });
    eq('password right, 2FA code wrong: refused', (await fresh.post('/api/auth/login', { email: EMAIL, password: PW1, token: '111111' })).status, 401);
    r = await ev(uid, 'LOGIN_FAILED');
    eq('…recorded on the account as a 2FA failure', r ? [r.user_id, r.new_data && r.new_data.reason] : null, [uid, 'mfa_code'], [uid, 'wrong_password']);
    const before = sent.length;
    eq('2FA turned off', (await laptop.post('/api/auth/mfa/disable', { token: totp.generate(secret) })).status, 200);
    eq('MFA_DISABLED recorded', !!(await ev(uid, 'MFA_DISABLED')), true, false);
    eq('turning 2FA off e-mails the owner', sent.slice(before).filter(m => /two-factor|2FA/i.test(m.subject || '')).length, 1, 0);

    // ── password change / reset ──
    let b2 = sent.length;
    eq('password changed', (await laptop.put('/api/auth/change-password', { currentPassword: PW1, newPassword: PW2 })).status, 200);
    eq('CHANGE_PASSWORD recorded with IP and browser', where(await ev(uid, 'CHANGE_PASSWORD')), ['203.0.113.10', 'Chrome'], null);
    eq('a password change e-mails the owner', sent.slice(b2).filter(m => /password/i.test(m.subject || '') && !/reset your/i.test(m.subject || '')).length, 1, 0);
    const anon = new HarnessHttp(server.baseUrl, { xff: '192.0.2.30', ua: UA2 });
    b2 = sent.length;
    await anon.post('/api/auth/forgot-password', { email: EMAIL });
    eq('PASSWORD_RESET_REQUESTED recorded on the account, from the requesting IP', (await ev(uid, 'PASSWORD_RESET_REQUESTED') || {}).ip_address || null, '192.0.2.30', null);
    const resetMail = sent.slice(b2).find(m => /reset your/i.test(m.subject || ''));
    const token = resetMail && (String(resetMail.html).match(/token=([a-f0-9]{64})/) || [])[1];
    eq('a reset link is sent (test reads the token from it)', !!token, true, false);
    eq('a made-up reset link is refused', (await anon.post('/api/auth/reset-password', { token: 'f'.repeat(64), password: PW3 })).status, 400);
    eq('…and recorded (no account — the token matched none)', !!(await ev(null, 'PASSWORD_RESET_FAILED')), true, false);
    b2 = sent.length;
    eq('password reset with the real link', (await anon.post('/api/auth/reset-password', { token, password: PW3 })).status, 200);
    eq('PASSWORD_RESET recorded on the account', (await ev(uid, 'PASSWORD_RESET') || {}).ip_address || null, '192.0.2.30', null);
    eq('a completed reset e-mails the owner', sent.slice(b2).filter(m => /password/i.test(m.subject || '')).length, 1, 0);

    // ── a suspended account ──
    await c.query(`UPDATE users SET data = data || '{"suspended":"true"}'::jsonb WHERE id = $1`, [uid]);
    eq('a suspended account cannot sign in', (await fresh.post('/api/auth/login', { email: EMAIL, password: PW3 })).status, 401);
    r = await ev(uid, 'LOGIN_FAILED');
    eq('…recorded on the account as blocked', r ? r.new_data && r.new_data.reason : null, 'blocked', 'mfa_code');
    await c.query(`UPDATE users SET data = data || '{"suspended":"false"}'::jsonb WHERE id = $1`, [uid]);

    // ── the owner's own view ──
    const me = new HarnessHttp(server.baseUrl, { xff: '203.0.113.10', ua: UA1 });
    await me.post('/api/auth/login', { email: EMAIL, password: PW3 });
    const act = await me.get('/api/auth/security-activity');
    const list = (act.json && act.json.events) || [];
    eq('Recent security activity: served to the owner', act.status, 200, 404);
    eq('…newest first, every kind of event above', [list.length >= 14, list[0] && list[0].action, ['SIGNUP', 'LOGOUT', 'LOGIN_FAILED', 'LOGIN', 'MFA_ENABLED', 'MFA_DISABLED', 'CHANGE_PASSWORD', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET', 'SECURITY_ALERT'].every(a => list.some(x => x.action === a))], [true, 'LOGIN', true], null);
    const ph = list.find(x => x.action === 'LOGIN' && x.ip === '198.51.100.20');
    eq('…each with when, IP and a readable device', ph ? [!!ph.at, ph.device] : null, [true, 'Safari on iPhone'], null);
    eq('…and only security events (no business records)', list.every(x => /^(SIGNUP|LOGIN|LOGIN_FAILED|LOGOUT|MFA_|CHANGE_PASSWORD|PASSWORD_|SECURITY_ALERT|ACCOUNT_DELETED)/.test(x.action)), true);
    const other = new HarnessHttp(server.baseUrl, { xff: '203.0.113.99', ua: UA1 });
    await other.post('/api/auth/register', { email: 'someone-else@finflow.test', password: 'other-password-9' });
    const oa = ((await other.get('/api/auth/security-activity')).json || {}).events || [];
    eq("another account sees only its own events", [oa.length > 0, oa.every(x => x.ip !== '198.51.100.20')], [true, true]);

    // ── never a secret ──
    const dump = JSON.stringify((await c.query(`SELECT old_data, new_data, old_value, new_value FROM audit_trail`)).rows);
    const leaked = [PW1, PW2, PW3, 'guess-1234', token, secret, '000000', '111111'].filter(x => x && dump.includes(x));
    eq('no password, reset token, 2FA secret or one-time code anywhere in the trail', leaked.map(x => x.slice(0, 4) + '…'), []);

    // ── account deletion ──
    eq('account deleted', (await me.request('DELETE', '/api/auth/account', { password: PW3 })).status, 200);
    eq('ACCOUNT_DELETED recorded, and outlives the account', !!(await ev(uid, 'ACCOUNT_DELETED')), true, false);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
