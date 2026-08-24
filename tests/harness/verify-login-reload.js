'use strict';
/**
 * verify-login-reload.js — the live login (finflow-api.js) must, on a SUCCESSFUL sign-in, reload the
 * page so the separate wiring boot (finflow-api-wiring-final.js) re-runs with the now-durable session
 * and paints the dashboard. Regression guard for the "sign in → blank screen until manual refresh" bug:
 * an in-page ffOnAuth transition left the wiring's data load (which 401'd while logged-out) un-re-run.
 *
 * Pure jsdom + stubbed fetch. We can't exercise a real navigation in jsdom, so we stub location.reload
 * and assert it fires on success and does NOT fire on a failed login.
 *
 *   node tests/harness/verify-login-reload.js
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

  // jsdom's location.reload is read-only and emits a "Not implemented: navigation" jsdomError when
  // called. We count those as reload attempts rather than stubbing the read-only property.
  let reloads = 0;
  const vc = new VirtualConsole();
  vc.on('jsdomError', (err) => { if (/navigation|reload/i.test((err && err.message) || '')) reloads++; });

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/app', virtualConsole: vc });
  const { window } = dom;

  let loginShouldSucceed = true;
  const calls = [];
  window.fetch = (path, opts) => {
    calls.push({ path: String(path), opts: opts || {} });
    if (String(path).includes('/api/auth/me')) return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'unauth' }) });
    if (String(path).includes('/api/auth/login')) {
      return loginShouldSucceed
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ user: { name: 'Tester' }, today: '2026-07-25' }) })
        : Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Invalid email or password.' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  };

  try {
    window.eval(fs.readFileSync('/srv/ffv/public/finflow-api.js', 'utf8'));
    await new Promise(r => setTimeout(r, 60)); // boot() → me() 401 → showAuthGate()

    A('unauthenticated boot shows the login gate', !!window.document.getElementById('ff-auth-gate'));

    // ── Failed login must NOT reload (user stays on the gate to see the error) ──
    loginShouldSucceed = false;
    window.document.getElementById('ff-le').value = 'user@finflow.test';
    window.document.getElementById('ff-lp').value = 'wrong';
    await window.ffLogin();
    await new Promise(r => setTimeout(r, 20));
    A('failed login does NOT reload', reloads === 0, 'reloads=' + reloads);
    A('failed login surfaces the error', /invalid/i.test(window.document.getElementById('ff-err').textContent), 'err=' + window.document.getElementById('ff-err').textContent);

    // ── Successful login MUST reload (so the wiring boot repaints with the live session) ──
    loginShouldSucceed = true;
    window.document.getElementById('ff-le').value = 'user@finflow.test';
    window.document.getElementById('ff-lp').value = 'right-password';
    await window.ffLogin();
    await new Promise(r => setTimeout(r, 20));
    A('successful login reloads exactly once', reloads === 1, 'reloads=' + reloads);
    A('login POSTed /api/auth/login', calls.some(c => c.path.includes('/api/auth/login') && c.opts.method === 'POST'));

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : fail + ' FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed  (login reloads → wiring boot paints the app)\n');
  } catch (e) {
    console.error('  PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail++;
  }
  process.exit(fail === 0 ? 0 : 1);
})();
