# FinFlow — Launch Status (authoritative)

**Last verified:** 2026-10-05 · **Repo HEAD at write:** `main` at `cf2050f` (review bulk actions; deployed & Online)

This is the single source of truth for "what's done vs what's left." It supersedes and replaces the
scattered audit/handover/status/plan docs that used to live in the repo root (all consolidated here on
2026-09-28). For *how the system works* see the kept reference docs listed at the bottom.

> **Bottom line:** the CODE is launch-complete and harness-backed (313 harnesses). What remains before
> going public is **ops/config only the owner can do** — the sharp edges are the Resend sending domain
> and the Stripe prices. Nothing code-side blocks launch.

---

## 1. Genuinely OPEN — owner / ops (external; cannot be done in code)

### Billing (billing is wrong until these are set — Stripe dashboard)
- [ ] Set the **Business price to $249/mo** (still $199 in Stripe → customers keep being billed $199).
- [ ] Create the **Scale price ($400/mo)** and set `STRIPE_PRICE_SCALE` in Railway (until then Scale
      checkout returns "Checkout unavailable"). `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS` already wired.
- [ ] Enable **Stripe Identity** in the dashboard (no new key — reuses `STRIPE_SECRET_KEY`); lights up KYC.
- [ ] Confirm core Stripe envs: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`,
      `STRIPE_CONNECT_REDIRECT_URI`.

### Email (launch blocker for real users)
- [ ] Verify **`finflow.app` in Resend** (SPF + DKIM DNS), set `RESEND_API_KEY`,
      `EMAIL_FROM=noreply@finflow.app`, `ADMIN_EMAIL`. Until done, password-reset / receipt / invite mail
      to real users is unreliable (currently on the sandbox sender, which only delivers to the owner inbox).

### Provider go-live keys (each integration is DARK — clean 502 — until keyed; add one sandbox txn to confirm)
- [ ] Plaid → production (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production`).
- [ ] Belvo (`BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`, `BELVO_ENV=production`).
- [ ] OAuth connectors (client id + secret each): QuickBooks, Xero, Zoho, Square, PayPal, Coinbase, Shopify.
- [ ] Finch (`FINCH_*`), Codat (`CODAT_API_KEY`), optional market data (`FINNHUB_API_KEY`, `COINGECKO_API_KEY`).
- [ ] WiPay / WooCommerce need no env keys (per-user merchant creds entered in-app).

### Core env
- [ ] `SESSION_SECRET` (long random), `APP_URL` (public https), `CONNECTOR_ENC_KEY` (AES-256-GCM for stored
      connector tokens), `ANTHROPIC_API_KEY` (AI assistant / receipt scan).
- [ ] **`ALLOW_INDEXING=1` at launch** — ships as `noindex` while testing. Verify after:
      `curl -sI https://<domain>/ | grep -i x-robots-tag` is EMPTY and `robots.txt` shows `Allow: /`.

### Infra / security hardening (recommended before real users)
- [ ] Cloudflare in front (DNS proxied, TLS Full (strict), managed WAF). Free tier is enough to launch.
- [ ] Tested backups + point-in-time restore — actually run a restore (see `scripts/restore-drill.sh`).
- [ ] Least-privilege DB role — app connects as non-superuser (see `INFRA_RUNBOOK.md` §4 + `scripts/db-app-role.sql`);
      set `SKIP_INIT_DDL=1` on the web process and apply schema via `node scripts/migrate.js` in the release step.
- [ ] Secrets rotation cadence (DB URL / Stripe / connector keys) on a schedule + on any suspected exposure.
- [ ] Uptime monitor on `GET /healthz` (200 healthy / 503 degraded).
- [ ] Optional: `SENTRY_DSN` (+ `npm i @sentry/node`), `SECURITY_ALERT_EMAIL` (audit-anomaly digest),
      `LOG_REQUESTS=1`, `CRON_SECRET` (if driving the scheduler externally).

### Housekeeping
- [ ] **Move the repo out of OneDrive** — this is the cause of the recurring `.git/index.lock` fight on commit.
- [ ] Prod test-data cleanup — remove QA Tester / Claude TestCPA links + the ZZ-QA sample rows.

### The done-gate (do last, right before flipping public)
- [ ] 3× full harness sweep GREEN: `node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js` (0 RED each run).
- [ ] VERIFICATION.md re-sweep on real seeded data (this — not any tracking ledger — establishes sign-off).
- [ ] Smoke: sign up -> create entity -> invoice + expense -> record payment -> P&L / balance sheet /
      consolidated -> connect one bank (sandbox) -> accountant invite. Confirm email actually arrives.

