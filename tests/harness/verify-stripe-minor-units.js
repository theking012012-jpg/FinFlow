#!/usr/bin/env node
'use strict';
/**
 * verify-stripe-minor-units.js — N47. Every Stripe money path converts minor units by the CURRENCY's
 * exponent (JPY/KRW 0, KWD/BHD 3, else 2), not a hardcoded /100.
 *
 * Outbound Stripe REST calls are answered in-process (global.fetch wrapper; no network). Discriminating
 * seeds (Rule 4) — the bug value is stated per assertion:
 *   webhook pay-now: JPY invoice ¥5000, amount_total 5000 jpy  → amount_paid 5000   (bug 50)
 *   live feed: charge 5000 jpy                                 → amount 5000        (bug 50)
 *   import-charge: 5000 jpy, fee 150 jpy                       → receipt 5000, fee 150 (bug 50, 1.5)
 *   import-charge: 12345 kwd                                   → receipt 12.345     (bug 123.45)
 *   node -r ./tests/harness/clock.js tests/harness/verify-stripe-minor-units.js
 */

const bcrypt = require('bcryptjs');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_harness';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CHARGES = {
  ch_jpy: { id: 'ch_jpy', object: 'charge', amount: 5000, currency: 'jpy', status: 'succeeded', paid: true, refunded: false, created: 1784995200, description: 'JP sale', balance_transaction: { fee: 150, currency: 'jpy' } },
  ch_kwd: { id: 'ch_kwd', object: 'charge', amount: 12345, currency: 'kwd', status: 'succeeded', paid: true, refunded: false, created: 1784995200, description: 'KW sale', balance_transaction: { fee: 0, currency: 'kwd' } },
};
const _guardedFetch = global.fetch;
global.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (url.startsWith('https://api.stripe.com/v1/charges?')) return json({ data: [CHARGES.ch_jpy] });
  const m = /^https:\/\/api\.stripe\.com\/v1\/charges\/(ch_[a-z]+)/.exec(url);
  if (m && CHARGES[m[1]]) return json(CHARGES[m[1]]);
  return _guardedFetch.apply(this, arguments);
};

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - b) < 0.0005;

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'units-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: 'units@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const mkEnt = async (name, currency) => {
      const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name, currency, is_active: 0 }])).rows[0].id;
      await c.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eid, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_' + eid }) }]);
      return eid;
    };
    const jpy = await mkEnt('Tokyo KK', 'JPY');
    const kwd = await mkEnt('Kuwait Co', 'KWD');
    const h = new HarnessHttp(server.baseUrl, { xff: '10.8.1.1' });
    A('login 200', (await h.post('/api/auth/login', { email: 'units@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  STRIPE MINOR UNITS — currency exponent on every money path');
    console.log('='.repeat(78));

    // 1 · webhook pay-now reconciliation in JPY
    const inv = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [uid, jpy, { client: 'JP Cust', amount: 5000, status: 'pending', amount_paid: 0, issue_date: '2026-07-10' }])).rows[0].id;
    const evt = { id: 'evt_units_1', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', id: 'cs_units_1', mode: 'payment', amount_total: 5000, currency: 'jpy', client_reference_id: String(inv), metadata: { kind: 'invoice_payment', invoice_id: String(inv) } } } };
    const payload = JSON.stringify(evt);
    const wh = await fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }, body: payload });
    A('JPY pay-now webhook → 200', wh.status === 200, 'status ' + wh.status);
    const paid = (await c.query(`SELECT data->>'amount_paid' p, data->>'status' s FROM invoices WHERE id=$1`, [inv])).rows[0];
    A('JPY ¥5000 payment → amount_paid 5000, status paid (bug 50 / partial)', near(paid.p, 5000) && paid.s === 'paid', JSON.stringify(paid));

    // 2 · live feed display
    const feed = await h.get('/api/stripe/feed?entity_id=' + jpy);
    const fj = feed.json || JSON.parse(feed.text || '{}');
    A('feed 200', feed.status === 200, 'status ' + feed.status);
    A('feed shows ¥5000 charge as 5000 (bug 50)', fj.charges && fj.charges[0] && near(fj.charges[0].amount, 5000), JSON.stringify(fj.charges && fj.charges[0]));

    // 3 · import-charge JPY (revenue + fee)
    const ic = await h.post('/api/stripe/import-charge?entity_id=' + jpy, { charge_id: 'ch_jpy' });
    const icj = ic.json || JSON.parse(ic.text || '{}');
    A('import-charge JPY 200', ic.status === 200, `status ${ic.status}: ${ic.text.slice(0, 120)}`);
    A('JPY receipt amount 5000 (bug 50)', icj.receipt && near(icj.receipt.amount, 5000), 'receipt=' + (icj.receipt && icj.receipt.amount));
    A('JPY fee expense 150 (bug 1.5)', icj.fee && near(icj.fee.amount, 150), 'fee=' + (icj.fee && icj.fee.amount));

    // 4 · import-charge KWD (three-decimal)
    const ik = await h.post('/api/stripe/import-charge?entity_id=' + kwd, { charge_id: 'ch_kwd' });
    const ikj = ik.json || JSON.parse(ik.text || '{}');
    A('import-charge KWD 200', ik.status === 200, `status ${ik.status}: ${ik.text.slice(0, 120)}`);
    A('KWD 12345 fils → 12.345 (bug 123.45)', ikj.receipt && near(ikj.receipt.amount, 12.345), 'receipt=' + (ikj.receipt && ikj.receipt.amount));

    // 5 · pure converter
    const u = require('../../stripe-units.js');
    A('converter: USD 1999 → 19.99, JPY 1999 → 1999, KWD 1999 → 1.999',
      near(u.minorToMajor(1999, 'usd'), 19.99) && near(u.minorToMajor(1999, 'JPY'), 1999) && near(u.minorToMajor(1999, 'kwd'), 1.999));
    A('converter round-trip: majorToMinor(12.345, KWD) = 12345, (5000, JPY) = 5000', u.majorToMinor(12.345, 'KWD') === 12345 && u.majorToMinor(5000, 'jpy') === 5000);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (stripe minor units)` : `  ALL GREEN — ${pass} passed, 0 failed  (stripe minor units)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
