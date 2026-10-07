'use strict';
/**
 * verify-accountant-billing.js — N86 / N98. An accountant bills a linked client from the dashboard: the
 * client gets a Stripe payment link by email, FinFlow's commission rides as the application fee, and the
 * earning is NOT payable until the client actually pays.
 *
 * Defects:
 *   N98 — the dashboard sends { clientUserId, description, amountCents } and expects { url }; the route
 *         required { clientId, amount } (every dashboard bill → 400), returned a PaymentIntent client
 *         secret to the accountant and sent no email although the UI said "client will receive an email".
 *   N86 — the earning was booked 'pending' (= the admin payout queue) before anyone paid, and raw Stripe
 *         error text was returned to the caller.
 *
 * Executed against the real server + Postgres, with the dashboard's exact request body. Boundaries
 * mocked: Stripe (checkout.sessions.create on the live client instance — params captured; the webhook is
 * signed with the real SDK) and Resend (module mock, sends captured). Accountant has 4 paying clients →
 * tier commission 10%. Bug value stated:
 *   dashboard-shaped bill (amountCents 50000)        → 200 with a checkout url   (bug: 400)
 *   Stripe params: 50000 usd, application fee 5000, destination = accountant's account, earning id in metadata
 *   client emailed the link; client name escaped in the email          (bug: no email)
 *   earning status 'awaiting_payment'; admin payout queue unchanged    (bug: 'pending', in the queue)
 *   payment_intent.succeeded (metadata earning id) → earning 'paid', PI id recorded
 *   unlinked client → 403; Stripe failure → 502 generic, no earning left behind, no raw Stripe text
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-billing.js
 */
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { data: { id: 'mock' } }; } }; } },
} };
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_billing';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    installEnv(scratch.url);
    process.env.RESEND_API_KEY = 're_mock';
    process.env.EMAIL_FROM = 'FinFlow <noreply@test.example>';
    process.env.APP_URL = 'https://finflow-test.example';
    const database = require('../../database.js');
    await database.initDB();
    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;

    const sessions = []; let failNext = false;
    const stripe = app._stripe();
    stripe.checkout.sessions.create = async (params) => {
      if (failNext) { failNext = false; throw new Error('Stripe internal: account acct_SECRET_DETAIL restricted'); }
      sessions.push(params);
      return { id: 'cs_test_' + sessions.length, url: 'https://checkout.stripe.test/c/cs_test_' + sessions.length };
    };

    const PW = 'billing-pw-1';
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, stripe_account_id)
      VALUES ('bill-acc@finflow.test', $1, 'Bea', 'Biller', 'Biller & Co', 'BILLREF1', 'verified', 'acct_BILLER') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    const mkClient = async (email, name) => {
      const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, name, plan: 'business', role: 'owner', subscriptionStatus: 'active' }])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, requested_by) VALUES ($1,$2,'active','client')`, [accId, uid]);
      return uid;
    };
    const client = await mkClient('bill-client@finflow.test', 'Cara <b>Client</b>');
    for (const n of [1, 2, 3]) await mkClient(`bill-other${n}@finflow.test`, 'Other ' + n);   // 4 paying clients → 10% tier
    const stranger = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'bill-stranger@finflow.test', plan: 'business', role: 'owner' }])).rows[0].id;
    const acc = new HarnessHttp(base, { xff: '10.86.0.1' });
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'bill-acc@finflow.test', password: PW })).status === 200);
    const pendingQueue = async () => Number((await c.query(`SELECT COUNT(*) n FROM accountant_earnings WHERE status='pending'`)).rows[0].n);

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT BILLS A CLIENT — payment link, emailed, payable only once paid');
    console.log('='.repeat(78));
    const r = await acc.post('/api/accountants/bill-client', { clientUserId: String(client), description: 'Q2 bookkeeping', amountCents: 50000 });
    A('dashboard-shaped bill → 200 with a checkout url (bug: 400 "clientId and amount required")', r.status === 200 && /^https:\/\/checkout\.stripe\.test\//.test(r.json && r.json.url || ''), `status ${r.status}: ${r.text.slice(0, 140)}`);
    const sp = sessions[0] || {};
    const li = (sp.line_items || [])[0] || {};
    A('Stripe: 50000 usd for "Q2 bookkeeping"', li.price_data && li.price_data.unit_amount === 50000 && li.price_data.currency === 'usd' && li.price_data.product_data.name === 'Q2 bookkeeping', JSON.stringify(li));
    const pid = sp.payment_intent_data || {};
    A('Stripe: application fee 5000 (10% tier), destination acct_BILLER', pid.application_fee_amount === 5000 && pid.transfer_data && pid.transfer_data.destination === 'acct_BILLER', JSON.stringify(pid));
    const earning = (await c.query(`SELECT id, status, billed_cents, commission_cents FROM accountant_earnings WHERE accountant_id=$1 AND client_id=$2`, [accId, client])).rows;
    A('Stripe metadata carries the earning id', earning[0] && pid.metadata && pid.metadata.earning_id === String(earning[0].id), JSON.stringify(pid.metadata));
    A('earning booked as awaiting_payment, billed 50000 / commission 5000 (bug: pending)', earning.length === 1 && earning[0].status === 'awaiting_payment' && earning[0].billed_cents === 50000 && earning[0].commission_cents === 5000, JSON.stringify(earning));
    A('admin payout queue is still empty (bug: 1 pending)', (await pendingQueue()) === 0);
    const m = sent.find(x => x.to === 'bill-client@finflow.test');
    A('client emailed the payment link (bug: no email)', !!m && m.html.includes('https://checkout.stripe.test/c/cs_test_1') && r.json.emailed === true, JSON.stringify(sent.map(x => x.to)));
    A('client name escaped in the email', m && m.html.includes('Cara &lt;b&gt;Client&lt;/b&gt;') && !m.html.includes('<b>Client</b>'));

    // Client pays: Stripe sends payment_intent.succeeded with the earning id in metadata.
    const payload = JSON.stringify({ id: 'evt_bill_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_bill_1', object: 'payment_intent', metadata: { kind: 'accountant_bill', accountant_id: String(accId), client_id: String(client), earning_id: String(earning[0].id) } } } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const wh = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    A('webhook → 200', wh.status === 200, 'status ' + wh.status);
    const after = (await c.query(`SELECT status, payment_intent_id FROM accountant_earnings WHERE id=$1`, [earning[0].id])).rows[0];
    A('after payment: earning paid, PaymentIntent recorded', after.status === 'paid' && after.payment_intent_id === 'pi_bill_1', JSON.stringify(after));

    const r403 = await acc.post('/api/accountants/bill-client', { clientUserId: String(stranger), description: 'x', amountCents: 10000 });
    A('unlinked client → 403', r403.status === 403, 'status ' + r403.status);
    failNext = true;
    const before = Number((await c.query(`SELECT COUNT(*) n FROM accountant_earnings`)).rows[0].n);
    const rf = await acc.post('/api/accountants/bill-client', { clientUserId: String(client), description: 'retry', amountCents: 20000 });
    A('Stripe failure → 502 with a generic message, no raw Stripe text (bug: 500 "Stripe internal: … acct_SECRET_DETAIL")', rf.status === 502 && !/SECRET_DETAIL|Stripe internal/.test(rf.text), `status ${rf.status}: ${rf.text.slice(0, 140)}`);
    A('  no earning left behind by the failed bill', Number((await c.query(`SELECT COUNT(*) n FROM accountant_earnings`)).rows[0].n) === before);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await new Promise(r => server.close(r)); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (accountant billing)` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant billing)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
