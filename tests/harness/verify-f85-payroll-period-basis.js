'use strict';
/**
 * verify-f85-payroll-period-basis.js — PROVE (Rule 14) that payroll is recognised in the PERIOD THE
 * RUN IS FOR (accrual), not run_date (creation time), and DISCRIMINATE (Rule 4) with a run whose
 * period and run_date fall in DIFFERENT months.
 *
 * Seed: one APPROVED run, period '2026-06', but run_date '2026-07-02' (created in July), one line
 * gross 5000. No other expenses, so a month's P&L expenses == its payroll.
 *
 * Expected WITH fix (period):   June expenses = 5000, July expenses = 0.
 * Pre-fix (run_date):           June expenses = 0,    July expenses = 5000.  ← the misfile.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f85-payroll-period-basis.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f85@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F85', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;

    // Run FOR June, CREATED in July.
    const runId = (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1, NULL, '2026-06', '2026-07-02 12:00:00', 'approved', 5000, 0, 5000) RETURNING id`, [uid]
    )).rows[0].id;
    await c.query(
      `INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime) VALUES ($1, 5000, 0, 0)`, [runId]);

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    const pl = await http.post('/api/reports/profit-loss', {});
    const rows = (pl.json && Array.isArray(pl.json.rows)) ? pl.json.rows : [];
    const jun = rows.find(r => r.key === '2026-06');
    const jul = rows.find(r => r.key === '2026-07');
    const junExp = jun ? jun.expenses : 0;
    const julExp = jul ? jul.expenses : 0;

    A('June P&L expenses = 5000 (payroll files into the month it is FOR) [pre-fix: 0]',
      Math.abs(junExp - 5000) < 0.005, `June expenses = ${junExp}`);
    A('July P&L expenses = 0 (NOT the creation month) [pre-fix: 5000]',
      Math.abs(julExp - 0) < 0.005, `July expenses = ${julExp}`);

    // computeBooks year total still 5000 (June ∈ FY) — sanity that recognition didn't vanish.
    const rep = await http.get('/api/reports');
    A('year Expenses still includes the 5000 (recognition preserved, only its MONTH moved)',
      rep.status === 200 && (parseFloat(rep.json.totalExpenses || rep.json.expenses || 0) >= 5000 ||
        (rep.json.parts && Math.abs((rep.json.parts.payroll || 0) - 5000) < 0.005)),
      JSON.stringify({ totalExpenses: rep.json && rep.json.totalExpenses, expenses: rep.json && rep.json.expenses }));

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
