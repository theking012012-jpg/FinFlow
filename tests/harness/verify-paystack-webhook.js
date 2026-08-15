#!/usr/bin/env node
'use strict';
/**
 * verify-paystack-webhook.js — F172. Paystack "Pay now" reconciliation. The webhook verifies the
 * merchant's HMAC-SHA512 signature (resolving the account from the invoice reference), then records
 * the payment through the SAME single writer + idempotency as Stripe (F171). Fully offline — HMAC is
 * local crypto, so this executes the real verify + write path end-to-end (no live Paystack).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-paystack-webhook.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const SECRET = 'sk_test_paystack_harness';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'ps-owner@finflow.test', name: 'PS', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'PS Co', currency: 'NGN', is_active: 1 }])).rows[0].id;
    const mkInvoice = async (amount) => (await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { client: 'Cust', amount, currency: 'NGN', status: 'pending', amount_paid: 0, issue_date: '2026-07-10' }])).rows[0].id;
    const invState = async (id) => { const r = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM invoices WHERE id=$1`, [id])).rows[0]; return { status: r.s, paid: parseFloat(r.p || 0) }; };
    const payCount = async (id) => Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1`, [id])).rows[0].n);

    // owner connects Paystack (stores the secret encrypted — the webhook verifies against it)
    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', { email: 'ps-owner@finflow.test', password: PW })).status !== 200) throw new Error('login');
    if ((await http.post('/api/paystack/connect', { secret_key: SECRET })).status !== 201) throw new Error('paystack connect');

    const post = (evt, { sign = true, secret = SECRET } = {}) => {
      const payload = JSON.stringify(evt);
      const sig = sign ? crypto.createHmac('sha512', secret).update(Buffer.from(payload, 'utf8')).digest('hex') : 'deadbeef';
      return fetch(server.baseUrl + '/api/paystack/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig }, body: payload });
    };
    const chargeSuccess = (ref, amountMinor) => ({ event: 'charge.success', data: { reference: ref, amount: amountMinor, status: 'success' } });

    console.log('\n' + '='.repeat(78));
    console.log('  PAYSTACK WEBHOOK RECONCILIATION — HMAC-SHA512 verified, idempotent, single-writer');
    console.log('='.repeat(78));

    // ── valid signed charge.success ──
    const inv1 = await mkInvoice(500);
    const r1 = await post(chargeSuccess('INV-' + inv1 + '-1', 50000));
    A('valid signed webhook → 200', r1.status === 200, `status ${r1.status}`);
    const s1 = await invState(inv1);
    A('invoice recorded paid via single writer (amount_paid=500, paid)', s1.paid === 500 && s1.status === 'paid', JSON.stringify(s1));
    A('exactly one payment, keyed paystack:reference', (await payCount(inv1)) === 1 &&
      Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1 AND idempotency_key=$2`, [inv1, 'paystack:INV-' + inv1 + '-1'])).rows[0].n) === 1);

    // ── idempotency ──
    await post(chargeSuccess('INV-' + inv1 + '-1', 50000));
    A('duplicate event → still one payment (no double-book)', (await payCount(inv1)) === 1);

    // ── forged signature ──
    const inv2 = await mkInvoice(300);
    const r2 = await post(chargeSuccess('INV-' + inv2 + '-1', 30000), { sign: false });
    A('forged signature → 401', r2.status === 401, `status ${r2.status}`);
    A('forged: nothing written', (await payCount(inv2)) === 0);

    // ── wrong secret (another merchant's key) is rejected ──
    const inv3 = await mkInvoice(300);
    const r3 = await post(chargeSuccess('INV-' + inv3 + '-1', 30000), { secret: 'sk_test_wrong_key' });
    A('wrong-secret signature → 401', r3.status === 401);
    A('wrong-secret: nothing written', (await payCount(inv3)) === 0);

    // ── overpayment capped ──
    const inv4 = await mkInvoice(100);
    await post(chargeSuccess('INV-' + inv4 + '-1', 50000));
    A('overpayment booked only to balance (100, paid)', (await invState(inv4)).paid === 100);

    // ── non-invoice reference ignored ──
    const r5 = await post({ event: 'charge.success', data: { reference: 'RANDOM-REF', amount: 100, status: 'success' } });
    A('non-invoice reference → 200 ignored', r5.status === 200);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (paystack webhook)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  NOTE: a real Paystack charge is UNEXECUTED (needs a live account); the signed-event path IS executed.');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[paystack-wh] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
