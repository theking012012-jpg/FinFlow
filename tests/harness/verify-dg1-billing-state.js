#!/usr/bin/env node
'use strict';
/**
 * verify-dg1-billing-state.js — D-G step 1. FinFlow kept no record of an account's subscription beyond a plan name: not
 * whether it is billed monthly or yearly, when it renews, or whether it is set to cancel — so there was no Billing
 * panel and nothing to build cancel / downgrade / renewal reminders on.
 * Now every Stripe subscription event stores its facts (users.data.billing: plan, interval, period, cancel flag,
 * status, subscription item) — read from the item for newer Stripe API versions and from the subscription for older
 * ones — GET /api/billing returns the account's billing state, and Settings shows a Billing panel.
 * Real server + Postgres; real signed webhooks (FA-S1 finds the user by the stored subscription id).
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_dg1';
process.env.STRIPE_PRICE_BUSINESS = 'price_biz_m';
process.env.STRIPE_PRICE_BUSINESS_ANNUAL = 'price_biz_y';
process.env.STRIPE_PRICE_PRO = 'price_pro_m';
const bcrypt = require('bcryptjs');
require('./clock.js');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const T = s => Math.floor(Date.parse(s) / 1000);

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const stripe = require('../../server.js')._stripe();
    const send = async (evt) => {
      const payload = JSON.stringify(Object.assign({ object: 'event' }, evt));
      const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload });
    };
    const PW = 'dg1-pw-123';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: 'dg1@finflow.test', name: 'Bill Ing', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10), stripe_subscription_id: 'sub_Y', stripe_customer_id: 'cus_Y' }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'Billing Co', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }]);
    console.log('\n' + '='.repeat(78) + '\n  D-G step 1 — the subscription is known, and shown\n' + '='.repeat(78));

    // newer Stripe API shape: the period lives on the item
    const r1 = await send({ id: 'evt_y1', type: 'customer.subscription.updated', data: { object: { id: 'sub_Y', object: 'subscription', status: 'active', customer: 'cus_Y', cancel_at_period_end: false, metadata: {},
      items: { data: [{ id: 'si_Y', current_period_start: T('2026-07-01T00:00:00Z'), current_period_end: T('2027-07-01T00:00:00Z'), price: { id: 'price_biz_y', recurring: { interval: 'year' } } }] } } } });
    const h = new HarnessHttp(server.baseUrl, { xff: '10.121.0.1' });
    await h.post('/api/auth/login', { email: 'dg1@finflow.test', password: PW });
    const b1 = (await h.get('/api/billing')).json || {};
    A('1  GET /api/billing: Business, billed yearly, renews 2027-07-01, not cancelling (bug: no such route / nothing stored)', r1.status === 200 && b1.plan === 'business' && b1.interval === 'year' && String(b1.periodEnd || '').slice(0, 10) === '2027-07-01' && b1.cancelAtPeriodEnd === false && b1.price === 2388,
      r1.status + ' ' + JSON.stringify(b1));
    const stored = (await c.query(`SELECT data->'billing' AS b FROM users WHERE id = $1`, [uid])).rows[0].b || {};
    A('1b the subscription item and price are stored (needed to change the plan later)', stored.item_id === 'si_Y' && stored.price_id === 'price_biz_y', JSON.stringify(stored));

    // older Stripe API shape: the period lives on the subscription; set to cancel
    await send({ id: 'evt_y2', type: 'customer.subscription.updated', data: { object: { id: 'sub_Y', object: 'subscription', status: 'active', customer: 'cus_Y', cancel_at_period_end: true, metadata: {},
      current_period_start: T('2026-07-01T00:00:00Z'), current_period_end: T('2026-08-01T00:00:00Z'),
      items: { data: [{ id: 'si_Y', price: { id: 'price_pro_m', recurring: { interval: 'month' } } }] } } } });
    const b2 = (await h.get('/api/billing')).json || {};
    A('2  a plan change in Stripe (older API shape) is followed: Pro, monthly, cancels on 2026-08-01', b2.plan === 'pro' && b2.interval === 'month' && String(b2.periodEnd || '').slice(0, 10) === '2026-08-01' && b2.cancelAtPeriodEnd === true && b2.price === 79, JSON.stringify(b2));

    // the Billing panel
    const cookiePair = [...h.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const page = await h.get('/app');
    const jar = new CookieJar();
    for (const [k, v] of h.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, server.baseUrl);
    const dom = new JSDOM(page.text, { url: server.baseUrl + '/app', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
    const w = dom.window, nodeFetch = global.fetch;
    w.fetch = (input, init = {}) => { const u = typeof input === 'string' ? input : String(input && input.url || input);
      const abs = u.startsWith('http') ? u : server.baseUrl + (u.startsWith('/') ? u : '/' + u);
      return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) })); };
    for (let i = 0; i < 80 && typeof w.ffRenderBilling !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    try { w.showPage('settings'); } catch (_) {}
    try { await w.ffRenderBilling(); } catch (_) {}
    const txt = ((w.document.getElementById('billing-panel') || {}).textContent || '').replace(/\s+/g, ' ');
    A('3  Settings shows a Billing panel: "Pro · billed monthly · $79" and the cancellation date (bug: none)', /Pro/.test(txt) && /billed monthly/i.test(txt) && /\$79/.test(txt) && /cancels on/i.test(txt) && /2026/.test(txt), txt.slice(0, 200) || 'no #billing-panel');
    try { w.close(); } catch (_) {}
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-G billing state)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
