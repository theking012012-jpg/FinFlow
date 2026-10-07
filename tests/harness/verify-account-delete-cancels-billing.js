#!/usr/bin/env node
'use strict';
/**
 * verify-account-delete-cancels-billing.js — N101. Deleting an account cancels its Stripe subscription;
 * if the cancel fails, nothing is deleted.
 *
 * Defect: no subscription id was stored anywhere, so account deletion could not cancel billing — a
 * deleted user kept being charged, with no login left to cancel from.
 *
 * Executed against the real server + Postgres; real signed subscription webhook; stripe.subscriptions
 * .cancel mocked on the live client instance (calls captured). Bug value stated:
 *   customer.subscription.created stores the subscription id on the user     (bug: not stored)
 *   delete with an active subscription → subscriptions.cancel('sub_live_1') (bug: never called)
 *   Stripe cancel fails → 502, account and books intact                      (bug: n/a — deleted while billed)
 *   node -r ./tests/harness/clock.js tests/harness/verify-account-delete-cancels-billing.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_n101';
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
    const app = require('../../server.js');
    const stripe = app._stripe();
    const cancels = []; let failCancel = true;
    stripe.subscriptions.cancel = async (id) => { cancels.push(id); if (failCancel) { failCancel = false; const e = new Error('api down'); e.statusCode = 500; throw e; } return { id, status: 'canceled' }; };
    const PW = 'n101-pw-123';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'n101@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'N101 Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { client: 'C', amount: 10, status: 'pending', issue_date: '2026-07-01' }]);
    const payload = JSON.stringify({ id: 'evt_sub_1', object: 'event', type: 'customer.subscription.created', data: { object: { id: 'sub_live_1', object: 'subscription', status: 'active', customer: 'cus_1', metadata: { userId: String(uid) } } } });
    const wh = await fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }, body: payload });
    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNT DELETE CANCELS BILLING');
    console.log('='.repeat(78));
    const stored = (await c.query(`SELECT data->>'stripe_subscription_id' s FROM users WHERE id=$1`, [uid])).rows[0].s;
    A('subscription webhook → 200, subscription id stored on the user (bug: not stored)', wh.status === 200 && stored === 'sub_live_1', `status ${wh.status} stored=${stored}`);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.101.0.1' });
    await h.post('/api/auth/login', { email: 'n101@finflow.test', password: PW });
    const r1 = await h.request('DELETE', '/api/auth/account', { password: PW });
    A('Stripe cancel fails → 502', r1.status === 502, `status ${r1.status}`);
    A('  nothing deleted (user + invoice intact)', Number((await c.query(`SELECT COUNT(*) n FROM users WHERE id=$1`, [uid])).rows[0].n) === 1 && Number((await c.query(`SELECT COUNT(*) n FROM invoices WHERE user_id=$1`, [uid])).rows[0].n) === 1);
    const r2 = await h.request('DELETE', '/api/auth/account', { password: PW });
    A('retry: delete → 200', r2.status === 200, `status ${r2.status}: ${r2.text.slice(0, 100)}`);
    A('  subscriptions.cancel called with sub_live_1 (bug: never called)', cancels.length === 2 && cancels.every(x => x === 'sub_live_1'), JSON.stringify(cancels));
    A('  account gone', Number((await c.query(`SELECT COUNT(*) n FROM users WHERE id=$1`, [uid])).rows[0].n) === 0);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (delete cancels billing)` : `  ALL GREEN — ${pass} passed, 0 failed  (delete cancels billing)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
