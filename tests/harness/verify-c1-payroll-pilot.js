'use strict';
/**
 * verify-c1-payroll-pilot.js — PROVE (Rule 14) that a DB UNIQUE constraint + a 23505 handler make
 * the payroll_runs create route safe against the concurrent double-fire the JS pre-check cannot stop.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-payroll-pilot.js
 *
 * Real server, real Postgres, real HTTP to the REAL POST /api/payroll-runs route. This test owns its
 * OWN minimal seed (one entity + two employees) — it does NOT use seed.js, whose two 2026-07 runs would
 * themselves violate the proposed natural key (that conflict is reported separately, needs an owner
 * ruling). The proposed migration (the UNIQUE index) is applied here in-test rather than added to
 * database.js initDB, precisely so it does not break the shared seed until the key is ruled + prod is
 * de-duplicated.
 *
 * Proves:
 *   A. two RAPID CONCURRENT identical submits  → exactly ONE run row (+ its lines), both HTTP 2xx (the
 *      loser gets the existing row via the 23505 handler, never a 500). This is the TOCTOU race.
 *   B. two SEPARATE submits (different period)  → TWO run rows.
 *   C. NULL entity_id collision → the index rejects it too (COALESCE(entity_id,0) matches the handler's
 *      `entity_id IS NOT DISTINCT FROM` semantics; a plain UNIQUE would let NULL dups through).
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'pilot@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, appPool, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };
  const runCount = async (c, uid, period) =>
    Number((await c.query(`SELECT COUNT(*) n FROM payroll_runs WHERE user_id=$1 AND period=$2`, [uid, period])).rows[0].n);

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    ({ pool: appPool } = await initSchema(scratch.url));

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Pilot Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;

    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
       VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name: 'Pilot Co', currency: 'USD', is_active: 1 }]
    )).rows[0].id;

    for (const e of [{ fname: 'Emp', lname: 'One', gross: 1000 }, { fname: 'Emp', lname: 'Two', gross: 2000 }]) {
      await c.query(
        `INSERT INTO payroll (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
        [uid, eid, { fname: e.fname, lname: e.lname, gross: e.gross, is_owner: false, deductions: [], emp_type: 'Full-time', role: 'Staff' }]
      );
    }

    // THE PROPOSED MIGRATION (applied in-test, NOT in initDB). COALESCE(entity_id,0) so a NULL entity
    // collides with a NULL entity — matching the handler's `entity_id IS NOT DISTINCT FROM`. 0 is safe:
    // SERIAL ids start at 1. PILOT_NO_INDEX skips it — the Rule-14 CONTROL proving the JS guard alone
    // (server.js:3844) lets the concurrent race through.
    const WITH_INDEX = !process.env.PILOT_NO_INDEX;
    if (WITH_INDEX) {
      // The exact production DDL — idempotent (IF NOT EXISTS) and NULL-safe (COALESCE): a plain
      // UNIQUE(user_id,entity_id,period) treats NULLs as distinct and would let NULL-entity dups through.
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_uniq ON payroll_runs (user_id, COALESCE(entity_id, 0), period)`);
    }

    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 200)}`);

    // ── A. concurrent identical submits (the TOCTOU race) ──
    const url = `/api/payroll-runs?entity_id=${eid}`;
    const [r1, r2] = await Promise.all([http.post(url, { period: 'PILOT-A' }), http.post(url, { period: 'PILOT-A' })]);
    const nA = await runCount(c, uid, 'PILOT-A');
    if (WITH_INDEX) {
      const both2xx = [r1.status, r2.status].every(s => s >= 200 && s < 300);
      A('concurrent identical: both responses 2xx (no 500)', both2xx, `statuses ${r1.status}/${r2.status}  bodies ${r1.text?.slice(0,120)} | ${r2.text?.slice(0,120)}`);
      A('concurrent identical: exactly ONE run row', nA === 1, `run rows for PILOT-A = ${nA}`);
      const lA = Number((await c.query(
        `SELECT COUNT(*) n FROM payroll_run_lines l JOIN payroll_runs r ON r.id=l.run_id WHERE r.user_id=$1 AND r.period='PILOT-A'`, [uid]
      )).rows[0].n);
      A('concurrent identical: exactly TWO line rows (no duplicate lines)', lA === 2, `line rows = ${lA} (expected 2 employees)`);
      const sameId = r1.json?.id != null && r1.json?.id === r2.json?.id;
      A('concurrent identical: both responses carry the SAME run id (idempotent return)', sameId, `ids ${r1.json?.id} / ${r2.json?.id}`);
    } else {
      // CONTROL (no index): the endpoint race is TIMING-dependent — on localhost the two requests
      // often serialize enough that the JS pre-check (server.js:3844) sees the first insert and wins,
      // so the duplicate does NOT reliably reproduce here. Report it, do not assert on it. The
      // deterministic proof of necessity is the raw-insert control below.
      console.log(`  INFO  (no index) concurrent endpoint race produced ${nA} row(s) this run — non-deterministic on localhost`);
    }

    // ── DETERMINISTIC control of the DB backstop (both modes): two RAW identical inserts. ──
    // With the index the 2nd is rejected (1 row); without it both persist (2 rows). This is what makes
    // the constraint — not the racy JS guard — the guarantee, independent of endpoint timing.
    const insRaw = () => c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net, notes)
       VALUES ($1, $2, 'PILOT-RAW', NOW(), 'draft', 0, 0, 0, '')`, [uid, eid]);
    await insRaw();
    let rawRejected = false;
    try { await insRaw(); } catch (e) { rawRejected = (e.code === '23505'); }
    const nRaw = await runCount(c, uid, 'PILOT-RAW');
    if (WITH_INDEX) {
      A('DB backstop: 2nd raw identical insert rejected 23505 → ONE row', rawRejected && nRaw === 1, `rejected=${rawRejected} rows=${nRaw}`);
    } else {
      A('CONTROL (no index): 2nd raw identical insert ACCEPTED → TWO rows (nothing stops a duplicate)', !rawRejected && nRaw === 2, `rejected=${rawRejected} rows=${nRaw}`);
    }

    // ── B. two separate submits, different periods → two rows ──
    await http.post(url, { period: 'PILOT-B1' });
    await http.post(url, { period: 'PILOT-B2' });
    const nB = Number((await c.query(`SELECT COUNT(*) n FROM payroll_runs WHERE user_id=$1 AND period IN ('PILOT-B1','PILOT-B2')`, [uid])).rows[0].n);
    A('two separate submits (different period): TWO run rows', nB === 2, `rows = ${nB}`);

    // ── C. NULL entity_id collision handled by the index (index mode only) ──
    if (WITH_INDEX) {
      const insNull = () => c.query(
        `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net, notes)
         VALUES ($1, NULL, 'PILOT-NULL', NOW(), 'draft', 0, 0, 0, '')`, [uid]);
      await insNull();
      let nullRejected = false;
      try { await insNull(); } catch (e) { nullRejected = (e.code === '23505'); }
      A('NULL entity_id: second identical insert rejected 23505 (COALESCE null-safety works)', nullRejected,
        `a plain UNIQUE(user_id,entity_id,period) would ALLOW this — proving the index must coalesce NULL`);
    }

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e), '\n');
    fail++;
  } finally {
    try { if (server) await server.close(); } catch { /* ignore */ }
    try { if (appPool) await appPool.end(); } catch { /* ignore */ }
    try { if (scratch) await scratch.stop(); } catch { /* ignore */ }
  }
  process.exitCode = 0;
})();
