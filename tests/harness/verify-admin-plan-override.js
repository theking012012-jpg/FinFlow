#!/usr/bin/env node
'use strict';
/**
 * verify-admin-plan-override.js — N87 (plan override). The admin can set every real plan, the users table
 * shows a Scale customer as Scale, and downgrading to trial never grants unlimited access.
 *
 * Defects: the override allowlist and the admin dropdown omitted 'scale' (a Scale row rendered with
 * "Trial" pre-selected, so a single Save downgraded the customer); setting 'trial' left trial_ends null,
 * which checkPlan treats as an unlimited trial.
 *
 * Executed against the real server + Postgres (and the real admin.html row template in jsdom). Bug value stated:
 *   override → 'scale' → 200, plan scale                         (bug: 400 Invalid plan)
 *   admin users row for a Scale customer pre-selects "scale"       (bug: "trial" pre-selected)
 *   paid user (trial_ends null) overridden to 'trial' → a write is 402 TRIAL_EXPIRED (bug: 201, unlimited)
 *   control: a trial with a FUTURE end keeps that end (write allowed)
 *   node -r ./tests/harness/clock.js tests/harness/verify-admin-plan-override.js
 */
process.env.ADMIN_PASSWORD = 'harness-admin-password';
const bcrypt = require('bcryptjs');
require('./clock.js');
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
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
    const PW = 'plan-ovr-pw-1';
    const mk = async (email, extra) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [Object.assign({ email, role: 'owner', password: bcrypt.hashSync(PW, 10) }, extra)])).rows[0].id;
    const S = await mk('po-s@finflow.test', { plan: 'business' });
    const P = await mk('po-p@finflow.test', { plan: 'business', trial_ends: null });
    const T = await mk('po-t@finflow.test', { plan: 'pro', trial_ends: new Date(Date.now() + 10 * 864e5).toISOString() });
    for (const u of [P, T]) await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [u, { name: 'Co ' + u, currency: 'USD', is_active: 1 }]);
    const adm = new HarnessHttp(server.baseUrl, { xff: '10.87.0.1' });
    A('admin login', (await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
    const plan = async (id) => (await c.query(`SELECT data->>'plan' p FROM users WHERE id=$1`, [id])).rows[0].p;

    console.log('\n' + '='.repeat(78));
    console.log('  ADMIN PLAN OVERRIDE');
    console.log('='.repeat(78));
    const r = await adm.post(`/api/admin/users/${S}/plan`, { plan: 'scale' });
    A('override → scale → 200 (bug: 400 Invalid plan)', r.status === 200 && (await plan(S)) === 'scale', `status ${r.status} plan=${await plan(S)}`);

    // the real admin.html users-row template, rendered for a Scale customer
    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'admin.html'), 'utf8');
    const m = html.match(/<select class="filter-select" id="plan-sel-\$\{u\.id\}"[\s\S]*?<\/select>/);
    const tpl = m ? m[0] : '';
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
    dom.window.eval('var u = { id: 7, plan: "scale" }; document.body.innerHTML = `' + tpl.replace(/`/g, '\\`') + '`;');
    const sel = dom.window.document.getElementById('plan-sel-7');
    A('admin users row for a Scale customer pre-selects "scale" (bug: "trial")', sel && sel.value === 'scale', 'selected=' + (sel && sel.value));

    await adm.post(`/api/admin/users/${P}/plan`, { plan: 'trial' });
    const hp = new HarnessHttp(server.baseUrl, { xff: '10.87.0.2' });
    await hp.post('/api/auth/login', { email: 'po-p@finflow.test', password: PW });
    const w = await hp.post('/api/expenses', { description: 'x', amount: 1, expense_date: '2026-07-10' });
    A('paid user overridden to trial (no end date) → write 402 TRIAL_EXPIRED (bug: 201, unlimited)', w.status === 402, `status ${w.status}`);

    await adm.post(`/api/admin/users/${T}/plan`, { plan: 'trial' });
    const ht = new HarnessHttp(server.baseUrl, { xff: '10.87.0.3' });
    await ht.post('/api/auth/login', { email: 'po-t@finflow.test', password: PW });
    A('control: a trial with a future end keeps it (write → 201)', (await ht.post('/api/expenses', { description: 'y', amount: 1, expense_date: '2026-07-10' })).status === 201);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (admin plan override)` : `  ALL GREEN — ${pass} passed, 0 failed  (admin plan override)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
