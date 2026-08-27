# FinFlow — Outstanding Work (session handoff)

---

## ⭐ CURRENT — remaining after the 2026-08-21 audit + fix sessions

**Shipped & verified this pass (all committed/pushed):** F186 (dashboard Net used all-time COGS at boot →
period-scoped), F187 (draft invoice showing in the tx feed → filtered), M1 (connector key decoupled from
`SESSION_SECRET`), L1 (session regen), L2 (hashed reset tokens), L4 (`/api/ai` scope), L8 (cron compare),
L6 (fonts→Jost), M2 (4 flaky client harnesses stabilised), M3 (`npm audit fix`), plus the VERIFICATION.md
cell closure (A1–A6, B2, B5.1/B5.3). **Money engine 150/0 gates, full sweep 141/141 GREEN, 0 open money bugs.**

**Shipped this session — F88 kickoff (commit `6b17db3`):** F88 **step 1** — entity `timezone` (IANA) +
`country` (ISO-2) added to `POST/PUT /api/entities` with validation (`Intl`-based, no new dep); entities are
JSONB so no migration. New harness `verify-entity-timezone.js` = **17/0**. Independently re-verified by
Claude Code + the cloud container: gates **150/0**, full sweep **141/141 GREEN 0 RED**, diff confirmed
**model-only** (`resolvedToday`/`_isScheduled`/`runRecurringScheduler`/`nextRunDate` untouched), and both
client callers post no `country` key so no existing create-flow regression. Design mock for the page it
unlocks (F94) is committed at `F94_SCHEDULED_DOCS_DESIGN.html` (repo root, open in a browser); scope in
`F88_SCOPE_2026-08-21.md`. **F88 step 2 (`resolvedToday` phase-2 entity-tz resolution) also shipped this
session — `cad82e3`, 14/0, gates 150/0, full sweep 142/142.** See **§ A2** for the step ledger.

## 🆕 Shipped 2026-08-24 — launch-readiness pass (login, email, mobile, exports)

**All committed/pushed; production `finflow-production-dab2` live.**
- **Transactional email (Resend) — WIRED + LIVE.** `resendClient` inits on `RESEND_API_KEY`; the
  forgot-password + reset routes send via Resend. `verify-email-resend.js` **10/0** (mocks the network
  boundary: correct `from`/`to`/`subject`, an `APP_URL`-built reset link, the L2 hashed-token store, and a
  full emailed-link → reset → login round-trip). **Live-confirmed** — a real reset email was delivered to
  the owner's inbox from production. `EMAIL_FROM` + `RESEND_API_KEY` set in Railway; sender is the Resend
  sandbox `onboarding@resend.dev`. accountant-routes `.io`→`.app` link fallback fixed (`fedabab`).
  - ⚠️ **REMAINING (email launch blocker for real users):** the sandbox sender only delivers to the Resend
    account owner's own email. To send resets/receipts to ANY user you must **verify a domain in Resend**
    and set `EMAIL_FROM=noreply@<yourdomain>` (~15 min of DNS). Until then real users get no reset email. → § H.
- **Forgot-password on the LIVE login — SHIPPED.** The runtime-winner login is JS-rendered by
  `finflow-api.js` `showAuthGate` (the static index.html login is dead-shadowed, Rule 1) and had no
  forgot-password affordance. Added the "Forgot password?" link + reset panel + `ffForgot()` (POSTs
  `/api/auth/forgot-password`); bundle regenerated. `verify-forgot-password-ui.js` **10/0** (jsdom).
- **First-login blank-screen — FIXED.** After sign-in the whole app showed empty (KPIs/chart/lists blank)
  until a manual refresh; console showed a 401 flood on every data endpoint. Root cause: the dashboard +
  money data are painted by the **wiring boot** (`finflow-api-wiring-final.js` `_run` → `_ffApiBootEasy/
  Medium` → the entity path), which runs ONCE on page load and 401s while logged-out, and never re-runs
  after the thin-shell's in-page `ffOnAuth` (its partial `ffLoadData` doesn't paint the dashboard by
  design). Fix: `ffLogin`/`ffRegister` now `location.reload()` on success (the server already awaits
  `saveSession` — F134 — so the session is durable), re-entering the wiring boot exactly like the refresh
  that already worked. `verify-login-reload.js` **5/0** (reloads once on success, not on a failed login;
  POSTs `/api/auth/login`). Canaries green (auth-flow 25/0, f132 7/0, c6-hdrain 2/0, dashboard-render 9/0).
