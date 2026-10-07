#!/usr/bin/env node
'use strict';
/**
 * verify-subscription-cancel-readonly.js — a CANCELLED paid subscription must leave the account
 * READ-ONLY (owner decision 2026-10-06: same treatment as an expired trial), not with unlimited access.
 *
 * Defect: checkout.session.completed sets plan=<paid> and trial_ends=null; customer.subscription.deleted
 * sets plan='trial' but leaves trial_ends null. checkPlan only restricts `plan==='trial' && trial_ends < now`,
 * so a null trial_ends never restricts → a cancelled customer keeps full write access forever.
 *
 * Discriminating seed (Rule 4): the SAME write after cancellation returns 201 under the bug and
 * 402 TRIAL_EXPIRED when fixed. Control: a live (unexpired) trial user can still write (201), and the
 * cancelled user can still READ (200).
 *
 * Executes the real signed-webhook path (real Stripe SDK signature + constructEvent) against real Postgres.
 *   node -r ./tests/harness/clock.js tests/harness/verify-subscription-cancel-readonly.js
 */

const bcrypt = require('bcryptjs');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'cancel-test-pw-1';
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    const mkUser = async (email) => {
      const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data) VALUES (NULL,NULL,$1) RETURNING id`,
        [{ email, name: 'U', plan: 'trial', trial_ends: future, role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
      await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1,NULL,$2)`, [uid, { name: 'Co ' + uid, currency: 'USD', is_active: 1 }]);
      return uid;
    };
    const postSigned = (evt) => {
      const payload = JSON.stringify(evt);
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    };
    let ip = 0;
    const login = async (email) => { const h = new HarnessHttp(server.baseUrl, { xff: '10.7.0.' + (++ip) }); const r = await h.post('/api/auth/login', { email, password: PW }); return { h, status: r.status }; };
    const userData = async (uid) => (await c.query(`SELECT data FROM users WHERE id=$1`, [uid])).rows[0].data;

    console.log('\n' + '='.repeat(78));
    console.log('  CANCELLED SUBSCRIPTION → READ-ONLY');
    console.log('='.repeat(78));

    // Control: a live trial user writes normally.
    const live = await mkUser('live-trial@finflow.test');
    const L = await login('live-trial@finflow.test');
    A('control: live trial user logs in', L.status === 200, 'status ' + L.status);
    const lw = await L.h.post('/api/expenses', { description: 'Control expense', amount: 11, expense_date: '2026-07-20' });
    A('control: live trial user can still write (201)', lw.status === 201, `status ${lw.status}: ${lw.text.slice(0, 120)}`);

    // Subscriber: upgrade, then cancel.
    const sub = await mkUser('cancelled@finflow.test');
    const up = await postSigned({ id: 'evt_up_1', type: 'checkout.session.completed', data: { object: { payment_status: 'paid',
      id: 'cs_sub_1', object: 'checkout.session', mode: 'subscription', amount_total: 7900, metadata: { userId: String(sub), plan: 'pro' } } } });
    A('upgrade webhook → 200', up.status === 200, 'status ' + up.status);
    A('after upgrade: plan=pro', (await userData(sub)).plan === 'pro', JSON.stringify(await userData(sub)));

    const S = await login('cancelled@finflow.test');
    const pw1 = await S.h.post('/api/expenses', { description: 'Paid-plan expense', amount: 23, expense_date: '2026-07-20' });
    A('while subscribed: write allowed (201)', pw1.status === 201, `status ${pw1.status}`);

    const del = await postSigned({ id: 'evt_del_1', type: 'customer.subscription.deleted', data: { object: {
      id: 'sub_1', object: 'subscription', status: 'canceled', metadata: { userId: String(sub) } } } });
    A('cancel webhook → 200', del.status === 200, 'status ' + del.status);
    const after = await userData(sub);
    A('after cancel: plan=trial', after.plan === 'trial', JSON.stringify(after));
    A('after cancel: trial_ends is set and not in the future (bug leaves it null)',
      !!after.trial_ends && new Date(after.trial_ends).getTime() <= Date.now(), 'trial_ends=' + after.trial_ends);

    // The discriminating assertion: bug → 201, fixed → 402.
    const w2 = await S.h.post('/api/expenses', { description: 'Post-cancel expense', amount: 37, expense_date: '2026-07-21' });
    A('after cancel: write is refused 402 TRIAL_EXPIRED (bug returns 201)', w2.status === 402 && /TRIAL_EXPIRED/.test(w2.text), `status ${w2.status}: ${w2.text.slice(0, 120)}`);
    const rd = await S.h.get('/api/expenses');
    A('after cancel: read still allowed (200, read-only not lockout)', rd.status === 200, 'status ' + rd.status);
    A('no post-cancel expense row was written', Number((await c.query(`SELECT COUNT(*) n FROM expenses WHERE user_id=$1 AND data->>'description'='Post-cancel expense'`, [sub])).rows[0].n) === 0);

    // Resubscribe restores write access.
    const re = await postSigned({ id: 'evt_up_2', type: 'checkout.session.completed', data: { object: { payment_status: 'paid',
      id: 'cs_sub_2', object: 'checkout.session', mode: 'subscription', amount_total: 7900, metadata: { userId: String(sub), plan: 'pro' } } } });
    A('resubscribe webhook → 200', re.status === 200, 'status ' + re.status);
    const w3 = await S.h.post('/api/expenses', { description: 'Resubscribed expense', amount: 41, expense_date: '2026-07-22' });
    A('after resubscribe: write allowed again (201)', w3.status === 201, `status ${w3.status}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (subscription cancel → read-only)` : `  ALL GREEN — ${pass} passed, 0 failed  (subscription cancel → read-only)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
