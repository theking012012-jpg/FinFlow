'use strict';
/**
 * verify-register-server-today.js — L30 (prior audit F116 residue). F116 primed `window._serverToday` (the
 * server-resolved calendar today every date default reads — F115) on the session-restore path and on login, but
 * NOT on registration: POST /api/auth/register returned no `today` and doRegister never set it. A brand-new account
 * therefore started its first session with `_serverToday` unset — the Record Payment modal's Save stays disabled
 * ("Still loading today's date") until the user reloads.
 *
 * Executed: the real register route over HTTP, and the real doRegister() in the booted SPA (jsdom).
 * Pinned clock 2026-07-25T16:00Z ⇒ resolved today 2026-07-25.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-register-server-today.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L30 — registration primes the server-resolved today\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({});
    const { window: w, settle, origin } = ctx;
    await settle(30, 100);
    const h = new HarnessHttp(origin, { xff: '203.0.113.130' });
    const r = await h.post('/api/auth/register', { name: 'New Owner', email: 'l30-direct@finflow.test', password: 'Harness-pw-L30-ok!' });
    A('POST /api/auth/register returns today = 2026-07-25 (bug: no today)', r.status === 201 && r.json && r.json.today === '2026-07-25', 'status=' + r.status + ' ' + String(r.text).slice(0, 160));

    w._serverToday = undefined;
    const set = (id, v) => { const el = w.document.getElementById(id); if (el) el.value = v; };
    set('reg-name', 'Second Owner'); set('reg-email', 'l30-ui@finflow.test'); set('reg-pw', 'Harness-pw-L30-ui!');
    await w.doRegister(); await settle(10, 100);
    const err = (w.document.getElementById('register-error') || {}).textContent;
    A('doRegister() succeeded (premise)', !err, 'register-error=' + err);
    A('after doRegister(): window._serverToday = 2026-07-25 (bug: undefined until reload)', w._serverToday === '2026-07-25', '_serverToday=' + w._serverToday);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { if (ctx) await ctx.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (register server today)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
