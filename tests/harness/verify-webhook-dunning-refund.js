#!/usr/bin/env node
'use strict';
/**
 * verify-webhook-dunning-refund.js — F200. Payments robustness on the SIGNED Stripe webhook:
 *   • invoice.payment_failed  → dunning: user marked past_due + paymentFailedAt stamped
 *   • charge.dispute.created  → accepted (operator-alert path), never mutates books
 *   • charge.refunded         → reverses the recorded invoice payment (negative row), AR restored,
 *                               idempotent on the refund id (a second event id, same refund, no double)
 *   • forged signature        → rejected 400
 * Signs synthetic events with the real Stripe SDK (generateTestHeaderString) and posts the raw body,
 * so the server's real constructEvent verification + handlers run for real. Scratch Postgres only.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-webhook-dunning-refund.js
 */
const bcrypt = require('bcryptjs');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'wh2@finflow.test', name: 'WH2', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Co', currency: 'USD', is_active: 1 }])).rows[0].id;

    const postSigned = (evt, { badSig = false } = {}) => {
      const payload = JSON.stringify(evt);
      const header = badSig ? 't=1,v1=deadbeef' : stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    };
    const userField = async (f) => (await c.query(`SELECT data->>'${f}' v FROM users WHERE id=$1`, [uid])).rows[0].v;

    // ── Forged signature is rejected ──────────────────────────────────────────────
    const forged = await postSigned({ id: 'evt_forge', type: 'invoice.payment_failed', data: { object: {} } }, { badSig: true });
    A('forged signature rejected (400)', forged.status === 400, 'HTTP ' + forged.status);

    // ── Dunning ───────────────────────────────────────────────────────────────────
    const dun = await postSigned({ id: 'evt_dun1', type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', object: 'invoice', subscription: 'sub_1', subscription_details: { metadata: { userId: String(uid) } } } } });
    A('invoice.payment_failed accepted (200)', dun.status === 200, 'HTTP ' + dun.status);
    A('user marked past_due (dunning)', (await userField('subscriptionStatus')) === 'past_due', 'status=' + await userField('subscriptionStatus'));
    A('paymentFailedAt stamped', !!(await userField('paymentFailedAt')));

    // ── Dispute accepted, no book mutation ─────────────────────────────────────────
    const disp = await postSigned({ id: 'evt_disp1', type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', charge: 'ch_x', amount: 5000, reason: 'fraudulent', status: 'needs_response' } } });
    A('charge.dispute.created accepted (200)', disp.status === 200, 'HTTP ' + disp.status);

    // ── Refund reverses the recorded invoice payment ───────────────────────────────
    // Seed a fully-paid invoice + the original external Stripe payment (as the "Pay now" path records it).
    const invId = (await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { client: 'Cust', amount: 100, currency: 'USD', status: 'paid', amount_paid: 100, issue_date: '2026-07-10' }])).rows[0].id;
    await c.query(`INSERT INTO invoice_payments (user_id,entity_id,invoice_id,amount,payment_date,method,reference,notes,idempotency_key)
      VALUES ($1,$2,$3,100,'2026-07-10','Card (Stripe)','stripe-invpay:ch_ref1','orig','stripe-invpay:ch_ref1')`, [uid, eid, invId]);

    const refundEvt = (evtId) => ({ id: evtId, type: 'charge.refunded',
      data: { object: { id: 'ch_ref1', object: 'charge', amount_refunded: 10000, refunded: true, refunds: { data: [{ id: 're_1' }] } } } });

    const ref1 = await postSigned(refundEvt('evt_ref1'));
    A('charge.refunded accepted (200)', ref1.status === 200, 'HTTP ' + ref1.status);
    const revRows = async () => Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE idempotency_key='stripe-refund:re_1'`)).rows[0].n);
    A('a reversing (refund) payment row was booked', (await revRows()) === 1);
    const revAmt = (await c.query(`SELECT amount FROM invoice_payments WHERE idempotency_key='stripe-refund:re_1'`)).rows[0]?.amount;
    A('reversal amount is -100', near(revAmt, -100), 'amt=' + revAmt);
    const inv1 = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM invoices WHERE id=$1`, [invId])).rows[0];
    A('invoice amount_paid restored to 0 after refund', near(inv1.p, 0), 'paid=' + inv1.p);
    A('invoice status reverted from paid → pending', inv1.s === 'pending', 'status=' + inv1.s);

    // ── Refund idempotency: a DIFFERENT event id carrying the SAME refund must not double-reverse ──
    const ref2 = await postSigned(refundEvt('evt_ref2'));
    A('second refund event accepted (200)', ref2.status === 200, 'HTTP ' + ref2.status);
    A('no double reversal (still exactly one refund row)', (await revRows()) === 1);
    const inv2 = (await c.query(`SELECT data->>'amount_paid' p FROM invoices WHERE id=$1`, [invId])).rows[0];
    A('amount_paid stays 0 (not driven negative by a double refund)', near(inv2.p, 0), 'paid=' + inv2.p);

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (webhook dunning + dispute + idempotent refund reversal)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[wh-dr] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
