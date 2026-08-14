'use strict';
/**
 * verify-f101-batch-match.js — PROVE (Rule 14) the new POST /api/bank-reconciliation/match-batch:
 *   1. matches N pairs in ONE request (3 pairs → 3 bank_reconciliation rows from a single POST);
 *   2. is idempotent — re-submitting the same batch inserts nothing (skipped), no duplicate links;
 *   3. validates ownership — a foreign banking_id 404s and inserts NOTHING (atomic rollback);
 *   4. rejects a malformed batch (400).
 * Control: the single /match endpoint still works (backward compat preserved).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f101-batch-match.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f101@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  const countRecon = async (c, uid) => (await c.query('SELECT COUNT(*)::int n FROM bank_reconciliation WHERE user_id=$1', [uid])).rows[0].n;

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F101', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    // F150 seed-debt fix: invoices require a non-NULL entity_id (chk_invoices_entity_nn). Create an
    // active entity and stamp it, mirroring production onboarding (which POSTs /api/entities).
    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'F101 Co', currency: 'USD', is_active: 1 }]
    )).rows[0].id;
    const invId = (await c.query(
      `INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$3,$2,NOW(),NOW()) RETURNING id`,
      [uid, { client: 'C', amount: 300, status: 'paid', issue_date: '2026-07-01' }, eid]
    )).rows[0].id;

    const bankIds = [], payIds = [];
    for (let i = 0; i < 3; i++) {
      bankIds.push((await c.query(
        `INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
        [uid, { description: 'Tx' + i, amount: 100, date: '2026-07-10', account_name: 'Chk', source: 'banking' }]
      )).rows[0].id);
      payIds.push((await c.query(
        `INSERT INTO invoice_payments (user_id, entity_id, invoice_id, amount, payment_date) VALUES ($1,NULL,$2,100,'2026-07-10') RETURNING id`,
        [uid, invId]
      )).rows[0].id);
    }
    // a foreign user's bank tx (not owned) for the ownership test
    const otherUid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email: 'x@x.io', name: 'X' }])).rows[0].id;
    const foreignBank = (await c.query(`INSERT INTO personal_transactions (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [otherUid, { source: 'banking' }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    const pairs = bankIds.map((b, i) => ({ banking_id: b, invoice_payment_id: payIds[i] }));

    // 1. ONE request → 3 matches
    const r1 = await http.post('/api/bank-reconciliation/match-batch', { matches: pairs });
    A('batch of 3 → 201, matched:3 in ONE request', r1.status === 201 && r1.json.matched === 3, `status ${r1.status} matched ${r1.json && r1.json.matched}`);
    A('DB has exactly 3 reconciliation rows after one POST', (await countRecon(c, uid)) === 3);

    // 2. idempotent re-submit → nothing new
    const r2 = await http.post('/api/bank-reconciliation/match-batch', { matches: pairs });
    A('re-submit same batch → matched:0, skipped:3 (idempotent, no duplicates)', r2.status === 201 && r2.json.matched === 0 && r2.json.skipped === 3, JSON.stringify(r2.json));
    A('DB still has exactly 3 rows (no duplicate links)', (await countRecon(c, uid)) === 3);

    // 3. ownership — foreign banking_id → 404, nothing inserted (atomic)
    const before = await countRecon(c, uid);
    const r3 = await http.post('/api/bank-reconciliation/match-batch', { matches: [{ banking_id: foreignBank, invoice_payment_id: payIds[0] }] });
    A('foreign banking_id → 404 and inserts NOTHING (atomic rollback)', r3.status === 404 && (await countRecon(c, uid)) === before, `status ${r3.status}`);

    // 4. malformed → 400
    const r4 = await http.post('/api/bank-reconciliation/match-batch', { matches: [{ banking_id: 'x', invoice_payment_id: null }] });
    A('malformed pair → 400', r4.status === 400, `status ${r4.status}`);

    // control: single /match still works (backward compat) — needs a fresh unmatched pair
    const b2 = (await c.query(`INSERT INTO personal_transactions (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { source: 'banking' }])).rows[0].id;
    const p2 = (await c.query(`INSERT INTO invoice_payments (user_id,entity_id,invoice_id,amount,payment_date) VALUES ($1,NULL,$2,100,'2026-07-10') RETURNING id`, [uid, invId])).rows[0].id;
    const r5 = await http.post('/api/bank-reconciliation/match', { banking_id: b2, invoice_payment_id: p2 });
    A('single /match endpoint still works (backward compat)', r5.status === 201);

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
