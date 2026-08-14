'use strict';
/**
 * verify-c1-journals.js — PROVE (Rule 14) that the partial UNIQUE index on the journals idempotency
 * token + the 23505 handler make POST /api/journals safe against the concurrent / slow double-submit
 * the 5s findRecentDuplicate pre-check cannot stop (C1 class, Wave 1). A duplicated manual journal
 * entry double-posts to the ledger. Single-row insert (lines stored as JSON); entity-consistent
 * pre-check (no scope bug). Two identical balanced entries can be legitimate, so token, not a
 * natural key.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-journals.js
 *   NO_INDEX=1 node -r ./tests/harness/clock.js tests/harness/verify-c1-journals.js   (CONTROL)
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'je-c1@finflow.test', password: 'harness-password-not-a-secret' };
const WITH_INDEX = !process.env.NO_INDEX;
const DATE = '2026-07-20';
// Balanced two-line entry totalling `amt`; description is the count key.
const body = (description, amt, key) => {
  const b = { date: DATE, description, status: 'Posted',
    lines: [{ code: '1000', name: 'Cash', debit: amt, credit: 0 },
            { code: '4000', name: 'Revenue', debit: 0, credit: amt }] };
  if (key !== undefined) b.idempotency_key = key;
  return b;
};

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;

    const jeCount = async (uid, description) =>
      Number((await c.query(
        `SELECT COUNT(*) n FROM journals WHERE user_id=$1 AND data->>'description'=$2`, [uid, description]
      )).rows[0].n);
    const ageOut = (uid, description) =>
      c.query(`UPDATE journals SET created_at = NOW() - INTERVAL '30 seconds' WHERE user_id=$1 AND data->>'description'=$2`,
        [uid, description]);

    server = await bootServer(scratch.url);      // runs initDB → creates idx_journals_idem_key
    console.log(`\n  MODE: ${WITH_INDEX ? 'WITH INDEX (the fix)' : 'NO INDEX (Rule-14 CONTROL — proves the JS guard alone is insufficient)'}\n`);
    if (!WITH_INDEX) {
      const d = await c.query(`DROP INDEX IF EXISTS idx_journals_idem_key`);
      console.log(`  (control) dropped idx_journals_idem_key — command tag: ${d.command || 'DROP'}\n`);
    } else {
      const ix = await c.query(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_journals_idem_key'`);
      A('migration present: idx_journals_idem_key exists (partial, on data->>idempotency_key)',
        ix.rows.length === 1 && /idempotency_key/.test(ix.rows[0].indexdef),
        `rows=${ix.rows.length} def=${ix.rows[0]?.indexdef}`);
    }

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'JE C1 Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
       VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name: 'JE C1 Co', currency: 'USD', is_active: 1 }]
    )).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 200)}`);
    const post = (b) => http.post('/api/journals', b);

    // ── A. concurrent identical-token submits (the TOCTOU race) ──
    const dA = 'race-A', keyA = 'tok-A';
    const [r1, r2] = await Promise.all([post(body(dA, 2000, keyA)), post(body(dA, 2000, keyA))]);
    const nA = await jeCount(uid, dA);
    if (WITH_INDEX) {
      A('A. concurrent same-token: exactly ONE journal row', nA === 1, `rows=${nA}  statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both responses 2xx (no 500)',
        [r1.status, r2.status].every(s => s >= 200 && s < 300),
        `statuses ${r1.status}/${r2.status}  bodies ${r1.text?.slice(0,120)} | ${r2.text?.slice(0,120)}`);
      A('A. concurrent same-token: both responses carry the SAME id (idempotent return)',
        r1.json?.id != null && r1.json.id === r2.json?.id, `ids ${r1.json?.id} / ${r2.json?.id}`);
    } else {
      console.log(`  INFO  A. (no index) concurrent endpoint race produced ${nA} row(s) — non-deterministic on localhost`);
    }

    // ── B. slow (>5s) sequential same-token re-click ──
    const dB = 'slow-B', keyB = 'tok-B';
    const b1 = await post(body(dB, 1500, keyB));
    await ageOut(uid, dB);
    const b2 = await post(body(dB, 1500, keyB));
    const nB = await jeCount(uid, dB);
    if (WITH_INDEX) {
      A('B. slow >5s same-token re-click: exactly ONE row (index caught what the 5s window missed)',
        nB === 1, `rows=${nB}  b1=${b1.status} b2=${b2.status}`);
      A('B. slow >5s same-token re-click: 2nd response 200 with the SAME id (idempotent recover)',
        b2.status === 200 && b2.json?.id === b1.json?.id, `b2 status ${b2.status}  ids ${b1.json?.id}/${b2.json?.id}`);
    } else {
      A('B. CONTROL (no index): slow >5s same-token re-click → TWO rows — the exact Rule 9 defect, nothing stops it',
        nB === 2, `rows=${nB}  (with the index this is 1)`);
    }

    // ── C. deterministic raw-insert control ──
    const rawData = { description: 'raw-C', debit: 100, credit: 100, idempotency_key: 'tok-RAW' };
    const insRaw = () => c.query(`INSERT INTO journals (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eid, rawData]);
    await insRaw();
    let rawRejected = false;
    try { await insRaw(); } catch (e) { rawRejected = (e.code === '23505'); }
    const nRaw = await jeCount(uid, 'raw-C');
    if (WITH_INDEX) {
      A('C. DB backstop: 2nd raw same-token insert rejected 23505 → ONE row', rawRejected && nRaw === 1, `rejected=${rawRejected} rows=${nRaw}`);
    } else {
      A('C. CONTROL (no index): 2nd raw same-token insert ACCEPTED → TWO rows (nothing stops a duplicate)', !rawRejected && nRaw === 2, `rejected=${rawRejected} rows=${nRaw}`);
    }

    // ── D. different tokens, same description+debit, spaced >5s → TWO rows (two entries preserved) ──
    const dD = 'legit-D';
    const d1 = await post(body(dD, 3000, 'tok-D1'));
    await ageOut(uid, dD);
    const d2 = await post(body(dD, 3000, 'tok-D2'));
    const nD = await jeCount(uid, dD);
    A('D. different tokens, same description+debit: TWO rows (two legitimate entries preserved — token, not a natural key)',
      nD === 2, `rows=${nD}  d1=${d1.status} d2=${d2.status} ids ${d1.json?.id}/${d2.json?.id}`);

    // ── D2. different tokens, same description+debit, <5s apart → TWO rows ──
    const dD2 = 'legit-D2';
    const d2a = await post(body(dD2, 3000, 'tok-D2a'));
    const d2b = await post(body(dD2, 3000, 'tok-D2b'));
    const nD2 = await jeCount(uid, dD2);
    A('D2. different tokens, same description+debit, <5s apart: TWO rows (token-aware bypass; token-blind pre-check would collapse them — F131)',
      nD2 === 2, `rows=${nD2}  d2a=${d2a.status} d2b=${d2b.status} ids ${d2a.json?.id}/${d2b.json?.id}`);

    // ── E. no token (legacy/API), two POSTs spaced >5s apart → TWO rows ──
    const dE = 'nokey-E';
    const e1 = await post(body(dE, 700));
    await ageOut(uid, dE);
    const e2 = await post(body(dE, 700));
    const nE = await jeCount(uid, dE);
    A('E. no-token legacy POST (x2, >5s apart): TWO rows — 5s window expired; partial index ignores null keys → legacy behaviour unchanged',
      nE === 2, `rows=${nE}  e1=${e1.status} e2=${e2.status}`);

    // ── E2. no token, same description+debit, <5s apart → ONE row (pre-check consistent) ──
    const dE2 = 'nokey-E2';
    const e2a = await post(body(dE2, 700));
    const e2b = await post(body(dE2, 700));
    const nE2 = await jeCount(uid, dE2);
    A('E2. no-token, same description+debit, <5s apart: ONE row (pre-check still active for token-less requests — entity-consistent)',
      nE2 === 1, `rows=${nE2}  e2a=${e2a.status} e2b=${e2b.status}`);

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
