# FinFlow — Launch Checklist (authoritative)

**Rewritten:** 2026-10-19 · **Updated:** 2026-10-20 — release of the 2026-10-19 live-check fixes (FIX-1…5) and the
audit-trail coverage work (LC3b, LC3d, LC3e, LC3f, LC3g): branch `claude/laughing-hawking-lkvv38` @ `ad228ab` + this
docs commit, fast-forwarded onto `main` (which was `14709a6`, the commit the 557 ×3 sweep ran on) · **Replaces** the
2026-10-05 version of this file (see git history at `47a026c`), which predated the 2026-10-09 money audit and the
2026-10-13 live audit. · **Updated again 2026-10-20 (later):** results of Cowork's full live retest of this release —
52 checks, 40 PASS · 6 FAIL · 5 BLOCKED · 1 SKIPPED (`COWORK_RETEST_RESULTS_2026-10-20.md`; findings = `AUDIT_MASTER.md` LR1–LR21).
**Updated 2026-10-21 (agent, UNCOMMITTED on the working copy — the owner commits; command list in the session report):** the launch pass (`PROMPT_LAUNCH_ALL.md`). Fixed RED → GREEN: LR11, LC3c (known gap 17 → 0), LR12, LR13, LR15, LR20, LR21 (industry half), new LR24 / LR26 / LR27 (sweep timer), A5 (Sentry dependency, restore-drill guard, indexing confirmed), A6 (test-data list + purge tools), A7 (LC1c link script, prepared). Owner steps: `OWNER_ACTIONS_2026-10-21.md`. Decisions: `DECISIONS_2026-10-21.md`. Still open in code: LR14, LR16, LR18, LR19, LR21 (×5 settings fetch — needs a live trace), VERIFICATION A7.5–A7.8 / A7.18 / A8a / A8b stamps (§4.2).

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
>
> **2026-10-20 live retest:** two 🔴 code findings now stand between this release and "nothing blocks": **LR1** (Run
> Payroll returns HTTP 500 on the test account) and **LR7** (Budget targets "Monthly" saves every row × 12). See §0.4.

---

## 0. Finish the release in flight

**Previous release** (live audit 2026-10-13, LA1–LA23): swept **557/557 GREEN ×3** on `14709a6` (owner, 2026-10-19) and
merged to `main` — DONE.

**This release (2026-10-20)** — 15 commits after `14709a6`, owner instruction 2026-10-20 "push to main and have Railway
redeploy":

| Commit | What reaches production |
|---|---|
| `c0957a3` FIX-1 | Time entries link to a project (`project_id`); project hours / billed are derived from the linked entries. |
| `5505e9e` FIX-3 | Quotes, projects, time entries, budget targets write audit rows; Audit filter options. |
| `6ceaec0` FIX-4 | The `hidden` class hides any element (Record Payment "exceeds balance" warning; Stock In supplier fields). |
| `4bd7a47` FIX-5 | Top-bar controls wrap — no page slides sideways at 769–1,056 px; page title never squeezed to 0 px. |
| `3419b94` LC1b | Projects labels name what the figures are (billable value, not "Billed"). |
| `cb1c809` FIX-3b | 32 money / access routes write audit rows; structural guard against a new unaudited route. |
| `33ade9b` FIX-2 | "Full year total" → "Year to date" (figures unchanged). |
| `2a8785a` LC2b | Period labels follow a non-January fiscal year after a page load. |
| `d628344` LC1d | `VERIFICATION.md` A10 Projects & time (owner values). |
| `170ab65` + `b09dccc` LC3g | Every admin action on an append-only, attributed `admin_log`; a customer sees "FinFlow support" changes on their own Audit page. |
| `70fc8f8` LC3d | Security log: every sign-in / 2FA / password event (success and failure) with IP + device; Settings → "Recent security activity"; e-mail alerts (2FA off, password changed / reset, new device). |
| `1b41b86` LC3f | Both sides of the accountant relationship on the client's trail; accountant account events. |
| `ad228ab` LC3e | Every connect / disconnect of an outside service, "books into" changes, bank-feed syncs (business only, never a credential). |

