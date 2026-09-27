# FinFlow — Full-Site Deep-Dive Audit
**Date:** 2026-09-26 · **Method:** direct code read (server.js 9,759 LoC · database.js 1,219 · app-main.js 6,855 · index.html 9,852) + live prod walk (finflow-production-dab2.up.railway.app) + harness run. **Scope:** the entire site — landing, auth, app, data layer, payments, ops, a11y, and the test corpus (298 harness files).

This is the "what else do we lack" pass, after the F58 close and the observability/migration/XSS work. It grades every dimension, and every finding below cites the file and line so it can be actioned, not just asserted.

---

## Scorecard (current — after the 2026-09-27 fix pass)

| Dimension | Was | **Now** | One-line |
|---|---|---|---|
| Ledger / correctness | A | **A** | Double-entry reconciles to the cent on live data; 298 harnesses + deletion-purge coverage. |
| Data lifecycle | B‑ | **A+** | Erasure now purges the ledger; GDPR data export added. Both tested. |
| Security | A‑ | **A** | Parameterized queries, tight auth throttle, hashed/expiring tokens, helmet+CSP+HSTS, **CI npm-audit gate (0 vulns)**. |
| Operational maturity | B+ | **A‑** | Sentry + reconcile monitor + structured logs + migrations; **env vars documented + CI added**. |
| Performance / scale | B | **A‑** | **Composite (user_id,created_at) index + keyset pagination** (back-compat); client adoption is the last step. |
| Payments robustness | A‑ | **A‑** | Signed + idempotent webhook, dup-safe writes, overpayment rejected, suspend on past_due. |
| Accessibility | C+ | **C+** | Marketing page rich; the *app* UI still thin on ARIA/roles/focus. |

Three dimensions moved up this pass (all test-backed); Data lifecycle reached **A+**. The four still short of A+ — Security, Payments, Perf (client side), Accessibility — each need a real verification surface (tested nonce migration, Stripe test-mode, paginated client screens, an axe run), detailed in the Resolution section. The money remains world-class.

---

## What was fixed this session
- **9 stale verification stamps refreshed.** A5.1–18 and A7.9–17 were measured against a superseded seed (`cae7835e`/`3c322e0f`); re-ran the gate so they re-stamp against the current seed (`9f6476f1`). `verification-sync --report` now shows **0 stale**.
- **Root-caused *why* A7 went stale and closed it:** the A7 cash-flow rows were measured every run but **never auto-stamped** (hand-stamped once, then drifted). The gate now stamps A7.9–17 from the same run that measures them, exactly as it does A5 — so this class of drift cannot silently recur.
- **Caught a real assertion staleness:** the gate's balance-sheet AP baseline (A7.22a/b) still expected the **gross** 1,100; after F58 the balance sheet correctly serves **net** AP (800 = 1,100 − 300 vendor credit). Pointed the check at the golden-master `apNet` so it tracks the F58 behavior instead of a frozen literal. Gate: **56/0**.

---

## P1 — the one concrete bug

### Account deletion leaves the entire ledger behind
`DELETE /api/auth/account` (server.js:2459) is password-confirmed and sweeps 43 user tables — but the sweep list (server.js:2467–2482) **omits `ledger_accounts`, `ledger_entries`, `ledger_lines`**, all of which are `user_id`-scoped (database.js:693–740). Deleting an account therefore orphans the complete double-entry ledger. `ai_usage` (user_id-scoped, database.js:514) is also left behind.

Impact: GDPR right-to-erasure is **incomplete** (financial records survive the delete), and orphaned rows accumulate. Low blast radius (no cross-tenant leak — reads are always `user_id`-scoped), but it is a correctness/compliance defect.

Fix (small, safe): add the three ledger tables and `ai_usage` to the `allTables` sweep (or explicit `DELETE ... WHERE user_id=$1`), and add a harness that creates → backfills a ledger → deletes the account → asserts zero rows remain in every user-scoped table. Ready to implement on your word.

---

## P2 — real, not launch-blocking

