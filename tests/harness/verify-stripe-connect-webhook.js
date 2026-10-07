#!/usr/bin/env node
'use strict';
/**
 * verify-stripe-connect-webhook.js — N52. A payment made through a business's connected Stripe account (a
 * Connect event, signed with the Connect endpoint's secret) is accepted and reconciles the invoice.
 *
 * Defect: the webhook verified signatures with STRIPE_WEBHOOK_SECRET only. Stripe signs Connect events with
 * the Connect endpoint's own secret, so every Connect delivery was rejected (400) and an invoice paid through
 * its pay-link never reconciled.
 * Executed: real server + Postgres; events signed with the real Stripe SDK's test-header helper.
 *   checkout.session.completed (paid, account acct_biz) signed with the CONNECT secret → 200, invoice paid (bug: 400)
 *   platform-signed event → 200 (control)        wrongly-signed event → 400 (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-stripe-connect-webhook.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';   // boot keeps the Stripe keys (the network guard still blocks live calls)
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
const PLATFORM = 'whsec_platform_harness', CONNECT = 'whsec_connect_harness';
process.env.STRIPE_WEBHOOK_SECRET = PLATFORM;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT;
const bcrypt = require('bcryptjs');
require('./clock.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_harness');
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
    const post = (evt, secret) => { const payload = JSON.stringify(evt); return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload }); };
    const U = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'cw@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 4) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [U, { name: 'CW Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const inv = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [U, eid, { client: 'Cust', amount: 500, status: 'pending', issue_date: '2026-07-01', amount_paid: 0 }])).rows[0].id;
    const paid = async () => Number((await c.query(`SELECT COALESCE((data->>'amount_paid')::numeric,0) a FROM invoices WHERE id=$1`, [inv])).rows[0].a);
    const evt = (id) => ({ id, object: 'event', account: 'acct_biz', type: 'checkout.session.completed', data: { object: { id: 'cs_conn_' + id, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 50000, currency: 'usd', client_reference_id: String(inv), metadata: { kind: 'invoice_payment', invoice_id: String(inv) } } } });
    const r1 = await post(evt('evt_conn_1'), CONNECT);
    A('Connect-signed invoice payment → 200 (bug: 400 signature failed)', r1.status === 200, 'status ' + r1.status + ' ' + (await r1.text()).slice(0, 80));
    A('  invoice paid: amount_paid 500 (bug: 0)', (await paid()) === 500, 'paid ' + await paid());
    const r2 = await post({ id: 'evt_plat_1', object: 'event', type: 'customer.updated', data: { object: { id: 'cus_1', object: 'customer' } } }, PLATFORM);
    A('control: platform-signed event → 200', r2.status === 200, 'status ' + r2.status);
    const r3 = await post(evt('evt_forged'), 'whsec_wrong');
    A('control: wrongly-signed event → 400', r3.status === 400, 'status ' + r3.status);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (Stripe Connect webhook)` : `  ALL GREEN — ${pass} passed, 0 failed  (Stripe Connect webhook)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
