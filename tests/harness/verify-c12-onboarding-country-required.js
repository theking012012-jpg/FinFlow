'use strict';
/**
 * C12 (Cowork end-to-end test 1.3a): onboarding step 1 does not continue while the required Country is empty.
 * BUG: step 1 checked business name, your name, email, industry and address — not Country — so Continue moved on with
 * it empty (it was only caught at the very end, which sent the user back to step 1).
 * Executed: the real wizard (obNext) on a brand-new account in jsdom.
 *   every field filled except Country → stays on step 1, "Country is required" toast   bug: moves to step 2
 *   Country filled too (control) → step 2
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

const BLANK_SQL = `TRUNCATE invoices, expenses, bills, customers, inventory, payroll, holdings,
  entities, user_settings, payments_made, payments_received, sales_receipts, invoice_payments,
  payroll_runs, payroll_run_lines, inventory_movements, fx_rates, fx_transactions, audit_trail,
  vendors, items, journals, credit_notes, vendor_credits RESTART IDENTITY CASCADE`;

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  ' + det : ''))); };
  try {
    boot = await bootSpaInJsdom({ seedExtra: async (c) => { await c.query(BLANK_SQL); } });
    const { window: w, settle } = boot;
    const d = w.document;
    await settle(40, 50);
    A('the onboarding wizard is shown to a new account', !!d.getElementById('ob-s1'));
    const set = (id, v) => { const el = d.getElementById(id); if (el) el.value = v; };
    const step = n => ((d.getElementById('ob-s' + n) || {}).className || '').includes('active');
    set('ob-biz-name', 'Northwind Studio'); set('ob-user-name', 'Sam Owner'); set('ob-email', 'sam@northwind.test');
    set('ob-industry', 'Technology'); set('ob-address', '100 Main St, Springfield'); set('ob-currency', 'USD'); set('ob-country', '');
    w.obNext(); await settle(5, 30);
    const toast = ((d.getElementById('notif-text') || {}).textContent || '').trim();
    A('Country empty → stays on step 1 (bug: moves to step 2)', step(1) && !step(2), 'step1=' + step(1) + ' step2=' + step(2));
    A('…and says Country is required', /Country is required/.test(toast), toast);
    set('ob-country', 'US');
    w.obNext(); await settle(5, 30);
    A('control: with Country → step 2', step(2), 'step2=' + step(2));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack || e); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