| # | Step | Status | Evidence / how to confirm |
|---|---|---|---|
| 0.1 | Full sweep 3× on this release | ⬜ OPEN (owner) | The sweep's "(0.0s)" timings were a DISPLAY bug only — clock.js pinned Date.now() inside the runner; harnesses did run (LR27, fixed: real times now). Run ×2 more per `OWNER_ACTIONS_2026-10-21.md` §2. Agent ran targeted + related sets for every 2026-10-21 fix (counts in AUDIT_MASTER rows) and a final full sweep (count in the session report / HANDOVER). |
| 0.2 | Merge to `main` | ✅ DONE 2026-10-20 | Fast-forward (`main` had no commits the branch lacked). Railway deploys `main`. |
| 0.3 | Schema changes apply on first boot | ⬜ CONFIRM | Applied by `initDB()` at boot (`SKIP_INIT_DDL` is not set — §2.3) and mirrored by `scripts/migrations/2026-10-20-admin-log-hardening.sql` and `…-audit-trail-user-agent.sql`: `admin_log` gains ip / user_agent / session_ref / before_data / after_data / outcome + append-only trigger `admin_log_no_mutate`; `audit_trail` gains `user_agent`. Schema only, no data changed. Railway log: `[migrate] applied …`, no `[audit] recordAudit failed`. |
| 0.4 | Post-deploy live check | 🟠 RUN 2026-10-20 — open FAILs | Cowork, `COWORK_RETEST_RESULTS_2026-10-20.md`: (a) time → project ✅ (F1); (b) audit rows for new quote / time / budget ✅, "Connected services" + "Security" filters ✅ (T1, T2, T5) — a quote or time entry cannot be *edited* in the UI (LR9, LR10), no manual bank line can be added (LR11); (c) "Recent security activity" lists the sign-in with device + IP ✅ — failed sign-in not tried (owner step, T4); (d) overpay warning ✅ (F3); (e) no sideways scroll ✅ (F4); (f) Dashboard "Year to date" ✅, Reports line reads "Year to date · Jan 2026 – Oct 2026" (LR6); (g) audit says a new-device alert was "sent: true" (LR17 — confirm). Plus FAILs elsewhere in the run: LR1 payroll 500, LR2/LR3 Money-flow stale, LR4, LR5. |

---

## 1. Hard blockers — do not launch without these

| # | Item | Status | Evidence / how to confirm |
|---|---|---|---|
| 1.1 | **Rotate the database password** | ⬜ OPEN (owner) | Steps + bad-paste signature (28P01 + ECIRCUITBREAKER + "[Session Store] non-fatal") + verification: `OWNER_ACTIONS_2026-10-21.md` §1. |
| 1.2 | **Real email** — verify the sending domain in Resend (SPF + DKIM), set `RESEND_API_KEY`, `EMAIL_FROM=noreply@<domain>`, `ADMIN_EMAIL` | ❔ CONFIRM | Last record (2026-10-05): sandbox sender `onboarding@resend.dev`, which delivers only to the owner's inbox → password resets, invites, receipts and reminders do not reach real users. Settings exist in code (`server.js`, `.env.example`). Confirm: a reset email arrives at a non-owner address. |
| 1.3 | **Stripe prices match the site** — Business **$249/mo** (was $199 in Stripe), create Scale **$400/mo**, set `STRIPE_PRICE_PRO` / `_BUSINESS` / `_SCALE` | ❔ CONFIRM | The site advertises $249 and $400 (`public/landing.html:388,421`, `public/index.html:3306,3319,3352`). Checkout reads `STRIPE_PRICE_<PLAN>` (`server.js:1079`); an unset price returns "Checkout … not set up". |
| 1.4 | **Stripe live mode** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (live), `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_REDIRECT_URI` | ❔ CONFIRM | Then do ONE real paid upgrade: trial → Upgrade → Stripe checkout → plan shows paid. This also closes the last open half of **F132** ("Upgrade reaches a working checkout"). |
| 1.5 | **Core settings** — `SESSION_SECRET` (long random), `APP_URL` (public https), `CONNECTOR_ENC_KEY`, `ANTHROPIC_API_KEY` | ❔ CONFIRM | All read by `server.js`; listed in `.env.example`. |
| 1.6 | **Production test data** | ⬜ OPEN · 🔒 OWNER — tools READY | `tools/launch/list-test-data.js` (read-only) + `tools/launch/purge-test-data.js` (dry run by default, `--apply --expect <fingerprint>`, reversals not raw deletes, refuses locked periods / an unbalanced result) — `verify-a6-test-data-purge` 15/0 (AUDIT_MASTER A6). Steps for both paths (clean vs fresh DB): `OWNER_ACTIONS_2026-10-21.md` §8. |
| 1.7 | **Backups proven** — run one real restore | ⬜ OPEN (owner) | `scripts/restore-drill.sh` now refuses DEST = SRC (it runs `pg_restore --clean`; a production URL never contains "prod") — `verify-restore-drill-guard` 7/0. A real dump → restore is UNEXECUTED here (no pg client tools); exact command: `OWNER_ACTIONS_2026-10-21.md` §9. |
| 1.8 | **Search indexing** — set `ALLOW_INDEXING=1` at the moment of launch, not before | ⬜ OPEN (correctly) — behaviour VERIFIED | `verify-a5-sentry-indexing` I1 / I2: unset → `X-Robots-Tag: noindex, nofollow` + `Disallow: /`; `ALLOW_INDEXING=1` → no header + `Allow: /`. Launch-moment steps: `OWNER_ACTIONS_2026-10-21.md` §14. |