---

## 2. Genuinely OPEN — code (mine to build; all NON-blocking, deferred on purpose)

- **CSP `script-src 'unsafe-inline'`** — ACCEPTED DECISION, not a hole. Escaping is the guarded primary
  XSS defense (`verify-escaping-sweep` scans every render source; the two real sinks were fixed). Dropping
  `unsafe-inline` needs 509 inline `on*` handlers rewritten to event delegation (CSP3 is all-or-nothing once
  hashes are present) — real breakage risk for marginal defense-in-depth gain. Revisit as staged, per-page,
  verified work only if there's appetite. 25 inline scripts are hashable; 1,107 inline styles stay under
  `style-src 'unsafe-inline'`.
- **Wire-level invoice pagination** — `_realInvoices`/`userInvoices` feed money features across 6 files
  (KPIs, transactions, revenue, YTD, recurring detection, payment-party). Removing the full fetch is an
  app-wide rewrite; risk > gain. Deferred.
- **Client adoption of keyset pagination** on the invoices/transactions screens — server side is done +
  tested (`db.pageByUser`, `verify-list-pagination` 13/0); pointing the heavy screens at `{rows,nextCursor}`
  needs live-UI regression. Perf A -> A+.
- **Postgres RLS** — designed (`RLS_DESIGN.md`); currently only `page_views` has RLS. App-level tenant
  isolation IS tested (`verify-tenant-isolation`, `verify-entity-leakage-sweep`). DB-level RLS is
  defense-in-depth; needs per-session user threading through the Supabase pooler.
- **Sentry** wiring (needs a DSN), **express 4 -> 5** (clears the last `qs` moderate advisory; major bump).
- **GL Phase 4 + 5** (owner-gated) — historical backfill into the ledger, then flip source-of-truth to the
  GL + live "books balanced ✓". Ties into the investments-on-ledger accounting decision. See `GL_DESIGN.md`.
- **Investments-on-ledger** — currently labeled tracking-only (not posted to the double-entry books);
  posting them is an accounting decision for the owner.
- **VERIFICATION.md** has 19 empty Result cells (A7.5–8, A7.18, A8a/A8b) — they ARE gate-tested; the gates
  just don't auto-stamp those rows. Cosmetic doc gap, not a coverage gap.

- **QuickBooks-parity — non-AI ecosystem gaps** (discussed 2026-10-05; deferred, NOT launch-blocking). The AI gaps vs Intuit Assist are closed — review/cleanup queue, reminder agent (predict→draft→approve→send), 13-week cash-flow forecast, supervised bulk actions (all in §3). Remaining, each a future build of its own:
  - **Classes / locations** — dimensional tags on transactions for P&L splits (no `class_id`/`location_id` today). Highest-value of the four; touches the books directly.
  - **Public API + Zapier** — a versioned, externally-authenticated public API + Zapier app over the existing internal routes (no public API surface today).
  - **Google Sheets live sync** — push/pull books into a sheet.
  - **Native app stores** — iOS/Android presence (web/PWA today; the PWA install prompt is already live).
- **Mobile performance** — desktop Lighthouse is in the 90s; mobile remains the weaker surface after the earlier parse-wall + chart/boot-path work. Further mobile tuning is optional, ongoing, non-blocking. (A boot-window GET cache was prototyped earlier but never shipped; revisit only if mobile perf needs it.)

---

## 3. CLOSED / shipped (verified against code + harnesses)

Money engine & GL: double-entry GL (dual-write shadow), 12 posting types, reconcile monitor, statements,
read-swap; **multi-currency consolidation proven live** (`verify-fx-consolidation` 12/12, `verify-gl-consolidation`
13/13 incl. USD+TTD + ASC 830 CTA, `verify-fx-client-consolidation` 4/4 client==server). Payroll basis-C,
AP/AR netting (F58), period-scoped opex, FIFO COGS.

Entity isolation: documents, audit trail, transaction-lock, team (invite + edit), templates, timesheet,
projects, connectors — all per-entity, harness-backed. Connectors are now FULLY per-scope: every connection (Stripe, Plaid, QuickBooks, Xero, PayPal, Zoho, Square, Shopify, WooCommerce, Coinbase, Finch, Codat, Belvo, Wise, WiPay, dLocal, Mercado Pago) + the `/api/connections` toggle state is keyed per business entity AND personal (entity_id NULL) with NO cross-scope fallback (`verify-connections-isolation` 15/15; deployed + verified live 2026-10-04). Cross-tenant IDOR tested (`verify-tenant-isolation`).

