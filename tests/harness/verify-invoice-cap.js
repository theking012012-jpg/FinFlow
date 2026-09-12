#!/usr/bin/env node
'use strict';
/**
 * verify-invoice-cap.js — the Pro plan "50 invoices / month" cap, enforced server-side.
 *
 * The pricing card advertises "Invoicing & quotes (up to 50/month)" for Pro, but POST /api/invoices
 * enforced NOTHING (the only check was dead-shadowed client code). This proves the real gate:
 *   · Pro at 50 this month           → POST #51 = 402 {code:INVOICE_LIMIT}   (RED — the cap bites)
 *   · Pro under 50                    → POST      = 201                        (allowed)
 *   · Business at 50                  → POST      = 201                        (unlimited)
 *   · Trial (unexpired) at 50         → POST      = 201                        (uncapped in-trial)
 *   · idempotent retry of an existing invoice at the cap → 200 original, NOT 402 (cap sits AFTER idem)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-invoice-cap.js
 *
 * Counts by created_at (NOW()) so the month window matches the server query exactly; scratch PG only.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function mkUser(c, email, plan, trialEndsIso) {
  const data = { email, name: 'Co', plan, role: 'owner', password: bcrypt.hashSync(PW, 10) };
  if (trialEndsIso) data.trial_ends = trialEndsIso;
  const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [data])).rows[0].id;
  const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
    [uid, { name: 'Ent', currency: 'USD', is_active: 1 }])).rows[0].id;
  return { uid, eid };
}
// Seed N invoices for the account THIS month (created_at NOW()).
async function seedInvoices(c, uid, eid, n) {
  await c.query(
    `INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at)
     SELECT $1, $2, jsonb_build_object('client','seed','amount',100,'status','pending'), NOW(), NOW()
     FROM generate_series(1,$3)`, [uid, eid, n]);
}
async function login(base, email) {
  const h = new HarnessHttp(base);
  const r = await h.post('/api/auth/login', { email, password: PW });
  if (r.status !== 200) throw new Error('login failed for ' + email + ' (' + r.status + ')');
  return h;
}
const inv = (eid, extra) => Object.assign({ client: 'New Client', amount: 250, status: 'pending', entity_id: eid }, extra || {});

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const future = new Date(Date.now() + 30 * 864e5).toISOString();

    const pro50   = await mkUser(c, 'pro50@finflow.test',   'pro');
    const pro49   = await mkUser(c, 'pro49@finflow.test',   'pro');
    const biz50   = await mkUser(c, 'biz50@finflow.test',   'business');
    const trial50 = await mkUser(c, 'trial50@finflow.test', 'trial', future);
    const proIdem = await mkUser(c, 'proidem@finflow.test', 'pro');

    await seedInvoices(c, pro50.uid,   pro50.eid,   500);
    await seedInvoices(c, pro49.uid,   pro49.eid,   499);
    await seedInvoices(c, biz50.uid,   biz50.eid,   500);
    await seedInvoices(c, trial50.uid, trial50.eid, 500);
    await seedInvoices(c, proIdem.uid, proIdem.eid, 499);

    console.log('\n' + '='.repeat(78));
    console.log('  PRO INVOICE CAP — 500/month fair-use ceiling (Pro unlimited, anti-abuse)');
    console.log('='.repeat(78) + '\n');

    // Pro at 50 → blocked
    const hPro50 = await login(server.baseUrl, 'pro50@finflow.test');
    const r51 = await hPro50.post('/api/invoices', inv(pro50.eid));
    A('Pro at 500: POST #501 → 402 (RED — fair-use ceiling bites)', r51.status === 402, `status ${r51.status}`);
    A('Pro at 50: response code = INVOICE_LIMIT', r51.json && r51.json.code === 'INVOICE_LIMIT', JSON.stringify(r51.json));

    // Pro under 50 → allowed
    const hPro49 = await login(server.baseUrl, 'pro49@finflow.test');
    A('Pro at 499: POST → 201 (allowed under ceiling)', (await hPro49.post('/api/invoices', inv(pro49.eid))).status === 201);

    // Business at 50 → unlimited
    const hBiz = await login(server.baseUrl, 'biz50@finflow.test');
    A('Business at 500: POST → 201 (uncapped)', (await hBiz.post('/api/invoices', inv(biz50.eid))).status === 201);

    // Trial (unexpired) at 50 → uncapped
    const hTrial = await login(server.baseUrl, 'trial50@finflow.test');
    A('Trial at 500 (unexpired): POST → 201 (uncapped in-trial)', (await hTrial.post('/api/invoices', inv(trial50.eid))).status === 201);

    // Idempotency: cap sits AFTER the idem short-circuit — a retry of the invoice that hit the cap
    // returns the original, not 402.
    const hIdem = await login(server.baseUrl, 'proidem@finflow.test');
    const tok = 'cap-idem-token-1';
    const first = await hIdem.post('/api/invoices', inv(proIdem.eid, { idempotency_key: tok })); // 49→50
    A('Pro idem: first POST (499→500) → 201', first.status === 201, `status ${first.status}`);
    const retry = await hIdem.post('/api/invoices', inv(proIdem.eid, { idempotency_key: tok })); // same token
    A('Pro idem: retry SAME token → 200 original, NOT 402', retry.status === 200 && retry.json && String(retry.json.id) === String(first.json.id), `status ${retry.status}`);
    const third = await hIdem.post('/api/invoices', inv(proIdem.eid, { client: 'Another', idempotency_key: 'cap-idem-token-2' })); // would be #51
    A('Pro idem: a NEW invoice at 500 → 402 (ceiling still enforced)', third.status === 402 && third.json.code === 'INVOICE_LIMIT', `status ${third.status}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (Pro invoice cap)' : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('\n[invoice-cap] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
