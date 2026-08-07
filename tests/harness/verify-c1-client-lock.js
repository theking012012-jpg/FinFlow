'use strict';
/**
 * verify-c1-client-lock.js — EXECUTE (Rule 14) the client-side in-flight lock that the C1 route
 * commits added but never drove with a test. Boots the REAL SPA in jsdom (bootSpaInJsdom), then for
 * each C1 save handler: populates the fields it reads, invokes it TWICE in the same tick (a double
 * click), and asserts EXACTLY ONE POST reached the network for that endpoint — i.e. the
 * `window._saving…` guard held. Without the lock the count is 2.
 *
 * This closes the "client lock UNEXECUTED" caveat. Coverage spans the three code locations the
 * handlers live in — bundled wiring (medium.js, pages.js), app-main.js, and index.html inline —
 * so the identical lock idiom is proven in every place it was written, not just asserted.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-client-lock.js
 *
 * The DB unique index remains the real guarantee (verify-c1-<route>.js); this proves the UX layer.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    boot = await bootSpaInJsdom({});
    const { window, wireLog, settle } = boot;
    const doc = window.document;
    const setVal = (id, v) => { const el = doc.getElementById(id); if (el) { el.value = v; } return !!el; };
    const postCount = (path) => wireLog.filter(w => w.method === 'POST' && w.path === path).length;

    await settle(4, 100);   // let the SPA finish booting / initial loads

    // Each case: prepare the DOM/state the handler reads, then double-invoke and count POSTs.
    // fn returns the endpoint path to count; if a required global/handler is missing we skip loudly.
    const cases = [
      { name: 'saveExpense (medium.js / bundle)  — POST /api/expenses', path: '/api/expenses',
        setup: () => { setVal('bexp-desc', 'Lock test expense'); setVal('bexp-amount', '123'); setVal('bexp-cat', 'Other'); setVal('bexp-ded', 'no'); },
        fn: () => window.saveExpense },
      { name: 'saveBill (pages.js / bundle)      — POST /api/bills', path: '/api/bills',
        setup: () => { setVal('bill-vendor', 'Lock Vendor'); setVal('bill-amount', '200'); const r = doc.getElementById('bill-recurring'); if (r) r.checked = false; },
        fn: () => window.saveBill },
      { name: 'saveReceipt (pages.js / bundle)   — POST /api/sales-receipts', path: '/api/sales-receipts',
        setup: () => { setVal('receipt-customer', 'Lock Cust'); setVal('receipt-amount', '150'); setVal('receipt-method', 'Card'); },
        fn: () => window.saveReceipt },
      { name: 'saveNewAccount (app-main.js)      — POST /api/chart-of-accounts', path: '/api/chart-of-accounts',
        setup: () => { if (typeof window.openNewAccountModal === 'function') window.openNewAccountModal(0); setVal('coa-code', '9100'); setVal('coa-name', 'Lock Acct'); setVal('coa-cat', 'Assets'); },
        fn: () => window.saveNewAccount },
      { name: 'submitStockOut (index.html inline) — POST /api/inventory-movements', path: '/api/inventory-movements',
        setup: () => {
          window.inventory = window.inventory && window.inventory.length ? window.inventory : [{ name: 'Lock Item', units: 500, max: 200, dbId: null }];
          if (typeof window.openStockOutModal === 'function') window.openStockOutModal(0);
          setVal('so-item-idx', '0'); setVal('so-qty', '3');
        },
        fn: () => window.submitStockOut },
    ];

    for (const t of cases) {
      const handler = t.fn();
      if (typeof handler !== 'function') { A(t.name + '  [handler present]', false, 'handler is not a function on window'); continue; }
      try { t.setup(); } catch (e) { A(t.name + '  [setup]', false, 'setup threw: ' + e.message); continue; }
      const before = postCount(t.path);
      // Double-click: two synchronous invocations, no await between (the real double-fire).
      const p1 = handler(); const p2 = handler();
      await Promise.allSettled([p1, p2]);
      await settle(3, 60);
      const delta = postCount(t.path) - before;
      A(t.name, delta === 1, `POSTs to ${t.path} = ${delta} (expected 1; the in-flight lock should have dropped the 2nd click)`);
    }

    // ── Rule-14 CONTROL: neutralize saveExpense's lock and confirm the double-click NOW double-posts.
    // Proves the pass above is real (the test detects a missing lock — delta would be 2, not 1).
    try {
      Object.defineProperty(window, '_savingExpense', { configurable: true, get: () => false, set: () => {} });
      setVal('bexp-desc', 'Lock CONTROL expense'); setVal('bexp-amount', '77'); setVal('bexp-cat', 'Other'); setVal('bexp-ded', 'no');
      const before = postCount('/api/expenses');
      const p1 = window.saveExpense(); const p2 = window.saveExpense();
      await Promise.allSettled([p1, p2]);
      await settle(3, 60);
      const delta = postCount('/api/expenses') - before;
      A('CONTROL: lock neutralized → double-click DOES double-post (test discriminates)', delta === 2,
        `POSTs = ${delta} (expected 2 with the guard forced off; if this is 1 the test cannot detect a missing lock)`);
    } catch (e) { A('CONTROL: lock-neutralized double-post', false, 'threw: ' + e.message); }

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (client in-flight lock, executed in jsdom)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
