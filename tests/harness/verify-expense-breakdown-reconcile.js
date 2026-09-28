'use strict';
/**
 * verify-expense-breakdown-reconcile.js — M1. The dashboard "Expense breakdown" widget must decompose
 * the SAME period-scoped Expenses KPI (opex = direct expenses + payroll + issued bills + orphan
 * payments − vendor credits), NOT just direct expense rows. Before the fix the breakdown summed only
 * direct expenses while the KPI carried payroll + bills, so the card read far below the headline and
 * `complete:true` (which only ever meant "FX rates covered", not "all expenses shown") made it look
 * reconciled when it was not.
 *
 * EXECUTED against real Postgres + real /api/reports. Discriminating (Rule 14): pre-fix
 * Σ(breakdown.rows) = 2500 (direct only) ≠ expenses KPI 11000, and there is no Payroll/Bills row;
 * post-fix Σ(rows) == 11000, total == 11000, with explicit Payroll (7000) and "Bills & vendors" (1500)
 * categories. Clock pinned 2026-07-25.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-expense-breakdown-reconcile.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'm1-breakdown@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'M1 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]
    )).rows[0].id;
    const E = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'USD Co', currency: 'USD', is_active: 1, sort_order: 0 }])).rows[0].id;

    // revenue (so the period is non-empty)
    await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, E, { user_id: uid, client: 'BigClient', amount: 20000, status: 'pending', issue_date: '2026-07-05', due_date: '2026-08-05' }]);
    // two direct expense categories -> direct total 2500
    await c.query(`INSERT INTO expenses (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, E, { user_id: uid, description: 'Office rent', amount: 2000, category: 'Rent', expense_date: '2026-07-10', date: '2026-07-10' }]);
    await c.query(`INSERT INTO expenses (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, E, { user_id: uid, description: 'SaaS tools', amount: 500, category: 'Software', expense_date: '2026-07-12', date: '2026-07-12' }]);
    // paid payroll run -> 7000
    const runId = (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid, E, 'July 2026', '2026-07-25', 'paid', 7000, 0, 7000]
    )).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,NULL,$2,$3,0,0,'[]'::jsonb,$4)`,
      [runId, 'Jane Doe', 7000, 7000]);
    // issued bill -> 1500
    await c.query(`INSERT INTO bills (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, E, { vendor: 'Acme Supplies', amount: 1500, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-15' }]);

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const rep = (await http.get('/api/reports')).json;
    const kpi = Number(rep.expenses);
    A('Expenses KPI = opex 11000 (2500 direct + 7000 payroll + 1500 bills)', kpi === 11000, `expenses=${kpi}`);

    const bd = rep.expenseBreakdown || {};
    const rows = Array.isArray(bd.rows) ? bd.rows : [];
    const sumRows = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    A('M1: sum(breakdown rows) == Expenses KPI (reconciles)', Math.abs(sumRows - kpi) < 0.01, `sumRows=${sumRows} kpi=${kpi} rows=${JSON.stringify(rows)}`);
    A('M1: breakdown.total == Expenses KPI', Math.abs(Number(bd.total) - kpi) < 0.01, `total=${bd.total} kpi=${kpi}`);
    A('M1: regression guard — sum(rows) is NOT the direct-only 2500', Math.abs(sumRows - 2500) > 0.01, `sumRows=${sumRows}`);

    const payrollRow = rows.find(r => r.category === 'Payroll');
    A('M1: Payroll appears as its own category (7000)', !!payrollRow && Math.abs(Number(payrollRow.amount) - 7000) < 0.01, `row=${JSON.stringify(payrollRow)}`);
    const billsRow = rows.find(r => r.category === 'Bills & vendors');
    A('M1: Bills & vendors appears as its own category (1500)', !!billsRow && Math.abs(Number(billsRow.amount) - 1500) < 0.01, `row=${JSON.stringify(billsRow)}`);
    A('M1: complete flag true (all FX legs covered, native identity)', bd.complete === true, `complete=${bd.complete}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (M1 expense breakdown reconciles to opex)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
