'use strict';
/**
 * verify-c1-inventory-movements.js — PROVE (Rule 14) that the boot-safe TOKEN index on
 * inventory_movements (idx_inventory_movements_idem_key, in initDB) + the 23505 recovery make POST
 * /api/inventory-movements safe against the concurrent / slow double-submit (C1 class, Wave 1b).
 * HIGHEST-consequence duplicate: a double-clicked 'sale' books units out twice and corrupts FIFO
 * COGS (COGS is recomputed from the rows). calculateFIFOCOGS is read-only, so the token 23505
 * preventing the duplicate ROW is the whole fix.
 *
 * Typed table, timestamp column is `moved_at` (NOT created_at) — ageOut updates moved_at.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-inventory-movements.js
 *   NO_INDEX=1 node -r ./tests/harness/clock.js tests/harness/verify-c1-inventory-movements.js   (CONTROL)
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'im-c1@finflow.test', password: 'harness-password-not-a-secret' };
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

    const movCount = async (uid, qty) =>
      Number((await c.query(`SELECT COUNT(*) n FROM inventory_movements WHERE user_id=$1 AND quantity=$2`, [uid, qty])).rows[0].n);
    const ageOut = (uid, qty) =>
      c.query(`UPDATE inventory_movements SET moved_at = NOW() - INTERVAL '30 seconds' WHERE user_id=$1 AND quantity=$2`, [uid, qty]);

    server = await bootServer(scratch.url);      // runs initDB → ALTER ADD idempotency_key + idx_inventory_movements_idem_key
    console.log(`\n  MODE: ${WITH_INDEX ? 'WITH INDEX (the fix)' : 'NO INDEX (Rule-14 CONTROL — proves the JS guard alone is insufficient)'}\n`);
    if (!WITH_INDEX) {
      const d = await c.query(`DROP INDEX IF EXISTS idx_inventory_movements_idem_key`);
      console.log(`  (control) dropped idx_inventory_movements_idem_key — command tag: ${d.command || 'DROP'}\n`);
    } else {
      const ix = await c.query(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_inventory_movements_idem_key'`);
      A('migration present: idx_inventory_movements_idem_key exists (partial, on idempotency_key column)',
        ix.rows.length === 1 && /idempotency_key/.test(ix.rows[0].indexdef), `rows=${ix.rows.length}`);
      const col = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='idempotency_key'`);
      A('migration present: inventory_movements.idempotency_key column added', col.rows.length === 1);
    }

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'IM C1 Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    // F150 seed-debt fix: business rows require a non-NULL entity_id (chk_*_entity_nn). Create an
    // active entity and stamp it, mirroring production onboarding (which POSTs /api/entities).
    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name: 'IM C1 Co', currency: 'USD', is_active: 1 }]
    )).rows[0].id;
    const invId = (await c.query(
      `INSERT INTO inventory (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $3, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name: 'Widget', units: 100000, cost: 10, max_units: 200 }, eid]
    )).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 200)}`);
    const post = (qty, key) => http.post('/api/inventory-movements',
      key !== undefined ? { inventory_id: invId, type: 'sale', quantity: qty, idempotency_key: key }
                        : { inventory_id: invId, type: 'sale', quantity: qty });

    // ── A. concurrent identical-token 'sale' submits (the FIFO-corrupting double-book) ──
    const qA = 11, keyA = 'tok-A';
    const [r1, r2] = await Promise.all([post(qA, keyA), post(qA, keyA)]);
    const nA = await movCount(uid, qA);
    if (WITH_INDEX) {
      A('A. concurrent same-token: exactly ONE movement row (units booked once, FIFO uncorrupted)', nA === 1, `rows=${nA}  statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both 2xx (no 500)', [r1.status, r2.status].every(s => s >= 200 && s < 300), `statuses ${r1.status}/${r2.status}`);
      A('A. concurrent same-token: both carry the SAME id (idempotent return)', r1.json?.id != null && r1.json.id === r2.json?.id, `ids ${r1.json?.id}/${r2.json?.id}`);
    } else {
      console.log(`  INFO  A. (no index) concurrent endpoint race produced ${nA} row(s) — non-deterministic on localhost`);
    }

    // ── B. slow (>5s) sequential same-token re-click ──
    const qB = 12, keyB = 'tok-B';
    const b1 = await post(qB, keyB);
    await ageOut(uid, qB);
    const b2 = await post(qB, keyB);
    const nB = await movCount(uid, qB);
    if (WITH_INDEX) {
      A('B. slow >5s same-token re-click: exactly ONE row (index caught what the 5s window missed)', nB === 1, `rows=${nB}  b1=${b1.status} b2=${b2.status}`);
      A('B. slow >5s same-token re-click: 2nd response 200 with the SAME id (idempotent recover)', b2.status === 200 && b2.json?.id === b1.json?.id, `b2 ${b2.status} ids ${b1.json?.id}/${b2.json?.id}`);
    } else {
      A('B. CONTROL (no index): slow >5s same-token re-click → TWO rows — the exact FIFO-corrupting double-book, nothing stops it', nB === 2, `rows=${nB}`);
    }

    // ── C. deterministic raw-insert control (typed columns) ──
    const insRaw = () => c.query(`INSERT INTO inventory_movements (user_id, entity_id, inventory_id, type, quantity, idempotency_key) VALUES ($1,NULL,$2,'sale',13,'tok-RAW')`, [uid, invId]);
    await insRaw();
    let rawRejected = false;
    try { await insRaw(); } catch (e) { rawRejected = (e.code === '23505'); }
    const nRaw = await movCount(uid, 13);
    if (WITH_INDEX) {
      A('C. DB backstop: 2nd raw same-token insert rejected 23505 → ONE row', rawRejected && nRaw === 1, `rejected=${rawRejected} rows=${nRaw}`);
    } else {
      A('C. CONTROL (no index): 2nd raw same-token insert ACCEPTED → TWO rows', !rawRejected && nRaw === 2, `rejected=${rawRejected} rows=${nRaw}`);
    }

    // ── D. different tokens, same (item,type,qty) → TWO rows (two genuine sales of equal qty allowed) ──
    const qD = 14;
    const d1 = await post(qD, 'tok-D1');
    const d2 = await post(qD, 'tok-D2');
    A('D. different tokens, same qty: TWO rows (two genuine equal-quantity sales are legitimate — token, not a natural key)',
      (await movCount(uid, qD)) === 2, `rows=${await movCount(uid, qD)}  d1=${d1.status} d2=${d2.status}`);

    // ── E. no token, same qty, >5s apart → TWO rows; <5s apart → ONE row (typed pre-check active) ──
    const qE = 15;
    const e1 = await post(qE);
    await ageOut(uid, qE);
    const e2 = await post(qE);
    A('E. no-token, same qty >5s apart: TWO rows — 5s window expired, no token index to catch it',
      (await movCount(uid, qE)) === 2, `rows=${await movCount(uid, qE)}`);
    const qE2 = 16;
    const e2a = await post(qE2);
    const e2b = await post(qE2);
    A('E2. no-token, same qty <5s apart: ONE row (typed pre-check still active for token-less requests)',
      (await movCount(uid, qE2)) === 1, `rows=${await movCount(uid, qE2)}  e2a=${e2a.status} e2b=${e2b.status}`);

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
