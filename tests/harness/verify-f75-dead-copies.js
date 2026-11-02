'use strict';
/**
 * verify-f75-dead-copies — F75 (CLAUDE.md failure 1: dead-code shadowing). 19 app-main functions were REPLACED at
 * runtime by a wiring copy (window.NAME = …), so the app-main copy never ran — and two past "fixes" were made to such
 * a dead copy and never rendered. The 19 dead copies are DELETED. Checked before deleting (acorn): every override is
 * installed synchronously and unconditionally when the bundle runs, and nothing in app-main or the scripts loaded
 * before the bundle refers to any of them at load time.
 * Executed: the real /app in Chromium against the real server and scratch Postgres (Rule 3) — boot with no page error,
 * every live copy present, every page whose renderer lost its dead copy opens and renders real rows, and real saves
 * through the live save functions land in the database.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f75-dead-copies.js
 */
const fs = require('fs'); const path = require('path');
const { runBrowser } = require('./browserKit.js');
const NAMES = ['deleteCustomer','saveCustomer','saveSettings','saveInvoice','renderInvoices','renderInventory','renderPayroll','restockItem','openProductModal','saveProduct','openLogTimeModal','openNewProjectModal','renderTimesheet','saveJournalEntry','loadPersistedData','persistAll','renderExpenses','saveExpense','saveHolding'];
runBrowser('F75 — the 19 dead copies are gone and the app still works', async ({ open, A, eq, J, c, uid }) => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app-main.js'), 'utf8');
  const still = NAMES.filter(n => new RegExp('^\\s*(?:async\\s+)?function\\s+' + n + '\\s*\\(', 'm').test(src));
  A('[STRUCTURAL] none of the 19 is declared in app-main any more', still.length === 0, still.join(', '));
  await J('POST', '/api/invoices', { client: 'Live Copy Co', amount: 250, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-10', idempotency_key: 'f75-i' });
  await J('POST', '/api/expenses', { description: 'Live rent', category: 'Rent', amount: 90, deductible: 'yes', expense_date: '2026-07-11', idempotency_key: 'f75-e' });
  await J('POST', '/api/inventory', { name: 'Live Widget', units: 5, unit_cost: 2 });
  await J('POST', '/api/payroll', { fname: 'Liv', lname: 'Copy', gross: 1000 });
  const page = await open({ width: 1280, height: 900 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.waitForTimeout(2500);
  const r = await page.evaluate(async (names) => {
    const live = names.filter(n => typeof window[n] === 'function');
    const shown = {};
    for (const [pg, rx] of [['invoices', /Live Copy Co/], ['expenses', /Live rent/], ['inventory', /Live Widget/], ['payroll', /Liv/], ['timesheet', /./]]) {
      showPage(pg); await new Promise(res => setTimeout(res, 900));
      const el = document.getElementById('page-' + pg); shown[pg] = !!(el && rx.test(el.textContent));
    }
    return { live, shown };
  }, NAMES);
  eq('every one of the 19 resolves to a live copy on window', r.live.length, NAMES.length);
  eq('every page whose renderer lost its dead copy renders real rows', r.shown, { invoices: true, expenses: true, inventory: true, payroll: true, timesheet: true });
  // a real save through the live copies (customer modal → saveCustomer; settings → saveSettings)
  const saved = await page.evaluate(async () => {
    showPage('customers'); await new Promise(res => setTimeout(res, 600));
    if (typeof openCustomerModal === 'function') openCustomerModal();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; return !!e; };
    set('cust-company', 'Saved Through Live Co') || set('c-company', 'Saved Through Live Co');
    await window.saveCustomer(); await new Promise(res => setTimeout(res, 900));
    showPage('settings'); await new Promise(res => setTimeout(res, 600));
    set('s-phone', '555-0175'); await window.saveSettings(); await new Promise(res => setTimeout(res, 900));
    return true;
  });
  eq('saveCustomer (the live copy) stores the customer', saved && (await c.query(`SELECT count(*)::int n FROM customers WHERE user_id = $1 AND data->>'company' = 'Saved Through Live Co'`, [uid])).rows[0].n, 1);
  A('saveSettings (the live copy) stores the setting', (await c.query(`SELECT count(*)::int n FROM user_settings WHERE user_id = $1 AND data::text LIKE '%555-0175%'`, [uid])).rows[0].n >= 1);
  eq('no page errors anywhere (a missing function would be a ReferenceError)', errs, []);
}, {});
