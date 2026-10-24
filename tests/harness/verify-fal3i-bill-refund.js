'use strict';
/*
 * verify-fal3i-bill-refund.js — FA-L3i. A refunded (or lost-dispute) accountant bill kept counting: charge.refunded only
 * reversed invoice payments, so the earning stayed 'paid' and the accountant's Total Earned and FinFlow's Commission
 * Collected counted money that went back. After: the earning records the refunded part (cumulative, so a replay or a
 * second partial refund never double-counts); every figure counts only the kept share; a full refund is 'refunded'.
 * Real Postgres + the real signed webhook route. Hand-computed — bill 100.00: commission 10.00, fee 2.90, accountant 87.10:
 *   before: earned 8,710 · commission 1,000
 *   refund 40.00 → kept 60%: earned 5,226 · commission 600 (bug: 8,710 · 1,000) · replayed: unchanged
 *   refund to 100.00 → 0 · 0, status refunded · second bill 50.00 lost in a dispute → 0 (bug: 4,355 · 500)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fal3i-bill-refund.js
 */
require('./clock.js');
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const { accountantFigures, platformFigures } = require('../../earnings-figures.js');
    let n = 0;
    const post = (type, object) => {
      const payload = JSON.stringify({ id: 'evt_l3i_' + (++n), type, data: { object } });
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return fetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    };
    const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code, status) VALUES ('l3i@x.test','x','Ada','L','L3IREF','approved') RETURNING id`)).rows[0].id;
    const earn = async (pi, billed, comm, net) => (await c.query(`INSERT INTO accountant_earnings (accountant_id, type, amount_cents, billed_cents, commission_cents, stripe_fee_cents, status, payment_intent_id, period_month)
      VALUES ($1,'service_commission',$2,$3,$4,$5,'paid',$6,date_trunc('month', NOW())::date) RETURNING id`, [acc, net, billed, comm, billed - comm - net, pi])).rows[0].id;
    await earn('pi_l3i_a', 10000, 1000, 8710);
    const figs = async () => { const a = await accountantFigures(c, acc), p = await platformFigures(c); return [a.earnedCents, p.commissionCollectedCents]; };
    A('premise: earned 8,710 · commission 1,000', JSON.stringify(await figs()) === '[8710,1000]', JSON.stringify(await figs()));
    const charge = (refunded) => ({ id: 'ch_l3i_a', object: 'charge', amount: 10000, amount_refunded: refunded, currency: 'usd', payment_intent: 'pi_l3i_a', refunds: { data: [{ id: 're_l3i_' + refunded }] } });
    A('refund 40.00 → 200', (await post('charge.refunded', charge(4000))).status === 200);
    A('1  kept 60%: earned 5,226 · commission 600 (bug: 8,710 · 1,000)', JSON.stringify(await figs()) === '[5226,600]', JSON.stringify(await figs()));
    await post('charge.refunded', charge(4000));
    A('2  the same refund again changes nothing', JSON.stringify(await figs()) === '[5226,600]', JSON.stringify(await figs()));
    await post('charge.refunded', charge(10000));
    const st = (await c.query(`SELECT status FROM accountant_earnings WHERE payment_intent_id = 'pi_l3i_a'`)).rows[0].status;
    A('3  refunded in full → 0 · 0, status refunded', JSON.stringify(await figs()) === '[0,0]' && st === 'refunded', JSON.stringify(await figs()) + ' ' + st);
    await earn('pi_l3i_b', 5000, 500, 4355);
    await post('charge.dispute.closed', { id: 'dp_l3i', object: 'dispute', status: 'lost', amount: 5000, charge: 'ch_l3i_b', payment_intent: 'pi_l3i_b', currency: 'usd' });
    A('4  a lost dispute takes the bill out too → 0 · 0 (bug: 4,355 · 500)', JSON.stringify(await figs()) === '[0,0]', JSON.stringify(await figs()));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack || e); }
  finally { try { if (server && server.close) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (FA-L3i bill refund)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