---

## 2. Strongly recommended before real users

| # | Item | Status | Evidence / how to confirm |
|---|---|---|---|
| 2.1 | Uptime monitor on `GET /healthz` (200 healthy / 503 degraded) | ❔ CONFIRM | Endpoint exists (`server.js:1097`, `verify-healthz`). |
| 2.2 | Error monitoring — `SENTRY_DSN` (+ `npm i @sentry/node`) | ⬜ OPEN (owner sets SENTRY_DSN) — code READY | `@sentry/node` was missing (setting the DSN alone did nothing) — added; `verify-a5-sentry-indexing` 7/0 (a route error reaches Sentry; unset = no-op). `OWNER_ACTIONS_2026-10-21.md` §10. |
| 2.3 | Least-privilege DB role — web process as `finflow_app` with `SKIP_INIT_DDL=1`; schema via `node scripts/migrate.js` in the release step | ⬜ OPEN (owner) | Re-run GREEN 2026-10-21 (`verify-db-app-role`, `verify-migrate-entrypoint`, `verify-migrations-runner`); new tables covered by DEFAULT PRIVILEGES. Exact Railway changes + rollback: `OWNER_ACTIONS_2026-10-21.md` §11. |
| 2.4 | Cloudflare in front (proxied DNS, TLS Full (strict), managed WAF — free tier is enough) | ❔ CONFIRM | Steps: `OWNER_ACTIONS_2026-10-21.md` §12. Code dependency fixed: the security log now records the visitor's IP, not the proxy's (LR26). |
| 2.5 | Secrets rotation schedule (DB URL, Stripe, connector keys) + rotate on any suspected exposure | ⬜ OPEN | 1.1 is the first instance. |
| 2.6 | Legal review of `terms`, `privacy`, `security` pages | ⬜ OPEN · 🔒 OWNER | What a lawyer must check (12 points): `DECISIONS_2026-10-21.md` §2.6. |
| 2.7 | Live functional check of the areas no audit has exercised | 🟠 RUN 2026-10-20 | Part C 14/15 PASS, C14 (accountant portal) BLOCKED — no accountant login. Gaps found: LR9 (no quote edit / convert), LR10 (no time-entry edit), LR11 (bank "+ Add" stub), LR13 (Documents cards), LR16 (Bank Rec balances). Scope: `COWORK_LIVE_CHECK.md` Part C: Time Tracking, Budget, MRR/SaaS, Quotes, Sales Receipts, Payments Received/Made, Classes, Scheduled Documents, Reminders, Documents/Templates, Audit trail, accountant portal. |
| 2.8 | `SECURITY_ALERT_EMAIL` (audit-anomaly digest), `LOG_REQUESTS=1` | ⬜ OPEN (optional) | Supported in `server.js`. |

---

## 3. Launch-scope decisions (owner)

| # | Decision | Status | Notes |
|---|---|---|---|
| 3.1 | Which integrations are live on day one | 🔒 OWNER | Each connector is dark (clean "not set up") until keyed. Some need the provider's approval and take time: Plaid production, QuickBooks / Xero app review. Suggestion: launch with Stripe + Plaid + statement import; label the rest "coming soon". Keys: Plaid `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production` · Belvo `BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`, `BELVO_ENV` · OAuth connectors (QuickBooks, Xero, Zoho, Square, PayPal, Coinbase, Shopify): client id + secret each · Finch `FINCH_*` · Codat `CODAT_API_KEY` · optional `FINNHUB_API_KEY`, `COINGECKO_API_KEY`. WiPay / WooCommerce take per-user credentials in-app (no server keys). |
| 3.2 | Expired trial: read-only (current) vs hard-lock vs grace period | 🔒 OWNER | Read-only is built and verified (F132, `f130-trial-expired-paywall`). F130 left the policy open; confirm read-only is the launch policy. |
| 3.3 | Pick the account's reporting currency | 🔒 OWNER (after 0.2) | New Settings field (LA21). Until chosen, "All entities" uses the oldest business's currency. |
| 3.4 | Old time entries with no project (LC1c) | 🔒 OWNER | Entries logged before FIX-1 count on no project. Run the read-only `tools/fix-2026-10-19/fix1-unlinked-time-entries.js` against production, then decide: link the exact-name matches (its own commit, Rule 8), or leave them. |
| 3.5 | How long a deleted account's security events are kept (LC3d-b) | 🔒 OWNER / legal | The audit trail outlives a deleted account (legal record) and now holds sign-in IPs and devices. Part of 2.6. |
| 3.6 | A business service connected with no business yet (LC3e-c) | 🔒 OWNER | Record it account-level, or require a business before connecting. |
| 3.7 | Named admin accounts (LC3g-b) | 🔒 OWNER | One shared admin login today; the admin log tells sessions apart, not people. Only needed if anyone besides the owner gets admin. |

