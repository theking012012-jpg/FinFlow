'use strict';
/**
 * M18 (money audit 2026-10-09): a Stripe charge that paid an invoice through a Pay-now link must not be booked again,
 * and refunding it must reverse the invoice payment.
 * BUG: Pay-now payments were keyed 'stripe:<checkout session>' — the charge feed and the refund handler only knew
 * 'stripe-invpay:<charge>', so the charge showed "Add to books" (a second, sales-receipt copy of the revenue and
 * cash) and its refund left the invoice settled.
 * Executed: a SIGNED checkout.session.completed webhook (stripe.webhooks.generateTestHeaderString), the real feed
 * and import-charge routes, and a SIGNED charge.refunded webhook. Only api.stripe.com is mocked (the provider's
 * response for the charge — test input, not the money path).
 * Seed: invoice 500 · paid by Pay-now (PaymentIntent pi_M18) · its charge ch_M18 (pi_M18)
 *   correct: feed appliedToInvoice true · import-charge 409 · revenue 500 (bug 1,000 after import) ·
 *            after the refund: invoice outstanding 500 again (bug 0)
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_m18';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_m18_secret';
process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_m18';
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { run } = require('./moneyFixKit.js');

run('M18 — Pay-now Stripe payments are recognised by the feed, import and refunds', async ({ newOwner, c, eq, A, server }) => {
  const { uid, J, http, ids } = await newOwner('M18');
  const inv = await J('POST', '/api/invoices', { client: 'Card Co', amount: 500, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-10', idempotency_key: 'm18-inv' });
  await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
    [uid, ids[0], { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_m18', linked_at: 'now' }) }]);
  const signed = async (evt) => { const payload = JSON.stringify(evt); const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload }); };
  const wh = await signed({ id: 'evt_m18_paid', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', id: 'cs_m18', mode: 'payment', amount_total: 50000, currency: 'usd', payment_intent: 'pi_M18', client_reference_id: String(inv.id), metadata: { kind: 'invoice_payment', invoice_id: String(inv.id) } } } });
  A('Pay-now webhook accepted', wh.status === 200, 'status ' + wh.status);
  eq('invoice paid by Pay-now (outstanding)', (await J('GET', '/api/reports')).outstanding, 0);

  const charge = { id: 'ch_M18', object: 'charge', amount: 50000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, payment_intent: 'pi_M18', created: Math.floor(Date.parse('2026-07-12T12:00:00Z') / 1000), description: 'Card Co', livemode: false, billing_details: {} };
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://api.stripe.com/v1/charges/')) return { ok: true, status: 200, json: async () => charge };
    if (u.startsWith('https://api.stripe.com/v1/charges')) return { ok: true, status: 200, json: async () => ({ data: [charge] }) };
    return realFetch(url, opts);
  };
  try {
    const feed = await J('GET', '/api/stripe/feed');
    const fc = (feed.charges || []).find(x => x.id === 'ch_M18') || {};
    eq('feed: the Pay-now charge is marked as already applied to an invoice', fc.appliedToInvoice, true, false);
    const imp = await http.post('/api/stripe/import-charge', { charge_id: 'ch_M18', confirm: true });
    eq('import-charge refuses to book it again (even with confirm)', imp.status, 409, 200);
    eq('revenue stays 500 (not 500 invoice + 500 sales receipt)', (await J('GET', '/api/reports')).revenue, 500, 1000);
  } finally { global.fetch = realFetch; }

  const rf = await signed({ id: 'evt_m18_refund', type: 'charge.refunded', data: { object: Object.assign({}, charge, { refunded: true, amount_refunded: 50000, refunds: { data: [{ id: 're_M18' }] } }) } });
  A('refund webhook accepted', rf.status === 200, 'status ' + rf.status);
  eq('after the refund the invoice is owed again (outstanding)', (await J('GET', '/api/reports')).outstanding, 500, 0);
});
