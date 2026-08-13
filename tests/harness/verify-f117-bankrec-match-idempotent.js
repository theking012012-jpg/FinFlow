'use strict';
/**
 * verify-f117-bankrec-match-idempotent.js
 * PROVES the legacy POST /api/bank-reconciliation/match is idempotent by natural key (Rules 3/4/14):
 * a repeated match of the same (banking_id, invoice_payment_id) returns the existing link instead of
 * inserting a duplicate. Real scratch Postgres, real endpoint.
 *   node -r ./tests/harness/clock.js tests/harness/verify-f117-bankrec-match-idempotent.js
 * FAIL-THEN-PASS: unfixed handler inserts 2 rows on a double-submit; fixed inserts 1.
 */
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'owner-bankrec@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'BankRec', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'E1', currency: 'USD', is_active: 1 }])).rows[0].id;
    const bankId = (await c.query(
      `INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { amount: 500, description: 'Deposit' }])).rows[0].id;
    const payId = (await c.query(
      `INSERT INTO invoice_payments (user_id, entity_id, invoice_id, amount, payment_date, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id`,
      [uid, eid, 1, 500, '2026-07-20'])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    // double-submit the SAME match (retry / double-click surrogate)
    const r1 = await http.post('/api/bank-reconciliation/match', { banking_id: bankId, invoice_payment_id: payId });
    const r2 = await http.post('/api/bank-reconciliation/match', { banking_id: bankId, invoice_payment_id: payId });
    A('first match created (201)', r1.status === 201, `status ${r1.status}`);
    A('second match returns existing (200/201, not error)', r2.status === 200 || r2.status === 201, `status ${r2.status}`);
    const { rows } = await c.query(`SELECT COUNT(*)::int n FROM bank_reconciliation WHERE user_id=$1`, [uid]);
    A('exactly ONE reconciliation link (no duplicate)', rows[0].n === 1, `got ${rows[0].n} rows`);
    // same link identity returned both times
    const id1 = r1.json && r1.json.id, id2 = r2.json && r2.json.id;
    A('both responses reference the same link id', id1 != null && id1 === id2, `id1=${id1} id2=${id2}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
