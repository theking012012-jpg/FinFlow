'use strict';
/* F144 (PaymentsReceived / CreditNotes / VendorCredits slices): after deleting these dead final5.js
 * subsystems, each pages.js runtime winner must survive, the money var each loader set must still be
 * populated by pages.js, the winner-less openEdit* must be gone, and the live AI section must survive. */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle, consoleErrors } = boot;
    await settle(90, 50);   // pages.js boot-loads all 4 subsystems via async fetch; allow them to resolve
    const winners = ['renderPaymentsReceived', 'savePaymentReceived', 'renderCreditNotes', 'saveCreditNote', 'renderVendorCredits', 'saveVendorCredit'];
    for (const fn of winners) A(`window.${fn} defined (pages.js winner survives)`, typeof window[fn] === 'function');
    for (const v of ['paymentsReceived', 'creditNotes', 'vendorCredits']) A(`window.${v} populated by pages.js (money path intact)`, Array.isArray(window[v]));
    for (const oe of ['openEditPaymentReceivedModal', 'openEditCreditNoteModal', 'openEditVendorCreditModal']) A(`${oe} removed (dead affordance)`, typeof window[oe] === 'undefined');
    A('live AI section survives (renderAIPage + sendAIMessage)', typeof window.renderAIPage === 'function' && typeof window.sendAIMessage === 'function');
    A('no boot SyntaxError', !consoleErrors.some(l => /SyntaxError|Unexpected (token|identifier)/i.test(l)), consoleErrors.filter(l => /Syntax|Unexpected/i.test(l)).slice(0, 2).join(' | '));
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