- **Lighthouse pass (2026-08-20 reports: mobile Perf 54 / desktop 80; Best-Practices 77; A11y 100; SEO 100).**
  Fixes shipped 2026-08-24:
  - **Best Practices — third-party cookies REMOVED.** `index.html` loaded the Plaid (`cdn.plaid.com`) AND
    Belvo (`cdn.belvo.io`) bank widgets eagerly on EVERY page load → 4 third-party cookies + a DevTools
    Issues entry, for users who never link a bank. Now lazy-loaded via `window._loadScriptOnce(src)` only
    inside `ffLinkBank`/`ffLinkBelvo` (same CDN hosts → CSP unchanged, already in `script-src`). Also takes
    third-party JS off the mobile critical path.
  - **Agentic Browsing — added `public/llms.txt`** (the only failing audit in that category).
  - ⏳ **STILL OPEN — mobile Performance (54).** The bulk is the app's OWN JavaScript: ~750 KiB shipped
    UNMINIFIED (`app-main.js` 414 KB + `finflow-bundle.js` 343 KB), ~9.5 s main-thread work, TBT 1,230 ms,
    plus "reduce unused JS" 469 KiB. This needs a **build/minify step** (the served files are currently the
    editable sources — no pipeline) and/or code-splitting. A real project, not a quick fix; scope separately
    so the owner's PowerShell-commit workflow is accounted for. App-code caching stays deliberately
    `no-store` for `*.js`/`*.html` (SW is the freshness layer) — do NOT flip without content-hashed filenames.
  - **Safe caching win shipped 2026-08-24:** `express.static` `setHeaders` now long-caches stable,
    non-app-code assets — `/vendor/*` (Chart.js) → `max-age=31536000, immutable`; images/fonts/icons →
    `max-age=2592000`. App code + HTML untouched (still `no-store`). Money baseline re-confirmed 150/0.
- **Service worker bumped `v2`→`v5`** (`sw.js` `SW_VERSION`) so clients pull the new shell after deploy
  (v3 = forgot-password/email; v4 = first-login fix; v5 = Plaid/Belvo lazy-load).
- **Mobile / responsive — smoke-tested + fixed.** Wide tables card-stack under `@media(max-width:560px)`;
  Playwright mobile+desktop screenshots reviewed. (`965171c`)
- **Chart.js self-hosted.** `public/vendor/chart.umd.js` (4.4.1 UMD); `loadChartJS` repointed off cdnjs;
  cdnjs preconnect removed — no third-party CDN at runtime. (`965171c`)
- **PDF / CSV exports — smoke-tested** (no regressions found).
- **Deploy incident fixed:** a production 500 (`ERR_INVALID_CHAR` in `cors()`) was a trailing newline in the
  `ALLOWED_ORIGIN` Railway var — retyped clean. Same env-hygiene class as the Resend key paste; watch for it.
- **F128 optional hygiene** (`renderReports` inert paid-only calc removed) shipped (`43d715b`).

