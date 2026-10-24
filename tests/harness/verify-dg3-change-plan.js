#!/usr/bin/env node
'use strict';
/**
 * verify-dg3-change-plan.js — D-G step 3 + D-B (owner decisions 2026-10-23): changing plan from the app.
 *   • upgrade (higher plan) and monthly → yearly: now, prorated by Stripe — the exact charge and credit are shown before
 *     confirming
 *   • downgrade (lower plan) and yearly → monthly: at the end of the paid period. Stripe is switched to the new price
 *     with no proration (the next renewal bills it); FinFlow keeps the current plan until the date — a subscription
 *     sync must NOT drop it early
 *   • a downgrade below the editors in use: the owner picks who keeps edit access; the others become Viewers when it
 *     lands (nobody is locked out). More businesses than the new plan includes: refused, nothing lost.
 *   • the daily billing job applies due changes
 * The old "Upgrade" button sent a subscriber to a SECOND checkout (a second subscription, billed twice) and there was no
 * way down at all.
 * Real server + Postgres; Stripe = the live client with invoices.createPreview / subscriptions.update captured.
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_dg3';
process.env.STRIPE_PRICE_PRO = 'price_pro_m';
process.env.STRIPE_PRICE_PRO_ANNUAL = 'price_pro_y';
process.env.STRIPE_PRICE_BUSINESS = 'price_biz_m';
process.env.STRIPE_PRICE_BUSINESS_ANNUAL = 'price_biz_y';
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const T = s => Math.floor(Date.parse(s) / 1000);

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    const stripe = app._stripe();
    const calls = { preview: [], update: [] };
    stripe.invoices.createPreview = async (q) => { calls.preview.push(q); return { amount_due: 22650, currency: 'usd', lines: { data: [{ amount: -5200, proration: true, description: 'Unused time on Pro' }, { amount: 27850, proration: true, description: 'Remaining time on Business' }] } }; };
    stripe.subscriptions.update = async (id, body, opts) => { calls.update.push({ id, body, opts }); return { id }; };
    const send = async (evt) => {
      const payload = JSON.stringify(Object.assign({ object: 'event' }, evt));
      const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload });
    };
    const PW = 'dg3-pw-123';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: 'dg3@finflow.test', name: 'Chan Ge', plan: 'pro', role: 'owner', password: bcrypt.hashSync(PW, 10), stripe_subscription_id: 'sub_C', stripe_customer_id: 'cus_C', subscriptionStatus: 'active',
         billing: { subscription_id: 'sub_C', item_id: 'si_C', price_id: 'price_pro_m', plan: 'pro', interval: 'month', period_start: '2026-07-10T00:00:00.000Z', period_end: '2026-08-10T00:00:00.000Z', cancel_at_period_end: false, status: 'active' } }])).rows[0].id;
    const ent = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Change Co', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.123.0.1' });
    await h.post('/api/auth/login', { email: 'dg3@finflow.test', password: PW });
    const plan = async () => (await c.query(`SELECT data FROM users WHERE id = $1`, [uid])).rows[0].data;
    console.log('\n' + '='.repeat(78) + '\n  D-G step 3 — change plan from the app\n' + '='.repeat(78));

    // upgrade: now, with Stripe's own proration shown first
    const pv = await h.post('/api/billing/change-preview', { plan: 'business', interval: 'month' });
    const p = pv.json || {};
    A('1  Pro → Business monthly: takes effect now; charge 226.50 today, credit 52.00 for unused Pro (Stripe\'s preview)', pv.status === 200 && p.when === 'now' && near(p.chargeNow, 226.5) && near(p.credit, 52) && calls.preview.length === 1 && JSON.stringify(calls.preview[0]).includes('price_biz_m'),
      pv.status + ' ' + JSON.stringify(p));
    const up = await h.post('/api/billing/change', { plan: 'business', interval: 'month', confirm: true });
    const u1 = calls.update[0] || {};
    A('2  …confirmed: the SAME subscription is moved to the Business price, prorated and invoiced now (bug: a second checkout)', up.status === 200 && u1.id === 'sub_C' && JSON.stringify(u1.body.items) === JSON.stringify([{ id: 'si_C', price: 'price_biz_m' }]) && u1.body.proration_behavior === 'always_invoice' && !!(u1.opts || {}).idempotencyKey,
      up.status + ' ' + String(up.text).slice(0, 160) + ' ' + JSON.stringify(u1));
    A('2b the account is on Business now', (await plan()).plan === 'business', (await plan()).plan);

    // five admins on Business; downgrade to Pro (3 editors)
    for (let i = 1; i <= 5; i++) await c.query(`INSERT INTO team_members (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { email: 'ed' + i + '@finflow.test', name: 'Editor ' + i, role: 'admin', status: 'active' }]);
    await c.query(`UPDATE users SET data = jsonb_set(data, '{billing,price_id}', '"price_biz_m"') || jsonb_build_object('billing', (data->'billing') || '{"plan":"business","price_id":"price_biz_m"}'::jsonb) WHERE id = $1`, [uid]);
    const dpv = (await h.post('/api/billing/change-preview', { plan: 'pro', interval: 'month' })).json || {};
    A('3  Business → Pro: at the period end (2026-08-10), nothing charged now; 5 editors for 3 seats → asks who keeps edit access', dpv.when === 'period_end' && String(dpv.effective || '').slice(0, 10) === '2026-08-10' && near(dpv.chargeNow || 0, 0) && dpv.seatsOver === 2 && Array.isArray(dpv.editors) && dpv.editors.length === 5,
      JSON.stringify(dpv));
    const noKeep = await h.post('/api/billing/change', { plan: 'pro', interval: 'month', confirm: true });
    A('3b without choosing who keeps edit access, the downgrade is refused (nobody silently demoted)', noKeep.status === 400 && (noKeep.json || {}).code === 'KEEP_EDITORS_REQUIRED', noKeep.status + ' ' + String(noKeep.text).slice(0, 120));
    const keep = dpv.editors.slice(0, 3).map(e => e.id);
    const dn = await h.post('/api/billing/change', { plan: 'pro', interval: 'month', confirm: true, keepEditors: keep });
    const u2 = calls.update[1] || {};
    const d3 = await plan();
    A('4  confirmed: Stripe moved to the Pro price with NO proration (bills from the next renewal); FinFlow stays on Business until 2026-08-10', dn.status === 200 && u2.body && u2.body.proration_behavior === 'none' && JSON.stringify(u2.body.items) === JSON.stringify([{ id: 'si_C', price: 'price_pro_m' }]) && d3.plan === 'business' && ((d3.billing || {}).pending_change || {}).plan === 'pro',
      dn.status + ' ' + JSON.stringify(u2) + ' ' + JSON.stringify(d3.billing && d3.billing.pending_change));
    await send({ id: 'evt_c1', type: 'customer.subscription.updated', data: { object: { id: 'sub_C', object: 'subscription', status: 'active', customer: 'cus_C', cancel_at_period_end: false, metadata: {},
      items: { data: [{ id: 'si_C', current_period_start: T('2026-07-10T00:00:00Z'), current_period_end: T('2026-08-10T00:00:00Z'), price: { id: 'price_pro_m', recurring: { interval: 'month' } } }] } } } });
    A('4b Stripe\'s update (now on the Pro price) does NOT drop the plan before the date (bug: Pro at once — paid Business days lost)', (await plan()).plan === 'business', (await plan()).plan);

    // the daily job lands it once the date has passed
    await c.query(`UPDATE users SET data = jsonb_set(data, '{billing,pending_change,effective}', '"2026-07-20T00:00:00.000Z"') WHERE id = $1`, [uid]);
    await app.runBillingJob();
    const d5 = await plan();
    const roles = (await c.query(`SELECT id, data->>'role' AS role FROM team_members WHERE user_id = $1 ORDER BY id`, [uid])).rows;
    A('5  the billing job applies the due change: Pro, pending cleared', d5.plan === 'pro' && !((d5.billing || {}).pending_change), JSON.stringify({ plan: d5.plan, pending: (d5.billing || {}).pending_change }));
    A('5b the three chosen keep edit access; the other two are Viewers (still in, read-only)', roles.filter(r => keep.includes(r.id)).every(r => r.role === 'admin') && roles.filter(r => !keep.includes(r.id)).every(r => r.role === 'viewer') && roles.length === 5, JSON.stringify(roles));
    const aud = (await c.query(`SELECT count(*)::int AS n FROM audit_trail WHERE user_id = $1 AND table_name IN ('billing','team_members') AND action IN ('PLAN_CHANGE','UPDATE')`, [uid])).rows[0].n;
    A('5c audited (the plan change and each role change)', aud >= 4, 'rows ' + aud);
    await app.runBillingJob();
    A('5d running the job again changes nothing', (await c.query(`SELECT count(*)::int AS n FROM team_members WHERE user_id = $1 AND data->>'role' = 'admin'`, [uid])).rows[0].n === 3, 'admins changed');

    // more businesses than the new plan includes → refused
    await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb || jsonb_build_object('billing', (data->'billing') || '{"plan":"business","price_id":"price_biz_m"}'::jsonb) WHERE id = $1`, [uid]);
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'Second Co', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 0 }]);
    const over = await h.post('/api/billing/change-preview', { plan: 'pro', interval: 'month' });
    A('6  Business → Pro with 2 businesses (Pro includes 1): refused before anything changes, saying why', over.status === 409 && (over.json || {}).code === 'ENTITIES_OVER_LIMIT' && /1 business/.test((over.json || {}).error || ''), over.status + ' ' + String(over.text).slice(0, 160));
    await c.query(`DELETE FROM entities WHERE user_id = $1 AND id <> $2`, [uid, ent]);

    // monthly → yearly: now (D-B); yearly → monthly: at renewal
    const yv = (await h.post('/api/billing/change-preview', { plan: 'business', interval: 'year' })).json || {};
    A('7  monthly → yearly: now, with the charge and the credit for unused days shown first', yv.when === 'now' && near(yv.chargeNow, 226.5) && near(yv.credit, 52), JSON.stringify(yv));
    await c.query(`UPDATE users SET data = data || jsonb_build_object('billing', (data->'billing') || '{"interval":"year","price_id":"price_biz_y"}'::jsonb) WHERE id = $1`, [uid]);
    const mv = (await h.post('/api/billing/change-preview', { plan: 'business', interval: 'month' })).json || {};
    A('8  yearly → monthly: at the end of the paid year (price locked for the term)', mv.when === 'period_end', JSON.stringify(mv));
    const same = await h.post('/api/billing/change-preview', { plan: 'business', interval: 'year' });
    A('9  "changing" to the plan you are on is refused (nothing to do)', same.status === 409 && (same.json || {}).code === 'SAME_PLAN', same.status + ' ' + String(same.text).slice(0, 100));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-G change plan)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
