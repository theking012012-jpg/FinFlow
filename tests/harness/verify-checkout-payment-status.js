#!/usr/bin/env node
'use strict';
/**
 * verify-checkout-payment-status.js — N7. A Stripe Checkout that completed but is NOT yet paid books
 * nothing; it is booked when Stripe confirms the payment.
 *
 * Defect: checkout.session.completed upgraded the user's plan and recorded invoice payments without
 * reading payment_status. With delayed payment methods (bank debits, vouchers) the session completes
 * 'unpaid' and may later fail — the plan was already upgraded and the invoice already marked paid.
 * checkout.session.async_payment_succeeded (the event that confirms those) was ignored.
 *
 * Executed: real signed webhooks (real Stripe SDK signature) against the real server + Postgres. Bug
 * value stated:
 *   completed + payment_status 'unpaid' (subscription)   → plan stays trial          (bug: business)
 *   completed + 'unpaid' (invoice 500 payment)           → invoice amount_paid 0      (bug: 500)
 *   async_payment_succeeded + 'paid' for both            → plan business; amount_paid 500 (bug: ignored)
 *   control: completed + 'paid' (second user)             → plan business
 *   node -r ./tests/harness/clock.js tests/harness/verify-checkout-payment-status.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_status';
const bcrypt = require('bcryptjs');
require('./clock.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const post = (evt) => { const payload = JSON.stringify(evt); return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }, body: payload }); };
    const mkUser = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'trial', trial_ends: '2026-08-01T00:00:00Z', role: 'owner', password: bcrypt.hashSync('x', 4) }])).rows[0].id;
    const U = await mkUser('cs-u@finflow.test'), V = await mkUser('cs-v@finflow.test');
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [U, { name: 'CS Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const inv = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [U, eid, { client: 'Cust', amount: 500, status: 'pending', issue_date: '2026-07-01', amount_paid: 0 }])).rows[0].id;
    const plan = async (id) => (await c.query(`SELECT data->>'plan' p FROM users WHERE id=$1`, [id])).rows[0].p;
    const paid = async () => Number((await c.query(`SELECT COALESCE((data->>'amount_paid')::numeric,0) a FROM invoices WHERE id=$1`, [inv])).rows[0].a);
    const sub = (id, type, status, uid) => ({ id, object: 'event', type, data: { object: { id: 'cs_sub_' + uid, object: 'checkout.session', mode: 'subscription', payment_status: status, metadata: { userId: String(uid), plan: 'business' } } } });
    const pay = (id, type, status) => ({ id, object: 'event', type, data: { object: { id: 'cs_inv_1', object: 'checkout.session', mode: 'payment', payment_status: status, amount_total: 50000, currency: 'usd', client_reference_id: String(inv), metadata: { kind: 'invoice_payment', invoice_id: String(inv) } } } });

    console.log('\n' + '='.repeat(78));
    console.log('  CHECKOUT — completed-but-unpaid books nothing until paid');
    console.log('='.repeat(78));
    A('completed/unpaid subscription → 200', (await post(sub('evt_s1', 'checkout.session.completed', 'unpaid', U))).status === 200);
    A('  plan stays trial (bug: business)', (await plan(U)) === 'trial', 'plan=' + await plan(U));
    A('completed/unpaid invoice payment → 200', (await post(pay('evt_p1', 'checkout.session.completed', 'unpaid'))).status === 200);
    A('  invoice amount_paid stays 0 (bug: 500)', (await paid()) === 0, 'amount_paid=' + await paid());
    A('async_payment_succeeded (subscription, paid) → 200', (await post(sub('evt_s2', 'checkout.session.async_payment_succeeded', 'paid', U))).status === 200);
    A('  plan now business (bug: event ignored)', (await plan(U)) === 'business', 'plan=' + await plan(U));
    A('async_payment_succeeded (invoice, paid) → 200', (await post(pay('evt_p2', 'checkout.session.async_payment_succeeded', 'paid'))).status === 200);
    A('  invoice amount_paid 500 (bug: 0, event ignored)', (await paid()) === 500, 'amount_paid=' + await paid());
    A('control: completed + paid upgrades immediately', (await post(sub('evt_s3', 'checkout.session.completed', 'paid', V))).status === 200 && (await plan(V)) === 'business', 'plan=' + await plan(V));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (checkout payment status)` : `  ALL GREEN — ${pass} passed, 0 failed  (checkout payment status)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