---

## 4. The done-gate — last, right before flipping public

| # | Gate | Status | Notes |
|---|---|---|---|
| 4.1 | Full sweep 3× GREEN on the exact commit going live | ⬜ OPEN | `node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js`. Capture: `HANDOVER.md` (log-file command). |
| 4.2 | `VERIFICATION.md` re-sweep on real seeded data | ⬜ OPEN | Per `CLAUDE.md`, **done = every check in `VERIFICATION.md` green**; anything not on it is unverified. 19 Result cells are empty (A7.5–8, A7.18, A8a/A8b) — gate-tested but not stamped. |
| 4.3 | Human smoke test on production | ⬜ OPEN | Sign up → create a business → invoice + expense → record a payment → P&L / balance sheet / All entities → connect one sandbox bank → invite an accountant. **Confirm the emails actually arrive** (needs 1.2). |
| 4.4 | Live check complete with no open FAIL | ⬜ OPEN — 2026-10-20 run: 6 FAIL: B6 (LR1), B5 (LR2), B8 (LR3 + LR4), A4 (LR5), F2 (LR6), B10 (via LR1), 5 BLOCKED (T2, T3, T4, T8, C14), 1 SKIPPED (T6) | `COWORK_LIVE_CHECK.md` A (fixes live) + B (rerun of the 13 Oct live audit) + C (untested areas). |

---

## 5. Code state (verified)

| Area | Status | Evidence |
|---|---|---|
| Live retest 2026-10-20 — rows LR1–LR21 | ⬜ OPEN | `AUDIT_MASTER.md` LR rows. 🔴 LR1 (payroll run 500), LR7 (budget Monthly × 12); 🟠 LR2 / LR3 (Money flow stale), LR11 (bank "+ Add" stub); 🔒 decisions LR5, LR6, LR9, LR10; rest minor. Live confirmation of LA / LC fixes in the same section. |
| Live check 2026-10-19 — FIX-1…5 (rows LC1–LC5) | ✅ FIXED, deployed 2026-10-20 (§0); live-confirmed 2026-10-20 except LC2's Reports line (LR6) | `AUDIT_MASTER.md` LC rows; each RED → GREEN. FIX-2 = relabel (owner decision: "Year to date"). Open from it: LC1c (data, 3.4). |
| Audit-trail coverage — every route that changes data (LC3b–LC3g) | ✅ FIXED except LC3c, deployed 2026-10-20 | Guard `verify-fix3b-audit-route-guard` (structural): 259 routes — 221 audited (personal ones to personal history), 38 exempt with a stated reason, **0 known gap** (2026-10-21; it also asserts no personal route writes the business trail). GET routes that write are checked too (LC3e-b). |
| LC3c — separate personal history | ✅ FIXED + VERIFIED 2026-10-21 (UNCOMMITTED) | `AUDIT_MASTER.md` LC3c: 26/0 server, 4/0 UI, guard 8/0 with known gap **0**. |
| Live audit 2026-10-13 — 23 rows (LA1–LA23) | ✅ VERIFIED closed (20 fixed, LA11/LA12/LA22 explained or decided) | `AUDIT_MASTER.md` "LIVE AUDIT 2026-10-13" table; each fix has a harness RED on the old code, GREEN on the fix. B2 withdrawn after a live repro (crossing works). |
| Money audit 2026-10-09 (M-rows) | ✅ VERIFIED per `MONEY_AUDIT_2026-10-09.md` | Rounds 1–3 fixed with harnesses (e.g. M53, M62 green in the 555 sweep). |
| Full sweep | ✅ 557/557 ×3 on `14709a6` (2026-10-19) | `HANDOVER.md`. |
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
