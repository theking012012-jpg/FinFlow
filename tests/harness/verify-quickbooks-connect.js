'use strict';
/**
 * verify-quickbooks-connect.js — QuickBooks on the shared OAuth connector driver. The Intuit HTTP
 * boundary (token exchange + data query) is mocked via global.fetch; everything else is real. Proves:
 *   - connect-url is built with the right authorize URL, scope, redirect, state, response_type
 *   - the callback exchanges the code, captures realmId from the CALLBACK QUERY, stores the token
 *     ENCRYPTED at rest (encTok round-trips; ciphertext != plaintext), scoped to the ACTIVE ENTITY
 *   - status reflects connected + account, and is PER-ENTITY (business B, which never linked, is NOT
 *     connected — no cross-entity bleed)
 *   - sync maps the display payload (invoice + account counts)
 *   - disconnect clears only this business's link
 *   node -r ./tests/harness/clock.js tests/harness/verify-quickbooks-connect.js
 */
process.env.QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || 'qbo_client_id';
process.env.QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || 'qbo_client_secret';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'qbo-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let tokenBodySeen = null, tokenAuthSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');

    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u === 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer') {
        tokenBodySeen = String(opts && opts.body || '');
        tokenAuthSeen = opts && opts.headers && opts.headers['Authorization'];
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT-qbo', refresh_token: 'RT-qbo', expires_in: 3600, token_type: 'bearer' }) };
      }
      if (u.includes('quickbooks.api.intuit.com') && u.includes('/query')) {
        const n = /Invoice/.test(u) ? 7 : 5;   // Invoice count vs Account count
        return { ok: true, status: 200, json: async () => ({ QueryResponse: { totalCount: n } }) };
      }
      return realFetch(url, opts);
    };

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const mkEnt = async (name, active) => (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name, currency: 'USD', is_active: active }])).rows[0].id;
    const eidA = await mkEnt('A Co', 1), eidB = await mkEnt('B Co', 0);

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    // ── connect-url ──
    const cu = await http.post('/api/quickbooks/connect-url?entity_id=' + eidA, {});
    const url = (cu.json && cu.json.connect_url) || '';
    A('connect-url 200 with a connect_url', cu.status === 200 && !!url, JSON.stringify(cu.json).slice(0, 140));
    A('  authorize URL is Intuit\'s', url.startsWith('https://appcenter.intuit.com/connect/oauth2?'));
    A('  scope = com.intuit.quickbooks.accounting', /scope=com.intuit.quickbooks.accounting/.test(url));
    A('  redirect_uri points at /api/quickbooks/callback', /redirect_uri=[^&]*%2Fapi%2Fquickbooks%2Fcallback/.test(url));
    A('  state = the account id', url.includes('state=' + uid));
    A('  response_type=code', /response_type=code/.test(url));

    // ── callback (realmId on the query) → stores per-entity ──
    const cb = await http.get('/api/quickbooks/callback?entity_id=' + eidA + '&code=auth_code_xyz&realmId=REALM123');
    A('callback 200 (returns close-popup HTML)', cb.status === 200, 'status ' + cb.status);
    A('  token exchange used HTTP Basic auth', /^Basic /.test(String(tokenAuthSeen || '')), 'auth=' + tokenAuthSeen);
    A('  token exchange sent grant_type=authorization_code', /grant_type=authorization_code/.test(tokenBodySeen || ''));

    // ── status per-entity ──
    const stA = (await http.get('/api/quickbooks/status?entity_id=' + eidA)).json || {};
    A('status A connected', stA.connected === true, JSON.stringify(stA));
    A('status A account = REALM123', stA.account === 'REALM123', JSON.stringify(stA));
    const stB = (await http.get('/api/quickbooks/status?entity_id=' + eidB)).json || {};
    A('status B NOT connected (per-entity, no bleed)', stB.connected === false, JSON.stringify(stB));

    // ── token encrypted at rest ──
    const { rows: [row] } = await c.query(`SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key'='quickbooks_conn' AND entity_id=$2 LIMIT 1`, [uid, eidA]);
    const stored = row ? JSON.parse(row.data.value) : {};
    A('stored token is NOT plaintext', stored.access_token && stored.access_token !== 'AT-qbo' && !String(stored.access_token).includes('AT-qbo'));
    A('stored token decTok round-trips to AT-qbo', app._decTok(stored.access_token) === 'AT-qbo', 'got ' + (stored.access_token && app._decTok(stored.access_token)));
    A('refresh token also stored encrypted', stored.refresh_token && app._decTok(stored.refresh_token) === 'RT-qbo');
    A('stored account = REALM123', stored.account === 'REALM123');

    // ── sync maps the display payload ──
    const sy = await http.post('/api/quickbooks/sync?entity_id=' + eidA, {});
    A('sync 200', sy.status === 200, 'status ' + sy.status + ' ' + sy.text.slice(0, 120));
    A('  sync maps invoice count (7)', sy.json && sy.json.invoices === 7, JSON.stringify(sy.json));
    A('  sync maps account count (5)', sy.json && sy.json.accounts === 5, JSON.stringify(sy.json));

    // ── disconnect is per-entity ──
    A('disconnect A 200', (await http.post('/api/quickbooks/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, A not connected', ((await http.get('/api/quickbooks/status?entity_id=' + eidA)).json || {}).connected === false);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (QuickBooks OAuth connector)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
