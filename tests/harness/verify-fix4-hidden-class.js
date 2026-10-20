'use strict';
/**
 * verify-fix4-hidden-class.js — FIX-4 (Cowork live check 2026-10-19, COWORK_FIX_HANDOFF.md).
 *
 * Live: Record Payment on a $100 invoice (remaining $100), amount $40 → "⚠ Amount exceeds the remaining balance."
 * still showed; the save went through correctly ($60 left). Root cause (read, then executed here): the check IS re-run
 * on every keystroke (`oninput="_rpCheckOverpay()"`) and toggles class `hidden` correctly — but the stylesheet has no
 * plain `.hidden` rule. Only `.modal-overlay.hidden`, `.notif.hidden` and `.cmd-overlay.hidden` hide anything, so on
 * an ordinary <div> the class does nothing and the warning is ALWAYS visible.
 * Class (Rule 13 — every element that relies on `hidden` and is not an overlay): two —
 *   #rp-overpay-warn  (Record Payment warning)                       — always visible
 *   #si-bill-fields   (Stock In "Supplier / Bill due date", M34)     — always visible, even when paid by cash
 * Fix: one `.hidden { display: none !important }` rule (`!important` because `.field-group { display: grid }` is
 * declared later and would otherwise win).
 *
 * Real Chromium, real scratch Postgres, the production (SLIM) build. Visibility is MEASURED (computed display +
 * layout box), not read from the class list — the class list was always right.
 *   invoice $100, nothing paid; amount 40 / 100 → warning hidden; 150 → shown       bug: shown at 40 and 100
 *   Stock In: paid by cash → supplier fields hidden; on credit (bill) → shown       bug: shown for cash
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fix4-hidden-class.js
 */
process.env.SLIM_APP = '1';
const { runBrowser } = require('./browserKit.js');

runBrowser('FIX-4 — the "hidden" class hides (Record Payment overpay warning, Stock In supplier fields)', async ({ open, eq, A }) => {
  const page = await open({ width: 1280, height: 800 });
  await page.waitForTimeout(3000);
  const shown = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return null;
    return getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; }, sel);

  // ── Record Payment ──
  await page.evaluate(() => window.showPage('invoices'));
  await page.waitForTimeout(1500);
  const opened = await page.evaluate(() => { const inv = (window.userInvoices || []).find(i => i.client === 'Overpay Check');
    if (!inv) return false; window.openRecordPaymentModal(inv); return true; });
  A('the $100 invoice is listed and Record Payment opens', opened);
  await page.waitForTimeout(400);
  eq('modal shows Remaining $100', /^\$100(\.00)?$/.test(await page.evaluate(() => (document.getElementById('rp-remaining') || {}).textContent)), true);
  const at = async v => { await page.fill('#rp-amount', String(v)); await page.waitForTimeout(150); return shown('#rp-overpay-warn'); };
  eq('amount 40 (below remaining): warning hidden', await at(40), false, true);
  eq('amount 100 (exactly remaining): warning hidden', await at(100), false, true);
  eq('amount 150 (over remaining): warning shown', await at(150), true);
  eq('…and Save is disabled while over', await page.evaluate(() => document.getElementById('rp-save-btn').disabled), true);
  eq('back to 40: warning hidden again, Save enabled', [await at(40), await page.evaluate(() => document.getElementById('rp-save-btn').disabled)], [false, false], [true, false]);
  await page.evaluate(() => window.closeModal('record-payment-modal'));

  // ── Stock In ──
  await page.evaluate(() => window.showPage('inventory'));
  await page.waitForTimeout(1500);
  const idx = await page.evaluate(() => (window.inventory || []).findIndex(i => i.name === 'Widget'));
  A('the stocked product is listed', idx >= 0, 'idx=' + idx);
  await page.evaluate(i => window.openStockInModal(i), idx);
  await page.waitForTimeout(300);
  eq('Stock In, paid by cash: supplier / bill-due fields hidden', await shown('#si-bill-fields'), false, true);
  await page.selectOption('#si-funding', 'bill');
  await page.waitForTimeout(150);
  eq('Stock In, on credit (bill): supplier / bill-due fields shown', await shown('#si-bill-fields'), true);
  await page.selectOption('#si-funding', 'cash');
  await page.waitForTimeout(150);
  eq('back to cash: hidden again', await shown('#si-bill-fields'), false, true);

  // Overlays still open and close (the rule must not break the one place `hidden` already worked).
  await page.evaluate(() => window.openModal('record-payment-modal'));
  eq('a modal still opens', await shown('#record-payment-modal'), true);
  await page.evaluate(() => window.closeModal('record-payment-modal'));
  eq('…and closes', await shown('#record-payment-modal'), false);
}, { seed: async ({ J }) => {
  await J('POST', '/api/invoices', { client: 'Overpay Check', amount: 100, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01', idempotency_key: 'fix4-inv' });
  await J('POST', '/api/inventory', { name: 'Widget', sku: 'W-1', qty: 5, cost: 10, price: 25 });
} });
