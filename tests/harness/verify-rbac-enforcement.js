#!/usr/bin/env node
'use strict';
/**
 * verify-rbac-enforcement.js — EXECUTE the role→capability matrix (rbac.js) through the real server.
 * The matrix reads correct; this proves it actually BLOCKS. Roles come from the resolved membership
 * (req.accountRole), so we seed active team_members rows directly (the invite routes are gated off
 * for launch — F54 — but the resolver reads the same rows a live invite would create).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-rbac-enforcement.js
 *
 * MATRIX UNDER TEST (rbac.js MATRIX + the coarse method gate, server.js:767):
 *   · viewer     = READ-ONLY (any write → 403; report POSTs allowed)
 *   · accountant = books:write yes; payroll/team/bank/entities/audit/delete → 403
 *   · admin      = books:write + payroll + audit + delete yes; bank/entities/permissions → 403 (owner-only)
 *   · owner      = everything (the account owner in their OWN account; no membership)
 *
 * Rule 14: this IS the executed failure path for every deny — a broken gate turns a 403 into a 2xx.
 * "allow" asserts status ≠ 403 (the request passed RBAC; other codes like 201/400/404 are fine);
 * "deny" asserts status === 403. Revocation is checked via GET /api/my-access (F111).
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const ALLOW = 'allow', DENY = 'deny';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

// route probes. expected[role] = ALLOW | DENY. body kept minimal — we only care about 403-vs-not.
const PROBES = [
  { name: 'GET  /api/invoices        (books:read)',   method: 'get',  path: '/api/invoices',
    exp: { viewer: ALLOW, accountant: ALLOW, admin: ALLOW, owner: ALLOW } },
  { name: 'POST /api/invoices        (books:write)',  method: 'post', path: '/api/invoices',
    body: { client: 'X', amount: 100, status: 'pending' },
    exp: { viewer: DENY, accountant: ALLOW, admin: ALLOW, owner: ALLOW } },
  { name: 'POST /api/payroll-runs    (payroll:write)',method: 'post', path: '/api/payroll-runs',
    body: { period: '2026-07' },
    exp: { viewer: DENY, accountant: DENY, admin: ALLOW, owner: ALLOW } },
  { name: 'GET  /api/audit-log       (audit:read)',   method: 'get',  path: '/api/audit-log',
    exp: { viewer: DENY, accountant: DENY, admin: ALLOW, owner: ALLOW } },
  { name: 'POST /api/connections     (bank:manage)',  method: 'post', path: '/api/connections',
    body: { name: 'Bank', scope: 'business' },
    exp: { viewer: DENY, accountant: DENY, admin: DENY, owner: ALLOW } },
  { name: 'POST /api/entities        (entities:manage)', method: 'post', path: '/api/entities',
    body: { name: 'New Co', currency: 'USD' },
    exp: { viewer: DENY, accountant: DENY, admin: DENY, owner: ALLOW } },
  { name: 'DELETE /api/invoices/:id  (coarse: owner/admin)', method: 'del', path: '/api/invoices/999999',
    exp: { viewer: DENY, accountant: DENY, admin: ALLOW, owner: ALLOW } },
];

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const mkUser = async (email, name) => (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email, name, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;

    // Account owner A, with an ACTIVE entity so that allowed writes succeed (not a no-entity 400).
    const A_id = await mkUser('rbac-owner@finflow.test', 'Owner A');
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [A_id, { name: 'RBAC Co', currency: 'USD', is_active: 1 }]);

    // One member per role, each an ACTIVE member of A's account.
    const members = {};
    for (const role of ['viewer', 'accountant', 'admin']) {
      const uid = await mkUser(`rbac-${role}@finflow.test`, `The ${role}`);
      await c.query(`INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
        [A_id, { member_user_id: String(uid), status: 'active', role, name: `The ${role}`, email: `rbac-${role}@finflow.test` }]);
      members[role] = uid;
    }

    const http = new HarnessHttp(server.baseUrl);
    const login = async (email) => { const r = await http.post('/api/auth/login', { email, password: PW }); if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`); };
    const call = async (p) => {
      if (p.method === 'get') return http.get(p.path);
      if (p.method === 'del') return http.del ? http.del(p.path) : http.delete(p.path);
      return http.post(p.path, p.body || {});
    };

    console.log('\n' + '='.repeat(78));
    console.log('  RBAC ENFORCEMENT — role → capability matrix, executed through the real server');
    console.log('='.repeat(78));

    // owner logs into their OWN account (no membership → role owner); members log into A's account.
    const actors = [
      { role: 'owner',      email: 'rbac-owner@finflow.test' },
      { role: 'admin',      email: 'rbac-admin@finflow.test' },
      { role: 'accountant', email: 'rbac-accountant@finflow.test' },
      { role: 'viewer',     email: 'rbac-viewer@finflow.test' },
    ];
    for (const actor of actors) {
      console.log(`\n-- role: ${actor.role} --`);
      await login(actor.email);
      for (const p of PROBES) {
        const want = p.exp[actor.role];
        const r = await call(p);
        const denied = r.status === 403;
        const ok = (want === DENY) ? denied : !denied;
        A(`${actor.role.padEnd(10)} ${want.toUpperCase().padEnd(5)} ${p.name}`, ok,
          `status ${r.status} (${want === DENY ? 'expected 403' : 'expected non-403'})  body ${String(r.text || '').slice(0, 120)}`);
      }
    }

    // ── revocation: an active membership that is revoked loses access on the NEXT request (F111 view) ──
    console.log('\n-- revocation: viewer membership set to revoked → scoped back to own account --');
    await login('rbac-viewer@finflow.test');
    const before = await http.get('/api/my-access');
    A('while ACTIVE, viewer is scoped into A (scopedIntoOther)', before.json.scopedIntoOther === true,
      `scopedIntoOther=${before.json.scopedIntoOther} current=${before.json.currentAccountId}`);
    await c.query(`UPDATE team_members SET data = data || '{"status":"revoked"}'::jsonb WHERE data->>'member_user_id' = $1`, [String(members.viewer)]);
    const after = await http.get('/api/my-access');
    A('after REVOKE, viewer no longer scoped into A (next request, no session cache)',
      after.json.scopedIntoOther === false && after.json.currentAccountId === members.viewer,
      `scopedIntoOther=${after.json.scopedIntoOther} current=${after.json.currentAccountId}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (RBAC enforcement)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[rbac] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
