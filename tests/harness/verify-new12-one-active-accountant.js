#!/usr/bin/env node
'use strict';
/**
 * verify-new12-one-active-accountant — NEW-12: a client has ONE active accountant. My Accountant shows one link (the
 * newest), so a second activation HID the first accountant's still-live books access: the client could neither see
 * nor revoke it. Enforced at the write (Rule 9): a partial unique index (one 'active' row per user) + every activation
 * path refuses with the name of the accountant who already has access; requesting a second accountant is refused up
 * front. Real server, real Postgres, real sessions (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new12-one-active-accountant.js
 *
 * Bug values: the second approval answers 200, two links are active, My Accountant names only the second, and the
 * first accountant still reads the books.
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const eq = (name, got, want, bug) => A(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}` + (bug !== undefined ? `  (bug gives ${JSON.stringify(bug)})` : ''));
const PW = 'n12-pw-not-a-secret';

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const base = server.baseUrl;
    const idx = (await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_acc_clients_one_active'`)).rowCount;
    eq('the one-active-accountant index exists on a clean database', idx, 1, 0);

    const mkUser = async (email) => (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: 'N12 Client', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const mkAcc = async (email, first) => (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ($1, $2, $3, 'Acct', $4, $5, 'verified') RETURNING id`, [email, bcrypt.hashSync(PW, 10), first, 'Firm ' + first, 'N12' + first.toUpperCase()])).rows[0].id;
    const uid = await mkUser('n12-client@finflow.test');
    const accA = await mkAcc('n12-a@finflow.test', 'Avery'), accB = await mkAcc('n12-b@finflow.test', 'Blake');
    const U = new HarnessHttp(base, { xff: '203.0.113.121' });
    const AA = new HarnessHttp(base, { xff: '203.0.113.122' }), AB = new HarnessHttp(base, { xff: '203.0.113.123' });
    eq('client signs in', (await U.post('/api/auth/login', { email: 'n12-client@finflow.test', password: PW })).status, 200);
    eq('accountant A signs in', (await AA.post('/api/accountants/login', { email: 'n12-a@finflow.test', password: PW })).status, 200);
    eq('accountant B signs in', (await AB.post('/api/accountants/login', { email: 'n12-b@finflow.test', password: PW })).status, 200);
    const ent = (await U.post('/api/entities', { name: 'N12 Co', currency: 'USD', country: 'US', timezone: 'UTC' })).json;

    // A: the client asks, A approves, the client grants the business
    eq('client requests accountant A', (await U.post('/api/accountants/request-access', { accountantId: accA })).status, 200);
    eq('A approves', (await AA.post('/api/accountants/approve-request', { userId: uid })).status, 200);
    eq('client grants A view of the business', (await U.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [ent.id]: 'view' }, personal: 'none' } })).status, 200);
    eq('premise: A reads the books', (await AA.get(`/api/accountants/clients/${uid}/books?period=year`)).status, 200);

    // B: the client asks for a second accountant
    const reqB = await U.post('/api/accountants/request-access', { accountantId: accB });
    eq('requesting a second accountant is refused while A has access', reqB.status, 409, 200);
    A('…and the refusal names the accountant who has access', /Avery/.test(String(reqB.json && reqB.json.error)), JSON.stringify(reqB.json));

    // even if a pending row exists (made before this rule, or by a referral sign-up), activation is refused at the write
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, referral_months_total, requested_by, entity_access)
      VALUES ($1, $2, 'pending', 0, 'client', '{"entities":{},"personal":"none"}'::jsonb) ON CONFLICT (accountant_id, user_id) DO UPDATE SET status = 'pending', requested_by = 'client'`, [accB, uid]);
    const apB = await AB.post('/api/accountants/approve-request', { userId: uid });
    eq('B approving an old pending request is refused (409)', apB.status, 409, 200);
    const active = (await c.query(`SELECT accountant_id FROM accountant_clients WHERE user_id = $1 AND status = 'active' ORDER BY accountant_id`, [uid])).rows.map(r => r.accountant_id);
    eq('exactly one active accountant — A', active, [accA], [accA, accB]);
    const my = (await U.get('/api/accountants/my-accountant')).json;
    eq('My Accountant shows the accountant who actually has access', my && my.first_name, 'Avery', 'Blake');

    // a referral-origin pending row approved by the CLIENT goes through the same refusal
    await c.query(`UPDATE accountant_clients SET requested_by = 'referral' WHERE accountant_id = $1 AND user_id = $2`, [accB, uid]);
    const cap = await U.post('/api/accountants/my-accountant/approve', { accountantId: accB });
    eq('the client approving a second (referral) link is refused (409)', cap.status, 409, 200);

    // after revoking A, B can be approved
    eq('client revokes A', (await U.post('/api/accountants/my-accountant/revoke', { accountantId: accA })).status, 200);
    eq('now the client can approve B', (await U.post('/api/accountants/my-accountant/approve', { accountantId: accB })).status, 200);
    eq('A no longer reads the books', (await AA.get(`/api/accountants/clients/${uid}/books?period=year`)).status, 403);

    // at the write, directly: a second active row cannot exist
    let code = null;
    try { await c.query(`UPDATE accountant_clients SET status = 'active' WHERE accountant_id = $1 AND user_id = $2`, [accA, uid]); } catch (e) { code = e.code; }
    eq('the database refuses a second active link (unique violation)', code, '23505', null);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (NEW-12 one active accountant)` : `  ${fail} FAILED, ${pass} passed`);
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('[n12] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); if (e && e.errors) for (const x of e.errors) console.error(' -', x.message); process.exit(1); });
