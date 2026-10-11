'use strict';
/**
 * M41 (fix pass round 2): payroll withholdings are a LIABILITY until they are remitted (the QuickBooks / Xero model).
 *   approve   Dr 6100 Payroll expense      / Cr 2200 Payroll liabilities   GROSS   (unchanged)
 *   mark-paid Dr 2200                      / Cr 1000 Cash                  NET     (was gross)
 *   remit     Dr 2200                      / Cr 1000 Cash                  WITHHOLDINGS (new action)
 * BUG: mark-paid took GROSS out of cash on the pay date, so the books said the withholdings had left the bank with the
 * wages and never showed them as owed; there was no way to record paying them to the authority.
 * Seed (Rule 4 — gross, net and withholdings all differ): Sam gross 2,000, deductions 10% tax + 50 pension
 *   ⇒ withholdings 250, net 1,750. Run "July 2026", paid on the business day (2026-07-25), remitted 2026-07-28.
 *   after mark-paid: cash −1,750 (bug −2,000) · Payroll liabilities 250 (bug 0) · cash-flow out 1,750 (bug 2,000)
 *                    forecast carries a 250 withholdings outflow (bug: none)
 *   after remit:     cash −2,000 · liabilities 0 · cash-flow out 2,000 (1,750 + 250 on 2026-07-28) · no forecast item
 *   P&L payroll expense 2,000 throughout (control: expense is gross on every path)
 * Existing books (Rule 8): a run marked paid BEFORE this fix (paid_basis NULL) keeps its gross cash-out, on every
 * path including a ledger rebuild — so the owner's historic cash and liabilities do not move.
 */
const { run } = require('./moneyFixKit.js');

run('M41 — payroll withholdings are a liability until remitted', async ({ newOwner, c, eq, A, r2 }) => {
  const { uid, J, http } = await newOwner('M41');
  await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Field', gross: 2000, deductions: [{ label: 'Tax', value: 10, type: 'percent' }, { label: 'Pension', value: 50, type: 'fixed' }] });
  const run1 = await J('POST', '/api/payroll-runs', { period: 'July 2026', run_date: '2026-07-24', idempotency_key: 'm41-jul' });
  await J('PUT', '/api/payroll-runs/' + run1.id + '/approve', {});

  const bal = async (code) => r2((await c.query(`SELECT COALESCE(SUM(ll.debit - ll.credit),0)::float AS b FROM ledger_lines ll JOIN ledger_accounts la ON la.id = ll.account_id
     JOIN ledger_entries le ON le.id = ll.entry_id WHERE ll.user_id = $1 AND la.code = $2 AND le.status = 'posted'`, [uid, code])).rows[0].b);
  const cfOut = async () => r2((await J('POST', '/api/reports/cash-flow', {})).totalOutflow);
  const fcWith = async () => ((await J('GET', '/api/cashflow-forecast')).periods || []).flatMap(p => p.items || []).filter(i => i.direction === 'out' && i.kind === 'payroll_withholdings');
  const plPayroll = async () => r2((await J('GET', '/api/reports')).expenses);

  eq('remit before the run is paid is refused', (await http.put('/api/payroll-runs/' + run1.id + '/remit', {})).status, 409, 404);

  await J('PUT', '/api/payroll-runs/' + run1.id + '/mark-paid', {});
  eq('after mark-paid: cash (1000) = −net', await bal('1000'), -1750, -2000);
  eq('after mark-paid: payroll liabilities (2200) owe the withholdings', await bal('2200'), -250, 0);
  eq('after mark-paid: cash-flow report payroll out = net', await cfOut(), 1750, 2000);
  const w = await fcWith();
  eq('after mark-paid: forecast carries the withholdings still to pay', w.map(i => i.amount), [250], []);
  eq('P&L payroll expense is gross (control)', await plPayroll(), 2000);
  const bs1 = await J('POST', '/api/reports/balance-sheet', {});
  eq('balance sheet stays ledger-sourced and shows the liability', [bs1.source, r2(bs1.cash), r2(bs1.payrollLiabilities)], ['gl', -1750, 250], ['gl', -2000, 0]);

  const rem = await http.put('/api/payroll-runs/' + run1.id + '/remit', { date: '2026-07-28' });
  eq('remit withholdings accepted', rem.status, 200, 404);
  eq('after remit: cash (1000) = −gross', await bal('1000'), -2000, -2000);
  eq('after remit: payroll liabilities settled', await bal('2200'), 0, 0);
  eq('after remit: cash-flow report payroll out = net + withholdings', await cfOut(), 2000, 2000);
  eq('after remit: nothing left in the forecast', (await fcWith()).length, 0, 0);
  const { rows: [re] } = await c.query(`SELECT entry_date::text AS d FROM ledger_entries WHERE user_id=$1 AND source_type='payroll_remit' AND source_id=$2 AND status='posted'`, [uid, run1.id]);
  eq('remittance dated as entered', re && re.d, '2026-07-28', undefined);
  await J('PUT', '/api/payroll-runs/' + run1.id + '/remit', { date: '2026-07-29' });
  eq('a repeat remit books nothing new', await bal('1000'), -2000, undefined);
  eq('P&L payroll expense still gross (control)', await plPayroll(), 2000);

  // Void after remit reverses every leg.
  await J('PUT', '/api/payroll-runs/' + run1.id + '/void', {});
  eq('void: cash back to 0', await bal('1000'), 0, undefined);
  eq('void: liabilities 0', await bal('2200'), 0, undefined);

  // Existing books (Rule 8): a run paid before the fix keeps its gross cash-out — live and after a rebuild.
  const run2 = await J('POST', '/api/payroll-runs', { period: 'June 2026', run_date: '2026-06-30', idempotency_key: 'm41-jun' });
  await J('PUT', '/api/payroll-runs/' + run2.id + '/approve', {});
  await J('PUT', '/api/payroll-runs/' + run2.id + '/mark-paid', {});
  const { rows: [{ has }] } = await c.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_runs' AND column_name='paid_basis') AS has`);
  if (has) await c.query(`UPDATE payroll_runs SET paid_basis = NULL WHERE id = $1`, [run2.id]);   // simulate a run paid before the fix
  await J('POST', '/api/gl/backfill?reset=1', {});
  eq('legacy paid run after a ledger rebuild: cash = −gross (unchanged history)', await bal('1000'), -2000, 'history moved: -1750');
  eq('legacy paid run: no withholdings shown as owed', await bal('2200'), 0, 'history moved: -250');
  eq('legacy paid run: cash-flow out = gross', await cfOut(), 2000, 'history moved: 1750');
  eq('legacy paid run: nothing to remit in the forecast', (await fcWith()).length, 0, 'history moved: 1');
});
