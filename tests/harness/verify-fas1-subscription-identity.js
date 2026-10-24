#!/usr/bin/env node
'use strict';
/**
 * verify-fas1-subscription-identity.js — FA-S1 (found 2026-10-23 while designing D-G / D-B).
 * Checkout put the user id on the Checkout SESSION's metadata only. Stripe does not copy that onto the Subscription it
 * creates, so every real customer.subscription.created / updated / deleted event arrived WITHOUT metadata.userId and
 * every handler keyed on it did nothing:
 *   • the subscription id was never stored → deleting an account could not cancel its billing (N101's test passed only
 *     because it sent a synthetic event that carried the metadata)
 *   • a subscription cancelled or unpaid in Stripe never made the account read-only
 *   • subscriptionStatus (which referral payouts depend on) was never updated after checkout
 * After: checkout sets subscription_data.metadata (userId, plan); checkout.session.completed stores the subscription
 * and customer ids; subscription events find the user by metadata OR by the stored subscription / customer id.
 * Real server + Postgres; the Stripe client is the live instance with checkout.sessions.create captured at the
 * boundary; webhooks are real signed events.
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_fas1';
process.env.STRIPE_PRICE_BUSINESS = 'price_business_m';
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
    const created = [];
    stripe.checkout.sessions.create = async (args) => { created.push(args); return { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }; };
    const send = async (evt) => {
      const payload = JSON.stringify(Object.assign({ object: 'event' }, evt));
      const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload });
    };
    const PW = 'fas1-pw-123';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'fas1@finflow.test', plan: 'trial', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const u = async () => (await c.query(`SELECT data FROM users WHERE id = $1`, [uid])).rows[0].data;
    console.log('\n' + '='.repeat(78) + '\n  FA-S1 — subscription events find their user\n' + '='.repeat(78));

    const h = new HarnessHttp(server.baseUrl, { xff: '10.111.0.1' });
    await h.post('/api/auth/login', { email: 'fas1@finflow.test', password: PW });
    const co = await h.post('/api/stripe/checkout', { plan: 'business' });
    const args = created[0] || {};
    A('1  checkout puts the user id on the SUBSCRIPTION too (subscription_data.metadata.userId; bug: session only)', co.status === 200 && String(((args.subscription_data || {}).metadata || {}).userId) === String(uid), co.status + ' ' + JSON.stringify(args.subscription_data || null));

    const r2 = await send({ id: 'evt_cs_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', object: 'checkout.session', mode: 'subscription', payment_status: 'paid', subscription: 'sub_A', customer: 'cus_A', amount_total: 24900, metadata: { userId: String(uid), plan: 'business' } } } });
    const d2 = await u();
    A('2  checkout.session.completed stores the subscription and customer ids (bug: not stored)', r2.status === 200 && d2.plan === 'business' && d2.stripe_subscription_id === 'sub_A' && d2.stripe_customer_id === 'cus_A', r2.status + ' ' + JSON.stringify({ plan: d2.plan, sub: d2.stripe_subscription_id, cus: d2.stripe_customer_id }));

    // what Stripe really sends for a Checkout-created subscription: NO metadata
    const r3 = await send({ id: 'evt_sub_upd', type: 'customer.subscription.updated', data: { object: { id: 'sub_A', object: 'subscription', status: 'past_due', customer: 'cus_A', metadata: {} } } });
    const d3 = await u();
    A('3  a subscription update WITHOUT metadata still reaches the user (status past_due; bug: ignored)', r3.status === 200 && d3.subscriptionStatus === 'past_due', r3.status + ' status=' + d3.subscriptionStatus);

    const r4 = await send({ id: 'evt_sub_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_A', object: 'subscription', status: 'canceled', customer: 'cus_A', metadata: {} } } });
    const d4 = await u();
    A('4  a cancellation WITHOUT metadata makes the account read-only (plan ends; bug: kept writing for ever)', r4.status === 200 && d4.plan === 'trial' && !!d4.trial_ends && d4.subscriptionStatus === 'canceled', r4.status + ' ' + JSON.stringify({ plan: d4.plan, trial_ends: d4.trial_ends, status: d4.subscriptionStatus }));

    const other = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'fas1-other@finflow.test', plan: 'business', role: 'owner', stripe_customer_id: 'cus_OTHER' }])).rows[0].id;
    await send({ id: 'evt_sub_del2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_UNKNOWN', object: 'subscription', status: 'canceled', customer: 'cus_NOBODY', metadata: {} } } });
    const od = (await c.query(`SELECT data FROM users WHERE id = $1`, [other])).rows[0].data;
    A('5  an event for an unknown subscription touches nobody', od.plan === 'business', JSON.stringify(od.plan));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-S1 subscription identity)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
