'use strict';
/**
 * verify-f84-savepaymentmade-billid.js — F84 CLIENT fail-then-pass (Rule 14).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f84-savepaymentmade-billid.js
 *
 * Boots the REAL SPA in jsdom (real bundle → the shipped openMakePaymentModal / savePaymentMade
 * runtime winners) against a real seeded scratch Postgres + real server, seeds one bill, opens the
 * Make Payment modal, SELECTS that bill, and drives savePaymentMade — then reads the captured wire
 * log for the POST /api/payments-made body.
 *
 * The oracle (verify-f84-bill-linked-payment.js) proves bill_id is the money lever on the server.
 * This proves the CLIENT actually SENDS it — without this, the fix is inert (the F75 lesson: a fix
 * on a path that never reaches the wire is a clean diff that changes nothing).
 *
 * EXPECTED:
 *   CURRENT code — the modal has no bill selector and savePaymentMade omits bill_id →
 *     the POST body carries NO bill_id → assertion 3 FAILS (the documented F84 defect).
 *   FIXED code — a #pm-bill selector on the modal + savePaymentMade including bill_id →
 *     the POST body carries bill_id === the selected bill → ALL GREEN.
 *
 * The save-fired / vendor-present controls isolate a FAIL to bill_id specifically, not a broken save.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

// jsdom fires requestAnimationFrame on a timer; one landing after window.close() during teardown
// reads a nulled document and throws. Teardown noise, not a result — swallow ONLY that.
process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(m)) return;
  throw e;
});

(async () => {
  let boot, billId, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    boot = await bootSpaInJsdom({
      // Seed one issued bill so the (fixed) modal's bill selector has a real option to pick.
      seedExtra: async (c, uid) => {
        billId = (await c.query(
          `INSERT INTO bills (user_id, entity_id, data, created_at, updated_at)
           VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
          [uid, { vendor: 'JSDOM Bill Co', num: 'BILL-9001', amount: 1300, status: 'unpaid',
                  issue_date: '2026-07-10', due_date: '2026-07-31', amount_paid: 0 }]
        )).rows[0].id;
      },
    });
    const { window, wireLog, settle } = boot;

    // Wait for the runtime winners (bundle loads async in jsdom).
    for (let i = 0; i < 250 && typeof window.savePaymentMade !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    // Let loadBills() populate _billsData so a (fixed) selector can be filled from it.
    await settle(15, 100);

    A('runtime winners present: openMakePaymentModal + savePaymentMade on window',
      typeof window.openMakePaymentModal === 'function' && typeof window.savePaymentMade === 'function');

    const doc = window.document;
    const before = wireLog.length;

    // Open the modal the way the button does.
    if (typeof window.openMakePaymentModal === 'function') window.openMakePaymentModal();
    await settle(3, 50);

    // Select the seeded bill IF the selector exists (it only does once the fix ships). Guarded so the
    // CURRENT-code run reaches savePaymentMade and fails specifically on the missing bill_id.
    const billSel = doc.getElementById('pm-bill');
    A('control: #pm-bill selector exists on the Make Payment modal (fix adds it)',
      !!billSel, 'no #pm-bill element — CURRENT code has no bill field on the modal');
    if (billSel) {
      billSel.value = String(billId);
      A('control: #pm-bill offers the seeded bill as an option',
        billSel.value === String(billId), `value=${JSON.stringify(billSel.value)} want=${billId}`);
    }

    // Fill the always-present fields and fire the real save.
    const setVal = (id, v) => { const el = doc.getElementById(id); if (el) el.value = v; };
    setVal('pm-vendor', 'JSDOM Bill Co');
    setVal('pm-amount', '500');
    setVal('pm-date', '2026-07-12');

    await window.savePaymentMade();
    await settle(40, 50);

    const posts = wireLog.slice(before).filter(w => w.method === 'POST' && w.path === '/api/payments-made');
    A('control: exactly ONE POST /api/payments-made fired (save path works)',
      posts.length === 1, `posts=${posts.length}`);
    const body = posts[0] ? JSON.parse(posts[0].body) : {};
    A('control: the POST carries the vendor (proves the save ran, not a no-op)',
      body.vendor === 'JSDOM Bill Co', `vendor=${JSON.stringify(body.vendor)}`);

    // ── THE F84 ASSERTION ──
    A('POST body carries bill_id === the selected bill (F84 fix; CURRENT code omits it)',
      Number(body.bill_id) === Number(billId),
      `bill_id=${JSON.stringify(body.bill_id)} want=${billId}  (CURRENT: absent — the double-count)`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
