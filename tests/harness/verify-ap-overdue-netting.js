'use strict';
/**
 * verify-ap-overdue-netting.js — L44, the AP mirror of L35. "Overdue" on the Bills and Vendors pages was
 * window._billsOverdueSum: Σ (amount − amount_paid) of past-due unpaid bills, GROSS of open vendor credits and never
 * clamped to payables (live: Overdue $500 > Payables $250). Vendor credits load on the client only when the Vendor
 * Credits page is opened, so a client-side netting would depend on navigation order; the fix computes it ONCE on the
 * server — computeBooks.apSummary, the mirror of arSummary: past-due recognised-bill balances (issued ≤ today) less
 * open|applied vendor credits (dated ≤ today), clamped to [0, accounts payable] — and both cards read it.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes:
 *   bill X 250 unpaid · issued 06-01 · due 06-30 (past due)
 *   bill Y 250 unpaid · issued 06-15 · due 07-15 (past due)
 *   bill Z 300 unpaid · issued 07-01 · due 08-30 (not yet due)
 *   vendor credit 250 · Open · 07-01
 * HAND-COMPUTED: payables 800 − 250 = 550 · overdue min(550, 500 − 250) = 250 (2 bills)
 * BUGGY (pre-fix): overdue 500 on both cards (gross); no server figure.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-ap-overdue-netting.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(m)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const num = t => parseFloat(String(t || '').replace(/[^\d.\-]/g, ''));

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L44 — AP "Overdue" nets open vendor credits and never exceeds payables\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L44 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/bills', { vendor: 'Xeno Parts', num: 'BX', amount: 250, status: 'unpaid', issue_date: '2026-06-01', due_date: '2026-06-30' });
      await J('/api/bills', { vendor: 'Yarrow Ltd', num: 'BY', amount: 250, status: 'unpaid', issue_date: '2026-06-15', due_date: '2026-07-15' });
      await J('/api/bills', { vendor: 'Zenith Co', num: 'BZ', amount: 300, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-08-30' });
      await J('/api/vendor-credits', { vendor: 'Xeno Parts', num: 'VC-1', amount: 250, date: '2026-07-01', status: 'Open', reason: 'damaged goods' });
    } });
    const { window: w, settle, http } = ctx;
    await settle(40, 100);

    const bs = (await http.post('/api/reports/balance-sheet', {})).json || {};
    A('CONTROL: payables 550 (800 bills − 250 vendor credit)', near(bs.accountsPayable, 550), 'accountsPayable=' + bs.accountsPayable);
    const ap = bs.apSummary || {};
    A('server apSummary: overdue 250 · 2 bills (bug: absent)', near(ap.overdueTotal, 250) && ap.overdueCount === 2, JSON.stringify(bs.apSummary));
    A('server: overdue ≤ payables', bs.apSummary != null && Number(ap.overdueTotal) <= Number(bs.accountsPayable) + 0.005, JSON.stringify({ ov: ap.overdueTotal, ap: bs.accountsPayable }));

    w.showPage('bills'); await settle(40, 100);
    const billsOv = num((w.document.querySelectorAll('#page-bills .mc-val')[2] || {}).textContent);
    A('Bills page "Overdue" $250 (bug: $500 gross)', near(billsOv, 250), 'bills overdue card=' + billsOv);
    w.showPage('vendors'); await settle(40, 100);
    const vCards = w.document.querySelectorAll('#page-vendors .mc-val');
    const vPay = num((vCards[1] || {}).textContent), vOv = num((vCards[2] || {}).textContent);
    A('Vendors page "Payables" $550 (CONTROL, N24b)', near(vPay, 550), 'vendors payables card=' + vPay);
    A('Vendors page "Overdue" $250 ≤ Payables (bug: $500)', near(vOv, 250) && vOv <= vPay + 0.005, 'vendors overdue card=' + vOv);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (AP overdue netting)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
