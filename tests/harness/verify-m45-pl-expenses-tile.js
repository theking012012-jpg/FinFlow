'use strict';
/**
 * M45 (money audit 2026-10-09): the P&L report's "Expenses" tile says what its value is.
 * BUG: caption "incl. payroll + COGS" over the OPERATING-expense value, which excludes COGS (COGS is in Gross Profit).
 * Seed (clientMoneyKit, Year): opex 2,900 (rent 500 + payroll 2,000 + bill 400) · COGS 30.
 *   correct: "$2,900" captioned "operating, incl. payroll" · Gross Profit = 1,820 − 30 = $1,790
 *   bug: "$2,900" captioned "incl. payroll + COGS"
 */
const { run } = require('./clientMoneyKit.js');

run('M45 — P&L Expenses tile caption matches its value', async ({ w, ev, all, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(20, 60);
  await w.generateReport('Profit & Loss Statement'); await settle(20, 60);
  const rpt = all('rpt-body') || '';
  eq('Expenses tile value + caption', (rpt.match(/Expenses\s*(\$[0-9,]+)\s*(operating, incl\. payroll|incl\. payroll \+ COGS)/) || []).slice(1), ['$2,900', 'operating, incl. payroll'], ['$2,900', 'incl. payroll + COGS']);
  eq('Gross Profit tile (COGS lives here)', (rpt.match(/Gross Profit\s*(\$[0-9]{1,3}(?:,[0-9]{3})*)/) || [])[1], '$1,790');
});
