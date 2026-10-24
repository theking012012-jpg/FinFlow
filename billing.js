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

// ── D-G step 4: data after a paid plan ends (owner decision 2026-10-23) ──
// Read-only for RETENTION_DAYS from billing.access_ended_at, a warning e-mail WARNING_DAYS before the deletion, then the
// account is erased. Never deleted unless the warning was SENT at least WARNING_DAYS earlier: a missed warning goes out
// late and pushes the deletion to WARNING_DAYS after it.
const RETENTION_DAYS = 90, WARNING_DAYS = 14, DAY = 86400000;
function deleteOnFor(b) {
  const ended = Date.parse(b && b.access_ended_at);
  if (isNaN(ended)) return null;
  let at = ended + RETENTION_DAYS * DAY;
  const warned = Date.parse(b && b.deletion_warned_at);
  if (!isNaN(warned)) at = Math.max(at, warned + WARNING_DAYS * DAY);
  return new Date(at).toISOString();
}
// 'warn' | 'delete' | null — only for an account whose PAID plan ended and which is not paying again.
function retentionDue(data, nowMs) {
  const d = data || {}, b = d.billing || {};
  if (Plans.PAID.includes(Plans.planFor(d.plan).id)) return null;
  if (!b.access_ended_at || isNaN(Date.parse(b.access_ended_at))) return null;
  const at = Date.parse(deleteOnFor(b));
  if (!b.deletion_warned_at) return nowMs >= at - WARNING_DAYS * DAY ? 'warn' : null;
  return nowMs >= at ? 'delete' : null;
}

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

