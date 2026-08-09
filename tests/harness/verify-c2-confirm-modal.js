'use strict';
/**
 * verify-c2-confirm-modal.js — EXECUTE (Rule 14) a converted C2 confirm path end to end. deleteInvoice
 * used to call native confirm(); it now must open the in-app _confirmModal overlay and honour the
 * choice. Asserts: (1) calling delete opens #_confirm-overlay (in-app modal, not a native dialog),
 * (2) Cancel removes it AND aborts the delete (invoice still present), (3) a second run + Confirm
 * removes the overlay and proceeds.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c2-confirm-modal.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle, consoleErrors } = boot;
    await settle(20, 25);
    const doc = window.document;

    A('window._confirmModal exists (the in-app dialog)', typeof window._confirmModal === 'function');
    A('window.deleteInvoice is callable', typeof window.deleteInvoice === 'function');

    // Seed one invoice so deleteInvoice(0) has something to act on.
    window.userInvoices = [{ client: 'TestCo', id: 999, _dbId: 999, amount: 100, status: 'pending' }];

    // ── CANCEL path: modal opens, Cancel aborts the delete ──
    const errBefore = consoleErrors.length;
    const p1 = window.deleteInvoice(0);          // runs sync up to `await _confirmModal(...)` → overlay created
    await new Promise(r => setTimeout(r, 30));
    const overlay1 = doc.getElementById('_confirm-overlay');
    A('delete opens the IN-APP modal (#_confirm-overlay), not a native dialog', !!overlay1);
    A('no native window.confirm/alert attempted', !consoleErrors.slice(errBefore).some(l => /not implemented.*(confirm|alert)/i.test(l)),
      consoleErrors.slice(errBefore).filter(l => /confirm|alert/i.test(l)).join(' | '));
    const cancelBtn = doc.getElementById('_confirm-no');
    A('modal has a Cancel button', !!cancelBtn);
    if (cancelBtn) cancelBtn.click();
    await p1;                                    // deleteInvoice sees false → returns
    A('Cancel removes the modal', !doc.getElementById('_confirm-overlay'));
    A('Cancel ABORTED the delete (invoice still present)', (window.userInvoices || []).some(i => i.id === 999));

    // ── CONFIRM path: modal opens, Confirm proceeds (overlay closes) ──
    const p2 = window.deleteInvoice(0);
    await new Promise(r => setTimeout(r, 30));
    A('second delete re-opens the modal', !!doc.getElementById('_confirm-overlay'));
    const okBtn = doc.getElementById('_confirm-yes');
    A('modal has a Confirm button', !!okBtn);
    if (okBtn) okBtn.click();
    await Promise.race([p2, new Promise(r => setTimeout(r, 800))]);
    A('Confirm removes the modal (delete proceeds past the guard)', !doc.getElementById('_confirm-overlay'));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
