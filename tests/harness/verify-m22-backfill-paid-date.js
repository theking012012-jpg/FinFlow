'use strict';
/**
 * M22 (money audit 2026-10-09): rebuilding the ledger (POST /api/gl/backfill?reset=1) must keep a paid payroll
 * run's cash-out at its PAID date. BUG: the backfill query did not select paid_date, so the cash-out fell back
 * to run_date. Seed: a June run created (run_date) 2026-06-28, paid (paid_date) 2026-07-03.
 *   correct cash-out ledger date 2026-07-03 before AND after the rebuild; bug after rebuild: 2026-06-28.
 */
const { run } = require('./moneyFixKit.js');

run('M22 — ledger rebuild keeps payroll cash-out at the paid date', async ({ newOwner, c, eq }) => {
  const { uid, J } = await newOwner('M22');
  await J('POST', '/api/payroll', { fname: 'Pat', lname: 'Roe', gross: 1200 });
  const r = await J('POST', '/api/payroll-runs', { period: 'June 2026' });
  await J('PUT', '/api/payroll-runs/' + r.id + '/approve', {});
  await J('PUT', '/api/payroll-runs/' + r.id + '/mark-paid', {});
  // Distinct dates so the source of the cash-out date is identifiable (Rule 4).
  await c.query(`UPDATE payroll_runs SET run_date = '2026-06-28', paid_date = '2026-07-03' WHERE id = $1`, [r.id]);
  await J('POST', '/api/gl/backfill?reset=1', {});
  const { rows: [gl] } = await c.query(`SELECT entry_date::text AS d FROM ledger_entries WHERE user_id=$1 AND source_type='payroll_paid' AND source_id=$2 AND reversal_of IS NULL AND status='posted'`, [uid, r.id]);
  eq('payroll cash-out ledger date after a rebuild', gl && gl.d, '2026-07-03', '2026-06-28');
  const cf = await J('POST', '/api/reports/cash-flow', {});
  const jul = (cf.rows || []).find(x => x.key === '2026-07');
  eq('cash-flow report places the 1,200 in July (control: reads paid_date directly)', jul && jul.outflow, 1200);
});
