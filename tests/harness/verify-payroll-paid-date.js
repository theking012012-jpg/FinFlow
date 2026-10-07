'use strict';
/**
 * verify-payroll-paid-date.js — Phase 1.1 / L7 (F122 follow-up, F85 family). A payroll run's CASH leaves when it
 * is marked PAID. mark-paid recorded no date, so both cash surfaces dated the payment by `run_date` — the run's
 * CREATION instant:
 *   GL `payroll_paid` entry (Dr 2200 / Cr Cash)           dated run_date
 *   POST /api/reports/cash-flow paid-payroll outflow       keyed on run_date
 * A run created 30 May and paid on 25 July showed its cash leaving in MAY.
 *
 * Fix under test: mark-paid stamps `paid_date` = the business's calendar date (entityTodayYmd — a genuine
 * timestamp resolved in the entity's timezone, Rule 10) once; both cash surfaces read it. Rows paid before the
 * column existed have paid_date NULL and keep the old run_date dating (no data is changed — Rule 8).
 *
 * Seed: one employee (gross 100). Run A: period 2026-05, run_date 2026-05-30, bonus 200 ⇒ 300, marked paid today
 * (2026-07-25, pinned). Run B (legacy): period 2026-04, run_date 2026-04-28, bonus 50 ⇒ 150, marked paid then its
 * paid_date cleared to NULL (as a pre-column row). Hand-computed cash-flow outflows:
 *   Apr 150 (legacy, run_date) · Jul 300 (paid today)            BUG: Apr 150 · May 300
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-payroll-paid-date.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L7 — paid payroll cash is dated when it is paid, not when the run was created\n' + '='.repeat(78) + '\n');
    const email = 'paiddate@finflow.test';
    await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.41' });
    A('login', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
    const ent = J(await http.post('/api/entities', { name: 'Paid Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
    J(await http.post('/api/entities/' + ent.id + '/activate', {}));
    const emp = J(await http.post('/api/payroll', { fname: 'Pat', lname: 'Day', gross: 100, deductions: [] }));

    const runB = J(await http.post('/api/payroll-runs', { period: '2026-04', bonus_overrides: { [emp.id]: 50 } }));
    await c.query(`UPDATE payroll_runs SET run_date='2026-04-28' WHERE id=$1`, [runB.id]);
    J(await http.put('/api/payroll-runs/' + runB.id + '/approve', {}));
    J(await http.put('/api/payroll-runs/' + runB.id + '/mark-paid', {}));
    // legacy row: paid before paid_date existed (tolerate the column being absent on pre-fix code)
    await c.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_runs' AND column_name='paid_date')
                   THEN EXECUTE 'UPDATE payroll_runs SET paid_date = NULL WHERE id = ${runB.id}'; END IF; END $$;`);

    const runA = J(await http.post('/api/payroll-runs', { period: '2026-05', bonus_overrides: { [emp.id]: 200 } }));
    await c.query(`UPDATE payroll_runs SET run_date='2026-05-30' WHERE id=$1`, [runA.id]);
    J(await http.put('/api/payroll-runs/' + runA.id + '/approve', {}));
    const paid = J(await http.put('/api/payroll-runs/' + runA.id + '/mark-paid', {}));
    A('mark-paid stamps paid_date = the business\'s today (2026-07-25)', String(paid.paid_date || '').slice(0, 10) === '2026-07-25', 'paid_date=' + paid.paid_date);
    const again = J(await http.put('/api/payroll-runs/' + runA.id + '/mark-paid', {}));
    A('re-marking paid keeps the first paid_date (idempotent)', String(again.paid_date || '').slice(0, 10) === '2026-07-25', 'paid_date=' + again.paid_date);

    const glDate = async id => { const { rows } = await c.query(`SELECT entry_date::text d FROM ledger_entries WHERE source_type='payroll_paid' AND source_id=$1 AND reversal_of IS NULL`, [id]); return rows[0] && rows[0].d; };
    A('GL payroll_paid entry for run A dated 2026-07-25 (bug: 2026-05-30)', (await glDate(runA.id)) === '2026-07-25', 'entry_date=' + (await glDate(runA.id)));
    // Legacy GL path: a run paid before the column existed has paid_date NULL and was posted by old code. The
    // path that still dates such a row is the GL BACKFILL (re-posts a missing entry) — drop run B's paid entry
    // and backfill: it must fall back to run_date (2026-04-28).
    await c.query(`DELETE FROM ledger_lines WHERE entry_id IN (SELECT id FROM ledger_entries WHERE source_type='payroll_paid' AND source_id=$1)`, [runB.id]);
    await c.query(`DELETE FROM ledger_entries WHERE source_type='payroll_paid' AND source_id=$1`, [runB.id]);
    const bf = await http.post('/api/gl/backfill', {});
    A('GL backfill ran (2xx)', bf.status >= 200 && bf.status < 300, 'status=' + bf.status + ' ' + String(bf.text).slice(0, 160));
    A('GL backfill dates legacy run B (no paid_date) by run_date 2026-04-28', (await glDate(runB.id)) === '2026-04-28', 'entry_date=' + (await glDate(runB.id)));
    A('GL backfill leaves run A\'s paid entry on its paid_date 2026-07-25', (await glDate(runA.id)) === '2026-07-25', 'entry_date=' + (await glDate(runA.id)));

    const cf = J(await http.post('/api/reports/cash-flow?period=year&fyStart=0', {}));
    const out = k => { const r = (cf.rows || []).find(x => x.key === k); return r ? r.outflow : 0; };
    A('cash-flow: Jul outflow 300 (run A paid today; bug: 0)', near(out('2026-07'), 300), JSON.stringify(cf.rows));
    A('cash-flow: May outflow 0 (bug: 300 — the run\'s creation month)', near(out('2026-05'), 0), JSON.stringify(cf.rows));
    A('cash-flow: Apr outflow 150 (legacy run, run_date fallback)', near(out('2026-04'), 150), JSON.stringify(cf.rows));
    const bs = J(await http.post('/api/reports/balance-sheet', {}));
    A('balance-sheet cash == cash-flow net (−450)', near(bs.cash, -450) && near((cf.totalInflow || 0) - (cf.totalOutflow || 0), -450), 'bs=' + bs.cash + ' cf=' + ((cf.totalInflow || 0) - (cf.totalOutflow || 0)));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (payroll paid date)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main();
