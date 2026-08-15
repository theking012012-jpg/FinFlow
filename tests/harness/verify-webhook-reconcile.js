#!/usr/bin/env node
'use strict';
/**
 * verify-webhook-reconcile.js — F171. When a customer actually pays an invoice via a Stripe "Pay
 * now" link, the SIGNED webhook records the payment through the SAME invoice_payments writer +
 * recalcInvoiceStatus as the manual path (Rule 2/6: one writer of amount_paid), idempotent on the
 * Stripe session id (Rule 9), and only ever on a signature-verified event (forgeries rejected).
 *
 * This EXECUTES the money path end-to-end minus a real Stripe charge: it signs synthetic
 * checkout.session.completed events with the real Stripe SDK (generateTestHeaderString) and posts
 * the raw body, so the server's real constructEvent verification + write run for real.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-webhook-reconcile.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
process.env.HARNESS_KEEP_STRIPE = '1';   // tell boot.js to keep the Stripe keys (signed-webhook test)
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'wh-owner@finflow.test', name: 'WH', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'WH Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const mkInvoice = async (amount) => (await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { client: 'Cust', amount, currency: 'USD', status: 'pending', amount_paid: 0, issue_date: '2026-07-10' }])).rows[0].id;
    const invState = async (id) => { const r = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM invoices WHERE id=$1`, [id])).rows[0]; return { status: r.s, paid: parseFloat(r.p || 0) }; };
    const payCount = async (id) => Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1`, [id])).rows[0].n);

    const sessionEvent = (sessionId, invoiceId, amountMinor) => ({
      id: 'evt_' + sessionId, type: 'checkout.session.completed', data: { object: {
        id: sessionId, object: 'checkout.session', mode: 'payment', amount_total: amountMinor, currency: 'usd',
        client_reference_id: String(invoiceId), metadata: { kind: 'invoice_payment', invoice_id: String(invoiceId) },
      } },
    });
    const postSigned = (evt, { badSig = false } = {}) => {
      const payload = JSON.stringify(evt);
      const header = badSig ? 't=1,v1=deadbeefdeadbeef' : stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    };

    console.log('\n' + '='.repeat(78));
    console.log('  STRIPE WEBHOOK RECONCILIATION — signed, idempotent, single-writer');
    console.log('='.repeat(78));

    // ── 1 · a valid signed payment records + marks paid ──
    const inv1 = await mkInvoice(500);
    const r1 = await postSigned(sessionEvent('cs_test_1', inv1, 50000));
    A('valid signed webhook → 200', r1.status === 200, `status ${r1.status}`);
    const s1 = await invState(inv1);
    A('invoice recorded paid via the single writer (amount_paid=500, status=paid)', s1.paid === 500 && s1.status === 'paid', JSON.stringify(s1));
    A('exactly one invoice_payments row', (await payCount(inv1)) === 1);
    A('the payment carries the Stripe session idempotency key', Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1 AND idempotency_key='stripe:cs_test_1'`, [inv1])).rows[0].n) === 1);

    // ── 2 · idempotency: the same event again does NOT double-book (Rule 9) ──
    const r2 = await postSigned(sessionEvent('cs_test_1', inv1, 50000));
    A('duplicate webhook → 200', r2.status === 200);
    A('still exactly one payment (no double-book)', (await payCount(inv1)) === 1);
    A('amount_paid unchanged at 500', (await invState(inv1)).paid === 500);

    // ── 3 · forged signature is rejected (no write) ──
    const inv3 = await mkInvoice(200);
    const r3 = await postSigned(sessionEvent('cs_forged', inv3, 20000), { badSig: true });
    A('forged signature → 400 (constructEvent rejects)', r3.status === 400, `status ${r3.status}`);
    A('no payment written for a forged event', (await payCount(inv3)) === 0);
    A('forged: invoice still unpaid', (await invState(inv3)).status === 'pending');

    // ── 4 · overpayment is capped to the balance (no negative AR, no refund model) ──
    const inv4 = await mkInvoice(100);
    await postSigned(sessionEvent('cs_test_4', inv4, 50000));  // customer "paid" 500 on a 100 invoice
    const s4 = await invState(inv4);
    A('overpayment booked only up to the balance (amount_paid=100, paid)', s4.paid === 100 && s4.status === 'paid', JSON.stringify(s4));

    // ── 5 · unknown invoice reference is ignored gracefully ──
    const r5 = await postSigned(sessionEvent('cs_test_5', 999999, 10000));
    A('unknown invoice → 200, nothing written', r5.status === 200 && (await payCount(999999)) === 0);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (webhook reconciliation)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  NOTE: a real Stripe charge is UNEXECUTED (needs a live account); the signed-event path IS executed.');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[webhook] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
