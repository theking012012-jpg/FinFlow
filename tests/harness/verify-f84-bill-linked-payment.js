'use strict';
/**
 * verify-f84-bill-linked-payment.js — F84 server OPEX/AP ORACLE (Rules 4/6/14).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f84-bill-linked-payment.js
 *
 * PROVES the money lever is `bill_id` on the payments_made row, against the REAL server +
 * real scratch Postgres (no stubs). A bill is expensed at ISSUE (accrual, ruled basis). A
 * payment recorded against it is a SETTLEMENT (Dr AP / Cr Cash), NOT a fresh expense — the
 * `bill_id IS NULL` guard (server.js:4378 opex, :3589 AP, mirrored in /api/reports/profit-loss
 * :3509 and /api/reports/balance-sheet :3586) is the sole double-count guard, and it fires
 * only when the client SENDS bill_id.
 *
 * ONE scratch world, ONE server (database.js builds its pool at module scope — a singleton, so a
 * second server boot in-process reuses an ended pool; all verify-* files are one-server-per-process).
 * The SAME $500 payment is read in both shapes on the SAME bill: recorded unlinked (today's shape),
 * read, DELETED, then re-recorded via POST WITH bill_id (the F84 fix shape) and read again. Seeded
 * via the REAL routes:
 *   Bill  : issued 2026-07-10, amount 1300, status 'unpaid'   (in the pinned-clock year 2026)
 *   Payment: amount 500, date 2026-07-12
 *
 * Owner-approved oracle (Rule 6 — hand-derived, NOT read from the code under test):
 *   UNLINKED (today's savePaymentMade shape — NO bill_id):
 *       opex 1800  ( bill 1300 + orphan payment 500 — THE DOUBLE-COUNT )      AP 1300
 *   LINKED   (the F84 fix shape — bill_id set on create):
 *       opex 1300  ( bill 1300; payment excluded as a settlement )            AP  800  ( 1300 − 500 )
 * Discriminators: opex (1800 vs 1300) AND AP (1300 vs 800). Seed values distinct (1300 ≠ 500)
 * so a green assertion names its source (Rule 4 corollary).
 *
 * This is the ORACLE that establishes the numbers. It hits the server directly, so it does not
 * itself test the CLIENT bug — that fail-then-pass is verify-f84-savepaymentmade-billid.js
 * (the jsdom leg, which proves the fixed savePaymentMade actually SENDS bill_id).
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const EMAIL = 'f84@finflow.test';

async function readFigures(http) {
  const pl = await http.post('/api/reports/profit-loss', {});
  const bs = await http.post('/api/reports/balance-sheet', {});
  return { opex: Number(pl.json?.totalExpenses), ap: Number(bs.json?.accountsPayable) };
}

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: EMAIL, name: 'F84', plan: 'pro', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    );
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', { email: EMAIL, password: PW });
    if (login.status !== 200) throw new Error(`login ${login.status}: ${login.text?.slice(0, 150)}`);

    // Seed the bill via the REAL create route — issued in-period, expensed at issue.
    const bill = await http.post('/api/bills', {
      vendor: 'Acme Supplies', amount: 1300, status: 'unpaid', issue_date: '2026-07-10', due_date: '2026-07-31',
    });
    const billId = bill.json?.id;
    if (!billId) throw new Error(`bill create failed ${bill.status}: ${bill.text?.slice(0, 150)}`);

    // ── UNLINKED: today's savePaymentMade shape (NO bill_id) ──
    const payU = await http.post('/api/payments-made', { vendor: 'Acme Supplies', amount: 500, date: '2026-07-12', method: 'Bank Transfer', ref: 'PM-F84U' });
    if (payU.status !== 200 && payU.status !== 201) throw new Error(`unlinked payment failed ${payU.status}: ${payU.text?.slice(0, 150)}`);
    const unlinked = await readFigures(http);
    console.log(`  [UNLINKED — today's shape] opex=${unlinked.opex}  AP=${unlinked.ap}  (bill ${billId})`);

    // Remove it, then re-record the SAME payment the FIX way: POST WITH bill_id.
    const delId = (payU.json && (payU.json.id ?? payU.json.row?.id));
    const del = await http.del(`/api/payments-made/${delId}`);
    if (del.status !== 200) throw new Error(`delete unlinked payment failed ${del.status}: ${del.text?.slice(0, 150)}`);

    // ── LINKED: the F84 fix shape (bill_id set on create) ──
    const payL = await http.post('/api/payments-made', { vendor: 'Acme Supplies', amount: 500, date: '2026-07-12', method: 'Bank Transfer', ref: 'PM-F84L', bill_id: billId });
    if (payL.status !== 200 && payL.status !== 201) throw new Error(`linked payment failed ${payL.status}: ${payL.text?.slice(0, 150)}`);
    const linked = await readFigures(http);
    console.log(`  [LINKED   — F84 fix shape] opex=${linked.opex}  AP=${linked.ap}  (bill ${billId})`);

    // ── The discriminating negative: today's unlinked path double-counts ──
    A('UNLINKED opex === 1800 (bill 1300 + orphan payment 500 — THE DOUBLE-COUNT)',
      unlinked.opex === 1800, `opex=${unlinked.opex}`);
    A('UNLINKED AP === 1300 (payment never reduced the bill — AP overstated too)',
      unlinked.ap === 1300, `AP=${unlinked.ap}`);

    // ── The fix shape: single count + AP settled ──
    A('LINKED opex === 1300 (bill expensed once; payment excluded as a settlement)',
      linked.opex === 1300, `opex=${linked.opex}`);
    A('LINKED AP === 800 (1300 − 500 settled)',
      linked.ap === 800, `AP=${linked.ap}`);

    // ── The lever is bill_id, and only that (same seed both worlds) ──
    A('opex moves 1800 → 1300 purely by setting bill_id (Δ = the 500 double-count)',
      unlinked.opex - linked.opex === 500, `Δopex=${unlinked.opex - linked.opex}`);
    A('AP moves 1300 → 800 purely by setting bill_id (Δ = the 500 settlement)',
      unlinked.ap - linked.ap === 500, `ΔAP=${unlinked.ap - linked.ap}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch { /* ignore */ }
    try { if (scratch) await scratch.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
