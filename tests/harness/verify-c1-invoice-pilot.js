'use strict';
/**
 * verify-c1-invoice-pilot.js — PROVE (Rule 14) that the partial UNIQUE index on the invoice
 * idempotency token + the 23505 handler make POST /api/invoices safe against the concurrent /
 * slow double-submit the 5s findRecentDuplicate pre-check cannot stop (F117 / C1, commit A).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-invoice-pilot.js
 *   NO_INDEX=1 node -r ./tests/harness/clock.js tests/harness/verify-c1-invoice-pilot.js   (CONTROL)
 *
 * Real server, real Postgres, real HTTP to the REAL POST /api/invoices. Owns a minimal seed (one
 * user + one entity). The enforcing index ships in database.js initDB (commit A), so bootServer()
 * creates it automatically; the NO_INDEX control DROPs it right after boot to execute the failure
 * path — with the server code present but no index, the handler is byte-identical to pre-fix.
 *
 * States up front (Rule 4 — the seed discriminates: the bug changes the number):
 *   A. SAME token, CONCURRENT (the TOCTOU race)          fixed → 1 row   buggy → 2 rows
 *   B. SAME token, SLOW >5s re-click (the Rule 9 hole)   fixed → 1 row   buggy → 2 rows
 *   C. SAME token, two RAW inserts (deterministic)       index → 23505/1 no index → 2 rows
 *   D. DIFFERENT tokens, same client+amount, >5s apart   both  → 2 rows  (re-invoicing preserved)
 *   E. NO token (legacy/API), two POSTs >5s apart        both  → 2 rows  (partial index ignores null)
 *
 * Cases D and E are the discriminators that prove we used a per-intent TOKEN, not a wrong
 * UNIQUE(client, amount) natural key: genuine re-invoicing and null-key legacy inserts still land.
 * The >5s spacing is simulated by aging created_at back in the DB, so the run needs no real wait.
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'inv-pilot@finflow.test', password: 'harness-password-not-a-secret' };
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

    // Row count for one unique client name (each case uses its own so the 5s pre-check is isolated).
    const invCount = async (uid, clientName) =>
      Number((await c.query(
        `SELECT COUNT(*) n FROM invoices WHERE user_id=$1 AND data->>'client'=$2`, [uid, clientName]
      )).rows[0].n);
    // Push a case's rows' created_at back >5s so findRecentDuplicate (the 5s window) can no longer
    // see them — this is exactly the slow-re-click condition Rule 9 names, made deterministic.
    const ageOut = (uid, clientName) =>
      c.query(`UPDATE invoices SET created_at = NOW() - INTERVAL '30 seconds' WHERE user_id=$1 AND data->>'client'=$2`,
        [uid, clientName]);

    server = await bootServer(scratch.url);      // runs initDB → creates idx_invoices_idem_key
    console.log(`\n  MODE: ${WITH_INDEX ? 'WITH INDEX (the fix)' : 'NO INDEX (Rule-14 CONTROL — proves the JS guard alone is insufficient)'}\n`);
    if (!WITH_INDEX) {
      const d = await c.query(`DROP INDEX IF EXISTS idx_invoices_idem_key`);
      console.log(`  (control) dropped idx_invoices_idem_key — command tag: ${d.command || 'DROP'}\n`);
    } else {
      // Confirm the migration actually created the index — a green test against a missing index would prove nothing.
      const ix = await c.query(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_invoices_idem_key'`);
      A('migration present: idx_invoices_idem_key exists (partial, on data->>idempotency_key)',
        ix.rows.length === 1 && /idempotency_key/.test(ix.rows[0].indexdef),
        `rows=${ix.rows.length} def=${ix.rows[0]?.indexdef}`);
    }

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Inv Pilot Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
       VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name: 'Inv Pilot Co', currency: 'USD', is_active: 1 }]
    )).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 200)}`);
    const post = (body) => http.post('/api/invoices', body);

    // ── A. concurrent identical-token submits (the TOCTOU race) ──
    const cliA = 'race-A', keyA = 'tok-A';
    const [r1, r2] = await Promise.all([
      post({ client: cliA, amount: 2000, entity_id: eid, idempotency_key: keyA }),
      post({ client: cliA, amount: 2000, entity_id: eid, idempotency_key: keyA }),
    ]);
    const nA = await invCount(uid, cliA);
    if (WITH_INDEX) {
      A('A. concurrent same-token: exactly ONE invoice row', nA === 1, `rows=${nA}  statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both responses 2xx (no 500)',
        [r1.status, r2.status].every(s => s >= 200 && s < 300),
        `statuses ${r1.status}/${r2.status}  bodies ${r1.text?.slice(0,120)} | ${r2.text?.slice(0,120)}`);
      A('A. concurrent same-token: both responses carry the SAME id (idempotent return)',
        r1.json?.id != null && r1.json.id === r2.json?.id, `ids ${r1.json?.id} / ${r2.json?.id}`);
    } else {
      // The endpoint race is timing-dependent on localhost (the 2nd JS pre-check often sees the 1st
      // insert and wins), so it does NOT reliably reproduce here. Report it; the deterministic proof
      // is case B (aged-out, so the pre-check cannot mask it) and the raw control C.
      console.log(`  INFO  A. (no index) concurrent endpoint race produced ${nA} row(s) — non-deterministic on localhost`);
    }

    // ── B. slow (>5s) sequential same-token re-click — the exact Rule 9 hole, made deterministic ──
    const cliB = 'slow-B', keyB = 'tok-B';
    const b1 = await post({ client: cliB, amount: 1500, entity_id: eid, idempotency_key: keyB });
    await ageOut(uid, cliB);                 // now the 5s pre-check can no longer see b1
    const b2 = await post({ client: cliB, amount: 1500, entity_id: eid, idempotency_key: keyB });
    const nB = await invCount(uid, cliB);
    if (WITH_INDEX) {
      A('B. slow >5s same-token re-click: exactly ONE row (index caught what the 5s window missed)',
        nB === 1, `rows=${nB}  b1=${b1.status} b2=${b2.status}`);
      A('B. slow >5s same-token re-click: 2nd response 200 with the SAME id (idempotent recover)',
        b2.status === 200 && b2.json?.id === b1.json?.id, `b2 status ${b2.status}  ids ${b1.json?.id}/${b2.json?.id}`);
    } else {
      A('B. CONTROL (no index): slow >5s same-token re-click → TWO rows — the exact Rule 9 defect, nothing stops it',
        nB === 2, `rows=${nB}  (with the index this is 1)`);
    }

    // ── C. deterministic raw-insert control: two identical-token INSERTs bypass the endpoint entirely ──
    const rawData = { client: 'raw-C', amount: 100, idempotency_key: 'tok-RAW' };
    const insRaw = () => c.query(`INSERT INTO invoices (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eid, rawData]);
    await insRaw();
    let rawRejected = false;
    try { await insRaw(); } catch (e) { rawRejected = (e.code === '23505'); }
    const nRaw = await invCount(uid, 'raw-C');
    if (WITH_INDEX) {
      A('C. DB backstop: 2nd raw same-token insert rejected 23505 → ONE row', rawRejected && nRaw === 1, `rejected=${rawRejected} rows=${nRaw}`);
    } else {
      A('C. CONTROL (no index): 2nd raw same-token insert ACCEPTED → TWO rows (nothing stops a duplicate)', !rawRejected && nRaw === 2, `rejected=${rawRejected} rows=${nRaw}`);
    }

    // ── D. different tokens, same client+amount, spaced >5s → TWO rows (re-invoicing preserved) ──
    const cliD = 'legit-D';
    const d1 = await post({ client: cliD, amount: 3000, entity_id: eid, idempotency_key: 'tok-D1' });
    await ageOut(uid, cliD);                 // so the pre-check does not merge a genuine re-invoice
    const d2 = await post({ client: cliD, amount: 3000, entity_id: eid, idempotency_key: 'tok-D2' });
    const nD = await invCount(uid, cliD);
    A('D. different tokens, same client+amount: TWO rows (legit re-invoicing preserved — token, not UNIQUE(client,amount))',
      nD === 2, `rows=${nD}  d1=${d1.status} d2=${d2.status} ids ${d1.json?.id}/${d2.json?.id}`);

    // ── D2. different tokens, same client+amount, <5s apart (NOT aged out) → TWO rows ──
    // The discriminator for the TOKEN-AWARE PRE-CHECK BYPASS (F131): the token-blind 5s pre-check
    // would collapse these two legitimately-different-token invoices into one (missing revenue). The
    // bypass runs the pre-check only for token-less requests, so both land. Code-level → BOTH modes.
    const cliD2 = 'legit-D2';
    const d2a = await post({ client: cliD2, amount: 3000, entity_id: eid, idempotency_key: 'tok-D2a' });
    const d2b = await post({ client: cliD2, amount: 3000, entity_id: eid, idempotency_key: 'tok-D2b' });
    const nD2 = await invCount(uid, cliD2);
    A('D2. different tokens, same client+amount, <5s apart: TWO rows (token-aware bypass; token-blind pre-check would collapse them — F131)',
      nD2 === 2, `rows=${nD2}  d2a=${d2a.status} d2b=${d2b.status} ids ${d2a.json?.id}/${d2b.json?.id}`);

    // ── E. no token (legacy/API), two POSTs spaced >5s apart → TWO rows ──
    const cliE = 'nokey-E';
    const e1 = await post({ client: cliE, amount: 700, entity_id: eid });
    await ageOut(uid, cliE);
    const e2 = await post({ client: cliE, amount: 700, entity_id: eid });
    const nE = await invCount(uid, cliE);
    A('E. no-token legacy POST (x2, >5s apart): TWO rows — 5s window expired; partial index ignores null keys → legacy behaviour unchanged',
      nE === 2, `rows=${nE}  e1=${e1.status} e2=${e2.status}`);

    // ── E2. no token, same client+amount, <5s apart (NOT aged out) → ONE row ──
    // Proves the bypass is CONDITIONAL: for token-less requests the 5s pre-check still runs and
    // still merges near-simultaneous dupes (the else-branch of `if (!idem)`). Both modes.
    const cliE2 = 'nokey-E2';
    const e2a = await post({ client: cliE2, amount: 700, entity_id: eid });
    const e2b = await post({ client: cliE2, amount: 700, entity_id: eid });
    const nE2 = await invCount(uid, cliE2);
    A('E2. no-token, same client+amount, <5s apart: ONE row (pre-check still active for token-less requests — bypass is conditional)',
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
