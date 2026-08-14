#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-access-grant.js — the OWNER's "review vs run the books" choice, executed
 * end-to-end. The owner (client) sets their accountant's access_level via the new
 * PUT /api/accountants/my-accountant/access, and that choice must actually change what the
 * accountant can do in the portal. Closes the fake-success gap (the old toggle only showed a
 * notification; no route set access_level, so 'filing' was ungrantable).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-access-grant.js
 *
 * THE LOOP:
 *   view (default)   → accountant POST journal = 403
 *   owner grants filing → accountant POST journal = 201     ← the "run the books" upgrade works
 *   owner sets view  → accountant POST journal = 403 again  ← and is revocable
 * Two independent sessions (owner = user, accountant = requireAccountant) via two HTTP clients.
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
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
    const clientId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: 'grant-client@finflow.test', name: 'Client Co', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;
    await seed(c, clientId);   // client gets an active entity + books (journal needs the client entity, F156)
    const accId = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('grant-acc@finflow.test', $1, 'Acc', 'Grant', 'Firm', 'GRANTCODE', 'verified') RETURNING id`,
      [bcrypt.hashSync(PW, 10)]
    )).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1, $2, 'active', 'view')`, [accId, clientId]);

    const owner = new HarnessHttp(server.baseUrl);   // client/owner session
    const acc   = new HarnessHttp(server.baseUrl);   // accountant session (independent cookies)
    if ((await owner.post('/api/auth/login', { email: 'grant-client@finflow.test', password: PW })).status !== 200) throw new Error('owner login failed');
    if ((await acc.post('/api/accountants/login', { email: 'grant-acc@finflow.test', password: PW })).status !== 200) throw new Error('accountant login failed');

    const JOURNAL = `/api/accountants/clients/${clientId}/journal`;
    const journalBody = { date: '2026-07-10', description: 'Adjusting entry', lines: [{ debit: 100 }, { credit: 100 }] };
    const setLevel = (lvl) => owner.put('/api/accountants/my-accountant/access', { access_level: lvl });
    const postJournal = () => acc.post(JOURNAL, journalBody);

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT ACCESS GRANT — owner chooses review vs run the books (end-to-end)');
    console.log('='.repeat(78));

    // ── default view: owner sees 'view', accountant blocked ──
    console.log('\n-- default: view (review the books) --');
    const my0 = await owner.get('/api/accountants/my-accountant');
    A('owner sees access_level = view', my0.json && my0.json.access_level === 'view', `my ${JSON.stringify(my0.json && my0.json.access_level)}`);
    A('accountant POST journal → 403 (review only, cannot mutate)', (await postJournal()).status === 403);

    // ── owner GRANTS filing → accountant can now post ──
    console.log('\n-- owner grants "run the books" (filing) --');
    const g = await setLevel('filing');
    A('PUT .../access {filing} → 200', g.status === 200 && g.json && g.json.access_level === 'filing', `status ${g.status}: ${g.text.slice(0,140)}`);
    A('owner now sees access_level = filing', (await owner.get('/api/accountants/my-accountant')).json.access_level === 'filing');
    A('accountant POST journal → 201 (run the books works)', (await postJournal()).status === 201);

    // ── owner SETS BACK to view → accountant blocked again (revocable) ──
    console.log('\n-- owner switches back to review (view) --');
    A('PUT .../access {view} → 200', (await setLevel('view')).status === 200);
    A('accountant POST journal → 403 again (grant is revocable, next request)', (await postJournal()).status === 403);

    // ── validation ──
    console.log('\n-- validation --');
    A('PUT .../access {bogus} → 400', (await setLevel('bogus')).status === 400);
    const stranger = new HarnessHttp(server.baseUrl);
    // a user with no active accountant → 404 (nothing to update)
    const soloId = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'grant-solo@finflow.test', name: 'Solo', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await stranger.post('/api/auth/login', { email: 'grant-solo@finflow.test', password: PW });
    A('user with no active accountant → 404', (await stranger.put('/api/accountants/my-accountant/access', { access_level: 'filing' })).status === 404, `soloId ${soloId}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (owner access-level grant)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[acc-grant] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
