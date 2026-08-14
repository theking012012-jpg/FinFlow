#!/usr/bin/env node
'use strict';
/**
 * verify-f54-team-scope.js — an invited team member operates INSIDE the owner's account: they see the
 * owner's business books, what they create the owner sees, and vice versa — while their PERSONAL data
 * stays their own. Previously reads/creates keyed on req.session.userId (the actor), so a member saw
 * an empty app and everything they made was invisible to the owner (F54). The fix routes business
 * data scope through scopeId(req) = the resolved account owner; personal tables stay actor-scoped.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f54-team-scope.js
 *
 * scopeId(req) == req.session.userId for an OWNER, so this is a no-op for every existing (owner)
 * harness — the regression suite is the owner-side guard; this probe is the member side.
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
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

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
    const ownerId  = await mkUser('f54-owner@finflow.test', 'Owner');
    const memberId = await mkUser('f54-member@finflow.test', 'Member');
    // Owner's active entity (member's business writes stamp the owner's entity via the resolver).
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [ownerId, { name: 'Owner Co', currency: 'USD', is_active: 1 }]);
    // Member is an ACTIVE admin of the owner's account (admin can write; not viewer).
    await c.query(`INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [ownerId, { member_user_id: String(memberId), status: 'active', role: 'admin', name: 'Member', email: 'f54-member@finflow.test' }]);
    // A personal transaction for EACH user (personal stays actor-scoped — must not cross).
    const mkPersonal = (uid, note) => c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { description: note, amount: 10, date: '2026-07-10', source: 'banking' }]);
    await mkPersonal(ownerId, 'OWNER-PERSONAL');
    await mkPersonal(memberId, 'MEMBER-PERSONAL');

    const owner = new HarnessHttp(server.baseUrl);
    const member = new HarnessHttp(server.baseUrl);
    if ((await owner.post('/api/auth/login', { email: 'f54-owner@finflow.test', password: PW })).status !== 200) throw new Error('owner login failed');
    if ((await member.post('/api/auth/login', { email: 'f54-member@finflow.test', password: PW })).status !== 200) throw new Error('member login failed');

    console.log('\n' + '='.repeat(78));
    console.log('  F54 — TEAM-MEMBER DATA SCOPE (member operates in the owner\'s account)');
    console.log('='.repeat(78));

    const invList = async (http) => { const r = await http.get('/api/invoices'); return (r.json || []); };

    // ── 1 · owner creates an invoice → the MEMBER sees it (was: empty app) ──
    console.log('\n-- 1 - owner creates; member sees the owner\'s books --');
    const oInv = await owner.post('/api/invoices', { client: 'Owner-Made', amount: 1000, status: 'pending', issue_date: '2026-07-10' });
    A('owner POST invoice → 201', oInv.status === 201, `status ${oInv.status}: ${oInv.text.slice(0,120)}`);
    const mSees = await invList(member);
    A('member GET invoices includes the owner-made invoice', mSees.some(i => i.client === 'Owner-Made'),
      `member sees clients: ${JSON.stringify(mSees.map(i => i.client))}`);

    // ── 2 · member creates → the OWNER sees it (was: invisible to owner) ──
    console.log('\n-- 2 - member creates; owner sees it --');
    const mInv = await member.post('/api/invoices', { client: 'Member-Made', amount: 2000, status: 'pending', issue_date: '2026-07-12' });
    A('member (admin) POST invoice → 201', mInv.status === 201, `status ${mInv.status}: ${mInv.text.slice(0,120)}`);
    const oSees = await invList(owner);
    A('owner GET invoices includes the member-made invoice', oSees.some(i => i.client === 'Member-Made'),
      `owner sees clients: ${JSON.stringify(oSees.map(i => i.client))}`);

    // ── 3 · the member-created row is OWNED BY THE ACCOUNT (user_id = owner), actor stays the member ──
    console.log('\n-- 3 - member-created row is account-scoped (user_id = owner) --');
    const mRow = (await c.query(`SELECT user_id FROM invoices WHERE data->>'client' = 'Member-Made' LIMIT 1`)).rows[0];
    A('member-made invoice.user_id === owner id (account-scoped, not the member)', mRow && mRow.user_id === ownerId,
      `user_id ${mRow && mRow.user_id} vs owner ${ownerId} / member ${memberId}`);

    // ── 4 · reports reconcile: member sees the account's revenue, not an empty book ──
    console.log('\n-- 4 - member and owner see the SAME account reports --');
    const oRep = (await owner.get('/api/reports')).json, mRep = (await member.get('/api/reports')).json;
    A('member /api/reports revenue == owner /api/reports revenue (same account)', oRep.revenue === mRep.revenue,
      `owner ${oRep.revenue} vs member ${mRep.revenue}`);
    A('…and it is non-zero (member is NOT looking at an empty app)', mRep.revenue > 0, `revenue ${mRep.revenue}`);

    // ── 5 · PERSONAL data stays actor-scoped — the member's finances do NOT leak into the owner ──
    console.log('\n-- 5 - personal data stays private to each user --');
    const oPers = (await owner.get('/api/personal-transactions')).json || [];
    const mPers = (await member.get('/api/personal-transactions')).json || [];
    A('owner personal list has OWNER-PERSONAL, not MEMBER-PERSONAL',
      oPers.some(t => t.description === 'OWNER-PERSONAL') && !oPers.some(t => t.description === 'MEMBER-PERSONAL'),
      `owner personal: ${JSON.stringify(oPers.map(t => t.description))}`);
    A('member personal list has MEMBER-PERSONAL, not OWNER-PERSONAL',
      mPers.some(t => t.description === 'MEMBER-PERSONAL') && !mPers.some(t => t.description === 'OWNER-PERSONAL'),
      `member personal: ${JSON.stringify(mPers.map(t => t.description))}`);

    // ── 6 · payroll is account-coherent too (roster + runs residual fix) ──
    console.log('\n-- 6 - payroll: owner adds an employee, member runs payroll, owner sees the run --');
    const emp = await owner.post('/api/payroll', { fname: 'Emp', lname: 'One', gross: 3000 });
    A('owner POST payroll employee → 2xx', emp.status >= 200 && emp.status < 300, `status ${emp.status}: ${emp.text.slice(0,120)}`);
    const mRun = await member.post('/api/payroll-runs', { period: '2026-07' });
    A('member (admin) POST payroll-run → 201 (reads the ACCOUNT roster, not an empty one)', mRun.status === 201, `status ${mRun.status}: ${mRun.text.slice(0,160)}`);
    A('the run has at least one line (account roster was pulled)', Array.isArray(mRun.json && mRun.json.lines) && mRun.json.lines.length > 0, `lines ${JSON.stringify(mRun.json && mRun.json.lines && mRun.json.lines.length)}`);
    const oRuns = (await owner.get('/api/payroll-runs')).json || [];
    A('owner GET payroll-runs includes the member-created run', oRuns.some(r => r.id === (mRun.json && mRun.json.id)),
      `owner run ids: ${JSON.stringify(oRuns.map(r => r.id))}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (F54 team-member data scope)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[f54] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
