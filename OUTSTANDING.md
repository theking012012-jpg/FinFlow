# FinFlow — Outstanding Work (session handoff)

---

## 🟢 DONE 2026-09-04 — Reconcile system (Stripe + Bank, money in & out)
Full detail: **`SESSION_HANDOVER_2026-09-04.md`**. Committed through `926eac4`; 188/188 sweep green;
verified live on production (non-destructive). Features: Stripe add-to-books (idempotent), processing
**fees** → expense, **refunds** → contra receipt, **connection scoping** (entity/Personal binding),
**match-to-invoice** (no double-count), **payouts** view, **bank money-out** (book expense / match bill
/ ignore), and the money-in reconcile UI key fix.

### ⬜ UNCOMMITTED (this turn — commit in PowerShell)
- Stripe feed **entity gating** (`startStripeFeed`/`startStripePayouts`) — feed hides on entities the
  Stripe account isn't bound to; shows "books to <X>" note instead.
- Money-flow **river stale-currency clear** in `switchEntity` (−TT$210-on-CAD lingering fix).
- New harness `tests/harness/verify-stripe-feed-entity-gate.js` (6/0). Files: `public/index.html` + harness.

### 🟢 ENTITY-GATING (started 2026-09-05)
- ✅ **Bank Rec** entity-scoped (money-in lists + money-out debits; null-inclusive, nothing lost). `verify-bank-money-out` 20/0.
- ✅ **Templates** entity-scoped (null-inclusive; new tag to active entity). `verify-templates-entity-scope` 5/0.
- ⬜ Remaining to scope (same null-inclusive pattern): **Time Tracking (timesheet), Audit trail, Documents, Team & roles** (all carry entity_id already — GET filter + POST tag).
- ⬜ **Nav restructure**: pull FX/Currency, Accountant, Find Advisor, Entities, Personal into a separate account-level section (owner confirmed FX/Entities/Personal go there too). Fiddly: Accountant is a dropdown.
- ⬜ **API connections per-entity** (re-architecture — heaviest, do last).

### 🔴 OPEN — needs a decision (NOT built)
- **Per-entity connections (BIG):** connectors are account-level (`scopeId`), shared across all entities
  (same Stripe/Plaid on every business). Owner wants each business to own its connections → re-architect
  connection storage to key on entity_id + per-entity connect/disconnect UI. Binding work (`b7f743e`) is step 1.
- **Live bank feed:** wire Belvo/WiPay to auto-populate bank debits (today: OFX/CSV import feeds them).
- Note: "C$" is the CORRECT CAD symbol — not a bug.

---

## 🔴 IN FLIGHT — Money In/Out rich viewer + line items (F194) — 2026-08-27

Full spec + handoff: **`F194_MONEY_VIEWER_HANDOFF.md`** (repo root). Cross-account handoff for the code
account to finish without the Cowork session.
- **Phase 1 (document viewer)** — ✅ committed `d92f990` (live). `finflow-docview.js` + index.html tag +
  `verify-docview-invoice.js` 11/11.
- **Phase 2a (invoice line items, server-derived amount)** — ✅ committed `3066bc7`.
  `server.js normalizeLineItems` + POST/PUT, `finflow-lineitems.js` editor, index.html/app-main/wiring,
  `verify-invoice-line-items.js` 21/21.
- **Phase 2b** — ⬜ line items for BILLS + QUOTES (reuse `normalizeLineItems`; bills feed expense-recognition).
- **Phase 3** — ⬜ roll the View across bills/receipts/payments/credit-notes/quotes/vendor-credits via
  `ffOpenDocView(doc, kind)` (KIND map already complete).
- **Phase 4** — ⬜ clickable Scheduled Documents calendar (finflow-f94.js `renderCal`): day-click filters
  the agenda + "＋ New on this day". Owner chose **Both**.
