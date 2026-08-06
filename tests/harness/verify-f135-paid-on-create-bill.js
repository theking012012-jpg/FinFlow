'use strict';
/**
 * verify-f135-paid-on-create-bill.js — PROVE (Rule 14) that a bare status='paid' on a BILL (create
 * OR edit) sets amount_paid = amount, so a paid bill drops out of AP instead of being counted at full
 * face. Symmetric AP mirror of F133 (which did the same on the invoice/AR side).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f135-paid-on-create-bill.js
 *
 * Server booted FIRST over an EMPTY bills table — and there is NO bills boot-backfill (the F56
 * backfill, database.js:112, is invoices-only), so nothing can heal these rows behind the fix. Bills
 * are then seeded via the REAL routes, no reboot, so the create/edit-path bug is visible.
 *
 * AP = Σ max(0, amount − amount_paid) over recognized bills (server.js:3589, /api/reports/balance-sheet).
 *
 * Seed (owner-approved oracle, Rule 6 — mirrors F133's 1300/500/1000+400 AR seed):
 *   Bill P {1300, 'paid'}                              — the F135 create case
 *   Bill U {500,  'unpaid'}                            — control
 *   Bill L {1000, 'unpaid'} + $400 linked payment      — partial path (recalcBillStatus owns amount_paid)
 *   Bill E {700,  'unpaid'} then PUT {status:'paid'}    — the edit-path leg
 * Figures (AP over all four = Σ max(0, amount − amount_paid)):
 *   FIXED : AP 1100  (P 0 + U 500 + L 600 + E 0)   P.amount_paid 1300   E.amount_paid 700
 *   BUGGY : AP 3100  (P 1300 + U 500 + L 600 + E 700)  P/E.amount_paid absent/0
 * Discriminators: AP total, P.amount_paid, E.amount_paid. Distinct seed values name their source (Rule 4).
 * The P/U/L subset alone mirrors F133 exactly (AP 1100 fixed / 2400 buggy); E adds the edit leg (+0/+700).
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f135@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    // Boot FIRST — initDB runs over an EMPTY bills table (and there is no bills backfill to heal anything).
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F135', plan: 'pro', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 150)}`);

    // Seed via the REAL create route, AFTER boot, no reboot — the create/edit-path bug is not masked.
    const iss = '2026-07-10';   // in-period, ≤ pinned today (AP D2 excludes future-dated bills)
    const P = await http.post('/api/bills', { vendor: 'Vendor P', amount: 1300, status: 'paid',   issue_date: iss, due_date: '2026-07-31' });
    const U = await http.post('/api/bills', { vendor: 'Vendor U', amount: 500,  status: 'unpaid', issue_date: iss, due_date: '2026-07-31' });
    const L = await http.post('/api/bills', { vendor: 'Vendor L', amount: 1000, status: 'unpaid', issue_date: iss, due_date: '2026-07-31' });
    const E = await http.post('/api/bills', { vendor: 'Vendor E', amount: 700,  status: 'unpaid', issue_date: iss, due_date: '2026-07-31' });
    A('bill creates ok', [P, U, L, E].every(r => r.status === 200 && r.json?.id), `ids ${P.json?.id}/${U.json?.id}/${L.json?.id}/${E.json?.id}`);

    // Bill L: a real $400 linked payment → recalcBillStatus → amount_paid 400, status 'partial'.
    const payL = await http.post('/api/payments-made', { vendor: 'Vendor L', amount: 400, date: '2026-07-12', method: 'Bank Transfer', ref: 'PM-F135L', bill_id: L.json.id });
    A('bill L $400 linked payment ok', payL.status === 200 || payL.status === 201, `status ${payL.status}: ${payL.text?.slice(0, 150)}`);

    // Bill E: edit to 'paid' via the real PUT — the edit-path leg (no linked payment).
    const putE = await http.put(`/api/bills/${E.json.id}`, { status: 'paid' });
    A('bill E edit→paid ok', putE.status === 200, `status ${putE.status}: ${putE.text?.slice(0, 150)}`);

    // Read back the REAL surfaces.
    const bs = await http.post('/api/reports/balance-sheet', {});
    const ap = Number(bs.json?.accountsPayable);
    const list = await http.get('/api/bills');
    const bills = Array.isArray(list.json) ? list.json : [];
    const num = v => parseFloat(v) || 0;
    const byVendor = v => bills.find(b => b.vendor === v) || {};
    const bP = byVendor('Vendor P'), bU = byVendor('Vendor U'), bL = byVendor('Vendor L'), bE = byVendor('Vendor E');

    console.log(`  [figures] AP=${ap}  P.amount_paid=${JSON.stringify(bP.amount_paid)}  E.amount_paid=${JSON.stringify(bE.amount_paid)}  L=(${JSON.stringify(bL.amount_paid)},${bL.status})  U=(${JSON.stringify(bU.amount_paid)},${bU.status})`);

    A('AP === 1100 (P 0 + U 500 + L 600 + E 0)',
      ap === 1100, `AP=${ap}  (buggy=3100 — P & E counted at full face)`);
    A('Bill P.amount_paid === 1300 (create-as-paid sets amount_paid = amount)',
      num(bP.amount_paid) === 1300, `amount_paid=${JSON.stringify(bP.amount_paid)}  (buggy: absent/0)`);
    A('Bill E.amount_paid === 700 (edit→paid sets amount_paid = amount — PUT guard)',
      num(bE.amount_paid) === 700, `amount_paid=${JSON.stringify(bE.amount_paid)}  (buggy: absent/0)`);
    A('partial path intact: Bill L amount_paid 400, status partial (fix does not clobber recalcBillStatus)',
      num(bL.amount_paid) === 400 && (bL.status || '').toLowerCase() === 'partial', `L=${JSON.stringify({ amount_paid: bL.amount_paid, status: bL.status })}`);
    A('control: Bill U unchanged (unpaid, no amount_paid) — full face still owed',
      num(bU.amount_paid) === 0 && (bU.status || '').toLowerCase() === 'unpaid', `U=${JSON.stringify({ amount_paid: bU.amount_paid, status: bU.status })}`);
    A('sanity: AP === Σ max(0, amount − amount_paid) over the four bills',
      ap === bills.reduce((s, b) => s + Math.max(0, num(b.amount) - num(b.amount_paid)), 0),
      `AP=${ap} vs Σ=${bills.reduce((s, b) => s + Math.max(0, num(b.amount) - num(b.amount_paid)), 0)}`);

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
