'use strict';
/**
 * M4 — Receipt scanner "+ Add to expenses" must SAVE the receipt (was: fake success, nothing saved). S1.
 * FIXED: addScannedExpense POSTs /api/expenses. This harness now asserts the fix (it previously asserted the bug).
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
    await window.addScannedExpense();
    await settle(20, 60);

    A('the success toast names the receipt', !!toastMsg && /Expense added/i.test(toastMsg) && /Acme Receipts Ltd/.test(toastMsg), 'toast=' + toastMsg);
    const n1 = await countExpenses();
    A('[DISCRIMINATING] the scanned receipt is persisted: GET /api/expenses delta === 1 (bug: 0)', n1 === n0 + 1, 'n0=' + n0 + ' n1=' + n1);
    const listed = JSON.parse((await http.get('/api/expenses')).text || '[]');
    const saved = (Array.isArray(listed) ? listed : []).find(e => e.description === 'Acme Receipts Ltd');
    A('stored amount 123.45, date 2026-07-15, category Office, deductible yes',
      !!saved && Number(saved.amount) === 123.45 && saved.expense_date === '2026-07-15' && saved.category === 'Office' && saved.deductible === 'yes',
      JSON.stringify(saved));

    // Failure path (Rule 14): the save fails → error toast, no success toast, nothing stored.
    const scanAgain = async (data) => {
      Object.assign(SCAN, data);
      window.handleScannerFile(new window.File([new Uint8Array([137, 80, 78, 71])], 'r2.png', { type: 'image/png' }));
      await settle(20, 40);
    };
    const realFetch2 = window.fetch;
    window.fetch = function (url, opts) {
      if (String(url).indexOf('/api/expenses') !== -1 && opts && String(opts.method).toUpperCase() === 'POST') {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'injected failure' }) });
      }
      return realFetch2.apply(this, arguments);
    };
    await scanAgain({ vendor: 'Fail Shop', amount: '10.00' });
    toastMsg = null; let errSeen = null;
    window.notify = function (m, isErr) { toastMsg = String(m); if (isErr) errSeen = String(m); };
    await window.addScannedExpense();
    await settle(10, 40);
    A('[failure path] a failed save shows an error, never "Expense added"', !!errSeen && /Could not add/i.test(errSeen) && !/Expense added/i.test(toastMsg || ''), 'toast=' + toastMsg);
    A('[failure path] nothing stored', (await countExpenses()) === n0 + 1);
    window.fetch = realFetch2;

    // A receipt in a different currency is not booked as this business's currency.
    await scanAgain({ vendor: 'Euro Cafe', amount: '20.00', currency: 'EUR' });
    errSeen = null;
    await window.addScannedExpense();
    await settle(10, 40);
    A('a EUR receipt in a USD business is refused with an explanation', !!errSeen && /EUR/.test(errSeen), 'toast=' + toastMsg);
    A('nothing stored for the EUR receipt', (await countExpenses()) === n0 + 1);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (M4 scanner saves the receipt)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
