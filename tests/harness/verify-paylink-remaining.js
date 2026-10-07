#!/usr/bin/env node
'use strict';
/**
 * verify-paylink-remaining.js — N50. A payment link charges the OUTSTANDING balance, and the WiPay
 * callback verifies/records against that same total.
 *
 * Defect: links always charged the invoice's face amount. For an invoice of 1000 with 400 already paid,
 * the customer was asked for 1000; the webhook capped the booking at 600, so 400 was overcharged and
 * never recorded.
 *
 * Discriminating seeds (Rule 4), invoice 1000 with 400 paid (TTD business):
 *   Stripe link unit_amount  → 60000           (bug 100000)
 *   WiPay link total         → 600.00          (bug 1000.00)
 *   WiPay callback, hash over 600 → amount_paid 1000, status paid   (bug: hash mismatch, stays 400)
 *   fully paid invoice       → 400 "nothing outstanding"            (bug: link for the full amount)
 * Outbound provider calls are answered in-process (no network).
 *   node -r ./tests/harness/clock.js tests/harness/verify-paylink-remaining.js
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const captured = { stripe: [], wipay: [] };
const _guardedFetch = global.fetch;
global.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  const ok = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (url.startsWith('https://api.stripe.com/v1/checkout/sessions')) { captured.stripe.push(new URLSearchParams(String(init.body))); return ok({ url: 'https://checkout.example/x' }); }
  if (/wipayfinancial\.com\/plugins\/payments\/request/.test(url)) { captured.wipay.push(new URLSearchParams(String(init.body))); return ok({ url: 'https://wipay.example/x' }); }
  return _guardedFetch.apply(this, arguments);
};

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const API_KEY = 'wipay-test-key-123';
const wipayHash = (txn, total, key) => crypto.createHash('md5').update(txn + Number(total).toFixed(2) + key).digest('hex');

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'remaining-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: 'remaining@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'TT Co', currency: 'TTD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eid, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_tt' }) }]);
    const mkInv = async (amount, paidAmt) => {
      const id = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
        [uid, eid, { client: 'Cust', amount, status: paidAmt >= amount ? 'paid' : (paidAmt > 0 ? 'partial' : 'pending'), amount_paid: paidAmt, issue_date: '2026-07-10' }])).rows[0].id;
      if (paidAmt > 0) await c.query(`INSERT INTO invoice_payments (user_id,entity_id,invoice_id,amount,payment_date,method) VALUES ($1,$2,$3,$4,'2026-07-12','Bank')`, [uid, eid, id, paidAmt]);
      return id;
    };
    const h = new HarnessHttp(server.baseUrl, { xff: '10.8.2.1' });
    A('login 200', (await h.post('/api/auth/login', { email: 'remaining@finflow.test', password: PW })).status === 200);
    A('WiPay connected (201)', (await h.post('/api/wipay/connect?entity_id=' + eid, { account_number: '1234567890', api_key: API_KEY, country: 'TT' })).status === 201);

    console.log('\n' + '='.repeat(78));
    console.log('  PAY LINKS CHARGE THE OUTSTANDING BALANCE');
    console.log('='.repeat(78));

    const invS = await mkInv(1000, 400);
    const rs = await h.post(`/api/invoices/${invS}/payment-link?entity_id=${eid}`, { provider: 'stripe' });
    A('Stripe link created (201)', rs.status === 201, `status ${rs.status}: ${rs.text.slice(0, 100)}`);
    const sp = captured.stripe[captured.stripe.length - 1];
    A('Stripe link charges the 600 balance → unit_amount 60000 (bug 100000)', sp && sp.get('line_items[0][price_data][unit_amount]') === '60000', 'unit_amount=' + (sp && sp.get('line_items[0][price_data][unit_amount]')));

    const invW = await mkInv(1000, 400);
    const rw = await h.post(`/api/invoices/${invW}/payment-link?entity_id=${eid}`, { provider: 'wipay' });
    A('WiPay link created (201)', rw.status === 201, `status ${rw.status}: ${rw.text.slice(0, 100)}`);
    const wp = captured.wipay[captured.wipay.length - 1];
    A('WiPay link total = 600.00 (bug 1000.00)', wp && wp.get('total') === '600.00', 'total=' + (wp && wp.get('total')));
    const orderId = wp && wp.get('order_id');
    const txn = 'TXN-REM-1';
    await fetch(server.baseUrl + '/api/wipay/callback?' + new URLSearchParams({ order_id: orderId, transaction_id: txn, status: 'success', total: '600.00', hash: wipayHash(txn, 600, API_KEY) }), { redirect: 'manual' });
    const st = (await c.query(`SELECT data->>'amount_paid' p, data->>'status' s FROM invoices WHERE id=$1`, [invW])).rows[0];
    A('WiPay callback over 600 records it → amount_paid 1000, status paid (bug: mismatch, stays 400)', parseFloat(st.p) === 1000 && st.s === 'paid', JSON.stringify(st));

    const invP = await mkInv(500, 500);
    const rp = await h.post(`/api/invoices/${invP}/payment-link?entity_id=${eid}`, { provider: 'stripe' });
    A('fully paid invoice → 400 nothing outstanding (bug: link for the full amount)', rp.status === 400, `status ${rp.status}: ${rp.text.slice(0, 100)}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (pay link outstanding balance)` : `  ALL GREEN — ${pass} passed, 0 failed  (pay link outstanding balance)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
