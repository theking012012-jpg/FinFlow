'use strict';
/**
 * verify-fix3b-audit-route-guard.js — FIX-3b guard (LC3b). STRUCTURAL (Rule 5: labelled — it reads source text; the
 * executed proof that audited routes write the right rows is verify-fix3-audit-coverage + verify-fix3b-audit-money-routes).
 *
 * The class LC3 / LC3b belonged to — a route that changes data and writes no audit row — shipped silently because
 * nothing noticed a NEW one. This guard enumerates every mutating route (server.js, accountant-routes.js,
 * admin-routes.js; tools/fix-2026-10-19/fix3-enumerate-audited-routes.js) and FAILS when one that writes no audit row is
 * neither EXEMPT (a stated reason it changes no books or access) nor a NUMBERED known gap (an open finding with an
 * owner decision pending). It also fails when a listed route has started auditing (the list must be kept true).
 *
 *   node tests/harness/verify-fix3b-audit-route-guard.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { enumerate } = require(path.join(ROOT, 'tools', 'fix-2026-10-19', 'fix3-enumerate-audited-routes.js'));

// Every mutating route that writes NO audit row, and why. A new unaudited route must be added here WITH a reason —
// or, better, audited.
const ALLOWED = {
  "EXEMPT": {
    reason: "no stored change to books or access: a calculation, a suggestion, a what-if, the business in view, a session switch, a report, a draft, a log line",
    routes: [
      "POST /api/ai",
      "POST /api/ai/scan",
      "POST /api/autocat-rules/ai-suggest",
      "POST /api/cogs/calculate",
      "POST /api/csp-report",
      "POST /api/entities/:id/activate",
      "POST /api/help/ask",
      "POST /api/my-access/switch",
      "POST /api/payment-reminders/draft",
      "POST /api/reports/balance-sheet",
      "POST /api/reports/cash-flow",
      "POST /api/reports/profit-loss",
      "PUT /api/scenario",
    ],
  },
  "LC3c": {
    reason: "personal side \u2014 owner decision first: the audit trail is shown on a business page (the personal / business wall)",
    routes: [
      "DELETE /api/goals/:id",
      "DELETE /api/holdings/:id",
      "DELETE /api/personal-accounts/:id",
      "DELETE /api/personal-transactions/:id",
      "DELETE /api/recurring-personal-transactions/:id",
      "POST /api/goals",
      "POST /api/holdings",
      "POST /api/personal-accounts",
      "POST /api/personal-transactions",
      "POST /api/recurring-personal-transactions",
      "POST /api/snapshots/capture",
      "PUT /api/goals/:id",
      "PUT /api/holdings/:id",
      "PUT /api/personal-accounts/:id",
      "PUT /api/personal-bank",
      "PUT /api/personal-transactions/:id",
      "PUT /api/recurring-personal-transactions/:id",
    ],
  },
  "LC3d": {
    reason: "sign-in / security events \u2014 a security-log question, not the books trail",
    routes: [
      "DELETE /api/auth/account",
      "POST /api/auth/forgot-password",
      "POST /api/auth/logout",
      "POST /api/auth/mfa/disable",
      "POST /api/auth/mfa/enable",
      "POST /api/auth/mfa/setup",
      "POST /api/auth/register",
      "POST /api/auth/reset-password",
      "POST /api/stripe/checkout",
    ],
  },
  "LC3e": {
    reason: "integrations connect / disconnect / sync \u2014 imports book records through their own paths; audit design pending",
    routes: [
      "POST /api/${ckey}/connect",
      "POST /api/${ckey}/disconnect",
      "POST /api/${spec.key}/connect-url",
      "POST /api/${spec.key}/disconnect",
      "POST /api/${spec.key}/sync",
      "POST /api/belvo/disconnect",
      "POST /api/belvo/exchange",
      "POST /api/belvo/sync",
      "POST /api/belvo/widget-token",
      "POST /api/codat/disconnect",
      "POST /api/codat/import-preview",
      "POST /api/codat/link-url",
      "POST /api/codat/sync",
      "POST /api/connections",
      "POST /api/finch/connect-url",
      "POST /api/finch/disconnect",
      "POST /api/finch/sync",
      "POST /api/import/verify",
      "POST /api/integration-requests",
      "POST /api/mercadopago/webhook",
      "POST /api/plaid/exchange",
      "POST /api/plaid/link-token",
      "POST /api/plaid/sync",
      "POST /api/plaid/unlink",
      "POST /api/stripe/binding",
      "POST /api/stripe/connect-url",
      "POST /api/stripe/disconnect",
      "POST /api/stripe/sync",
      "POST /api/wipay/connect",
      "POST /api/wipay/disconnect",
      "POST /api/wise/sync",
      "POST /api/woocommerce/connect",
      "POST /api/woocommerce/disconnect",
      "POST /api/woocommerce/sync",
    ],
  },
  "LC3f": {
    reason: "accountant portal routes (accountant-routes.js) \u2014 separate review",
    routes: [
      "DELETE /api/accountants/deadlines/:id",
      "DELETE /api/accountants/tasks/:id",
      "POST /api/accountant-messages",
      "POST /api/accountants/activate-client",
      "POST /api/accountants/approve-request",
      "POST /api/accountants/clients/:userId/ai-insights",
      "POST /api/accountants/clients/:userId/typing",
      "POST /api/accountants/deadlines",
      "POST /api/accountants/extract-resume",
      "POST /api/accountants/kyc/start",
      "POST /api/accountants/logout",
      "POST /api/accountants/mfa/disable",
      "POST /api/accountants/mfa/enable",
      "POST /api/accountants/mfa/setup",
      "POST /api/accountants/my-accountant/approve",
      "POST /api/accountants/my-accountant/attach",
      "POST /api/accountants/my-accountant/messages",
      "POST /api/accountants/my-accountant/proposals/:id/respond",
      "POST /api/accountants/my-accountant/tasks/:id/done",
      "POST /api/accountants/my-accountant/typing",
      "POST /api/accountants/proposals/:id/withdraw",
      "POST /api/accountants/reactivate-client",
      "POST /api/accountants/record-commission",
      "POST /api/accountants/register",
      "POST /api/accountants/report",
      "POST /api/accountants/request-access",
      "POST /api/accountants/review",
      "POST /api/accountants/run-monthly-payouts",
      "POST /api/accountants/stripe-connect",
      "POST /api/accountants/verify-membership",
    ],
  },
  "LC3g": {
    reason: "admin routes (admin-routes.js) \u2014 separate review (admin actions on users / accountants)",
    routes: [
      "DELETE /api/admin/users/:id",
      "POST /api/admin/accountants/:id/preferred",
      "POST /api/admin/accountants/:id/preferred-partner",
      "POST /api/admin/accountants/:id/verify",
      "POST /api/admin/audit-anomalies/notify",
      "POST /api/admin/broadcast",
      "POST /api/admin/earnings/mark-paid",
      "POST /api/admin/flags/:id/resolve",
      "POST /api/admin/login",
      "POST /api/admin/logout",
      "POST /api/admin/operating-costs",
      "POST /api/admin/reports/:id/dismiss",
      "POST /api/admin/reports/:id/resolve",
      "POST /api/admin/support/:id",
      "POST /api/admin/users/:id/plan",
      "POST /api/admin/users/:id/suspend",
      "POST /api/admin/users/:id/unsuspend",
    ],
  },
};

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
console.log('\nFIX-3b — STRUCTURAL: no mutating route writes nothing to the audit trail without a stated reason\n');
const all = enumerate(['server.js', 'accountant-routes.js', 'admin-routes.js'].map(f => path.join(ROOT, f)));
const key = r => r.method + ' ' + r.path;
const allowed = new Map();
for (const [k, g] of Object.entries(ALLOWED)) for (const r of g.routes) allowed.set(r, k);
const unaudited = [...new Set(all.filter(r => !r.audited).map(key))];
const audited = new Set(all.filter(r => r.audited).map(key));
A(`routes found (${all.length}: ${audited.size} audited, ${unaudited.length} not)`, all.length > 200);
const stray = unaudited.filter(k => !allowed.has(k));
A('every unaudited mutating route is exempt with a reason or a numbered known gap', stray.length === 0, 'unlisted: ' + stray.join(' · '));
const stale = [...allowed.keys()].filter(k => !unaudited.includes(k));
A('no listed route has started auditing or disappeared (keep the list true)', stale.length === 0, 'stale: ' + stale.join(' · '));
for (const [k, g] of Object.entries(ALLOWED)) console.log(`     ${k.padEnd(6)} ${String(g.routes.length).padStart(3)}  ${g.reason}`);
console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