**Money engine unaffected:** gate baseline re-confirmed **150/0** (26/63/56/5) after the login/bundle change;
L5 canaries (`c6-hdrain`, `f132-readonly`) green standalone (f132's one sequential-load red is the known flake).

> Nothing below is an open money bug or a core-product launch blocker.

### A. Real work remaining — each its own scoped pass, NOT a batch edit
1. **L3 — CSP `script-src 'unsafe-inline'` removal.** The app has **623 inline event handlers** (466 in
   index.html); CSP nonces don't cover inline handlers, and adding a nonce disables `'unsafe-inline'`, which
   would freeze the app. Requires migrating all 623 handlers to `addEventListener`, page by page. Or accept
   `'unsafe-inline'` (rest of the CSP is already tight). Evidence: `PARTB_L3_L5_2026-08-21.md`.
2. **L5 / F92 — dead shadowed app-main functions removal.** A batch removal of the 15 confirmed replacements
   was ATTEMPTED and REVERTED — it broke `c6-hdrain` + `f132-readonly` even after AST-precise analysis (the
   functions have non-obvious boot-timing coupling). Must be done **one function at a time, each re-verified
   against the full suite**. Zero functional benefit (runtime already correct); pure maintainability.

### B. Needs your keys (post-launch; code built + verified to the network boundary)
3. **8 connectors** — Belvo, Finch, Codat, Paystack, Flutterwave, dLocal, Mercado Pago, Wise. Each needs
   live keys + one sandbox transaction. (Plaid, Stripe, WiPay already live-verified.)

### C. Owner decisions — RESOLVED 2026-08-21; **F128 / D1 / F86 re-ruled + re-verified 2026-08-23** (see AUDIT_MASTER / VERIFICATION for evidence)
4. **F128 — CLOSED (ratified 2026-08-23).** Statements render rich + canonical-sourced via the live
   `generateReport` winner (P&L / Balance Sheet / Cash Flow + AR/AP/Sales/Payroll/VAT/tax/1099/deductible),
   re-verified GREEN this session (P&L 17/0, BS 6/0, CF+AR+AP 12/0, Sales+Payroll 9/0, Tax 20/0, canonical-
   source 7/0). **Correction to the prior note: there are no residual "3 dead bodies" — the app-main
   `generateReport` shadow was DELETED during F137 (`app-main.js:5800-5804` tombstone).** The only app-main
   report code left is the wrapped `renderReports` menu. **Optional hygiene DONE 2026-08-23:** the inert
   paid-only calc in `renderReports` was removed (the menu now passes only the report NAME; the winner
   ignored the numeric args); report harnesses + both L5 canaries (c6-hdrain, f132-readonly) green.
5. **F94 — DESIGN DELIVERED.** Calendar-first Scheduled Documents prototype built (unified agenda of
   recurring runs + future-dated one-offs; per-item Run-now/Skip/Pause/Cancel). Wiring depends on F88
   (entity-tz day-edge boundary). Next: approve design → resolve F88 → build the real page w/ harness.
6. **D1 — RULED 2026-08-23: no blended tax figure, no schema change.** Keep the multi-line Income Tax
   Estimate worksheet + VAT Return as separate owner-set lines; "tax paid" stays "Not tracked" (A7.23
   guard stands — any computed tax-PAID number = FAIL). A combined KPI would imply the calc F8/D1 refused.
   Verified: verify-tax-rate 14/0, verify-f139 12/0, verify-f137-tax-reports 20/0. VERIFICATION §C.3 ruled.
7. **F86 — RULED 2026-08-23: `invoice_payments` is canonical; A7.4 STAMPED PASS (1,500).** Every live
   surface already reads it (page via F95; cash-in + computeBooks dropped `payments_received`). Read-only
   instrument `tests/harness/f86-payments-source-instrument.js` shows Store B $1,500 vs Store A $0. Store-A
   `payments_received` stays (computeBooks table list, audit trail, idempotency index + 5 harnesses) —
   retire via the gated deprecation below, NOT a pre-launch yank. → see A-new #0.

### A-new. Pre-launch, not urgent (owner-requested 2026-08-21)
0. ✅ **DONE 2026-08-23 — Store-A `payments_received` gated deprecation.** The manual write routes
   (`POST/PUT/DELETE /api/payments-received`) now return **410 Gone** behind a reversible flag
   (`server.js` — `_prWritesRetired()` reads `FF_PR_WRITES` at request time; **rollback = set
   `FF_PR_WRITES=1`**). DELIBERATELY LEFT LIVE: the GET read, the money-engine `TABLES` entry, the
   audit code, and the Codat importer's own writes (`_codatMappers → db.insert`, not this route).
   Dependent-harness reality (the "5" list was over-broad): only **3** actually drive the write
   routes and were handled — `verify-c1-payments-received` (asserts the 410 gate, then enables the
   flag to keep the reversible idempotency coverage), `verify-f90-update-audit` + `verify-f90-phaseB-
   coverage` (flag enabled to keep their route-audit coverage). `verify-f144-remaining` (client GET
   global) and `verify-entity-leakage-sweep` (SQL-seed + GET) never touched the write route → no
   change. Confirm-empty dry-run tool already present: `scripts/inventory-store-a.js` (read-only).
   Verified: c1 13/0 (+8/0 NO_INDEX control), f90-update 15/0, f90-phaseB 9/0, entity-leakage 18/0,
   codat-import 28/0, step3-gate 56/0; **full sweep 141/142** (the 1 red is the pre-existing
   `verify-c2-confirm-modal` load-flake — 10/0 standalone, unrelated). Next step (later): full
   removal of the store once history is migrated.

### A2. F88 — entity-timezone & locale resolution (IN PROGRESS — roots F94 + all day-edge correctness)
Full scope + build order in `F88_SCOPE_2026-08-21.md`. Problem: "today" and every auto-dated event resolve
to **UTC**, but a set of books belongs to an **entity** in its own zone/country/currency — so a US company
and a Canadian company both get judged by UTC (the multi-entity bug). The `resolvedToday(serverNow, tz)`
**phase-2 hook already exists** in `finflow-dates.js` (currently voids the tz arg, returns UTC).

- [x] **Step 1 — entity `timezone` + `country` (DONE, `6b17db3`, 17/0 + 150/0 + 141/141, re-verified by Code).**
      Model + validation only; nothing resolves against the zone yet (correct — that's step 2).
- [x] **Step 2 — `resolvedToday` phase 2 (DONE, `cad82e3`, 14/0 + 150/0 + 142/142).** A valid IANA tz (or
      numeric offset-minutes) now resolves the server instant to the entity's calendar date via
      `Intl.DateTimeFormat`; absent/empty/invalid ⇒ UTC (byte-identical to phase 1). `finflow-dates.js` is
      NOT a bundle source (own `<script>` + server `require`), so one edit updates both engines, no bundle
      regen. Harness `verify-resolvedtoday-tz.js` covers day-edge across PoS/NY/Toronto/Kolkata/Sydney, a DST
      year-boundary, the offset branch, junk-zone→UTC, and a phase-1 parity block. Nothing moves yet — every
      caller still passes a single arg (that's step 3).
- [x] **Step 3 — per-entity scheduler boundary (DONE, `5c03e9b`, verify-scheduler-entity-tz 16/0).**
      `runRecurringScheduler` resolves each row against its entity's `today` (widen query to UTC-tomorrow,
      then JS-filter on `resolvedToday(now, entityTz)`); no-tz + personal ⇒ UTC (byte-identical).
- [x] **Step 4 — entity tz into `_isScheduled` (DONE, verify-isscheduled-entity-tz 15/0).** `_activeEntityTz()`
      passed into `resolvedToday`; the "Scheduled" badge flips on the entity's day, not UTC.
- [x] **Step 5 — UTC-entity byte-identical guard (DONE, verify-f88-utc-parity 49/0).** Permanent tripwire over
      an 8-instant matrix + every legacy call shape; goes red if step 6 ever leaks into the no-tz path.
- [x] **Step 6 (additive) — holiday / business-day shift by `entity.country` (DONE + F190 fix, verify-scheduler-businessday-tz 36/0).**
      Modified-Following shift off weekends + `{public, bank}` holidays via `date-holidays` (offline). F190:
      matched by calendar string, no Date instant (fixed a UTC+12 under-shift + observance over-shift). Full
      sweep 149/149. Coverage verified across Canada, N/C/S America, the Caribbean, Europe — zero gaps.
- [ ] **Step 7 (POST-LAUNCH, optional) — sub-national (state / province) holidays.** Step 6 uses the entity
      `country` (ISO-2) ⇒ **national** public holidays only. It does NOT do subdivisions (e.g. an Ontario-only
      holiday vs all-Canada, or a US state holiday). `date-holidays` supports these via subdivision codes
      (`CA-ON`, `US-NY`, …). To add: store the entity's subdivision and pass `"<country>-<SUB>"` into
      `_closureSet` in `server.js`. National-by-country is the correct launch scope; this is a clean later add.
- [x] **F94 Scheduled Documents page — INCREMENTS 1 & 2 COMPLETE (own top-level tab, `showPage('scheduled-documents')`
      + nav-item; new `finflow-f94.js` loaded after the bundle so no bundle regen; verify-f94-scheduled-page 42/0;
      verify-recurring-scheduler 31/0; dashboard boot 9/0).** Renders LIVE entities + recurring/one-off schedules
      (NO hardcoded data), per-entity/multi-region, with calendar, KPIs, filters, and Pause/Resume/Skip/Cancel via
      existing routes (no client "run now"). Built from `F94_SCHEDULED_DOCS_DESIGN.html`.
      **Increment 2 DONE:** cash-flow forecast SVG (cumulative net impact, 60-day, starts at 0 — no fabricated
      balance); create-schedule modal (invoice/bill/personal → POST the existing `/api/recurring-*` routes, entity
      scoped server-side from the active session; client-side validation; harness opens+fills+saves each type);
      **F191** — timezone + ISO-2 country captured on the Create-Business form AND editable per existing entity via
      the in-tab region editor (PUT `/api/entities/:id`), so `entity.country` is set and step 6's holiday shift
      engages in prod; and **per-row last-posted lineage** — the scheduler now stamps a durable link on every
      materialised row (`recurring_invoice_id` on invoices, `recurring_bill_id` on bills — mirroring personal's
      existing `recurring_profile_id`, server.js:~3914/3941), and the row shows "Last posted <date>" resolved
      **link-exact only** (no fuzzy party/amount matching; unlinked historical rows show nothing). Scheduler-link
      verified end-to-end against real Postgres (verify-recurring-scheduler +2 asserts).
    - **Fixed in passing (F94-class, was latent in increment 1):** the one-off "Scheduled" path read
      `window.userInvoices` (display-mapper drops `issue_date` + `entity_id`) and `window.userBills` (never
      exists) — both were dead in prod. Now reads the RAW arrays the app loads (`window._realInvoices`,
      `window.bills`, `window._allPersTxs`), and `reload()` refreshes them. Auto-generated rows (`recurring_*_id`
      set) are excluded from the one-off list so they aren't double-shown alongside their template.

### D. Verification gaps (low-risk; optional to close)
8. **L4 (`/api/ai` scope) + L8 (cron compare)** — shipped and READ-verified, but not execution-verified (no
   AI/cron harness exists). Two small probes would put them on the permanent list.

### E. Never tested — NOT broken, just unverified (Appendix A)
9. live AI (`ANTHROPIC_API_KEY`) · performance/scale (the payroll-runs `LIMIT 50` client cap).
   **Closed 2026-08-24:** mobile/responsive (card-stack), PDF/CSV exports, and transactional email (Resend,
   live-confirmed) — all smoke/live-tested this session (see the 🆕 2026-08-24 block above).

### F. Test-infra debt (harmless)
10. Occasional `c6-hdrain` jsdom flake under max full-sweep load (passes standalone) · F110/F111 clock re-pin
    (a few Part-B checks not fully automated) · a couple of harnesses too slow for the sandbox cap.

### G. Post-launch batches (from WORK_PLAN.md)
11. **F54** team/multi-tenant scoping · **C2 / C5 / C6** input-hygiene sweeps.

### H. Email — domain verification (launch blocker for real-user email; owner-run, ~15 min) — OPEN
12. Resend is wired + live but on the **sandbox sender** (`onboarding@resend.dev`), which only delivers to
    the Resend-account owner's own inbox. Real users get NO reset/receipt email until you **verify a domain
    in Resend** (add the SPF/DKIM DNS records Resend generates) and set `EMAIL_FROM=noreply@<yourdomain>`.
    Nothing in code changes — routes, templates, key and UI are all done + verified (§ 2026-08-24, § VERIFICATION_INTEGRATIONS).

**Done this pass (was remaining):** the `CONNECTOR_ENC_KEY` Railway step (M1) · Part B cells B5.1/B5.3 · the
full VERIFICATION.md A1–A6 / B2 / B5 cell closure · F186 + F187 render bugs.

---

Last updated: **2026-08-24** (login/email/mobile/exports pass — see the 🆕 block at top). Earlier baseline
below dated 2026-08-13. Mirror of the Progress task list. **No open money bugs.** The one remaining launch
item for real-user email is Resend domain verification (§ H); Stripe + Plaid + WiPay are live-verified
(§ VERIFICATION_INTEGRATIONS). Full detail for each item lives in `AUDIT_MASTER.md` under its finding number.

**Just shipped this session (done):** C3 client record-date fix (local dates, execution-verified), F152 (charts now run — `loadChartJS` wrap), F153 (charts now show data — single-writer `_setMonthlyArrays`). All committed + pushed (`0363e5f`). F151f (quick tab-switch no longer force-reloads → no data blink) committed + pushed (`4e6de6b`).

---

## Priority order

### 1. Ready to ship — one approval away
- [x] **F139 — tax-worksheet single-source. ALREADY DONE (committed `bc8cd70`).** Client Income-Tax worksheet and accountant Tax Summary now read one `computeBooks` deductible leg. Re-verified GREEN on real scratch Postgres 2026-08-13: client taxable === accountant taxable === 12000, deductible 2000 includes the 100/50 variants, client revenue is accrual 14000 (not cash 4000). The prior "HELD awaiting commit" note was stale. **Harness caveat:** `verify-f139-tax-consistency.js` had to be updated to run — its seed inserted `entity_id=NULL`, which the F150 constraint (`chk_*_entity_nn`, added afterward) now rejects (code 23514); the seed now creates one active entity and stamps it. That harness-seed fix is the only F139 item left, and it's test-debt, not a money fix.

### 2. Root architecture
- [ ] **F88 / C3-server — entity-timezone recognition (+F85 carry-period).** Roots the C3 server half. Genuine timestamps (run_date=NOW()) and any server date default must resolve against the ENTITY timezone, not UTC/created_at; better, events carry their intended period explicitly (F85). Do NOT add a created_at fallback to receipts — breaks the F34 recognition==filter invariant (Rule 6). Client C3 half already shipped+verified.

### 3. Duplicate-submit rollout (money paths DONE 2026-08-13; only non-money routes remain)
- [x] **Client double-submit guard helper — DONE (`26c395e`, 2026-08-13).** Shared `withSubmitGuard(btn, fn, opts)` added (`app-main.js`): re-entry refused in-flight, always re-enables in `finally`, label restore. Adopted in the 2 money-adjacent handlers that lacked a lock (`addFXRate`/`addFXTransaction`). The 13 money-mutating handlers already had `if(window._savingXxx)return` re-entry locks ("C1 Wave 1b") — the old "88 sites / 9 guarded" note was stale. Verified: `verify-f117-client-submit-guard.js` 18/18, fail-then-pass. Did NOT churn the 13 already-locked handlers (no-op rename = risk without benefit near launch).
- [x] **Bank-rec match idempotency — DONE (`d2fe703`, 2026-08-13).** Legacy `POST /api/bank-reconciliation/match` (no client caller) hardened with natural-key SELECT-before-INSERT, mirroring `/match-batch`. No migration. Verified: `verify-f117-bankrec-match-idempotent.js` 5/5, double-POST → 1 link (unfixed → 2).
- [ ] **C1/F117 — remaining server token rollout: NON-MONEY routes only.** 2026-08-13 audit of all 63 POST routes: every money route is covered (idempotency_key or heuristic + client lock); `/match-batch`, `/inventory/:id/restock`, `/fx-transactions/:id/settle` confirmed already idempotent (not gaps). Only non-money routes still lack a durable key — `stripe/webhook` (should key off Stripe event id), `team/accept` (gated, F54), `ai` (ai_cache), `accountant-messages`, `connections` (audit_trail). None create a financial duplicate. Low priority, post-launch. Detail in the C1 block of `AUDIT_MASTER.md`.

### 4. Owner decisions (nothing broken — current behaviour silently becomes the decision)
- [x] **F128 — RULED 2026-08-23: CLOSED as done.** (Superseded — this old "revive dead-shadowed bodies?"
  framing is stale: the reports already render rich + canonical, and the app-main shadow was deleted. See §C.4.)
- [ ] **F94 — scheduled-doc UI (design call).** Blocked on F88 (period resolution).
- [x] **F86 / D1 scope — RULED 2026-08-23** (see §C.6 / §C.7). F86: invoice_payments canonical, A7.4 stamped.
  D1: no combined figure, "tax paid" stays "Not tracked." **F90 still open**: audit trail before launch, as rated?
- [ ] **F110/F111 — harness re-pin strategy.** 4 options (advance pin+seed in lockstep · seed relative to pin · freeze DB clock · fail drift loudly). Test-debt.

### 5. Display / FX polish (medium; only affects display currency ≠ entity currency)
- [ ] **F126 — FX-convert MRR/ARR + Scenario planner.** F124 made these honest, not converted — the tick is not coverage.
- [ ] **F125 — sweep let-bindings reached via window.** Chart render itself now closed (F152/F153). "Done when": no code reads `window.<name>` for a binding app-main declares with let/const; every chart dataset has one writer. F153's `_setMonthlyArrays` is the model pattern.
- [ ] **F129 + F64 — display polish.** Cosmetic.

### 6. The real "done" gate
- [ ] **Full VERIFICATION.md re-sweep.** Run EVERY check on real seeded data (run all → freeze failure list → fix → re-run all). This — not the AUDIT_MASTER ledger — is what establishes correctness. Do before launch sign-off.

### 7. Deferred / accepted (no launch blockers)
- [ ] **F54 / F107 / F108** (team/multi-tenant), **F92** (structural dead-shadow elimination), **F19** (DB TLS, verified, deferred), **F109** (close-position feature, owner-gated), **F83** (harness exits 0 even on failure — CI hazard).

---

## Working-tree hygiene (2026-08-13)
- ✅ **RESOLVED 2026-08-24.** The bundle was regenerated via `node bundle.js` and committed with the
  forgot-password change; it now carries all wiring including the forgot-password/reset code. Sync was
  confirmed byte-for-byte against the 9 other wiring sources before delivery. The earlier stale-bundle
  warning below no longer applies.
- ⚠ (historical, 2026-08-13) **Stale `public/finflow-bundle.js` on disk.** OneDrive reverted the working-tree bundle to an OLDER copy — it was MISSING the C3/F37, F152, and F153 changes. Restore with `git checkout -- public/finflow-bundle.js` (or regenerate via `node bundle.js`). Committed HEAD and production (Railway deploys from git) were unaffected.
- `tests/harness/clock.js` and `tests/harness/seedData.js` show as modified but are byte-identical to HEAD (line-ending/mtime noise) — safe to `git checkout` / ignore.

## Standing constraints (from CLAUDE.md — read it fully first)
- Owner runs ALL git commits/pushes in PowerShell; assistant cannot commit (OneDrive `.git/index.lock`).
- Edit wiring SOURCES, never `public/finflow-bundle.js` (F13 hook regenerates it).
- Money paths verified by EXECUTION with discriminating seeds + reproducing negative controls (Rule 4/14).
- Data changes owner-gated and always a separate commit (Rule 8).
- Never fabricate; build read-only instruments (Rule 7). Enumerate the class, not the instance (Rule 13).
- Find the runtime winner before editing a client function — dead-code shadowing (Rule 1). Grep references too, not just `name(` calls (F152/F153 lesson).
