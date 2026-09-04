# FinFlow — Integrations Wave 1: Implementation Plan (fresh-session handoff)

**Written 2026-09 by the audit/Stripe-feed session. You (the executing session) have NO prior context — read §0 fully before writing any code.** This plan is self-contained and grounded in the actual codebase. Follow it in order; each provider is its own commit + harness.

---

## 0. ORIENTATION — read first

**What this is:** FinFlow is a production accounting/finance SaaS on Railway (auto-deploys on `git push` to `main`). Repo: `C:\Users\theki\OneDrive\Desktop\finflow-FINAL7 (4)`. Live: https://finflow-production-dab2.up.railway.app/app.

**Non-negotiable rules — READ THESE FILES BEFORE CODING:**
1. `CLAUDE.md` — the 14 project rules. They override your defaults. Especially: Rule 1 (find the runtime winner before editing a client fn — wiring overrides app-main), Rule 2/12 (integrations are DISPLAY-ONLY; never auto-write provider data into the books without an owner-approved import step), Rule 4/14 (every change ships with a DISCRIMINATING harness — red on the pre-change code, green after), Rule 8 (one logical change per commit; data changes owner-gated).
2. `SESSION_STATUS_2026-09-02.md` + `OUTSTANDING.md` — current state.
3. `INTEGRATIONS_STATUS.md` — per-connector env truth.

**How to run/verify (harness discipline):**
- Harnesses live in `tests/harness/verify-*.js`, auto-discovered by `run-verification-sweep.js`. Each boots real embedded Postgres.
- Run one: `node -r ./tests/harness/clock.js tests/harness/verify-XXX.js` (clock pinned 2026-07-25, America/Port_of_Spain).
- **Run the FULL sweep green BEFORE handing the owner a commit** — the gate goes before deploy, always.
- **You do NOT commit.** The OneDrive mount blocks git; the OWNER runs commits in PowerShell. Every commit block you hand them must start with `del .git\index.lock`. Give them exact PowerShell, one logical change per commit.

**Ship-direct vs bundled:**
- Ship-direct (edit → live, NO bundle step): `server.js`, `public/index.html`, `public/app-main.js`, `public/finflow-dates.js`.
- Bundled (edit the source, then `node bundle.js`, then commit the regenerated `public/finflow-bundle.js`): the 10 `public/finflow-api-wiring-*.js` files.
- The connector work is almost entirely `server.js` + `public/index.html` = **ship-direct, no bundle rebuild.**

**THE REFERENCE IMPLEMENTATION — copy these patterns:** In this same session we built the Stripe live feed. Study it before starting:
- Server: `GET /api/stripe/feed` + `/api/stripe/connect-url` + `/api/stripe/callback` + `/api/stripe/status` + `/api/stripe/sync` (all in `server.js`, grep `stripe`).
- Harness template: `tests/harness/verify-stripe-feed.js` — it mocks the Stripe HTTP boundary via `global.fetch`, seeds a provider connection blob, and asserts the mapped result. **Every provider harness in this plan is a copy of this file with the provider swapped.**

---

## 1. GOAL & SCOPE

Build **one shared OAuth-connector driver**, then wire **10 Wave-1 providers** on it so users can connect their own accounts (payments, accounting-migration, e-commerce, cross-border, crypto) with NO API-key entry — they click "Connect", authorize in the provider's own popup, done.

**Wave 1 (owner-approved, regions = US/CA/UK/EU + Caribbean + LatAm):**
QuickBooks, Xero, Zoho Books, Square, PayPal, Shopify, WooCommerce, Wise, Mercado Pago, Coinbase.

**Honest scoping — say this to the owner, don't hide it:** "code-done" (built + harness-green + deployed) is on our schedule. "Live to real users" also needs each provider to approve FinFlow's PRODUCTION app — sandbox/dev is instant, production review timelines are the provider's, not ours.

---

## 2. WHAT ALREADY EXISTS — REUSE, do not rebuild