Accountant marketplace: client<->accountant handshake, bidirectional chat, per-entity access grants,
KYC (Stripe Identity + registry links), GL certification, tax summary.

Security: session hardening + cookie flags, layered rate limits, CSRF defense, RBAC matrix, owner + accountant
TOTP MFA, audit-trail (append-only) + anomaly detection/delivery/monitor (brute-force, cross-client, mass-export),
connector-token encryption at rest, security headers + Permissions-Policy, upload/download hardening,
account deletion purge + GDPR export, no secrets in the client bundle (`verify-no-secrets-in-bundle`).

Perf/ops: composite index + keyset pagination (server), server-aggregated AR + top-clients, minify build
(`prestart` regenerates `public/.min/` on every deploy; served only when newer than source), self-hosted
Chart.js, compression, region routing, `/healthz`, migrations runner, restore drill, CI npm-audit gate,
accessibility (0 axe violations across 10 pages).

Integrations live-verified: Stripe, Plaid, WiPay (2026-08-16); Resend email path wired (sandbox sender).

### Fixed this session (2026-09-28) — each with a discriminating harness, all green on real Postgres
- **H1** overdue nets credit notes, clamped ≤ outstanding (dashboard KPI + AR report) — `verify-fc1-overdue-date` (credit-note seed, RED→GREEN).
- **M1** expense breakdown decomposes opex so Σ(rows) == Expenses KPI — `verify-expense-breakdown-reconcile`.
- **H2** escaped two real unescaped sinks (accountant bill dropdown [cross-tenant], timesheet) — `verify-escaping-sweep` (static, all render sources).
- **M2** entity create infers IANA timezone from country (no silent UTC) — `verify-entity-tz-infer`.
- **Payroll** approve can't revert a paid run (409) — `verify-payroll-approve-guard`.
- **Security** no live secret in any client-served file — `verify-no-secrets-in-bundle`.
- Also: the `\u` escape literals in static HTML rendered as text — fixed.

### Added since (2026-09-30 → 10-04) — each harness-backed, deployed
- **World-class Help Center + support**: in-app help (25 articles / 11 categories), guided tours, ⌘K palette, threaded “Ask FinFlow” AI with grounded deep-links + AI→ticket escalation, 6-step onboarding checklist from real data; support inbox (client/accountant → admin) — `verify-help-*`, `verify-support-request`, `verify-admin-support`.
- **Client↔accountant chat deepened**: offline-email notify (cooldowned), file attachments, threaded Ask FinFlow — `verify-chat-attachments`, `verify-chat-ai-wiring`.
- **Accountant marketplace engagement loop**: proposals, client tasks/requests, dashboard attention rollup — `verify-accountant-proposals`, `verify-accountant-tasks`, `verify-accountant-rollup`, `verify-proposals-ui`.
- **FX-live layer** (pair resolution: direct/inverse/cross-via-USD + USD-base feed, manual-wins, idempotent-per-day) — `verify-fx-live-rates` 14/14.
- **Admin platform ops** (audited CSV exports, operating-costs / platform_settings round-trip, flagged-transactions lifecycle) — `verify-admin-platform` 16/16.
- **Full per-scope connector isolation** (above) — `verify-connections-isolation` 15/15; deployed + verified live on prod.
- Product-scope note: tax = **ESTIMATES only** (no filing / VAT / GST engine) — by design (see `CLAUDE.md`).

