#!/usr/bin/env node
'use strict';
/**
 * verify-finch-codat-linking.js — the Finch (payroll) + Codat (accounting) aggregator surfaces,
 * env-gated, run with NO provider keys. Verifies what's reachable without a provider account:
 *   - env gate: connect-url / link-url / sync return a clean 502 (*_NOT_CONFIGURED), never a fake link
 *   - RBAC discriminates by capability:
 *       Finch  = payroll:write (owner + admin only; accountant & viewer DENIED)
 *       Codat  = books:write   (owner + admin + accountant; viewer DENIED)
 *     owner passes the gate and only then hits the 502 env wall (proves RBAC, not the gate)
 *   - status endpoints: {configured:false, connected:false}; unauth → 401
 *   - disconnect validation without keys (local op): 404 when nothing linked
 *
 * Live handshakes (Finch Connect / Codat Link with real keys) are UNEXECUTED — need provider
 * accounts (Rule 14 — labelled). Token-at-rest crypto is already covered by verify-plaid-linking.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-finch-codat-linking.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  for (const k of ['FINCH_CLIENT_ID', 'FINCH_CLIENT_SECRET', 'CODAT_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_CONNECT_CLIENT_ID', 'BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD']) delete process.env[k];
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    const mkUser = async (email) => (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;

    const ownerId = await mkUser('fc-owner@finflow.test');
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerId, { name: 'FC Co', currency: 'USD', is_active: 1 }]);
    const members = {};
    for (const role of ['viewer', 'accountant']) {
      const uid = await mkUser(`fc-${role}@finflow.test`);
      await c.query(`INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
        [ownerId, { member_user_id: String(uid), status: 'active', role, name: role, email: `fc-${role}@finflow.test` }]);
      members[role] = uid;
    }
    const login = async (email) => { const h = new HarnessHttp(server.baseUrl); const r = await h.post('/api/auth/login', { email, password: PW }); if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`); return h; };

    console.log('\n' + '='.repeat(78));
    console.log('  FINCH (payroll) + CODAT (accounting) — env gate + RBAC (no keys set)');
    console.log('='.repeat(78));

    A('finchConfigured() false', app.finchConfigured() === false);
    A('codatConfigured() false', app.codatConfigured() === false);
    A('stripeConnectConfigured() false', app.stripeConnectConfigured() === false);

    // ── unauth ──
    const anon = new HarnessHttp(server.baseUrl);
    A('unauth finch/status → 401', (await anon.get('/api/finch/status')).status === 401);
    A('unauth codat/status → 401', (await anon.get('/api/codat/status')).status === 401);

    // ── owner: passes RBAC, hits env gate ──
    const owner = await login('fc-owner@finflow.test');
    const fs = await owner.get('/api/finch/status');
    A('owner finch/status 200 {configured:false,connected:false}', fs.status === 200 && fs.json.configured === false && fs.json.connected === false, JSON.stringify(fs.json));
    const cs = await owner.get('/api/codat/status');
    A('owner codat/status 200 {configured:false,connected:false}', cs.status === 200 && cs.json.configured === false && cs.json.connected === false, JSON.stringify(cs.json));
    const fcu = await owner.post('/api/finch/connect-url', {});
    A('owner finch/connect-url → 502 FINCH_NOT_CONFIGURED (passed RBAC)', fcu.status === 502 && fcu.json.code === 'FINCH_NOT_CONFIGURED', `status ${fcu.status}: ${fcu.text.slice(0,100)}`);
    A('owner finch/sync → 502', (await owner.post('/api/finch/sync', {})).status === 502);
    const clu = await owner.post('/api/codat/link-url', {});
    A('owner codat/link-url → 502 CODAT_NOT_CONFIGURED (passed RBAC)', clu.status === 502 && clu.json.code === 'CODAT_NOT_CONFIGURED', `status ${clu.status}: ${clu.text.slice(0,100)}`);
    A('owner finch/disconnect (nothing linked) → 404', (await owner.post('/api/finch/disconnect', {})).status === 404);
    A('owner codat/disconnect (nothing linked) → 404', (await owner.post('/api/codat/disconnect', {})).status === 404);
    A('owner /api/finch/callback (no code) → 200 HTML (safe close)', (await owner.get('/api/finch/callback')).status === 200);

    // ── viewer: denied everything (read-only) ──
    const viewer = await login('fc-viewer@finflow.test');
    A('viewer finch/connect-url → 403', (await viewer.post('/api/finch/connect-url', {})).status === 403);
    A('viewer codat/link-url → 403', (await viewer.post('/api/codat/link-url', {})).status === 403);
    A('viewer finch/status → 200 (read allowed)', (await viewer.get('/api/finch/status')).status === 200);

    // ── accountant: Codat allowed (books:write), Finch denied (payroll:write) — the discriminator ──
    const acct = await login('fc-accountant@finflow.test');
    A('accountant finch/connect-url → 403 (payroll:write excludes accountant)', (await acct.post('/api/finch/connect-url', {})).status === 403);
    const acl = await acct.post('/api/codat/link-url', {});
    A('accountant codat/link-url → 502, NOT 403 (books:write includes accountant)', acl.status === 502, `status ${acl.status}`);
    A('owner codat/sync → 502 CODAT_NOT_CONFIGURED (parity sync exists)', (await owner.post('/api/codat/sync', {})).status === 502);
    A('accountant codat/sync → 502 not 403 (books:write)', (await acct.post('/api/codat/sync', {})).status === 502);
    A('viewer codat/sync → 403', (await viewer.post('/api/codat/sync', {})).status === 403);

    // ── Stripe Connect (bank:manage = owner-only, like Plaid) ──
    console.log('\n-- Stripe Connect (owner-only) --');
    A('unauth stripe/status → 401', (await anon.get('/api/stripe/status')).status === 401);
    const ss = await owner.get('/api/stripe/status');
    A('owner stripe/status 200 {configured:false,connected:false}', ss.status === 200 && ss.json.configured === false && ss.json.connected === false, JSON.stringify(ss.json));
    const scu = await owner.post('/api/stripe/connect-url', {});
    A('owner stripe/connect-url → 502 STRIPE_NOT_CONFIGURED (passed RBAC)', scu.status === 502 && scu.json.code === 'STRIPE_NOT_CONFIGURED', `status ${scu.status}: ${scu.text.slice(0,100)}`);
    A('owner stripe/callback (no code) → 200 HTML', (await owner.get('/api/stripe/callback')).status === 200);
    A('owner stripe/disconnect (nothing linked) → 404', (await owner.post('/api/stripe/disconnect', {})).status === 404);
    A('viewer stripe/connect-url → 403 (bank:manage owner-only)', (await viewer.post('/api/stripe/connect-url', {})).status === 403);
    A('accountant stripe/connect-url → 403 (bank:manage owner-only)', (await acct.post('/api/stripe/connect-url', {})).status === 403);

    // ── Belvo (LatAm banking, env-gated, owner-only bank:manage) ──
    console.log('\n-- Belvo (LatAm banking, owner-only) --');
    A('belvoConfigured() false', app.belvoConfigured() === false);
    const bs = await owner.get('/api/belvo/status');
    A('owner belvo/status 200 {configured:false,connected:false}', bs.status === 200 && bs.json.configured === false && bs.json.connected === false, JSON.stringify(bs.json));
    const bwt = await owner.post('/api/belvo/widget-token', {});
    A('owner belvo/widget-token → 502 BELVO_NOT_CONFIGURED (passed RBAC)', bwt.status === 502 && bwt.json.code === 'BELVO_NOT_CONFIGURED', `status ${bwt.status}`);
    A('owner belvo/sync → 502', (await owner.post('/api/belvo/sync', {})).status === 502);
    A('owner belvo/disconnect (nothing linked) → 404', (await owner.post('/api/belvo/disconnect', {})).status === 404);
    A('viewer belvo/widget-token → 403', (await viewer.post('/api/belvo/widget-token', {})).status === 403);
    A('accountant belvo/widget-token → 403 (bank:manage owner-only)', (await acct.post('/api/belvo/widget-token', {})).status === 403);

    // ── WiPay (Caribbean payments) — credentials model, NO env gate: full connect cycle verifiable ──
    console.log('\n-- WiPay (Caribbean payments, owner-only, credentials) --');
    A('unauth wipay/status → 401', (await anon.get('/api/wipay/status')).status === 401);
    A('owner wipay/status → 200 not connected', (await owner.get('/api/wipay/status')).json.connected === false);
    A('owner wipay/connect (missing fields) → 400', (await owner.post('/api/wipay/connect', { account_number: '123' })).status === 400);
    A('owner wipay/connect (bad country) → 400', (await owner.post('/api/wipay/connect', { account_number: '123', api_key: 'k', country: 'US' })).status === 400);
    const wc = await owner.post('/api/wipay/connect', { account_number: '1002345', api_key: 'secret-wipay-key', country: 'TT' });
    A('owner wipay/connect (valid) → 201', wc.status === 201 && wc.json.account === '1002345' && wc.json.country === 'TT', `status ${wc.status}: ${wc.text.slice(0,80)}`);
    const wst = await owner.get('/api/wipay/status');
    A('owner wipay/status now connected (account echoed, KEY NOT returned)', wst.json.connected === true && wst.json.account === '1002345' && !JSON.stringify(wst.json).includes('secret-wipay-key'), JSON.stringify(wst.json));
    // the api_key must be stored ENCRYPTED, never as plaintext
    const raw = (await c.query(`SELECT data->>'value' AS value FROM user_settings WHERE user_id=$1 AND data->>'key'='wipay_conn' LIMIT 1`, [ownerId])).rows[0];
    A('WiPay api_key is encrypted at rest (not plaintext in DB)', raw && !String(raw.value).includes('secret-wipay-key'), `stored=${raw ? String(raw.value).slice(0,90) : 'none'}`);
    A('viewer wipay/connect → 403 (bank:manage owner-only)', (await viewer.post('/api/wipay/connect', { account_number: '1', api_key: 'k', country: 'TT' })).status === 403);
    A('owner wipay/disconnect → 200', (await owner.post('/api/wipay/disconnect', {})).status === 200);
    A('owner wipay/status after disconnect → not connected', (await owner.get('/api/wipay/status')).json.connected === false);

    // ── Generic credential connectors: dLocal / Mercado Pago / Wise. (Paystack + Flutterwave were
    //    removed in the regional cleanup — Africa rails, out of the Americas/Caribbean/Europe scope.) ──
    console.log('\n-- generic credential connectors (LatAm + Wise) --');
    const CRED = {
      dlocal:      { fields: ['x_login', 'x_trans_key', 'secret_key'], secret: 'dlocal-secret-xyz' },
      mercadopago: { fields: ['access_token'], secret: 'mp-access-token-xyz' },
      wise:        { fields: ['api_token'], secret: 'wise-token-xyz' },
    };
    for (const [k, spec] of Object.entries(CRED)) {
      A(`${k}: unauth status → 401`, (await anon.get(`/api/${k}/status`)).status === 401);
      A(`${k}: owner status not connected`, (await owner.get(`/api/${k}/status`)).json.connected === false);
      A(`${k}: connect missing fields → 400`, (await owner.post(`/api/${k}/connect`, {})).status === 400);
      const body = {}; spec.fields.forEach((f, i) => { body[f] = (i === spec.fields.length - 1) ? spec.secret : (f + '-val'); });
      const con = await owner.post(`/api/${k}/connect`, body);
      A(`${k}: owner connect (valid) → 201`, con.status === 201, `status ${con.status}: ${con.text.slice(0,80)}`);
      const st = await owner.get(`/api/${k}/status`);
      A(`${k}: status connected, no secret leaked in response`, st.json.connected === true && !JSON.stringify(st.json).includes(spec.secret), JSON.stringify(st.json));
      const dbrow = (await c.query(`SELECT data->>'value' AS value FROM user_settings WHERE user_id=$1 AND data->>'key'=$2 LIMIT 1`, [ownerId, k + '_conn'])).rows[0];
      A(`${k}: credential encrypted at rest (not plaintext in DB)`, dbrow && !String(dbrow.value).includes(spec.secret), `stored=${dbrow ? String(dbrow.value).slice(0,70) : 'none'}`);
      A(`${k}: viewer connect → 403 (bank:manage owner-only)`, (await viewer.post(`/api/${k}/connect`, body)).status === 403);
      A(`${k}: owner disconnect → 200`, (await owner.post(`/api/${k}/disconnect`, {})).status === 200);
    }

    // ── Wise parity sync (display-only balances; owner-only) ──
    console.log('\n-- Wise balance sync (parity) --');
    await owner.post('/api/wise/connect', { api_token: 'wise-token-xyz' });
    const ws = await owner.post('/api/wise/sync', {});
    A('owner wise/sync (connected; live Wise call blocked) → 502', ws.status === 502, `status ${ws.status}`);
    A('viewer wise/sync → 403 (bank:manage owner-only)', (await viewer.post('/api/wise/sync', {})).status === 403);
    await owner.post('/api/wise/disconnect', {});
    A('owner wise/sync after disconnect → 400 (not connected)', (await owner.post('/api/wise/sync', {})).status === 400);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (finch + codat — env-gated paths)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  NOTE: live Finch/Codat handshakes are UNEXECUTED here — need provider accounts.');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[finch-codat] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
