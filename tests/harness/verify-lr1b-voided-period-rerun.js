'use strict';
/**
 * verify-lr1b-voided-period-rerun.js — LR1 improvement (owner decision 2026-10-21: "void, then re-run", better and
 * more secure). A period whose payroll run was voided may be run again; the new run names the voided run it replaces;
 * the database still allows only ONE LIVE run per period.
 *
 * Real scratch Postgres with production's two payroll-index migrations applied IN ORDER (2026-07-25 all-status period
 * index, then 2026-10-21 live-only index), real routes. What each earlier version gives (Rule 4):
 *   1. voided Dec run, new Dec run      → 201, replaces_run_id = the voided run   (main: 500 · 4de29ba: 409)
 *   2. another new Dec run (new token)  → 200 already_exists, the REPLACEMENT run  (picking the voided one: 409)
 *   3. the same token retried           → 200, the original replacement run
 *   4. a second LIVE Dec row inserted directly in SQL → refused by the database (23505) — the guarantee is at the
 *      write, not in the route (Rule 9)
 *   5. the runs list and the audit row both carry replaces_run_id
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lr1b-voided-period-rerun.js
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./moneyFixKit.js');
const MIG = f => fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'migrations', f), 'utf8');

run('LR1b — a voided period can be run again, once, and the new run names the one it replaces', async ({ newOwner, c, eq }) => {
  await c.query(MIG('2026-07-25-payroll-runs-uniq.sql'));
  await c.query(MIG('2026-10-21-payroll-runs-live-period-uniq.sql'));
  const idx = (await c.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'payroll_runs' AND indexname IN ('idx_payroll_runs_uniq','idx_payroll_runs_live_period') ORDER BY 1`)).rows.map(r => r.indexname);
  eq('migrations: the all-status index is replaced by the live-only one', idx, ['idx_payroll_runs_live_period'], ['idx_payroll_runs_uniq']);

  const { uid, http, J } = await newOwner('LR1b', [{ name: 'Northwind LR1b', currency: 'USD' }]);
  await J('POST', '/api/payroll', { fname: 'Jordan', lname: 'Lee', gross: 3000, deductions: [] });
  const post = (period, key) => http.request('POST', '/api/payroll-runs', { period, idempotency_key: key, run_date: '2026-07-25' });

  const dec = await J('POST', '/api/payroll-runs', { period: 'December 2026', idempotency_key: 'lr1b-dec-1' });
  await J('PUT', '/api/payroll-runs/' + dec.id + '/approve', {});
  await J('PUT', '/api/payroll-runs/' + dec.id + '/void', {});

  const r1 = await post('December 2026', 'lr1b-dec-2');
  eq('1. voided period → a new run (201) that names the voided run it replaces',
    [r1.status, r1.json && r1.json.replaces_run_id, r1.json && r1.json.status], [201, dec.id, 'draft'], [409, undefined, undefined]);
  const statuses = (await c.query(`SELECT status FROM payroll_runs WHERE user_id = $1 AND period = 'December 2026' ORDER BY id`, [uid])).rows.map(r => r.status);
  eq('   …the voided run is kept beside it', statuses, ['voided', 'draft']);

  const r2 = await post('December 2026', 'lr1b-dec-3');
  eq('2. another new run for December → 200 already_exists, the REPLACEMENT run (not the voided one)',
    [r2.status, r2.json && r2.json.id, r2.json && r2.json.already_exists], [200, r1.json && r1.json.id, true], [409, undefined, undefined]);

  const r3 = await post('December 2026', 'lr1b-dec-2');
  eq('3. the same token retried → 200, the original replacement run', [r3.status, r3.json && r3.json.id, r3.json && r3.json.already_exists], [200, r1.json && r1.json.id, false]);

  let code = null;
  try { await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, status) SELECT user_id, entity_id, period, 'draft' FROM payroll_runs WHERE id = $1`, [r1.json.id]); }
  catch (e) { code = e.code; }
  eq('4. a second LIVE December run straight into the database is refused', code, '23505', null);

  const list = await J('GET', '/api/payroll-runs');
  eq('5. the runs list carries replaces_run_id', (list.find(r => r.id === r1.json.id) || {}).replaces_run_id, dec.id);
  const aud = (await c.query(`SELECT new_data FROM audit_trail WHERE table_name = 'payroll_runs' AND record_id = $1 AND action = 'CREATE'`, [r1.json.id])).rows[0];
  eq('5. …and so does its audit row', aud && aud.new_data && aud.new_data.replaces_run_id, dec.id);
});
