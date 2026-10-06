#!/usr/bin/env node
'use strict';
/**
 * verify-team-member-writes.js — N15 class. What an invited team member does inside the owner's account
 * lands IN that account: the audit trail, projects, documents, templates, auto-categorisation rules,
 * timesheets, budget targets, the settings blob, MRR / permissions / scenario, the team roster and
 * business holdings. Personal data (personal holdings) stays the member's own.
 *
 * Defect: the READS of these stores already used the account (scopeId(req)) but the WRITES used the
 * signed-in person (req.session.userId). So, for a member:
 *   - every audit row was filed under the member: the owner's Audit Trail never showed what a member did
 *     (actor_type/actor_id were right — the row was simply in the wrong account)
 *   - a project / document / template / rule / timesheet the member created was invisible to the owner
 *   - budget targets, settings, MRR, permissions, scenario: each save inserted a NEW orphan row under the
 *     member (the look-up searched the account, found nothing, inserted under the member) — the save
 *     "worked" and nobody, the member included, ever saw it again
 *   - an admin member's invites went to the account but GET /api/team read the member's own → never seen
 *   - business holdings were stored under the member → the owner's business portfolio never had them
 *   - "run rules" read the member's rules and the member's expenses → 0 categorised
 *
 * Executed: real server + Postgres. Owner "Owner Co" (USD); member = ACTIVE admin of the owner's account.
 * Every assertion is on the owner's view or on the stored row; each names what the bug produced.
 *   node -r ./tests/harness/clock.js tests/harness/verify-team-member-writes.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'team-writes-pw-1';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const mkUser = async (email, name) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email, name, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const ownerId = await mkUser('tw-owner@finflow.test', 'Olivia Owner');
    const memberId = await mkUser('tw-member@finflow.test', 'Mark Member');
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [ownerId, { name: 'Owner Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`,
      [ownerId, { member_user_id: String(memberId), status: 'active', role: 'admin', name: 'Mark Member', email: 'tw-member@finflow.test' }]);
    const expId = (await c.query(`INSERT INTO expenses (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [ownerId, eid, { description: 'AWS monthly bill', vendor: 'AWS', amount: 120, category: 'Other', expense_date: '2026-07-05', status: 'paid' }])).rows[0].id;
    const invId = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [ownerId, eid, { client: 'Acme', amount: 900, amount_paid: 0, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01' }])).rows[0].id;

    const owner = new HarnessHttp(server.baseUrl, { xff: '10.15.0.1' });
    const member = new HarnessHttp(server.baseUrl, { xff: '10.15.0.2' });
    A('owner login', (await owner.post('/api/auth/login', { email: 'tw-owner@finflow.test', password: PW })).status === 200);
    A('member login', (await member.post('/api/auth/login', { email: 'tw-member@finflow.test', password: PW })).status === 200);
    const q = (p) => `${p}${p.includes('?') ? '&' : '?'}entity_id=${eid}`;
    const ownerGet = async (p) => (await owner.get(q(p))).json;
    const rowsUnder = async (table, uid) => (await c.query(`SELECT COUNT(*)::int n FROM ${table} WHERE user_id=$1`, [uid])).rows[0].n;

    console.log('\n' + '='.repeat(78));
    console.log('  TEAM MEMBER WRITES LAND IN THE ACCOUNT');
    console.log('='.repeat(78));

    console.log('\n-- audit trail --');
    const cu = await member.post(q('/api/customers'), { fname: 'Nina', lname: 'New', company: 'Member Cust', email: 'nina@cust.test' });
    A('member creates a customer → 201', cu.status === 201 || cu.status === 200, `status ${cu.status} ${cu.text.slice(0, 120)}`);
    const au = (await c.query(`SELECT user_id, actor_type, actor_id FROM audit_trail WHERE table_name='customers' AND action='CREATE'`)).rows;
    A('  audit row filed under the ACCOUNT (owner), actor = the member (bug: user_id = member)',
      au.length === 1 && Number(au[0].user_id) === ownerId && au[0].actor_type === 'user' && Number(au[0].actor_id) === memberId, JSON.stringify(au));
    const otrail = await ownerGet('/api/audit-trail?table=customers');
    A('  the owner\'s Audit Trail shows it (bug: empty)', Array.isArray(otrail) && otrail.length === 1, JSON.stringify(otrail && otrail.length));
    const pay = await member.post(q('/api/invoice-payments'), { invoice_id: invId, amount: 300, payment_date: '2026-07-10', method: 'bank' });
    A('member records a payment → 201', pay.status === 201, `status ${pay.status} ${pay.text.slice(0, 120)}`);
    const pau = (await c.query(`SELECT user_id FROM audit_trail WHERE table_name='invoice_payments' AND action='CREATE'`)).rows;
    A('  payment audit row under the account (bug: under the member)', pau.length === 1 && Number(pau[0].user_id) === ownerId, JSON.stringify(pau));

    console.log('\n-- records the member creates --');
    const mk = [
      ['projects', '/api/projects', { name: 'Member Project', client: 'Acme', budget: 1000 }, r => r.name === 'Member Project'],
      ['templates', '/api/templates', { name: 'Member Template', type: 'invoice' }, r => r.name === 'Member Template'],
      ['autocat_rules', '/api/autocat-rules', { keyword: 'aws', match_type: 'vendor', category: 'Software & SaaS', enabled: true }, r => r.keyword === 'aws'],
      ['timesheet', '/api/timesheet', { employee: 'Mark', project: 'Member Project', date: '2026-07-11', hours: 3, rate: 50 }, r => r.employee === 'Mark'],
      ['documents', '/api/documents', { name: 'receipt.txt', type: 'receipt', file_data: Buffer.from('hello').toString('base64'), media_type: 'text/plain' }, r => r.name === 'receipt.txt'],
    ];
    for (const [table, path, body, match] of mk) {
      const r = await member.post(q(path), body);
      const list = await ownerGet(path);
      A(`${table}: member creates (${r.status}) → the owner sees it (bug: invisible to the owner)`,
        (r.status === 201 || r.status === 200) && Array.isArray(list) && list.some(match), `status ${r.status} ${r.text.slice(0, 100)} | owner list ${JSON.stringify((list || []).length)}`);
    }
    const run = await member.post(q('/api/autocat-rules/run'), {});
    const cat = (await c.query(`SELECT data->>'category' c FROM expenses WHERE id=$1`, [expId])).rows[0].c;
    A('run rules (member): the account\'s rule categorises the account\'s expense — 1 updated, AWS → Software & SaaS (bug: 0, stays Other)',
      run.status === 200 && run.json && run.json.updated === 1 && cat === 'Software & SaaS', `status ${run.status} ${JSON.stringify(run.json)} category ${cat}`);

    console.log('\n-- one-row-per-account settings: saved twice by the member --');
    for (let i = 1; i <= 2; i++) await member.put(q('/api/budget-targets'), { Marketing: 500 * i });
    const bt = await ownerGet('/api/budget-targets');
    A('budget targets: the owner sees the member\'s latest (Marketing 1000) (bug: nothing — 2 orphan rows under the member)',
      bt && JSON.stringify(bt).includes('1000') && (await rowsUnder('budget_targets', memberId)) === 0, JSON.stringify({ bt, orphans: await rowsUnder('budget_targets', memberId) }));
    for (let i = 1; i <= 2; i++) await member.put(q('/api/mrr'), { subscribers: [{ name: 'S' + i, mrr: 10 * i }], plans: [] });
    const mrr = await ownerGet('/api/mrr');
    A('MRR: the owner sees S2 (bug: empty — orphans under the member)', mrr && mrr.subscribers && mrr.subscribers[0] && mrr.subscribers[0].name === 'S2', JSON.stringify(mrr));
    for (let i = 1; i <= 2; i++) await member.put(q('/api/scenario'), { growth: i * 5 });
    const scn = await ownerGet('/api/scenario');
    A('scenario: the owner sees growth 10 (bug: {})', scn && scn.growth === 10, JSON.stringify(scn));
    // permissions:manage is OWNER-only (rbac.js) — a member is refused; scopeId(req) is the owner's own id there.
    const pr = await member.post(q('/api/permissions'), [{ role: 'viewer', perms: ['read'] }]);
    A('permissions: an admin member is refused (owner-only) — 403', pr.status === 403, 'status ' + pr.status);
    const st = await member.put(q('/api/settings'), { fiscal_year: 'April' });
    const os = await ownerGet('/api/settings');
    A('settings: the owner sees fiscal_year April (bug: the save went to an orphan row under the member)', st.status === 200 && os && os.fiscal_year === 'April', `status ${st.status} ${JSON.stringify(os && os.fiscal_year)}`);
    const orphanSettings = await rowsUnder('user_settings', memberId);
    A('  no settings row of any kind was filed under the member (bug: orphan rows under the member — count printed on failure)', orphanSettings === 0, 'rows under member: ' + orphanSettings);

    console.log('\n-- team roster --');
    const tm = await member.post(q('/api/team'), { name: 'Ivy Invitee', email: 'ivy@team.test', role: 'viewer' });
    const mTeam = (await member.get(q('/api/team'))).json || [];
    const oTeam = (await ownerGet('/api/team')) || [];
    A('admin member adds Ivy → the member\'s roster shows her',
      (tm.status === 201 || tm.status === 200) && mTeam.some(m => m.email === 'ivy@team.test'), `status ${tm.status} ${JSON.stringify(mTeam.map(m => m.email))}`);
    A('  the owner\'s roster shows her too (bug: no — filed under the member, who read their own roster)', oTeam.some(m => m.email === 'ivy@team.test'), JSON.stringify(oTeam.map(m => m.email)));
    A('  the member\'s roster lists the account owner as Owner (bug: the member listed as owner)', mTeam.some(m => m.role === 'owner' && m.email === 'tw-owner@finflow.test'), JSON.stringify(mTeam.filter(m => m.role === 'owner')));

    console.log('\n-- holdings: business is the account\'s, personal is the person\'s --');
    const hb = await member.post(q('/api/holdings'), { scope: 'business', ticker: 'MSFT', shares: 10, cost_per: 300, price: 400 });
    const hp = await member.post(q('/api/holdings'), { scope: 'personal', ticker: 'AAPL', shares: 5, cost_per: 150, price: 200 });
    const oBiz = (await ownerGet('/api/holdings?scope=business')) || [];
    const oPer = (await ownerGet('/api/holdings?scope=personal')) || [];
    const mPer = ((await member.get(q('/api/holdings?scope=personal'))).json) || [];
    const mBiz = ((await member.get(q('/api/holdings?scope=business'))).json) || [];
    A('business holding MSFT (member) → in the owner\'s business portfolio (bug: missing)', hb.status === 201 && oBiz.some(h => h.ticker === 'MSFT'), `status ${hb.status} ${JSON.stringify(oBiz.map(h => h.ticker))}`);
    A('  and still in the member\'s business view', mBiz.some(h => h.ticker === 'MSFT'), JSON.stringify(mBiz.map(h => h.ticker)));
    A('personal holding AAPL (member) → the member\'s own personal portfolio, NOT the owner\'s', hp.status === 201 && mPer.some(h => h.ticker === 'AAPL') && !oPer.some(h => h.ticker === 'AAPL'),
      `status ${hp.status} member ${JSON.stringify(mPer.map(h => h.ticker))} owner ${JSON.stringify(oPer.map(h => h.ticker))}`);
    const msft = oBiz.find(h => h.ticker === 'MSFT');
    if (msft) {
      const ed = await owner.put(q(`/api/holdings/${msft.id}`), { price: 410 });
      A('  the owner can edit the member-added business holding (bug: 404)', ed.status === 200 && Number(ed.json && ed.json.price) === 410, `status ${ed.status}`);
    }
    const aapl = mPer.find(h => h.ticker === 'AAPL');
    if (aapl) {
      const od = await owner.del(q(`/api/holdings/${aapl.id}`));
      A('  the owner cannot delete the member\'s PERSONAL holding (404)', od.status === 404, `status ${od.status}`);
    }
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (team-member writes)` : `  ALL GREEN — ${pass} passed, 0 failed  (team-member writes)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main();
