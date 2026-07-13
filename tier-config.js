// ── FinFlow accountant tier system — SINGLE SOURCE OF TRUTH (F17) ─────────────
// One definition, used by the Node backend (accountant-routes.js, server.js) AND
// the browser (accountant-dashboard.html loads /tier-config.js). Adjust the ladder
// here and every consumer follows — no duplicated literals anywhere else.
//
// UMD shim: attaches to module.exports under Node, and to window.FinFlowTiers in
// the browser. Keep it dependency-free so both environments can load it verbatim.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FinFlowTiers = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The ladder. `active clients` = consented (accountant_clients.status='active')
  // AND paying (users.subscriptionStatus='active'); trial clients do NOT count.
  //   referralMonths — months of $10/mo referral payout, FROZEN at client approval.
  //                    HARD CAP 12 — no tier may exceed it.
  //   commissionRate — FinFlow's cut of a service bill (accountant keeps the rest).
  const TIERS = [
    { name: 'Bronze',   min: 1,   max: 24,       referralMonths: 3,  commissionRate: 0.10 },
    { name: 'Silver',   min: 25,  max: 49,       referralMonths: 6,  commissionRate: 0.08 },
    { name: 'Gold',     min: 50,  max: 99,       referralMonths: 9,  commissionRate: 0.06 },
    { name: 'Platinum', min: 100, max: 249,      referralMonths: 12, commissionRate: 0.04 },
    { name: 'Elite',    min: 250, max: Infinity, referralMonths: 12, commissionRate: 0.02 },
  ];

  // Number of active paying clients below which no service commission is charged —
  // the onboarding hook (an accountant's first few clients are commission-free).
  const ONBOARDING_FREE_BELOW = 3;

  const REFERRAL_MONTHS_HARD_CAP = 12;

  // tierForAccountant(activeCount) → the tier row (name, referralMonths, commissionRate).
  // Count 0 maps to the entry tier (Bronze) so approving a first client freezes 3 months.
  function tierForAccountant(activeCount) {
    const c = Math.max(0, Math.floor(Number(activeCount) || 0));
    let tier = TIERS[0];
    for (const t of TIERS) { if (c <= t.max) { tier = t; break; } tier = t; }
    return {
      name: tier.name,
      referralMonths: Math.min(tier.referralMonths, REFERRAL_MONTHS_HARD_CAP),
      commissionRate: tier.commissionRate,
    };
  }

  // commissionRateFor(activeCount) → the LIVE service-commission rate to charge now.
  // Applies the onboarding hook (0% under the free threshold), then the tier rate.
  function commissionRateFor(activeCount) {
    const c = Math.max(0, Math.floor(Number(activeCount) || 0));
    if (c < ONBOARDING_FREE_BELOW) return 0;
    return tierForAccountant(c).commissionRate;
  }

  // estimateStripeFeeCents(cents) → Stripe's standard US card fee (2.9% + 30¢).
  // Used as the estimate when a bill is created; the REAL fee from the charge's
  // balance transaction replaces it on the payment_intent.succeeded webhook.
  function estimateStripeFeeCents(billedCents) {
    const b = Math.max(0, Math.round(Number(billedCents) || 0));
    if (b === 0) return 0;
    return Math.round(b * 0.029) + 30;
  }

  // splitBilling(billedCents, commissionRate, stripeFeeCents) → the money split.
  // Stripe fee off the top → tier commission → accountant nets the remainder.
  //   commissionCents  = round(billed * rate)   → FinFlow (Stripe application fee)
  //   stripeFeeCents   = passed in (estimate or real)
  //   accountantNetCents = billed − stripeFee − commission (clamped ≥ 0)
  function splitBilling(billedCents, commissionRate, stripeFeeCents) {
    const billed = Math.max(0, Math.round(Number(billedCents) || 0));
    const rate = Math.max(0, Number(commissionRate) || 0);
    const stripeFee = Math.max(0, Math.round(Number(stripeFeeCents) || 0));
    const commission = Math.round(billed * rate);
    const accountantNet = Math.max(0, billed - stripeFee - commission);
    return { billedCents: billed, stripeFeeCents: stripeFee, commissionCents: commission, accountantNetCents: accountantNet };
  }

  return {
    TIERS,
    ONBOARDING_FREE_BELOW,
    REFERRAL_MONTHS_HARD_CAP,
    tierForAccountant,
    commissionRateFor,
    estimateStripeFeeCents,
    splitBilling,
  };
});
