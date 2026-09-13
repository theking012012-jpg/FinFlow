'use strict';
/**
 * verify-owner-mfa-login-ui.js — the LIVE owner login (finflow-api.js showAuthGate) must handle the
 * owner MFA gate: when /api/auth/login answers 401 {mfaRequired:true}, reveal the authenticator-code
 * field, keep the user on the gate (no reload), and RESEND the login WITH the token on the next submit.
 * A correct code → 200 → reload. Pure jsdom + stubbed fetch (no server).
 *
 *   node tests/harness/verify-owner-mfa-login-ui.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

  // jsdom's location.reload is read-only and emits a navigation jsdomError when called — count those.
  let reloads = 0;
  const vc = new VirtualConsole();
  vc.on('jsdomError', (err) => { if (/navigation|reload/i.test((err && err.message) || '')) reloads++; });

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/app', virtualConsole: vc });
  const { window } = dom;

  // Login stub: 401 {mfaRequired} until a token arrives; a "good" token → 200, anything else → 401.
  const GOOD = '123456';
  const calls = [];
  window.fetch = (p, opts) => {
    calls.push({ path: String(p), opts: opts || {} });
    if (String(p).includes('/api/auth/me')) return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'unauth' }) });
    if (String(p).includes('/api/auth/login')) {
      let body = {}; try { body = JSON.parse(opts.body || '{}'); } catch (_) {}
      if (!body.token) return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Enter your authenticator code to finish signing in.', mfaRequired: true }) });
      if (body.token === GOOD) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ user: { name: 'Owner' }, today: '2026-09-13' }) });
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Enter your authenticator code to finish signing in.', mfaRequired: true }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  };

  try {
    window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'finflow-api.js'), 'utf8'));
    await new Promise(r => setTimeout(r, 60)); // boot() → me() 401 → showAuthGate()

    A('unauthenticated boot shows the login gate', !!window.document.getElementById('ff-auth-gate'));
    const mg = window.document.getElementById('ff-mfa-group');
    A('MFA code field exists and is hidden initially', !!mg && mg.style.display === 'none', 'display=' + (mg && mg.style.display));

    // First submit: correct password, no code → server asks for MFA.
    window.document.getElementById('ff-le').value = 'owner@finflow.test';
    window.document.getElementById('ff-lp').value = 'right-password';
    await window.ffLogin();
    await new Promise(r => setTimeout(r, 20));
    A('password-only login did NOT reload (stays on gate)', reloads === 0, 'reloads=' + reloads);
    A('MFA field revealed after mfaRequired', mg.style.display !== 'none');
    A('a helpful prompt is shown', /authenticator/i.test(window.document.getElementById('ff-err').textContent), 'err=' + window.document.getElementById('ff-err').textContent);
    const firstLogin = calls.filter(c => c.path.includes('/api/auth/login'));
    A('first login POST carried NO token', firstLogin.length === 1 && !JSON.parse(firstLogin[0].opts.body).token);

    // Second submit: wrong code → still 401, no reload, field stays.
    window.document.getElementById('ff-lm').value = '000000';
    await window.ffLogin();
    await new Promise(r => setTimeout(r, 20));
    A('wrong code did NOT reload', reloads === 0, 'reloads=' + reloads);
    A('wrong code keeps the MFA field visible', mg.style.display !== 'none');
    A('wrong-code login POST carried the token', JSON.parse(calls.filter(c => c.path.includes('/api/auth/login'))[1].opts.body).token === '000000');

    // Third submit: correct code → 200 → reload.
    window.document.getElementById('ff-lm').value = GOOD;
    await window.ffLogin();
    await new Promise(r => setTimeout(r, 20));
    A('correct code reloads (session established)', reloads === 1, 'reloads=' + reloads);
    A('correct-code login POST carried the good token', JSON.parse(calls.filter(c => c.path.includes('/api/auth/login')).slice(-1)[0].opts.body).token === GOOD);

    // Switching tabs resets the MFA field.
    window.ffTab('register'); window.ffTab('login');
    A('ffTab reset hides the MFA field again', window.document.getElementById('ff-mfa-group').style.display === 'none');
    A('ffTab reset clears the code value', window.document.getElementById('ff-lm').value === '');

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : fail + ' FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed  (owner MFA login UI on the live login)\n');
  } catch (e) {
    console.error('  PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail++;
  }
  process.exit(fail === 0 ? 0 : 1);
})();
