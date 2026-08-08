'use strict';
/**
 * verify-f33c-payroll-buckets.js — PROVE (Rule 14/6) that /api/reports/profit-loss monthly rows now
 * bucket PAYROLL, so Σ monthly-expenses reconciles with the Expenses KPI (computeBooks.opex). Owner
 * oracle (hand-computed, independent of the code): one $100 expense + one APPROVED payroll run whose
 * lines total $500 gross → expenses must total 600. A DRAFT run of 999 must be EXCLUDED (basis-C /
 * F80 status gate), so it must NOT move the total. Pre-fix (no payroll bump) the total was 100.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f33c-payroll-buckets.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f33c@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F33C', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { name: 'F33C Co', currency: 'USD', is_active: 1 }]);
    // one expense: 100, June
    await c.query(`INSERT INTO expenses (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { description: 'Rent', category: 'Other', amount: 100, deductible: 'no', expense_date: '2026-06-10' }]);
    // APPROVED payroll run, June, lines total 500 (300 + 200 gross)
    const runId = (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1,NULL,'2026-06','2026-06-15','approved',500,0,500) RETURNING id`, [uid])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime, net_pay) VALUES ($1,300,0,0,300),($1,200,0,0,200)`, [runId]);
    // DRAFT run, June, lines 999 — MUST be excluded from the expense total
    const draftId = (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1,NULL,'2026-06b','2026-06-20','draft',999,0,999) RETURNING id`, [uid])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime, net_pay) VALUES ($1,999,0,0,999)`, [draftId]);

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}`);

    const pl = await http.post('/api/reports/profit-loss', {});
    const rows = Array.isArray(pl.json) ? pl.json : (pl.json?.rows || pl.json?.months || []);
    const sumExp = rows.reduce((s, r) => s + (parseFloat(r.expenses) || 0), 0);
    A('Σ profit-loss monthly expenses = 600 (100 expense + 500 approved payroll; draft 999 excluded)',
      Math.round(sumExp * 100) / 100 === 600, `got ${sumExp} from ${rows.length} rows (pre-fix this was 100)`);

    // The approved payroll must land in June specifically (dated on run_date).
    const jun = rows.find(r => /Jun/.test(r.month) || r.key === '2026-06');
    A('payroll bucketed into June (its run_date month): June expenses = 600', jun && Math.round((parseFloat(jun.expenses) || 0) * 100) / 100 === 600,
      `June row = ${JSON.stringify(jun)}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
