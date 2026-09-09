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

---

# ADDENDUM · 2026-09-09 — In-app CHAT (accountant ↔ client), real-time

First of the four "industry-standard-but-better" items Shaq requested (chat · onboarding · required
entity fields · accountant verification). **Chat is COMPLETE.** The other three are still advisory
(see PLAN below).

## What shipped
Two-way accountant↔client messaging with **real-time delivery**, read receipts, typing indicators,
and unread badges — built on the existing `accountant_messages` table (extended, not rebuilt).

- **Real-time = SSE hub, not polling.** `accountant-routes.js` module scope holds an in-process
  pub/sub (`_chatHub`, keyed `${accountantId}:${userId}`): `_chatSubscribe` / `_chatBroadcast` /
  `_openSse`. Each side opens one `EventSource`; a new message / `read` / `typing` event fans out to
  the thread's subscribers instantly. Compression is app-wide (server.js:60) and buffers a stream, so
  every write is followed by `res.flush()`. Keep-alive ping every 25s; `X-Accel-Buffering: no`.
  **Single-instance safe (Railway one web proc); for horizontal scale swap the Map for Redis pub/sub —
  the subscribe/broadcast surface is the only seam.** Both clients also slow-poll (20s) as a fallback,
  so a dropped stream degrades to "slightly delayed", never "lost".
- **Read receipts.** Two columns on `accountant_clients`: `accountant_last_read`, `client_last_read`
  (TIMESTAMPTZ, NULL = never opened). Opening the thread (GET) stamps the caller's column and
  broadcasts a `read` event; the peer's GET returns `otherLastRead`, which the UI turns into a
  "✓ Seen" tick on the last message the peer has read. O(1) — no per-row read flag.
- **Unread.** Accountant: `GET /api/accountants/clients/:userId/unread` (client messages after
  `accountant_last_read`). Client: folded into `GET /api/accountants/my-accountant` as `unread`
  (accountant messages after `client_last_read`). Both drive a `.nav-badge`.
- **Typing.** `POST .../typing` (throttled to 1/2s client-side) broadcasts a transient `typing` event
  to the peer only (`exceptSide`), never persisted.

## Routes (all in accountant-routes.js unless noted)
- Client: `GET/POST /api/accountants/my-accountant/messages`, `POST .../typing`, `GET .../stream` (SSE).
  Client GET returns `{ messages, otherLastRead, accountantId }`; every route resolves the caller's OWN
  active link (owner-scoped by `req.session.userId`) — sender is server-forced `'client'`.
- Accountant: existing `GET/POST /api/accountants/clients/:userId/message[s]` now broadcast + mark-read;
  new `GET .../stream` (SSE), `POST .../typing`, `GET .../unread`. Access-gated by the active
  `accountant_clients` link (403 otherwise). Plural GET now returns `{ messages, otherLastRead }`.
- **Legacy note:** the old client route `GET/POST /api/accountant-messages` (server.js:3857/3877) still
  works but does NOT broadcast; the client UI has been repointed to the hub-backed routes above. Left in
  place as a harmless alias (boot-failures-gate.js references it).

## UI
- **Client (index.html):** My Accountant page chat panel rewritten — SSE stream, seen ticks, typing
  ("Your accountant is typing…"), nav unread badge, Enter-to-send, optimistic append with id de-dupe.
  Thread auto-opens (and marks read) only when the page is actually visible, so the badge isn't cleared
  on boot.
- **Accountant (accountant-client.html):** "Message Client" tab upgraded to the same live thread
  (SSE, seen, typing, nav badge). `msg-input` gets `oninput`/`onkeydown` handlers.

## Schema (database.js)
`accountant_clients` += `accountant_last_read`, `client_last_read` (idempotent ALTERs).
`accountant_messages` += indexes `idx_acc_messages_user`, `idx_acc_messages_thread(accountant_id,user_id,created_at)`.

## Proof
`verify-accountant-chat.js` — **23/0 GREEN**, RED-proven (endpoints 404 before build). Drives a REAL
SSE socket: a live listener on one side receives the other side's POSTed message within ~400ms
(actual hub fan-out, not polling). Also proves two-way ordering, unread before/after open, otherLastRead
receipts, typing over the socket, and full isolation (unlinked accountant 403 on
read/post/stream/typing; unlinked client empty thread + 404 on post/stream; no intrusion message ever
enters the thread). Auto-included in the sweep (`^verify-.*\.js$`).

## Still ADVISORY (not built) — the other three
- **Onboarding:** finish creates a settings string but **no entity** (per-entity connectors then have
  nothing to attach to); "Skip" dumps into an empty workspace; settings save is swallowed yet the
  onboarded flag is still set (silent data loss on failure). Path: provision the first entity
  server-side (name+currency+country), confirm save before flagging, make identity required / keep
  connections optional.
- **Required entity fields:** `POST /api/entities` requires only `name`. Recommend country + currency
  required server-side + UI, grandfathering legacy entities via a "complete your entity" prompt.
- **Accountant verification:** backbone is solid (all pending → manual admin approve; status re-checked
  live). Weaknesses: credential doc is OPTIONAL; membership lookup is mock-only; no KYC. Path: require
  at least one of {credential doc, membership no.}, upgrade admin review surface; real registry/KYC to
  be scoped separately.

---

## Post-deploy HOTFIX · 2026-09-09 — accountant_messages legacy schema (crash-loop)

The FIRST chat deploy crash-looped production: `column "user_id" does not exist` in `ComputeIndexAttrs`
(initDB, database.js). Root cause: production's `accountant_messages` table was created under the OLD
schema with a `client_id` column; `CREATE TABLE IF NOT EXISTS` never migrates an existing table, so it
stayed `client_id` and the new `idx_acc_messages_user` index referenced a column that isn't there —
initDB runs in ONE transaction, so it rolled back and the server never booted. (Side effect now
understood: the pre-existing message routes queried `user_id` against this table and silently returned
empty via `.catch` — so chat never actually worked in prod before this.)

**Fix (database.js, before the accountant_messages indexes):**
`ALTER TABLE accountant_messages ADD COLUMN IF NOT EXISTS user_id INTEGER`, then a guarded
`UPDATE ... SET user_id = client_id WHERE user_id IS NULL` (only if a legacy `client_id` column
exists). Idempotent — a fresh table already has user_id. Proven against a simulated legacy table
(client_id 42 -> user_id 42, indexes built, no crash); chat harness still 23/0. Shipped as the
`hotfix(db)` commit after the chat commit.

**Lesson:** the sandbox always builds tables FRESH (with user_id), so it never exercised prod's
legacy-schema path. Any new column/index on a long-lived table must ship with `ADD COLUMN IF NOT
EXISTS` + a backfill guard — `CREATE TABLE IF NOT EXISTS` does not migrate existing tables.
