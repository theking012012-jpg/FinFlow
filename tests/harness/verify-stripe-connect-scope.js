'use strict';
/**
 * verify-stripe-connect-scope.js — N48. Stripe Connect asks the user for READ-ONLY access.
 *
 * Defect: the authorize URL requested scope=read_write, so every linked account handed FinFlow a token
 * that could create charges, refunds and payouts on the user's Stripe — though FinFlow only reads
 * (balance, charges, payouts for display/import). A leaked token was a write credential.
 *
 * Executed: the real /api/stripe/connect-url response, and every connected-account request the import
 * paths make is recorded at the fetch boundary.
 *   connect_url scope = read_only                     (bug: read_write)
 *   sync / feed / payouts / import-charge issue GET only (control — read_only is sufficient)
 *   node -r ./tests/harness/clock.js tests/harness/verify-stripe-connect-scope.js
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_harness';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'scscope@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  const calls = [];
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const base = server.baseUrl;
    const charge = { id: 'ch_1', amount: 2500, currency: 'usd', created: 1784000000, status: 'succeeded', paid: true, refunded: false, amount_refunded: 0,
      billing_details: { name: 'Cust' }, balance_transaction: { fee: 100, net: 2400, currency: 'usd' } };
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith(base)) return realFetch(url, opts);
      if (u.startsWith('https://api.stripe.com/')) calls.push(((opts && opts.method) || 'GET') + ' ' + u.replace(/\?.*/, ''));
      if (u === 'https://connect.stripe.com/oauth/token') return { ok: true, status: 200, json: async () => ({ stripe_user_id: 'acct_1', access_token: 'sk_conn' }) };
      if (u.startsWith('https://api.stripe.com/v1/balance')) return { ok: true, status: 200, json: async () => ({ available: [{ amount: 1000, currency: 'usd' }], pending: [] }) };
      if (u.startsWith('https://api.stripe.com/v1/charges/')) return { ok: true, status: 200, json: async () => charge };
      if (u.startsWith('https://api.stripe.com/v1/charges')) return { ok: true, status: 200, json: async () => ({ data: [charge] }) };
      if (u.startsWith('https://api.stripe.com/v1/payouts')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: OWNER.email, plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Scope Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const http = new HarnessHttp(base);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  STRIPE CONNECT — read-only access requested');
    console.log('='.repeat(78));
    const cu = await http.post('/api/stripe/connect-url?entity_id=' + eid, {});
    const scope = cu.json && cu.json.connect_url && new URL(cu.json.connect_url).searchParams.get('scope');
    A('connect_url scope = read_only (bug: read_write)', scope === 'read_only', 'scope=' + scope);

    const st = new URL(cu.json.connect_url).searchParams.get('state');
    A('link completes', /connected/.test((await http.get('/api/stripe/callback?entity_id=' + eid + '&code=c&state=' + st)).text));
    calls.length = 0;
    const r = [
      await http.post('/api/stripe/sync?entity_id=' + eid, {}),
      await http.get('/api/stripe/feed?entity_id=' + eid),
      await http.get('/api/stripe/payouts?entity_id=' + eid),
      await http.post('/api/stripe/import-charge?entity_id=' + eid, { charge_id: 'ch_1' }),
    ];
    A('sync / feed / payouts / import-charge respond (no 5xx)', r.every(x => x.status < 500), r.map(x => x.status).join(','));
    A('control: they reached Stripe', calls.length >= 4, JSON.stringify(calls));
    A('control: every connected-account request is a GET (read_only suffices)', calls.every(x => x.startsWith('GET ')), JSON.stringify(calls));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (Stripe Connect scope)` : `  ALL GREEN — ${pass} passed, 0 failed  (Stripe Connect scope)`);
  console.log('-'.repeat(78));
  process.exitCode = fail === 0 ? 0 : 1;
})();
