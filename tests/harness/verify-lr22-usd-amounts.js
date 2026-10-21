'use strict';
/**
 * verify-lr22-usd-amounts.js — LR22 (owner decision 2026-10-21: label + convert, better and more secure).
 *  • Business holdings are priced in USD (M36) but showed a bare "$" on every business — on a TT$ business "$1,000"
 *    reads as TT$1,000, about six times too small. Now every figure says "USD", and the total carries its
 *    business-currency equivalent at the STORED rate, with the rate named; no rate → says so, never a guess.
 *  • Stripe's "Today: $0" was static text; the real label summed the last payments across currencies under the first
 *    payment's sign. Now one total per currency, each with its code, naming what it covers.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Stripe's charge list is answered in-process by this test
 * (the server's own fetch to api.stripe.com) — the route itself computes the totals.
 *   TT$ business, 10 AAPL @ USD 100 (cost 80):
 *     total "USD 1,000.00"                                        (old: "$1.0K" — measured)
 *     no stored rate → "No USD→TTD rate …"                         (old: nothing)
 *     rate 6.78 stored → "≈ TT$6,780 at 6.7800 TTD per USD"        (old: nothing)
 *     no bare "$" anywhere in the holdings table                   (old: "$100.00", "$1,000")
 *   Stripe: USD 10.00 + TTD 25.00 → totals {TTD:25, USD:10}; label "Last 2 payments: TTD 25.00 · USD 10.00 collected"
 *                                                                  (old: "$35.00 collected" — mixed currencies added)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr22-usd-amounts.js
 */
require('./clock.js');
process.env.HARNESS_KEEP_STRIPE = '1';   // the boot keeps the (fake) Stripe keys; the network guard still blocks real calls
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_lr22_not_a_secret';
process.env.STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || 'ca_lr22';
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.stripe.com/v1/charges')) {
      const now = Math.floor(Date.parse('2026-07-25T12:00:00Z') / 1000);
      return new Response(JSON.stringify({ data: [
        { id: 'ch_usd', amount: 1000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, created: now, livemode: false },
        { id: 'ch_ttd', amount: 2500, currency: 'ttd', status: 'succeeded', paid: true, refunded: false, created: now, livemode: false },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
  console.log('\nLR22 — USD amounts say USD (with the business-currency equivalent); Stripe totals stay per currency\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'Island LR22', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('POST', '/api/holdings', { ticker: 'AAPL', shares: 10, cost_per: 80, price: 100, scope: 'business' });
      await client.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
        [userId, e.id, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_lr22', books: { scope: 'business', entity_id: e.id } }) }]);
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    const paint = async () => { w._invBootPending = false; w._bizInvLive = true; w.renderBizInvestments(); await settle(20, 30); };

    await paint();
    eq('holdings total says USD', t('biz-inv-total'), 'USD 1,000.00', '$1.0K');
    eq('no stored rate → it says so (never a guess)', /^No USD→TTD rate/.test(t('biz-inv-total-eq')), true, false);
    await w.fetch('/api/fx-rates', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_currency: 'USD', to_currency: 'TTD', rate: 6.78, rate_date: '2026-07-01' }) });
    await paint();
    eq('with a stored rate → the TT$ equivalent, rate named', t('biz-inv-total-eq'), '≈ TT$6,780 at 6.7800 TTD per USD', '');   // the app's money format (S)
    const table = (d.getElementById('biz-inv-holdings-list') || {}).textContent || '';
    eq('no bare "$" in the holdings table (only USD / TT$)', (table.match(/(?<![A-Z]{2})\$[\d,.]+/g) || []), [], ['$100.00', '$1.0', '$800']);

    const feed = await (await w.fetch('/api/stripe/feed?limit=20', { credentials: 'include' })).json();
    eq('Stripe feed: one total per currency', feed.totals, { USD: 10, TTD: 25 }, undefined);
    await w.startStripeFeed(); await settle(20, 30);
    eq('Stripe label: per-currency totals with codes, naming what it covers', /Last 2 payments: TTD 25\.00 · USD 10\.00 collected/.test(t('stripe-total-label')), true, false);
    eq('…and no mixed-currency sum ($35.00) anywhere', /35\.00/.test(t('stripe-total-label')), false, true);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { globalThis.fetch = realFetch; try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
