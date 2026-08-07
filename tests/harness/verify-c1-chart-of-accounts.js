'use strict';
/**
 * verify-c1-chart-of-accounts.js — PROVE (Rule 14) that the partial UNIQUE token index on
 * chart_of_accounts + the 23505 handler make POST /api/chart-of-accounts safe against the
 * concurrent / slow double-submit (C1 class, Wave 1b). JSONB table, entity-consistent pre-check.
 * NOT a natural key on `code` — that business-uniqueness is deferred post-launch (Step 6); the token
 * stops the double-submit, and different-token same-code entries both land (case D documents this).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-chart-of-accounts.js
 *   NO_INDEX=1 node -r ./tests/harness/clock.js tests/harness/verify-c1-chart-of-accounts.js   (CONTROL)
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'coa-c1@finflow.test', password: 'harness-password-not-a-secret' };
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

    const coaCount = async (uid, code) =>
      Number((await c.query(`SELECT COUNT(*) n FROM chart_of_accounts WHERE user_id=$1 AND data->>'code'=$2`, [uid, code])).rows[0].n);
    const ageOut = (uid, code) =>
      c.query(`UPDATE chart_of_accounts SET created_at = NOW() - INTERVAL '30 seconds' WHERE user_id=$1 AND data->>'code'=$2`, [uid, code]);

    server = await bootServer(scratch.url);      // runs initDB → creates idx_chart_of_accounts_idem_key
    console.log(`\n  MODE: ${WITH_INDEX ? 'WITH INDEX (the fix)' : 'NO INDEX (Rule-14 CONTROL — proves the JS guard alone is insufficient)'}\n`);
    if (!WITH_INDEX) {
      const d = await c.query(`DROP INDEX IF EXISTS idx_chart_of_accounts_idem_key`);
      console.log(`  (control) dropped idx_chart_of_accounts_idem_key — command tag: ${d.command || 'DROP'}\n`);
    } else {
      const ix = await c.query(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_chart_of_accounts_idem_key'`);
      A('migration present: idx_chart_of_accounts_idem_key exists (partial, on data->>idempotency_key)',
        ix.rows.length === 1 && /idempotency_key/.test(ix.rows[0].indexdef),
        `rows=${ix.rows.length} def=${ix.rows[0]?.indexdef}`);
    }

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'COA C1 Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { name: 'COA C1 Co', currency: 'USD', is_active: 1 }]
    );

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 200)}`);
    const post = (code, key) => http.post('/api/chart-of-accounts',
      key !== undefined ? { code, name: 'Acct ' + code, category: 'Assets', idempotency_key: key }
                        : { code, name: 'Acct ' + code, category: 'Assets' });

    // ── A. concurrent identical-token submits ──
    const cA = '1000', keyA = 'tok-A';
    const [r1, r2] = await Promise.all([post(cA, keyA), post(cA, keyA)]);
    const nA = await coaCount(uid, cA);
    if (WITH_INDEX) {
      A('A. concurrent same-token: exactly ONE account row', nA === 1, `rows=${nA}  statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both responses 2xx (no 500)',
        [r1.status, r2.status].every(s => s >= 200 && s < 300), `statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both responses carry the SAME id (idempotent return)',
        r1.json?.id != null && r1.json.id === r2.json?.id, `ids ${r1.json?.id} / ${r2.json?.id}`);
    } else {
      console.log(`  INFO  A. (no index) concurrent endpoint race produced ${nA} row(s) — non-deterministic on localhost`);
    }

    // ── B. slow (>5s) sequential same-token re-click ──
    const cB = '2000', keyB = 'tok-B';
    const b1 = await post(cB, keyB);
    await ageOut(uid, cB);
    const b2 = await post(cB, keyB);
    const nB = await coaCount(uid, cB);
    if (WITH_INDEX) {
      A('B. slow >5s same-token re-click: exactly ONE row (index caught what the 5s window missed)',
        nB === 1, `rows=${nB}  b1=${b1.status} b2=${b2.status}`);
      A('B. slow >5s same-token re-click: 2nd response 200 with the SAME id (idempotent recover)',
        b2.status === 200 && b2.json?.id === b1.json?.id, `b2 ${b2.status}  ids ${b1.json?.id}/${b2.json?.id}`);
    } else {
      A('B. CONTROL (no index): slow >5s same-token re-click → TWO rows — the exact Rule 9 defect, nothing stops it',
        nB === 2, `rows=${nB}`);
    }

    // ── C. deterministic raw-insert control ──
    const rawData = { code: '3000', name: 'Raw', category: 'Assets', idempotency_key: 'tok-RAW' };
    const insRaw = () => c.query(`INSERT INTO chart_of_accounts (user_id, entity_id, data) VALUES ($1,NULL,$2)`, [uid, rawData]);
    await insRaw();
    let rawRejected = false;
    try { await insRaw(); } catch (e) { rawRejected = (e.code === '23505'); }
    const nRaw = await coaCount(uid, '3000');
    if (WITH_INDEX) {
      A('C. DB backstop: 2nd raw same-token insert rejected 23505 → ONE row', rawRejected && nRaw === 1, `rejected=${rawRejected} rows=${nRaw}`);
    } else {
      A('C. CONTROL (no index): 2nd raw same-token insert ACCEPTED → TWO rows', !rawRejected && nRaw === 2, `rejected=${rawRejected} rows=${nRaw}`);
    }

    // ── D. different tokens, SAME code → TWO rows (token-based; code-uniqueness is DEFERRED) ──
    const cD = '4000';
    const d1 = await post(cD, 'tok-D1');
    const d2 = await post(cD, 'tok-D2');
    const nD = await coaCount(uid, cD);
    A('D. different tokens, same code: TWO rows (token index does NOT enforce unique code — that natural key is the deferred post-launch item)',
      nD === 2, `rows=${nD}  d1=${d1.status} d2=${d2.status}`);

    // ── E. no token, same code, >5s apart → TWO rows; <5s apart → ONE row (entity-consistent pre-check) ──
    const cE = '5000';
    const e1 = await post(cE);
    await ageOut(uid, cE);
    const e2 = await post(cE);
    A('E. no-token, same code >5s apart: TWO rows — 5s window expired; partial index ignores null keys',
      (await coaCount(uid, cE)) === 2, `rows=${await coaCount(uid, cE)}`);
    const cE2 = '6000';
    const e2a = await post(cE2);
    const e2b = await post(cE2);
    A('E2. no-token, same code <5s apart: ONE row (pre-check still active for token-less requests — entity-consistent)',
      (await coaCount(uid, cE2)) === 1, `rows=${await coaCount(uid, cE2)}  e2a=${e2a.status} e2b=${e2b.status}`);

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
