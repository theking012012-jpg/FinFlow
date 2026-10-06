#!/usr/bin/env node
'use strict';
/**
 * verify-paylink-currency.js — N49. A "Pay now" link must charge in the ISSUING BUSINESS's currency
 * (owner decision 2026-10-06), with the amount in that currency's minor unit.
 *
 * Defect: currency = inv.currency || body.currency || 'USD'. Invoices carry no currency, so every link
 * charged USD — or whatever currency the browser sent — and unit_amount was always amount × 100.
 *
 * The outbound Stripe Checkout request is captured in-process (no network): the harness wraps
 * global.fetch, which the in-process server uses. Discriminating seeds (Rule 4):
 *   TTD business, invoice 1000      → currency=ttd, unit_amount=100000   (bug: currency=usd)
 *   JPY business, invoice 5000      → currency=jpy, unit_amount=5000     (bug: usd / 500000)
 *   TTD invoice, browser sends 'eur' → still ttd                          (bug: eur)
 *   node -r ./tests/harness/clock.js tests/harness/verify-paylink-currency.js
 */

const bcrypt = require('bcryptjs');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

// Capture Stripe Checkout calls; everything else goes to the (guarded) real fetch.
const captured = [];
const _guardedFetch = global.fetch;
global.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  if (url.startsWith('https://api.stripe.com/v1/checkout/sessions')) {
    captured.push(new URLSearchParams(String((init && init.body) || '')));
    return Promise.resolve(new Response(JSON.stringify({ id: 'cs_cap', url: 'https://checkout.example/cs_cap' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return _guardedFetch.apply(this, arguments);
};

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'paylink-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: 'paylink@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const mkEnt = async (name, currency) => {
      const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name, currency, is_active: 0 }])).rows[0].id;
      await c.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eid, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_' + eid }) }]);
      return eid;
    };
    const mkInv = async (eid, amount) => (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [uid, eid, { client: 'Cust', amount, status: 'pending', amount_paid: 0, issue_date: '2026-07-10' }])).rows[0].id;
    const ttd = await mkEnt('Trinidad Co', 'TTD');
    const jpy = await mkEnt('Tokyo KK', 'JPY');
    const h = new HarnessHttp(server.baseUrl, { xff: '10.8.0.1' });
    A('login 200', (await h.post('/api/auth/login', { email: 'paylink@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  PAY LINK CURRENCY — issuing business currency, correct minor units');
    console.log('='.repeat(78));

    const link = async (invId, body) => { const before = captured.length; const r = await h.post(`/api/invoices/${invId}/payment-link?entity_id=${body.__eid}`, Object.assign({ provider: 'stripe' }, body.extra || {})); return { r, p: captured[before] }; };

    const t = await link(await mkInv(ttd, 1000), { __eid: ttd });
    A('TTD link created (201)', t.r.status === 201, `status ${t.r.status}: ${t.r.text.slice(0, 120)}`);
    A('TTD invoice charges in TTD (bug: usd)', t.p && t.p.get('line_items[0][price_data][currency]') === 'ttd', 'currency=' + (t.p && t.p.get('line_items[0][price_data][currency]')));
    A('TTD 1000 → unit_amount 100000', t.p && t.p.get('line_items[0][price_data][unit_amount]') === '100000', 'unit_amount=' + (t.p && t.p.get('line_items[0][price_data][unit_amount]')));

    const j = await link(await mkInv(jpy, 5000), { __eid: jpy });
    A('JPY link created (201)', j.r.status === 201, `status ${j.r.status}`);
    A('JPY invoice charges in JPY', j.p && j.p.get('line_items[0][price_data][currency]') === 'jpy', 'currency=' + (j.p && j.p.get('line_items[0][price_data][currency]')));
    A('JPY 5000 → unit_amount 5000 (zero-decimal; bug 500000)', j.p && j.p.get('line_items[0][price_data][unit_amount]') === '5000', 'unit_amount=' + (j.p && j.p.get('line_items[0][price_data][unit_amount]')));

    const o = await link(await mkInv(ttd, 250), { __eid: ttd, extra: { currency: 'eur' } });
    A('browser-sent currency is ignored (still ttd; bug: eur)', o.p && o.p.get('line_items[0][price_data][currency]') === 'ttd', 'currency=' + (o.p && o.p.get('line_items[0][price_data][currency]')));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (pay link currency)` : `  ALL GREEN — ${pass} passed, 0 failed  (pay link currency)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