- **F195** — ✅ **committed `a588852`.** Calendar-date DISPLAY labels shifted a day west of UTC (Rule 10,
  display side): invoice due showed "Aug 15" in the list but "16 Aug" in the doc view — the doc was
  correct. Root fix: one shared `FinFlowDates.fmtLabel` (`_toYmd` string slice — no Date, no TZ) applied to
  every date-only `toLocaleDateString` call site across the four mappers. Harness `verify-date-label-tz.js`
  **12/12**, matrix spans the UTC SIGN boundary. Logged AUDIT_MASTER F195.
- **F196** — 🟠 **Tier 1 committed `9fe1240`; Tier 2 OPEN.** Document letterhead showed the ACCOUNT
  business ("Acme"), not the active ENTITY (Saige Holdings) — the Rule 10 per-user-setting-on-per-entity
  class. **Tier 1 (shipped):** docview `letterhead()` + `buildInvoiceHTML` name follows the active entity;
  `verify-docview-invoice.js` **11/11**, assertion now discriminating. **Tier 2 (open; owner decided FULL
  per-entity Business Profile):** address/email/phone/tax-id/website/logo on every document are STILL the
  account's until it ships, and its data-move step is owner-gated and its own commit (Rule 8).
  Logged AUDIT_MASTER F196. Full spec in the handoff doc.
