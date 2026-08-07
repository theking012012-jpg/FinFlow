'use strict';
/**
 * verify-c1-invoice-payments.js — PROVE (Rule 14) that the boot-safe TOKEN index on invoice_payments
 * (idx_invoice_payments_idem_key, in initDB) + the 23505 recovery make POST /api/invoice-payments
 * safe against the concurrent / slow double-submit (C1 class, Wave 1b). Money-critical: two rapid
 * PARTIAL payments both fit under the overpayment check and both book, settling an invoice twice.
 *
 * Typed table (like payroll_runs) → the token is a real `idempotency_key` column. The route needs an
 * OWNED invoice with headroom, so the harness seeds one big invoice; cases use distinct amounts so
 * the (invoice_id, amount, date) pre-check isolates them.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-invoice-payments.js
 *   NO_INDEX=1 node -r ./tests/harness/clock.js tests/harness/verify-c1-invoice-payments.js   (CONTROL)
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'ip-c1@finflow.test', password: 'harness-password-not-a-secret' };
const WITH_INDEX = !process.env.NO_INDEX;
const DATE = '2026-07-20';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;

    const payCount = async (uid, amt) =>
      Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE user_id=$1 AND amount=$2`, [uid, amt])).rows[0].n);
    const ageOut = (uid, amt) =>
      c.query(`UPDATE invoice_payments SET created_at = NOW() - INTERVAL '30 seconds' WHERE user_id=$1 AND amount=$2`, [uid, amt]);

    server = await bootServer(scratch.url);      // runs initDB → ALTER ADD idempotency_key + idx_invoice_payments_idem_key
    console.log(`\n  MODE: ${WITH_INDEX ? 'WITH INDEX (the fix)' : 'NO INDEX (Rule-14 CONTROL — proves the JS guard alone is insufficient)'}\n`);
    if (!WITH_INDEX) {
      const d = await c.query(`DROP INDEX IF EXISTS idx_invoice_payments_idem_key`);
      console.log(`  (control) dropped idx_invoice_payments_idem_key — command tag: ${d.command || 'DROP'}\n`);
    } else {
      const ix = await c.query(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_invoice_payments_idem_key'`);
      A('migration present: idx_invoice_payments_idem_key exists (partial, on idempotency_key column)',
        ix.rows.length === 1 && /idempotency_key/.test(ix.rows[0].indexdef), `rows=${ix.rows.length}`);
      const col = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='invoice_payments' AND column_name='idempotency_key'`);
      A('migration present: invoice_payments.idempotency_key column added', col.rows.length === 1);
    }

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'IP C1 Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    // One big invoice with plenty of headroom so every test payment fits under the overpayment check.
    const invId = (await c.query(
      `INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { client: 'Big Co', amount: 1000000, status: 'pending', amount_paid: 0 }]
    )).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 200)}`);
    const post = (amount, key) => http.post('/api/invoice-payments',
      key !== undefined ? { invoice_id: invId, amount, payment_date: DATE, idempotency_key: key }
                        : { invoice_id: invId, amount, payment_date: DATE });

    // ── A. concurrent identical-token submits ──
    const aA = 211, keyA = 'tok-A';
    const [r1, r2] = await Promise.all([post(aA, keyA), post(aA, keyA)]);
    const nA = await payCount(uid, aA);
    if (WITH_INDEX) {
      A('A. concurrent same-token: exactly ONE payment row', nA === 1, `rows=${nA}  statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both 2xx (no 500)', [r1.status, r2.status].every(s => s >= 200 && s < 300), `statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both carry the SAME id (idempotent return)', r1.json?.id != null && r1.json.id === r2.json?.id, `ids ${r1.json?.id}/${r2.json?.id}`);
    } else {
      console.log(`  INFO  A. (no index) concurrent endpoint race produced ${nA} row(s) — non-deterministic on localhost`);
    }

    // ── B. slow (>5s) sequential same-token re-click ──
    const aB = 212, keyB = 'tok-B';
    const b1 = await post(aB, keyB);
    await ageOut(uid, aB);
    const b2 = await post(aB, keyB);
    const nB = await payCount(uid, aB);
    if (WITH_INDEX) {
      A('B. slow >5s same-token re-click: exactly ONE row (index caught what the 5s window missed)', nB === 1, `rows=${nB}  b1=${b1.status} b2=${b2.status}`);
      A('B. slow >5s same-token re-click: 2nd response 200 with the SAME id (idempotent recover)', b2.status === 200 && b2.json?.id === b1.json?.id, `b2 ${b2.status} ids ${b1.json?.id}/${b2.json?.id}`);
    } else {
      A('B. CONTROL (no index): slow >5s same-token re-click → TWO rows — the exact partial-payment double-book, nothing stops it', nB === 2, `rows=${nB}`);
    }

    // ── C. deterministic raw-insert control (typed columns) ──
    const insRaw = () => c.query(`INSERT INTO invoice_payments (user_id, entity_id, invoice_id, amount, payment_date, idempotency_key) VALUES ($1,NULL,$2,213,$3,'tok-RAW')`, [uid, invId, DATE]);
    await insRaw();
    let rawRejected = false;
    try { await insRaw(); } catch (e) { rawRejected = (e.code === '23505'); }
    const nRaw = await payCount(uid, 213);
    if (WITH_INDEX) {
      A('C. DB backstop: 2nd raw same-token insert rejected 23505 → ONE row', rawRejected && nRaw === 1, `rejected=${rawRejected} rows=${nRaw}`);
    } else {
      A('C. CONTROL (no index): 2nd raw same-token insert ACCEPTED → TWO rows', !rawRejected && nRaw === 2, `rejected=${rawRejected} rows=${nRaw}`);
    }

    // ── D. different tokens, same amount → TWO rows (two equal partial payments are legitimate) ──
    const aD = 214;
    const d1 = await post(aD, 'tok-D1');
    const d2 = await post(aD, 'tok-D2');
    A('D. different tokens, same amount: TWO rows (two equal partial payments are legitimate — token, not a natural key)',
      (await payCount(uid, aD)) === 2, `rows=${await payCount(uid, aD)}  d1=${d1.status} d2=${d2.status}`);

    // ── E. no token, same amount, >5s apart → TWO rows; <5s apart → ONE row (pre-check active) ──
    const aE = 215;
    const e1 = await post(aE);
    await ageOut(uid, aE);
    const e2 = await post(aE);
    A('E. no-token, same amount >5s apart: TWO rows — 5s window expired, no token index to catch it',
      (await payCount(uid, aE)) === 2, `rows=${await payCount(uid, aE)}`);
    const aE2 = 216;
    const e2a = await post(aE2);
    const e2b = await post(aE2);
    A('E2. no-token, same amount <5s apart: ONE row (typed pre-check still active for token-less requests)',
      (await payCount(uid, aE2)) === 1, `rows=${await payCount(uid, aE2)}  e2a=${e2a.status} e2b=${e2b.status}`);

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
