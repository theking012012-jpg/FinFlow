'use strict';
/**
 * verify-c6-hdrain-logging.js — EXECUTE the failure path (Rule 14) of the client C6 fix in the
 * _hdrain deferred boot-hook loop (app-main.js). Force one of the deferred render hooks to throw and
 * assert the fix LOGS it ('[boot] a deferred render hook threw ...'). The pre-fix empty catch
 * swallowed it silently, so the presence of this specific log is the discriminator.
 *
 * _hdrain calls each hook by NAME during a deferred drain (one per macrotask). Scripts load async and
 * wiring reassigns these functions, so a single override can be clobbered; we re-install the throwing
 * renderReports on a tight interval across the whole drain window — deterministic regardless of timing.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c6-hdrain-logging.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle, consoleErrors } = boot;

    // (M2) Install renderReports as a non-configurable GETTER that always returns a throwing hook
    // and IGNORES wiring's own re-assignment. _hdrain reads `renderReports` (the global) when it
    // reaches that deferred hook, so whenever the drain gets there it sees the throwing copy —
    // deterministic regardless of sweep-load timing (the old re-install-every-2ms approach raced the
    // drain and flaked). Belt-and-suspenders interval kept for engines that ignore the getter.
    const throwing = function () { throw new Error('injected boot-hook failure'); };
    try {
      Object.defineProperty(window, 'renderReports', { configurable: true, get() { return throwing; }, set() {} });
    } catch (_) {}
    const iv = setInterval(() => { try { window.renderReports = throwing; } catch (_) {} }, 2);
    await settle(160, 25);   // ~4s of drain time while we hold the throwing hook in place
    clearInterval(iv);

    const hit = consoleErrors.some(l => /deferred render hook threw/.test(l));
    A('FAILURE PATH: a throwing deferred render hook is LOGGED by _hdrain (not swallowed silently)', hit,
      'boot/render console.errors seen: ' + JSON.stringify(consoleErrors.filter(l => /boot|render|hook/i.test(l)).slice(0, 5)));
    A('boot survived the throw (window still live — _hdrain continued)', !!window.document.getElementById('month-nav-label'));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
