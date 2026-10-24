'use strict';
/**
 * verify-db5-annual.js — D-B (owner decision 2026-10-23): annual billing that can actually be bought, and renewed fairly.
 * Before: the pricing pages offered "Annual · save 20%", but checkout had ONE price per plan — a yearly plan could not
 * be bought; and a yearly plan would have renewed silently.
 * Now:
 *   • checkout takes monthly / yearly and uses the plan's yearly Stripe price (STRIPE_PRICE_<PLAN>_ANNUAL); a missing
 *     yearly price says which setting is missing (never charges the monthly price instead)
 *   • the Pricing page sends the monthly / yearly choice the customer made
 *   • 30 days before a yearly renewal: an e-mail with the amount, the date and a ONE-CLICK cancel link — once per renewal;
 *     not for monthly plans, nor for a plan already set to cancel
 *   • the link opens a page that stops the renewal without signing in (a signed token for that account and that renewal;
 *     a wrong or altered token is refused); the paid year is kept
 * Clock pinned 2026-07-25 16:00Z. Real server + Postgres; Stripe = live client with checkout.sessions.create and
 * subscriptions.update captured; `resend` replaced in the require cache.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor(key) { this.emails = { send: async (msg) => { sent.push(msg); return { data: { id: 'mock-' + sent.length } }; } }; } },
} };
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const DAY = 86400000, NOW = Date.parse('2026-07-25T16:00:00Z');
const at = d => new Date(NOW + d * DAY).toISOString();

(async () => {
  let scratch, server;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    installEnv(scratch.url);
    Object.assign(process.env, { RESEND_API_KEY: 're_mock_db5', EMAIL_FROM: 'FinFlow <noreply@test.example>', APP_URL: 'https://finflow-test.example',
      HARNESS_KEEP_STRIPE: '1', STRIPE_SECRET_KEY: 'sk_test_harness', STRIPE_WEBHOOK_SECRET: 'whsec_db5',
      STRIPE_PRICE_PRO: 'price_pro_m', STRIPE_PRICE_PRO_ANNUAL: 'price_pro_y', STRIPE_PRICE_BUSINESS: 'price_biz_m' });
    delete process.env.STRIPE_PRICE_BUSINESS_ANNUAL;
    const database = require('../../database.js');
    await database.initDB();
    const PW = 'db5-pw-123';
    const mk = async (email, extra) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [Object.assign({ email, name: email.split('@')[0], role: 'owner', password: bcrypt.hashSync(PW, 10) }, extra)])).rows[0].id;
    const sub = (id, interval, endDays, cancel) => ({ plan: 'business', stripe_subscription_id: id, stripe_customer_id: 'cus_' + id, subscriptionStatus: 'active',
      billing: { subscription_id: id, item_id: 'si_' + id, plan: 'business', interval, period_start: at(endDays - 365), period_end: at(endDays), cancel_at_period_end: !!cancel, status: 'active' } });
    const trialU = await mk('t@finflow.test', { plan: 'trial', trial_ends: at(5) });
    const y30 = await mk('y30@finflow.test', sub('sub_y30', 'year', 30));
    const y40 = await mk('y40@finflow.test', sub('sub_y40', 'year', 40));
    const m10 = await mk('m10@finflow.test', sub('sub_m10', 'month', 10));
    const yc = await mk('yc@finflow.test', sub('sub_yc', 'year', 20, true));

    const app = require('../../server.js');
    const stripe = app._stripe();
    const created = [], updates = [];
    stripe.checkout.sessions.create = async (args) => { created.push(args); return { id: 'cs_x', url: 'https://checkout.stripe.test/x' }; };
    stripe.subscriptions.update = async (id, body, opts) => { updates.push({ id, body, opts }); return { id }; };
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;
    console.log('\n' + '='.repeat(78) + '\n  D-B — yearly plans: bought, reminded, cancelled in one click\n' + '='.repeat(78) + '\n');

    const t = new HarnessHttp(base, { xff: '10.125.0.1' });
    await t.post('/api/auth/login', { email: 't@finflow.test', password: PW });
    const co = await t.post('/api/stripe/checkout', { plan: 'pro', interval: 'year' });
    const a0 = created[0] || {};
    A('1  yearly checkout uses the yearly price (price_pro_y) and records the interval (bug: always the monthly price)', co.status === 200 && JSON.stringify(a0.line_items) === JSON.stringify([{ price: 'price_pro_y', quantity: 1 }]) && ((a0.subscription_data || {}).metadata || {}).interval === 'year',
      co.status + ' ' + JSON.stringify({ items: a0.line_items, md: (a0.subscription_data || {}).metadata }));
    const co2 = await t.post('/api/stripe/checkout', { plan: 'business', interval: 'year' });
    // (C24: a customer never sees a setting's name — notSetUp logs it for the owner and tells the customer it isn't available)
    A('1b no yearly price set for Business → refused as "billed yearly isn\'t available", no setting name shown, never the monthly price instead', co2.status === 503 && /yearly/i.test(String(co2.text)) && !/STRIPE_/.test(String(co2.text)) && created.length === 1, co2.status + ' ' + String(co2.text).slice(0, 160));
    const co3 = await t.post('/api/stripe/checkout', { plan: 'business' });
    A('1c monthly stays the default (price_biz_m)', co3.status === 200 && JSON.stringify((created[1] || {}).line_items) === JSON.stringify([{ price: 'price_biz_m', quantity: 1 }]), JSON.stringify((created[1] || {}).line_items));

    await app.runBillingJob(NOW);
    const to = addr => sent.filter(m => [].concat(m.to).includes(addr));
    const r30 = to('y30@finflow.test');
    const html = String((r30[0] || {}).html || '');
    const m = html.match(/href="([^"]*\/billing\/cancel\?[^"]*)"/);
    A('2  30 days before the yearly renewal: one e-mail with the amount ($2,388.00), the date (24 August 2026) and a one-click cancel link', r30.length === 1 && /\$2,388\.00/.test(html) && /24 August 2026/.test(html) && !!m, JSON.stringify(r30.map(x => [x.subject, html.slice(0, 300)])));
    A('2b no reminder for a monthly plan, a yearly plan 40 days out, or one already set to cancel', to('m10@finflow.test').length + to('y40@finflow.test').length + to('yc@finflow.test').length === 0, JSON.stringify(sent.map(x => x.to)));
    await app.runBillingJob(NOW + 3600000);
    A('2c sent once per renewal (the job runs hourly)', to('y30@finflow.test').length === 1, 'sent ' + to('y30@finflow.test').length);

    // the one-click link, without signing in
    const link = m ? m[1].replace(/&amp;/g, '&').replace('https://finflow-test.example', '') : '/billing/cancel';
    const anon = new HarnessHttp(base, { xff: '10.125.0.9' });
    const page = await anon.get(link);
    A('3  the link opens a page, no sign-in needed, saying what stopping the renewal means (keeps the paid year, ends 24 August 2026)', page.status === 200 && /24 August 2026/.test(page.text) && /renew/i.test(page.text), page.status + ' ' + String(page.text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
    const q = new URL('http://x' + link).searchParams;
    const bad = await anon.post('/api/billing/cancel-renewal', { u: q.get('u'), t: q.get('t').slice(0, -2) + (q.get('t').slice(-2) === 'aa' ? 'bb' : 'aa') });
    A('4  an altered token is refused (403) and nothing changes', bad.status === 403 && updates.length === 0, bad.status + ' updates ' + updates.length);
    const other = await anon.post('/api/billing/cancel-renewal', { u: String(y40), t: q.get('t') });
    A('4b the token only works for its own account', other.status === 403 && updates.length === 0, other.status + '');
    const ok = await anon.post('/api/billing/cancel-renewal', { u: q.get('u'), t: q.get('t') });
    const d30 = (await c.query(`SELECT data FROM users WHERE id = $1`, [y30])).rows[0].data;
    const aud = (await c.query(`SELECT count(*)::int AS n FROM audit_trail WHERE user_id = $1 AND table_name = 'billing' AND action = 'CANCEL'`, [y30])).rows[0].n;
    A('5  one click stops the renewal: Stripe set to cancel at the period end; the paid year is kept; audited', ok.status === 200 && updates.length === 1 && updates[0].id === 'sub_y30' && updates[0].body.cancel_at_period_end === true && d30.billing.cancel_at_period_end === true && d30.plan === 'business' && aud === 1,
      ok.status + ' ' + JSON.stringify(updates) + ' aud ' + aud);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-B annual)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
