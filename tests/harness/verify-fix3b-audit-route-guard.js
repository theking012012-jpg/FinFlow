'use strict';
/**
 * verify-fix3b-audit-route-guard.js — FIX-3b guard (LC3b). STRUCTURAL (Rule 5: labelled — it reads source text; the
 * executed proof that audited routes write the right rows is verify-fix3-audit-coverage + verify-fix3b-audit-money-routes).
 *
 * The class LC3 / LC3b belonged to — a route that changes data and writes no audit row — shipped silently because
 * nothing noticed a NEW one. This guard enumerates every mutating route (server.js, accountant-routes.js,
 * admin-routes.js; tools/fix-2026-10-19/fix3-enumerate-audited-routes.js) and FAILS when one that writes no audit row is
 * neither EXEMPT (a stated reason it changes no books or access) nor a NUMBERED known gap (LC3g admin, LC3d sign-in / security, LC3f accountant portal and LC3e integrations, closed
 * 2026-10-20 — every admin action now writes the hardened admin_log via adminAudit) (an open finding with an
 * owner decision pending). It also fails when a listed route has started auditing (the list must be kept true).
 *
 *   node tests/harness/verify-fix3b-audit-route-guard.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { enumerate, getWriters } = require(path.join(ROOT, 'tools', 'fix-2026-10-19', 'fix3-enumerate-audited-routes.js'));

// Every mutating route that writes NO audit row, and why. A new unaudited route must be added here WITH a reason —
// or, better, audited.
const ALLOWED = {
  "EXEMPT": {
    reason: "no stored change to books or access: a calculation, a suggestion, a what-if, the business in view, a session switch, a report, a draft, a log line, a Stripe checkout page (the subscription changes only on Stripe's webhook); accountant routes that are disabled (record-commission 410, reactivate-client 403), a live 'typing' signal, a résumé / membership check or AI read that stores nothing, and the three consent routes that audit INSIDE _activateLink (CLIENT_ACTIVATE)",
    routes: [
      "POST /api/accountants/record-commission",
      "POST /api/accountants/reactivate-client",
      "POST /api/accountants/clients/:userId/typing",
      "POST /api/accountants/my-accountant/typing",
      "POST /api/accountants/extract-resume",
      "POST /api/accountants/verify-membership",
      "POST /api/accountants/clients/:userId/ai-insights",
      "POST /api/accountants/my-accountant/approve",
      "POST /api/accountants/approve-request",
      "POST /api/accountants/activate-client",
      "POST /api/ai",
      "POST /api/ai/scan",
      "POST /api/autocat-rules/ai-suggest",
      "POST /api/stripe/checkout",
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
  "EXEMPT-LC3e": {
    reason: "integrations that store no access and no books (LC3e, 2026-10-20 \u2014 connect / disconnect / link / unlink / books-into are recorded at the one connection write path, _mutateSettingsBlob): starting a link flow (a one-time state token, nothing granted until the provider calls back); a display-only read of the provider (a count, a balance, a preview \u2014 a token refresh is not a new connection); verify-after-import (reads and reports); the Mercado Pago / dLocal webhook (the payment it books is recorded inside recordExternalInvoicePayment)",
    routes: [
      "POST /api/${spec.key}/connect-url",
      "POST /api/${spec.key}/sync",
      "POST /api/belvo/widget-token",
      "POST /api/codat/import-preview",
      "POST /api/codat/sync",
      "POST /api/finch/connect-url",
      "POST /api/finch/sync",
      "POST /api/import/verify",
      "POST /api/mercadopago/webhook",
      "POST /api/plaid/link-token",
      "POST /api/stripe/connect-url",
      "POST /api/stripe/sync",
      "POST /api/wise/sync",
      "POST /api/woocommerce/sync",
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

// LC3e-b: a GET that writes (OAuth callbacks store the connection) — invisible to the list above. Each must be audited,
// or listed here with why it changes no books and no access.
const GET_WRITES_EXEMPT = {
  "GET /api/accountants/clients/:userId/message": "read receipt: stamps accountant_last_read only",
  "GET /api/accountants/clients/:userId/messages": "read receipt: stamps accountant_last_read only",
  "GET /api/accountants/my-accountant/messages": "read receipt: stamps client_last_read only",
};
const gw = getWriters(['server.js', 'accountant-routes.js', 'admin-routes.js'].map(f => path.join(ROOT, f)));
const gwStray = [...new Set(gw.filter(r => !r.audited).map(key))].filter(k => !GET_WRITES_EXEMPT[k]);
A(`every GET that writes is audited or exempt (${gw.length} found: ${gw.filter(r => r.audited).length} audited)`, gwStray.length === 0, 'unlisted: ' + gwStray.join(' · '));
const gwStale = Object.keys(GET_WRITES_EXEMPT).filter(k => !gw.some(r => !r.audited && key(r) === k));
A('no listed GET writer has started auditing or disappeared', gwStale.length === 0, 'stale: ' + gwStale.join(' · '));
console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
