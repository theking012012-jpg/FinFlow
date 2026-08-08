'use strict';
/**
 * verify-f106-void-delete.js — PROVE (Rule 14) the HYBRID remove-a-run design:
 *   - VOID an approved run → status 'voided', and it DROPS FROM THE BOOKS (recognition removed:
 *     P&L payroll goes from 5000 → 0) while the row still exists (visible in history); audit-logged.
 *   - DELETE a DRAFT run → row AND its lines gone; audit-logged.
 *   - Guards: DELETE on a non-draft → 409; VOID on a draft → 409.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f106-void-delete.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f106@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  const plExpenses = async (http) => {
    const pl = await http.post('/api/reports/profit-loss', {});
    const rows = (pl.json && Array.isArray(pl.json.rows)) ? pl.json.rows : [];
    return rows.reduce((s, r) => s + (parseFloat(r.expenses) || 0), 0);
  };
  const mkRun = async (c, uid, period, status) => {
    const id = (await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
       VALUES ($1, NULL, $2, $3, $4, 5000, 0, 5000) RETURNING id`,
      [uid, period, period + '-15', status])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime) VALUES ($1, 5000, 0, 0)`, [id]);
    return id;
  };
  const auditActions = async (c, uid, recId) =>
    (await c.query(`SELECT action FROM audit_trail WHERE user_id=$1 AND table_name='payroll_runs' AND record_id=$2`, [uid, recId])).rows.map(r => r.action);

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F106', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;

    const approvedId = await mkRun(c, uid, '2026-06', 'approved');
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // ── VOID an approved run: recognition removed, row survives, audit-logged ──
    A('approved run IS recognised (P&L expenses = 5000 before void)', Math.abs((await plExpenses(http)) - 5000) < 0.005);
    const v = await http.put(`/api/payroll-runs/${approvedId}/void`, {});
    A('void approved → 200 status=voided', v.status === 200 && v.json.status === 'voided', `status ${v.status} / ${v.json && v.json.status}`);
    A('after void, P&L payroll DROPS OUT of the books (expenses = 0)', Math.abs((await plExpenses(http)) - 0) < 0.005,
      `expenses now ${await plExpenses(http)}`);
    const stillThere = (await c.query(`SELECT status FROM payroll_runs WHERE id=$1`, [approvedId])).rows[0];
    A('voided run STILL EXISTS (not deleted, stays visible in history)', !!stillThere && stillThere.status === 'voided');
    A('void was audit-logged (VOID action on the run)', (await auditActions(c, uid, approvedId)).includes('VOID'));

    // ── DELETE a draft: row + lines gone, audit-logged ──
    const draftId = await mkRun(c, uid, '2026-07', 'draft');
    const del = await http.del(`/api/payroll-runs/${draftId}`);
    A('delete draft → 200', del.status === 200, `status ${del.status}`);
    A('draft run row gone', (await c.query(`SELECT 1 FROM payroll_runs WHERE id=$1`, [draftId])).rows.length === 0);
    A('draft run lines gone (FK cleanup)', (await c.query(`SELECT 1 FROM payroll_run_lines WHERE run_id=$1`, [draftId])).rows.length === 0);
    A('delete was audit-logged (DELETE action on the run)', (await auditActions(c, uid, draftId)).includes('DELETE'));

    // ── Guards ──
    const delApproved = await http.del(`/api/payroll-runs/${approvedId}`);
    A('delete a non-draft (voided) run → 409 (must void, never delete recognised)', delApproved.status === 409, `status ${delApproved.status}`);
    const draft2 = await mkRun(c, uid, '2026-08', 'draft');
    const voidDraft = await http.put(`/api/payroll-runs/${draft2}/void`, {});
    A('void a draft → 409 (delete it instead)', voidDraft.status === 409, `status ${voidDraft.status}`);

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
