# FinFlow — Session Handover (2026-09-27)

_For the next Claude (code account). Everything below is verified against code + harnesses this session._
_Repo: theking012012-jpg/FinFlow. Deploys on **Railway** (auto-deploy on push to `main`). Owner commits in PowerShell (assistant can't run git; use `;` not `&&` — PowerShell rejects `&&`)._
_Repo state: `main` at `e22b031`, working tree clean, everything pushed._

## TL;DR

A **"drive every dimension toward A+"** run, off the deep-dive audit (`AUDIT_DEEPDIVE_2026-09-26.md` — the live scorecard). Three dimensions moved up and are fully test-backed; two remain, each deliberately **not** done because they need a live-app verify loop (doing them blind would break the app). Nothing is half-done.

Current scorecard:

| Dimension | Grade | Note |
|---|---|---|
| Data lifecycle | **A+** | erasure now purges the ledger; GDPR export added |
| Ledger / correctness | A | reconciles to the cent; deletion-purge coverage added |
| Accessibility | A | 0 axe violations across 10 pages (was 64) |
| Payments | A | dunning + dispute + idempotent refund reversal |
| Security | A | Permissions-Policy + CI npm-audit gate; `unsafe-inline` remains |
| Operational maturity | A- | least-priv role + migrate + restore drill shipped & tested; adopt on Railway for A+ |
| Perf / scale | A- | composite index + keyset pagination (server done; client adoption pending) |

## Shipped + pushed this session (all harnessed, all green)

**Data lifecycle**
- Account deletion now purges `ledger_accounts/entries/lines` + `ai_usage` (were orphaned). `verify-account-deletion-purge` 11/0.
- `GET /api/auth/export` — owner-scoped full JSON dump (GDPR Art. 20), tenant-isolated, no password hash. `verify-account-export` 9/0.

**Performance**
- Composite `(user_id, created_at DESC, id DESC)` index on every JSONB table (database.js loop).
- `db.pageByUser` keyset pagination, entity-scoped in SQL; wired **opt-in** into `/api/invoices|bills|expenses` (`?limit`/`?before` → `{rows,nextCursor,hasMore,total}`; no params = same array as before). `verify-list-pagination` 13/0.

**Payments** (signed Stripe webhook)
- `invoice.payment_failed` → dunning (mark past_due + `paymentFailedAt` + best-effort email).
- `charge.dispute.created` → operator alert, no book mutation.
- `charge.refunded` → idempotent AR reversal (negative `invoice_payment` + recalc + best-effort GL), capped, single-writer. `verify-webhook-dunning-refund` 13/0. Regressions: webhook-reconcile 12/0, f117 9/0.

**Security / Ops**
- `Permissions-Policy` header (camera/mic/geo/usb/sensors/browsing-topics locked). `verify-security-headers` 13/0.
- CI: `.github/workflows/ci.yml` — `npm audit --omit=dev --audit-level=high` (0 vulns) + syntax check.
- Least-privilege DB role: `scripts/db-app-role.sql` (`finflow_app`, data-only). `verify-db-app-role` 12/0.
- `SKIP_INIT_DDL` boot gate + `scripts/migrate.js` (owner release step) so the web process can run as `finflow_app`. `verify-migrate-entrypoint` 3/0, `verify-boot-modes` 3/0 (both modes serve).
- `scripts/restore-drill.sh` — dump→restore→verify (needs pg client tools; refuses a prod-looking DEST).
- New env vars documented in `.env.example`: `SENTRY_DSN`, `LOG_REQUESTS`, `ALLOW_INDEXING`, `SKIP_INIT_DDL`.

**Accessibility**
- axe audit (`tests/harness/a11y-audit.js`, jsdom+axe-core) clean on all 10 static pages incl. the app shell. Fixed 2 critical form-label bugs, added landmarks, fixed a heading-order jump, added global `:focus-visible` + `prefers-reduced-motion`.

**Verification hygiene (start of session)**
- Refreshed 9 stale seed stamps (A5.1–18, A7.9–17); gate now auto-stamps A7 cash-flow so drift can't silently recur; A7.22 balance-sheet AP now tracks F58 net. `verification-sync --report`: 0 stale.

## What's left for straight A+ (needs a deploy-and-verify loop — do NOT do blind)

1. **Security → A+:** drop `script-src/style-src 'unsafe-inline'`. Blocked by **513 inline `on*` handlers + 1,106 inline `style=` attributes** (many generated inside JS template strings). Requires refactoring handlers to `addEventListener` + moving inline styles to classes, then clicking through the whole UI. A dedicated, tested refactor.
2. **Perf → A+:** point the heaviest client screens (invoices/transactions) at the `{rows,nextCursor}` pagination API. Server side is done + tested; client adoption needs live-UI regression testing.
3. **Ops → A+:** adopt the shipped least-priv setup on Railway — (1) run `db-app-role.sql` as owner, (2) release cmd `node scripts/migrate.js`, (3) web `DATABASE_URL`→`finflow_app` + `SKIP_INIT_DDL=1`, (4) schedule `restore-drill.sh`.

## Notes / gotchas
- `ALLOW_INDEXING` is unset → site serves `noindex` + `Disallow: /`. **Set `ALLOW_INDEXING=1` at launch.**
- 19 Result cells in VERIFICATION.md are still empty (A7.5–8, A7.18, A8a/A8b) — they ARE gate-tested but their gates don't call `writeResults`, and the gate check-IDs don't map 1:1 to those doc rows, so auto-stamping was deliberately NOT done (would risk a wrong verdict).
- `app-main.js` is served directly and minified on deploy; `index.html` (775KB) holds the app shell + hidden view templates.
