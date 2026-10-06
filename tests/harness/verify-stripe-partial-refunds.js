#!/usr/bin/env node
'use strict';
/**
 * verify-stripe-partial-refunds.js — N3b. Every refund on a Stripe charge reaches the books, including a
 * second partial refund on the same charge — and a repeat request never books a refund twice.
 *
 * Defect: import-refund keyed its contra receipt on the CHARGE ('stripe-refund:<charge>') and booked Stripe's
 * cumulative amount_refunded once. A later partial refund on the same charge answered "duplicate" — revenue
 * stayed overstated by that refund forever.
 * Executed: real server + Postgres; Stripe mocked only at its HTTP boundary. Charge ch_pr = 100.00, booked.
 *   refund 30 (cumulative 30) → contra −30                                   (control)
 *   repeat with cumulative still 30 → duplicate, nothing new                  (control)
 *   second refund 20 (cumulative 50) → a NEW contra −20; total refunds 50     (bug: duplicate, total 30)
 *   repeat with cumulative 50 → duplicate; total stays 50
 *   node -r ./tests/harness/clock.js tests/harness/verify-stripe-partial-refunds.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || 'ca_harness';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const JULY = Math.floor(Date.UTC(2026, 6, 20, 16) / 1000);
const CH = { ch_pr: { id: 'ch_pr', amount: 10000, amount_refunded: 0, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Order PR', created: JULY, refunds: { data: [] } } };

(async () => {
  let scratch, server;
  const realFetch = global.fetch;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith('https://api.stripe.com/v1/charges/')) {
        const id = decodeURIComponent(u.split('/v1/charges/')[1].split('?')[0]);
        if (CH[id]) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(CH[id])) };
        return { ok: false, status: 404, json: async () => ({ error: { message: 'No such charge' } }) };
      }
      return realFetch(url, opts);
    };
    const PW = 'partial-refund-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'pr@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'PR Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_pr', linked_at: '2026-07-01T00:00:00Z' }) }]);
    await c.query(`INSERT INTO sales_receipts (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { customer: 'C', amount: 100, date: '2026-07-20', idempotency_key: 'stripe-charge:ch_pr' }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.33.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'pr@finflow.test', password: PW })).status === 200);
    const refunds = async () => (await c.query(`SELECT (data->>'amount')::numeric a FROM sales_receipts WHERE user_id=$1 AND data->>'idempotency_key' LIKE 'stripe-refund:ch_pr%'`, [uid])).rows.map(r => Number(r.a));
    const sum = a => Math.round(a.reduce((t, x) => t + x, 0) * 100) / 100;
    const q = `?entity_id=${eA}`;

    CH.ch_pr.amount_refunded = 3000; CH.ch_pr.refunds.data = [{ id: 're_1', amount: 3000, created: JULY + 3600 }];
    const r1 = await h.post('/api/stripe/import-refund' + q, { charge_id: 'ch_pr' });
    A('first refund 30 → contra −30', r1.status === 200 && r1.json && r1.json.refunded === true && sum(await refunds()) === -30, `status ${r1.status} refunds ${JSON.stringify(await refunds())}`);
    const r1b = await h.post('/api/stripe/import-refund' + q, { charge_id: 'ch_pr' });
    A('control: repeat with cumulative 30 → duplicate, nothing new', r1b.status === 200 && r1b.json && r1b.json.duplicate === true && (await refunds()).length === 1, JSON.stringify(r1b.json).slice(0, 120));
    CH.ch_pr.amount_refunded = 5000; CH.ch_pr.refunds.data.push({ id: 're_2', amount: 2000, created: JULY + 7200 });
    const r2 = await h.post('/api/stripe/import-refund' + q, { charge_id: 'ch_pr' });
    A('second partial refund 20 → a NEW contra −20, total refunds −50 (bug: duplicate, total −30)', r2.status === 200 && r2.json && r2.json.refunded === true && sum(await refunds()) === -50 && (await refunds()).length === 2, `status ${r2.status} ${JSON.stringify(r2.json).slice(0, 100)} refunds ${JSON.stringify(await refunds())}`);
    const r2b = await h.post('/api/stripe/import-refund' + q, { charge_id: 'ch_pr' });
    A('repeat with cumulative 50 → duplicate; total stays −50', r2b.json && r2b.json.duplicate === true && sum(await refunds()) === -50, JSON.stringify(await refunds()));
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (Stripe partial refunds)` : `  ALL GREEN — ${pass} passed, 0 failed  (Stripe partial refunds)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
