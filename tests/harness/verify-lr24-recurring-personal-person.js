'use strict';
/**
 * verify-lr24-recurring-personal-person.js — LR24 (found 2026-10-21 while building LC3c; Rule 13 class enumerated).
 *
 * Personal is per PERSON (CLAUDE.md wall; verify-f54-team-scope: "personal stays actor-scoped"). Of every personal
 * route, exactly two looked a row up by the ACCOUNT (scopeId(req)) instead of the person (req.session.userId):
 * PUT and DELETE /api/recurring-personal-transactions/:id (DELETE also through requireOwnedRow, which is scopeId-based).
 * POST and GET use the person. So a team member signed in to the owner's account:
 *   - could change and delete the OWNER's recurring personal rows (the owner's private schedule), and
 *   - could not change or delete their OWN (404).
 *
 * Real scratch Postgres, real server, owner + an active admin team member of the owner's account.
 *   1  member PUT on the OWNER's recurring row → 404, owner's amount unchanged (900)      bug: 200, amount → 1
 *   2  member DELETE on the OWNER's row → 404, row still there                            bug: 200, row gone
 *   3  member PUT on their OWN row → 200, amount 40 → 45                                  bug: 404, still 40
 *   4  member DELETE on their OWN row → 200, row gone                                     bug: 404, still there
 *   5  owner PUT / DELETE on their own row → 200 (control)
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let scratch, server;
  console.log('\nLR24 — recurring personal rows belong to the PERSON, not the account\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const mkUser = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const ownerId = await mkUser('lr24-owner@finflow.test'), memberId = await mkUser('lr24-member@finflow.test');
    await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`, [ownerId, { name: 'Owner Co', currency: 'USD', is_active: 1 }]);
    await c.query(`INSERT INTO team_members (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerId, { member_user_id: String(memberId), status: 'active', role: 'admin', name: 'Member', email: 'lr24-member@finflow.test' }]);
    const owner = new HarnessHttp(server.baseUrl), member = new HarnessHttp(server.baseUrl);
    if ((await owner.post('/api/auth/login', { email: 'lr24-owner@finflow.test', password: PW })).status !== 200) throw new Error('owner login');
    if ((await member.post('/api/auth/login', { email: 'lr24-member@finflow.test', password: PW })).status !== 200) throw new Error('member login');
    const mk = async (http, desc, amt) => (await http.post('/api/recurring-personal-transactions', { description: desc, amount: amt, currency: 'USD', category: 'Housing', tx_type: 'expense', frequency: 'Monthly', status: 'active', next_run: '2026-09-01' })).json;
    const amt = async id => { const r = (await c.query(`SELECT data->>'amount' a, user_id FROM recurring_personal_transactions WHERE id = $1`, [id])).rows[0]; return r ? Number(r.a) : null; };
    const oRow = await mk(owner, 'OWNER RENT', 900);
    const mRow = await mk(member, 'MEMBER GYM', 40);
    eq('setup: each row belongs to its person', [(await c.query(`SELECT user_id FROM recurring_personal_transactions WHERE id=$1`, [oRow.id])).rows[0].user_id, (await c.query(`SELECT user_id FROM recurring_personal_transactions WHERE id=$1`, [mRow.id])).rows[0].user_id], [ownerId, memberId]);

    const p1 = await member.put('/api/recurring-personal-transactions/' + oRow.id, { amount: 1 });
    eq('1  member PUT on the OWNER\'s row → 404, amount stays 900', [p1.status, await amt(oRow.id)], [404, 900], [200, 1]);
    const d2 = await member.del('/api/recurring-personal-transactions/' + oRow.id);
    eq('2  member DELETE on the OWNER\'s row → 404, row kept', [d2.status, await amt(oRow.id)], [404, 900], [200, null]);
    const p3 = await member.put('/api/recurring-personal-transactions/' + mRow.id, { amount: 45 });
    eq('3  member PUT on their OWN row → 200, 40 → 45', [p3.status, await amt(mRow.id)], [200, 45], [404, 40]);
    const d4 = await member.del('/api/recurring-personal-transactions/' + mRow.id);
    eq('4  member DELETE on their OWN row → 200, row gone', [d4.status, await amt(mRow.id)], [200, null], [404, 40]);
    const p5 = await owner.put('/api/recurring-personal-transactions/' + oRow.id, { amount: 950 });
    const d5 = await owner.del('/api/recurring-personal-transactions/' + oRow.id);
    eq('5  owner PUT / DELETE own row → 200 / 200 (control)', [p5.status, d5.status, await amt(oRow.id)], [200, 200, null]);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (server) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
