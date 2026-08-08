'use strict';
/**
 * verify-f79-status-constraints.js — PROVE (Rule 14) the F79 two-layer status guard on the money
 * tables: (1) the APP rejects an unknown status with 400 (invoices/bills create+edit), and (2) the
 * DATABASE rejects it as a backstop even when the app is bypassed (raw INSERT). Both are asserted
 * against VALID-status controls so the checks discriminate the status, not some blanket failure.
 *
 * EXECUTED FAILURE PATH (Rule 14): for the DB layer we DROP the constraint and show the same bad
 * INSERT then SUCCEEDS — proving the constraint is the thing doing the rejecting, not something else.
 * Mixed-case ('Open') is asserted to PASS, proving the case-insensitive lower() clause.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f79-status-constraints.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f79@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  const idOf = j => (j && (j.id ?? j._dbId));
  // raw INSERT helper: returns null on success, or the SQLSTATE code on rejection.
  const tryInsert = async (c, sql, params) => { try { await c.query(sql, params); return null; } catch (e) { return e.code || String(e.message); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F79', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // ── LAYER 1: app-layer validation ──────────────────────────────────────────
    // valid controls (must succeed) — proves the routes work for good input
    const okInv = await http.post('/api/invoices', { client: 'C', amount: 100, status: 'pending' });
    A('invoice create with valid status -> 2xx (control)', okInv.status < 400, `status=${okInv.status}`);
    const invId = idOf(okInv.json);
    const okBill = await http.post('/api/bills', { vendor: 'V', amount: 100, status: 'unpaid' });
    A('bill create with valid status -> 2xx (control)', okBill.status < 400, `status=${okBill.status}`);
    const billId = idOf(okBill.json);

    // invalid (must be rejected 400) — the fix
    A('invoice create status=final -> 400', (await http.post('/api/invoices', { client: 'C', amount: 100, status: 'final' })).status === 400);
    A('invoice edit   status=final -> 400', (await http.put(`/api/invoices/${invId}`, { status: 'final' })).status === 400);
    A('bill create    status=final -> 400', (await http.post('/api/bills', { vendor: 'V', amount: 100, status: 'final' })).status === 400);
    A('bill edit      status=final -> 400', (await http.put(`/api/bills/${billId}`, { status: 'final' })).status === 400);

    // ── LAYER 2: DB backstop (bypass the app entirely with a raw INSERT) ─────────
    // payroll_runs (real column): valid ok, invalid rejected
    A('DB accepts payroll_runs status=approved (control)',
      null === await tryInsert(c, `INSERT INTO payroll_runs (user_id, status, period, run_date, total_gross, total_deductions, total_net) VALUES ($1,'approved','2026-06','2026-06-15',0,0,0)`, [uid]));
    A('DB REJECTS payroll_runs status=final (23514)',
      '23514' === await tryInsert(c, `INSERT INTO payroll_runs (user_id, status, period, run_date, total_gross, total_deductions, total_net) VALUES ($1,'final','2026-06','2026-06-15',0,0,0)`, [uid]));
    // invoices (JSONB): valid ok, invalid rejected
    A('DB REJECTS invoices data.status=final (23514)',
      '23514' === await tryInsert(c, `INSERT INTO invoices (user_id, data) VALUES ($1, '{"status":"final","amount":100}'::jsonb)`, [uid]));
    // case-insensitive: mixed-case 'Open' must PASS on credit_notes
    A('DB accepts credit_notes data.status=Open (case-insensitive lower())',
      null === await tryInsert(c, `INSERT INTO credit_notes (user_id, data) VALUES ($1, '{"status":"Open"}'::jsonb)`, [uid]));
    // NULL/absent status must PASS
    A('DB accepts invoices with NO status key (NULL allowed)',
      null === await tryInsert(c, `INSERT INTO invoices (user_id, data) VALUES ($1, '{"amount":50}'::jsonb)`, [uid]));

    // ── EXECUTED FAILURE PATH (Rule 14): drop the constraint, show the bad INSERT then succeeds ──
    await c.query(`ALTER TABLE invoices DROP CONSTRAINT chk_invoices_status`);
    A('control: WITHOUT the constraint, invoices status=final is ACCEPTED (proves the constraint rejects it)',
      null === await tryInsert(c, `INSERT INTO invoices (user_id, data) VALUES ($1, '{"status":"final","amount":100}'::jsonb)`, [uid]));

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
