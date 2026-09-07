'use strict';
/**
 * verify-xero-connect.js — Xero on the shared OAuth connector driver. The Xero HTTP boundary (token
 * exchange, GET /connections for the tenant id, and the data calls) is mocked via global.fetch. Proves:
 *   - connect-url built with Xero's authorize URL, the offline_access + accounting scopes, redirect, state
 *   - the callback exchanges the code, resolves tenantId from GET /connections (NOT the callback query),
 *     stores the token ENCRYPTED at rest, scoped to the ACTIVE ENTITY
 *   - status reflects connected + account (tenantId), per-entity (no bleed to business B)
 *   - sync sends the Xero-tenant-id header and maps invoice + account counts
 *   - disconnect clears only this business's link
 *   node -r ./tests/harness/clock.js tests/harness/verify-xero-connect.js
 */
process.env.XERO_CLIENT_ID = process.env.XERO_CLIENT_ID || 'xero_client_id';
process.env.XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || 'xero_client_secret';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'xero-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let tenantHdrSeen = null, tokenAuthSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');

    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u === 'https://identity.xero.com/connect/token') {
        tokenAuthSeen = opts && opts.headers && opts.headers['Authorization'];
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT-xero', refresh_token: 'RT-xero', expires_in: 1800, token_type: 'Bearer' }) };
      }
      if (u === 'https://api.xero.com/connections') {
        return { ok: true, status: 200, json: async () => ([{ tenantId: 'TEN1', tenantName: 'Demo Org', tenantType: 'ORGANISATION' }]) };
      }
      if (u.startsWith('https://api.xero.com/api.xro/2.0/Invoices')) {
        tenantHdrSeen = opts && opts.headers && opts.headers['Xero-tenant-id'];
        return { ok: true, status: 200, json: async () => ({ Invoices: [{}, {}, {}] }) };
      }
      if (u.startsWith('https://api.xero.com/api.xro/2.0/Accounts')) {
        return { ok: true, status: 200, json: async () => ({ Accounts: [{}, {}, {}, {}] }) };
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
    const cu = await http.post('/api/xero/connect-url?entity_id=' + eidA, {});
    const url = (cu.json && cu.json.connect_url) || '';
    A('connect-url 200 with a connect_url', cu.status === 200 && !!url, JSON.stringify(cu.json).slice(0, 140));
    A('  authorize URL is Xero\'s', url.startsWith('https://login.xero.com/identity/connect/authorize?'));
    A('  scope includes offline_access', /offline_access/.test(decodeURIComponent(url)));
    A('  scope includes accounting.transactions.read', /accounting.transactions.read/.test(decodeURIComponent(url)));
    A('  redirect_uri points at /api/xero/callback', /redirect_uri=[^&]*%2Fapi%2Fxero%2Fcallback/.test(url));
    A('  state = the account id', url.includes('state=' + uid));

    // ── callback → tenantId resolved from GET /connections ──
    const cb = await http.get('/api/xero/callback?entity_id=' + eidA + '&code=auth_code_xyz');
    A('callback 200', cb.status === 200, 'status ' + cb.status);
    A('  token exchange used HTTP Basic auth', /^Basic /.test(String(tokenAuthSeen || '')), 'auth=' + tokenAuthSeen);

    // ── status per-entity ──
    const stA = (await http.get('/api/xero/status?entity_id=' + eidA)).json || {};
    A('status A connected', stA.connected === true, JSON.stringify(stA));
    A('status A account = tenantId TEN1', stA.account === 'TEN1', JSON.stringify(stA));
    const stB = (await http.get('/api/xero/status?entity_id=' + eidB)).json || {};
    A('status B NOT connected (per-entity, no bleed)', stB.connected === false, JSON.stringify(stB));

    // ── token encrypted at rest ──
    const { rows: [row] } = await c.query(`SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key'='xero_conn' AND entity_id=$2 LIMIT 1`, [uid, eidA]);
    const stored = row ? JSON.parse(row.data.value) : {};
    A('stored token is NOT plaintext', stored.access_token && stored.access_token !== 'AT-xero' && !String(stored.access_token).includes('AT-xero'));
    A('stored token decTok round-trips to AT-xero', app._decTok(stored.access_token) === 'AT-xero');
    A('stored account = TEN1', stored.account === 'TEN1');

    // ── sync sends the tenant header + maps counts ──
    const sy = await http.post('/api/xero/sync?entity_id=' + eidA, {});
    A('sync 200', sy.status === 200, 'status ' + sy.status + ' ' + sy.text.slice(0, 120));
    A('  sync sent Xero-tenant-id = TEN1', tenantHdrSeen === 'TEN1', 'hdr=' + tenantHdrSeen);
    A('  sync maps invoice count (3)', sy.json && sy.json.invoices === 3, JSON.stringify(sy.json));
    A('  sync maps account count (4)', sy.json && sy.json.accounts === 4, JSON.stringify(sy.json));

    // ── disconnect per-entity ──
    A('disconnect A 200', (await http.post('/api/xero/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, A not connected', ((await http.get('/api/xero/status?entity_id=' + eidA)).json || {}).connected === false);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (Xero OAuth connector)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