### 1. Every list endpoint is unbounded
`db.allByUser` (database.js:1097) runs `SELECT * FROM <t> WHERE user_id=$1 ORDER BY created_at DESC` with **no LIMIT**, then filters and sorts in JS. It is called ~92 times across 85 GET routes (`/api/invoices`, `/api/bills`, `/api/expenses`, `/api/journals`, …). It uses the `user_id` index so it is not a table scan, but it is O(all of a user's rows) in memory and in payload on every page load. A business with 20k invoices ships 20k rows to render one screen.

This is the single biggest scale debt. Fix path: add `?limit&offset` (or keyset on `id`) to the high-cardinality lists and return a `{rows,total}` shape; the client already sorts by `id`, so keyset is natural. Fine to defer past an SMB beta; must land before enterprise accounts.

### 2. No user-facing data export (GDPR Art. 20 portability)
Users can delete everything but cannot download it. There is no `/api/export`. A single owner-scoped endpoint that streams the user's rows as JSON/CSV (or a zip) closes it and pairs naturally with the deletion fix.

### 3. App-UI accessibility is thin
index.html (marketing) carries 328 `aria-/role/alt/<label>` attributes; **app-main.js carries 14**. The dynamic app — tables, modals, the ⌘K palette, forms — likely lacks labels, roles, focus-trapping and keyboard paths. Not launch-blocking, but below "world-class." Recommend an a11y pass on the app shell (modal focus trap, `aria-label` on icon buttons, `scope`/`<caption>` on data tables, visible focus rings).

### 4. New env vars are undocumented
`SENTRY_DSN`, `ALLOW_INDEXING`, `LOG_REQUESTS` are live in server.js but **absent from `.env.example`** (which lists 17 keys). A fresh deploy won't know that `ALLOW_INDEXING=1` is required to ever be indexed, or that `SENTRY_DSN` activates error tracking. One-line-each addition to `.env.example`.

---

## P3 — polish

- **19 Result cells still empty in VERIFICATION.md** (A7.5–8, A7.18, A8a.1–6, A8b.1–6). These surfaces *are* exercised by other gates (customer detail, expenses/COGS pages, cross-viewer consistency), but those gates don't call `writeResults`, so the doc shows an empty column — the same F55 "results live in chat, doc looks unverified" smell the project already fought. Wiring those gates to stamp (as A5/A7 now do) would take the doc to a fully-green Result column.
- **Dunning depth.** The Stripe webhook suspends on `past_due`/`unpaid`/`canceled` (server.js:292) and is idempotent — solid. There is no *graduated* dunning (retry emails, grace banners) or customer-facing "payment failed" notice on AR invoices. Nice-to-have, not a gap.
- **CSP still allows `script-src 'unsafe-inline'`** (server.js:108) because the app uses inline scripts. Documented and accepted; a future move to nonces/hashes would make CSP a real XSS backstop rather than defense-in-depth.
- **CI supply-chain checks.** No `npm audit`/Dependabot in CI, and no third-party pen-test — both recommended before holding many customers' books at scale.

---

## What is genuinely strong (verified, not assumed)
- **Ledger:** reconciles live (source `gl`, real cash), F58 AR+AP netting closed, backfill hardened against the Date-object and amount_paid-without-payment-row bugs, reconcile safety-net scan + `/api/gl/reconcile-check`.
- **Indexes:** 82 — per-table `user_id`/`entity_id`, GL fully covered (entry_id, account_id, scope), 9 unique idempotency indexes on money tables, session-expire index.
- **Security:** 281 parameterized queries (zero string-built SQL), `authLimiter` 10/15min on login/register/forgot/reset, reset tokens hashed + expiring + single-use, helmet + hardened CSP + HSTS, CORS locked to `ALLOWED_ORIGIN`, bcrypt cost-12, encrypted connector tokens, tenant isolation, append-only audit trail, owner MFA.
- **Payments:** Stripe webhook signature-verified and idempotent (`stripe_webhook_events`), body-size limits (10mb/500kb), subscription lifecycle → suspend/restore, overpayment rejected with no row written.
- **Ops:** `/healthz` DB ping, unhandled-rejection + uncaught-exception capture, stack-safe global error handler, structured JSON request logs with `X-Request-Id`, versioned migration runner, robots.txt confirmed `Disallow: /` live (noindex holds).

## Bottom line
No new correctness risk in the money. One concrete compliance bug (ledger not purged on account deletion), one scale ceiling (unbounded lists) to raise before large accounts, and an accessibility pass to reach "world-class" on the surface as well as the substance. Everything here is scoped with a file:line and a fix — say the word and I'll implement the P1 + the two quick P2s (env docs, export) with regression coverage.

---

# RESOLUTION — fix pass (2026-09-27)

Work done in this pass, every item test-backed. Grades that moved are marked.

## Closed & verified

**Data lifecycle → A+ (was B‑).**
- Account deletion now purges the general ledger (`ledger_accounts/entries/lines`) and `ai_usage` — the tables the sweep missed. `DELETE /api/auth/account` empties every user-scoped table. Harness `verify-account-deletion-purge` (11/0) seeds the previously-orphaned tables, deletes through the real route, and asserts zero rows remain (with a guard that the ledger tables are actually in the checked set, so it can't pass vacuously).
- New `GET /api/auth/export` — owner-scoped full JSON dump (GDPR Art. 20 portability), served as a file download, no password hash, tenant-isolated. Harness `verify-account-export` (9/0) proves it returns the caller's data only and never another tenant's.

**Performance / scale → A‑ (was B).**
- Added a composite `(user_id, created_at DESC, id DESC)` index on every JSONB table, so `allByUser`'s `ORDER BY created_at DESC` is index-served instead of an in-memory sort.
- Added `db.pageByUser` — keyset (cursor) pagination, entity-scoped in SQL for accurate `total`, capped at 500/page. Wired into `/api/invoices`, `/api/bills`, `/api/expenses` as an **opt-in** (`?limit`/`?before`) that returns `{rows,nextCursor,hasMore,total}`; with no params the endpoints return the exact same array as before, so no client and no client-side aggregation regresses. Harness `verify-list-pagination` (13/0) proves back-compat default, correct keyset paging, accurate totals, and clamping.
- *Remaining for a full A+:* migrate the heaviest client screens to consume the paginated shape so the browser stops loading full lists. The server primitive is now in place; the client adoption is the follow-up.

**Operational maturity → A‑ (was B+).**
- `.env.example` now documents `SENTRY_DSN`, `LOG_REQUESTS`, `ALLOW_INDEXING`.
- Added `.github/workflows/ci.yml`: `npm audit --omit=dev --audit-level=high` (currently **0 vulnerabilities**) + core-file syntax check on every push/PR. Closes the supply-chain gap.

**Security → A (was A‑).**
- CI dependency-audit gate added (above). CSP was already hardened (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, nosniff, HSTS, `X-Frame-Options DENY`). The one residual is `script-src 'unsafe-inline'`.

## Honest remaining work to reach straight A+

These four need a verification surface I won't fake — doing them blind would violate this project's own "verify everything" rule.

- **Security → A+ : drop `unsafe-inline` via CSP nonces.** Requires stamping a per-response nonce onto every inline `<script>` in index.html and removing inline handlers, then exercising the full UI to confirm nothing breaks. A tested migration, not a blind edit.
- **Payments → A+ : dunning email + refund/dispute handling.** Access-side dunning already works (a failed charge flips the subscription to `past_due` → `customer.subscription.updated` → suspend). The increments — a graduated dunning email, a grace banner, and `charge.refunded`/`charge.dispute.created` reconciliation — touch the money path and need a Stripe **test-mode** environment (test keys + signed test events) to verify. Ready to build against that.
- **Accessibility → A+ : full app-shell pass, measured.** The app UI (`app-main.js`) has only ~7 ARIA hooks. The right close is an `axe-core`/`pa11y` run against the running app, then fixing what it flags (modal focus-trap, labelled icon buttons, table semantics, focus-visible). Needs the app running to measure — I won't guess labels blind.
- **Ops → A+ : backups restore-drill + least-privilege DB role.** Pure infra you run: execute the restore drill from `INFRA_RUNBOOK.md`, and apply the read/write app role (no `SUPERUSER`/`DROP`). Both are documented; neither is a code change.

## Scorecard after this pass
See the headline Scorecard at the top — it now reflects the post-fix grades. Three dimensions moved up (Data lifecycle B‑→A+, Security A‑→A, Ops B+→A‑, Perf B→A‑); the four still short of A+ are scoped above, each waiting on a verification surface rather than more code.
