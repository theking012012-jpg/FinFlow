'use strict';
// ── FinFlow billing (A0 / D-G + D-B, owner decisions 2026-10-23) ─────────────────────────────────────────────────
// What FinFlow knows about an account's subscription, kept in users.data.billing from Stripe's own subscription events
// (FA-S1 finds the user), and the account's billing state as the Billing panel shows it. Pure functions + small DB
// helpers; the Stripe client is passed in, never required here (the harness drives the real server with the live
// client mocked at its boundary).
const Plans = require('./plans');

// Which plan / interval a Stripe price is — from the price ids configured for each plan (monthly and annual).
function priceMap(env) {
  const m = {};
  for (const id of Plans.PAID) {
    const up = id.toUpperCase();
    if (env['STRIPE_PRICE_' + up]) m[env['STRIPE_PRICE_' + up]] = { plan: id, interval: 'month' };
    if (env['STRIPE_PRICE_' + up + '_ANNUAL']) m[env['STRIPE_PRICE_' + up + '_ANNUAL']] = { plan: id, interval: 'year' };
  }
  return m;
}
function priceFor(env, plan, interval) {
  const up = String(plan || '').toUpperCase();
  return env['STRIPE_PRICE_' + up + (interval === 'year' ? '_ANNUAL' : '')] || null;
}
const iso = s => (s ? new Date(Number(s) * 1000).toISOString() : null);

// The facts of a Stripe subscription. Newer Stripe API versions carry the period on the subscription ITEM, older ones
// on the subscription — both are read.
function subscriptionFacts(sub, env) {
  const item = (sub && sub.items && sub.items.data && sub.items.data[0]) || {};
  const price = item.price || (sub && sub.plan) || {};
  const pm = priceMap(env || {})[price.id] || {};
  return {
    subscription_id: sub && sub.id ? String(sub.id) : null,
    item_id: item.id ? String(item.id) : null,
    price_id: price.id ? String(price.id) : null,
    plan: pm.plan || (sub && sub.metadata && sub.metadata.plan) || null,
    interval: (price.recurring && price.recurring.interval) || pm.interval || null,
    period_start: iso((sub && sub.current_period_start) || item.current_period_start),
    period_end: iso((sub && sub.current_period_end) || item.current_period_end),
    cancel_at_period_end: !!(sub && sub.cancel_at_period_end),
    status: sub && sub.status ? String(sub.status) : null,
  };
}

// Store the facts on the user; an active / trialing subscription also sets the plan it pays for.
async function syncSubscription(pool, userId, sub, env) {
  const f = subscriptionFacts(sub, env);
  const live = f.status === 'active' || f.status === 'trialing';
  await pool.query(
    `UPDATE users SET data = data || jsonb_build_object('billing', COALESCE(data->'billing', '{}'::jsonb) || $2::jsonb)
                                  || CASE WHEN $3::text IS NOT NULL THEN jsonb_build_object('plan', $3::text, 'trial_ends', null::text) ELSE '{}'::jsonb END
      WHERE id = $1`,
    [userId, JSON.stringify(f), live && f.plan ? f.plan : null]);
  return f;
}

// The account's billing state, as the Billing panel shows it. `now` is passed in (one clock for the caller).
function billingState(data, now) {
  const d = data || {};
  const b = d.billing || {};
  const plan = Plans.planFor(d.plan);
  const paid = Plans.PAID.includes(plan.id);
  const st = {
    plan: plan.id, planName: plan.name, paid,
    interval: paid ? (b.interval || 'month') : null,
    status: d.subscriptionStatus || b.status || (paid ? 'active' : null),
    periodEnd: paid ? (b.period_end || null) : null,
    cancelAtPeriodEnd: paid ? !!b.cancel_at_period_end : false,
    trialEnds: plan.id === 'trial' ? (d.trial_ends || null) : null,
    readOnly: plan.id === 'trial' && !!d.trial_ends && new Date(d.trial_ends).getTime() <= (now || Date.now()),
    price: paid ? (b.interval === 'year' ? plan.annualMonthly * 12 : plan.monthly) : 0,
  };
  return st;
}

module.exports = { priceMap, priceFor, subscriptionFacts, syncSubscription, billingState };
