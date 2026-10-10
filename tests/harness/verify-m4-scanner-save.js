'use strict';
/**
 * M4 — Receipt scanner "+ Add to expenses" saves nothing (fake success). S1.
 *
 * Runtime winner (Rule 1): window.addScannedExpense = index.html:8463 (no wiring shadow — grep shows
 * the only reassignments are in _gen/ bundle + .fuse_hidden editor swap files, not real wiring source).
 * The function fires notify("Expense added: …"), guards an in-memory push behind `window.EXPENSES`
 * (nothing in real source ever defines window.EXPENSES), and NEVER calls POST /api/expenses.
 *
 * NOTE vs the frozen audit: the audit (run on e713ad1) said "there is no POST /api/expenses". On this
 * branch (d305f3f) the route DOES exist (server.js:2192) — but addScannedExpense does not call it, so
 * the defect stands. This harness proves that by execution.
 *
 * We drive the REAL scan path (window.handleScannerFile → scanFile), mocking ONLY the /api/ai/scan
 * vision RESPONSE (that is test input, not the money path — Rule 3 is about not stubbing the DB/money
 * computation; the persistence path under test stays real). Then we call the REAL addScannedExpense.
 *
 * DISCRIMINATING (Rule 4): a CORRECT implementation POSTs the scanned receipt, so GET /api/expenses
 * grows by exactly 1 (delta=1). The BUG persists nothing, so delta=0 while the success toast fires.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-m4-scanner-save.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({});
    const { window, http, settle } = boot;
    await settle(60, 60);

    const countExpenses = async () => {
      const r = await http.get('/api/expenses');
      let arr = []; try { arr = JSON.parse(r.text || '[]'); } catch (_) {}
      return Array.isArray(arr) ? arr.length : (arr && Array.isArray(arr.rows) ? arr.rows.length : 0);
    };
    const n0 = await countExpenses();
    A('baseline: GET /api/expenses returns a countable list', Number.isFinite(n0), 'n0=' + n0);

    // Spy the success toast (addScannedExpense calls bare notify(), which resolves to window.notify).
    let toastMsg = null;
    const origNotify = window.notify;
    window.notify = function (m, isErr) { toastMsg = String(m); try { return origNotify && origNotify.apply(this, arguments); } catch (_) {} };

    // Mock ONLY the AI vision response; delegate every other URL to the real server fetch.
    const SCAN = { vendor: 'Acme Receipts Ltd', amount: '123.45', currency: '$', category: 'Office', date: '2026-07-15', tax_deductible: true };
    const realFetch = window.fetch;
    window.fetch = function (url, opts) {
      const u = String(url || '');
      if (u.indexOf('/api/ai/scan') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SCAN), text: () => Promise.resolve(JSON.stringify(SCAN)) });
      }
      return realFetch.apply(this, arguments);
    };

    // jsdom env shims used by showPreview (not part of the money path).
    try { if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:mock'; } catch (_) {}
    try { if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {}; } catch (_) {}

    // Drive the REAL scan handler with a small image File → sets the real `scannedData` closure.
    const file = new window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'receipt.png', { type: 'image/png' });
    window.handleScannerFile(file);
    for (let i = 0; i < 80 && toastMsg === null; i++) await settle(2, 25);
    // (no toast yet — the scan toast path differs; what matters is scannedData is now set)

    // THE ACTION under test.
    toastMsg = null;
    window.addScannedExpense();
    await settle(20, 60);

    A('[setup] the scan populated scannedData (Add fired its success toast, so it did not early-return)',
      !!toastMsg && /Acme Receipts Ltd/.test(toastMsg), 'toast=' + toastMsg);
    A('[DISCRIMINATING] the success toast claims the expense was added (fake success)',
      !!toastMsg && /Expense added/i.test(toastMsg), 'toast=' + toastMsg);

    const n1 = await countExpenses();
    A('[DISCRIMINATING] nothing was persisted: GET /api/expenses delta === 0 (correct impl would be +1)',
      n1 === n0, 'n0=' + n0 + ' n1=' + n1 + ' (delta=' + (n1 - n0) + ')');
    A('[STRUCTURAL] window.EXPENSES is undefined — the in-memory push path is dead too',
      typeof window.EXPENSES === 'undefined', 'typeof=' + typeof window.EXPENSES);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (M4 scanner saves nothing)\n`);
    console.log(`  MEASURED: scan→Add left expenses at ${n1} (was ${n0}); toast="${toastMsg}"; window.EXPENSES=${typeof window.EXPENSES}`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