// Store the facts on the user; an active / trialing subscription also sets the plan it pays for — EXCEPT while a
// downgrade is pending: Stripe is already on the new (lower) price, but the customer paid for the current plan until the
// change's date, so the plan is kept until the billing job lands it (step 3).
async function syncSubscription(pool, userId, sub, env, nowMs) {
  const f = subscriptionFacts(sub, env);
  let live = f.status === 'active' || f.status === 'trialing';
  const { rows: [cur] } = await pool.query(`SELECT data->'billing'->'pending_change' AS pc FROM users WHERE id = $1`, [userId]);
  const pc = cur && cur.pc;
  if (pc && pc.effective && (nowMs == null ? Date.now() : nowMs) < Date.parse(pc.effective)) {
    live = false;                                   // keep the plan; record the facts only
    delete f.interval; delete f.plan;               // the current term's plan / interval stay as they are
  }
  await pool.query(
    `UPDATE users SET data = data || jsonb_build_object('billing', (COALESCE(data->'billing', '{}'::jsonb) || $2::jsonb)
                                     - CASE WHEN $3::text IS NOT NULL THEN ARRAY['access_ended_at','deletion_warned_at'] ELSE ARRAY[]::text[] END)
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
    accessEndedAt: !paid && b.access_ended_at ? b.access_ended_at : null,
    deleteOn: !paid && b.access_ended_at ? deleteOnFor(b) : null,
    price: paid ? (b.interval === 'year' ? plan.annualMonthly * 12 : plan.monthly) : 0,
    subscribed: paid && !!(d.stripe_subscription_id || b.subscription_id),   // a Stripe subscription to change (else: checkout)
    pendingChange: b.pending_change ? { plan: b.pending_change.plan, planName: Plans.planFor(b.pending_change.plan).name, interval: b.pending_change.interval, effective: b.pending_change.effective } : null,
  };
  return st;
}

// Months STARTED from a period start up to `nowMs` — a started month counts as used. Calendar months in UTC, the day
// clamped to the month's length (a period starting on the 31st steps 31 Jan → 28 Feb → 31 Mar …).
function monthsStarted(startIso, nowMs) {
  const s = new Date(startIso);
  if (isNaN(s)) return 0;
  const y0 = s.getUTCFullYear(), m0 = s.getUTCMonth(), d0 = s.getUTCDate(), t0 = s.getTime() % 86400000;
  let n = 0;
  for (let k = 0; k < 240; k++) {
    const y = y0 + Math.floor((m0 + k) / 12), m = (m0 + k) % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const at = Date.UTC(y, m, Math.min(d0, last)) + t0;
    if (at > nowMs) break;
    n++;
  }
  return n;
}
const round2 = v => Math.round(v * 100) / 100;

// What cancelling does now (D-G / D-B) — shown before confirming and recomputed by the server on confirm.
//   monthly: ends at the period end, no refund
//   yearly:  ends now; refund = paid − months started × the MONTHLY price, never below 0 nor above what was paid
// `paidInvoice` = the subscription's last paid invoice ({ amount_paid (minor units), payment_intent }), from Stripe.
function cancelPreview(data, paidInvoice, nowMs) {
  const st = billingState(data, nowMs);
  if (!st.paid) return { error: 'There is no paid plan to cancel.', code: 'NO_PLAN' };
  const b = (data && data.billing) || {};
  if (st.interval !== 'year') return { mode: 'period_end', interval: 'month', accessUntil: st.periodEnd, refund: 0 };
  const plan = Plans.planFor(st.plan);
  const paid = round2(((paidInvoice && paidInvoice.amount_paid) || 0) / 100);
  const monthsUsed = monthsStarted(b.period_start, nowMs);
  const used = round2(monthsUsed * plan.monthly);
  const refund = round2(Math.max(0, Math.min(paid, paid - used)));
  return { mode: 'refund', interval: 'year', paid, monthsUsed, monthlyPrice: plan.monthly, used, refund,
           paymentIntent: paidInvoice && paidInvoice.payment_intent ? String(paidInvoice.payment_intent.id || paidInvoice.payment_intent) : null,
           accessUntil: new Date(nowMs).toISOString() };
}

// When a plan change takes effect (D-G step 3 / D-B):
//   'now'        — a higher plan, or monthly → yearly on the same plan (prorated by Stripe, charged now)
//   'period_end' — a lower plan, or yearly → monthly (the paid term is kept; price locked for the term)
//   null         — the same plan and interval
const RANK = { pro: 1, business: 2, scale: 3 };
function changeWhen(from, to) {
  const rf = RANK[from.plan] || 0, rt = RANK[to.plan] || 0;
  if (rf === rt && from.interval === to.interval) return null;
  if (rt > rf) return 'now';
  if (rt < rf) return 'period_end';
  return to.interval === 'year' ? 'now' : 'period_end';
}
// Stripe's preview invoice → what the customer pays now and the credit for unused time (minor units → money).
function previewAmounts(inv) {
  const lines = (inv && inv.lines && inv.lines.data) || [];
  const credit = lines.filter(l => Number(l.amount) < 0).reduce((s, l) => s - Number(l.amount), 0);
  return { chargeNow: round2(Math.max(0, Number(inv && inv.amount_due) || 0) / 100), credit: round2(credit / 100), currency: (inv && inv.currency) || 'usd' };
}

// ── D-B: the yearly renewal reminder (30 days before) and its one-click cancel link ──
const RENEWAL_NOTICE_DAYS = 30;
// Due when a paid YEARLY plan, not set to cancel, renews within 30 days and has not been reminded for THIS renewal.
function renewalDue(data, nowMs) {
  const d = data || {}, b = d.billing || {};
  if (!Plans.PAID.includes(Plans.planFor(d.plan).id) || b.interval !== 'year' || b.cancel_at_period_end) return false;
  const end = Date.parse(b.period_end);
  if (isNaN(end) || end <= nowMs || end - nowMs > RENEWAL_NOTICE_DAYS * DAY) return false;
  return b.renewal_notice_for !== b.period_end;
}
// The link's token: an HMAC of the account and THAT renewal's date — it cannot be moved to another account or reused
// for a later renewal. `secret` = SESSION_SECRET.
const crypto = require('crypto');
function renewalToken(secret, userId, periodEnd) {
  return crypto.createHmac('sha256', String(secret)).update('renewal-cancel:' + userId + ':' + periodEnd).digest('base64url');
}
function renewalTokenOk(secret, userId, periodEnd, token) {
  if (!secret || !periodEnd || typeof token !== 'string') return false;
  const want = Buffer.from(renewalToken(secret, userId, periodEnd)), got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

module.exports = { priceMap, priceFor, subscriptionFacts, syncSubscription, billingState, monthsStarted, cancelPreview, changeWhen, previewAmounts, RANK,
                   RETENTION_DAYS, WARNING_DAYS, deleteOnFor, retentionDue, RENEWAL_NOTICE_DAYS, renewalDue, renewalToken, renewalTokenOk };
