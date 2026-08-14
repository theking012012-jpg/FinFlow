'use strict';
/**
 * verify-f142-f116.js — two LOW fixes, one server boot.
 *
 * F142 (Rule 14 + Rule 4): GET /api/payments-made must be entity-scoped, null-inclusive, like its
 *   siblings. Seed three rows so the bug changes the number:
 *     E1 PM1 = 100 (entity_id=E1),  E2 PM2 = 200 (entity_id=E2),  legacy PM0 = 50 (entity_id=NULL)
 *   WITH fix:  E1 list = [50,100] (250? no — sum 150),  E2 list = [50,200] (sum 250); legacy in BOTH.
 *   PRE-fix (user-scoped, no filter): BOTH = [50,100,200] (sum 350) — the cross-entity leak.
 *
 * F116: POST /api/auth/login must now return `today` (server resolvedToday) so the fresh-login path
 *   primes window._serverToday, exactly as GET /api/auth/me does on session-restore.
 *
 *   node -r ./tests/harness/clock.js -r /tmp/pg-shim.cjs tests/harness/verify-f142-f116.js
 */
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f142@finflow.test', password: 'harness-password-not-a-secret' };
const D = '2026-07-10';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    // F150 seed-debt (test-only): this harness INTENTIONALLY seeds a legacy account-wide payment
    // (PM-0, entity_id = NULL) to prove cross-entity read scoping. chk_*_entity_nn is NOT VALID
    // (enforces new writes, tolerates pre-existing NULLs), so drop it at seed time.
    await c.query(`DO $ffdrop$ DECLARE r RECORD; BEGIN
      FOR r IN SELECT conname, conrelid::regclass AS tbl FROM pg_constraint WHERE conname LIKE 'chk\\_%\\_entity\\_nn'
      LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname); END LOOP; END $ffdrop$;`);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F142', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const mkEnt = async (name) => (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name, is_active: 0 }]
    )).rows[0].id;
    const E1 = await mkEnt('Entity One');
    const E2 = await mkEnt('Entity Two');

    const mkPM = async (eid, amount, num) => c.query(
      `INSERT INTO payments_made (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
      [uid, eid, { vendor: 'V', num, amount, date: D, method: 'Card' }]);
    await mkPM(null, 50, 'PM-0');  // legacy NULL-entity
    await mkPM(E1, 100, 'PM-1');
    await mkPM(E2, 200, 'PM-2');

    const http = new HarnessHttp(server.baseUrl);

    // ── F116: login response carries today ──
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}`);
    A('F116 — login response includes `today` (YYYY-MM-DD)',
      login.json && typeof login.json.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(login.json.today),
      `today = ${login.json && login.json.today}`);

    // ── F142: list entity-scoped, null-inclusive ──
    const amountsFor = async (eid) => {
      const r = await http.get(`/api/payments-made?entity_id=${eid}`);
      const arr = Array.isArray(r.json) ? r.json : [];
      return arr.map(x => parseFloat(x.amount) || 0).sort((a, b) => a - b);
    };
    const a1 = await amountsFor(E1);
    A('F142 — E1 payments-made = [50,100] (own + legacy, NOT E2\'s 200) [pre-fix: [50,100,200]]',
      a1.length === 2 && a1[0] === 50 && a1[1] === 100, `E1 amounts = [${a1.join(',')}]`);
    const a2 = await amountsFor(E2);
    A('F142 — E2 payments-made = [50,200] (own + legacy, NOT E1\'s 100) [pre-fix: [50,100,200]]',
      a2.length === 2 && a2[0] === 50 && a2[1] === 200, `E2 amounts = [${a2.join(',')}]`);
    A('F142 — legacy NULL-entity row visible to BOTH (not hidden by scoping)',
      a1.includes(50) && a2.includes(50));

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
