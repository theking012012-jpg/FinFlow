#!/usr/bin/env node
'use strict';
/**
 * verify-f111-access-visibility.js — the remediation half of F107. A login that is an ACTIVE member
 * of another account is silently scoped INTO that account by the resolver (req.accountId =
 * account_owner_id), yet NO endpoint reads the member axis for display: GET /api/team reads the
 * OWNER axis (people you invited), so an inbound membership that relocates your session is invisible.
 * GET /api/my-access (F111) fills the gap — read-only, no writes, no new permissions.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f111-access-visibility.js
 *
 * SEED (Rule 4 — three distinct roles):
 *   A — account owner.  B — owns B's account AND is an ACTIVE member of A.  C — no memberships.
 *
 * ASSERTED:
 *   · B: /api/my-access lists BOTH accounts (own B + A), reports scopedIntoOther=true and
 *        currentAccountId=A — i.e. B's session is operating inside A's books, and now says so.
 *   · GET /api/team for B lists the roster of the account B works in (A's owner) — N15 made the roster
 *        account-scoped (it used to read B's own invites, hiding A: the F107 invisibility).
 *   · C (control): no memberships → scopedIntoOther=false, currentAccountId=C, own account only.
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, got, want, d) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else { fail++; console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want) + (d ? '\n          ' + d : '')); }
};

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
    const A_id = await mkUser('owner-a@finflow.test', 'Owner A');
    const B_id = await mkUser('member-b@finflow.test', 'Member B');
    const C_id = await mkUser('solo-c@finflow.test', 'Solo C');
    // B is an ACTIVE member of A's account (the row the resolver reads; invite→accept shape).
    await c.query(
      `INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [A_id, { member_user_id: String(B_id), status: 'active', role: 'member', name: 'Member B', email: 'member-b@finflow.test', invited_by: String(A_id) }]
    );

    const http = new HarnessHttp(server.baseUrl);
    const login = async (email) => { const r = await http.post('/api/auth/login', { email, password: PW }); if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`); };

    console.log('\n' + '='.repeat(78));
    console.log('  F111 — MEMBER-AXIS ACCESS VISIBILITY (GET /api/my-access), real server + Postgres');
    console.log('='.repeat(78));

    // ── B: the active member scoped into A ──
    console.log('\n-- 1 - B (active member of A) --');
    await login('member-b@finflow.test');
    const acc = await http.get('/api/my-access');
    A('GET /api/my-access → 200', acc.status, 200, acc.text.slice(0, 160));
    A('B.ownAccountId == B', acc.json.ownAccountId, B_id);
    A('B is scoped INTO another account (scopedIntoOther)', acc.json.scopedIntoOther, true,
      'the resolver set req.accountId to A via the active membership');
    A('B.currentAccountId == A (session operating in A’s books)', acc.json.currentAccountId, A_id);
    const ids = (acc.json.accounts || []).map(x => x.accountOwnerId).sort((a, b) => a - b);
    A('B can access BOTH accounts (own B + A)', ids, [A_id, B_id].sort((a, b) => a - b));
    const aRow = (acc.json.accounts || []).find(x => x.accountOwnerId === A_id);
    A('A appears as a non-own account with its owner email', !!aRow && aRow.isOwn === false && aRow.ownerEmail === 'owner-a@finflow.test', true, `row ${JSON.stringify(aRow)}`);

    // ── /api/team is the roster of the account the session WORKS IN (N15) ──
    // Before N15 this was a CONTRAST: /api/team read the signed-in person's own invites (the owner axis), so
    // B — whose session works inside A's books — never saw A's roster (the F107 invisibility). N15 made the
    // roster account-scoped like every other account read: B now sees A's owner and itself as a member.
    console.log('\n-- 2 - /api/team for B lists the account B works in (A) --');
    const team = await http.get('/api/team');
    const teamHasA = (team.json || []).some(m => (m.email || '').toLowerCase() === 'owner-a@finflow.test' && m.role === 'owner');
    A('GET /api/team for B lists account A\'s owner (N15: roster of the account in use; was hidden — F107)', teamHasA, true,
      `team ${JSON.stringify((team.json || []).map(m => m.email))}`);
    A('…and /api/my-access lists A among B\'s accounts', !!aRow, true);

    // ── C: control — no memberships ──
    console.log('\n-- 3 - C (no memberships) --');
    await login('solo-c@finflow.test');
    const accC = await http.get('/api/my-access');
    A('C.scopedIntoOther == false', accC.json.scopedIntoOther, false);
    A('C.currentAccountId == C', accC.json.currentAccountId, C_id);
    A('C sees ONLY its own account', (accC.json.accounts || []).map(x => x.accountOwnerId), [C_id]);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (F111 member-axis visibility)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[f111] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
