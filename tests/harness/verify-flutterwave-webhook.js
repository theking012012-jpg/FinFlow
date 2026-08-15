#!/usr/bin/env node
'use strict';
/**
 * verify-flutterwave-webhook.js — F173. Flutterwave "Pay now" reconciliation. Flutterwave auth is a
 * static `verif-hash` header = the merchant's secret hash. The webhook resolves the account from the
 * invoice tx_ref, compares against that account's stored secret_hash (timing-safe), then records via
 * the SAME single/idempotent writer as Stripe/Paystack. Flutterwave amounts are MAJOR units (×100).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-flutterwave-webhook.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const KEY = 'FLWSECK_TEST-harness';
const HASH = 'my-flw-secret-hash-123';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'fw-owner@finflow.test', name: 'FW', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'FW Co', currency: 'NGN', is_active: 1 }])).rows[0].id;
    const mkInvoice = async (amount) => (await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { client: 'Cust', amount, currency: 'NGN', status: 'pending', amount_paid: 0, issue_date: '2026-07-10' }])).rows[0].id;
    const invState = async (id) => { const r = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM invoices WHERE id=$1`, [id])).rows[0]; return { status: r.s, paid: parseFloat(r.p || 0) }; };
    const payCount = async (id) => Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1`, [id])).rows[0].n);

    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', { email: 'fw-owner@finflow.test', password: PW })).status !== 200) throw new Error('login');
    if ((await http.post('/api/flutterwave/connect', { secret_key: KEY, secret_hash: HASH })).status !== 201) throw new Error('flutterwave connect');

    const post = (evt, verifHash = HASH) => fetch(server.baseUrl + '/api/flutterwave/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'verif-hash': verifHash }, body: JSON.stringify(evt),
    });
    const chargeCompleted = (ref, amountMajor) => ({ event: 'charge.completed', data: { tx_ref: ref, amount: amountMajor, status: 'successful' } });

    console.log('\n' + '='.repeat(78));
    console.log('  FLUTTERWAVE WEBHOOK RECONCILIATION — verif-hash verified, idempotent, single-writer');
    console.log('='.repeat(78));

    const inv1 = await mkInvoice(500);
    const r1 = await post(chargeCompleted('INV-' + inv1 + '-1', 500));   // 500 MAJOR
    A('valid verif-hash → 200', r1.status === 200, `status ${r1.status}`);
    const s1 = await invState(inv1);
    A('recorded paid via single writer (amount_paid=500, paid)', s1.paid === 500 && s1.status === 'paid', JSON.stringify(s1));
    A('one payment keyed flutterwave:tx_ref', (await payCount(inv1)) === 1 &&
      Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1 AND idempotency_key=$2`, [inv1, 'flutterwave:INV-' + inv1 + '-1'])).rows[0].n) === 1);

    await post(chargeCompleted('INV-' + inv1 + '-1', 500));
    A('duplicate → still one payment', (await payCount(inv1)) === 1);

    const inv2 = await mkInvoice(300);
    A('wrong verif-hash → 401', (await post(chargeCompleted('INV-' + inv2 + '-1', 300), 'wrong-hash')).status === 401);
    A('wrong verif-hash: nothing written', (await payCount(inv2)) === 0);

    const inv3 = await mkInvoice(100);
    await post(chargeCompleted('INV-' + inv3 + '-1', 500));  // overpay 500 on a 100 invoice
    A('overpayment capped to balance (100)', (await invState(inv3)).paid === 100);

    A('non-invoice ref → 200 ignored', (await post({ event: 'charge.completed', data: { tx_ref: 'X', amount: 1, status: 'successful' } })).status === 200);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (flutterwave webhook)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  NOTE: a real Flutterwave charge is UNEXECUTED (needs a live account); the signed-event path IS executed.');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[fw-wh] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
