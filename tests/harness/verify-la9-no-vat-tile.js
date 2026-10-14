'use strict';
/**
 * verify-la9-no-vat-tile.js — LA9 (live audit 2026-10-13, minor): the Reports page offered a "VAT Return" tile that
 * can only ever answer "VAT/GST is not tracked". FinFlow has no VAT/GST engine by design (CLAUDE.md product facts:
 * tax = estimates only), so the menu no longer offers it. The report's honest "not tracked" answer stays for any
 * direct call (verify-f137-tax-reports covers it).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la9-no-vat-tile.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA9 — the Reports menu does not offer a VAT return', async ({ w, d, settle, eq }) => {
  w.showPage('reports');
  await settle(30, 50);
  const names = sel => [...d.querySelectorAll(sel + ' > div')].map(r => (r.querySelector('span + div > div') || {}).textContent || '').map(s => s.trim()).filter(Boolean);
  eq('tax reports offered', names('#tax-reports-list'), ['Income Tax Estimate', '1099 / W-2 Summary', 'Tax-Deductible Expenses'],
    ['VAT Return', 'Income Tax Estimate', '1099 / W-2 Summary', 'Tax-Deductible Expenses']);
  eq('no "VAT Return" anywhere on the Reports page', /VAT Return/.test(d.getElementById('page-reports').textContent), false, true);
});
