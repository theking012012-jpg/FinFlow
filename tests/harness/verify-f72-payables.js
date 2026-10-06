'use strict';
/**
 * verify-f72-payables.js — EXECUTE (Rule 14) that the LIVE client payables KPI reports a
 * partially-paid bill's REMAINING balance, not full face. Boots the real SPA in jsdom, seeds ONE
 * bill (amount 1000, amount_paid 400 → payable 600), drives the WINNING loader
 * (window._loadBillsFromDB = pages.js loadBills; it "overrides stubs.js — pages.js wins"), renders
 * the Vendors page (pages.js renderVendors → #page-vendors .mc-val[1]) and asserts 600. Pre-fix it
 * was 1000 (Σ amount over unpaid). Running the REAL winner is what settles the dead-shadow — stubs.js
 * updateBillMetrics/#bills-total is dead (its loader + render are shadowed by pages.js), so it is NOT
 * asserted here. Server AP (server.js:3779-3790) was already correct.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f72-payables.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };
  const num = (s) => parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')) || 0;

  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`DELETE FROM bills WHERE user_id=$1`, [uid]);
        // N24b: the payables card is now the canonical AP (balance sheet): recognised bills ISSUED on or before
        // today, less open vendor credits. So the seed is a real issued bill (it had no issue_date, which made its
        // date the wall-clock created_at — after the pinned today — i.e. not yet recognised) and the base seed's
        // vendor credit is removed, so the only thing measured is remaining-vs-face: 600, not 1000.
        await c.query(`DELETE FROM vendor_credits WHERE user_id=$1`, [uid]);
        await c.query(`INSERT INTO bills (user_id, entity_id, data) VALUES ($1, NULL, $2)`,
          [uid, { vendor: 'Acme', num: 'B-1', amount: 1000, amount_paid: 400, status: 'partial', issue_date: '2026-07-01', due_date: '2026-07-20' }]);
      },
    });
    const { window, settle } = boot;
    const doc = window.document;

    await settle(4, 100);

    // Drive the WINNING bills loader → populates _billsData (mirrored to window.bills).
    if (typeof window._loadBillsFromDB === 'function') { try { await window._loadBillsFromDB(); } catch (e) {} }
    await settle(3, 100);
    const billsLen = Array.isArray(window.bills) ? window.bills.length : -1;
    A('sanity: exactly ONE bill loaded (1000/400) into the live store', billsLen === 1,
      `window.bills.length = ${billsLen}`);

    // Render the Vendors page (the live payables surface). First call may fetch vendors & return.
    if (typeof window.renderVendors === 'function') { window.renderVendors(); await settle(3, 90); window.renderVendors(); }
    await settle(3, 90);
    const vEls = doc.querySelectorAll('#page-vendors .mc-val');
    const vPay = vEls && vEls[1] ? num(vEls[1].textContent) : NaN;
    A('LIVE Vendors payables KPI = 600 (remaining balance, not the 1000 face)', vPay === 600,
      `rendered "${vEls && vEls[1] ? vEls[1].textContent : '(no #page-vendors .mc-val[1])'}" → ${vPay}  (pre-fix this was 1000)`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F72 live payables, executed in jsdom)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