- **F192** — ⬜ bank-linking regional coverage: owner decision (Tier A manual import vs Tier B aggregators).

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
- **F192 — bank-linking: region→provider routing — ✅ SHIPPED (reconciled 2026-09-02).** Country-based routing is live: LatAm→Belvo, else→Plaid, fallback→manual OFX/CSV; Banking tab un-orphaned. Verified `verify-banking-region-routing.js` (11/0). **DECISION — 2026-09-02 (Big Bro): manual import is the UNCOVERED fallback ONLY; covered regions must auto-link.** New aggregators stay demand-driven post-launch, but wherever coverage EXISTS the user wants the aggregator, not manual. Two follow-ups:
  1. **Owner action — set keys (planned for 2026-09-03).** Coverage is built but DARK: `INTEGRATIONS_STATUS.md` (Aug 30, prod) shows Plaid = **sandbox** and Belvo = **not configured** (`BELVO_NOT_CONFIGURED`). So the 15 Belvo LatAm markets don't auto-link today. To light them: Railway env → `PLAID_ENV=production` + real Plaid client/secret, and Belvo keys.
  2. **Code fix (queued, do WITH the key-set so the whole flow verifies end-to-end) — region-strict routing.** `ffBankLinkFromPage` currently does a cross-region fallback: `order.find(o=>o[1])` sends a Belvo-market country to Plaid when Belvo is keyless (wrong aggregator, won't find the bank), and a genuinely-uncovered country (e.g. TT) also gets pointed at Plaid. Fix: a country uses ONLY its region's provider (Belvo market→Belvo, Plaid market→Plaid) and drops straight to manual otherwise — never the wrong-region aggregator. Needs a PLAID_MARKETS list (research Plaid's supported countries) alongside the existing BELVO_MARKETS. Harness + sweep.
Original blocked-scope note kept below for context:
- **(original) F192 uncovered-region decision. ⛔ was BLOCKED on an owner decision.**
  Two aggregators are built — Plaid (US/CA/UK/EU) + Belvo (LatAm) — but the UI leads with Plaid for everyone,
  and **~30 of the ~53 supported countries** (the entire Caribbean incl. TT, Central America, much of South
  America) have **no aggregator wired at all** (WiPay is Caribbean *payments*, not aggregation). The "Banking"
  tab (`index.html:2048`) is a static "Coming Soon" card wired to none of the working backend; the real
  linked-banks page (`page-banking-biz`, `index.html:2929`) is orphaned (no `showPage` reaches it). Scope, once
  decided: route by the entity's `country` → Plaid / Belvo / **manual CSV-OFX import** (into the existing
  `source:'banking'` store, `server.js:4023`); show the coming-soon card only when `!plaidConfigured && !belvoConfigured`;
  wire the tab to `ffLinkBank` / `page-banking-biz`; fix the card copy (drop the false "15-min sync", stop naming
  only Plaid). Full evidence: **AUDIT_MASTER F192**. **Owner decision that unblocks scope:** manual import as the
  uncovered-region answer (all regions ship, method varies), or source a regional aggregator first (delays them)?

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

### 0. LIVE AUDIT BUGS (2026-09-02) — ✅ ALL FIXED + VERIFIED (see `AUDIT_2026-09-02_live-visual.md`)
Every item below shipped with a discriminating harness (red→green) + full canary sweep green. Commit: audit-fixes 2026-09-02.
- [x] **F-C1 — Overdue FIXED (verify-fc1-overdue-date.js 9/0).** `server.js:4411` filters `status==='overdue'` (literal) — nothing transitions pending→overdue on due date, so past-due unpaid invoices/bills never count ($13,000 invoices + $250 bill read as $0 across Dashboard/Invoices/Payments/Bills/Vendors). Fix: overdue = unpaid-ish status AND due_date < entityTodayYmd; mirror on client KPIs. Bills path ~`server.js:5871` same pattern. Discriminating harness + own commit. Outstanding/payables logic is CORRECT — only overdue is broken.
- [x] **F-H1 — Payroll now in Expenses/Net Profit FIXED (verify-fh1-payroll-in-opex.js 13/0; also resolves F-D1 P&L 'Jul 01' bucket).** `/api/reports` expenses $4,100 / netProfit $37,990 excludes the $7,000 July payroll run; P&L labels it "incl. payroll", AI Insights says "payroll-to-rev 0%". Decide treatment → fix calc (Net Profit overstated ~$7K) or fix label. Harness + own commit.
- [x] **F-E1 — Personal day change FIXED (verify-fe1-personal-daychange.js 5/0).** Correct = dayChgPx(-3.92)×210 shares = -$823. Business path correct; bug is personal day-change aggregation.
- [x] **F-A1 — Dashboard expense label FIXED (verify-fa1-dashboard-expense-label.js 6/0).** Renders server row `{Rent,2850}` under hardcoded "Salaries" slot (positional bind). Bind to `row.category`.
- [x] **F-E2 — Business asset allocation FIXED (verify-fe2-biz-allocation.js 5/0).**
- [x] **F-K1 — Inventory COGS FIXED (verify-fk1-inventory-cogs.js 6/0).**
- [x] **F-G1 — Budget usage FIXED (verify-fg1-budget-usage.js 6/0).**
- [x] **F-F1/F-F2 — MRR revenue-by-customer + active/net wired FIXED (verify-ff1-mrr-by-customer.js 7/0); churn/new/expansion left honest (no cohort history).**
- [x] **F-L1 — Scheduler rows now audited FIXED (verify-fl1-scheduler-audit.js 6/0).**
- [x] **Polish (verify-polish-batch.js 10/0):** recurring subtitle→"Next occurrence" (F-B1); payment-method enums humanized (F-B2); scenario runway→"N/A" when cash untracked (F-J2); stale "755+" dropped (F-L2); P&L "Jul 01" bucket resolved via F-H1 (F-D1).
- [ ] **Deferred cosmetic (judged low-value / needs product decision):** "This month" subtitle relabels (F-B5, ambiguous scope), app-wide date-format unification (F-B6), FX rate dedupe-on-entry (F-I1, test data), 6.79→6.80 header rounding (F-I2), "Find Advisor"→Find Accountant (F-M1, intentional redirect), bank-rec "all matched" wording (F-J1, accurate as-is).
- Note: NONE are regressions from this session. Investments stale-price, FX display conversion, F94, F126 all verified working live.



### 1. Ready to ship — one approval away
- [x] **F139 — tax-worksheet single-source. ALREADY DONE (committed `bc8cd70`).** Client Income-Tax worksheet and accountant Tax Summary now read one `computeBooks` deductible leg. Re-verified GREEN on real scratch Postgres 2026-08-13: client taxable === accountant taxable === 12000, deductible 2000 includes the 100/50 variants, client revenue is accrual 14000 (not cash 4000). The prior "HELD awaiting commit" note was stale. **Harness caveat:** `verify-f139-tax-consistency.js` had to be updated to run — its seed inserted `entity_id=NULL`, which the F150 constraint (`chk_*_entity_nn`, added afterward) now rejects (code 23514); the seed now creates one active entity and stamps it. That harness-seed fix is the only F139 item left, and it's test-debt, not a money fix.

### 2. Root architecture
- [x] **F88 / C3-server — DONE 2026-09-02 (commit `18fa5e6`).** `entityTodayYmd(entityId)` routes every dateless server transaction default (expenses, journals, sales-receipts, payments received/made, credit/vendor notes, bank tx) through the ENTITY timezone; no entity / no tz → UTC, byte-identical (verify-f88-utc-parity 49/0). No created_at fallback added (F34 invariant preserved). Verified: `verify-f88-server-date-default.js` (11/0, discriminating). **F85 carry-period** (events carry intended period explicitly) is a deeper, separate model change — still open, not required by this fix.

### 3. Duplicate-submit rollout (money paths DONE 2026-08-13; only non-money routes remain)
- [x] **Client double-submit guard helper — DONE (`26c395e`, 2026-08-13).** Shared `withSubmitGuard(btn, fn, opts)` added (`app-main.js`): re-entry refused in-flight, always re-enables in `finally`, label restore. Adopted in the 2 money-adjacent handlers that lacked a lock (`addFXRate`/`addFXTransaction`). The 13 money-mutating handlers already had `if(window._savingXxx)return` re-entry locks ("C1 Wave 1b") — the old "88 sites / 9 guarded" note was stale. Verified: `verify-f117-client-submit-guard.js` 18/18, fail-then-pass. Did NOT churn the 13 already-locked handlers (no-op rename = risk without benefit near launch).
- [x] **Bank-rec match idempotency — DONE (`d2fe703`, 2026-08-13).** Legacy `POST /api/bank-reconciliation/match` (no client caller) hardened with natural-key SELECT-before-INSERT, mirroring `/match-batch`. No migration. Verified: `verify-f117-bankrec-match-idempotent.js` 5/5, double-POST → 1 link (unfixed → 2).
- [x] **C1/F117 — stripe/webhook DONE 2026-09-02 (pending push).** The highest-value non-money gap: Stripe retries webhooks, so a replayed `event.id` could re-run handlers (notably a 2nd `platform_fees` INSERT). Webhook now claims each `event.id` in a durable `stripe_webhook_events` ledger (ON CONFLICT DO NOTHING) and acks 200 on replay without processing. Verified: `verify-f117-webhook-idempotent.js` (9/0, discriminating). REMAINING (low-pri, post-launch, none create a financial duplicate): `team/accept` (gated, F54), `ai` (ai_cache), `accountant-messages`, `connections` (audit_trail).

### 4. Owner decisions (nothing broken — current behaviour silently becomes the decision)
- [x] **F128 — RULED 2026-08-23: CLOSED as done.** (Superseded — this old "revive dead-shadowed bodies?"
  framing is stale: the reports already render rich + canonical, and the app-main shadow was deleted. See §C.4.)
- [x] **F94 — scheduled-doc UI: ALREADY BUILT (this entry was stale — reconciled 2026-09-02).** Live: 'Scheduled Documents' nav → `page-scheduled-documents`, rendered from live entities via `finflow-f94.js`. 8 green harnesses: `verify-f94-{agenda-sections,create-labeling,dayclick,missed-posts,resolved-dates,runway,scheduled-page,scheduled}`. Handoff docs `PHASE3_DOCVIEW_HANDOFF.md` / `PHASE4_CALENDAR_HANDOFF.md`.
- [x] **F86 / D1 scope — RULED 2026-08-23** (see §C.6 / §C.7). F86: invoice_payments canonical, A7.4 stamped.
  D1: no combined figure, "tax paid" stays "Not tracked." **F90 still open**: audit trail before launch, as rated?
- [ ] **F110/F111 — harness re-pin strategy.** 4 options (advance pin+seed in lockstep · seed relative to pin · freeze DB clock · fail drift loudly). Test-debt.
- [ ] **Pro "50/month" invoice cap is UNENFORCED (found 2026-09-01).** Pricing card (`public/index.html` `PRO_FEATURES`) advertises "Invoicing & quotes (up to 50/month)" plus an `invoice_limit` upsell ("No 50/month cap"), but **no code enforces it.** The live `saveInvoice` (wiring override in `finflow-api-wiring-medium.js` → `POST /api/invoices`) has no plan/count check; backend `POST /api/invoices` (server.js:1270) has none either. Only the **dead** base `saveInvoice` in `app-main.js` (~2578) checks `userInvoices.length>=50` — a *lifetime total, not per-month* — and it's overridden at runtime so it never runs. **Net: Pro invoicing is effectively unlimited.** DECISION DEFERRED (Big Bro, 2026-09-01): either (a) change copy to "Unlimited invoicing & quotes" and drop the upsell, or (b) implement a real per-month cap (backend counts invoices with `issue_date` in current month → 402/upgrade; client mirrors; add harness).

### 5. Display / FX polish (medium; only affects display currency ≠ entity currency)
- [x] **F126 — MRR/ARR FX-conversion DONE 2026-09-02.** `GET /api/recurring-invoices?display=<ccy>` server-converts each amount from the active entity's native currency → display via `rateAsOf` (today, carry-forward); `loadMRRData` uses it + the display symbol when a display currency is active, native otherwise (byte-identical when off). Honest like `_applyConvertedKPIs`/F34: no FX rate for the pair ⇒ `_fx.ok=false` ⇒ MRR/ARR show "—", never a relabelled native number. Verified `verify-f126-mrr-fx-convert.js` (10/0, discriminating). **Scenario planner deliberately LEFT native** (Big Bro, 2026-09-02): it projects from `BASE` with user-entered salary/invest amounts, so converting a what-if sandbox mixes currencies for near-zero value — F124's native-honest choice stands.
- [ ] **F125 — dead `window.charts` references (hygiene only, ZERO functional value).** Verified 2026-09-02: `app-main` declares `let charts={}` (never a window prop), so the `window.charts` reads in `finflow-api-wiring-dashboard.js` are dead — but they already fall through correctly (F152 fixed the real render bug), so removing them changes nothing a user sees. Pure cleanup; safe to leave. "Done when": no code reads `window.<name>` for an app-main let/const binding.
- [x] **F129 + F64 — DONE (reconciled 2026-09-02).** **F64**: `_fmtMoney`/`_fmtMoneyExact` render exact and honour 'Show cents' (`app-main.js:621`); green `verify-f64-showcents`, `f64-money-formatter`. **F129**: budget variance (`index.html` renderBudget), Chart-of-Accounts totals + Journals debit/credit KPIs (`app-main.js`) now use `_nativeSymbol()` not literal `$`; verified `verify-f129-entity-symbol.js` (7/0). Investment `$` deliberately LEFT — those are unconverted USD prices (that's **F126**, honest labelling, not F129).

### 6. The real "done" gate
- [ ] **Full VERIFICATION.md re-sweep.** Run EVERY check on real seeded data (run all → freeze failure list → fix → re-run all). This — not the AUDIT_MASTER ledger — is what establishes correctness. Do before launch sign-off.

### 7. Deferred / accepted (no launch blockers)
- [ ] **F54 / F107 / F108** (team/multi-tenant), **F92** (structural dead-shadow elimination), **F19** (DB TLS, verified, deferred), **F109** (close-position feature, owner-gated). — **F83 DONE 2026-09-02 (commit `03fceaf`):** clock.js latches a nonzero exit code (output-scan + 'exit' handler) so a masked jsdom failure can't exit 0; `verify-f83-exit-latch.js` 6/0.

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
