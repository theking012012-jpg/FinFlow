'use strict';
/**
 * verify-f90-update-audit.js — PROVE (Rule 14) that the money-table UPDATE routes write an
 * audit_trail row with an old->new snapshot. Pre-fix these 7 PUT handlers logged nothing on
 * UPDATE (only their CREATE/DELETE were audited — F90 Phase B residual):
 *
 *   journals, bills, sales_receipts, payments_received, credit_notes, payments_made, vendor_credits
 *
 * DISCRIMINATING (Rule 4): each assertion checks that new_data carries the CHANGED value, not
 * merely that some UPDATE row exists — a wrong-snapshot audit would still fail.
 *
 * FAIL-THEN-PASS: on current HEAD the 7 "... UPDATE audited" assertions FAIL; the creates/login
 * pass on both builds, so the test discriminates the fix from the bug.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90-update-audit.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f90upd@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F90UPD', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    // F150 seed-debt fix: create an active entity so req.entityId resolves (production onboarding
    // POSTs /api/entities); without it, business-route writes stamp entity_id NULL → chk_*_entity_nn.
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { name: 'F90UPD Co', currency: 'USD', is_active: 1 }]);
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    const lastId = async (table) =>
      (await c.query(`SELECT id FROM ${table} WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [uid])).rows[0]?.id;

    // Create one row per money table, then UPDATE a field to a DISTINCT new value.
    // Each entry: [route, sqlTable, createBody, updateBody, assertField, expectedNewValue]
    const cases = [];

    await http.post('/api/journals', { description: 'JE-orig', date: '2026-06-10', lines: [{ debit: 100 }, { credit: 100 }], status: 'Draft' });
    cases.push({ route: 'journals', table: 'journals', id: await lastId('journals'), upd: { description: 'JE-edited' }, field: 'description', want: 'JE-edited' });

    await http.post('/api/bills', { vendor: 'V', amount: 300 });
    cases.push({ route: 'bills', table: 'bills', id: await lastId('bills'), upd: { amount: 500 }, field: 'amount', want: '500' });

    await http.post('/api/sales-receipts', { customer: 'C', amount: 100, date: '2026-06-10' });
    cases.push({ route: 'sales-receipts', table: 'sales_receipts', id: await lastId('sales_receipts'), upd: { amount: 250 }, field: 'amount', want: '250' });

    await http.post('/api/payments-received', { customer: 'C', amount: 100 });
    cases.push({ route: 'payments-received', table: 'payments_received', id: await lastId('payments_received'), upd: { amount: 260 }, field: 'amount', want: '260' });

    await http.post('/api/credit-notes', { customer: 'C', amount: 30 });
    cases.push({ route: 'credit-notes', table: 'credit_notes', id: await lastId('credit_notes'), upd: { amount: 70 }, field: 'amount', want: '70' });

    await http.post('/api/payments-made', { vendor: 'V', amount: 200 });
    cases.push({ route: 'payments-made', table: 'payments_made', id: await lastId('payments_made'), upd: { amount: 275 }, field: 'amount', want: '275' });

    await http.post('/api/vendor-credits', { vendor: 'V', amount: 20 });
    cases.push({ route: 'vendor-credits', table: 'vendor_credits', id: await lastId('vendor_credits'), upd: { amount: 45 }, field: 'amount', want: '45' });

    // Sanity: every create landed.
    for (const k of cases) A(`create ${k.table} (control, passes on both builds)`, k.id != null, `id=${k.id}`);

    // Fire the updates.
    for (const k of cases) await http.put(`/api/${k.route}/${k.id}`, k.upd);

    // Assert: each table has an UPDATE audit row whose new_data carries the changed value.
    const rows = (await c.query(
      `SELECT table_name, record_id, new_data FROM audit_trail WHERE user_id=$1 AND action='UPDATE'`, [uid]
    )).rows;
    for (const k of cases) {
      const hit = rows.find(r => r.table_name === k.table && Number(r.record_id) === Number(k.id));
      const val = hit && hit.new_data ? String(hit.new_data[k.field]) : null;
      A(`${k.table} UPDATE audited with new_data.${k.field}=${k.want}`, val === k.want,
        hit ? `new_data.${k.field}=${val}` : `no UPDATE audit row for ${k.table}#${k.id}`);
    }

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
