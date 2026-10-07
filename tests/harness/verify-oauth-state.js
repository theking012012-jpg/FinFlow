'use strict';
/**
 * verify-oauth-state.js — N43. Every OAuth callback only completes a flow THIS browser session started.
 *
 * Defect: state was String(scopeId(req)) — the account id, static and guessable — and no callback read
 * it. An attacker authorizes THEIR QuickBooks/Stripe/payroll account, then sends the victim's browser to
 * /api/<provider>/callback?code=<attacker code> (GET, sameSite=lax cookie rides along). The victim's
 * books were linked to the attacker's provider account.
 *
 * Executed against the real server + Postgres; provider token endpoints mocked at the fetch boundary.
 * Covers all three OAuth implementations: the shared driver (QuickBooks), Stripe Connect, Finch.
 * Discriminating checks (Rule 4), bug value stated:
 *   callback with no flow started                         → not linked  (bug: linked to attacker realm)
 *   callback with state = the account id (old format)     → not linked  (bug: linked)
 *   flow started, callback carries a different state      → not linked  (bug: linked)
 *   flow started, callback with the issued state          → linked      (control)
 *   same state replayed                                   → refused     (bug: accepted again)
 *   flow started on entity A, callback lands with B active → stored on A (bug: stored on B)
 *   Finch: no flow → not linked; customer_id ≠ account → not linked (bug: linked); matching → linked
 *   node -r ./tests/harness/clock.js tests/harness/verify-oauth-state.js
 */
process.env.QBO_CLIENT_ID = 'qbo_client_id';
process.env.QBO_CLIENT_SECRET = 'qbo_client_secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.HARNESS_KEEP_STRIPE = '1';   // keep the key past boot.js's scrub; outbound fetch is still mocked/blocked
process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_harness';
process.env.FINCH_CLIENT_ID = 'finch_id';
process.env.FINCH_CLIENT_SECRET = 'finch_secret';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'oauthstate@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  let finchCustomer = null;
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const base = server.baseUrl;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith(base)) return realFetch(url, opts);
      if (u === 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer') return { ok: true, status: 200, json: async () => ({ access_token: 'AT-qbo', refresh_token: 'RT', expires_in: 3600 }) };
      if (u === 'https://connect.stripe.com/oauth/token') return { ok: true, status: 200, json: async () => ({ stripe_user_id: 'acct_ATTACKER', access_token: 'sk_conn' }) };
      if (u === 'https://api.tryfinch.com/connect/sessions') return { ok: true, status: 200, json: async () => ({ connect_url: 'https://connect.tryfinch.com/authorize?session=s1' }) };
      if (u === 'https://api.tryfinch.com/auth/token') return { ok: true, status: 200, json: async () => ({ access_token: 'AT-finch', customer_id: finchCustomer }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: OWNER.email, plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const http = new HarnessHttp(base);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);
    const linked = async (key, eid) => (await c.query(`SELECT data->>'value' v FROM user_settings WHERE user_id=$1 AND data->>'key'=$2 AND entity_id=$3`, [uid, key, eid])).rows
      .map(r => r.v).filter(v => v && v !== '{}').length;
    const clear = async () => c.query(`DELETE FROM user_settings WHERE user_id=$1 AND data->>'key' IN ('quickbooks_conn','stripe_conn','finch_conn')`, [uid]);
    const stateOf = (u) => new URL(u).searchParams.get('state');

    console.log('\n' + '='.repeat(78));
    console.log('  OAUTH STATE — a callback only completes a flow this session started');
    console.log('='.repeat(78));

    for (const p of [
      { key: 'quickbooks', blob: 'quickbooks_conn', cb: (st) => `/api/quickbooks/callback?entity_id=${eA}&code=ATTACKER&realmId=REALM_ATTACKER` + (st != null ? '&state=' + st : '') },
      { key: 'stripe', blob: 'stripe_conn', cb: (st) => `/api/stripe/callback?entity_id=${eA}&code=ATTACKER` + (st != null ? '&state=' + st : '') },
    ]) {
      console.log('\n  — ' + p.key);
      await clear();
      await http.get(p.cb(null));
      A(`${p.key}: callback with no flow started → not linked (bug: linked)`, (await linked(p.blob, eA)) === 0);
      await http.get(p.cb(String(uid)));
      A(`${p.key}: state = account id (old guessable format) → not linked (bug: linked)`, (await linked(p.blob, eA)) === 0);

      const cu = await http.post(`/api/${p.key}/connect-url?entity_id=${eA}`, {});
      const st = stateOf(cu.json.connect_url);
      A(`${p.key}: issued state is a random nonce, not the account id`, st && st !== String(uid) && st.length >= 32, 'state=' + st);
      await http.get(p.cb(String(uid)));
      A(`${p.key}: flow started, wrong state → not linked (bug: linked)`, (await linked(p.blob, eA)) === 0);

      const cu2 = await http.post(`/api/${p.key}/connect-url?entity_id=${eA}`, {});
      const st2 = stateOf(cu2.json.connect_url);
      const ok = await http.get(p.cb(st2));
      A(`${p.key}: control — issued state → linked`, (await linked(p.blob, eA)) === 1 && /connected/.test(ok.text), ok.text.slice(0, 140));
      await clear();
      const rp = await http.get(p.cb(st2));
      A(`${p.key}: replayed state → refused (bug: accepted)`, (await linked(p.blob, eA)) === 0 && /not started from this session/.test(rp.text), rp.text.slice(0, 140));

      const cu3 = await http.post(`/api/${p.key}/connect-url?entity_id=${eA}`, {});
      await http.get(p.cb(stateOf(cu3.json.connect_url)).replace('entity_id=' + eA, 'entity_id=' + eB));
      A(`${p.key}: started on A, callback with B active → stored on A (bug: on B)`, (await linked(p.blob, eA)) === 1 && (await linked(p.blob, eB)) === 0,
        `A=${await linked(p.blob, eA)} B=${await linked(p.blob, eB)}`);
    }

    console.log('\n  — finch (redirect does not echo state)');
    await clear();
    finchCustomer = String(uid);
    await http.get(`/api/finch/callback?entity_id=${eA}&code=ATTACKER`);
    A('finch: callback with no flow started → not linked (bug: linked)', (await linked('finch_conn', eA)) === 0);
    await http.post(`/api/finch/connect-url?entity_id=${eA}`, {});
    finchCustomer = '999999';
    await http.get(`/api/finch/callback?entity_id=${eA}&code=ATTACKER`);
    A('finch: token customer_id ≠ this account → not linked (bug: linked)', (await linked('finch_conn', eA)) === 0);
    await http.post(`/api/finch/connect-url?entity_id=${eA}`, {});
    finchCustomer = String(uid);
    const fok = await http.get(`/api/finch/callback?entity_id=${eA}&code=GOOD`);
    A('finch: control — flow started, customer matches → linked', (await linked('finch_conn', eA)) === 1, fok.text.slice(0, 140));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (OAuth state)` : `  ALL GREEN — ${pass} passed, 0 failed  (OAuth state)`);
  console.log('-'.repeat(78));
  process.exitCode = fail === 0 ? 0 : 1;
})();
