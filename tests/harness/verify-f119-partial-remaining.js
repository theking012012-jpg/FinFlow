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

    // Wait UNTIL the boot load has populated the store, not for a fixed interval. Measured (probe,
    // 2026-09-10, both HEAD and working tree): window.userInvoices lands ~1.0-1.3 s after jsdom boot.
    // The original fixed budget here was 800 ms (settle(5,100) + settle(3,100)), so this harness was
    // a race by construction — it went red 1 run in ~4 in isolation and red in the 2026-09-10 sweep
    // with the product code unchanged on this path. A fixed sleep shorter than the thing it waits
    // for is not a wait; it is a coin. Poll up to 12 s (well past the measured latency, well under
    // the sweep's 180 s cap) and fall through to the assertions either way, so a genuinely-empty
    // store still fails loudly rather than hanging.
    for (let i = 0; i < 240; i++) {
      if (Array.isArray(window.userInvoices) && window.userInvoices.some(x => x && x.client === 'F119 Co')) break;
      await settle(1, 50);
    }
    // Nudge once if the boot load still hasn't landed (loadEntityData runs at boot; harmless if it has).
    if (!(Array.isArray(window.userInvoices) && window.userInvoices.length) && typeof window.loadEntityData === 'function') {
      try { await window.loadEntityData(); } catch (e) {}
      await settle(6, 100);
    }

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
