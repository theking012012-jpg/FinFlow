'use strict';
/**
 * verify-paypal-connect.js — PayPal on the shared OAuth driver. Basic-auth + form token exchange (like
 * QBO); account = payer_id resolved from the Identity userinfo endpoint. Ships CONNECT + identity only —
 * transaction import needs PayPal's app-review-gated reporting scope, so sync returns identity + an
 * honest "pending" note rather than a fabricated feed (Rules 2 & 12). HTTP boundary mocked; sandbox host.
 *   node -r ./tests/harness/clock.js tests/harness/verify-paypal-connect.js
 */
process.env.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'pp_client_id';
process.env.PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'pp_client_secret';
delete process.env.PAYPAL_ENV; // sandbox
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'paypal-owner@finflow.test', password: 'harness-password-not-a-secret' };
const API = 'https://api-m.sandbox.paypal.com';
const WEB = 'https://www.sandbox.paypal.com';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let tokenAuthSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');

    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u === API + '/v1/oauth2/token') {
        tokenAuthSeen = opts && opts.headers && opts.headers['Authorization'];
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT-pp', refresh_token: 'RT-pp', expires_in: 3600, token_type: 'Bearer' }) };
      }
      if (u.startsWith(API + '/v1/identity/oauth2/userinfo')) {
        return { ok: true, status: 200, json: async () => ({ payer_id: 'PAYER1', email: 'me@paypal.test', name: 'Test Payer' }) };
      }
      return realFetch(url, opts);
    };

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eidA = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eidB = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const cu = await http.post('/api/paypal/connect-url?entity_id=' + eidA, {});
    const url = (cu.json && cu.json.connect_url) || '';
    A('connect-url 200', cu.status === 200 && !!url, JSON.stringify(cu.json).slice(0, 140));
    A('  authorize URL is PayPal sandbox signin', url.startsWith(WEB + '/signin/authorize?'));
    A('  scope includes openid', /scope=openid/.test(url));
    A('  redirect_uri → /api/paypal/callback', /redirect_uri=[^&]*%2Fapi%2Fpaypal%2Fcallback/.test(url));

    const cb = await http.get('/api/paypal/callback?entity_id=' + eidA + '&code=pp_code');
    A('callback 200', cb.status === 200, 'status ' + cb.status);
    A('  token exchange used HTTP Basic auth', /^Basic /.test(String(tokenAuthSeen || '')), 'auth=' + tokenAuthSeen);

    const stA = (await http.get('/api/paypal/status?entity_id=' + eidA)).json || {};
    A('status A connected, account = payer_id PAYER1', stA.connected === true && stA.account === 'PAYER1', JSON.stringify(stA));
    A('status B NOT connected (per-entity)', ((await http.get('/api/paypal/status?entity_id=' + eidB)).json || {}).connected === false);

    const { rows: [row] } = await c.query(`SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key'='paypal_conn' AND entity_id=$2 LIMIT 1`, [uid, eidA]);
    const stored = row ? JSON.parse(row.data.value) : {};
    A('token encrypted at rest (decTok→AT-pp)', stored.access_token && stored.access_token !== 'AT-pp' && app._decTok(stored.access_token) === 'AT-pp');

    const sy = await http.post('/api/paypal/sync?entity_id=' + eidA, {});
    A('sync 200', sy.status === 200, 'status ' + sy.status + ' ' + sy.text.slice(0, 120));
    A('  sync returns identity (email) + account', sy.json && sy.json.email === 'me@paypal.test' && sy.json.account === 'PAYER1', JSON.stringify(sy.json));
    A('  sync note is honest about pending txn scope', sy.json && /reporting scope|pending|identity only/i.test(sy.json.note || ''), sy.json && sy.json.note);

    A('disconnect A 200', (await http.post('/api/paypal/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, A not connected', ((await http.get('/api/paypal/status?entity_id=' + eidA)).json || {}).connected === false);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (PayPal OAuth connector)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
