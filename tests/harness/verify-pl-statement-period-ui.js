#!/usr/bin/env node
'use strict';
/**
 * verify-pl-statement-period-ui.js — N41 (c). The P&L Statement modal asks the server for the period the user
 * is looking at — the fiscal-year start and the selected period — so its totals and the Operating-Expenses
 * breakdown under them cover the same period.
 *
 * Defect: generateReport('Profit & Loss Statement') posted {} — no period, no fiscal-year start — so it showed
 * January–December totals whatever the fiscal year.
 * Executed: the real SPA in jsdom (VERIFICATION seed) against the real server + Postgres. The fiscal-year control
 * is set to April; the rendered Total Revenue must equal the server's April-FY figure, which the seed makes
 * different from the January-FY figure.
 *   node -r ./tests/harness/clock.js tests/harness/verify-pl-statement-period-ui.js
 */
require('./clock.js');
process.on('uncaughtException', (e) => {
  const s = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(s)) return;
  throw e;
});
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
async function uiPart() {
  const { bootSpaInJsdom } = require('./jsdomBoot.js');
  // Rule 4: an invoice in February — inside the January fiscal year, outside the April one — so the two
  // fiscal years give different revenue (the base seed alone does not discriminate).
  const boot = await bootSpaInJsdom({ seedExtra: async (c, uid) => {
    const eid = (await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [uid])).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-02-15T16:00:00Z','2026-02-15T16:00:00Z')`,
      [uid, eid, { client: 'February Client', amount: 777, amount_paid: 0, status: 'pending', issue_date: '2026-02-15', due_date: '2026-03-15' }]);
  } });
  try {
    const { window, http, settle } = boot;
    for (let i = 0; i < 250 && typeof window.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(12, 100);
    const fmt = (typeof window._fmtMoneyNative === 'function') ? window._fmtMoneyNative : (n) => '$' + (parseFloat(n) || 0).toFixed(2);
    const flat = s => (s || '').replace(/\s+/g, '');
    const jan = (await http.post('/api/reports/profit-loss?period=year&fyStart=0', {})).json || {};
    const apr = (await http.post('/api/reports/profit-loss?period=year&fyStart=3', {})).json || {};
    A('UI seed discriminates: April-FY revenue ≠ January-FY revenue', r2(jan.totalRevenue) !== r2(apr.totalRevenue), `jan ${jan.totalRevenue} apr ${apr.totalRevenue}`);
    const fy = window.document.getElementById('s-fy');
    A('fiscal-year setting control present (#s-fy)', !!fy);
    if (fy) fy.value = 'April';
    await window.generateReport('Profit & Loss Statement');
    await settle(22, 60);
    const body = flat((window.document.getElementById('rpt-body') || {}).textContent);
    A('P&L Statement (FY April): Total Revenue = April-FY server figure (bug: January-FY figure)', body.includes('TotalRevenue' + flat(fmt(apr.totalRevenue))),
      `want TotalRevenue${flat(fmt(apr.totalRevenue))}; jan would be ${flat(fmt(jan.totalRevenue))}; body ${body.slice(0, 160)}`);
    A('P&L Statement (FY April): Total Operating Expenses = April-FY server figure', body.includes('TotalOperatingExpenses' + flat(fmt(apr.totalExpenses))), `want ${flat(fmt(apr.totalExpenses))}`);
  } finally {
    try { await boot.stop(); } catch (_) {}
  }
}

(async () => {
  try { await uiPart(); }
  catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (P&L statement period UI)` : `  ALL GREEN — ${pass} passed, 0 failed  (P&L statement period UI)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
