'use strict';
/**
 * verify-lr1-payroll-period-collision.js — LR1 (live retest 2026-10-20): Run Payroll "December 2026" on Northwind →
 * POST /api/payroll-runs HTTP 500, twice. A VOIDED run #4 "December 2026" already existed on that business.
 *
 * Cause (read): the app ALWAYS sends an idempotency_key (index.html submitPayrollRun). A second run for a period hits
 * idx_payroll_runs_uniq (user, business, period) — not the token index. The 23505 recovery chose its lookup by "was a
 * token sent", so it looked the NEW token up, found nothing and re-threw → 500.
 *
 * Real scratch Postgres, real routes, the live shape. Each case states what the old code gives (Rule 4):
 *   A. voided Dec run exists, new Dec run (new token)  → 409 PERIOD_HAS_VOIDED_RUN naming run A, no new row   (old: 500)
 *   B. live Jan run exists, new Jan run (new token)     → 200, already_exists, the SAME run id, no new row    (old: 500)
 *   C. the same token retried                            → 200, the original run, already_exists false        (old: 200)
 *   D. a different period                                → 201, a new run                                     (old: 201)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lr1-payroll-period-collision.js
 */
const { run } = require('./moneyFixKit.js');

run('LR1 — a second run for a period never 500s; a voided period says so', async ({ newOwner, c, eq }) => {
  const { uid, http, J } = await newOwner('LR1', [{ name: 'Northwind LR1', currency: 'USD' }]);
  // The production index (scripts/migrations/2026-07-25-payroll-runs-uniq.sql) — created here in case the scratch
  // database's migration runner has not applied it.
  await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_uniq ON payroll_runs (user_id, COALESCE(entity_id, 0), period)`);
  await J('POST', '/api/payroll', { fname: 'Jordan', lname: 'Lee', gross: 3000, deductions: [] });
  const count = async p => (await c.query(`SELECT COUNT(*)::int n FROM payroll_runs WHERE user_id = $1 AND period = $2`, [uid, p])).rows[0].n;
  const post = (period, key) => http.request('POST', '/api/payroll-runs', { period, idempotency_key: key, run_date: '2026-07-25' });

  // The live shape: a December run, approved, then voided.
  const dec = await J('POST', '/api/payroll-runs', { period: 'December 2026', idempotency_key: 'lr1-dec-1' });
  await J('PUT', '/api/payroll-runs/' + dec.id + '/approve', {});
  await J('PUT', '/api/payroll-runs/' + dec.id + '/void', {});

  const a = await post('December 2026', 'lr1-dec-2');
  eq('A. voided period, new run → 409 PERIOD_HAS_VOIDED_RUN naming the voided run',
    [a.status, a.json && a.json.code, a.json && a.json.existing_run_id], [409, 'PERIOD_HAS_VOIDED_RUN', dec.id], [500, undefined, undefined]);
  eq('A. …and the message says what exists (no generic error)', /already has a voided payroll run/.test(a.json && a.json.error || ''), true, false);
  eq('A. no new run was created', await count('December 2026'), 1);

  const jan = await J('POST', '/api/payroll-runs', { period: 'January 2027', idempotency_key: 'lr1-jan-1' });
  const b = await post('January 2027', 'lr1-jan-2');
  eq('B. live run for the period, new token → 200 already_exists, the same run', [b.status, b.json && b.json.id, b.json && b.json.already_exists], [200, jan.id, true], [500, undefined, undefined]);
  eq('B. …with its lines (1 employee)', (b.json && b.json.lines || []).length, 1, 0);
  eq('B. no new run was created', await count('January 2027'), 1);

  const cRetry = await post('January 2027', 'lr1-jan-1');
  eq('C. same token retried → 200, the original run, not flagged already_exists', [cRetry.status, cRetry.json && cRetry.json.id, cRetry.json && cRetry.json.already_exists], [200, jan.id, false]);

  const d = await post('February 2027', 'lr1-feb-1');
  eq('D. a different period → 201, a new run', [d.status, await count('February 2027')], [201, 1]);
});
