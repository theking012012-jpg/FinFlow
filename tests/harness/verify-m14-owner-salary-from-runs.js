'use strict';
/**
 * M14 (money audit 2026-10-09; Rule 12): the owner's PERSONAL salary income comes from PAID payroll RUNS, not the
 * roster. BUG: saving the owner's salary created a monthly recurring personal-income profile that the scheduler
 * materialised whether or not any run was approved, paid or voided; marking a run paid booked nothing personal.
 * Seed (Rule 4 — every source gives a different number):
 *   owner Olive   gross 4,000, deduction 10%  → net 3,600   (is_owner)
 *   employee Sam  gross 2,000, deduction 5%   → net 1,900   (must NOT reach the owner's personal books)
 *   an owner-salary recurring profile 3,333 (the old roster sync), referenced by the owner's payroll record
 *   an ordinary recurring profile "Side gig" 250 (control — the scheduler must still materialise it)
 * Expected:
 *   approve only        → 0 personal salary rows                      (approved ≠ paid)
 *   mark-paid           → ONE row, 3,600 TTD (the business currency), dated the paid date    (bug: 0 rows)
 *   mark-paid again     → still ONE row                               (keyed to the run line)
 *   scheduler           → no 3,333 row (bug: one 3,333 row); the 250 control row IS materialised
 *   void                → the 3,600 row is gone                       (bug: n/a — nothing was booked)
 */
const { run } = require('./moneyFixKit.js');

run('M14 — owner salary reaches Personal from paid payroll runs', async ({ newOwner, c, eq, A }) => {
  const { uid, J } = await newOwner('M14', [{ name: 'M14 Co', currency: 'TTD' }]);   // non-USD so the currency leg discriminates
  const owner = await J('POST', '/api/payroll', { fname: 'Olive', lname: 'Owner', gross: 4000, is_owner: true, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
  await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Staff', gross: 2000, deductions: [{ label: 'Tax', value: 5, type: 'percent' }] });

  // The old roster sync's profile, linked from the owner's payroll record (what saveOwnerPayroll used to store).
  const prof = await J('POST', '/api/recurring-personal-transactions', { description: 'Owner salary — M14 Co', amount: 3333, currency: 'TTD', category: 'Salary', tx_type: 'income', frequency: 'Monthly', status: 'active', next_run: '2026-07-01' });
  await J('PUT', '/api/payroll/' + owner.id, { salary_profile_id: prof.id });
  await J('POST', '/api/recurring-personal-transactions', { description: 'Side gig', amount: 250, currency: 'USD', category: 'Other', tx_type: 'income', frequency: 'Monthly', status: 'active', next_run: '2026-07-01' });

  const salaryRows = async () => (await J('GET', '/api/personal-transactions')).filter(t => t.source === 'payroll');

  const r1 = await J('POST', '/api/payroll-runs', { period: 'July 2026', idempotency_key: 'm14-run' });
  await J('PUT', '/api/payroll-runs/' + r1.id + '/approve', {});
  eq('approved (not paid) run → no personal salary row', (await salaryRows()).length, 0, 0);

  const paid = await J('PUT', '/api/payroll-runs/' + r1.id + '/mark-paid', {});
  let rows = await salaryRows();
  eq('mark-paid → one personal salary row', rows.length, 1, 0);
  eq('row amount = owner NET pay (not gross 4,000, not employee 1,900, not roster 3,333)', rows[0] && Number(rows[0].amount), 3600, undefined);
  eq('row is income', rows[0] && rows[0].tx_type, 'income');
  eq('row currency = the business currency (TTD, not the USD default)', rows[0] && rows[0].currency, 'TTD', 'USD');
  const paidYmd = String(paid.paid_date || '').slice(0, 10);
  eq('row dated the run paid date', rows[0] && String(rows[0].tx_date).slice(0, 10), paidYmd);

  await J('PUT', '/api/payroll-runs/' + r1.id + '/mark-paid', {});
  eq('repeat mark-paid books nothing new', (await salaryRows()).length, 1, 2);

  const { runRecurringScheduler } = require('../../server.js');
  await runRecurringScheduler();
  const all = await J('GET', '/api/personal-transactions');
  eq('scheduler: the owner-salary (roster) profile materialises nothing', all.filter(t => Number(t.amount) === 3333).length, 0, 1);
  A('scheduler: an ordinary recurring profile still materialises (control)', all.some(t => Number(t.amount) === 250 && t.description === 'Side gig'), JSON.stringify(all.map(t => [t.description, t.amount])));

  await J('PUT', '/api/payroll-runs/' + r1.id + '/void', {});
  eq('void removes the run\'s personal salary row', (await salaryRows()).length, 0);
  const { rows: [still] } = await c.query(`SELECT COUNT(*)::int AS n FROM recurring_personal_transactions WHERE id = $1 AND user_id = $2`, [prof.id, uid]);
  eq('the legacy profile row itself is left untouched (Rule 8)', still.n, 1);
});
