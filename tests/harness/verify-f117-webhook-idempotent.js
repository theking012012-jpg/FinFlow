'use strict';
/**
 * verify-f117-webhook-idempotent.js — F117 (non-money routes). Stripe RETRIES webhook delivery, so a
 * replay of the same event.id must NOT re-run the handlers. The non-idempotent risk is the
 * platform_fees INSERT on checkout.session.completed: a redelivery would double-log platform revenue.
 * The webhook now claims each event.id durably (INSERT ON CONFLICT DO NOTHING) and acks 200 on a
 * replay without processing.
 *
 * EXECUTED against real Postgres + the REAL signed webhook route (constructEvent verifies the HMAC).
 * Discriminating (Rule 14): pre-fix a second delivery of the same event.id inserts a 2nd platform_fees
 * row → A2 red.
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
    const mkEvent = (id) => JSON.stringify({
      id, type: 'checkout.session.completed',
      data: { object: { metadata: { accountantId: '4242' }, amount_total: 5000 } },
    });
    const feeRows = async () => (await c.query(`SELECT count(*)::int AS n FROM platform_fees WHERE accountant_id = 4242`)).rows[0].n;
    const evtRows = async (id) => (await c.query(`SELECT count(*)::int AS n FROM stripe_webhook_events WHERE event_id = $1`, [id])).rows[0].n;

    // 1 — first delivery processes: one platform_fees row, event recorded.
    const r1 = await post(mkEvent('evt_f117_A'));
    A('first delivery → 200', r1.status === 200, `status ${r1.status}`);
    A('A1: first delivery inserted exactly one platform_fees row', (await feeRows()) === 1, `count=${await feeRows()}`);
    A('event recorded in stripe_webhook_events', (await evtRows('evt_f117_A')) === 1, `count=${await evtRows('evt_f117_A')}`);

    // 2 — REPLAY of the SAME event.id: deduped, no second platform_fees row.
    const r2 = await post(mkEvent('evt_f117_A'));
    const j2 = await r2.json().catch(() => ({}));
    A('replay → 200 with {duplicate:true}', r2.status === 200 && j2.duplicate === true, `status ${r2.status} body ${JSON.stringify(j2)}`);
    A('A2: replay did NOT insert a second platform_fees row (still 1)', (await feeRows()) === 1, `count=${await feeRows()} — replay double-logged revenue`);

    // 3 — a DIFFERENT event.id is a distinct event and DOES process (per-event, not a global block).
    const r3 = await post(mkEvent('evt_f117_B'));
    A('A3: a different event.id processes (fees now 2)', r3.status === 200 && (await feeRows()) === 2, `count=${await feeRows()}`);

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
