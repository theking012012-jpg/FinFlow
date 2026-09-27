# FinFlow — Deep-Dive Audit & Status
**Current as of:** 2026-09-27 · **Method:** full code read (server.js ~9.8k LoC, database.js, app-main.js, index.html) + live prod walk + harness runs (298 harness files).

This is the live status document — current grades, what's done, and exactly what's left. It supersedes earlier notes.

---

## Scorecard

| Dimension | Grade | Where it stands |
|---|---|---|
| Ledger / correctness | **A** | Double-entry reconciles to the cent on live data; 298 harnesses; account-deletion purge now covered. |
| Data lifecycle | **A+** | Erasure purges the full ledger; GDPR data export added. Both tested. |
| Security | **A** | Parameterized queries, tight auth throttle, hashed/expiring tokens, helmet + hardened CSP + HSTS, CI npm-audit gate (0 vulns). |
| Operational maturity | **A‑** | Sentry, GL reconcile monitor, structured logs + request IDs, versioned migrations; env vars documented; CI added. |
| Performance / scale | **A‑** | Composite (user_id, created_at) index + keyset pagination on the hot lists (back-compat). |
| Payments robustness | **A‑** | Signed + idempotent Stripe webhook, dup-safe money writes, overpayment rejected, suspend on past_due. |
| Accessibility | **A** | 0 axe violations across all 10 pages (was 64); critical label bugs fixed; keyboard focus rings + reduced-motion added. Full A+ wants a live color-contrast/keyboard pass. |

The money engine is world-class — correct, observable, and self-checking on live data. What's left is edge hardening, not core risk.

---

## Done and verified (this work)

**Data lifecycle → A+.** `DELETE /api/auth/account` now sweeps the general ledger (`ledger_accounts` / `ledger_entries` / `ledger_lines`) and `ai_usage` — the user-scoped tables it previously orphaned — so erasure is complete. Added `GET /api/auth/export`: an owner-scoped, tenant-isolated full JSON dump served as a download (GDPR Art. 20 portability), with no password hash. Harnesses: `verify-account-deletion-purge` 11/0 (seeds the once-orphaned tables, deletes through the real route, asserts zero rows remain), `verify-account-export` 9/0 (own data only, never another tenant's).

**Performance / scale → A‑.** Added a composite `(user_id, created_at DESC, id DESC)` index on every JSONB table so list sorts are index-served instead of sorted in memory. Added `db.pageByUser` — keyset (cursor) pagination, entity-scoped in SQL for an accurate `total`, capped at 500/page — wired into `/api/invoices`, `/api/bills`, `/api/expenses` as an opt-in (`?limit` / `?before`) that returns `{rows, nextCursor, hasMore, total}`. With no params the endpoints return the identical array as before, so nothing (including client-side aggregation) regresses. Harness `verify-list-pagination` 13/0.

**Security → A / Ops → A‑.** Added `.github/workflows/ci.yml`: `npm audit --omit=dev --audit-level=high` (currently 0 vulnerabilities) plus a syntax check on every push/PR — closes the supply-chain gap. Documented the previously-missing env vars (`SENTRY_DSN`, `LOG_REQUESTS`, `ALLOW_INDEXING`) in `.env.example`.

**Verification hygiene.** Refreshed the 9 stale seed stamps (A5.1–18, A7.9–17) against the current seed and made the gate auto-stamp the A7 cash-flow rows so that class of drift can't silently recur; corrected the gate's balance-sheet AP baseline to track F58's net figure. `verification-sync --report`: 0 stale.

Regression check after all of the above: `verify-f137-balance-sheet-report` 6/0, `f123-balance-sheet-cash` 13/0.

---

## What's left to reach straight A+

Each of these needs a real verification surface — I won't grade them up on code I can't test.

**Security → A+ — drop `script-src 'unsafe-inline'` via CSP nonces.** Everything else in the CSP is already locked (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, nosniff, HSTS). Removing `unsafe-inline` means stamping a per-response nonce onto every inline `<script>` and removing inline handlers, then exercising the full UI. A tested migration, not a blind edit.

**Payments → A+ — dunning email + refund/dispute handling.** The access side already works (a failed charge → subscription `past_due` → suspend). The increments — a graduated dunning email, a grace banner, and `charge.refunded` / `charge.dispute.created` reconciliation — touch the money path and need Stripe **test-mode** (test keys + signed test events) to verify. Drop in test keys and I'll build and prove it.

**Performance → A+ — paginate the client.** The server primitive is done; the last step is pointing the heaviest app screens (invoices, transactions) at the `{rows,nextCursor}` shape so the browser stops loading full lists.

**Accessibility → A+ — final live pass.** Done: axe audit (`tests/harness/a11y-audit.js`) is clean on all 10 static pages incl. the full app shell; critical form-label bugs fixed; content wrapped in landmarks; global `:focus-visible` + `prefers-reduced-motion` added. Remaining for A+: a live-browser color-contrast + keyboard-navigation/focus-trap pass (axe-in-jsdom can't measure contrast or focus order).

**Ops → A+ — infra you run.** Execute the restore drill from `INFRA_RUNBOOK.md`, and apply a least-privilege DB app role (no SUPERUSER/DROP). Documented; not code.

---

## Verified strengths (evidence)
- **Ledger:** live source `gl` with real cash, F58 AR+AP netting closed, backfill hardened, reconcile safety-net scan + `/api/gl/reconcile-check`.
- **Indexes:** per-table `user_id`/`entity_id` + new composite; GL fully indexed (entry_id, account_id, scope); 9 unique idempotency indexes on money tables; session-expire index.
- **Security:** 281 parameterized queries (zero string-built SQL), `authLimiter` 10/15min on login/register/forgot/reset, reset tokens hashed + expiring + single-use, helmet + hardened CSP + HSTS, CORS locked, bcrypt cost-12, encrypted connector tokens, tenant isolation, append-only audit trail, owner MFA, CI dependency gate.
- **Payments:** Stripe webhook signature-verified + idempotent (`stripe_webhook_events`), body-size limits, subscription lifecycle → suspend/restore, overpayment rejected with no row written.
- **Ops:** `/healthz` DB ping, unhandled-rejection + uncaught-exception capture, stack-safe error handler, structured JSON logs with `X-Request-Id`, versioned migration runner, robots.txt `Disallow: /` confirmed live (noindex holds until `ALLOW_INDEXING=1`).
