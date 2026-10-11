'use strict';
/**
 * C13 (Cowork end-to-end test 1.3c): right after onboarding, the Entities page shows the new business — and its
 * country — without a page reload.
 * BUG: finishing onboarding called doLogin(), which needs the sign-in form's email + password (empty here) and so
 * returned at once; the boot load had already latched "0 businesses", so Entities showed 0 until a reload. The
 * entity card also never showed the country.
 * Executed: the real wizard (obNext ×4 — Continue ×3, then Get started) on a brand-new account in jsdom.
 *   ENTITIES after finishing → 1 (Northwind Studio)              bug: 0
 *   Entities count card → "1"                                     bug: "0"
 *   entity card shows "Trinidad and Tobago"                       bug: not shown
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
    A('before: no businesses', (w.ENTITIES || []).length === 0, 'ENTITIES=' + (w.ENTITIES || []).length);
    const set = (id, v) => { const el = d.getElementById(id); if (el) el.value = v; };
    set('ob-biz-name', 'Northwind Studio'); set('ob-user-name', 'Sam Owner'); set('ob-email', 'sam@northwind.test');
    set('ob-industry', 'Technology'); set('ob-address', '100 Main St, Port of Spain'); set('ob-currency', 'TTD'); set('ob-country', 'TT');
    for (let i = 0; i < 3; i++) { w.obNext(); await settle(5, 30); }
    A('reached the last step', ((d.getElementById('ob-s4') || {}).className || '').includes('active'));
    w.obNext();   // "Get started →" — the user's click on the last step
    await settle(40, 50);
    const ents = w.ENTITIES || [];
    A('after finishing: ENTITIES has the new business (bug: 0)', ents.length === 1 && ents[0].name === 'Northwind Studio', JSON.stringify(ents.map(e => e.name)));
    try { w.showPage('entities'); } catch (_) {}
    await settle(10, 40);
    if (typeof w.renderEntities === 'function') { w.renderEntities(); await settle(5, 30); }
    const cnt = ((d.getElementById('ent-count') || {}).textContent || '').trim();
    A('Entities count card reads 1 (bug: 0)', cnt === '1', JSON.stringify(cnt));
    const list = ((d.getElementById('entity-list') || {}).textContent || '').replace(/\s+/g, ' ');
    A('entity card names the business', /Northwind Studio/.test(list), list.slice(0, 160));
    A('entity card shows the country (bug: not shown)', /Trinidad (and|&) Tobago/.test(list), list.slice(0, 160));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack || e); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
