#!/usr/bin/env node
'use strict';
/**
 * verify-plan-account-scope.js — N5. Plan / trial enforcement follows the ACCOUNT being written to, not
 * the person writing.
 *
 * Defect: checkPlan read the acting user's own plan (req.session.userId) and ran before the account
 * resolver. A team member whose own trial had lapsed was blocked (402) from working in a PAYING account,
 * and a member who paid for their own account could write into an EXPIRED one.
 *
 * Executed against the real server + Postgres. Accounts: P (business plan) with member M (M's own
 * trial expired); X (trial expired) with member Y (Y's own account on business). Bug value stated:
 *   M writes an expense into P → 201                    (bug: 402 TRIAL_EXPIRED)
 *   Y writes an expense into X → 402 TRIAL_EXPIRED      (bug: 201)
 *   controls: P owner → 201; X owner → 402; Y can still READ X (GET 200)
 *   node -r ./tests/harness/clock.js tests/harness/verify-plan-account-scope.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'plan-scope-pw-1';
    const past = new Date(Date.now() - 5 * 864e5).toISOString();
    const mk = async (email, plan, trialEnds) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email, plan, trial_ends: trialEnds, role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const P = await mk('plan-p@finflow.test', 'business', null);
    const M = await mk('plan-m@finflow.test', 'trial', past);
    const X = await mk('plan-x@finflow.test', 'trial', past);
    const Y = await mk('plan-y@finflow.test', 'business', null);
    for (const u of [P, X]) await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [u, { name: 'Co ' + u, currency: 'USD', is_active: 1 }]);
    await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [P, { email: 'plan-m@finflow.test', role: 'admin', status: 'active', member_user_id: String(M) }]);
    await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [X, { email: 'plan-y@finflow.test', role: 'admin', status: 'active', member_user_id: String(Y) }]);
    let ip = 1;
    const login = async (email) => { const h = new HarnessHttp(server.baseUrl, { xff: '10.5.0.' + (ip++) }); if ((await h.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + email); return h; };
    const hP = await login('plan-p@finflow.test'), hM = await login('plan-m@finflow.test'), hX = await login('plan-x@finflow.test'), hY = await login('plan-y@finflow.test');
    const exp = (h, d) => h.post('/api/expenses', { description: d, amount: 10, expense_date: '2026-07-10' });

    console.log('\n' + '='.repeat(78));
    console.log('  PLAN ENFORCEMENT FOLLOWS THE ACCOUNT, NOT THE ACTOR');
    console.log('='.repeat(78));
    const m = await exp(hM, 'member in paying account');
    A('member (own trial expired) writes into the PAYING account → 201 (bug: 402)', m.status === 201, `status ${m.status}: ${m.text.slice(0, 100)}`);
    const y = await exp(hY, 'member in expired account');
    A('member (own plan paid) writes into the EXPIRED account → 402 (bug: 201)', y.status === 402 && y.json && y.json.code === 'TRIAL_EXPIRED', `status ${y.status}: ${y.text.slice(0, 100)}`);
    A('control: paying owner writes → 201', (await exp(hP, 'owner P')).status === 201);
    A('control: expired owner writes → 402', (await exp(hX, 'owner X')).status === 402);
    A('control: member can still READ the expired account (GET 200)', (await hY.get('/api/expenses')).status === 200);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (plan follows account)` : `  ALL GREEN — ${pass} passed, 0 failed  (plan follows account)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
