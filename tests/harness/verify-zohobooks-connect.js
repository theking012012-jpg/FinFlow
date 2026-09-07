'use strict';
/**
 * verify-zohobooks-connect.js — Zoho Books on the shared OAuth driver, exercising the MULTI-DATA-CENTER
 * path. The callback arrives with accounts-server=https://accounts.zoho.eu, so the token exchange must
 * hit the .eu token host and the org lookup + sync must hit www.zohoapis.eu — all captured at link time
 * and stored (token_url + api_base). Zoho puts creds in the FORM body (not Basic) and uses a
 * Zoho-oauthtoken header. account = organization_id. HTTP boundary mocked via global.fetch.
 *   node -r ./tests/harness/clock.js tests/harness/verify-zohobooks-connect.js
 */
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'zoho_client_id';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'zoho_client_secret';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'zoho-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let tokenUrlSeen = null, tokenAuthSeen = null, tokenBodySeen = null, orgAuthSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');

    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/oauth/v2/token')) {
        tokenUrlSeen = u; tokenBodySeen = String(opts && opts.body || '');
        tokenAuthSeen = opts && opts.headers && opts.headers['Authorization'];
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT-zoho', refresh_token: 'RT-zoho', expires_in: 3600 }) };
      }
      if (u === 'https://www.zohoapis.eu/books/v3/organizations') {
        orgAuthSeen = opts && opts.headers && opts.headers['Authorization'];
        return { ok: true, status: 200, json: async () => ({ organizations: [{ organization_id: 'ORG_EU_1', name: 'EU Org' }] }) };
      }
      if (u.startsWith('https://www.zohoapis.eu/books/v3/invoices')) return { ok: true, status: 200, json: async () => ({ page_context: { total: 9 } }) };
      if (u.startsWith('https://www.zohoapis.eu/books/v3/chartofaccounts')) return { ok: true, status: 200, json: async () => ({ chartofaccounts: [{}, {}, {}, {}, {}, {}] }) };
      return realFetch(url, opts);
    };

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eidA = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eidB = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const cu = await http.post('/api/zohobooks/connect-url?entity_id=' + eidA, {});
    const url = (cu.json && cu.json.connect_url) || '';
    A('connect-url 200', cu.status === 200 && !!url, JSON.stringify(cu.json).slice(0, 140));
    A('  authorize URL is Zoho accounts', url.startsWith('https://accounts.zoho.com/oauth/v2/auth?'));
    A('  scope = ZohoBooks.fullaccess.READ', /scope=ZohoBooks.fullaccess.READ/.test(url));
    A('  access_type=offline (for a refresh token)', /access_type=offline/.test(url));
    A('  redirect_uri → /api/zohobooks/callback', /redirect_uri=[^&]*%2Fapi%2Fzohobooks%2Fcallback/.test(url));

    // callback carries the DC (accounts-server) → EU
    const cb = await http.get('/api/zohobooks/callback?entity_id=' + eidA + '&code=zoho_code&accounts-server=' + encodeURIComponent('https://accounts.zoho.eu') + '&location=eu');
    A('callback 200', cb.status === 200, 'status ' + cb.status);
    A('  token exchange hit the EU DC token host', tokenUrlSeen === 'https://accounts.zoho.eu/oauth/v2/token', 'url=' + tokenUrlSeen);
    A('  creds sent in the BODY (no Basic auth header)', !tokenAuthSeen && /client_id=/.test(tokenBodySeen || ''), 'auth=' + tokenAuthSeen);
    A('  org lookup used Zoho-oauthtoken header', /^Zoho-oauthtoken /.test(String(orgAuthSeen || '')), 'auth=' + orgAuthSeen);

    const stA = (await http.get('/api/zohobooks/status?entity_id=' + eidA)).json || {};
    A('status A connected, account = ORG_EU_1', stA.connected === true && stA.account === 'ORG_EU_1', JSON.stringify(stA));
    A('status B NOT connected (per-entity)', ((await http.get('/api/zohobooks/status?entity_id=' + eidB)).json || {}).connected === false);

    const { rows: [row] } = await c.query(`SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key'='zohobooks_conn' AND entity_id=$2 LIMIT 1`, [uid, eidA]);
    const stored = row ? JSON.parse(row.data.value) : {};
    A('token encrypted at rest (decTok→AT-zoho)', stored.access_token && stored.access_token !== 'AT-zoho' && app._decTok(stored.access_token) === 'AT-zoho');
    A('stored api_base = www.zohoapis.eu (DC captured)', stored.api_base === 'https://www.zohoapis.eu', stored.api_base);
    A('stored token_url = EU token host', stored.token_url === 'https://accounts.zoho.eu/oauth/v2/token', stored.token_url);

    const sy = await http.post('/api/zohobooks/sync?entity_id=' + eidA, {});
    A('sync 200', sy.status === 200, 'status ' + sy.status + ' ' + sy.text.slice(0, 120));
    A('  sync maps invoice total (9)', sy.json && sy.json.invoices === 9, JSON.stringify(sy.json));
    A('  sync maps chart-of-accounts count (6)', sy.json && sy.json.accounts === 6, JSON.stringify(sy.json));

    A('disconnect A 200', (await http.post('/api/zohobooks/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, A not connected', ((await http.get('/api/zohobooks/status?entity_id=' + eidA)).json || {}).connected === false);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (Zoho Books OAuth connector)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
