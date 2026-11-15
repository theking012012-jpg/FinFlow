'use strict';
/* C2 parse guard: after adding `await _confirmModal` to inline index.html handlers, confirm every
 * converted function is actually DEFINED at runtime (an await-in-non-async would SyntaxError the
 * whole <script> block, silently undefining these) and that boot logged no syntax errors. */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle, consoleErrors } = boot;
    await settle(20, 25);
    const FNS = ['revokeAccountant', 'reportAccountant', 'leaveReview', 'deletePayrollRun', 'voidPayrollRun', 'deleteAutocatRule', 'deleteInvoice', 'deleteCustomer', 'deleteHolding'];
    // N3-16 class (owner's sweep 2026-11-15, run 1 only: 9 passed, 1 failed): on a slow first run a script can finish
    // after the 0.5 s quiet window. Wait up to 20 s for them. A real parse break still fails: the function never appears.
    for (let i = 0; i < 200 && FNS.some(fn => typeof window[fn] !== 'function'); i++) await new Promise(r => setTimeout(r, 100));
    for (const fn of FNS) {
      A(`window.${fn} is defined (no parse break)`, typeof window[fn] === 'function', typeof window[fn]);
    }
    A('no SyntaxError / Unexpected token during boot', !consoleErrors.some(l => /SyntaxError|Unexpected (token|identifier|reserved)/i.test(l)),
      consoleErrors.filter(l => /Syntax|Unexpected/i.test(l)).slice(0, 3).join(' | '));
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
