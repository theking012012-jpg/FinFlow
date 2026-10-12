'use strict';
/**
 * C24 (Cowork end-to-end test 8.3): a customer never sees the server's setting names (environment variables).
 * BUG: unconfigured connections answered e.g. "Bank linking is not set up yet. Add PLAID_CLIENT_ID and PLAID_SECRET to
 * enable it." (16 such messages: Plaid, Belvo, Finch, Codat, every OAuth connector such as PayPal, AI, email, prices).
 * Executed: each unconfigured endpoint is called and its message must contain no SETTING_NAME-shaped token.
 */
const { run } = require('./moneyFixKit.js');

// Stripe itself is on (a key is set, never used on the network) but the plan price and the Connect id are not — so
// checkout and Stripe payments linking reach their own "not set up" answers (added after C24: both still named settings).
process.env.STRIPE_SECRET_KEY = 'sk_test_c24_not_a_real_key';
process.env.HARNESS_KEEP_STRIPE = '1';   // boot.js otherwise strips the key
for (const k of ['STRIPE_PRICE_PRO', 'STRIPE_CONNECT_CLIENT_ID']) delete process.env[k];

run('C24 — no server setting names in customer messages', async ({ newOwner, eq, A }) => {
  for (const k of ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD', 'FINCH_CLIENT_ID', 'FINCH_CLIENT_SECRET', 'CODAT_API_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']) delete process.env[k];
  const o = await newOwner('C24');
  const calls = [
    ['POST', '/api/plaid/link-token'], ['POST', '/api/plaid/sync'], ['POST', '/api/belvo/widget-token'],
    ['POST', '/api/finch/connect-url'], ['POST', '/api/codat/link-url'], ['POST', '/api/paypal/connect-url'],
    ['POST', '/api/stripe/checkout', { plan: 'pro' }], ['POST', '/api/stripe/connect-url'],
  ];
  const leaks = [];
  for (const [m, p, b] of calls) {
    const r = await o.http.request(m, p, b || {});
    const msg = String((r.json && r.json.error) || '');
    A(p + ' answers "not available" (' + r.status + ')', r.status >= 400 && msg.length > 0 && !/^Stripe not configured/.test(msg), msg);   // checkout must reach its plan-price check
    if (/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(msg))   /* any SETTING_NAME, e.g. STRIPE_PRICE_PRO */ leaks.push(p + ': ' + msg);
  }
  eq('no message names a server setting', leaks, [], ['/api/stripe/checkout: STRIPE_PRICE_PRO env var not set.', '/api/stripe/connect-url: Stripe payments linking is not set up yet. Add STRIPE_SECRET_KEY and STRIPE_CONNECT_CLIENT_ID to enable it.']);
});
