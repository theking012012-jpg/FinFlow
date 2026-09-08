# FinFlow — Session Handover · 2026-09-08

Covers the per-entity connections arc, the Wave-1 integration build, and a full launch-readiness QA
pass (code + live visual). Full sweep after all of this: **209/209 GREEN, 0 RED**. All connector +
QA harnesses run under `node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js`.

---

## 1. Per-entity connections arc — COMPLETE

Every connector is now **per-entity**: each business links its own account; a legacy account-level
connection (entity_id NULL) still resolves via fallback so nothing breaks on deploy. Storage is keyed
on the `user_settings.entity_id` column.

- **Helpers (server.js):** `_providerBlobE(uid,key,entityId,fallback=true)` / `_saveProviderBlobE(uid,key,value,entityId)`
  (single-blob providers) and `_getPlaidItemsE` / `_savePlaidItemsE` (Plaid's item-list blob). The old
  account-level `_providerBlob` / `_saveProviderBlob` / `_getPlaidItems` were removed (fully dead).
- **Read pattern:** status/sync/connect reads use `fallback=true` (claim-legacy-forward on first write);
  disconnect uses `fallback=false` (a business clears only its own — never the shared legacy blob).
- **Converted:** Stripe (prior session), Finch, Codat, Belvo, WiPay, Plaid, dLocal, Mercado Pago, Wise.
  - `_codatCompany(uid, entityId)` threads the entity; WiPay's public callback resolves by the invoice's
    `entity_id`; the invoice payment-link resolver picks the processor for the invoice's own business.
  - Plaid needed no migration: the `personal_transactions` idempotency guard (`plaid_txn_id` scoped by
    `user_id`) already prevents cross-entity double-booking.
- **Client (index.html):** Connections page re-hydrates on page-show and on entity switch; the Banking
  linked-bank strip repaints on switch.
- **Proof:** verify-connections-entity-scope 23/0, verify-plaid-entity-scope 12/0,
  verify-creds-connectors-entity-scope 17/0, verify-stripe-conn-entity-scope 5/0 (all RED-proven).

## 2. Wave-1 integrations — shared OAuth driver + 8 net-new connectors

A shared `registerOAuthConnector(spec)` factory (server.js) registers `/api/<key>/{status,connect-url,
callback,sync,disconnect}` per OAuth2 provider — per-entity, encTok'd tokens, auto-refresh, honest
not-configured/not-connected states, DISPLAY-ONLY sync. Optional spec hooks cover the variants:
`tokenAuth:'body'`, `tokenFormat:'json'`, `authTokenUrl(req)` (per-DC host), `authorizeUrlFor(req)`
(per-shop host), `expiresAt(t)` (absolute expiry), and an account-resolver that may return extra fields.

| Provider | Notes | Harness |
|---|---|---|
| QuickBooks | realmId from callback; QBO_ENV sandbox/prod | 22/0 |
| Xero | tenantId via /connections; Xero-tenant-id header | 21/0 |
| Zoho Books | multi-datacenter (accounts-server → zohoapis.<dc>) | 20/0 |
| Square | JSON-body token exchange; merchant_id; absolute expiry | 17/0 |
| PayPal | connect+identity only (txn scope app-review gated) | 15/0 |
| Coinbase | CB-VERSION header; ties to Investments | 15/0 |
| Shopify | per-shop OAuth, myshopify.com-validated (SSRF-guarded) | 19/0 |
| WooCommerce | bespoke per-store REST keys (not OAuth) | 14/0 |

Wise + Mercado Pago already existed as credential connectors. **13 real connector backends total.**
The ~730 remaining catalogue logos stay browse-only "Request". To go live each OAuth provider needs its
Railway env keys + a redirect URI registered in the provider dashboard; they degrade honestly until set.

## 3. Launch-readiness QA pass (code + live visual) — fixes shipped 2026-09-08

Walked landing → app → connections → marketplace → accountant portal (visual) plus a full code audit.
The app was already in strong shape; fixes shipped:

**Security / trust**
- **Fabricated reviews FIXED.** `leaveReview()` used to POST a hardcoded 5★ + empty comment;
  `reportAccountant()` sent a canned reason. Both now use a real modal (`window._marketModal`) that
  captures the user's actual star rating (required) and text. Harness: verify-marketplace-review-modal 7/0.
- **Stored XSS on the accountant dashboard FIXED.** `accountant-dashboard.html` interpolated client
  names/emails/deadline text into innerHTML with no escaping. Added an `esc()` helper and wrapped every
  user-derived field (the client-books page already escaped). Harness: verify-accountant-dashboard-qa 8/0
  (RED-proven — raw interpolation injected a live `<img>`).

**Accountant portal**
- **Mobile navigation FIXED** on both accountant pages: the dashboard sidebar was `display:none` under
  900px with no replacement (pages unreachable); the client-books 220px sidebar never collapsed
  (squeezed the books to ~150px). Both now slide in as an overlay via a hamburger + scrim.
- **Overdue deadlines FIXED.** `renderDeadlines()` filtered to `date >= today`, so overdue filings
  vanished. Now overdue items show first with the "overdue" label; the stat counts overdue + due-in-30.
- Native `confirm()` in decline/reject replaced with a styled modal; Stripe banner no longer overlaps
  the page header (main content padded when a banner shows).

**Web hygiene / polish**
- **Legal pages created** — `/terms.html`, `/privacy.html`, `/security.html` (standard SaaS copy; have
  counsel review before relying on them). All dead `#` footer/register links wired (landing,
  accountants.html, accountant-register.html); empty marketing links (About/Blog/Changelog) removed.
- Landing hero mock URL `finflow-production-dab1…` → `app.finflow.io`.
- Duplicate "Investments" nav label → "Business investments" / "Personal investments".
- Client Portal "Coming Soon" green ✓ ticks → neutral bullets.
- Dashboard 5th KPI card (Investments) spans full width (no orphaned cell).
- Marketplace directory now distinguishes fetch-error from empty ("Couldn't load — try again" vs
  "No accountants listed yet"); removed a leftover console.log and a stale "COMING SOON" comment.

**Verified NOT bugs:** the "✓ Verified" accountant badge (directory query is `WHERE status='verified'`,
so only admin-approved accountants list); `/api/me` (real alias).

**Deferred (needs backend, not shipped):** accountant-portal "Forgot password?" — there is no
accountant password-reset route yet, so a link would be dead; add the route first.

---

## Still open (pre-existing, not connector/QA)
- **Mobile performance** — app ships ~750KB unminified JS (app-main.js + finflow-bundle.js); Lighthouse
  mobile Perf ~54. Minification is the biggest untouched win.
- **Live bank feed** — Belvo/WiPay auto-populating bank debits (today via OFX/CSV import).
- **Email launch blocker (owner/ops)** — verify a domain in Resend + set `EMAIL_FROM`, else real users
  get no password-reset email.
- **Provider go-live (owner/ops)** — Railway env keys + redirect URIs for the new connectors.
