'use strict';
/**
 * verify-oauth-token-host.js — N55. The OAuth token exchange sends the platform client SECRET to the
 * token host. For providers whose token host comes from the callback query string (Zoho's
 * accounts-server, Shopify's shop), that host is attacker-controllable: any logged-in user could open
 * /api/zohobooks/callback?code=x&accounts-server=https://their-host and receive ZOHO_CLIENT_SECRET.
 *
 * Executed against the real server (fetch boundary recorded — every outbound URL + body the server
 * attempts). Discriminating checks (Rule 4), bug value stated:
 *   accounts-server = loopback host            → no request carries the secret  (bug: POST to 127.0.0.1 with client_secret)
 *   accounts-server = accounts.zoho.com.evil.test (suffix trick) → refused       (bug: secret POSTed there)
 *   accounts-server = accounts.zoho.eu.attacker  → refused                      (bug: secret POSTed there)
 *   Shopify shop = evil.example.com             → no token request at all       (bug: secret POSTed to invalid.example)
 *   refused callbacks store no connection                                       (control)
 *   accounts-server = accounts.zoho.eu          → exchange hits the EU host      (control: real DCs still work)
 *   node -r ./tests/harness/clock.js tests/harness/verify-oauth-token-host.js
 */
process.env.ZOHO_CLIENT_ID = 'zoho_client_id';
process.env.ZOHO_CLIENT_SECRET = 'ZOHO-SECRET-must-not-leak';
process.env.SHOPIFY_API_KEY = 'shopify_key';
process.env.SHOPIFY_API_SECRET = 'SHOPIFY-SECRET-must-not-leak';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'tokhost@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  const seen = [];
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const base = server.baseUrl;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith(base)) return realFetch(url, opts);   // the harness's own HTTP client
      seen.push({ url: u, body: String((opts && opts.body) || '') });
      if (u === 'https://accounts.zoho.eu/oauth/v2/token') return { ok: true, status: 200, json: async () => ({ access_token: 'AT-eu', refresh_token: 'RT-eu', expires_in: 3600 }) };
      if (u === 'https://www.zohoapis.eu/books/v3/organizations') return { ok: true, status: 200, json: async () => ({ organizations: [{ organization_id: 'ORG_EU' }] }) };
      // Any other host: pretend it answered like a token endpoint (this is what an attacker host would do).
      return { ok: true, status: 200, json: async () => ({ access_token: 'AT-attacker' }) };
    };
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: OWNER.email, plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Host Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const http = new HarnessHttp(base);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);
    const leaked = (secret) => seen.filter(s => s.body.includes(secret)).map(s => s.url);
    const conn = async (key) => (await c.query(`SELECT data->>'value' v FROM user_settings WHERE user_id=$1 AND data->>'key'=$2`, [uid, key])).rows.map(r => r.v).filter(v => v && v !== '{}');

    console.log('\n' + '='.repeat(78));
    console.log('  OAUTH TOKEN HOST — the client secret only goes to the provider\'s own hosts');
    console.log('='.repeat(78));

    for (const [label, srv] of [
      ['loopback host', 'http://127.0.0.1:9'],
      ['suffix trick accounts.zoho.com.evil.test', 'https://accounts.zoho.com.evil.test'],
      ['unknown DC accounts.zoho.eu.attacker', 'https://accounts.zoho.eu.attacker'],
      ['plain http on a real DC name', 'http://accounts.zoho.eu'],
    ]) {
      seen.length = 0;
      const r = await http.get('/api/zohobooks/callback?entity_id=' + eid + '&code=x&accounts-server=' + encodeURIComponent(srv));
      A(`Zoho ${label}: secret sent nowhere (bug: POSTed to ${srv})`, leaked('ZOHO-SECRET').length === 0, 'leaked to ' + JSON.stringify(leaked('ZOHO-SECRET')));
      A(`  page reports the refusal`, r.status === 200 && /Could not link Zoho Books/.test(r.text), r.text.slice(0, 160));
    }
    A('no Zoho connection stored from a refused callback (bug: attacker token stored)', (await conn('zohobooks_conn')).length === 0, JSON.stringify(await conn('zohobooks_conn')));

    seen.length = 0;
    await http.get('/api/shopify/callback?entity_id=' + eid + '&shop=evil.example.com&code=x');
    A('Shopify invalid shop: no token request at all (bug: secret POSTed to invalid.example)', leaked('SHOPIFY-SECRET').length === 0 && seen.length === 0, JSON.stringify(seen.map(s => s.url)));

    seen.length = 0;
    const ok = await http.get('/api/zohobooks/callback?entity_id=' + eid + '&code=good&accounts-server=' + encodeURIComponent('https://accounts.zoho.eu'));
    A('control: real EU data center → exchange hits accounts.zoho.eu', seen.some(s => s.url === 'https://accounts.zoho.eu/oauth/v2/token'), JSON.stringify(seen.map(s => s.url)));
    A('control: EU connection stored, page says connected', /connected/.test(ok.text) && (await conn('zohobooks_conn')).length === 1, ok.text.slice(0, 160));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (OAuth token host)` : `  ALL GREEN — ${pass} passed, 0 failed  (OAuth token host)`);
  console.log('-'.repeat(78));
  process.exitCode = fail === 0 ? 0 : 1;
})();