### Added 2026-10-05 — QuickBooks-parity AI layer — each harness-backed, deployed
- **Review / cleanup queue** (`books-review.js`, `GET /api/books-review`): read-only anomaly detector — uncategorized, possible duplicates (create-time identity + exact date), missing required fields, per-category median outliers; AI category suggestions reuse `/api/autocat-rules/ai-suggest`. Pure engine, no money-KPI recompute (Rule 2) — `verify-books-review` 19/19. Verified live (owner opened the tab; flagged a real duplicate invoice + a missing-due-date invoice). (commit `054b9f0`)
- **AI payment-reminders agent** (`payment-reminders.js`, `GET /api/payment-reminders`, `POST /draft`, `POST /send`): deterministic late-payer prediction from real `invoice_payments` history, severity-tuned drafts, optional Haiku polish (shared-capped, template fallback), supervised one-at-a-time send via Resend (recipient resolved server-side, idempotent 60s, audit-logged) — `verify-payment-reminders` 25/25. Engine-verified; live send needs `RESEND_API_KEY`, AI polish needs `ANTHROPIC_API_KEY` (both degrade clean). (commit `fed2142`)
- **13-week cash-flow forecast** (`cashflow-forecast.js`, `GET /api/cashflow-forecast`): forward projection from GL cash (`glBalanceSheet`, acct 1000 — authoritative, Rule 2), open AR/AP by due date, recurring invoices/bills (expanded via `nextRunDate`), plus a 90-day opex run-rate; weekly running balance, lowest point, runway; graceful when GL cash untracked. Forecast card on the Cash Flow page — `verify-cashflow-forecast` 19/19. Engine-verified; endpoint sourcing gets first live run on the page. (commit `95091c2`)
- **Supervised bulk actions in the review queue**: confirm-gated "Delete duplicate" (routes through the existing GL-reversing `DELETE /api/{type}/:id`, keeps the original) and "Apply all (N)" AI-suggested categories (batched `PUT /api/expenses/:id` after review). Client-only; reuses audited endpoints, detector engine unchanged. (commit `cf2050f`)
- Origin: closes the AI gaps vs QuickBooks Intuit Assist identified 2026-10-05 (agentic send + real forecasting + supervised cleanup). Remaining QB-ahead items — classes/locations, public API + Zapier, Google Sheets sync, native app stores — tracked separately, not launch-blocking.

### Fixed 2026-10-05 (pm) — entity-switch money leak (client display)
- **`window.userInvoices` went stale on an entity switch.** `loadEntityData` refreshed the lexical `userInvoices` and `window._realInvoices`, but never `window.userInvoices` — the source the **Invoices table**, **CSV/XLSX export** and **invoice action handlers** read. So switching to e.g. the TT company left those surfaces listing the US entity’s invoices with the new entity’s currency symbol stamped on them (“the TT company is just the US figures converted to TT”). Dashboard KPIs were already correct — they read `window._realInvoices`, which reloads on switch. Fix: keep `window.userInvoices` canonical inside `loadEntityData` under the F151 stale-response guard, and `switchEntity` now clears the money collections synchronously at the currency flip (belt to the boot-splash). `verify-entity-switch-money-clear` 8/8 (RED→GREEN on real Postgres); cross-entity `verify-entity-leakage-sweep` still 18/0. **312 harnesses.** (commit pending)
- **Entity-switch overview-chart stale bar** (same class, chart layer): the Revenue-vs-Expenses monthly arrays REV[]/EXP[] are rebuilt from the global collections on switch, but the chart was only painted once by loadEntityData (with the previous entity's collections) and never repainted after the Promise.all reload — updateDashboard doesn't call updateCharts and _refreshDashboardUI only rebuilds a MISSING chart — so an empty entity kept a lingering bar. switchEntity now rebuilds the arrays from the reloaded collections and repaints (updateCharts). `verify-entity-switch-chart-clear` 8/8 (RED→GREEN; updateCharts calls on switch 0→1). **313 harnesses.** (commit pending)

---

## 4. Verifying (how)

Full sweep (auto-discovers every `verify-*.js` + `-gate.js`):
`node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js` (clock pinned 2026-07-25).

Owner runs all git in PowerShell (assistant provides commands, never runs git). Bundle is regenerated by
`node bundle.js`; `index.html` / `app-main.js` ship direct (not bundled). If `device_bash` can't run the
Postgres harnesses (OneDrive FUSE), run them in a clean Linux env: fresh `npm install` (unpacks the
embedded-postgres linux-x64 binary), run AS the `postgres` user
(`runuser -u postgres -- env SESSION_SECRET=test HOME=<dir> bash -c 'cd <dir> && node -r ./tests/harness/clock.js tests/harness/<FILE>.js'`).

---

## 5. Kept reference docs (not status — these explain how the system works)

- `CLAUDE.md` — the 3 defining failures + 14 non-negotiable rules. Overrides default behavior. Read first.
- `VERIFICATION.md` — the money-cell ledger; the re-sweep on real data is the launch sign-off.
- `ARCHITECTURE_MAP.md` — system architecture.
- `GL_DESIGN.md`, `GL_CONSOLIDATION_DESIGN.md`, `FX_CONSOLIDATION_DESIGN.md` — accounting/FX design specs
  (note: the FX doc's STATUS header predates the client-layer fix, which is now shipped + verified).
- `RLS_DESIGN.md` — design for the (open) Postgres RLS work.
- `INFRA_RUNBOOK.md` — ops runbook (deploy, DB role, restore, env).
- `REVIEW_RULES.md` — review-layer process.
