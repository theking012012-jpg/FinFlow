'use strict';
/**
 * verify-f85-client-period-basis.js — EXECUTE (Rule 14) that the CLIENT recognises payroll in the
 * PERIOD THE RUN IS FOR, not run_date. Boots the real SPA in jsdom, sets one APPROVED run with
 * period '2026-06' but run_date '2026-07-02', and asserts the live computeExpenseBreakdown (the
 * runtime winner — no wiring override) places the 5000 in JUNE, not JULY.
 *
 * Expected WITH fix: June payroll = 5000, July payroll = 0.  Pre-fix: June 0, July 5000.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f85-client-period-basis.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(3, 100);

    if (typeof window.computeExpenseBreakdown !== 'function' || typeof window._periodWindow !== 'function') {
      A('client fns present (computeExpenseBreakdown, _periodWindow)', false); throw new Error('fns missing');
    }
    // Isolate: only the payroll run contributes.
    window._realExpenses = []; window.bills = []; window.paymentsMade = []; window.vendorCredits = [];
    window.payrollRuns = [{ period: '2026-06', run_date: '2026-07-02', status: 'approved',
      lines: [{ gross: 5000, bonus: 0, overtime: 0 }] }];

    // Find the fiscal-month indices whose window is June 2026 and July 2026 (labels 'Jun 2026'/'Jul 2026').
    let junIdx = null, julIdx = null;
    for (let i = 0; i < 14; i++) {
      let w; try { w = window._periodWindow('month', i); } catch (e) { continue; }
      if (w && /Jun 2026/.test(w.label)) junIdx = i;
      if (w && /Jul 2026/.test(w.label)) julIdx = i;
    }
    A('resolved June & July 2026 month windows', junIdx != null && julIdx != null, `junIdx=${junIdx} julIdx=${julIdx}`);

    const junPay = junIdx != null ? (window.computeExpenseBreakdown('month', junIdx).payroll || 0) : NaN;
    const julPay = julIdx != null ? (window.computeExpenseBreakdown('month', julIdx).payroll || 0) : NaN;

    A('client June payroll = 5000 (month the run is FOR) [pre-fix: 0]', Math.abs(junPay - 5000) < 0.005, `June payroll = ${junPay}`);
    A('client July payroll = 0 (NOT the creation month) [pre-fix: 5000]', Math.abs(julPay - 0) < 0.005, `July payroll = ${julPay}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F85 client, executed in jsdom)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
