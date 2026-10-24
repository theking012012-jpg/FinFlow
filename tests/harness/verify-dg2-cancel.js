#!/usr/bin/env node
'use strict';
/**
 * verify-dg2-cancel.js — D-G step 2 + D-B "leave any time" (owner decisions 2026-10-23). There was NO way to cancel a
 * subscription in the app (FA-C1): the only exit was deleting the account. Now, from Settings → Plan & billing:
 *   • monthly — cancel at the end of the paid month (no refund, full access until then); can be undone until then
 *   • yearly  — leave any time: refund = what was paid − the months used, charged at the MONTHLY price; the access ends
 *               now and the account becomes read-only (the 90-day retention, step 4)
 *   • the exact outcome (date, refund) is shown BEFORE confirming, and the server recomputes it — never trusts the page
 * Seed (clock pinned 2026-07-25):
 *   monthly  Pro, period 2026-07-10 → 2026-08-10
 *   yearly   Business, period 2026-03-10 → 2027-03-10, paid 2,388.00
 *            months started by 2026-07-25: Mar10, Apr10, May10, Jun10, Jul10 = 5 → used 5 × 249 = 1,245
 *            refund = 2,388 − 1,245 = 1,143.00
 *   BUGGY VALUES (Rule 4): no refund 0 · prorated by days 2,388 × (1 − 137/365) = 1,491.67 · months at the yearly
 *   rate 2,388 − 5 × 199 = 1,393.00 · whole months only (4) 2,388 − 4 × 249 = 1,392.00
 *   a discounted yearly payment of 1,000.00 with the same 5 months used → refund 0 (never negative, never above paid)
 * Real server + Postgres; Stripe = the live client with subscriptions.update / cancel, invoices.list and refunds.create
 * captured at the boundary.
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_dg2';
const bcrypt = require('bcryptjs');
require('./clock.js');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const stripe = require('../../server.js')._stripe();
    const calls = { update: [], cancel: [], refunds: [] };
    let paidCents = 238800;
    stripe.subscriptions.update = async (id, body, opts) => { calls.update.push({ id, body, opts }); return { id, cancel_at_period_end: !!(body && body.cancel_at_period_end) }; };
    stripe.subscriptions.cancel = async (id, body, opts) => { calls.cancel.push({ id, body, opts }); return { id, status: 'canceled' }; };
    stripe.invoices.list = async (q) => ({ data: [{ id: 'in_1', subscription: q.subscription, status: 'paid', amount_paid: paidCents, currency: 'usd', payment_intent: 'pi_paid_1' }] });
    stripe.refunds.create = async (body, opts) => { calls.refunds.push({ body, opts }); return { id: 're_1', amount: body.amount, status: 'succeeded' }; };
    const PW = 'dg2-pw-123';
    const mk = async (email, plan, billing) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email, name: 'Can Cel', plan, role: 'owner', password: bcrypt.hashSync(PW, 10), stripe_subscription_id: billing.subscription_id, stripe_customer_id: 'cus_' + email, subscriptionStatus: 'active', billing }])).rows[0].id;
    const mUid = await mk('dg2m@finflow.test', 'pro', { subscription_id: 'sub_M', item_id: 'si_M', plan: 'pro', interval: 'month', period_start: '2026-07-10T00:00:00.000Z', period_end: '2026-08-10T00:00:00.000Z', cancel_at_period_end: false, status: 'active' });
    const yUid = await mk('dg2y@finflow.test', 'business', { subscription_id: 'sub_Y', item_id: 'si_Y', plan: 'business', interval: 'year', period_start: '2026-03-10T00:00:00.000Z', period_end: '2027-03-10T00:00:00.000Z', cancel_at_period_end: false, status: 'active' });
    console.log('\n' + '='.repeat(78) + '\n  D-G step 2 — cancel from the app (monthly at period end; yearly leave any time)\n' + '='.repeat(78));

    const m = new HarnessHttp(server.baseUrl, { xff: '10.122.0.1' });
    await m.post('/api/auth/login', { email: 'dg2m@finflow.test', password: PW });
    const pm = (await m.get('/api/billing/cancel-preview')).json || {};
    A('1  monthly preview: ends at the period end (2026-08-10), refund 0 (bug: no way to cancel)', pm.mode === 'period_end' && String(pm.accessUntil || '').slice(0, 10) === '2026-08-10' && near(pm.refund, 0), JSON.stringify(pm));
    const cm = await m.post('/api/billing/cancel', { confirm: true });
    const bm = (await m.get('/api/billing')).json || {};
    A('2  monthly cancel: Stripe set to cancel at period end; Billing shows "cancels on"', cm.status === 200 && calls.update.length === 1 && calls.update[0].id === 'sub_M' && calls.update[0].body.cancel_at_period_end === true && bm.cancelAtPeriodEnd === true, cm.status + ' ' + JSON.stringify(calls.update) + ' ' + JSON.stringify(bm));
    const rs = await m.post('/api/billing/resume', {});
    const bm2 = (await m.get('/api/billing')).json || {};
    A('3  …and can be undone before the period ends (resume)', rs.status === 200 && calls.update.length === 2 && calls.update[1].body.cancel_at_period_end === false && bm2.cancelAtPeriodEnd === false, rs.status + ' ' + JSON.stringify(calls.update[1]));
    const noconf = await m.post('/api/billing/cancel', {});
    A('3b cancelling needs an explicit confirm (no accidental cancel)', noconf.status === 400 && calls.update.length === 2, 'status ' + noconf.status);

    const y = new HarnessHttp(server.baseUrl, { xff: '10.122.0.2' });
    await y.post('/api/auth/login', { email: 'dg2y@finflow.test', password: PW });
    const py = (await y.get('/api/billing/cancel-preview')).json || {};
    A('4  yearly preview: paid 2,388.00, 5 months used at 249 = 1,245.00, refund 1,143.00 (bugs: 0 · 1,491.67 · 1,393.00 · 1,392.00)', py.mode === 'refund' && near(py.paid, 2388) && py.monthsUsed === 5 && near(py.used, 1245) && near(py.refund, 1143), JSON.stringify(py));
    const cy = await y.post('/api/billing/cancel', { confirm: true });
    A('5  yearly cancel: refunds 114300 cents against the paid invoice, then cancels the subscription now', cy.status === 200 && calls.refunds.length === 1 && calls.refunds[0].body.amount === 114300 && calls.refunds[0].body.payment_intent === 'pi_paid_1' && calls.cancel.length === 1 && calls.cancel[0].id === 'sub_Y',
      cy.status + ' ' + String(cy.text).slice(0, 160) + ' ' + JSON.stringify(calls));
    A('5b both Stripe calls carry idempotency keys (a double click cannot refund twice)', !!(calls.refunds[0] && calls.refunds[0].opts && calls.refunds[0].opts.idempotencyKey) && !!(calls.cancel[0] && calls.cancel[0].opts && calls.cancel[0].opts.idempotencyKey), JSON.stringify(calls.refunds[0] && calls.refunds[0].opts));
    const yd = (await c.query(`SELECT data FROM users WHERE id = $1`, [yUid])).rows[0].data;
    A('5c the account is read-only from now (plan ended; access_ended_at recorded for the 90 days)', yd.plan === 'trial' && !!yd.trial_ends && !!(yd.billing || {}).access_ended_at, JSON.stringify({ plan: yd.plan, trial_ends: yd.trial_ends, ended: (yd.billing || {}).access_ended_at }));
    const aud = (await c.query(`SELECT count(*)::int AS n FROM audit_trail WHERE user_id = $1 AND table_name = 'billing' AND action = 'CANCEL'`, [yUid])).rows[0].n;
    A('5d the cancellation is audited', aud === 1, 'rows ' + aud);

    // a discounted yearly payment: the refund is never negative and never above what was paid
    paidCents = 100000;
    const zUid = await mk('dg2z@finflow.test', 'business', { subscription_id: 'sub_Z', item_id: 'si_Z', plan: 'business', interval: 'year', period_start: '2026-03-10T00:00:00.000Z', period_end: '2027-03-10T00:00:00.000Z', cancel_at_period_end: false, status: 'active' });
    const z = new HarnessHttp(server.baseUrl, { xff: '10.122.0.3' });
    await z.post('/api/auth/login', { email: 'dg2z@finflow.test', password: PW });
    const pz = (await z.get('/api/billing/cancel-preview')).json || {};
    A('6  paid 1,000.00 with 1,245.00 used → refund 0 (never negative)', near(pz.paid, 1000) && near(pz.refund, 0), JSON.stringify(pz));

    // the Billing panel shows the outcome before confirming
    paidCents = 238800;
    await c.query(`UPDATE users SET data = data || jsonb_build_object('plan','business','trial_ends',null::text,'billing', $2::jsonb) WHERE id = $1`, [yUid, JSON.stringify({ subscription_id: 'sub_Y', item_id: 'si_Y', plan: 'business', interval: 'year', period_start: '2026-03-10T00:00:00.000Z', period_end: '2027-03-10T00:00:00.000Z', cancel_at_period_end: false, status: 'active' })]);
    const cookiePair = [...y.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const page = await y.get('/app');
    const jar = new CookieJar();
    for (const [k, v] of y.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, server.baseUrl);
    const dom = new JSDOM(page.text, { url: server.baseUrl + '/app', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
    const w = dom.window, nodeFetch = global.fetch;
    w.fetch = (input, init = {}) => { const u = typeof input === 'string' ? input : String(input && input.url || input);
      const abs = u.startsWith('http') ? u : server.baseUrl + (u.startsWith('/') ? u : '/' + u);
      return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) })); };
    for (let i = 0; i < 80 && typeof w.ffRenderBilling !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    try { await w.ffRenderBilling(); } catch (_) {}
    try { await w.ffCancelPlan(); } catch (_) {}
    for (let i = 0; i < 30 && !w.document.getElementById('billing-cancel-confirm'); i++) await new Promise(r => setTimeout(r, 100));
    const t = ((w.document.getElementById('billing-cancel-box') || {}).textContent || '').replace(/\s+/g, ' ');
    A('7  before confirming, the panel says what happens: refund $1,143.00, access ends today, data kept read-only for 90 days', /\$1,143\.00/.test(t) && /read-only/i.test(t) && /90 days/.test(t) && !!w.document.getElementById('billing-cancel-confirm'), t.slice(0, 260) || 'no #billing-cancel-box');
    A('7b …and nothing was cancelled just by opening it', calls.refunds.length === 1 && calls.cancel.length === 1, JSON.stringify({ r: calls.refunds.length, c: calls.cancel.length }));
    try { w.close(); } catch (_) {}
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-G cancel)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
