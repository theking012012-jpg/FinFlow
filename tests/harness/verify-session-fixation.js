#!/usr/bin/env node
'use strict';
/**
 * verify-session-fixation.js — N73. Every path that authenticates a request issues a NEW session id and
 * starts from an empty session.
 *
 * Defect: user login/register regenerated the session id, but team-invite accept, accountant login and
 * admin login did not. An attacker who planted their own session cookie in the victim's browser kept a
 * copy of the same id, which the victim's login then promoted to the victim's identity. Accountant login
 * also kept any user id already in the session, so audit attributed that user's actions to the
 * accountant.
 *
 * Method (executed, real server + Postgres): the attacker logs in to their OWN user account, the cookie is
 * copied into the victim's client (fixation), the victim logs in through each path, then the attacker's
 * copy of the cookie is tested. Bug value stated per path:
 *   user login (control — already regenerated)   attacker copy is NOT the victim
 *   accountant login                             attacker copy → /api/accountants/me 401   (bug: 200, victim accountant)
 *   accountant login                             victim session no longer a user           (bug: still attacker user — mixed)
 *   admin login                                  attacker copy → /api/admin/me 401          (bug: 200, admin)
 *   team invite accept                           attacker copy is NOT the new member        (bug: it is)
 *   node -r ./tests/harness/clock.js tests/harness/verify-session-fixation.js
 */
process.env.ADMIN_PASSWORD = 'harness-admin-password';
const crypto = require('crypto');
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
    const mkUser = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email, name: email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const attackerId = await mkUser('fix-attacker@finflow.test');
    const victimId = await mkUser('fix-victim@finflow.test');
    const ownerId = await mkUser('fix-owner@finflow.test');
    for (const u of [attackerId, victimId, ownerId]) await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [u, { name: 'Co ' + u, currency: 'USD', is_active: 1 }]);
    await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
                   VALUES ('fix-acc@finflow.test', $1, 'Acc', 'Fix', 'Firm', 'FIXCODE1', 'verified')`, [bcrypt.hashSync(PW, 10)]);
    const token = 'invite-token-' + crypto.randomBytes(8).toString('hex');
    await c.query(`INSERT INTO team_members (user_id, entity_id, data) VALUES ($1, NULL, $2)`,
      [ownerId, { email: 'fix-newmember@finflow.test', role: 'viewer', status: 'pending', invite_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
                  invite_expires: new Date(Date.now() + 7 * 864e5).toISOString(), invited_by: String(ownerId) }]);

    let ip = 1;
    // The attacker's own session, planted into a fresh victim client. Returns [attackerCopy, victimClient].
    const planted = async () => {
      const att = new HarnessHttp(server.baseUrl, { xff: '10.77.0.' + (ip++) });
      if ((await att.post('/api/auth/login', { email: 'fix-attacker@finflow.test', password: PW })).status !== 200) throw new Error('attacker login');
      const vic = new HarnessHttp(server.baseUrl, { xff: '10.77.0.' + (ip++) });
      for (const [k, v] of att.cookies) vic.cookies.set(k, v);
      return [att, vic];
    };
    const sid = (h) => [...h.cookies.entries()].map(([k, v]) => k + '=' + v).join(';');
    const meEmail = async (h) => { const r = await h.get('/api/auth/me'); return r.status === 200 ? ((r.json.user || r.json).email || null) : null; };

    console.log('\n' + '='.repeat(78));
    console.log('  SESSION FIXATION — every login issues a fresh, single-identity session');
    console.log('='.repeat(78));

    { // user login (control: already regenerated before this fix)
      const [att, vic] = await planted();
      A('user login → 200', (await vic.post('/api/auth/login', { email: 'fix-victim@finflow.test', password: PW })).status === 200);
      A('control — user login: new session id issued', sid(vic) !== sid(att));
      A('control — user login: attacker copy is not the victim', (await meEmail(att)) !== 'fix-victim@finflow.test', 'attacker copy → ' + await meEmail(att));
    }
    { // accountant login
      const [att, vic] = await planted();
      const r = await vic.post('/api/accountants/login', { email: 'fix-acc@finflow.test', password: PW });
      A('accountant login → 200', r.status === 200, 'status ' + r.status);
      A('accountant login: new session id issued (bug: same id)', sid(vic) !== sid(att));
      A('accountant login: attacker copy → /api/accountants/me 401 (bug: 200)', (await att.get('/api/accountants/me')).status === 401);
      A('accountant login: victim session holds ONLY the accountant (bug: still attacker user — mixed)', (await meEmail(vic)) === null, 'auth/me → ' + await meEmail(vic));
      A('control: victim is the accountant', (await vic.get('/api/accountants/me')).status === 200);
    }
    { // admin login
      const [att, vic] = await planted();
      A('admin login → 200', (await vic.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
      A('admin login: new session id issued (bug: same id)', sid(vic) !== sid(att));
      A('admin login: attacker copy → /api/admin/me 401 (bug: 200, admin)', (await att.get('/api/admin/me')).status === 401);
      A('control: victim is admin', (await vic.get('/api/admin/me')).status === 200);
    }
    { // team invite accept (new user)
      const [att, vic] = await planted();
      const r = await vic.post('/api/team/accept', { token, name: 'New Member', password: 'new-member-password-1' });
      A('invite accept → 200', r.status === 200, `status ${r.status}: ${r.text.slice(0, 120)}`);
      A('invite accept: new session id issued (bug: same id)', sid(vic) !== sid(att));
      A('invite accept: attacker copy is NOT the new member (bug: it is)', (await meEmail(att)) !== 'fix-newmember@finflow.test', 'attacker copy → ' + await meEmail(att));
      A('control: victim is the new member', (await meEmail(vic)) === 'fix-newmember@finflow.test', 'victim → ' + await meEmail(vic));
    }
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (session fixation)` : `  ALL GREEN — ${pass} passed, 0 failed  (session fixation)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
