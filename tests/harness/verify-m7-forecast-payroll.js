'use strict';
/**
 * M7 (money audit 2026-10-09): the 13-week cash forecast must contain payroll.
 * BUG: /api/cashflow-forecast sourced AR, AP, recurring documents and an expense run-rate only — no payroll.
 * Seed (today pinned 2026-07-25 → horizon ends 2026-10-24). Roster: one employee at 3,000 / month.
 *   June run   — PAID (3,000)                      → already left the bank: NOT forecast
 *   July run   — APPROVED, bonus 500 (3,500)       → 3,500 at 2026-07-31 (read from the RUN LINES, not the roster)
 *   August     — DRAFT run, overtime 200 (3,200)   → 3,200 at 2026-08-31
 *   September  — no run                            → 3,000 roster estimate at 2026-09-30
 *   October    — month end 10-31 is past the horizon → nothing
 *   correct payroll outflow = 3,500 + 3,200 + 3,000 = 9,700        bug = 0
 *   (a roster-only reading would give 3 × 3,000 = 9,000; a version counting the paid June run would give 12,700)
 */
const { run } = require('./moneyFixKit.js');

run('M7 — the cash forecast includes payroll', async ({ newOwner, eq, A }) => {
  const { J } = await newOwner('M7');
  const emp = await J('POST', '/api/payroll', { fname: 'Pat', lname: 'Roe', gross: 3000 });
  const jun = await J('POST', '/api/payroll-runs', { period: 'June 2026' });
  await J('PUT', '/api/payroll-runs/' + jun.id + '/approve', {});
  await J('PUT', '/api/payroll-runs/' + jun.id + '/mark-paid', {});
  const jul = await J('POST', '/api/payroll-runs', { period: 'July 2026', bonus_overrides: { [emp.id]: 500 } });
  await J('PUT', '/api/payroll-runs/' + jul.id + '/approve', {});
  await J('POST', '/api/payroll-runs', { period: 'August 2026', overtime_overrides: { [emp.id]: 200 } });

  const f = await J('GET', '/api/cashflow-forecast');
  const items = (f.periods || []).flatMap(p => p.items || []).filter(i => i.direction === 'out' && /^payroll/.test(String(i.kind)));
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  eq('total payroll outflow in the 13-week forecast', total, 9700, 0);
  const by = Object.fromEntries(items.map(i => [i.date, [i.kind, i.amount]]));
  eq('July approved run: 3,500 at month end (run lines incl. bonus)', by['2026-07-31'], ['payroll', 3500]);
  eq('August draft run: 3,200 at month end', by['2026-08-31'], ['payroll', 3200]);
  eq('September: roster estimate 3,000', by['2026-09-30'], ['payroll_estimate', 3000]);
  A('the paid June run is not forecast again', !items.some(i => /June/.test(String(i.label))), JSON.stringify(items));
  eq('forecast summary total outflow (payroll is the only outflow seeded)', f.summary && f.summary.total_outflow, 9700, 0);
});
