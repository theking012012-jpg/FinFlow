'use strict';
/**
 * Decision 3.6 / LC3e-c (2026-10-21: option A — require a business first). A business service connected while no
 * business is in view was stored with NO business and recorded nowhere (the audit trail needs a business; personal
 * history is for personal things). Now every route that STARTS a business connection refuses without a business in
 * view: the OAuth connect-url (QuickBooks, Xero, Zoho, Square, PayPal, Coinbase, Shopify), Finch, Codat, Stripe
 * Connect, and the WooCommerce / WiPay credential saves. Personal bank linking is unaffected (its own scope).
 * Real server + scratch Postgres; QBO keys set so the old code's success is visible (no outbound call is made).
 *   1  no business at all: QuickBooks connect-url → 400 NO_BUSINESS_YET          bug: 200 + an authorize URL
 *   2  no business: WooCommerce connect → 400, nothing stored                     bug: 200/4xx-other, blob stored
 *   3  no business: Finch / Codat / Stripe Connect / WiPay → 400 NO_BUSINESS_YET    bug: 502 not-set-up / other
 *   4  with a business in view: QuickBooks connect-url → 200 (control)
 *   5  personal bank linking (Plaid link-token, scope=personal) is NOT blocked by this rule (control)
 */
require('./clock.js');
process.env.QBO_CLIENT_ID = 'harness-qbo-id'; process.env.QBO_CLIENT_SECRET = 'harness-qbo-secret-not-real';
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
(async () => {
  let scratch, server;
  console.log('\n3.6 — a business service needs a business\n');
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'b36@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', { email: 'b36@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const r1 = await http.post('/api/quickbooks/connect-url', {});
    eq('1  no business: QuickBooks connect-url → 400 NO_BUSINESS_YET', [r1.status, r1.json && r1.json.code], [400, 'NO_BUSINESS_YET'], [200, undefined]);
    const r2 = await http.post('/api/woocommerce/connect', { store_url: 'https://shop.example.test', consumer_key: 'ck_x', consumer_secret: 'cs_x' });
    const stored = (await c.query(`SELECT COUNT(*)::int n FROM user_settings WHERE user_id = $1 AND data->>'key' LIKE 'woocommerce%'`, [uid])).rows[0].n;
    eq('2  no business: WooCommerce connect → 400, nothing stored', [r2.status, r2.json && r2.json.code, stored], [400, 'NO_BUSINESS_YET', 0]);
    const others = [];
    for (const [p, b] of [['/api/finch/connect-url', {}], ['/api/codat/link-url', {}], ['/api/stripe/connect-url', {}], ['/api/wipay/connect', { account_number: '1234', api_key: 'k' }]]) {
      const r = await http.post(p, b); others.push(p + ' ' + r.status + ' ' + (r.json && r.json.code));
    }
    eq('3  no business: Finch / Codat / Stripe Connect / WiPay → 400 NO_BUSINESS_YET', others,
      ['/api/finch/connect-url 400 NO_BUSINESS_YET', '/api/codat/link-url 400 NO_BUSINESS_YET', '/api/stripe/connect-url 400 NO_BUSINESS_YET', '/api/wipay/connect 400 NO_BUSINESS_YET']);
    const e = (await http.post('/api/entities', { name: 'Biz', currency: 'USD', timezone: 'UTC', country: 'US' })).json.id;
    await http.post('/api/entities/' + e + '/activate', {});
    const r4 = await http.post('/api/quickbooks/connect-url', {});
    eq('4  with a business: QuickBooks connect-url → 200 (control)', r4.status, 200);
    const r5 = await http.request('GET', '/api/plaid/link-token?scope=personal');
    eq('5  personal Plaid link-token is not refused as NO_BUSINESS_YET (control)', r5.json && r5.json.code === 'NO_BUSINESS_YET', false);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (server) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
