'use strict';
/* F136: after deleting the dead Payments-Made subsystem from final5.js, the pages.js runtime
 * winners must still serve the live page, and the winner-less dead edit affordance must be cleanly
 * gone (no live caller). Boots the real SPA and checks the live window functions. */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle, consoleErrors } = boot;
    await settle(20, 25);
    // pages.js runtime winners that must survive (live page: render/add/delete + the money loader)
    for (const fn of ['renderPaymentsMade', 'openMakePaymentModal', 'savePaymentMade', 'deletePaymentMade', '_loadPaymentsMadeFromDB']) {
      A(`window.${fn} defined (pages.js winner survives)`, typeof window[fn] === 'function');
    }
    // window.paymentsMade feeds the dashboard money (app-main.js:1758) — must still be an array (pages.js sets it)
    A('window.paymentsMade populated by pages.js (money path intact)', Array.isArray(window.paymentsMade));
    A('openEditPaymentMadeModal removed (dead edit affordance, no live caller)', typeof window.openEditPaymentMadeModal === 'undefined');
    A('no SyntaxError / Unexpected during boot', !consoleErrors.some(l => /SyntaxError|Unexpected (token|identifier)/i.test(l)),
      consoleErrors.filter(l => /Syntax|Unexpected/i.test(l)).slice(0, 2).join(' | '));
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
