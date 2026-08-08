'use strict';
/**
 * verify-f119-partial-remaining.js — EXECUTE (Rule 14) the partial-invoice case F119 left unexecuted:
 * a PARTIALLY-paid invoice loaded into window.userInvoices carries `amount_paid`, and Record Payment
 * shows remaining = amount − amount_paid (so the overpay guard cannot be defeated in the under-warn
 * direction). Boots the real SPA in jsdom against a seeded partial invoice (amount 1000, paid 400).
 *
 * Expected: userInvoices' object has amount_paid = 400; openRecordPaymentModal → #rp-remaining = 600.
 * Pre-F119 fear was amount_paid ABSENT → paid read as 0 → remaining 1000 → over-collection.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f119-partial-remaining.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  const num = s => parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')) || 0;

  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`DELETE FROM invoices WHERE user_id=$1`, [uid]);
        // a real partially-paid invoice: 1000 billed, 400 paid → 600 remaining
        await c.query(`INSERT INTO invoices (user_id, entity_id, data) VALUES ($1, NULL, $2)`,
          [uid, { client: 'F119 Co', amount: 1000, amount_paid: 400, status: 'partial', issue_date: '2026-06-10' }]);
      },
    });
    const { window, settle } = boot;
    await settle(5, 100);

    // Ensure invoices are loaded into the client store (loadEntityData runs at boot; nudge if present).
    if (typeof window.loadEntityData === 'function') { try { await window.loadEntityData(); } catch (e) {} }
    await settle(3, 100);

    const invs = Array.isArray(window.userInvoices) ? window.userInvoices : [];
    const inv = invs.find(i => i && i.client === 'F119 Co');
    A('the partial invoice is loaded into window.userInvoices', !!inv, `userInvoices has ${invs.length} rows`);
    A('loaded invoice object carries amount_paid = 400 (mapper did NOT drop it)',
      !!inv && Math.round((parseFloat(inv.amount_paid) || 0) * 100) / 100 === 400,
      `amount_paid = ${inv && inv.amount_paid} (undefined ⇒ the F119 bug)`);

    // Open Record Payment on that invoice → remaining must be amount − amount_paid = 600.
    if (typeof window.openRecordPaymentModal === 'function' && inv) window.openRecordPaymentModal(inv);
    await settle(2, 60);
    const remEl = window.document.getElementById('rp-remaining');
    const rem = remEl ? num(remEl.textContent) : NaN;
    A('Record Payment remaining = 600 (amount 1000 − paid 400), NOT the full 1000 [pre-fix risk]',
      rem === 600, `#rp-remaining = ${remEl ? JSON.stringify(remEl.textContent) : '(missing)'} → ${rem}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F119 partial case, executed in jsdom)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
