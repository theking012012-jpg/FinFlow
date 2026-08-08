'use strict';
/**
 * verify-f26-receipt-entity-scoping.js — PROVE (Rule 14) that sales_receipts is now entity-scoped
 * on the money surfaces (computeBooks via GET /api/reports) and the list (GET /api/sales-receipts),
 * and DISCRIMINATE (Rule 4) with two entities holding different amounts plus a legacy NULL-entity
 * receipt shared by both.
 *
 * Seed (only receipts, so computeBooks revenue == Σ receipts — no invoices/credits to muddy it):
 *   E1 receipt R1 = 100   (entity_id = E1)
 *   E2 receipt R2 = 200   (entity_id = E2)
 *   legacy R0    =  50   (entity_id = NULL — pre-`e1319ef` row; must stay visible to BOTH)
 *
 * Expected WITH fix (null-inclusive scope):  E1 revenue = 150 (R1+R0),  E2 revenue = 250 (R2+R0).
 * Pre-fix (user-scoped, no filter):          BOTH = 350 (R1+R2+R0)  ← the cross-entity leak.
 * The legacy R0 shows in both under the fix — so scoping did NOT hide it (the ledger's data-order
 * concern only applied to STRICT scoping; this predicate is the same one every sibling table uses).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f26-receipt-entity-scoping.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f26@finflow.test', password: 'harness-password-not-a-secret' };
const D = '2026-07-10';   // inside the pinned-clock FY (clock 2026-07-25), not future

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F26', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const mkEnt = async (name) => (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name, is_active: 0 }]
    )).rows[0].id;
    const E1 = await mkEnt('Entity One');
    const E2 = await mkEnt('Entity Two');

    // legacy NULL-entity receipt (pre-sweep row), direct insert
    await c.query(
      `INSERT INTO sales_receipts (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { customer: 'Legacy', num: 'SR-0', amount: 50, date: D, method: 'Cash' }]);

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    const r1 = await http.post(`/api/sales-receipts?entity_id=${E1}`, { customer: 'A', amount: 100, date: D });
    const r2 = await http.post(`/api/sales-receipts?entity_id=${E2}`, { customer: 'B', amount: 200, date: D });
    A('seed R1 (E1,100) created', r1.status === 200 || r1.status === 201, `status ${r1.status}`);
    A('seed R2 (E2,200) created', r2.status === 200 || r2.status === 201, `status ${r2.status}`);

    // ── money surface: computeBooks revenue via GET /api/reports (revenue == Σ receipts here) ──
    const rep1 = await http.get(`/api/reports?entity_id=${E1}`);
    A('E1 revenue = 150 (R1 100 + legacy R0 50; R2 excluded) [pre-fix: 350]',
      rep1.status === 200 && Math.abs((rep1.json.revenue || 0) - 150) < 0.005,
      `revenue = ${rep1.json && rep1.json.revenue}`);

    const rep2 = await http.get(`/api/reports?entity_id=${E2}`);
    A('E2 revenue = 250 (R2 200 + legacy R0 50; R1 excluded) [pre-fix: 350]',
      rep2.status === 200 && Math.abs((rep2.json.revenue || 0) - 250) < 0.005,
      `revenue = ${rep2.json && rep2.json.revenue}`);

    // ── list surface: GET /api/sales-receipts scoped ──
    const list1 = await http.get(`/api/sales-receipts?entity_id=${E1}`);
    const arr1 = Array.isArray(list1.json) ? list1.json : [];
    const sum1 = arr1.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
    const amts1 = arr1.map(x => parseFloat(x.amount) || 0).sort((a, b) => a - b);
    A('E1 receipts list = [50,100] (own + legacy, not E2\'s 200) [pre-fix: [50,100,200]]',
      sum1 === 150 && amts1.length === 2 && amts1[0] === 50 && amts1[1] === 100,
      `list amounts = [${amts1.join(',')}]`);

    // legacy R0 visible to BOTH (not hidden by scoping)
    const list2 = await http.get(`/api/sales-receipts?entity_id=${E2}`);
    const arr2 = Array.isArray(list2.json) ? list2.json : [];
    const hasLegacyBoth = arr1.some(x => (parseFloat(x.amount)||0) === 50) && arr2.some(x => (parseFloat(x.amount)||0) === 50);
    A('legacy NULL-entity receipt still visible to BOTH entities (not hidden — no data dependency)',
      hasLegacyBoth, `E1 has50=${arr1.some(x=>(parseFloat(x.amount)||0)===50)} E2 has50=${arr2.some(x=>(parseFloat(x.amount)||0)===50)}`);

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
