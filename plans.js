// ── FinFlow plans — SINGLE SOURCE OF TRUTH (A0 / D-A, owner decisions 2026-10-23) ─────────────────────────────────
// What each plan costs, its limits and what it includes. Read by:
//   server   — entity limit, AI caps (ai-cap.js), Pro invoice fair-use ceiling, team seats, feature gates
//   browser  — /plans.js: the in-app plan cards + plan comparison, the client-side gates, the upgrade prompts
//   landing  — scripts/gen-plan-cards.js writes the landing page's plan cards and comparison from this file
// verify-plans-one-source fails if any surface states something this file does not.
// Change a plan HERE; then `npm run gen` (rewrites the landing cards) — never edit a card by hand.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FinFlowPlans = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const UNLIMITED = null;   // a limit of null means no limit

  // seats = people who can CHANGE the books, not counting the owner. Viewers (read-only) and accountants are free and
  // unlimited on every plan (D-C). Pending invites count toward seats.
  // ai = monthly AI questions; scans = monthly receipt scans (env-tunable in ai-cap.js — the defaults live here).
  // invoiceCeiling = a fair-use ceiling on invoices created per month (anti-abuse; null = none).
  // annualMonthly = the per-month price when billed yearly (20% off, D-B); the year costs annualMonthly × 12.
  const PLANS = {
    trial: {
      id: 'trial', name: 'Free trial', monthly: 0, annualMonthly: 0, days: 30,
      entities: 1, seats: 15, ai: 30, scans: 3, invoiceCeiling: UNLIMITED,
      features: { invoicing: true, bankSync: true, scanner: true, stripeFeed: true, budgets: true, multiCurrency: true,
                  roles: true, auditTrail: true, mrr: true, saasMetrics: true, consolidation: false },
    },
    pro: {
      id: 'pro', name: 'Pro', monthly: 79, annualMonthly: 63,
      entities: 1, seats: 3, ai: 500, scans: 15, invoiceCeiling: 500,
      features: { invoicing: true, bankSync: true, scanner: true, stripeFeed: true, budgets: true, multiCurrency: true,
                  roles: true, auditTrail: true, mrr: false, saasMetrics: false, consolidation: false },
    },
    business: {
      id: 'business', name: 'Business', monthly: 249, annualMonthly: 199,
      entities: 5, seats: 15, ai: 2000, scans: 50, invoiceCeiling: UNLIMITED,
      features: { invoicing: true, bankSync: true, scanner: true, stripeFeed: true, budgets: true, multiCurrency: true,
                  roles: true, auditTrail: true, mrr: true, saasMetrics: true, consolidation: true },
    },
    scale: {
      id: 'scale', name: 'Scale', monthly: 400, annualMonthly: 320,
      entities: 10, seats: UNLIMITED, ai: 5000, scans: 100, invoiceCeiling: UNLIMITED,
      features: { invoicing: true, bankSync: true, scanner: true, stripeFeed: true, budgets: true, multiCurrency: true,
                  roles: true, auditTrail: true, mrr: true, saasMetrics: true, consolidation: true },
    },
  };
  const PAID = ['pro', 'business', 'scale'];

  // Unknown / missing / legacy plan strings resolve to the trial row (the lowest), never to a paid plan.
  function planFor(plan) { const p = String(plan || '').toLowerCase(); return PLANS[p] || PLANS.trial; }
  function has(plan, feature) { return !!planFor(plan).features[feature]; }
  function limit(plan, key) { return planFor(plan)[key]; }   // null = unlimited

  const n = v => Number(v).toLocaleString('en-US');
  // The lines a plan card shows — one wording for the landing page, the in-app cards and the comparison.
  function cardLines(plan) {
    const p = planFor(plan);
    const L = [];
    L.push(p.entities === 1 ? '1 business' : 'Up to ' + p.entities + ' businesses, each with its own books');
    L.push(p.seats == null ? 'Unlimited team members' : p.seats + ' team members plus you');
    L.push('Viewers and your accountant free');
    L.push(n(p.ai) + ' AI questions + ' + n(p.scans) + ' receipt scans a month');
    if (p.features.bankSync) L.push('Bank sync via Plaid');
    if (p.features.invoicing) L.push('Invoices, quotes and bills' + (p.invoiceCeiling ? ' (fair use: ' + n(p.invoiceCeiling) + ' invoices a month)' : ''));
    if (p.features.mrr) L.push('MRR and SaaS metrics');
    if (p.features.consolidation) L.push('Consolidated view across your businesses');
    return L;
  }
  // The comparison table: rows of [label, value per plan] — values are text ('✓', '—', numbers).
  function comparisonRows() {
    const ids = PAID, P = ids.map(i => PLANS[i]);
    const yes = b => (b ? '✓' : '—');
    return [
      ['Price, billed monthly', P.map(p => '$' + n(p.monthly) + ' / month')],
      ['Price, billed yearly (20% off)', P.map(p => '$' + n(p.annualMonthly * 12) + ' / year')],
      ['Businesses (separate books)', P.map(p => n(p.entities))],
      ['Team members who can edit (plus you)', P.map(p => p.seats == null ? 'Unlimited' : n(p.seats))],
      ['Viewers and your accountant', P.map(() => 'Free, unlimited')],
      ['AI questions a month', P.map(p => n(p.ai))],
      ['Receipt scans a month', P.map(p => n(p.scans))],
      ['Invoices a month', P.map(p => p.invoiceCeiling ? 'Fair use: ' + n(p.invoiceCeiling) : 'No limit')],
      ['Bank sync via Plaid', P.map(p => yes(p.features.bankSync))],
      ['Receipt scanner', P.map(p => yes(p.features.scanner))],
      ['Stripe payments feed', P.map(p => yes(p.features.stripeFeed))],
      ['Budgets against actuals', P.map(p => yes(p.features.budgets))],
      ['Multi-currency', P.map(p => yes(p.features.multiCurrency))],
      ['Roles and an audit trail that cannot be edited', P.map(p => yes(p.features.roles && p.features.auditTrail))],
      ['MRR and SaaS metrics', P.map(p => yes(p.features.mrr))],
      ['Consolidated view across businesses', P.map(p => yes(p.features.consolidation))],
    ];
  }
  return { PLANS, PAID, UNLIMITED, planFor, has, limit, cardLines, comparisonRows };
});
