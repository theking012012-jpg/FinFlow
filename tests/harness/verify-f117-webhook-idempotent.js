'use strict';
/**
 * verify-f117-webhook-idempotent.js — F117 (non-money routes). Stripe RETRIES webhook delivery, so a
 * replay of the same event.id must NOT re-run the handlers. The webhook claims each event.id durably
 * (INSERT ON CONFLICT DO NOTHING) and acks 200 on a replay without processing.
 *
 * FA-L3b (2026-10-24): this harness used to prove the claim with a platform_fees INSERT fired by
 * metadata.accountantId — a key NO real checkout writes (bill-client writes accountant_id; the only
 * accountantId is the KYC identity session). That 4% writer never ran in production and is deleted;
 * FinFlow's commission is accountant_earnings.commission_cents (written at bill time). The replay is now
 * proven with the REAL subscription-checkout shape (server.js checkout: metadata {userId, plan, interval}).
 *
 * EXECUTED against real Postgres + the REAL signed webhook route (constructEvent verifies the HMAC).
 * Discriminating (Rule 4/14): the user moves to 'business' after the first delivery; a replay that re-ran
 * the handler would put them back on 'pro' → A2 red. A session carrying the legacy accountantId key wrote a
 * 4% platform_fees row before FA-L3b → A4 red (one row of 200 cents on a $50 bill).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f117-webhook-idempotent.js
 */
require('./clock.js');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const AS = (n, ok, d) => A('[STRUCTURAL] ' + n, ok, d);
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const post = (payload) => {
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    };
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'f117@finflow.test', plan: 'trial', role: 'owner' }])).rows[0].id;
    const mkEvent = (id) => JSON.stringify({
      id, type: 'checkout.session.completed',
      data: { object: { id: 'cs_f117', mode: 'subscription', payment_status: 'paid', subscription: 'sub_f117', customer: 'cus_f117',
        metadata: { userId: String(uid), plan: 'pro', interval: 'month' }, amount_total: 1900 } },
    });
    const plan = async () => (await c.query(`SELECT data->>'plan' AS p FROM users WHERE id = $1`, [uid])).rows[0].p;
    const evtRows = async (id) => (await c.query(`SELECT count(*)::int AS n FROM stripe_webhook_events WHERE event_id = $1`, [id])).rows[0].n;

    // 1 — first delivery processes: the user is on Pro, event recorded.
    const r1 = await post(mkEvent('evt_f117_A'));
    A('first delivery → 200', r1.status === 200, `status ${r1.status}`);
    A('A1: first delivery processed (trial → pro)', (await plan()) === 'pro', `plan=${await plan()}`);
    A('event recorded in stripe_webhook_events', (await evtRows('evt_f117_A')) === 1, `count=${await evtRows('evt_f117_A')}`);

    // the customer then moves to Business (a later, separate change)
    await c.query(`UPDATE users SET data = data || '{"plan":"business"}' WHERE id = $1`, [uid]);

    // 2 — REPLAY of the SAME event.id: deduped, the later change stands.
    const r2 = await post(mkEvent('evt_f117_A'));
    const j2 = await r2.json().catch(() => ({}));
    A('replay → 200 with {duplicate:true}', r2.status === 200 && j2.duplicate === true, `status ${r2.status} body ${JSON.stringify(j2)}`);
    A('A2: replay did NOT re-run the handler (still business; bug: back to pro)', (await plan()) === 'business', `plan=${await plan()} — replay re-applied an old checkout`);

    // 3 — a DIFFERENT event.id is a distinct event and DOES process (per-event, not a global block).
    const r3 = await post(mkEvent('evt_f117_B'));
    A('A3: a different event.id processes (back to pro)', r3.status === 200 && (await plan()) === 'pro', `plan=${await plan()}`);

    // 4 — FA-L3b: the dead 4% platform_fees writer is gone (a session carrying accountantId logs nothing).
    const legacy = JSON.stringify({ id: 'evt_f117_C', type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', metadata: { accountantId: '4242' }, amount_total: 5000 } } });
    const r4 = await post(legacy);
    const fees = (await c.query(`SELECT count(*)::int AS n FROM platform_fees`)).rows[0].n;
    A('A4: no flat-4% platform_fees row is written (bug: 1 row, 200 cents on a $50 bill)', r4.status === 200 && fees === 0, `status ${r4.status} rows=${fees}`);

    // STRUCTURAL
    const srv = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
    const db = fs.readFileSync(path.join(process.cwd(), 'database.js'), 'utf8');
    AS('webhook claims event.id via ON CONFLICT DO NOTHING RETURNING', /INSERT INTO stripe_webhook_events[\s\S]*ON CONFLICT \(event_id\) DO NOTHING RETURNING/.test(srv));
    AS('webhook early-returns {duplicate:true} on a claimed event', /_claim\.rowCount === 0[\s\S]*duplicate: true/.test(srv));
    AS('database.js creates the stripe_webhook_events ledger', /CREATE TABLE IF NOT EXISTS stripe_webhook_events/.test(db));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F117 webhook idempotency)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
