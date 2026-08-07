'use strict';
/**
 * verify-c1-payroll-runs.js — PROVE (Rule 14) that the boot-safe TOKEN index on payroll_runs
 * (idx_payroll_runs_idem_key, in initDB) + the 23505 recovery make POST /api/payroll-runs safe
 * against the concurrent / slow double-submit — the portable guarantee for ALL environments (the
 * natural-key period index is prod-only/out-of-band, deferred). A duplicate run doubles gross/net.
 *
 * payroll_runs is a TYPED table: the token is a real `idempotency_key` column, and the handler
 * computes lines from the seeded payroll roster (so the harness seeds one employee).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-payroll-runs.js
 *   NO_INDEX=1 node -r ./tests/harness/clock.js tests/harness/verify-c1-payroll-runs.js   (CONTROL)
 *
 *   A. SAME token, CONCURRENT               fixed → 1 run   buggy → 2 runs
 *   B. SAME token, SLOW >5s re-click        fixed → 1 run   buggy → 2 runs
 *   C. SAME token, two RAW inserts          index → 23505/1 no index → 2 runs
 *   D. DIFFERENT tokens, SAME period        → 2 runs (token-based; one-run-per-period is the DEFERRED
 *                                             natural-key item, not enforced by the token index)
 *   E. NO token, same period <5s → 1 (period pre-check active); >5s → 2 (window expired)
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'pr-run-c1@finflow.test', password: 'harness-password-not-a-secret' };
const WITH_INDEX = !process.env.NO_INDEX;

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;

    const runCount = async (uid, period) =>
      Number((await c.query(`SELECT COUNT(*) n FROM payroll_runs WHERE user_id=$1 AND period=$2`, [uid, period])).rows[0].n);
    const ageOut = (uid, period) =>
      c.query(`UPDATE payroll_runs SET created_at = NOW() - INTERVAL '30 seconds' WHERE user_id=$1 AND period=$2`, [uid, period]);

    server = await bootServer(scratch.url);      // runs initDB → ALTER ADD idempotency_key + idx_payroll_runs_idem_key
    console.log(`\n  MODE: ${WITH_INDEX ? 'WITH INDEX (the fix)' : 'NO INDEX (Rule-14 CONTROL — proves the JS guard alone is insufficient)'}\n`);
    if (!WITH_INDEX) {
      const d = await c.query(`DROP INDEX IF EXISTS idx_payroll_runs_idem_key`);
      console.log(`  (control) dropped idx_payroll_runs_idem_key — command tag: ${d.command || 'DROP'}\n`);
    } else {
      const ix = await c.query(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_payroll_runs_idem_key'`);
      A('migration present: idx_payroll_runs_idem_key exists (partial, on idempotency_key column)',
        ix.rows.length === 1 && /idempotency_key/.test(ix.rows[0].indexdef),
        `rows=${ix.rows.length} def=${ix.rows[0]?.indexdef}`);
      const col = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='payroll_runs' AND column_name='idempotency_key'`);
      A('migration present: payroll_runs.idempotency_key column added', col.rows.length === 1);
    }

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'PR-run C1 Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { name: 'PR-run Co', currency: 'USD', is_active: 1 }]
    );
    // Seed ONE payroll roster employee, entity_id NULL so it matches regardless of the run's active entity.
    await c.query(
      `INSERT INTO payroll (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { fname: 'Emp', lname: 'One', gross: 1000, deductions: [] }]
    );

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 200)}`);
    const post = (period, key) => http.post('/api/payroll-runs', key !== undefined ? { period, idempotency_key: key } : { period });

    // ── A. concurrent identical-token submits ──
    const pA = 'race-A-2026-01', keyA = 'tok-A';
    const [r1, r2] = await Promise.all([post(pA, keyA), post(pA, keyA)]);
    const nA = await runCount(uid, pA);
    if (WITH_INDEX) {
      A('A. concurrent same-token: exactly ONE run row', nA === 1, `rows=${nA}  statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both responses 2xx (no 500)',
        [r1.status, r2.status].every(s => s >= 200 && s < 300), `statuses ${r1.status}/${r2.status}  ${r1.text?.slice(0,120)} | ${r2.text?.slice(0,120)}`);
      A('A. concurrent same-token: both responses carry the SAME id (idempotent return)',
        r1.json?.id != null && r1.json.id === r2.json?.id, `ids ${r1.json?.id} / ${r2.json?.id}`);
    } else {
      console.log(`  INFO  A. (no index) concurrent endpoint race produced ${nA} run(s) — non-deterministic on localhost`);
    }

    // ── B. slow (>5s) sequential same-token re-click ──
    const pB = 'slow-B-2026-02', keyB = 'tok-B';
    const b1 = await post(pB, keyB);
    await ageOut(uid, pB);
    const b2 = await post(pB, keyB);
    const nB = await runCount(uid, pB);
    if (WITH_INDEX) {
      A('B. slow >5s same-token re-click: exactly ONE run (index caught what the 5s window missed)',
        nB === 1, `rows=${nB}  b1=${b1.status} b2=${b2.status}`);
      A('B. slow >5s same-token re-click: 2nd response 200 with the SAME id (idempotent recover)',
        b2.status === 200 && b2.json?.id === b1.json?.id, `b2 ${b2.status}  ids ${b1.json?.id}/${b2.json?.id}`);
    } else {
      A('B. CONTROL (no index): slow >5s same-token re-click → TWO runs — the exact Rule 9 defect, nothing stops it',
        nB === 2, `rows=${nB}`);
    }

    // ── C. deterministic raw-insert control (typed columns) ──
    const insRaw = () => c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, idempotency_key) VALUES ($1,NULL,$2,NOW(),'draft',$3)`, [uid, 'raw-C-2026-03', 'tok-RAW']);
    await insRaw();
    let rawRejected = false;
    try { await insRaw(); } catch (e) { rawRejected = (e.code === '23505'); }
    const nRaw = await runCount(uid, 'raw-C-2026-03');
    if (WITH_INDEX) {
      A('C. DB backstop: 2nd raw same-token insert rejected 23505 → ONE run', rawRejected && nRaw === 1, `rejected=${rawRejected} rows=${nRaw}`);
    } else {
      A('C. CONTROL (no index): 2nd raw same-token insert ACCEPTED → TWO runs', !rawRejected && nRaw === 2, `rejected=${rawRejected} rows=${nRaw}`);
    }

    // ── D. different tokens, SAME period → TWO runs (token-based; one-run-per-period is DEFERRED) ──
    const pD = 'legit-D-2026-04';
    const d1 = await post(pD, 'tok-D1');
    const d2 = await post(pD, 'tok-D2');
    const nD = await runCount(uid, pD);
    A('D. different tokens, same period: TWO runs (token index does NOT enforce one-run-per-period — that natural key is the deferred post-launch item)',
      nD === 2, `rows=${nD}  d1=${d1.status} d2=${d2.status} ids ${d1.json?.id}/${d2.json?.id}`);

    // ── E. no token, same period, >5s apart → TWO runs; <5s apart → ONE run (period pre-check) ──
    const pE = 'nokey-E-2026-05';
    const e1 = await post(pE);
    await ageOut(uid, pE);
    const e2 = await post(pE);
    A('E. no-token, same period >5s apart: TWO runs — 5s window expired, no token index to catch it',
      (await runCount(uid, pE)) === 2, `rows=${await runCount(uid, pE)}  e1=${e1.status} e2=${e2.status}`);
    const pE2 = 'nokey-E2-2026-06';
    const e2a = await post(pE2);
    const e2b = await post(pE2);
    A('E2. no-token, same period <5s apart: ONE run (period pre-check still active for token-less requests)',
      (await runCount(uid, pE2)) === 1, `rows=${await runCount(uid, pE2)}  e2a=${e2a.status} e2b=${e2b.status}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (mode: ${WITH_INDEX ? 'WITH INDEX' : 'NO INDEX control'})\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    console.error('');
    fail++;
  } finally {
    try { if (server) await server.close(); } catch { /* ignore */ }
    try { if (scratch) await scratch.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
