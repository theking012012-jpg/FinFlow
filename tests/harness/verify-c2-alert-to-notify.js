'use strict';
/**
 * verify-c2-alert-to-notify.js — EXECUTE (Rule 14) a converted C2 alert→notify path. saveReceipt()
 * with an empty customer used to fire a native alert; it now must fire the in-app toast
 * notify('Customer name required', true) instead. Asserts the toast text/error-state
 * rendered AND that no native window.alert was attempted (jsdom logs "Not implemented: window.alert"
 * when it is) — the discriminator vs the pre-fix native dialog.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c2-alert-to-notify.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle, consoleErrors } = boot;
    await settle(25, 25);
    const doc = window.document;

    A('window.notify is available at runtime (substitution target)', typeof window.notify === 'function');
    A('window.saveReceipt is callable (global via onclick)', typeof window.saveReceipt === 'function');
    const cust = doc.getElementById('receipt-customer');
    A('static #receipt-customer input exists', !!cust);
    if (cust) cust.value = '';                                   // force the "Customer is required" branch
    const nt = doc.getElementById('notif-text'); if (nt) nt.textContent = '';   // clear any residual toast

    const errBefore = consoleErrors.length;
    try { await window.saveReceipt(); } catch (e) { /* validation returns before any network */ }
    await settle(4, 25);

    const msg = (doc.getElementById('notif-text') || {}).textContent || '';
    A('C2: empty-customer save shows the toast "Customer name required" (notify, not alert)', msg === 'Customer name required', 'notif-text=' + JSON.stringify(msg));
    const notif = doc.getElementById('notif');
    A('toast rendered in error (red) state', !!notif && /(^|\s)error(\s|$)/.test(notif.className || ''), 'class=' + (notif && notif.className));
    const alertAttempted = consoleErrors.slice(errBefore).some(l => /not implemented.*alert/i.test(l));
    A('no native window.alert was attempted', !alertAttempted, consoleErrors.slice(errBefore).filter(l => /alert/i.test(l)).join(' | '));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
