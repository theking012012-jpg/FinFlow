'use strict';
/**
 * M20 (money audit 2026-10-09; Rule 12): the AI insights' payroll figures come from payroll RUNS.
 * BUG: "Payroll-to-revenue" and "Payroll cost this quarter" read d.sal (expense rows categorised as salary — none
 * under basis C ⇒ 0), and "Payroll deductions this month" summed the ROSTER's deduction template.
 * Seed (clientMoneyKit): approved July run, Sam gross 2,000 with a 10% deduction (net 1,800); year revenue 1,820;
 *   no salary-category expense rows.
 *   correct: Year "Payroll-to-revenue: 110%" (2,000 / 1,820) · Q3 "Payroll cost this quarter: $2,000"
 *            July "Payroll deductions this month: $200" (from the run)
 *   bug:     0% · $0 · roster template 200 even with no run — so a second roster employee with no run is added
 *            (gross 3,000, 10%): bug reads 500, the run says 200.
 */
const { run } = require('./clientMoneyKit.js');

run('M20 — AI payroll figures come from payroll runs', async ({ w, ev, all, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(30, 60);
  w.updateAI && w.updateAI(); await settle(5, 40);
  eq('Year: Payroll-to-revenue', ((all('ai-insights-list') || '').match(/Payroll-to-revenue: (-?\d+)%/) || [])[1], '110', '0');
  ev(`setPeriod(document.getElementById('pQ'),'quarter')`); await settle(30, 60);
  w.updateAI && w.updateAI(); await settle(5, 40);
  eq('Q3: Payroll cost this quarter', ((all('ai-insights-list') || '').match(/Payroll cost this quarter: (\$[0-9,]*[0-9](?:\.[0-9]+)?)/) || [])[1], '$2,000', '$0');
  ev(`setPeriod(document.getElementById('pMonth'),'month')`); await settle(30, 60);
  w.updateAI && w.updateAI(); await settle(5, 40);
  eq('July: Payroll deductions this month (from the run, not the roster)', ((all('ai-insights-list') || '').match(/Payroll deductions this month: (\$[0-9,]*[0-9](?:\.[0-9]+)?)/) || [])[1], '$200', '$500');
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/payroll', { fname: 'Rita', lname: 'Roster', gross: 3000, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
  if (r.status >= 300) throw new Error('roster ' + r.status);
} });
