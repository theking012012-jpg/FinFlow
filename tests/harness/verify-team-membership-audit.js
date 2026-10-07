'use strict';
/**
 * verify-team-membership-audit.js — L31 (prior audit F107 residue; F90 class). A team membership GRANTS ACCESS to an
 * account's books, yet none of its five writes left an audit row: POST /api/team, PUT /api/team/:id (role /
 * per-entity access), DELETE /api/team/:id (revoke), POST /api/team/invite (create or re-issue), POST
 * /api/team/accept (pending → active). "Who gave this person access, and when" had no answer.
 *
 * Executed against real Postgres + the real routes: each write must leave exactly one audit_trail row on
 * table_name 'team_members' for that record, with the right action, attributed to the right actor, and the
 * invite token hash must NEVER be written into the trail (it is a bearer secret).
 * Pre-fix: 0 rows for every action.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-team-membership-audit.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const hashTok = t => crypto.createHash('sha256').update(String(t)).digest('hex');

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L31 — team membership writes are audit-logged\n' + '='.repeat(78) + '\n');
    const ownerId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'l31-owner@finflow.test', name: 'Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [ownerId, { name: 'Owner Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const owner = new HarnessHttp(server.baseUrl);
    if ((await owner.post('/api/auth/login', { email: 'l31-owner@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const trail = async (id) => (await c.query(`SELECT action, actor_type, actor_id, user_id, old_data, new_data, old_value, new_value FROM audit_trail WHERE table_name='team_members' AND record_id=$1 ORDER BY id`, [id])).rows;
    const allTrail = async () => JSON.stringify((await c.query(`SELECT old_data, new_data, old_value, new_value FROM audit_trail WHERE table_name='team_members'`)).rows);

    const m = await owner.post('/api/team', { name: 'Direct Member', email: 'direct@finflow.test', role: 'viewer' });
    const mid = m.json && m.json.id;
    let t = await trail(mid);
    A('POST /api/team ⇒ one CREATE row, actor = the owner (bug: none)', m.status === 201 && t.length === 1 && t[0].action === 'CREATE' && t[0].actor_type === 'user' && Number(t[0].actor_id) === ownerId && Number(t[0].user_id) === ownerId,
      'status=' + m.status + ' trail=' + JSON.stringify(t.map(r => [r.action, r.actor_type, r.actor_id])));
    const pu = await owner.put('/api/team/' + mid, { role: 'admin', entity_ids: [eid] });
    t = await trail(mid);
    const up = t.find(r => r.action === 'UPDATE');
    A('PUT /api/team/:id (role → admin, entity access) ⇒ UPDATE row with old role viewer / new role admin', pu.status === 200 && t.length === 2 && up && up.old_data && up.old_data.role === 'viewer' && up.new_data && up.new_data.role === 'admin',
      'trail=' + JSON.stringify(t.map(r => [r.action, r.old_data && r.old_data.role, r.new_data && r.new_data.role])));
    const dl = await owner.request('DELETE', '/api/team/' + mid);
    t = await trail(mid);
    const del = t.find(r => r.action === 'DELETE');
    A('DELETE /api/team/:id (revoke) ⇒ DELETE row carrying the revoked membership', dl.status === 200 && t.length === 3 && del && del.old_data && del.old_data.email === 'direct@finflow.test',
      'trail=' + JSON.stringify(t.map(r => r.action)));

    const iv = await owner.post('/api/team/invite', { email: 'invitee@finflow.test', role: 'accountant', name: 'Invitee' });
    const pend = (await c.query(`SELECT id FROM team_members WHERE data->>'email'='invitee@finflow.test'`)).rows[0];
    t = pend ? await trail(pend.id) : [];
    A('POST /api/team/invite (new) ⇒ one INVITE row', iv.status < 300 && t.length === 1 && t[0].action === 'INVITE', 'status=' + iv.status + ' trail=' + JSON.stringify(t.map(r => r.action)));
    const iv2 = await owner.post('/api/team/invite', { email: 'invitee@finflow.test', role: 'viewer', name: 'Invitee' });
    t = pend ? await trail(pend.id) : [];
    A('re-invite (refresh pending) ⇒ a second INVITE row with the new role', iv2.status < 300 && t.length === 2 && t[1].action === 'INVITE' && t[1].new_data && t[1].new_data.role === 'viewer',
      'trail=' + JSON.stringify(t.map(r => [r.action, r.new_data && r.new_data.role])));

    // accept a seeded pending invite (raw token known), as a brand-new user
    const sid = (await c.query(`INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [ownerId, { email: 'joiner@finflow.test', role: 'viewer', status: 'pending', invite_token_hash: hashTok('TOKEN-L31'),
        invite_expires: new Date(Date.now() + 7 * 864e5).toISOString(), invited_by: String(ownerId) }])).rows[0].id;
    const joiner = new HarnessHttp(server.baseUrl, { xff: '203.0.113.131' });
    const ac = await joiner.post('/api/team/accept', { token: 'TOKEN-L31', name: 'Joiner', password: PW });
    const memberUid = (await c.query(`SELECT data->>'member_user_id' AS u FROM team_members WHERE id=$1`, [sid])).rows[0].u;
    t = await trail(sid);
    A('POST /api/team/accept ⇒ one ACCEPT row, actor = the new member, on the OWNER\'s account', ac.status === 200 && t.length === 1 && t[0].action === 'ACCEPT' && Number(t[0].user_id) === ownerId && String(t[0].actor_id) === String(memberUid),
      'status=' + ac.status + ' trail=' + JSON.stringify(t.map(r => [r.action, r.user_id, r.actor_type, r.actor_id])) + ' member=' + memberUid);

    const all = await allTrail();
    A('no invite token hash is ever written to the audit trail', !/invite_token_hash/.test(all) && !all.includes(hashTok('TOKEN-L31')), all.slice(0, 200));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (team membership audit)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