**Client (public/index.html):**
- `window.ffConnectProvider(cfg)` (~line 4449) — the generic OAuth popup+poll helper. `cfg = { urlEndpoint, urlKey, statusEndpoint, onConnected }`: POSTs `urlEndpoint`, opens `window.open(cfg.urlKey URL, 'ff-connect', 600x760)`, polls `statusEndpoint` until `{connected:true}`, then `onConnected(status)`. **Every OAuth provider's client side = one line calling this.**
- `window.ffConnectCreds(key, onConnected)` (~4389) — for API-KEY providers (no OAuth popup; posts creds to a save endpoint). Use for Wise/WooCommerce.
- Connector registry `const INTEGRATIONS=[{name,cat,desc},…]` (~2452) + the click router (~2677) that routes a known provider name to its connect flow. **Making a connector "live" = add its case in that router.** Finch/Codat/Stripe cases are the model (2678-2680).

**Server (server.js):**
- `_providerBlob(uid, key)` / `_saveProviderBlob(uid, id, key, value)` (~5021) — per-user connection storage in `user_settings` (data = {key, value}; value is a JSON string). Convention: key = `'<provider>_conn'`.
- `encTok(plain)` / `decTok(stored)` (~4866) — AES-256-GCM token encryption at rest, keyed by `CONNECTOR_ENC_KEY`. **Store every access/refresh token via `encTok()`. Never log tokens.**
- `xConfigured()` pattern (e.g. `stripeConnectConfigured` ~5420, `plaidConfigured` ~4832) — gate on env vars.
- Working OAuth examples to mirror: Stripe (`/api/stripe/connect-url` → `/api/stripe/callback`), Finch (`/api/finch/connect-url`).
- The callback returns a tiny HTML page that `postMessage`s the opener and closes — copy the Stripe callback's HTML.

