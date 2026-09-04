'use strict';
/**
 * verify-stripe-feed.js — the dashboard "Stripe live feed" must show the connected account's real
 * charges. Previously startStripeFeed() was a STUB that only printed "Connect Stripe to see live
 * payment transactions", and there was NO endpoint listing charges. This verifies GET /api/stripe/feed
 * reads charges via the Connect account header and maps them, plus honest not-connected state.
 *
 * EXECUTED against real Postgres + the real endpoint, with the Stripe HTTP boundary mocked (like
 * verify-email-resend). Discriminating: without the endpoint the route 404s; the stub never fetched.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-stripe-feed.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || 'ca_harness';
require('./clock.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'stripefeed-owner@finflow.test', password: 'harness-password-not-a-secret' };
const OWNER2 = { email: 'stripefeed-noconn@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const AS = (n, ok, d) => A('[STRUCTURAL] ' + n, ok, d);
  const realFetch = global.fetch;
  let stripeAccountSeen = null, stripeAuthSeen = null, stripeUrlSeen = null;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    // Mock ONLY the Stripe charges HTTP boundary; everything else passes through.
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://api.stripe.com/v1/charges')) {
        stripeUrlSeen = String(url);
        stripeAccountSeen = opts && opts.headers && opts.headers['Stripe-Account'];
        stripeAuthSeen = opts && opts.headers && opts.headers['Authorization'];
        return { ok: true, status: 200, json: async () => ({ object: 'list', data: [
          { id: 'ch_1', amount: 5000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Order #1001', billing_details: { email: 'a@b.com' }, created: 1753449600, livemode: false },
          { id: 'ch_2', amount: 2500, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Order #1002', created: 1753363200, livemode: false },
          { id: 'ch_3', amount: 9900, currency: 'usd', status: 'failed', paid: false, created: 1753276800, livemode: false },
        ] }) };
      }
      return realFetch(url, opts);
    };

    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'SF Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    // Seed a connected Stripe account blob (shape _providerBlob reads: user_settings.data = {key, value}).
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_test123', linked_at: '2026-07-01T00:00:00Z' }) }]);
    // A second owner with NO connection.
    await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER2.email, name: 'NoConn', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER2.password, 10) }]);

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const r = await http.get('/api/stripe/feed');
    A('GET /api/stripe/feed exists (not 404 — the stub had no endpoint)', r.status === 200, `status=${r.status}`);
    const d = r.json || {};
    A('connected:true for the linked account', d.connected === true, JSON.stringify(d).slice(0,160));
    A('endpoint scoped the request to the CONNECT account (Stripe-Account header)', stripeAccountSeen === 'acct_test123', `seen=${stripeAccountSeen}`);
    A('endpoint authorized with the secret key', /^Bearer sk_/.test(String(stripeAuthSeen || '')), `auth=${stripeAuthSeen}`);
    A('3 charges mapped', Array.isArray(d.charges) && d.charges.length === 3, `n=${d.charges && d.charges.length}`);
    A('amounts converted from cents (5000→50.00)', d.charges && d.charges[0].amount === 50 && d.charges[1].amount === 25, JSON.stringify(d.charges && d.charges.map(x=>x.amount)));
    A('currency upper-cased (USD)', d.charges && d.charges[0].currency === 'USD');
    A('total = sum of SUCCEEDED only (50+25=75, failed excluded)', d.total === 75, `total=${d.total}`);
    A('livemode surfaced (false = test mode)', d.livemode === false, `livemode=${d.livemode}`);
    A('description + email carried through', d.charges && d.charges[0].description === 'Order #1001' && d.charges[0].email === 'a@b.com');

    // Not-connected owner → honest empty state, NOT a fabricated feed.
    const http2 = new HarnessHttp(server.baseUrl);
    await http2.post('/api/auth/login', OWNER2);
    const r2 = await http2.get('/api/stripe/feed');
    A('unconnected account → connected:false, empty charges (honest)', r2.json && r2.json.connected === false && (r2.json.charges || []).length === 0, JSON.stringify(r2.json).slice(0,160));

    // STRUCTURAL — client startStripeFeed now fetches the endpoint (no longer a stub).
    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    const fn = (html.match(/function startStripeFeed\(\)\{[\s\S]*?\n\}/) || [''])[0];
    AS('startStripeFeed fetches /api/stripe/feed', /fetch\('\/api\/stripe\/feed/.test(fn));
    AS('startStripeFeed renders charges (not just the connect stub)', /d\.charges/.test(fn) && /connected/.test(fn));
    AS('honest not-connected branch preserved', /Connect Stripe to see live payment transactions/.test(fn));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (Stripe live feed)`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
