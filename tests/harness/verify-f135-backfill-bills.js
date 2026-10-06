'use strict';
/**
 * verify-f135-backfill-bills.js — (N90 update: the backfill is no longer run at boot; see the N90 assertions.)
 * Originally: PROVE (Rule 14) that the F135 boot-backfill (database.js) heals
 * EXISTING bills marked 'paid' with amount_paid NULL/0 to amount_paid = amount, WITHOUT touching a
 * genuinely part-paid bill, a correctly-paid bill, or an unpaid bill. Owner-gated data change (Rule 8),
 * its own commit.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f135-backfill-bills.js
 *
 * Real scratch Postgres. The backfill runs inside initDB(). We build the schema (initDB #1 over an
 * empty table — no-op), then insert LEGACY rows DIRECTLY via SQL — bypassing the F135-fixed create
 * route, so they carry the pre-fix shape (a 'paid' row with NO amount_paid key) exactly as production
 * rows 10/11/12/13 did on the invoice side. Then we run initDB() AGAIN to fire the backfill over them.
 *
 * Legacy seed (distinct amounts so a green assertion names its source, Rule 4):
 *   STUCK   {900,  'paid',    amount_paid ABSENT}  — the F135 case → must heal to 900
 *   CORRECT {600,  'paid',    amount_paid 600}     — already right → unchanged
 *   PARTIAL {1000, 'partial', amount_paid 400}     — real part-payment → unchanged (status ≠ 'paid')
 *   UNPAID  {500,  'unpaid',  amount_paid ABSENT}  — unchanged
 * EXPECTED:
 *   CURRENT database.js (no bills backfill): STUCK.amount_paid stays absent/0 → FAIL.
 *   FIXED   database.js: STUCK.amount_paid === 900; the other three untouched → ALL GREEN.
 */

const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema } = require('./boot.js');

(async () => {
  let scratch, appPool, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;

    // initDB #1 — build the schema; the backfill runs over an EMPTY bills table (heals nothing).
    const { database } = await initSchema(scratch.url);
    appPool = database.pool;
    // F150 seed-debt (test-only): this harness INTENTIONALLY seeds legacy account-wide bills
    // (entity_id = NULL) to prove the F135 backfill heals them. chk_bills_entity_nn is NOT VALID
    // (enforces new writes, tolerates pre-existing NULLs), so drop it at seed time; later initDB
    // re-adds it NOT VALID over the now-legacy rows without scanning them.
    await c.query(`DO $ffdrop$ DECLARE r RECORD; BEGIN
      FOR r IN SELECT conname, conrelid::regclass AS tbl FROM pg_constraint WHERE conname LIKE 'chk\\_%\\_entity\\_nn'
      LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname); END LOOP; END $ffdrop$;`);

    // A real owner row (bills.user_id has an FK to users). The backfill itself is user-agnostic.
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'f135-backfill@finflow.test', name: 'F135BF', plan: 'pro', role: 'owner' }]
    )).rows[0].id;

    // Insert LEGACY rows directly (pre-F135 shape). STUCK/UNPAID omit amount_paid entirely.
    const ins = (data) => c.query(
      `INSERT INTO bills (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, data]
    );
    await ins({ vendor: 'STUCK',   num: 'BILL-9001', amount: 900,  status: 'paid',    issue_date: '2026-07-10' });
    await ins({ vendor: 'CORRECT', num: 'BILL-9002', amount: 600,  status: 'paid',    issue_date: '2026-07-10', amount_paid: 600 });
    await ins({ vendor: 'PARTIAL', num: 'BILL-9003', amount: 1000, status: 'partial', issue_date: '2026-07-10', amount_paid: 400 });
    await ins({ vendor: 'UNPAID',  num: 'BILL-9004', amount: 500,  status: 'unpaid',  issue_date: '2026-07-10' });

    // Sanity: STUCK really has no amount_paid before the backfill (the bug precondition).
    const pre = (await c.query(`SELECT data->>'amount_paid' AS ap FROM bills WHERE data->>'vendor'='STUCK'`)).rows[0];
    A('precondition: STUCK bill has NO amount_paid before backfill', pre.ap == null, `amount_paid=${JSON.stringify(pre.ap)}`);

    // initDB #2 — fires the F135 bills backfill over the legacy rows (idempotent).
    await database.initDB();

    const rows = (await c.query(
      `SELECT data->>'vendor' AS vendor, (data->>'amount')::numeric AS amount,
              data->>'amount_paid' AS amount_paid_raw, data->>'status' AS status FROM bills`
    )).rows;
    const by = v => rows.find(r => r.vendor === v) || {};
    const num = v => v == null ? null : (parseFloat(v) || 0);
    const stuck = by('STUCK'), correct = by('CORRECT'), partial = by('PARTIAL'), unpaid = by('UNPAID');

    console.log(`  [after backfill] STUCK.amount_paid=${JSON.stringify(stuck.amount_paid_raw)}  CORRECT=${JSON.stringify(correct.amount_paid_raw)}  PARTIAL=(${JSON.stringify(partial.amount_paid_raw)},${partial.status})  UNPAID=${JSON.stringify(unpaid.amount_paid_raw)}`);

    // N90 (Rule 8): the boot no longer changes money data — the F135 backfill is OUT of initDB. A boot leaves the
    // STUCK row exactly as it was; scripts/report-paid-without-payment.js (read-only) lists it for an owner
    // decision instead of a silent per-deploy stamp with no payment behind it.
    A('N90: a boot leaves STUCK unchanged (no amount_paid stamped without a payment)',
      stuck.amount_paid_raw == null, `amount_paid=${JSON.stringify(stuck.amount_paid_raw)}`);
    A('CORRECT untouched: amount_paid still 600 (idempotent — already equal to amount)',
      num(correct.amount_paid_raw) === 600, `amount_paid=${JSON.stringify(correct.amount_paid_raw)}`);
    A('PARTIAL preserved: amount_paid still 400, status partial (real part-payment NOT clobbered)',
      num(partial.amount_paid_raw) === 400 && partial.status === 'partial', `PARTIAL=${JSON.stringify({ amount_paid: partial.amount_paid_raw, status: partial.status })}`);
    A('UNPAID untouched: no amount_paid, status unpaid (backfill only touches paid-below-amount)',
      unpaid.amount_paid_raw == null && unpaid.status === 'unpaid', `UNPAID=${JSON.stringify({ amount_paid: unpaid.amount_paid_raw, status: unpaid.status })}`);

    // The read-only report names the STUCK row (and only it among these four).
    const out = require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', '..', 'scripts', 'report-paid-without-payment.js')], { env: Object.assign({}, process.env, { DATABASE_URL: scratch.url }), encoding: 'utf8' });
    // STUCK (no amount_paid) and CORRECT (amount_paid 600 but NO payment row behind it) are both 'paid' without
    // covering payments; PARTIAL and UNPAID are not 'paid' and are not listed.
    A('N90: report-paid-without-payment lists STUCK and CORRECT (paid, no payment rows), not PARTIAL/UNPAID',
      /STUCK: amount 900/.test(out) && /CORRECT: amount 600/.test(out) && /Bills marked paid without covering payments: 2/.test(out) && !/PARTIAL|UNPAID/.test(out), out.slice(0, 400));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    fail++;
  } finally {
    try { if (appPool) await appPool.end(); } catch { /* ignore */ }
    try { if (scratch) await scratch.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
