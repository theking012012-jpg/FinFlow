#!/usr/bin/env node
'use strict';
/**
 * verify-team-invite-accept.js — the invite→accept flow that turns a pending team_members row into an
 * ACTIVE membership, plus its security guards, executed. Pairs with verify-f54-team-scope.js: accept
 * produces the active row, F54 then scopes the member into the owner's books. The invite-CREATE route
 * is gated off for launch (403), so this drives accept (ungated) against seeded pending invites, and
 * asserts the F54 payoff (the accepted member sees the owner's invoices).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-team-invite-accept.js
 *
 * Covers: new-user accept → active + logged in + sees owner books; existing-email requires password
 * (leaked token ≠ access); expired token rejected; single-use (re-accept fails); owner-self-accept
 * rejected. Token hashing mirrors server.js hashInviteToken (sha256).
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const hashTok = t => crypto.createHash('sha256').update(String(t)).digest('hex');
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const ownerId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: 'inv-owner@finflow.test', name: 'Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [ownerId, { name: 'Owner Co', currency: 'USD', is_active: 1 }]);

    const owner = new HarnessHttp(server.baseUrl);
    await owner.post('/api/auth/login', { email: 'inv-owner@finflow.test', password: PW });
    // Give the account a book to see, via the real route (account-scoped by F54).
    await owner.post('/api/invoices', { client: 'Owner-Book', amount: 1000, status: 'pending', issue_date: '2026-07-10' });

    // Helper: seed a PENDING invite for the owner's account.
    const seedInvite = (email, role, token, expIso) => c.query(
      `INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [ownerId, { email, role, status: 'pending', invite_token_hash: hashTok(token),
                  invite_expires: expIso || new Date(Date.now() + 7 * 864e5).toISOString(), invited_by: String(ownerId) }]
    );

    console.log('\n' + '='.repeat(78));
    console.log('  TEAM INVITE → ACCEPT (flow + guards, real server + real Postgres)');
    console.log('='.repeat(78));

    // ── 0 · the invite CREATE route is ENABLED (was 403 "coming soon") ──
    console.log('\n-- 0 - owner invites via the real route (now enabled) --');
    const invR = await owner.post('/api/team/invite', { email: 'routed@finflow.test', role: 'admin', name: 'Routed' });
    A('POST /api/team/invite → 201 (no longer gated)', invR.status === 201, `status ${invR.status}: ${invR.text.slice(0,140)}`);
    const pend = (await c.query(`SELECT data->>'status' AS s, data->>'role' AS role, data ? 'invite_token_hash' AS tok FROM team_members WHERE data->>'email'='routed@finflow.test'`)).rows[0];
    A('a PENDING invite row was created (status/role/hashed token)', pend && pend.s === 'pending' && pend.role === 'admin' && pend.tok === true, `row ${JSON.stringify(pend)}`);
    A('invite rejects role "owner" (400)', (await owner.post('/api/team/invite', { email: 'x2@finflow.test', role: 'owner' })).status === 400);

    // ── 1 · NEW-USER accept → active membership, logged in, sees the owner's books (F54 payoff) ──
    console.log('\n-- 1 - new user accepts an admin invite --');
    await seedInvite('newbie@finflow.test', 'admin', 'TOKEN-NEW');
    const acc = new HarnessHttp(server.baseUrl);
    const r1 = await acc.post('/api/team/accept', { token: 'TOKEN-NEW', name: 'Newbie', password: PW });
    A('accept → 200, role admin', r1.status === 200 && r1.json && r1.json.role === 'admin', `status ${r1.status}: ${r1.text.slice(0,140)}`);
    const row = (await c.query(`SELECT data->>'status' AS s, data->>'member_user_id' AS m, data ? 'invite_token_hash' AS tok FROM team_members WHERE data->>'email'='newbie@finflow.test'`)).rows[0];
    A('pending row is now ACTIVE with member_user_id set', row && row.s === 'active' && !!row.m, `row ${JSON.stringify(row)}`);
    A('single-use: invite_token_hash removed after accept', row && row.tok === false, `tok present? ${row && row.tok}`);
    const newUser = (await c.query(`SELECT id FROM users WHERE lower(data->>'email')='newbie@finflow.test'`)).rows[0];
    A('a real users row was created for the new member', !!newUser);
    // the accept session is logged in as the member → F54 scopes them into the owner's account
    const mInv = (await acc.get('/api/invoices')).json || [];
    A('accepted member SEES the owner\'s invoice (F54 integration)', mInv.some(i => i.client === 'Owner-Book'),
      `member sees: ${JSON.stringify(mInv.map(i => i.client))}`);

    // ── 2 · single-use: re-accepting the same (now consumed) token fails ──
    console.log('\n-- 2 - single-use token --');
    A('re-accept same token → 400 (already consumed)', (await new HarnessHttp(server.baseUrl).post('/api/team/accept', { token: 'TOKEN-NEW', password: PW })).status === 400);

    // ── 3 · EXISTING email requires identity proof (a leaked token must not grant access) ──
    console.log('\n-- 3 - existing-email accept needs the password --');
    await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: 'existing@finflow.test', name: 'Existing', role: 'owner', password: bcrypt.hashSync(PW, 10) }]);
    await seedInvite('existing@finflow.test', 'viewer', 'TOKEN-EXIST');
    const noPw = new HarnessHttp(server.baseUrl);
    A('existing email, NO password → 401 existing_account', (await noPw.post('/api/team/accept', { token: 'TOKEN-EXIST' })).status === 401);
    A('existing email, WRONG password → 401', (await new HarnessHttp(server.baseUrl).post('/api/team/accept', { token: 'TOKEN-EXIST', password: 'wrong-password' })).status === 401);
    const okPw = new HarnessHttp(server.baseUrl);
    A('existing email, CORRECT password → 200', (await okPw.post('/api/team/accept', { token: 'TOKEN-EXIST', password: PW })).status === 200);

    // ── 4 · expired + invalid tokens ──
    console.log('\n-- 4 - expired / invalid tokens --');
    await seedInvite('late@finflow.test', 'viewer', 'TOKEN-EXPIRED', new Date(Date.now() - 864e5).toISOString());
    A('expired token → 400', (await new HarnessHttp(server.baseUrl).post('/api/team/accept', { token: 'TOKEN-EXPIRED', password: PW })).status === 400);
    A('garbage token → 400', (await new HarnessHttp(server.baseUrl).post('/api/team/accept', { token: 'no-such-token', password: PW })).status === 400);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (team invite→accept flow)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[invite-accept] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
