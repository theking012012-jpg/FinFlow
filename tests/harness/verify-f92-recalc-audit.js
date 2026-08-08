'use strict';
/**
 * verify-f92-recalc-audit.js — PROVE (Rule 14) that the two SIDE-EFFECT money writers now land in the
 * audit trail: recalcInvoiceStatus (invoices.status/amount_paid, triggered by POST /api/invoice-payments)
 * and recalcBillStatus (bills.status/amount_paid, triggered by POST /api/payments-made). Pre-fix these
 * moved AR/AP with NO audit entry (invisible to route-based audit — F92).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f92-recalc-audit.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f92@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  const auditRows = async (c, uid, table) =>
    (await c.query(`SELECT action, new_value FROM audit_trail WHERE user_id=$1 AND table_name=$2 AND action='RECALC'`, [uid, table])).rows;

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F92', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const invId = (await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { client: 'C', amount: 1000, status: 'pending', issue_date: '2026-06-10' }])).rows[0].id;
    const billId = (await c.query(`INSERT INTO bills (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { vendor: 'V', amount: 500, status: 'unpaid', issue_date: '2026-06-10' }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // ── invoice payment → recalcInvoiceStatus side-effect write ──
    const p1 = await http.post('/api/invoice-payments', { invoice_id: invId, amount: 400, payment_date: '2026-06-20' });
    A('record invoice payment 400 → 2xx', p1.status >= 200 && p1.status < 300, `status ${p1.status}`);
    const inv = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM invoices WHERE id=$1`, [invId])).rows[0];
    A('invoice recalc happened (partial / 400)', inv.s === 'partial' && Math.round(parseFloat(inv.p)) === 400, JSON.stringify(inv));
    const ia = await auditRows(c, uid, 'invoices');
    A('recalcInvoiceStatus is AUDITED (RECALC entry exists) [pre-fix: none]', ia.length >= 1, `rows=${ia.length}`);
    A('audit entry records the movement (new_value contains "partial / 400")', ia.some(r => /partial/.test(r.new_value) && /400/.test(r.new_value)),
      JSON.stringify(ia.map(r => r.new_value)));

    // ── bill payment → recalcBillStatus side-effect write ──
    const p2 = await http.post('/api/payments-made', { vendor: 'V', amount: 200, date: '2026-06-20', bill_id: billId });
    A('record bill payment 200 → 2xx', p2.status >= 200 && p2.status < 300, `status ${p2.status}`);
    const ba = await auditRows(c, uid, 'bills');
    A('recalcBillStatus is AUDITED (RECALC entry exists) [pre-fix: none]', ba.length >= 1, `rows=${ba.length}`);
    A('bill audit entry records the movement (partial / 200)', ba.some(r => /partial/.test(r.new_value) && /200/.test(r.new_value)),
      JSON.stringify(ba.map(r => r.new_value)));

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