**Harness (tests/harness/):**
- `verify-stripe-feed.js` — the template. Mocks `global.fetch` for the provider URL, sets `process.env.HARNESS_KEEP_STRIPE='1'` + the provider env keys BEFORE `bootServer` (boot.js scrubs provider env otherwise — check `tests/harness/boot.js` for the scrub list and add your provider's keys to the keep path if needed, OR just set them before boot).

---

## 2.5 RECONCILE-TO-BOOKS LAYER — FIRST-CLASS, NOT OPTIONAL (build alongside every PAYMENTS provider)

A connected payments provider that only *shows* transactions is a dashboard widget, not accounting.
Every payments provider in Wave 1 MUST let the owner turn a synced transaction into a real book entry
(revenue), or it does not count as done. This layer already exists for Stripe — copy it verbatim.

**The shipped Stripe pattern (the template — server.js `/api/stripe/feed` + `/api/stripe/import-charge`,
client `startStripeFeed` + `window.ffImportStripeCharge`, harness `verify-stripe-import.js`):**

1. **Feed annotates `inBooks`.** The feed endpoint, after mapping the provider's transactions, batch-queries
   `sales_receipts` for the idempotency keys `'<provider>-charge:'+id` and sets `c.inBooks = true/false` on
   each row. Best-effort (wrap in try/catch) — the import stays idempotent regardless. This is what lets the
   UI show "✓ in books" vs an "Add to books" button, and never invite a double-post.

2. **Owner-approved per-transaction import (DISPLAY→BOOKS is explicit, Rules 2 & 12 — never automatic).**
   `POST /api/<provider>/import-charge` (requireAuth):
   - **Idempotency guard FIRST:** `SELECT sales_receipts WHERE data->>'idempotency_key' = '<provider>-charge:'+id`.
     If found → return `{ok:true, duplicate:true, receipt}`. NEVER a second row.
   - **Re-fetch the transaction from the provider** (authoritative amount/status — NEVER trust the client body;
     the client sends only the id).
   - Guard: only a succeeded / non-refunded transaction can be booked (else 400).
   - `db.insert('sales_receipts', { user_id, entity_id: req.entityId, customer, num, amount, date (the txn's
     own date), method:'Card (<Provider>)', notes:'Imported from <Provider> · '+id, idempotency_key })`.
   - `recordAudit(... action:'CREATE' ...)`. sales_receipts counts as revenue → flows to /api/reports, the
     dashboard and every P&L/cashflow surface automatically (no extra wiring).
   - Recover a 23505 (unique-index race) by returning the original row, same as the sales-receipts POST.

3. **Client:** the feed row shows an "Add to books" button for `!c.inBooks && succeeded && !refunded`, a
   "✓ in books" tag otherwise. `window.ff<Provider>Import(id, btn)` POSTs the endpoint, then calls
   `startFeed()` + `window.refreshFinancials?.()` + `window.updateDashboard?.()` so the new revenue shows
   immediately.

4. **Harness (copy `verify-stripe-import.js`) — the money-integrity bar. MUST prove, red→green:**
   feed `inBooks` flags correct; import creates exactly ONE sales_receipt with the re-fetched amount; revenue
   on `/api/reports` rises by exactly that amount; **re-import returns duplicate and revenue does NOT move
   (no double-count)**; a failed/refunded txn is rejected; a malformed id is rejected. Seed an `is_active`
   entity (sales_receipts is entity-required). Use transaction dates INSIDE the clock-pinned reports year
   (2026), and read revenue off `/api/reports` key `revenue` (not `totalRevenue`).

**FAST-FOLLOW (note in the provider's commit, do NOT block Wave 1 on it): match-to-invoice.** A provider
charge that paid a FinFlow invoice via a pay-link is recorded separately by the webhook, keyed on the
checkout-session id — NOT the charge/payment_intent — so it cannot be auto-matched today, and the owner
imports per charge. To make auto-dedup airtight: store the provider's `payment_intent`/`charge_id` on
`invoice_payments` at webhook time, then the import can detect "already applied to invoice X" and offer
*match* instead of *new receipt*. Until then, per-charge owner approval is the safe model (idempotent, no
double-count).

---

## 3. BUILD THE SHARED DRIVER FIRST

Add to `server.js` a factory that, given a spec, registers the 4 standard endpoints so each OAuth2 provider is ~a config object + a sync mapper (not a full hand-roll).

```
// registerOAuthConnector(spec) — generates /api/<key>/connect-url, /callback, /status, /sync
// spec = {
//   key,                // 'quickbooks'  -> blob key '<key>_conn', routes /api/<key>/*
//   label,              // 'QuickBooks'
//   clientIdEnv, secretEnv,        // env var NAMES for the platform keys
//   authorizeUrl,       // provider OAuth authorize base
//   tokenUrl,           // token exchange/refresh endpoint
//   scopes,             // space- or comma-joined scope string
//   redirectPath,       // '/api/<key>/callback' (absolute built from APP_URL)
//   accountFromToken,   // (tokenResp, req) => account id (e.g. realmId, tenant, shop) — provider-specific
//   extraAuthParams,    // optional {} merged into the authorize query
//   refreshable,        // true if tokens expire (QB/Xero/Zoho/Square = true)
//   sync,               // async (conn, {req}) => ({ rows, total, ... })  — DISPLAY-ONLY mapping
// }
```
Behavior:
- `configured()` = both env vars present. Every endpoint returns an honest not-configured/not-connected shape (mirror the Stripe feed: `{configured:false|true, connected:false, ...}`), NEVER a fabricated success.
- `POST /connect-url`: build authorize URL (client_id, redirect_uri=APP_URL+redirectPath, scope, state=scopeId(req), response_type=code, +extraAuthParams). Return `{connect_url}`.
- `GET /callback`: exchange `code` at `tokenUrl` (POST, client_id/secret, redirect_uri, grant_type=authorization_code). Store `_saveProviderBlob(uid, id, '<key>_conn', {access_token:encTok(a), refresh_token:encTok(r), account: accountFromToken(...), expires_at, connected_at})`. Return the close-popup HTML (copy Stripe's).
- `GET /status`: `{configured, connected: !!blob.account||!!blob.access_token, account}`.
- `POST /sync` (or `/feed`): decTok the token, refresh if expired (POST tokenUrl grant_type=refresh_token; re-store), call `spec.sync(conn,…)`, return the mapped rows. Wrap provider HTTP in try/catch → 502 with a real message (never swallow → Rule 7).
- Add a shared `oauthRefresh(spec, conn, uid, id)` helper for the refresh path.

**Prove the driver by wiring QuickBooks + Xero on it (below) before touching anything else.**

Client for each OAuth provider = add a case in the index.html click router (~2677):
```
if(n==='QuickBooks'){ if(window.ffConnectProvider) window.ffConnectProvider({urlEndpoint:'/api/quickbooks/connect-url',urlKey:'connect_url',statusEndpoint:'/api/quickbooks/status',onConnected:function(){hydrateStates();}}); return; }
```

---

## 4. PER-PROVIDER SPECS

For EACH: before coding, WEB-SEARCH the provider's current OAuth/API docs to confirm the authorize URL, token URL, and exact scope strings (they drift — do not trust these verbatim). All syncs are DISPLAY-ONLY.

**Fits the generic OAuth2 driver:**
- **QuickBooks** (Intuit). Env: `QBO_CLIENT_ID`,`QBO_CLIENT_SECRET`. Authorize: appcenter.intuit.com/connect/oauth2. Token: oauth.platform.intuit.com/oauth2/v1/tokens/bearer. Scope: `com.intuit.quickbooks.accounting`. account = `realmId` (comes back on the callback query, not the token — capture `req.query.realmId`). Sandbox instant. Sync: pull recent invoices + expenses + accounts (for MIGRATION — the top growth lever). refreshable:true (100-day refresh token).
- **Xero**. Env: `XERO_CLIENT_ID`,`XERO_CLIENT_SECRET`. Authorize: login.xero.com/identity/connect/authorize. Token: identity.xero.com/connect/token. Scopes: `openid profile email accounting.transactions.read accounting.settings.read offline_access`. account = tenantId from GET api.xero.com/connections after token. refreshable:true (30-min access, 60-day refresh). Sync: invoices/bank transactions.
- **Zoho Books**. Env: `ZOHO_CLIENT_ID`,`ZOHO_CLIENT_SECRET`. Region data centers (.com/.eu/.in/.com.au) — capture the DC from the callback and store it (API base differs per DC). Scope: `ZohoBooks.fullaccess.READ`. account = organization_id. refreshable:true. Sync: invoices/expenses.
- **Square**. Env: `SQUARE_APP_ID`,`SQUARE_APP_SECRET`. Authorize: connect.squareup.com/oauth2/authorize. Token: /oauth2/token. Scopes: `PAYMENTS_READ ORDERS_READ MERCHANT_PROFILE_READ`. account = merchant_id. Sync: payments list. Sandbox instant.
- **Shopify**. Per-SHOP OAuth: the shop domain is an input (user types `mystore.myshopify.com`), authorize at `https://{shop}/admin/oauth/authorize`. Env: `SHOPIFY_API_KEY`,`SHOPIFY_API_SECRET`. Scope: `read_orders`. account = shop domain. Sync: orders. (Driver needs a `shopDomain` input path — small variant; handle a `shop` param on connect-url.)
- **Coinbase**. Env: `COINBASE_CLIENT_ID`,`COINBASE_CLIENT_SECRET`. Authorize: login.coinbase.com/oauth2/auth. Token: /oauth2/token. Scope: `wallet:accounts:read wallet:transactions:read`. Sync: accounts + recent transactions → ties into the Investments module. (Read-only.)
- **Mercado Pago**. Env: `MP_CLIENT_ID`,`MP_CLIENT_SECRET`. Authorize: auth.mercadopago.com/authorization. Token: api.mercadopago.com/oauth/token. LatAm. account = user_id. Sync: payments search. refreshable:true.
- **PayPal**. OAuth "Log in with PayPal" / Connect. Env: `PAYPAL_CLIENT_ID`,`PAYPAL_CLIENT_SECRET`. NOTE: reading a user's transactions needs the Transaction Search API + the user granting scope — verify current scope availability in docs; if per-user txn read is gated, fall back to the owner's own PayPal via client-credentials for now and mark user-connect as "later". Sandbox instant.

**Bespoke (do NOT force onto the OAuth driver):**
- **Wise** — API TOKEN, not OAuth. Use `ffConnectCreds` client-side: the user pastes their Wise API token; server stores it encTok'd; sync = GET profiles → balances/statement. Env: none (per-user token).
- **WooCommerce** — per-STORE consumer key/secret generated by the store owner in WP admin. Use `ffConnectCreds`: user provides store URL + consumer key + secret; server stores encTok'd; sync = GET /wp-json/wc/v3/orders with those creds. No platform key.

---

## 5. BUILD SEQUENCE — each is its OWN commit + harness

1. **Shared OAuth driver + QuickBooks + Xero** (proof the driver works; migration is the top lever). Two commits (driver+QBO, then Xero) or one if tight — but a harness each.
2. **Zoho, Square, PayPal.**
3. **Shopify, WooCommerce.**
4. **Coinbase, Mercado Pago, Wise.**

Per provider, the loop:
1. Add the spec/config in `server.js` (or bespoke endpoints) — ship-direct.
2. Add the client case in the index.html connector router — ship-direct.
3. Write `tests/harness/verify-<provider>-connect.js` (copy verify-stripe-feed.js): mock the provider token + data HTTP boundary; assert connect-url is built with the right scopes/redirect, callback stores an encTok'd token + account, status flips to connected, sync maps the sample payload. **Confirm it's RED against the pre-change code first, then GREEN.**
4. Run the FULL sweep → all green.
5. Hand the owner the PowerShell commit block (`del .git\index.lock` first; add server.js + public/index.html + the new harness; one provider per commit).

---

## 6. VERIFICATION & DISCIPLINE (do not skip)

- **Discriminating harness per provider** — mock the provider's HTTP boundary (global.fetch), never hit the real API. Assert: connect-url built correctly; callback exchanges + stores encTok'd token + account; status reflects connected; sync maps a canned payload to FinFlow's shape; honest not-connected empty state.
- **Full sweep green before every commit.** Owner commits in PowerShell. One provider per commit.
- **Display-only (Rules 2 & 12):** sync READS and DISPLAYS. Importing into the books is a separate, owner-approved step — do NOT auto-write invoices/expenses into FinFlow's tables from a sync.
- **Tokens encTok'd at rest. Never log secrets. Never put tokens in URLs.**
- **Do not touch the money engine.** These are additive endpoints + registry cases. If a money-gate harness (step*-gate, verify-f88-*) goes red, you broke something unrelated — stop and fix.

---

## 7. PLATFORM-KEY CHECKLIST (owner sets these on Railway, once each)

| Provider | Env vars (Railway) | Where to get | Sandbox |
|---|---|---|---|
| QuickBooks | QBO_CLIENT_ID, QBO_CLIENT_SECRET | developer.intuit.com app | instant |
| Xero | XERO_CLIENT_ID, XERO_CLIENT_SECRET | developer.xero.com app | instant |
| Zoho Books | ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET | api-console.zoho.com | instant |
| Square | SQUARE_APP_ID, SQUARE_APP_SECRET | developer.squareup.com | instant |
| PayPal | PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET | developer.paypal.com | instant |
| Shopify | SHOPIFY_API_KEY, SHOPIFY_API_SECRET | shopify partners app | instant (dev store) |
| Coinbase | COINBASE_CLIENT_ID, COINBASE_CLIENT_SECRET | coinbase oauth app | instant |
| Mercado Pago | MP_CLIENT_ID, MP_CLIENT_SECRET | mercadopago devs app | instant |
| Wise | (per-user token, no platform key) | user's Wise account | — |
| WooCommerce | (per-store keys, no platform key) | user's WP admin | — |
| ALL | CONNECTOR_ENC_KEY, APP_URL | already set (verify) | — |

Also every OAuth app needs its **redirect URI** registered in the provider dashboard as `https://finflow-production-dab2.up.railway.app/api/<provider>/callback`.

---

## 8. WHAT NOT TO DO (owner's explicit cuts — do NOT build these)
Ad platforms (Google/Meta/LinkedIn/TikTok/Snap/X), Amazon SP-API, Gmail/Outlook, Gusto (Finch already covers it), Venmo/Zelle/CashApp (no API; captured via Plaid), Apple/Google/Samsung Pay (payment methods, not connectors), SAP/Oracle/NetSuite (enterprise), shipping carriers, FTX (defunct). If asked later, they're a separate wave — most fail the "just get keys" test (they gate their APIs behind app review).

---

*Reference the Stripe feed built alongside this plan (`/api/stripe/feed`, `verify-stripe-feed.js`) as the canonical example for endpoint shape, honest states, token handling, and the harness. When in doubt, mirror it.*
