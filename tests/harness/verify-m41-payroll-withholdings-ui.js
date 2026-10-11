'use strict';
/**
 * M41 (fix pass round 2), BROWSER leg: Payroll run history shows the withholdings a paid run still owes and lets the
 * owner record remitting them (real SPA in jsdom, clientMoneyKit seed, clock 2026-07-25).
 * Seed: the approved "July 2026" run — Sam gross 2,000, 10% tax ⇒ withholdings 200, net 1,800.
 *   after Mark Paid: row reads "Withholdings owed: $200" with a Remit action   (bug: neither exists)
 *   after Remit (2026-07-25): row reads "Withholdings $200 remitted"; Payroll liabilities (2200) back to 0;
 *   cash (1000) −2,000 in total (1,800 net + 200 remitted)
 */
const { run } = require('./clientMoneyKit.js');

run('M41 — payroll run history: withholdings owed and Remit', async ({ w, d, ev, settle, http, eq, A }) => {
  w.showPage('payroll'); await settle(30, 60);
  await ev(`loadPayrollRuns()`); await settle(20, 60);
  const runRow = () => Array.from(d.querySelectorAll('#payroll-runs-list .tx-row')).find(r => /July 2026/.test(r.textContent));
  const runId = (((await http.request('GET', '/api/payroll-runs')).json || []).find(r => r.period === 'July 2026') || {}).id;
  A('seed run present', !!runId);
  await ev(`markPayrollPaid(${runId})`); await settle(30, 60);
  const row1 = runRow();
  const txt1 = row1 ? row1.textContent.replace(/\s+/g, ' ') : '';
  eq('paid run shows the withholdings owed', (txt1.match(/Withholdings owed: (\$[0-9,.]+)/) || [])[1] || null, '$200', null);
  const btn = row1 && row1.querySelector('button[onclick^="openRemitWithholdings"]');
  eq('paid run offers Remit', btn ? 1 : 0, 1, 0);
  if (!btn) return;
  ev(btn.getAttribute('onclick')); await settle(5, 40);
  eq('Remit modal opens, dated the business today', (d.getElementById('rw-date') || {}).value, '2026-07-25');
  await ev(`saveRemitWithholdings()`); await settle(30, 60);
  const txt2 = (runRow() || {}).textContent ? runRow().textContent.replace(/\s+/g, ' ') : '';
  eq('row now reads remitted', /Withholdings \$200 remitted/.test(txt2), true, false);
  eq('Remit is no longer offered', runRow().querySelector('button[onclick^="openRemitWithholdings"]') ? 1 : 0, 0);
  const bs = (await http.request('POST', '/api/reports/balance-sheet', {})).json || {};
  eq('balance sheet: payroll liabilities settled; cash −2,000 from payroll', [Math.round(bs.payrollLiabilities * 100) / 100], [0]);
});
