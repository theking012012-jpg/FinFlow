'use strict';
/**
 * verify-forgot-password-ui.js — the LIVE login (finflow-api.js showAuthGate) is what unauthenticated
 * users see; the static index.html login-screen is dead-shadowed by it. This proves the added
 * "Forgot password?" affordance is present in the RUNTIME-WINNER login and actually POSTs the reset.
 * Pure jsdom + stubbed fetch (no server needed).
 *
 *   node tests/harness/verify-forgot-password-ui.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/app' });
  const { window } = dom;
  const calls = [];
  window.fetch = (path, opts) => {
    calls.push({ path: String(path), opts: opts || {} });
    if (String(path).includes('/api/auth/me')) return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'unauth' }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  };
  try {
    window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'finflow-api.js'), 'utf8'));
    await new Promise(r => setTimeout(r, 60)); // let boot() → me() reject → showAuthGate()

    const gate = window.document.getElementById('ff-auth-gate');
    A('unauthenticated boot renders the auth gate (runtime-winner login)', !!gate);
    A('login shows a "Forgot password?" link', !!gate && /Forgot password\?/.test(gate.innerHTML), 'link missing from ff-auth-gate');
    A('forgot panel #ff-fp exists', !!window.document.getElementById('ff-fp'));
    A('window.ffForgot is a function', typeof window.ffForgot === 'function');

    window.ffTab('forgot');
    const fp = window.document.getElementById('ff-fp');
    A('ffTab("forgot") reveals the forgot panel', fp && fp.style.display !== 'none', 'display=' + (fp && fp.style.display));
    A('login form hidden while on forgot view', window.document.getElementById('ff-li').style.display === 'none');

    window.document.getElementById('ff-fe').value = 'reset-me@finflow.test';
    const before = calls.length;
    await window.ffForgot();
    await new Promise(r => setTimeout(r, 20));
    const c = calls.slice(before).find(x => x.path.includes('/api/auth/forgot-password'));
    A('ffForgot POSTs /api/auth/forgot-password', !!c, 'calls=' + JSON.stringify(calls.slice(before).map(x => x.path)));
    A('...method is POST', !!c && c.opts.method === 'POST');
    A('...body carries the entered email', !!c && /reset-me@finflow\.test/.test(c.opts.body || ''), 'body=' + (c && c.opts.body));
    A('success confirmation shown after send', /reset link is on its way/i.test(window.document.getElementById('ff-fp').innerHTML));

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : fail + ' FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed  (forgot-password UI on the live login)\n');
  } catch (e) {
    console.error('  PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail++;
  }
  process.exit(fail === 0 ? 0 : 1);
})();
