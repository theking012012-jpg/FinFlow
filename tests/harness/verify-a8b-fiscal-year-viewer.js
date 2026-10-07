'use strict';
/**
 * verify-a8b-fiscal-year-viewer.js — VERIFICATION A8b (Phase 2.3; empty result cells, no gate executed them).
 * The fiscal year belongs to the BOOKS, not the reader: two readers of the same account whose OWN fiscal_year
 * settings differ must get identical YEAR figures. The client sends fyStart from GET /api/settings, so the question
 * is whose setting that returns; the accountant portal resolves the client's own (accountFyStartIdx).
 *
 * Discriminating seed: the owner's books run an APRIL fiscal year; a team member's own settings say JANUARY.
 *   invoice 1,000 on 2026-02-10  — inside a Jan-FY 2026, OUTSIDE the Apr-FY that starts 2026-04-01
 *   invoice   400 on 2026-05-10  — inside both
 * Today 2026-07-25 ⇒ April FY = [2026-04-01, 2027-04-01) ⇒ year revenue 400. A reader-dependent FY gives 1,400.
 * Readers: owner, team member (switched into the owner's account), accountant (portal books).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-a8b-fiscal-year-viewer.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const FY = ['January','February','March','April','May','June','July','August','September','October','November','December'];

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  A8b — the fiscal year belongs to the books, not the reader\n' + '='.repeat(78) + '\n');
    const mkUser = async (email, fy) => {
      const id = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
        [{ email, name: email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
      await c.query(`INSERT INTO user_settings (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`, [id, { fiscal_year: fy }]);
      return id;
    };
    const ownerId = await mkUser('a8b-owner@finflow.test', 'April');
    const memberId = await mkUser('a8b-member@finflow.test', 'January');
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [ownerId, { name: 'A8b Co', currency: 'USD', is_active: 1, timezone: 'UTC' }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`, [memberId, { name: 'Member Own Co', currency: 'USD', is_active: 1 }]);
    for (const [amt, d] of [[1000, '2026-02-10'], [400, '2026-05-10']])
      await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [ownerId, eid, { client: 'C', amount: amt, status: 'pending', issue_date: d }]);
    await c.query(`INSERT INTO team_members (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerId, { email: 'a8b-member@finflow.test', role: 'viewer', status: 'active', member_user_id: String(memberId), name: 'Member' }]);

    const yearRev = async (h) => {
      const st = (await h.get('/api/settings')).json || {};
      const fyi = Math.max(0, FY.indexOf(st.fiscal_year || 'January'));
      const r = (await h.get('/api/reports?period=year&fyStart=' + fyi)).json || {};
      return { fy: st.fiscal_year, rev: r.revenue, out: r.outstanding };
    };
    const owner = new HarnessHttp(server.baseUrl, { xff: '203.0.113.81' });
    if ((await owner.post('/api/auth/login', { email: 'a8b-owner@finflow.test', password: PW })).status !== 200) throw new Error('owner login');
    const o = await yearRev(owner);
    A('owner: books FY April ⇒ year revenue 400 (hand-computed; Jan-FY would be 1,400)', o.fy === 'April' && o.rev === 400, JSON.stringify(o));

    const member = new HarnessHttp(server.baseUrl, { xff: '203.0.113.82' });
    if ((await member.post('/api/auth/login', { email: 'a8b-member@finflow.test', password: PW })).status !== 200) throw new Error('member login');
    const sw = await member.post('/api/my-access/switch', { accountOwnerId: ownerId });
    A('premise: member switched into the owner\'s account', sw.status === 200, 'status=' + sw.status + ' ' + String(sw.text).slice(0, 120));
    const m = await yearRev(member);
    A('team member (own setting January) reads the BOOKS\' FY April and the same year revenue 400', m.fy === 'April' && m.rev === o.rev, JSON.stringify(m));
    A('A8b: identical outstanding across owner and member', m.out === o.out, JSON.stringify({ o: o.out, m: m.out }));

    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('a8b-acc@finflow.test',$1,'Acc','A8b','Firm','CODEA8B','verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, ownerId]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '203.0.113.83' });
    if ((await acc.post('/api/accountants/login', { email: 'a8b-acc@finflow.test', password: PW })).status !== 200) throw new Error('accountant login');
    const bk = (await acc.get('/api/accountants/clients/' + ownerId + '/books?period=year')).json || {};
    const brev = bk.summary ? bk.summary.revenue : bk.revenue;
    A('accountant portal books (year) use the client\'s FY April: revenue 400', Number(brev) === 400, JSON.stringify({ revenue: brev, window: bk.window }).slice(0, 200));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (A8b fiscal year)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
