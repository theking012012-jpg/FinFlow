'use strict';
/**
 * verify-woocommerce-connect.js — WooCommerce per-store REST keys (not OAuth), per-entity. Owner enters
 * store URL + consumer key/secret; keys are encTok'd at rest, store_url kept plaintext (it's the API
 * base). Sync = order count via the WC REST API (Basic ck:cs). HTTP boundary mocked via global.fetch.
 *   node -r ./tests/harness/clock.js tests/harness/verify-woocommerce-connect.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'woo-owner@finflow.test', password: 'harness-password-not-a-secret' };
const STORE = 'https://shop.example.com';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let wcAuthSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith(STORE + '/wp-json/wc/v3/orders')) {
        wcAuthSeen = opts && opts.headers && opts.headers['Authorization'];
        return { ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'x-wp-total' ? '42' : null) }, json: async () => ([{}]) };
      }
      return realFetch(url, opts);
    };
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eidA = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eidB = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    A('connect with a bad store URL → 400', (await http.post('/api/woocommerce/connect?entity_id=' + eidA, { store_url: 'not-a-url', consumer_key: 'ck', consumer_secret: 'cs' })).status === 400);
    A('connect (valid) → 201', (await http.post('/api/woocommerce/connect?entity_id=' + eidA, { store_url: STORE, consumer_key: 'ck_live_1', consumer_secret: 'cs_live_1' })).status === 201);

    const stA = (await http.get('/api/woocommerce/status?entity_id=' + eidA)).json || {};
    A('status A connected, store = the URL', stA.connected === true && stA.store === STORE, JSON.stringify(stA));
    A('status does NOT leak secrets', !('consumer_key' in stA) && !('consumer_secret' in stA));
    A('status B NOT connected (per-entity)', ((await http.get('/api/woocommerce/status?entity_id=' + eidB)).json || {}).connected === false);

    const { rows: [row] } = await c.query(`SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key'='woocommerce_conn' AND entity_id=$2 LIMIT 1`, [uid, eidA]);
    const stored = row ? JSON.parse(row.data.value) : {};
    A('consumer_key encrypted at rest (decTok→ck_live_1)', stored.consumer_key && stored.consumer_key !== 'ck_live_1' && app._decTok(stored.consumer_key) === 'ck_live_1');
    A('consumer_secret encrypted at rest', stored.consumer_secret && app._decTok(stored.consumer_secret) === 'cs_live_1');
    A('store_url stored plaintext (it is the API base, not a secret)', stored.store_url === STORE);

    const sy = await http.post('/api/woocommerce/sync?entity_id=' + eidA, {});
    A('sync 200', sy.status === 200, sy.text.slice(0, 120));
    A('  sync used Basic ck:cs auth', wcAuthSeen === 'Basic ' + Buffer.from('ck_live_1:cs_live_1').toString('base64'), 'auth=' + wcAuthSeen);
    A('  sync maps order count from X-WP-Total (42)', sy.json && sy.json.orders === 42, JSON.stringify(sy.json));

    A('disconnect A 200', (await http.post('/api/woocommerce/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, A not connected', ((await http.get('/api/woocommerce/status?entity_id=' + eidA)).json || {}).connected === false);
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (WooCommerce connector)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
