# FinFlow — Launch Checklist (authoritative)

**Rewritten:** 2026-10-19 · **Code at write:** branch `claude/laughing-hawking-lkvv38` @ `14709a6` (50 commits ahead of
`main` @ `98d5d69`, not merged yet) · **Replaces** the 2026-10-05 version of this file (see git history at `47a026c`),
which predated the 2026-10-09 money audit and the 2026-10-13 live audit.

This is the single list of what stands between today and going public. Work it top to bottom.

**How to read the status marks**

| Mark | Meaning |
|---|---|
| ✅ VERIFIED | Checked in the repo or by an executed test/probe. The evidence is named. |
| ⬜ OPEN | Not done, as far as the record shows. |
| ❔ CONFIRM | Last recorded state is from **2026-10-05** (Railway / Stripe / Resend dashboards). Claude cannot see those dashboards; the owner confirms and ticks. |
| 🔒 OWNER | A decision only the owner can make. |

> **Bottom line:** once the current release (§0) is merged and confirmed live, **nothing on the code side blocks
> launch**. What remains is one security action, external configuration, a final verification pass, and a few
> launch-scope decisions.

---

## 0. Finish the release in flight

| # | Step | Status | Evidence / how to confirm |
|---|---|---|---|
| 0.1 | Full sweep 3× on the branch | ⬜ OPEN (running 2026-10-19) | Expect **557/557 GREEN** ×3 (555 on `ed6090b` + `verify-la21`, `verify-la23`). Previous: 555/555 ×3 on `ed6090b` (2026-10-15, HANDOVER). |
| 0.2 | Merge the branch into `main` | ⬜ OPEN | Fast-forward: `main` has no commits the branch lacks (checked 2026-10-19). Railway deploys `main`. |
| 0.3 | Migrations run on first boot | ⬜ OPEN | `2026-10-16-payroll-runs-jurisdiction-no-default.sql` (schema) and `…-clear-tt.sql` (data, owner-approved). Railway log shows `[migrate] applied …`. |
| 0.4 | Post-deploy live check | ⬜ OPEN | `COWORK_LIVE_CHECK.md` Part A (today's fixes live) — e.g. 0 `deferred render hook threw` on hard reload, no `$0` KPI cards. |

---

## 1. Hard blockers — do not launch without these

| # | Item | Status | Evidence / how to confirm |
|---|---|---|---|
| 1.1 | **Rotate the database password** | ⬜ OPEN | The full production `DATABASE_URL`, password included, was pasted into a Claude chat on 2026-10-14 (twice). Supabase → Database → Reset password; update `DATABASE_URL` in Railway. Until then, anyone with the transcript can read and change the live books. |
| 1.2 | **Real email** — verify the sending domain in Resend (SPF + DKIM), set `RESEND_API_KEY`, `EMAIL_FROM=noreply@<domain>`, `ADMIN_EMAIL` | ❔ CONFIRM | Last record (2026-10-05): sandbox sender `onboarding@resend.dev`, which delivers only to the owner's inbox → password resets, invites, receipts and reminders do not reach real users. Settings exist in code (`server.js`, `.env.example`). Confirm: a reset email arrives at a non-owner address. |
| 1.3 | **Stripe prices match the site** — Business **$249/mo** (was $199 in Stripe), create Scale **$400/mo**, set `STRIPE_PRICE_PRO` / `_BUSINESS` / `_SCALE` | ❔ CONFIRM | The site advertises $249 and $400 (`public/landing.html:388,421`, `public/index.html:3306,3319,3352`). Checkout reads `STRIPE_PRICE_<PLAN>` (`server.js:1079`); an unset price returns "Checkout … not set up". |
| 1.4 | **Stripe live mode** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (live), `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_REDIRECT_URI` | ❔ CONFIRM | Then do ONE real paid upgrade: trial → Upgrade → Stripe checkout → plan shows paid. This also closes the last open half of **F132** ("Upgrade reaches a working checkout"). |
| 1.5 | **Core settings** — `SESSION_SECRET` (long random), `APP_URL` (public https), `CONNECTOR_ENC_KEY`, `ANTHROPIC_API_KEY` | ❔ CONFIRM | All read by `server.js`; listed in `.env.example`. |
| 1.6 | **Production test data** | ⬜ OPEN · 🔒 OWNER | On the live database: QA Tester / Claude TestCPA accountant links, ZZ-QA rows, `AUDIT TEST ZZ` invoice ($7,777), `AUDIT TEST EXP` expense ($888), `AUDIT TEST VENDOR` bill ($444), Cowork's November 2026 payroll run (paid), plus any `ZZ-LIVECHECK` records from §4. Decide: clean this database, or launch real customers on a fresh one. Deleting is a data change (Rule 8) — owner-run. |
| 1.7 | **Backups proven** — run one real restore | ⬜ OPEN | `scripts/restore-drill.sh` exists. A backup nobody has restored is not a backup. |
| 1.8 | **Search indexing** — set `ALLOW_INDEXING=1` at the moment of launch, not before | ⬜ OPEN (correctly) | Read by `server.js`. Verify after: `curl -sI https://<domain>/ \| grep -i x-robots-tag` is empty; `robots.txt` shows `Allow: /`. |

---

## 2. Strongly recommended before real users

| # | Item | Status | Evidence / how to confirm |
|---|---|---|---|
| 2.1 | Uptime monitor on `GET /healthz` (200 healthy / 503 degraded) | ❔ CONFIRM | Endpoint exists (`server.js:1097`, `verify-healthz`). |
| 2.2 | Error monitoring — `SENTRY_DSN` (+ `npm i @sentry/node`) | ⬜ OPEN | Supported in `server.js`. B2 (2026-10-14) showed why: a swallowed server error is invisible without it. |
| 2.3 | Least-privilege DB role — web process as `finflow_app` with `SKIP_INIT_DDL=1`; schema via `node scripts/migrate.js` in the release step | ⬜ OPEN | All built and tested (`scripts/db-app-role.sql`, `verify-db-app-role`, `verify-migrate-entrypoint`); not switched on in Railway. See `INFRA_RUNBOOK.md` §4. |
| 2.4 | Cloudflare in front (proxied DNS, TLS Full (strict), managed WAF — free tier is enough) | ❔ CONFIRM | |
| 2.5 | Secrets rotation schedule (DB URL, Stripe, connector keys) + rotate on any suspected exposure | ⬜ OPEN | 1.1 is the first instance. |
| 2.6 | Legal review of `terms`, `privacy`, `security` pages | ⬜ OPEN · 🔒 OWNER | Pages exist (`public/terms.html`, `privacy.html`, `security.html`); content not reviewed for a product holding bank data. Plaid production approval asks for them. |
| 2.7 | Live functional check of the areas no audit has exercised | ⬜ OPEN | `COWORK_LIVE_CHECK.md` Part B: Time Tracking, Budget, MRR/SaaS, Quotes, Sales Receipts, Payments Received/Made, Classes, Scheduled Documents, Reminders, Documents/Templates, Audit trail, accountant portal. |
| 2.8 | `SECURITY_ALERT_EMAIL` (audit-anomaly digest), `LOG_REQUESTS=1` | ⬜ OPEN (optional) | Supported in `server.js`. |

---

## 3. Launch-scope decisions (owner)

| # | Decision | Status | Notes |
|---|---|---|---|
| 3.1 | Which integrations are live on day one | 🔒 OWNER | Each connector is dark (clean "not set up") until keyed. Some need the provider's approval and take time: Plaid production, QuickBooks / Xero app review. Suggestion: launch with Stripe + Plaid + statement import; label the rest "coming soon". Keys: Plaid `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production` · Belvo `BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`, `BELVO_ENV` · OAuth connectors (QuickBooks, Xero, Zoho, Square, PayPal, Coinbase, Shopify): client id + secret each · Finch `FINCH_*` · Codat `CODAT_API_KEY` · optional `FINNHUB_API_KEY`, `COINGECKO_API_KEY`. WiPay / WooCommerce take per-user credentials in-app (no server keys). |
| 3.2 | Expired trial: read-only (current) vs hard-lock vs grace period | 🔒 OWNER | Read-only is built and verified (F132, `f130-trial-expired-paywall`). F130 left the policy open; confirm read-only is the launch policy. |
| 3.3 | Pick the account's reporting currency | 🔒 OWNER (after 0.2) | New Settings field (LA21). Until chosen, "All entities" uses the oldest business's currency. |

---

## 4. The done-gate — last, right before flipping public

| # | Gate | Status | Notes |
|---|---|---|---|
| 4.1 | Full sweep 3× GREEN on the exact commit going live | ⬜ OPEN | `node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js`. Capture: `HANDOVER.md` (log-file command). |
| 4.2 | `VERIFICATION.md` re-sweep on real seeded data | ⬜ OPEN | Per `CLAUDE.md`, **done = every check in `VERIFICATION.md` green**; anything not on it is unverified. 19 Result cells are empty (A7.5–8, A7.18, A8a/A8b) — gate-tested but not stamped. |
| 4.3 | Human smoke test on production | ⬜ OPEN | Sign up → create a business → invoice + expense → record a payment → P&L / balance sheet / All entities → connect one sandbox bank → invite an accountant. **Confirm the emails actually arrive** (needs 1.2). |
| 4.4 | Live check complete with no open FAIL | ⬜ OPEN | `COWORK_LIVE_CHECK.md` A + B. |

---

## 5. Code state (verified)

| Area | Status | Evidence |
|---|---|---|
| Live audit 2026-10-13 — 23 rows (LA1–LA23) | ✅ VERIFIED closed (20 fixed, LA11/LA12/LA22 explained or decided) | `AUDIT_MASTER.md` "LIVE AUDIT 2026-10-13" table; each fix has a harness RED on the old code, GREEN on the fix. B2 withdrawn after a live repro (crossing works). |
| Money audit 2026-10-09 (M-rows) | ✅ VERIFIED per `MONEY_AUDIT_2026-10-09.md` | Rounds 1–3 fixed with harnesses (e.g. M53, M62 green in the 555 sweep). |
| Full sweep | ✅ 555/555 ×3 on `ed6090b` (2026-10-15); 557 pending (§0.1) | `HANDOVER.md`. |
| Duplicate-submit (Rule 9) on money routes | ✅ VERIFIED | 17 `verify-c1-*` harnesses (payroll runs, invoices, invoice payments, expenses, bills, payments made/received, sales receipts, credit notes, vendor credits, journals, chart of accounts, inventory movements, client lock); shared client `withSubmitGuard` (`app-main.js:30`). |
| Boot race (F50 / F97 / LA2) | ✅ VERIFIED root-fixed on the branch | `verify-la2-boot-after-parse` — real Chromium, production build, network latency: 3/5 errors → 0. Live confirmation is §0.4. |

---

## 6. Deliberately deferred — not launch blockers

- **CSP `script-src 'unsafe-inline'`** — accepted: escaping is the guarded XSS defence (`verify-escaping-sweep`); dropping
  it means rewriting ~500 inline handlers.
- **Wire-level invoice pagination** — money features read the full invoice array across 6 files; app-wide rewrite.
- **Client adoption of keyset pagination** — server side done (`verify-list-pagination`).
- **Postgres row-level security** — designed (`RLS_DESIGN.md`); app-level isolation is tested
  (`verify-tenant-isolation`, `verify-entity-leakage-sweep`).
- **GL Phase 4 + 5** (ledger as source of truth) and **investments on the ledger** — owner-gated accounting decisions
  (`GL_DESIGN.md`).
- **Express 4 → 5** (last `qs` moderate advisory), **mobile performance** tuning, **native app store** submission
  (`mobile/` scaffold exists), **Google Sheets OAuth push-sync**.
- **Housekeeping:** move the working copy out of OneDrive (cause of the recurring `.git/index.lock` fights).

---

## 7. Reference docs (how the system works — not status)

`CLAUDE.md` (rules) · `VERIFICATION.md` (the sign-off list) · `AUDIT_MASTER.md` (findings ledger) ·
`LIVE_AUDIT_2026-10-13.md` · `MONEY_AUDIT_2026-10-09.md` · `HANDOVER.md` · `INFRA_RUNBOOK.md` ·
`ARCHITECTURE_MAP.md` · `GL_DESIGN.md` · `FX_CONSOLIDATION_DESIGN.md` ·
`RLS_DESIGN.md` · `COWORK_TEST_SCRIPT.md` (full end-to-end) · `COWORK_LIVE_CHECK.md` (post-deploy check).
