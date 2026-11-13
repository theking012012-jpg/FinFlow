#!/usr/bin/env node
'use strict';
/**
 * verify-lc3gb-named-admins — LC3g-b (owner decision 2026-11-01): named admin accounts, each with its own password and
 * REQUIRED 2FA; the log names who acted; an owner adds, disables, resets and changes role; the shared ADMIN_PASSWORD
 * works only until an owner account exists (ADMIN_BREAK_GLASS re-opens it). Real server, real Postgres, the real
 * /admin page in Chromium (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc3gb-named-admins.js
 *
 * Bug values (the shared-password-only code): an email sign-in is ignored and the password is compared to the env
 * value (401 for every named person); /api/admin/admins does not exist (404); after an owner exists the shared
 * password still signs in (200); admin_log has no admin_name column.
 * The test clock is frozen, so 2FA codes are made for the step before / now / after (the server's ±1 window).
 */
process.env.ADMIN_PASSWORD = 'harness-shared-admin-pw';
delete process.env.ADMIN_TOTP_SECRET; delete process.env.ADMIN_BREAK_GLASS;
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const totp = require('../../totp.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const code = (secret, steps) => totp.generate(secret, Date.now() + steps * 30000);
let ip = 10; const client = (base) => new HarnessHttp(base, { xff: '198.51.100.' + (ip++) });

(async () => {
  const s = await startScratchPostgres({ keep: false }); const c = s.client;
  let server, browser;
  try {
    server = await bootServer(s.url); const base = server.baseUrl;
    const st = r => r.status + ' ' + JSON.stringify(r.json || {}).slice(0, 160);
    const lastLog = async (action) => (await c.query(`SELECT * FROM admin_log WHERE action = $1 ORDER BY id DESC LIMIT 1`, [action])).rows[0] || {};
    // a named person's first sign-in → setup → signed in. Returns { http, secret }.
    const firstSignIn = async (email, temp, pw) => {
      const h = client(base);
      const l = await h.post('/api/admin/login', { email, password: temp });
      const secret = l.json && l.json.secret;
      const done = await h.post('/api/admin/setup', { newPassword: pw, token: secret ? code(secret, -1) : '000000' });
      return { h, secret, l, done };
    };

    // ── 1. before any owner account: the shared password works as today ──
    const shared = client(base);
    A('shared password signs in (no owner account yet)', (await shared.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
    const add = await shared.post('/api/admin/admins', { name: 'Dana Owner', email: 'Dana@FinFlow.test', role: 'owner' });
    A('an owner adds a named owner account and gets a one-time temporary password', add.status === 200 && /^[\w-]{16}$/.test((add.json || {}).tempPassword || ''), st(add));
    const cr = await lastLog('admin_account_create');
    A('the log names who added it, and never holds the temporary password',
      cr.admin_name === 'Shared admin password' && !JSON.stringify(cr).includes((add.json || {}).tempPassword || '§'), JSON.stringify(cr).slice(0, 220));

    // ── 2. Dana's first sign-in: her own password + 2FA, together ──
    const dH = client(base);
    const dl = await dH.post('/api/admin/login', { email: 'dana@finflow.test', password: add.json.tempPassword });
    A('first sign-in asks for setup (key + authenticator link), not a session', dl.status === 200 && dl.json.setupRequired && /^otpauth:\/\/totp\//.test(dl.json.otpauth || ''), st(dl));
    A('…and gives no admin access yet', (await dH.get('/api/admin/overview')).status === 401);
    const dSecret = dl.json.secret;
    A('setup refuses a short password', ((await dH.post('/api/admin/setup', { newPassword: 'short', token: code(dSecret, 0) })).json || {}).code === 'WEAK_PASSWORD');
    A('setup refuses keeping the temporary password', ((await dH.post('/api/admin/setup', { newPassword: add.json.tempPassword, token: code(dSecret, 0) })).json || {}).code === 'SAME_PASSWORD');
    A('setup refuses a wrong code', (await dH.post('/api/admin/setup', { newPassword: 'dana-strong-password-1', token: '000000' })).status === 401);
    const dDone = await dH.post('/api/admin/setup', { newPassword: 'dana-strong-password-1', token: code(dSecret, -1) });
    A('setup with her password + a good code signs her in', dDone.status === 200 && ((await dH.get('/api/admin/me')).json || {}).name === 'Dana Owner', st(dDone));
    A('the stored 2FA key is encrypted, not the plain key', !(await c.query(`SELECT totp_secret FROM admin_users WHERE lower(email)='dana@finflow.test'`)).rows[0].totp_secret.includes(dSecret));

    // ── 3. the shared password is now off ──
    const sharedNow = await shared.get('/api/admin/overview');
    A('the open shared-password session ends once an owner account exists', sharedNow.status === 401 && sharedNow.json.emailRequired, st(sharedNow));
    const sharedAgain = await client(base).post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    A('…and the shared password no longer signs in (bug: 200)', sharedAgain.status === 401 && sharedAgain.json.emailRequired, st(sharedAgain));

    // ── 4. Dana signs in normally: password + a fresh code; a used code is refused ──
    const d2 = client(base);
    A('no code → asked for the code', ((await d2.post('/api/admin/login', { email: 'dana@finflow.test', password: 'dana-strong-password-1' })).json || {}).mfaRequired === true);
    const replay = await d2.post('/api/admin/login', { email: 'dana@finflow.test', password: 'dana-strong-password-1', token: code(dSecret, -1) });
    A('the code already used at setup is refused (replay)', replay.status === 401 && /already used/.test(replay.json.error), st(replay));
    A('a fresh code signs in', (await d2.post('/api/admin/login', { email: 'dana@finflow.test', password: 'dana-strong-password-1', token: code(dSecret, 0) })).status === 200);
    A('wrong password for a named account → 401', (await client(base).post('/api/admin/login', { email: 'dana@finflow.test', password: 'nope', token: code(dSecret, 1) })).status === 401);
    A('an unknown email → the same 401 message', ((await client(base).post('/api/admin/login', { email: 'ghost@finflow.test', password: 'nope' })).json || {}).error === 'Invalid email or password.');

    // ── 5. a plain admin: works, cannot manage admins, and the log names them ──
    const eAdd = await d2.post('/api/admin/admins', { name: 'Eli Admin', email: 'eli@finflow.test', role: 'admin' });
    A('duplicate email refused', (await d2.post('/api/admin/admins', { name: 'Eli 2', email: 'ELI@finflow.test' })).status === 409);
    const eli = await firstSignIn('eli@finflow.test', eAdd.json.tempPassword, 'eli-strong-password-1');
    A('Eli finishes setup', eli.done.status === 200, st(eli.done));
    A('an admin (not owner) cannot see or manage admin accounts (403 OWNER_ONLY)', ((await eli.h.get('/api/admin/admins')).json || {}).code === 'OWNER_ONLY');
    const uid = (await c.query(`INSERT INTO users (data, created_at, updated_at) VALUES ($1, NOW(), NOW()) RETURNING id`, [{ email: 'cust@x.test', plan: 'pro' }])).rows[0].id;
    A('an admin can do admin work (suspend a customer)', (await eli.h.post(`/api/admin/users/${uid}/suspend`, { suspend: true })).status === 200);
    const eliId = (await c.query(`SELECT id FROM admin_users WHERE email='eli@finflow.test'`)).rows[0].id;
    const sus = await lastLog('user_suspend');
    A('the admin log names Eli on that action', sus.admin_name === 'Eli Admin' && sus.admin_id === eliId, JSON.stringify({ n: sus.admin_name, id: sus.admin_id }));
    const ct = (await c.query(`SELECT actor_type, actor_id FROM audit_trail WHERE user_id = $1 AND actor_type = 'admin' ORDER BY id DESC LIMIT 1`, [uid])).rows[0] || {};
    A('the customer\'s own trail records which admin', ct.actor_id === eliId, JSON.stringify(ct));

    // ── 6. disable ends live sessions; self / last-owner guards ──
    A('Dana disables Eli', (await d2.post(`/api/admin/admins/${eliId}/disable`)).status === 200);
    A('Eli\'s open session ends at once', (await eli.h.get('/api/admin/overview')).status === 401);
    A('Eli cannot sign in while disabled', /disabled/.test(((await client(base).post('/api/admin/login', { email: 'eli@finflow.test', password: 'eli-strong-password-1', token: code(eli.secret, 0) })).json || {}).error || ''));
    const danaId = (await c.query(`SELECT id FROM admin_users WHERE email='dana@finflow.test'`)).rows[0].id;
    A('Dana cannot disable herself', ((await d2.post(`/api/admin/admins/${danaId}/disable`)).json || {}).code === 'SELF');
    const rs = await d2.post(`/api/admin/admins/${eliId}/reset`);
    await d2.post(`/api/admin/admins/${eliId}/enable`);
    const eliAgain = await client(base).post('/api/admin/login', { email: 'eli@finflow.test', password: rs.json.tempPassword });
    A('after a reset Eli sets up again (new password + new 2FA)', eliAgain.json && eliAgain.json.setupRequired === true && eliAgain.json.secret !== eli.secret, st(eliAgain));
    process.env.ADMIN_BREAK_GLASS = 'true';
    const bg = client(base);
    const bgl = await bg.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    A('ADMIN_BREAK_GLASS re-opens the shared password, logged as break-glass', bgl.status === 200 && /BREAK-GLASS/.test((await lastLog('admin_login')).notes || ''), st(bgl));
    A('…and still cannot disable the last active owner (LAST_OWNER)', ((await bg.post(`/api/admin/admins/${danaId}/disable`)).json || {}).code === 'LAST_OWNER');
    A('…or demote them', ((await bg.post(`/api/admin/admins/${danaId}/role`, { role: 'admin' })).json || {}).code === 'LAST_OWNER');
    delete process.env.ADMIN_BREAK_GLASS;
    const fl = (await c.query(`SELECT notes FROM admin_log WHERE action='failed_login' ORDER BY id`)).rows.map(r => r.notes).join(' | ');
    A('failed named sign-ins are in the security log with the email', /Wrong email or password \(dana@finflow\.test\)/.test(fl) && /Reused 2FA code/.test(fl), fl.slice(0, 300));

    // ── 7. the page ──
    const gAdd = await d2.post('/api/admin/admins', { name: 'Gia Owner', email: 'gia@finflow.test', role: 'owner' });
    const { chromium } = (require('./browserKit.js').loadPlaywright() || (() => { throw new Error('NOT RUN — Playwright is not installed (local or global). Install once: npm i --no-save playwright && npx playwright install chromium'); })());
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(base + '/admin');
    await page.fill('#admin-email', 'gia@finflow.test'); await page.fill('#admin-pw', gAdd.json.tempPassword);
    await page.click('#admin-signin .login-btn');
    await page.waitForSelector('#admin-setup', { state: 'visible', timeout: 5000 }).catch(() => {});
    const key = (await page.textContent('#admin-setup-key').catch(() => '') || '').replace(/\s+/g, '');
    A('the page shows the setup step with the key', key.length >= 32, 'key "' + key + '"');
    await page.fill('#admin-new-pw', 'gia-strong-password-1'); await page.fill('#admin-setup-otp', key ? code(key, 0) : '000000');
    await page.click('#admin-setup .login-btn');
    await page.waitForSelector('#app.visible', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    A('after setup the panel opens with her name at the top', ((await page.textContent('#topbar-who').catch(() => '')) || '').trim() === 'Gia Owner');
    A('an owner sees "Admin accounts"', await page.isVisible('#nav-admins'));
    await page.click('#nav-admins'); await page.waitForTimeout(600);
    const names = await page.$$eval('#admins-tbody tr td.primary', tds => tds.map(t => t.innerText));
    A('the list shows every admin', ['Dana Owner', 'Eli Admin', 'Gia Owner'].every(n => names.includes(n)), JSON.stringify(names));
    await page.fill('#adm-new-name', 'Hal Admin'); await page.fill('#adm-new-email', 'hal@finflow.test');
    await page.click('#page-admins .filter-row .btn-sm'); await page.waitForTimeout(800);
    A('adding from the page shows the one-time temporary password', /Temporary password for Hal Admin/.test(await page.textContent('#admins-temp')));
    await page.click('[data-on-click="showPage(\'log\')"]'); await page.waitForTimeout(800);
    const logTxt = await page.textContent('#log-tbody');
    A('the activity log shows who did each action', /admin account create\s*Gia Owner/.test(logTxt.replace(/\s+/g, ' ')), logTxt.replace(/\s+/g, ' ').slice(0, 200));
    A('no page errors', errs.length === 0, errs.join(' | '));
  } finally { if (browser) await browser.close(); if (server && server.close) await server.close(); await s.stop(); }
  console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (LC3g-b)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR', e && e.stack); process.exit(1); });
