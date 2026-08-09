'use strict';
/* F144 (Sales Receipts slice): after deleting final5.js's dead Sales-Receipts subsystem, the pages.js
 * runtime winners must still serve the live page, window.receipts (revenue path, app-main.js:1952 /
 * dashboard.js:72) must still be populated by pages.js, and the winner-less openEditReceiptModal must
 * be cleanly gone (no live caller). */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle, consoleErrors } = boot;
    await settle(20, 25);
    for (const fn of ['renderReceipts', 'openNewReceiptModal', 'saveReceipt', 'deleteReceipt', '_loadReceiptsFromDB']) {
      A(`window.${fn} defined (pages.js winner survives)`, typeof window[fn] === 'function');
    }
    A('window.receipts populated by pages.js (revenue path intact)', Array.isArray(window.receipts));
    A('openEditReceiptModal removed (dead edit affordance, no live caller)', typeof window.openEditReceiptModal === 'undefined');
    A('shared _sv/_st helpers + AI section still work (no boot SyntaxError)', !consoleErrors.some(l => /SyntaxError|Unexpected (token|identifier)/i.test(l)),
      consoleErrors.filter(l => /Syntax|Unexpected/i.test(l)).slice(0, 2).join(' | '));
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
