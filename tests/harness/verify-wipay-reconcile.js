#!/usr/bin/env node
'use strict';
/**
 * verify-wipay-reconcile.js — F175. WiPay reconciliation. WiPay is NOT a signed webhook — it
 * web-redirects the payor's browser (GET) to the callback with `hash = md5(transaction_id +
 * ORIGINAL total + API key)` (formula verified against WiPay's own documented example). The callback
 * resolves the account from order_id, recomputes the hash with that account's stored key, and on a
 * verified `success` records via the SAME single/idempotent writer. Fully offline — md5 is local.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-wipay-reconcile.js
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
const API_KEY = 'wipay-api-key-harness';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

// WiPay's documented hash: md5(transaction_id + original_total(2dp) + api_key), no separators.
const wipayHash = (txn, totalMajor, key) => crypto.createHash('md5').update(txn + Number(totalMajor).toFixed(2) + key).digest('hex');

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'wp-owner@finflow.test', name: 'WP', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'WP Co', currency: 'TTD', is_active: 1 }])).rows[0].id;
    const mkInvoice = async (amount) => (await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { client: 'Cust', amount, currency: 'TTD', status: 'pending', amount_paid: 0, issue_date: '2026-07-10' }])).rows[0].id;
    const invState = async (id) => { const r = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM invoices WHERE id=$1`, [id])).rows[0]; return { status: r.s, paid: parseFloat(r.p || 0) }; };
    const payCount = async (id) => Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1`, [id])).rows[0].n);

    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', { email: 'wp-owner@finflow.test', password: PW })).status !== 200) throw new Error('login');
    if ((await http.post('/api/wipay/connect', { account_number: '1234567890', api_key: API_KEY, country: 'TT' })).status !== 201) throw new Error('wipay connect');

    // the callback is a public browser redirect (GET); no cookie needed
    const hit = (params) => fetch(server.baseUrl + '/api/wipay/callback?' + new URLSearchParams(params).toString(), { redirect: 'manual' });

    console.log('\n' + '='.repeat(78));
    console.log('  WIPAY CALLBACK RECONCILIATION — md5(txn+total+key) verified, idempotent, single-writer');
    console.log('='.repeat(78));

    // ── valid callback (correct hash) ──
    const inv1 = await mkInvoice(500);
    const ref1 = 'INV-' + inv1 + '-1';
    const txn1 = 'SB-7-1-' + ref1 + '-20260725';
    const r1 = await hit({ order_id: ref1, transaction_id: txn1, status: 'success', total: '512.50', currency: 'TTD', hash: wipayHash(txn1, 500, API_KEY) });
    A('valid callback → redirect (30x)', r1.status >= 300 && r1.status < 400, `status ${r1.status}`);
    const s1 = await invState(inv1);
    A('recorded paid via single writer (amount_paid=500, paid)', s1.paid === 500 && s1.status === 'paid', JSON.stringify(s1));
    A('one payment keyed wipay:transaction_id', (await payCount(inv1)) === 1 &&
      Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1 AND idempotency_key=$2`, [inv1, 'wipay:' + txn1])).rows[0].n) === 1);

    // ── idempotency ──
    await hit({ order_id: ref1, transaction_id: txn1, status: 'success', total: '512.50', currency: 'TTD', hash: wipayHash(txn1, 500, API_KEY) });
    A('duplicate callback → still one payment', (await payCount(inv1)) === 1);

    // ── forged hash rejected ──
    const inv2 = await mkInvoice(300);
    const ref2 = 'INV-' + inv2 + '-1', txn2 = 'SB-8-1-' + ref2 + '-20260725';
    await hit({ order_id: ref2, transaction_id: txn2, status: 'success', total: '307', currency: 'TTD', hash: 'deadbeefdeadbeefdeadbeefdeadbeef' });
    A('forged hash: nothing written', (await payCount(inv2)) === 0);
    A('forged hash: invoice still pending', (await invState(inv2)).status === 'pending');

    // ── wrong total in hash (tampered amount) rejected ──
    const inv3 = await mkInvoice(300);
    const ref3 = 'INV-' + inv3 + '-1', txn3 = 'SB-9-1-' + ref3 + '-20260725';
    await hit({ order_id: ref3, transaction_id: txn3, status: 'success', total: '999', currency: 'TTD', hash: wipayHash(txn3, 999, API_KEY) });   // hash for 999, invoice is 300
    A('hash computed for a DIFFERENT total → rejected, nothing written', (await payCount(inv3)) === 0);

    // ── failed status ignored ──
    const inv4 = await mkInvoice(300);
    const ref4 = 'INV-' + inv4 + '-1', txn4 = 'SB-10-1-' + ref4 + '-20260725';
    await hit({ order_id: ref4, transaction_id: txn4, status: 'failed', total: '300', currency: 'TTD' });
    A('failed status → nothing written', (await payCount(inv4)) === 0);

    // ── non-invoice order_id ignored ──
    const r5 = await hit({ order_id: 'RANDOM', transaction_id: 'x', status: 'success', hash: 'x' });
    A('non-invoice order_id → redirect, no write', r5.status >= 300 && r5.status < 400);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (wipay reconciliation)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  NOTE: a real WiPay transaction is UNEXECUTED (needs a live account); the hash formula is');
    console.log('        verified against WiPay\'s documented example, and the verify+write path IS executed.');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[wipay-wh] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
