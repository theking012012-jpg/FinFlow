#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-kyc.js — Stripe Identity (KYC / IDV), Phase B.
 *
 * The accountant does a hosted Stripe Identity check; the result arrives async as
 * identity.verification_session.* on the PLATFORM Stripe webhook and writes accountants.kyc_status.
 * This proves the webhook mapping against real Postgres + the REAL signed webhook route
 * (constructEvent verifies the HMAC):
 *   verified        → kyc_status='verified' + kyc_verified_at stamped
 *   requires_input  → kyc_status='failed'          (RED path)
 *   processing      → kyc_status='pending'
 *   replay same id  → deduped (200 duplicate), status unchanged (F117 event-claim)
 *   status/start endpoints require an accountant session (401 without)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-kyc.js
 *
 * Scratch Postgres only.
 */

require('./clock.js');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function mkAcc(c, email) {
  return (await c.query(
    `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
     VALUES ($1,$2,'A','B','F',$3,'pending') RETURNING id`,
    [email, bcrypt.hashSync('x', 10), 'RC' + Math.random().toString(36).slice(2, 8)]
  )).rows[0].id;
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    const post = (payload) => {
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    };
    const mkEvt = (id, type, accId, vsId) => JSON.stringify({
      id, type,
      data: { object: { id: vsId || ('vs_' + id), object: 'identity.verification_session', metadata: { accountantId: String(accId) } } },
    });
    const kyc = async (id) => (await c.query(`SELECT kyc_status, kyc_verified_at, kyc_session_id FROM accountants WHERE id = $1`, [id])).rows[0];

    const acc1 = await mkAcc(c, 'kyc-verified@finflow.test');
    const acc2 = await mkAcc(c, 'kyc-failed@finflow.test');
    const acc3 = await mkAcc(c, 'kyc-processing@finflow.test');

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT KYC — Stripe Identity webhook → kyc_status (real PG, signed webhook)');
    console.log('='.repeat(78) + '\n');

    A('default kyc_status = not_started', (await kyc(acc1)).kyc_status === 'not_started', JSON.stringify(await kyc(acc1)));

    // verified
    const rv = await post(mkEvt('evt_kyc_v1', 'identity.verification_session.verified', acc1, 'vs_ok_1'));
    A('verified event → 200', rv.status === 200, `status ${rv.status}`);
    const k1 = await kyc(acc1);
    A('verified → kyc_status=verified', k1.kyc_status === 'verified', JSON.stringify(k1));
    A('verified → kyc_verified_at stamped', !!k1.kyc_verified_at);
    A('verified → kyc_session_id stored', k1.kyc_session_id === 'vs_ok_1', JSON.stringify(k1));

    // requires_input → failed (RED path)
    await post(mkEvt('evt_kyc_f1', 'identity.verification_session.requires_input', acc2, 'vs_bad_1'));
    A('requires_input → kyc_status=failed (RED)', (await kyc(acc2)).kyc_status === 'failed', JSON.stringify(await kyc(acc2)));
    A('failed → kyc_verified_at NOT stamped', (await kyc(acc2)).kyc_verified_at == null);

    // processing → pending
    await post(mkEvt('evt_kyc_p1', 'identity.verification_session.processing', acc3, 'vs_proc_1'));
    A('processing → kyc_status=pending', (await kyc(acc3)).kyc_status === 'pending', JSON.stringify(await kyc(acc3)));

    // idempotent replay of the verified event.id → deduped, status unchanged
    const rr = await post(mkEvt('evt_kyc_v1', 'identity.verification_session.verified', acc1, 'vs_ok_1'));
    const jr = await rr.json().catch(() => ({}));
    A('replay same event.id → 200 {duplicate:true}', rr.status === 200 && jr.duplicate === true, `status ${rr.status} ${JSON.stringify(jr)}`);
    A('replay left kyc_status=verified (unchanged)', (await kyc(acc1)).kyc_status === 'verified');

    // canceled → failed
    const acc4 = await mkAcc(c, 'kyc-cancel@finflow.test');
    await post(mkEvt('evt_kyc_c1', 'identity.verification_session.canceled', acc4, 'vs_cx_1'));
    A('canceled → kyc_status=failed', (await kyc(acc4)).kyc_status === 'failed', JSON.stringify(await kyc(acc4)));

    // unknown accountantId → no crash, webhook still 200
    const ru = await post(mkEvt('evt_kyc_u1', 'identity.verification_session.verified', 99999, 'vs_u_1'));
    A('unknown accountantId → 200 (no crash)', ru.status === 200, `status ${ru.status}`);

    // auth gates
    const anon = new HarnessHttp(server.baseUrl);
    A('GET /kyc/status without session → 401', (await anon.get('/api/accountants/kyc/status')).status === 401);
    A('POST /kyc/start without session → 401', (await anon.post('/api/accountants/kyc/start', {})).status === 401);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (accountant KYC / Stripe Identity)' : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('\n[acc-kyc] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
