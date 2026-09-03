'use strict';
/**
 * verify-fh1-payroll-in-opex.js — F-H1. A paid/approved payroll run must be included in Expenses (opex)
 * and reduce Net Profit. The client stores the run `period` as a DISPLAY string ("July 2026"), and the
 * server's old `period.slice(0,7)+'-01'` produced "July 2-01" (invalid) so the run matched no period and
 * fell out of opex — Net Profit was overstated by the payroll amount.
 *
 * EXECUTED against real Postgres + real /api/reports. Discriminating (Rule 14): pre-fix expenses=100
 * (payroll dropped), netProfit=9900; post-fix expenses=7100, netProfit=2900. Clock 2026-07-25.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fh1-payroll-in-opex.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const FinFlowDates = require(path.join(process.cwd(), 'public', 'finflow-dates.js'));

const OWNER = { email: 'fh1-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const AS = (n, ok, d) => A('[STRUCTURAL] ' + n, ok, d);
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'FH1 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]
    )).rows[0].id;
    const E = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'USD Co', currency: 'USD', is_active: 1, sort_order: 0 }])).rows[0].id;

    await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, E, { user_id: uid, client: 'BigClient', amount: 10000, status: 'pending', issue_date: '2026-07-05', due_date: '2026-08-05' }]);
    await c.query(`INSERT INTO expenses (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, E, { user_id: uid, description: 'Rent', amount: 100, category: 'Rent', edate: '2026-07-10', date: '2026-07-10' }]);

    const runId = (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid, E, 'July 2026', '2026-07-25', 'paid', 7000, 0, 7000]
    )).rows[0].id;
    await c.query(
      `INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay)
       VALUES ($1,NULL,$2,$3,0,0,'[]'::jsonb,$4)`,
      [runId, 'Jane Doe', 7000, 7000]
    );
    const draftId = (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid, E, 'July 2026', '2026-07-25', 'draft', 5000, 0, 5000]
    )).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,NULL,$2,$3,0,0,'[]'::jsonb,$4)`,
      [draftId, 'Draft Emp', 5000, 5000]);

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const rep = (await http.get('/api/reports')).json;
    A('expenses INCLUDES payroll: 100 + 7000 = 7100', Number(rep.expenses) === 7100, `expenses=${rep.expenses}`);
    A('draft run excluded (not 12100)', Number(rep.expenses) !== 12100, `expenses=${rep.expenses}`);
    A('netProfit = 10000 − 7100 = 2900 (payroll reduces it)', Number(rep.netProfit) === 2900, `netProfit=${rep.netProfit}`);
    A('regression guard: netProfit is NOT 9900 (payroll-excluded value)', Number(rep.netProfit) !== 9900, `netProfit=${rep.netProfit}`);

    // F-D1: the SAME period-parse bug created a stray "Jul \'01" bucket in the P&L monthly chart.
    // Confirm the profit-loss monthly rows bucket payroll into the correct month with no stray-year bucket.
    const pl = (await http.post('/api/reports/profit-loss', {})).json;
    const plRows = Array.isArray(pl.rows) ? pl.rows : [];
    A("[F-D1] P&L monthly rows have NO stray-year bucket (no \"Jul '01\")", !plRows.some(r => /'0[0-9]$/.test(String(r.month||''))), 'months='+JSON.stringify(plRows.map(r=>r.month)));
    const julRow = plRows.find(r => String(r.month||'').startsWith("Jul '26"));
    A("[F-D1] payroll bucketed into Jul '26 (expenses >= 7000)", julRow && Number(julRow.expenses) >= 7000, 'julRow='+JSON.stringify(julRow));

    A("payrollPeriodYmd('July 2026') === '2026-07-01'", FinFlowDates.payrollPeriodYmd('July 2026') === '2026-07-01');
    A("payrollPeriodYmd('2026-07') === '2026-07-01' (machine format still ok)", FinFlowDates.payrollPeriodYmd('2026-07') === '2026-07-01');

    const srv = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
    AS('server _payDate uses FinFlowDates.payrollPeriodYmd', /_payDate = l => FinFlowDates\.payrollPeriodYmd/.test(srv));
    AS('server monthly chart uses payrollPeriodYmd', /bump\(FinFlowDates\.payrollPeriodYmd\(l\.period/.test(srv));
    const am = fs.readFileSync(path.join(process.cwd(), 'public', 'app-main.js'), 'utf8');
    AS('client computeExpenseBreakdown uses payrollPeriodYmd', /payrollPeriodYmd\(r\.period, r\.run_date\)/.test(am));
    AS('no stale period.slice(0,7) payroll parse remains (server)', !/period\)\.slice\(0, 7\) \+ '-01'/.test(srv));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-H1 payroll in opex/net profit)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
