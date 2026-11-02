'use strict';
/**
 * verify-fal3e-bill-currency — FA-L3e (multi-currency product): an accountant bills a client in the CLIENT's business
 * currency, in the accountant's own rate currency, or in USD. Before, the dashboard said "Amount (USD)", sent no
 * currency and multiplied by 100 — wrong for 0- and 3-decimal currencies — and every earnings total summed
 * accountant_earnings with no currency, so a JMD bill would have been added to USD.
 * Also fixed (found here, same commit — one money path): the payment webhook took Stripe's fee from the balance
 * transaction, which is in the PLATFORM's currency (USD), and subtracted it from a bill in another currency.
 *
 * Real server + scratch Postgres; Stripe's API mocked at the client instance (checkout + charge retrieve), the webhook
 * signed with the real SDK; the accountant dashboard driven in Chromium.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fal3e-bill-currency.js
 *
 * Seed (Rule 4 — every currency number discriminates): client A has a JMD business the accountant may see and a TTD
 * business it may NOT; client B's only business is XCD with NO exchange rate. Client A's rates: USD→JMD 157, USD→JPY 150.
 * Accountant's rate currency JPY (0 decimals), 4 paying clients (10% commission tier). One USD referral already paid ($50.00).
 *   JMD minimum = ceil(50 × 157) = JMD 7,850.00 (785000 minor); bill JMD 10,000 → Stripe 1000000 jmd   (bug: usd 1000000)
 *   JPY bill ¥10,000 → Stripe 10000 jpy (exponent 0)                                                   (bug ×100: 1000000)
 *   webhook fee US$2.00 at exchange_rate 1/157 → JMD 314.00; net = 10,000 − 314 − 1,000 commission = JMD 8,686.00
 *                                                                                (bug: 200 subtracted → JMD 8,998.00)
 *   earned = "$50.00 + JMD 8,686.00"                                       (bug: one summed number, 873,600 "cents")
 */
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { data: { id: 'mock' } }; } }; } },
} };
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_fal3e';
process.env.ADMIN_PASSWORD = 'harness-shared-admin-pw';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const N = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
(async () => {
  let scratch, server, browser, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    installEnv(scratch.url);
    process.env.RESEND_API_KEY = 're_mock'; process.env.EMAIL_FROM = 'FinFlow <noreply@test.example>';
    const database = require('../../database.js'); await database.initDB();
    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;
    process.env.APP_URL = base;
    const sessions = []; const stripe = app._stripe();
    stripe.checkout.sessions.create = async (p) => { sessions.push(p); return { id: 'cs_' + sessions.length, url: 'https://checkout.stripe.test/c/' + sessions.length }; };
    stripe.charges.retrieve = async () => ({ id: 'ch_1', currency: 'jmd', balance_transaction: { currency: 'usd', fee: 200, exchange_rate: 1 / 157 } });

    const PW = 'fal3e-pw-1';
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, stripe_account_id, rate_currency)
      VALUES ('fal3e@finflow.test', $1, 'Jo', 'Mills', 'Mills Books', 'FAL3E1', 'verified', 'acct_MILLS', 'JPY') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    const mkUser = async (email, name) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, name, plan: 'business', role: 'owner', subscriptionStatus: 'active' }])).rows[0].id;
    const mkEnt = async (uid, name, cur) => (await c.query(`INSERT INTO entities (user_id, data, created_at, updated_at) VALUES ($1,$2,NOW(),NOW()) RETURNING id`, [uid, { name, currency: cur, country: 'JM' }])).rows[0].id;
    const cA = await mkUser('client-a@finflow.test', 'Ava Client'), cB = await mkUser('client-b@finflow.test', 'Ben Client');
    const eJ = await mkEnt(cA, 'Kingston Co', 'JMD'), eT = await mkEnt(cA, 'POS Co', 'TTD'); await mkEnt(cB, 'St Johns Co', 'XCD');
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, requested_by, entity_access) VALUES ($1,$2,'active','client',$3)`, [accId, cA, { entities: { [eJ]: 'view' }, personal: 'none' }]);
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, requested_by) VALUES ($1,$2,'active','client')`, [accId, cB]);
    for (const n of [1, 2]) { const u = await mkUser(`other${n}@finflow.test`, 'Other ' + n); await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, requested_by) VALUES ($1,$2,'active','client')`, [accId, u]); }   // 4 paying clients → 10% tier
    await c.query(`DELETE FROM fx_rates WHERE user_id = ANY($1::int[])`, [[cA, cB]]);
    for (const [to, rate] of [['JMD', 157], ['JPY', 150]]) await c.query(`INSERT INTO fx_rates (user_id, from_currency, to_currency, rate, rate_date) VALUES ($1,'USD',$2,$3,'2026-07-20')`, [cA, to, rate]);
    await c.query(`INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, description, status, period_month) VALUES ($1,$2,'referral',5000,'July referral','paid','2026-07-01')`, [accId, cA]);
    const acc = new HarnessHttp(base, { xff: '10.31.0.1' });
    A('accountant signs in', (await acc.post('/api/accountants/login', { email: 'fal3e@finflow.test', password: PW })).status === 200);

    // ── the options ──
    const o = (await acc.get('/api/accountants/bill-options?clientId=' + cA)).json || {};
    const by = Object.fromEntries((o.currencies || []).map(x => [x.code, x]));
    A('client A: JMD (its visible business), JPY (rate currency), USD — NOT TTD (a business the accountant cannot see)', JSON.stringify((o.currencies || []).map(x => x.code)) === '["JMD","JPY","USD"]', JSON.stringify(o));
    A('default is the client\'s business currency (JMD)', o.default === 'JMD');
    A('JMD minimum = ceil(50 × 157) = 7,850.00 → 785000 minor; fixed fee 0.30 × 157 = 4710', by.JMD && by.JMD.minMinor === 785000 && by.JMD.feeFixedMinor === 4710 && by.JMD.exponent === 2, JSON.stringify(by.JMD));
    A('JPY: exponent 0, minimum ¥7,500 = 7500 minor', by.JPY && by.JPY.exponent === 0 && by.JPY.minMinor === 7500, JSON.stringify(by.JPY));
    const oB = (await acc.get('/api/accountants/bill-options?clientId=' + cB)).json || {};
    const xcd = (oB.currencies || []).find(x => x.code === 'XCD') || {};
    A('client B: XCD listed but NOT billable (no exchange rate — no invented minimum)', xcd.billable === false && xcd.minMinor === null, JSON.stringify(oB));

    // ── billing ──
    const r1 = await acc.post('/api/accountants/bill-client', { clientUserId: String(cA), description: 'Q3 books', amount: '10000', currency: 'jmd' });
    const li = ((sessions[0] || {}).line_items || [])[0] || {};
    A('JMD 10,000 → Stripe 1000000 jmd (bug: usd)', r1.status === 200 && li.price_data && li.price_data.currency === 'jmd' && li.price_data.unit_amount === 1000000, r1.status + ' ' + JSON.stringify(li));
    A('…FinFlow commission 10% = 100000 jmd as the application fee', (sessions[0].payment_intent_data || {}).application_fee_amount === 100000);
    const e1 = (await c.query(`SELECT id, currency, billed_cents, stripe_fee_cents FROM accountant_earnings WHERE accountant_id = $1 AND type = 'service_commission' ORDER BY id`, [accId])).rows[0] || {};
    A('the earning records its currency (jmd) and an estimated fee in JMD (2.9% + 4710 = 33710)', e1.currency === 'jmd' && e1.billed_cents === 1000000 && e1.stripe_fee_cents === 33710, JSON.stringify(e1));
    const em = sent.find(m => m.to === 'client-a@finflow.test');
    A('the client\'s email states the amount in JMD', em && /10000\.00 JMD/.test(em.html), em && em.html.slice(0, 300));
    const r2 = await acc.post('/api/accountants/bill-client', { clientUserId: String(cA), description: 'Advice', amount: '10000', currency: 'jpy' });
    const li2 = ((sessions[1] || {}).line_items || [])[0] || {};
    A('¥10,000 → Stripe 10000 jpy, exponent 0 (bug: ×100 = 1000000)', r2.status === 200 && li2.price_data && li2.price_data.unit_amount === 10000 && li2.price_data.currency === 'jpy', JSON.stringify(li2));
    const rMin = await acc.post('/api/accountants/bill-client', { clientUserId: String(cA), description: 'tiny', amount: '7849', currency: 'jmd' });
    A('JMD 7,849 is under the minimum: "The minimum bill is JMD 7,850.00"', rMin.status === 400 && /minimum bill is JMD.7,850\.00/.test(rMin.text), rMin.status + ' ' + rMin.text.slice(0, 120));
    const rT = await acc.post('/api/accountants/bill-client', { clientUserId: String(cA), description: 'x', amount: '10000', currency: 'ttd' });
    A('TTD (a business the accountant cannot see) is refused: CURRENCY_NOT_OFFERED', rT.status === 400 && rT.json.code === 'CURRENCY_NOT_OFFERED', rT.text.slice(0, 120));
    const rX = await acc.post('/api/accountants/bill-client', { clientUserId: String(cB), description: 'x', amount: '500', currency: 'xcd' });
    A('XCD with no exchange rate is refused: NO_RATE (bug: billed with no minimum)', rX.status === 400 && rX.json.code === 'NO_RATE', rX.text.slice(0, 160));

    // ── the client pays: the fee comes back in USD ──
    const payload = JSON.stringify({ id: 'evt_fal3e', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_fal3e', object: 'payment_intent', latest_charge: 'ch_1', metadata: { kind: 'accountant_bill', accountant_id: String(accId), client_id: String(cA), earning_id: String(e1.id) } } } });
    const wh = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }, body: payload });
    const paid = (await c.query(`SELECT status, stripe_fee_cents, amount_cents FROM accountant_earnings WHERE id = $1`, [e1.id])).rows[0];
    A('webhook 200; Stripe\'s US$2.00 fee becomes JMD 314.00 (31400) — net 868600 (bug: fee 200, net 899800)', wh.status === 200 && paid.status === 'paid' && paid.stripe_fee_cents === 31400 && paid.amount_cents === 868600, JSON.stringify(paid));

    // ── every earnings surface is per currency ──
    const ae = (await acc.get('/api/accountants/earnings')).json || {};
    A('accountant earned = "$50.00 + JMD 8,686.00" (bug: one summed figure)', N(ae.summary && ae.summary.formatted && ae.summary.formatted.earned) === '$50.00 + JMD 8,686.00', JSON.stringify(ae.summary && ae.summary.formatted));
    A('…USD-only field stays 5000 (JMD never added into it)', ae.summary.earnedCents === 5000);
    A('…awaiting client: the unpaid ¥ bill, in yen', /¥/.test(ae.summary.formatted.awaiting || ''), ae.summary.formatted.awaiting);
    A('…each row is shown in its own currency', (ae.earnings || []).some(r => N(r.amount_formatted) === 'JMD 8,686.00') && (ae.earnings || []).some(r => r.amount_formatted === '$50.00'), JSON.stringify((ae.earnings || []).map(r => r.amount_formatted)));
    const adm = new HarnessHttp(base, { xff: '10.31.0.2' });
    await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    const ov = ((await adm.get('/api/admin/overview')).json || {}).earnings || {};
    A('admin overview: FinFlow commission = JMD 1,000.00 (not "$1000.00")', N(ov.totalFormatted) === 'JMD 1,000.00', JSON.stringify(ov));
    const ap = (await adm.get('/api/admin/earnings')).json || {};
    A('admin earnings: commission per currency, rows in their currency', N(ap.summary.formatted.commission) === 'JMD 1,000.00' && (ap.records || []).some(r => N(r.amount_formatted) === 'JMD 8,686.00'), JSON.stringify(ap.summary.formatted));
    const al = ((await adm.get('/api/admin/accountants')).json || []).find(a => a.id === accId) || {};
    const ad = (await adm.get('/api/admin/accountants/' + accId)).json || {};
    const adAcc = ad.accountant || ad;
    A('admin accountant list + detail: earned "$50.00 + JMD 8,686.00"', N(al.total_earnings_formatted) === '$50.00 + JMD 8,686.00' && N(adAcc.total_earnings_formatted) === '$50.00 + JMD 8,686.00', JSON.stringify([al.total_earnings_formatted, adAcc.total_earnings_formatted]));

    // ── the dashboard ──
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([...acc.cookies.entries()].map(([name, value]) => ({ name, value, url: base })));
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(base + '/accountant-dashboard.html', { waitUntil: 'load' }); await page.waitForTimeout(2000);
    const ui = await page.evaluate(async (cid) => {
      openBillModal();
      const sel = document.getElementById('bill-client-select'); sel.value = String(cid); await billClientChanged();
      const opts = [...document.getElementById('bill-currency').options].map(o => o.textContent);
      const label = document.getElementById('bill-amount-label').textContent;
      const amt = document.getElementById('bill-amount'); amt.value = '10000'; amt.dispatchEvent(new Event('input', { bubbles: true }));
      const pays = document.getElementById('bill-total').textContent;
      document.getElementById('bill-currency').value = 'JPY'; billCurrencyChanged();
      const jpyLabel = document.getElementById('bill-amount-label').textContent, step = amt.step;
      return { opts, label, pays, jpyLabel, step, total: document.getElementById('earn-total').textContent };
    }, cA);
    A('the bill form offers JMD / JPY / USD and defaults to the client\'s JMD', ui.opts.length === 3 && /^JMD/.test(ui.opts[0]), JSON.stringify(ui.opts));
    A('label "Amount (JMD) — minimum JMD 7,850.00" (bug: "Amount (USD) — minimum $50.00")', N(ui.label) === 'Amount (JMD) — minimum JMD 7,850.00', ui.label);
    A('the live breakdown is in JMD: client pays JMD 10,000.00', N(ui.pays) === 'JMD 10,000.00', ui.pays);
    A('switching to JPY: whole yen (step 1), minimum ¥7,500', /minimum ¥7,500$/.test(N(ui.jpyLabel)) && ui.step === '1', JSON.stringify([ui.jpyLabel, ui.step]));
    A('the Earnings card shows both currencies, never one sum', N(ui.total) === '$50.00 + JMD 8,686.00', ui.total);
    A('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (browser) await browser.close(); } catch {} try { if (server) await new Promise(r => server.close(r)); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + (fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (FA-L3e bill currency)` : `  ALL GREEN — ${pass} passed, 0 failed  (FA-L3e bill currency)`) + '\n');
  process.exit(fail ? 1 : 0);
})();
