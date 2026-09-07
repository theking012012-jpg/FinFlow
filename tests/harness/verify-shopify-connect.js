'use strict';
/**
 * verify-shopify-connect.js — Shopify on the shared OAuth driver, PER-SHOP variant. The merchant's
 * {shop}.myshopify.com is the authorize + token host, built from a strictly-validated `shop` param — a
 * missing or non-myshopify.com value is a clean 400 (never a request to an arbitrary host: SSRF guard).
 * Token exchange is a JSON body; offline tokens don't expire; the Admin API uses X-Shopify-Access-Token.
 * account = the shop domain. HTTP boundary mocked via global.fetch.
 *   node -r ./tests/harness/clock.js tests/harness/verify-shopify-connect.js
 */
process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'shopify_key';
process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'shopify_secret';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'shopify-owner@finflow.test', password: 'harness-password-not-a-secret' };
const SHOP = 'teststore.myshopify.com';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let tokenUrlSeen = null, tokenCtypeSeen = null, shopTokenHdrSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u === 'https://' + SHOP + '/admin/oauth/access_token') {
        tokenUrlSeen = u; tokenCtypeSeen = opts && opts.headers && opts.headers['Content-Type'];
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT-shop', scope: 'read_orders' }) };
      }
      if (u.startsWith('https://' + SHOP + '/admin/api/') && u.includes('/orders/count.json')) {
        shopTokenHdrSeen = opts && opts.headers && opts.headers['X-Shopify-Access-Token'];
        return { ok: true, status: 200, json: async () => ({ count: 12 }) };
      }
      return realFetch(url, opts);
    };
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eidA = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eidB = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    // SSRF / validation guard
    A('connect-url with NO shop → 400', (await http.post('/api/shopify/connect-url?entity_id=' + eidA, {})).status === 400);
    A('connect-url with a NON-myshopify domain → 400 (no arbitrary host)', (await http.post('/api/shopify/connect-url?entity_id=' + eidA + '&shop=evil.example.com', {})).status === 400);

    const cu = await http.post('/api/shopify/connect-url?entity_id=' + eidA + '&shop=' + SHOP, {});
    const url = (cu.json && cu.json.connect_url) || '';
    A('connect-url with a valid shop → 200', cu.status === 200 && !!url);
    A('  authorize host is the shop', url.startsWith('https://' + SHOP + '/admin/oauth/authorize?'));
    A('  scope = read_orders', /scope=read_orders/.test(url));
    A('  redirect_uri → /api/shopify/callback', /redirect_uri=[^&]*%2Fapi%2Fshopify%2Fcallback/.test(url));

    const cb = await http.get('/api/shopify/callback?entity_id=' + eidA + '&shop=' + SHOP + '&code=shop_code');
    A('callback 200', cb.status === 200);
    A('  token exchange hit the shop token host', tokenUrlSeen === 'https://' + SHOP + '/admin/oauth/access_token');
    A('  token exchange sent JSON', /application\/json/.test(String(tokenCtypeSeen || '')));
    const stA = (await http.get('/api/shopify/status?entity_id=' + eidA)).json || {};
    A('status A connected, account = shop domain', stA.connected === true && stA.account === SHOP, JSON.stringify(stA));
    A('status B NOT connected (per-entity)', ((await http.get('/api/shopify/status?entity_id=' + eidB)).json || {}).connected === false);
    const { rows: [row] } = await c.query(`SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key'='shopify_conn' AND entity_id=$2 LIMIT 1`, [uid, eidA]);
    const stored = row ? JSON.parse(row.data.value) : {};
    A('token encrypted at rest (decTok→AT-shop)', stored.access_token && stored.access_token !== 'AT-shop' && app._decTok(stored.access_token) === 'AT-shop');
    A('stored api_base = the shop host', stored.api_base === 'https://' + SHOP, stored.api_base);
    const sy = await http.post('/api/shopify/sync?entity_id=' + eidA, {});
    A('sync 200', sy.status === 200, sy.text.slice(0, 120));
    A('  sync sent X-Shopify-Access-Token = the decrypted token', shopTokenHdrSeen === 'AT-shop', 'hdr=' + shopTokenHdrSeen);
    A('  sync maps orders count (12)', sy.json && sy.json.orders === 12, JSON.stringify(sy.json));
    A('disconnect A 200', (await http.post('/api/shopify/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, A not connected', ((await http.get('/api/shopify/status?entity_id=' + eidA)).json || {}).connected === false);
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (Shopify OAuth connector)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
