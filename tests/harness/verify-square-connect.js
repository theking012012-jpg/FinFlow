'use strict';
/**
 * verify-square-connect.js — Square on the shared OAuth driver, exercising the JSON-body token exchange.
 * Square posts client_id/client_secret in a JSON body (no Basic auth), returns merchant_id + an ABSOLUTE
 * expires_at, and account = merchant_id straight from the token response (no follow-up call). HTTP
 * boundary mocked via global.fetch. Sandbox host by default (SQUARE_ENV unset).
 *   node -r ./tests/harness/clock.js tests/harness/verify-square-connect.js
 */
process.env.SQUARE_APP_ID = process.env.SQUARE_APP_ID || 'sq_app_id';
process.env.SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET || 'sq_app_secret';
delete process.env.SQUARE_ENV; // sandbox host
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'square-owner@finflow.test', password: 'harness-password-not-a-secret' };
const HOST = 'https://connect.squareupsandbox.com';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let tokenCtypeSeen = null, tokenBodySeen = null, tokenAuthSeen = null, sqVersionSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');

    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u === HOST + '/oauth2/token') {
        tokenCtypeSeen = opts && opts.headers && opts.headers['Content-Type'];
        tokenAuthSeen = opts && opts.headers && opts.headers['Authorization'];
        tokenBodySeen = String(opts && opts.body || '');
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT-sq', refresh_token: 'RT-sq', merchant_id: 'MERCH1', expires_at: '2027-01-01T00:00:00Z', token_type: 'bearer' }) };
      }
      if (u.startsWith(HOST + '/v2/payments')) {
        sqVersionSeen = opts && opts.headers && opts.headers['Square-Version'];
        return { ok: true, status: 200, json: async () => ({ payments: [{}, {}, {}] }) };
      }
      return realFetch(url, opts);
    };

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eidA = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eidB = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const cu = await http.post('/api/square/connect-url?entity_id=' + eidA, {});
    const url = (cu.json && cu.json.connect_url) || '';
    A('connect-url 200', cu.status === 200 && !!url, JSON.stringify(cu.json).slice(0, 140));
    A('  authorize URL is Square sandbox', url.startsWith(HOST + '/oauth2/authorize?'));
    A('  scope includes PAYMENTS_READ', /PAYMENTS_READ/.test(decodeURIComponent(url)));
    A('  redirect_uri → /api/square/callback', /redirect_uri=[^&]*%2Fapi%2Fsquare%2Fcallback/.test(url));

    const cb = await http.get('/api/square/callback?entity_id=' + eidA + '&code=sq_code');
    A('callback 200', cb.status === 200, 'status ' + cb.status);
    A('  token exchange sent a JSON body', /application\/json/.test(String(tokenCtypeSeen || '')), 'ctype=' + tokenCtypeSeen);
    A('  token exchange put creds in the body (no Basic auth)', !tokenAuthSeen && /"client_id"/.test(tokenBodySeen || ''), 'auth=' + tokenAuthSeen);

    const stA = (await http.get('/api/square/status?entity_id=' + eidA)).json || {};
    A('status A connected, account = merchant_id MERCH1', stA.connected === true && stA.account === 'MERCH1', JSON.stringify(stA));
    A('status B NOT connected (per-entity)', ((await http.get('/api/square/status?entity_id=' + eidB)).json || {}).connected === false);

    const { rows: [row] } = await c.query(`SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key'='square_conn' AND entity_id=$2 LIMIT 1`, [uid, eidA]);
    const stored = row ? JSON.parse(row.data.value) : {};
    A('token encrypted at rest (decTok→AT-sq)', stored.access_token && stored.access_token !== 'AT-sq' && app._decTok(stored.access_token) === 'AT-sq');
    A('absolute expires_at parsed to a future ms timestamp', typeof stored.expires_at === 'number' && stored.expires_at === Date.parse('2027-01-01T00:00:00Z'), String(stored.expires_at));

    const sy = await http.post('/api/square/sync?entity_id=' + eidA, {});
    A('sync 200', sy.status === 200, 'status ' + sy.status + ' ' + sy.text.slice(0, 120));
    A('  sync sent a Square-Version header', !!sqVersionSeen, 'ver=' + sqVersionSeen);
    A('  sync maps payments count (3)', sy.json && sy.json.payments === 3, JSON.stringify(sy.json));

    A('disconnect A 200', (await http.post('/api/square/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, A not connected', ((await http.get('/api/square/status?entity_id=' + eidA)).json || {}).connected === false);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (Square OAuth connector)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
