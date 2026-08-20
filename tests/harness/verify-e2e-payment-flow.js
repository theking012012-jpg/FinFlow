#!/usr/bin/env node
'use strict';
/**
 * verify-e2e-payment-flow.js — END-TO-END: proves the integration layer and the money engine
 * connect, not just that each works alone. One chained flow through REAL Postgres + the REAL
 * canonical books (computeBooks, via /api/reports/balance-sheet):
 *
 *   invoice issued  →  AR = 500 in the report
 *   generate a Stripe "Pay link"  →  provider dispatch reached (integration wiring live)
 *   customer pays   →  a SIGNED Stripe webhook  →  recordExternalInvoicePayment (single writer)
 *   invoice goes paid  →  AR drops to 0 in the SAME canonical report
 *   a second invoice paid via a WiPay redirect callback  →  AR drops again (a DIFFERENT processor, same books)
 *
 * The only thing NOT executed is the live provider network call (blocked in-sandbox; needs keys) —
 * everything from our pay-link dispatch through the signed webhook to the reconciled figure IS run.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-e2e-payment-flow.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_e2e';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_e2e_secret';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PW = 'harness-password-not-a-secret';
const WP_KEY = 'wipay-e2e-key';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'e2e-owner@finflow.test', name: 'E2E', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'E2E Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, eid, { fiscal_year_start: 0, currency: 'USD' }]);
    const mkInvoice = async (amount) => (await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { client: 'Cust', amount, currency: 'USD', status: 'pending', amount_paid: 0, issue_date: '2026-07-10' }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', { email: 'e2e-owner@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const AR = async () => { const r = await http.post('/api/reports/balance-sheet', {}); return r.json && typeof r.json.accountsReceivable === 'number' ? r.json.accountsReceivable : NaN; };

    console.log('\n' + '='.repeat(78));
    console.log('  END-TO-END — invoice → pay-link → signed webhook → reconcile → AR in the real report');
    console.log('='.repeat(78));

    // ── invoice A: Stripe leg ──
    console.log('\n-- leg 1: Stripe --');
    const invA = await mkInvoice(500);
    A('issued invoice → canonical report shows AR = 500', (await AR()) === 500, `AR=${await AR()}`);

    // connect Stripe + generate the pay-link → dispatch reached (integration wiring is live)
    await http.post('/api/wipay/connect', { account_number: '1234567890', api_key: WP_KEY, country: 'TT' });  // (WiPay for leg 2)
    // Stripe "connected" via the OAuth store:
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_e2e', linked_at: 'now' }) }]);
    const link = await http.post('/api/invoices/' + invA + '/payment-link', { provider: 'stripe' });
    A('generate Stripe pay-link → provider dispatch reached (502, live call blocked)', link.status === 502 && link.json.provider === 'stripe', `status ${link.status}`);

    // customer pays → SIGNED Stripe webhook → reconcile
    const evt = { id: 'evt_e2e_A', type: 'checkout.session.completed', data: { object: { id: 'cs_e2e_A', mode: 'payment', amount_total: 50000, currency: 'usd', client_reference_id: String(invA), metadata: { kind: 'invoice_payment', invoice_id: String(invA) } } } };
    const payload = JSON.stringify(evt);
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const wh = await fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload });
    A('signed Stripe webhook → 200', wh.status === 200);
    const sA = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM invoices WHERE id=$1`, [invA])).rows[0];
    A('invoice A reconciled → paid, amount_paid=500', sA.s === 'paid' && parseFloat(sA.p) === 500, JSON.stringify(sA));
    A('AR dropped to 0 in the canonical report (the payment flowed into the books)', (await AR()) === 0, `AR=${await AR()}`);

    // ── invoice B: WiPay leg — a DIFFERENT processor (Caribbean browser-redirect callback, not a
    //    signed webhook) lands in the SAME single-writer books path ──
    console.log('\n-- leg 2: WiPay --');
    const invB = await mkInvoice(300);
    A('second issued invoice → AR = 300', (await AR()) === 300, `AR=${await AR()}`);
    const ref = 'INV-' + invB + '-1';
    const txn = 'WP-e2e-' + invB;
    // WiPay authenticates its redirect with md5(transaction_id + ORIGINAL invoice total(2dp) + api_key).
    const wpHash = crypto.createHash('md5').update(txn + (300).toFixed(2) + WP_KEY).digest('hex');
    const wpCb = await fetch(server.baseUrl + '/api/wipay/callback?' + new URLSearchParams({
      order_id: ref, transaction_id: txn, status: 'success', total: '307.50', currency: 'TTD', hash: wpHash,
    }).toString(), { redirect: 'manual' });
    A('WiPay callback (valid hash) → browser redirect (30x)', wpCb.status >= 300 && wpCb.status < 400, `status ${wpCb.status}`);
    A('invoice B reconciled → paid', (await c.query(`SELECT data->>'status' s FROM invoices WHERE id=$1`, [invB])).rows[0].s === 'paid');
    A('AR back to 0 (both processors settle into the same canonical AR)', (await AR()) === 0, `AR=${await AR()}`);

    // ── integrity: exactly two payments, correctly keyed, no double-book ──
    console.log('\n-- integrity --');
    const paysA = Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1`, [invA])).rows[0].n);
    const paysB = Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1`, [invB])).rows[0].n);
    A('exactly one payment per invoice (single writer, no dupes)', paysA === 1 && paysB === 1, `A=${paysA} B=${paysB}`);
    A('payments keyed by processor event id (idempotent)',
      Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE idempotency_key IN ('stripe:cs_e2e_A', $1)`, ['wipay:' + txn])).rows[0].n) === 2);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (END-TO-END payment flow)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  Chain executed: invoice → AR figure → pay-link dispatch → SIGNED webhook → single-writer');
    console.log('  reconcile → AR settles in the canonical report. Only the live provider HTTP is unexecuted.');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[e2e] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
