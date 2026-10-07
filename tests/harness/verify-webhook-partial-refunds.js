#!/usr/bin/env node
'use strict';
/**
 * verify-webhook-partial-refunds.js — N3 + N47 (refund leg). charge.refunded carries a CUMULATIVE
 * amount_refunded; only the not-yet-reversed delta may be booked, and minor units must convert by the
 * charge currency's exponent.
 *
 * Discriminating seeds (Rule 4):
 *   USD $100 paid; refund $30 then a second refund to cumulative $50.
 *     correct amount_paid = 50.   bug (re-books cumulative) = 100 − 30 − 50 = 20.
 *   JPY ¥10000 paid; refund ¥4000 (amount_refunded=4000, zero-decimal).
 *     correct amount_paid = 6000. bug (/100) = 10000 − 40 = 9960.
 *   node -r ./tests/harness/clock.js tests/harness/verify-webhook-partial-refunds.js
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
const near = (a, b) => Math.abs(a - b) < 0.005;

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: 'refunds@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const post = (evt) => {
      const payload = JSON.stringify(evt);
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    };
    const seedPaid = async (amount, chargeId) => {
      const inv = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
        [uid, eid, { client: 'Cust', amount, status: 'paid', amount_paid: amount, issue_date: '2026-07-10' }])).rows[0].id;
      await c.query(`INSERT INTO invoice_payments (user_id,entity_id,invoice_id,amount,payment_date,method,reference,notes,idempotency_key)
        VALUES ($1,$2,$3,$4,'2026-07-10','Card (Stripe)',$5,'orig',$5)`, [uid, eid, inv, amount, 'stripe-invpay:' + chargeId]);
      return inv;
    };
    const paid = async (inv) => parseFloat((await c.query(`SELECT data->>'amount_paid' p FROM invoices WHERE id=$1`, [inv])).rows[0].p);
    const refundEvt = (evtId, chargeId, cumMinor, refundIds, currency) => ({ id: evtId, type: 'charge.refunded',
      data: { object: { id: chargeId, object: 'charge', currency, amount_refunded: cumMinor, refunds: { data: refundIds.map(id => ({ id })) } } } });

    console.log('\n' + '='.repeat(78));
    console.log('  STRIPE PARTIAL REFUNDS — delta only, currency exponent');
    console.log('='.repeat(78));

    const inv = await seedPaid(100, 'ch_part');
    A('refund #1 ($30) accepted', (await post(refundEvt('evt_p1', 'ch_part', 3000, ['re_1'], 'usd'))).status === 200);
    A('after refund #1: amount_paid = 70', near(await paid(inv), 70), 'paid=' + await paid(inv));
    A('refund #2 (cumulative $50) accepted', (await post(refundEvt('evt_p2', 'ch_part', 5000, ['re_2', 're_1'], 'usd'))).status === 200);
    A('after refund #2: amount_paid = 50 (bug gives 20)', near(await paid(inv), 50), 'paid=' + await paid(inv));
    A('redelivery of refund #2 under a new event id changes nothing', (await post(refundEvt('evt_p2b', 'ch_part', 5000, ['re_2', 're_1'], 'usd'))).status === 200 && near(await paid(inv), 50), 'paid=' + await paid(inv));
    const st = (await c.query(`SELECT data->>'status' s FROM invoices WHERE id=$1`, [inv])).rows[0].s;
    A('status is partial after a partial refund', st === 'partial', 'status=' + st);
    A('full refund (cumulative $100) → amount_paid 0, never negative', (await post(refundEvt('evt_p3', 'ch_part', 10000, ['re_3', 're_2', 're_1'], 'usd'))).status === 200 && near(await paid(inv), 0), 'paid=' + await paid(inv));

    const jinv = await seedPaid(10000, 'ch_jpy');
    A('JPY refund accepted', (await post(refundEvt('evt_j1', 'ch_jpy', 4000, ['re_j1'], 'jpy'))).status === 200);
    A('JPY: ¥4000 refund → amount_paid 6000 (bug gives 9960)', near(await paid(jinv), 6000), 'paid=' + await paid(jinv));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (partial refunds)` : `  ALL GREEN — ${pass} passed, 0 failed  (partial refunds)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
