'use strict';
/**
 * verify-coinbase-connect.js — Coinbase on the shared OAuth driver. Straight OAuth2, creds in the form
 * body (not Basic), refreshable; account = the Coinbase user id from GET /v2/user; data calls carry a
 * CB-VERSION header. HTTP boundary mocked via global.fetch.
 *   node -r ./tests/harness/clock.js tests/harness/verify-coinbase-connect.js
 */
process.env.COINBASE_CLIENT_ID = process.env.COINBASE_CLIENT_ID || 'cb_client_id';
process.env.COINBASE_CLIENT_SECRET = process.env.COINBASE_CLIENT_SECRET || 'cb_client_secret';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'cb-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let tokenAuthSeen = null, tokenBodySeen = null, cbVerSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u === 'https://login.coinbase.com/oauth2/token') {
        tokenAuthSeen = opts && opts.headers && opts.headers['Authorization']; tokenBodySeen = String(opts && opts.body || '');
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT-cb', refresh_token: 'RT-cb', expires_in: 7200 }) };
      }
      if (u === 'https://api.coinbase.com/v2/user') { cbVerSeen = opts && opts.headers && opts.headers['CB-VERSION']; return { ok: true, status: 200, json: async () => ({ data: { id: 'CBUSER1', name: 'Test' } }) }; }
      if (u === 'https://api.coinbase.com/v2/accounts') return { ok: true, status: 200, json: async () => ({ data: [{}, {}, {}] }) };
      return realFetch(url, opts);
    };
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eidA = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eidB = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);
    const cu = await http.post('/api/coinbase/connect-url?entity_id=' + eidA, {});
    const url = (cu.json && cu.json.connect_url) || '';
    A('connect-url 200', cu.status === 200 && !!url);
    A('  authorize URL is Coinbase', url.startsWith('https://login.coinbase.com/oauth2/auth?'));
    A('  scope includes wallet:accounts:read', /wallet%3Aaccounts%3Aread|wallet:accounts:read/.test(url));
    A('  redirect_uri → /api/coinbase/callback', /redirect_uri=[^&]*%2Fapi%2Fcoinbase%2Fcallback/.test(url));
    const cb = await http.get('/api/coinbase/callback?entity_id=' + eidA + '&code=cb_code');
    A('callback 200', cb.status === 200);
    A('  creds sent in body (no Basic auth)', !tokenAuthSeen && /client_id=/.test(tokenBodySeen || ''));
    const stA = (await http.get('/api/coinbase/status?entity_id=' + eidA)).json || {};
    A('status A connected, account = CBUSER1', stA.connected === true && stA.account === 'CBUSER1', JSON.stringify(stA));
    A('status B NOT connected (per-entity)', ((await http.get('/api/coinbase/status?entity_id=' + eidB)).json || {}).connected === false);
    const { rows: [row] } = await c.query(`SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key'='coinbase_conn' AND entity_id=$2 LIMIT 1`, [uid, eidA]);
    const stored = row ? JSON.parse(row.data.value) : {};
    A('token encrypted at rest (decTok→AT-cb)', stored.access_token && stored.access_token !== 'AT-cb' && app._decTok(stored.access_token) === 'AT-cb');
    const sy = await http.post('/api/coinbase/sync?entity_id=' + eidA, {});
    A('sync 200', sy.status === 200, sy.text.slice(0, 120));
    A('  sync sent CB-VERSION header', !!cbVerSeen, 'ver=' + cbVerSeen);
    A('  sync maps accounts count (3)', sy.json && sy.json.accounts === 3, JSON.stringify(sy.json));
    A('disconnect A 200', (await http.post('/api/coinbase/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, A not connected', ((await http.get('/api/coinbase/status?entity_id=' + eidA)).json || {}).connected === false);
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (Coinbase OAuth connector)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
