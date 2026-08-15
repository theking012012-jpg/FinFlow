#!/usr/bin/env node
'use strict';
/**
 * verify-requests-paylinks.js —
 *  (1) Integration REQUESTS: the catalogue's unbuilt logos record real, deduped demand; owners/admins
 *      see the cross-account aggregate; viewers can't.
 *  (2) Invoice PAYMENT LINKS: generate a hosted link via a connected processor — verifies every path
 *      reachable without live provider keys (404 / no-provider 400 / RBAC), and that provider SELECTION
 *      is reached once a processor is connected (the live provider HTTP call itself is UNEXECUTED —
 *      needs real merchant keys; Rule 14).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-requests-paylinks.js
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
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const mkUser = async (email) => (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;
    const ownerAId = await mkUser('rq-ownerA@finflow.test');
    const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [ownerAId, { name: 'RQ Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const ownerBId = await mkUser('rq-ownerB@finflow.test');
    const viewerId = await mkUser('rq-viewer@finflow.test');
    await c.query(`INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerAId, { member_user_id: String(viewerId), status: 'active', role: 'viewer', name: 'V', email: 'rq-viewer@finflow.test' }]);
    const login = async (email) => { const h = new HarnessHttp(server.baseUrl); if ((await h.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + email); return h; };

    console.log('\n' + '='.repeat(78));
    console.log('  INTEGRATION REQUESTS + INVOICE PAYMENT LINKS');
    console.log('='.repeat(78));

    const anon = new HarnessHttp(server.baseUrl);
    const A_ = await login('rq-ownerA@finflow.test');
    const B_ = await login('rq-ownerB@finflow.test');
    const V_ = await login('rq-viewer@finflow.test');

    // ── requests ──
    console.log('\n-- integration requests --');
    A('unauth request → 401', (await anon.post('/api/integration-requests', { name: 'QuickBooks' })).status === 401);
    A('request with no name → 400', (await A_.post('/api/integration-requests', {})).status === 400);
    const r1 = await A_.post('/api/integration-requests', { name: 'QuickBooks' });
    A('ownerA requests QuickBooks → 201 requested:true', r1.status === 201 && r1.json.requested === true, JSON.stringify(r1.json));
    const r2 = await A_.post('/api/integration-requests', { name: 'QuickBooks' });
    A('ownerA re-requests QuickBooks → 200 requested:false (deduped)', r2.status === 200 && r2.json.requested === false, JSON.stringify(r2.json));
    await A_.post('/api/integration-requests', { name: 'Xero' });
    await B_.post('/api/integration-requests', { name: 'QuickBooks' });   // a different account also wants it
    const agg = await A_.get('/api/integration-requests');
    A('owner GET aggregate → 200', agg.status === 200 && Array.isArray(agg.json.requests));
    const qb = (agg.json.requests || []).find(x => x.name === 'QuickBooks');
    const xe = (agg.json.requests || []).find(x => x.name === 'Xero');
    A('QuickBooks aggregated across 2 accounts → requests=2', qb && qb.requests === 2, JSON.stringify(qb));
    A('Xero → requests=1', xe && xe.requests === 1, JSON.stringify(xe));
    A('aggregate sorted by demand (QuickBooks first)', (agg.json.requests[0] || {}).name === 'QuickBooks', JSON.stringify(agg.json.requests));
    A('viewer GET aggregate → 403 (audit:read owner/admin only)', (await V_.get('/api/integration-requests')).status === 403);

    // ── invoice payment links ──
    console.log('\n-- invoice payment links --');
    const invId = (await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [ownerAId, eid, { client: 'Cust', amount: 500, currency: 'USD', status: 'pending', issue_date: '2026-07-10' }])).rows[0].id;
    A('unknown invoice → 404', (await A_.post('/api/invoices/999999/payment-link', {})).status === 404);
    const noProv = await A_.post('/api/invoices/' + invId + '/payment-link', {});
    A('no processor connected → 400 NO_PAYMENT_PROVIDER', noProv.status === 400 && noProv.json.code === 'NO_PAYMENT_PROVIDER', `status ${noProv.status}: ${noProv.text.slice(0,90)}`);
    A('viewer payment-link → 403 (books:write excludes viewer)', (await V_.post('/api/invoices/' + invId + '/payment-link', {})).status === 403);
    // connect a processor (fake key) → provider SELECTION is now reached; the live call fails
    // (bad key / blocked host) so it returns 502 with the selected provider — proving dispatch.
    await A_.post('/api/paystack/connect', { secret_key: 'sk_test_fake' });
    const withProv = await A_.post('/api/invoices/' + invId + '/payment-link', { provider: 'paystack' });
    A('with Paystack connected → provider SELECTED (not 400); live call unexecuted → 502', withProv.status === 502 && withProv.json.provider === 'paystack', `status ${withProv.status}: ${withProv.text.slice(0,90)}`);
    // Mercado Pago + dLocal builders exist now (parity): provider selected → dispatch reached (502, live blocked).
    await A_.post('/api/mercadopago/connect', { access_token: 'mp-token' });
    const mp = await A_.post('/api/invoices/' + invId + '/payment-link', { provider: 'mercadopago' });
    A('Mercado Pago builder reached (502, live blocked — not "unsupported")', mp.status === 502 && mp.json.provider === 'mercadopago' && !/not supported/i.test(mp.text), `status ${mp.status}: ${mp.text.slice(0,90)}`);
    await A_.post('/api/dlocal/connect', { x_login: 'l', x_trans_key: 't', secret_key: 's' });
    const dl = await A_.post('/api/invoices/' + invId + '/payment-link', { provider: 'dlocal', country: 'BR' });
    A('dLocal builder reached (502, live blocked — not "unsupported")', dl.status === 502 && dl.json.provider === 'dlocal' && !/not supported/i.test(dl.text), `status ${dl.status}: ${dl.text.slice(0,90)}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (requests + payment links)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  NOTE: a SUCCESSFUL provider payment-link response is UNEXECUTED (needs real keys).');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[rq] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
