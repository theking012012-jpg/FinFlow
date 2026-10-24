'use strict';
/**
 * verify-dg3-change-plan-ui.js — D-G step 3 on the Pricing page. For a subscriber, "Upgrade to …" started a SECOND
 * Stripe checkout (a second subscription, billed twice), and lower plans were greyed out ("Included in your plan") —
 * there was no way down. Now a subscriber's buttons open the change preview for THEIR subscription; nothing goes to
 * checkout. A downgrade shows the date, that nothing is charged now, and — when there are more editors than the new
 * plan's seats — asks who keeps edit access.
 * The REAL SPA + real server (clientMoneyKit). Account: Business monthly, period ends 2026-08-10, 5 admins.
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_PRICE_PRO = 'price_pro_m';
process.env.STRIPE_PRICE_BUSINESS = 'price_biz_m';
process.env.STRIPE_PRICE_SCALE = 'price_scale_m';
const { run } = require('./clientMoneyKit.js');

run('D-G step 3 UI — a subscriber changes plan on the SAME subscription (no second checkout)', async ({ w, d, settle, A, eq }) => {
  let checkouts = 0; const _f = w.fetch;
  w.fetch = function (u) { if (String(u).indexOf('/api/stripe/checkout') >= 0) checkouts++; return _f.apply(this, arguments); };
  try { w.showPage('pricing'); } catch (_) {}
  try { w.initPricing && w.initPricing(); } catch (_) {}
  try { await w._updatePricingCTAs(); } catch (_) {}
  await settle(10, 50);
  const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
  eq('1  Scale button reads "Upgrade to Scale"; Pro reads "Switch to Pro" (bug: "Included in your plan", greyed)', [t('cta-scale'), t('cta-pro'), (d.getElementById('cta-pro') || {}).disabled], ['Upgrade to Scale', 'Switch to Pro', false]);
  d.getElementById('cta-pro').click();
  let box = null;
  for (let i = 0; i < 40 && !(box && /2026/.test(box.textContent)); i++) { await new Promise(r => setTimeout(r, 100)); box = d.getElementById('plan-change-box'); }
  const bt = box ? box.textContent.replace(/\s+/g, ' ') : '';
  A('2  clicking it previews the change: on 10 August 2026, nothing charged now, then $79 a month', /August/.test(bt) && /2026/.test(bt) && /nothing is charged now/i.test(bt) && /\$79 a month/.test(bt), bt.slice(0, 300) || 'no #plan-change-box');
  const boxes = box ? box.querySelectorAll('input[type=checkbox][data-editor]') : [];
  A('2b 5 editors for 3 seats → the preview lists them to choose who keeps edit access', boxes.length === 5 && /3/.test(bt) && /Viewer/.test(bt), 'checkboxes ' + boxes.length);
  // the upgrade button too: the old code sent a subscriber to checkout from here
  d.getElementById('cta-scale').click();
  await new Promise(r => setTimeout(r, 1200));
  eq('3  neither button started a checkout (bug: "Upgrade to Scale" opened a second subscription)', checkouts, 0, 1);
  w.fetch = _f;
}, { extraSeed: async ({ client, userId }) => {
  await client.query(`UPDATE users SET data = data || $2::jsonb WHERE id = $1`, [userId, JSON.stringify({ plan: 'business', stripe_subscription_id: 'sub_U', stripe_customer_id: 'cus_U', subscriptionStatus: 'active',
    billing: { subscription_id: 'sub_U', item_id: 'si_U', price_id: 'price_biz_m', plan: 'business', interval: 'month', period_start: '2026-07-10T00:00:00.000Z', period_end: '2026-08-10T00:00:00.000Z', cancel_at_period_end: false, status: 'active' } })]);
  for (let i = 1; i <= 5; i++) await client.query(`INSERT INTO team_members (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [userId, { email: 'u' + i + '@finflow.test', name: 'Editor ' + i, role: 'admin', status: 'active' }]);
} });
