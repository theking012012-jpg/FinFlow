'use strict';
/**
 * verify-f90-phaseB-coverage.js — PROVE (Rule 14) that the money-movement mutations now write to the
 * audit trail: bills / payments-received / payments-made / credit-notes / vendor-credits /
 * sales-receipts CREATE, and payroll APPROVE + MARK_PAID. Pre-Phase-B none of these were logged.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90-phaseB-coverage.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f90b@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F90B', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    // F150 seed-debt fix: create an active entity so req.entityId resolves (production onboarding
    // POSTs /api/entities); without it, business-route writes stamp entity_id NULL → chk_*_entity_nn.
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { name: 'F90B Co', currency: 'USD', is_active: 1 }]);
    // F86 (2026-08-26): payments_received standalone WRITES are retired 410-by-default behind
    // FF_PR_WRITES (server.js:2788), but the audit code is DELIBERATELY LEFT LIVE for the reversible
    // path (server.js:2783). This harness proves money-movement CREATEs are audited, payments_received
    // among them, so we exercise the reversible path to keep that coverage; the default-410 gate proof
    // lives in verify-c1-payments-received.js. The server reads the flag at request time.
    process.env.FF_PR_WRITES = '1';
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    const bill = await http.post('/api/bills', { vendor: 'V', amount: 500 });
    const billId = bill.json.id ?? bill.json._dbId;
    await http.post('/api/payments-received', { customer: 'C', amount: 100 });
    await http.post('/api/sales-receipts', { customer: 'C', amount: 50, date: '2026-06-10' });
    await http.post('/api/credit-notes', { customer: 'C', amount: 30 });
    await http.post('/api/vendor-credits', { vendor: 'V', amount: 20 });
    await http.post('/api/payments-made', { vendor: 'V', amount: 200, bill_id: billId });

    // payroll: seed a draft run + line, then approve + mark-paid
    const runId = (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1,NULL,'2026-06','2026-06-15','draft',1000,0,1000) RETURNING id`, [uid])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime) VALUES ($1,1000,0,0)`, [runId]);
    await http.put(`/api/payroll-runs/${runId}/approve`, {});
    await http.put(`/api/payroll-runs/${runId}/mark-paid`, {});

    const rows = (await c.query(`SELECT table_name, action FROM audit_trail WHERE user_id=$1`, [uid])).rows;
    const has = (t, a) => rows.some(r => r.table_name === t && r.action === a);
    const expect = [
      ['bills', 'CREATE'], ['payments_received', 'CREATE'], ['sales_receipts', 'CREATE'],
      ['credit_notes', 'CREATE'], ['vendor_credits', 'CREATE'], ['payments_made', 'CREATE'],
      ['payroll_runs', 'APPROVE'], ['payroll_runs', 'MARK_PAID'],
    ];
    for (const [t, a] of expect) A(`${t} ${a} is audited`, has(t, a), `trail has: ${JSON.stringify(rows.map(r => r.table_name + '/' + r.action))}`);

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
