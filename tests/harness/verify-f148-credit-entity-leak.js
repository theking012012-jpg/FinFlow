'use strict';
/**
 * verify-f148-credit-entity-leak.js (Rule 6 + Rule 14 + Rule 4) — a credit note (revenue contra,
 * F58) must reduce ONLY its own entity's revenue. Before the fix credit_notes stored no entity_id,
 * so computeBooks' null-inclusive matchEnt subtracted every credit note from EVERY entity's revenue
 * (a fresh entity showed NEGATIVE revenue — the owner's -TT$960).
 *
 * Seed (accrual, issue-based revenue = Σ issued invoices, minus credit-note contra):
 *   E1 invoice = 1000 (entity E1)      E2 invoice = 2000 (entity E2)
 *   E1 credit note = 300 (POST ?entity_id=E1)   ← belongs to E1 only
 *
 * Expected WITH fix:  E1 revenue = 700 (1000-300),  E2 revenue = 2000 (UNTOUCHED).
 * PRE-fix (account-wide CN): E1 = 700, E2 = 1700  ← the cross-entity money leak. E2 is the discriminator.
 *
 *   node -r ./tests/harness/clock.js -r /tmp/pg-shim.cjs tests/harness/verify-f148-credit-entity-leak.js
 */
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f148@finflow.test', password: 'harness-password-not-a-secret' };
const D = '2026-07-10';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F148', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const mkEnt = async (name) => (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name, is_active: 0 }]
    )).rows[0].id;
    const E1 = await mkEnt('Entity One');
    const E2 = await mkEnt('Entity Two');

    // issued invoices (status 'pending' is on the accrual revenue allowlist, Rule 11)
    const mkInv = async (eid, amount) => c.query(
      `INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, eid, { client: 'C', amount, status: 'pending', issue_date: D, date: D }]);
    await mkInv(E1, 1000);
    await mkInv(E2, 2000);

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // credit note in E1 only, via the real POST (this is what must store entity_id now)
    const cn = await http.post(`/api/credit-notes?entity_id=${E1}`, { customer: 'C', amount: 300, date: D });
    A('E1 credit note created', cn.status === 200 || cn.status === 201, `status ${cn.status} ${cn.text?.slice(0,120)}`);

    const rev = async (eid) => {
      const r = await http.get(`/api/reports?entity_id=${eid}`);
      return r.status === 200 ? (r.json.revenue || 0) : NaN;
    };
    const r1 = await rev(E1), r2 = await rev(E2);
    A('E1 revenue = 700 (1000 − its own 300 credit note)', Math.abs(r1 - 700) < 0.005, `E1 revenue = ${r1}`);
    A('E2 revenue = 2000 (NOT reduced by E1\'s credit note) [pre-fix: 1700]', Math.abs(r2 - 2000) < 0.005, `E2 revenue = ${r2}`);
    A('neither entity shows negative revenue', r1 >= 0 && r2 >= 0, `E1=${r1} E2=${r2}`);

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
