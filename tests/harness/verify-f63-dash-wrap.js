'use strict';
/**
 * verify-f63-dash-wrap.js (Rule 14) — bootDashboardWiring runs on every entity load and used to
 * re-wrap window.updateDashboard each time, stacking wrapper layers without bound. The guard must
 * make the wrap happen EXACTLY ONCE.
 *
 * Discriminator: capture window.updateDashboard, call window._bootDashboardWiring() again, capture
 * again. WITH the guard the function identity is unchanged and carries _ffDashWrapped. PRE-fix each
 * boot installed a brand-new wrapper, so the identity changed on every call (unbounded stacking).
 *
 *   node -r ./tests/harness/clock.js -r /tmp/pg-shim.cjs tests/harness/verify-f63-dash-wrap.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '  ' + d : ''}`); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(40, 40);

    A('window.updateDashboard is a function after boot', typeof window.updateDashboard === 'function');
    A('it is marked _ffDashWrapped (guard installed the wrapper)', window.updateDashboard && window.updateDashboard._ffDashWrapped === true);

    const ref1 = window.updateDashboard;
    // Re-run the boot wiring the way an entity switch does (loadEntityData → _bootDashboardWiring).
    if (typeof window._bootDashboardWiring === 'function') {
      await window._bootDashboardWiring();
      await window._bootDashboardWiring();
      await settle(10, 10);
    } else { A('window._bootDashboardWiring exists', false); }
    const ref2 = window.updateDashboard;

    A('updateDashboard identity UNCHANGED after 2 more boots (no re-wrap / no stacking)', ref1 === ref2,
      `ref1===ref2 ? ${ref1 === ref2}`);
    A('still exactly one wrapper (flag intact)', ref2 && ref2._ffDashWrapped === true);

    // sanity: it still runs without throwing (renderers execute once)
    let threw = false;
    try { window.updateDashboard(); } catch (e) { threw = true; }
    A('updateDashboard() runs without throwing', !threw);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
