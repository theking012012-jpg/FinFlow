#!/usr/bin/env node
'use strict';
/**
 * verify-webhook-retry-on-failure.js — N2. A Stripe event whose processing FAILS must be retryable.
 *
 * Defect: the handler claimed event.id in stripe_webhook_events BEFORE processing, and swallowed (or
 * left unhandled) write failures. Stripe's retry of the same event.id was then acked as a duplicate,
 * so the event was lost permanently (e.g. a paid upgrade never applied).
 *
 * Failure injection (Rule 14): a scratch-DB trigger makes the plan-upgrade UPDATE raise on the first
 * delivery. Fixed code → 500 + claim released; after the trigger is dropped, Stripe's redelivery of the
 * SAME event.id applies the upgrade (plan=pro). Buggy code → claim kept; redelivery acked as duplicate;
 * plan stays 'trial'.
 *   node -r ./tests/harness/clock.js tests/harness/verify-webhook-retry-on-failure.js
 */

const bcrypt = require('bcryptjs');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: 'retry@finflow.test', plan: 'trial', trial_ends: new Date(Date.now() + 86400000).toISOString(), role: 'owner', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const evt = { id: 'evt_retry_1', type: 'checkout.session.completed', data: { object: { payment_status: 'paid',
      id: 'cs_retry_1', object: 'checkout.session', mode: 'subscription', amount_total: 7900, metadata: { userId: String(uid), plan: 'pro' } } } };
    const post = async () => {
      const payload = JSON.stringify(evt);
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
      try { const r = await fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload, signal: ac.signal }); return { status: r.status, text: await r.text() }; }
      catch (e) { return { status: 'no-response', text: String(e && e.message) }; }
      finally { clearTimeout(t); }
    };
    const plan = async () => (await c.query(`SELECT data->>'plan' p FROM users WHERE id=$1`, [uid])).rows[0].p;
    const claimed = async () => Number((await c.query(`SELECT COUNT(*) n FROM stripe_webhook_events WHERE event_id=$1`, [evt.id])).rows[0].n);

    console.log('\n' + '='.repeat(78));
    console.log('  STRIPE WEBHOOK — failed processing must be retryable');
    console.log('='.repeat(78));

    // Inject a real DB failure on the upgrade write.
    await c.query(`CREATE OR REPLACE FUNCTION _harness_fail_upgrade() RETURNS trigger AS $$
      BEGIN IF NEW.data->>'plan' = 'pro' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await c.query(`CREATE TRIGGER _harness_fail_upgrade BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION _harness_fail_upgrade()`);

    const r1 = await post();
    A('first delivery (write fails) → 500 so Stripe retries', r1.status === 500, `status ${r1.status}: ${r1.text.slice(0, 100)}`);
    A('claim released after the failure (bug keeps it)', (await claimed()) === 0, 'claims=' + (await claimed()));
    A('plan not changed by the failed attempt', (await plan()) === 'trial');

    await c.query(`DROP TRIGGER _harness_fail_upgrade ON users`);
    const r2 = await post();
    A('redelivery of the SAME event → 200', r2.status === 200, `status ${r2.status}: ${r2.text.slice(0, 100)}`);
    A('redelivery is processed, not acked as duplicate', !/duplicate/.test(r2.text), r2.text.slice(0, 100));
    A('upgrade applied on retry (plan=pro; bug leaves trial)', (await plan()) === 'pro', 'plan=' + (await plan()));
    A('event now claimed exactly once', (await claimed()) === 1);

    const r3 = await post();
    A('third delivery after success → acked as duplicate (idempotency intact)', r3.status === 200 && /duplicate/.test(r3.text), `status ${r3.status}: ${r3.text.slice(0, 100)}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (webhook retry on failure)` : `  ALL GREEN — ${pass} passed, 0 failed  (webhook retry on failure)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
