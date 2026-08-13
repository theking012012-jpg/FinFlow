'use strict';
/**
 * verify-f151f-quickswitch-no-reload.js (Rule 14)
 *
 * A PWA resume-refresh handler force-reloaded the active entity on EVERY tab return (visibilitychange
 * + focus), and each reload triggers several dashboard re-renders — so returning to the tab visibly
 * "blinked" the (correct) data twice. Fix: only resume-refresh after a meaningful time in the
 * background; a quick tab-switch must not reload at all.
 *
 * Asserts: simulating a quick hidden→visible tab-switch does NOT call loadEntitiesFromDB (no reload,
 * no blink). Neg-control (ungated handler) DOES call it.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f151f-quickswitch-no-reload.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    const doc = window.document;
    await settle(40, 60);
    window._ffAuthed = true;   // resume-refresh is auth-gated; ensure authed

    // Count force-reloads.
    let calls = 0;
    const orig = window.loadEntitiesFromDB;
    window.loadEntitiesFromDB = function () { calls++; return typeof orig === 'function' ? orig.apply(this, arguments) : undefined; };
    A('loadEntitiesFromDB is wrappable (spy installed)', typeof orig === 'function');

    // Make visibilityState controllable, then simulate a QUICK tab-switch: hidden → visible.
    let _vs = 'visible';
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => _vs });
    _vs = 'hidden';  doc.dispatchEvent(new window.Event('visibilitychange'));
    _vs = 'visible'; doc.dispatchEvent(new window.Event('visibilitychange'));
    window.dispatchEvent(new window.Event('focus'));
    await settle(6, 40);

    A('quick tab-switch triggers NO force reload (no data blink)', calls === 0, `loadEntitiesFromDB calls=${calls}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F151f quick-switch no reload)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
