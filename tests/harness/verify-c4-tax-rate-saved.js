'use strict';
/**
 * C4 (Cowork end-to-end test 3.4): the Income Tax Estimate keeps the rate the owner types, and the accountant's
 * Tax Summary sees it.
 * BUG: the owner set the "Income tax" line to 20 %; reopening the report showed 0 % / $0, and the accountant's Tax
 * Summary said "Client has not set a tax rate".
 * Seed: clientMoneyKit (its Year is a loss, so taxable income is 0). Open Reports → Income Tax Estimate, type 20 into the line, wait for
 * the save, reopen the report.
 *   saved tax_lines[0].value = 20 and tax_rate = 20       bug: [20, 0] — the effective rate was total ÷ taxable, and this
 *                                                          seed's year is a loss, so the rate saved was 0 (what the
 *                                                          accountant's Tax Summary reads: "has not set a tax rate")
 *   the reopened report shows 20 (control; Cowork's "reopens at 0 %" did not reproduce here)
 */
const { run } = require('./clientMoneyKit.js');

run('C4 — the income-tax rate is saved', async ({ w, d, settle, eq, http }) => {
  try { w.showPage('reports'); } catch (_) {}
  await settle(20, 60);
  await w.generateReport('Income Tax Estimate'); await settle(20, 60);
  const inp = d.getElementById('tl-val-0');
  eq('the worksheet has a rate input', !!inp, true);
  inp.value = '20';
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 900)); await settle(20, 60);
  const st = (await http.get('/api/settings')).json || {};
  eq('saved: line value and effective rate', [st.tax_lines && st.tax_lines[0] && Number(st.tax_lines[0].value), Number(st.tax_rate)], [20, 20], [20, 0]);
  await w.generateReport('Income Tax Estimate'); await settle(20, 60);
  eq('control: the reopened report shows 20', (d.getElementById('tl-val-0') || {}).value, '20');
});
