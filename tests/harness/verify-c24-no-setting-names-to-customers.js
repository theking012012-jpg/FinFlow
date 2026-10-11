'use strict';
/**
 * C24 (Cowork end-to-end test 8.3): a customer never sees the server's setting names (environment variables).
 * BUG: unconfigured connections answered e.g. "Bank linking is not set up yet. Add PLAID_CLIENT_ID and PLAID_SECRET to
 * enable it." (16 such messages: Plaid, Belvo, Finch, Codat, every OAuth connector such as PayPal, AI, email, prices).
 * Executed: each unconfigured endpoint is called and its message must contain no SETTING_NAME-shaped token.
 */
const { run } = require('./moneyFixKit.js');

run('C24 — no server setting names in customer messages', async ({ newOwner, eq, A }) => {
  for (const k of ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD', 'FINCH_CLIENT_ID', 'FINCH_CLIENT_SECRET', 'CODAT_API_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']) delete process.env[k];
  const o = await newOwner('C24');
  const calls = [
    ['POST', '/api/plaid/link-token'], ['POST', '/api/plaid/sync'], ['POST', '/api/belvo/widget-token'],
    ['POST', '/api/finch/connect-url'], ['POST', '/api/codat/link-url'], ['POST', '/api/paypal/connect-url'],
  ];
  const leaks = [];
  for (const [m, p] of calls) {
    const r = await o.http.request(m, p, {});
    const msg = String((r.json && r.json.error) || '');
    A(p + ' answers "not available" (' + r.status + ')', r.status >= 400 && msg.length > 0, msg);
    if (/\b[A-Z][A-Z0-9]+_[A-Z0-9_]*(ID|SECRET|KEY|TOKEN|PASSWORD)\b/.test(msg)) leaks.push(p + ': ' + msg);
  }
  eq('no message names a server setting', leaks, [], ['/api/plaid/link-token: Bank linking is not set up yet. Add PLAID_CLIENT_ID and PLAID_SECRET to enable it.', '…']);
});
