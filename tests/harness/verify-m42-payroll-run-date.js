'use strict';
/**
 * M42 (money audit 2026-10-09): POST /api/payroll-runs stores the run date the owner submitted.
 * BUG: run_date = NOW() (the server's UTC day); the modal's date was ignored.
 * Seed: run for "June 2026" submitted with run_date 2026-06-30. correct 2026-06-30 · bug: the real server day.
 * A run without a date gets the ENTITY's today (the pinned clock's 2026-07-25 in a UTC entity).
 */
const { run } = require('./moneyFixKit.js');

run('M42 — a payroll run keeps its submitted run date', async ({ newOwner, c, eq }) => {
  const { J } = await newOwner('M42');
  await J('POST', '/api/payroll', { fname: 'Pat', lname: 'Roe', gross: 1000 });
  const r1 = await J('POST', '/api/payroll-runs', { period: 'June 2026', run_date: '2026-06-30' });
  const { rows: [a] } = await c.query(`SELECT run_date::text AS d FROM payroll_runs WHERE id = $1`, [r1.id]);
  const { rows: [{ today }] } = await c.query(`SELECT CURRENT_DATE::text AS today`);
  eq('submitted run date is stored', a.d, '2026-06-30', today);
  const r2 = await J('POST', '/api/payroll-runs', { period: 'July 2026' });
  const { rows: [b] } = await c.query(`SELECT run_date::text AS d FROM payroll_runs WHERE id = $1`, [r2.id]);
  eq("no date ⇒ the entity's today", b.d, '2026-07-25', today);
});
