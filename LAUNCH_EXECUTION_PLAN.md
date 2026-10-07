# FinFlow — Launch Execution Plan (autonomous run)

**Written:** 2026-10-06 · **Base:** `main` @ `5d9bb74` + branch `dash-je-fix` (`470dce2`).
**Purpose:** a self-contained plan an agent can execute **top-to-bottom without asking the owner**,
committing each verified step, until every code item is done and verified. The **owner does the final
push/merge to `main` (deploy)**. Owner-only external config (Stripe, Resend, DNS, Railway env) is NOT a
blocker — the agent compiles it into §Owner Handoff and keeps going.

> **Why this plan exists:** `LAUNCH_STATUS.md` says the code is "launch-complete." This session disproved
> that by finding a real divergence (the dashboard showed revenue **minus** posted manual journals, while
> the P&L/Reports/GL included them). That is the codebase's defining failure — **Rule 2 / Rule 13:
> multi-writer money figures diverge one surface at a time.** So this plan is **verify-first and
> adversarial**: it does not trust any "done" claim, it re-derives correctness by execution, and it closes
> the divergence *class*, not the one sighting. The old finding ledger (the ~15 open N-numbers) was lost
> with the other account's reset — the re-audit below rebuilds the backlog from scratch by testing, not
> from memory.

---

## 0. Operating contract (read before running)

**The owner has pre-authorized this run:** commit each verified step on the working branch. This overrides
CLAUDE.md's default "never commit without approval" **for commits only** — the **final push / merge to
`main` stays with the owner**. Do not merge to `main`, do not deploy.

**Per-step loop (every item below follows this exactly):**
1. **Read-only investigate** → report evidence (actual grep/diff/query/output), never conclusions (Rule 7, Reporting).
2. **Enumerate the class** (Rule 13): from BOTH directions — code-side ("where is this computed/called") and
   surface-side ("every screen + endpoint + export that shows this figure"). Fix the whole set or log the rest
   as numbered findings (Rule 2). A fix that names one surface when the defect spans six is a *sighting*, not a fix.
3. **Find the runtime winner** before editing any client function (Rule 1): `grep -n "window.NAME *=" public/finflow-api-wiring-*.js`. Edit **wiring sources, never `finflow-bundle.js`**; `index.html`/`app-main.js` ship direct.
4. **Write a discriminating harness FIRST** (Rules 3/4/5): real embedded Postgres, real schema, real endpoints; seed so the bug changes the number; state what the buggy value would be. **Prove it RED on current code before the fix** (Rule 14 — a fix is not verified until its failure path executed). For client-only logic, marker-slice the shipped function (step4-client-gate pattern) and run it; prefer making it importable over a better extractor (Rule 5 corollary).
5. **Root fix only** (never re-patch a symptom; if it recurred, the prior fix was wrong). One money change per commit (Rule 8). After any client edit: `node bundle.js` then `node bundle.js --check`.
6. **Verify:** the new harness RED→GREEN **+** the money gates (`step1..4-gate`) **+** the targeted regression for touched surfaces. Assert executed values, not source text (Rule 5).
7. **Commit** on the branch, the harness in the same commit, message ending:
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: <this session url>
   ```
8. **Log** the step in §Progress Log (date, commit, harness, RED→GREEN evidence). Move to the next item. Do not stop to ask.

**Anything found outside the current item** → log it as a numbered finding in §Findings Ledger and schedule it; never fold it into the current commit, never leave it as prose only (that is how F55 survived three audits).

**Decisions with no reversible downside:** take the most reasonable reading and record it in §Decisions.
**Genuinely owner-gated (data backfill/migration/reclassify — Rule 8; accounting-policy choices; external
config):** build + verify behind a flag if code, otherwise record in §Owner Handoff, and keep going.

### How to run the harnesses (verification environment)
- Real embedded Postgres, **non-root** (`embedded-postgres` refuses uid 0): run as a non-root user, e.g.
  `runuser -u ffrunner -- bash -lc 'cd <repo> && export TMPDIR=/tmp/ffrunner-tmp && node -r ./tests/harness/clock.js tests/harness/<FILE>.js'` (or the `postgres` user per LAUNCH_STATUS §4). Clock is pinned 2026-07-25.
- Money gates: `step1-gate.js step2-gate.js step3-gate.js step4-client-gate.js` (step4 = client engine across the TZ sign boundary).
- Journal/GL parity (this session): `verify-gl-post-journal.js` (18/0), `verify-gl-post-journal-fx.js` (12/0), `verify-journal-dashboard-parity.js` (10/0, discriminating).
- **Full sweep is heavy (~400 harnesses, each boots PG).** Run it only at phase boundaries, and the owner
  re-runs it 3× in PowerShell (free) as the done-gate — **do not burn cloud credits looping the full sweep.**
  Per-fix, run only the new harness + gates + the targeted few.

---

## Phase 1 — Verify-first re-audit (do not trust "complete")

**Goal:** establish the TRUE baseline by execution and close every money divergence. Freeze the failure list
before fixing (done-gate rule 1–3): run everything, freeze REDs, fix, re-run everything.

### 1.0 — Baseline sweep + freeze
- Run the full sweep once; record pass/total and freeze any RED into §Findings Ledger. **Verify:** sweep completes; failure list frozen. (No fixes yet.)

### 1.1 — Divergent-surfaces sweep (THE class — Rule 2/13) ★ highest priority
For **each** money figure — revenue, COGS, gross profit, opex, net profit, AR/outstanding/overdue, AP,
cash-flow in/out, payroll, investments — enumerate **every** surface that displays it: dashboard KPI,
page stat cards, breakdown bars, overview chart, transactions list, `computeBooks`, `/api/reports`,
`/books`/GL (`/api/gl/reconcile-check`), accountant portal, PDF **and** CSV/XLSX export.
Then drive a scenario that exercises **every leg** — issued invoice, sales receipt, credit note, issued
bill, bill payment (linked vs orphan), payroll run (draft/approved/paid), vendor credit, **and a posted
manual journal (income + expense legs)** — and assert **client == server == GL** on all surfaces for the
same period, single-entity native **and** consolidated/display-currency.
- **Known instance (reference fix, already done this session):** dashboard KPIs + chart dropped posted
  journals while P&L/Reports/GL included them → mirrored the server journal leg into `computeRevenue`,
  `computeExpenseBreakdown`, `buildMonthlyArrays`, the server `monthly` buckets, and the dashboard data
  load. Harness `verify-journal-dashboard-parity.js`. Use this as the template for any other divergence.
- **Verify (per figure):** a discriminating harness that posts the full-leg scenario and asserts every
  surface agrees to the cent; proven RED on a surface that drops a leg. Live-confirm in the browser on prod
  after deploy (post one of each doc type, read every surface). **Done:** no figure diverges on any surface.

### 1.2 — Re-run the original adversarial audit against current code
Take the prior audit's findings (the 95+ `code_audit.txt` items / any surviving `AUDIT_*`/`OUTSTANDING` notes).
For each: either confirm **fixed with a discriminating harness that is RED on a reverted fix** (Rule 14), or
open a numbered finding and fix it via the per-step loop. Do not accept "looks fixed" — execute the failure path.
- **Verify:** every audit item maps to a green discriminating harness or a closed finding row with evidence.

### 1.3 — Runtime/console cleanliness (live, per page)
On the deployed app, load every page signed-in and read the console (browser tools). Fix each error/warning at
the root.
- **Known instance:** boot throws `renderInvestments: Cannot set properties of null (setting 'textContent')`
  (+ deferred render hooks) — a hook targets a DOM node that isn't present; non-fatal but must be clean.
- **Verify:** zero console errors/warnings on every page; a harness or jsdom-boot check where feasible; live screenshot per page.

### 1.4 — Known infra/correctness items from this session
- **`APP_URL` / dead domain:** `finflow-production-dab1.up.railway.app` is **dead** (Railway "Not Found");
  live prod is `dab2`. Confirm `APP_URL` (and any hard-coded base URL, email links, Stripe return URLs) point
  at the live domain, not dab1. **Verify:** `grep -rn "dab1" .` is empty in shipped code; password-reset/Stripe
  return links resolve on the live host. (Env value itself is Owner Handoff.)

---

## Phase 2 — Deferred code items (close the ones worth closing; build-behind-flag the owner-gated ones)

### 2.1 — GL as single source of truth (GL Phase 4 + 5) ★ the structural cure for the Phase-1 class
The real fix for multi-writer divergence is to stop recomputing the books on N surfaces and read the
**reconciled GL** everywhere. Phase 5b already read-swaps reports to the GL when reconciled; Phase 4 is the
historical backfill into the ledger, then flip source-of-truth with a live "books balanced ✓".
- **Agent scope:** implement + harness the backfill and the flip **behind a flag**; prove GL == computeBooks
  across the full VERIFICATION dataset before enabling. **Owner-gated (Rule 8):** the actual historical
  **data backfill on prod** and the **flip** are the owner's approval — build, verify, and HOLD the enable.
- **Verify:** `verify-gl-*` consolidation/reconcile suites green incl. a backfilled dataset; reconcile green on every entity + consolidated.

### 2.2 — Investments-on-ledger (accounting decision — owner-gated)
Currently tracking-only, not posted to the double-entry books. Draft the posting design; **owner decides**
whether to post. Do not post without the decision. **Verify:** design recorded in §Decisions; if approved, a reconcile harness.

### 2.3 — VERIFICATION.md empty result cells (A7.5–8, A7.18, A8a/A8b)
They are gate-tested but the gates don't auto-stamp the rows. Wire the stamping so the ledger reflects reality.
- **Verify:** every VERIFICATION.md cell carries a value from an executed gate; no empty result cells.

### 2.4 — Client keyset pagination on heavy screens (perf, non-blocking)
Server side is done + tested (`db.pageByUser`, `verify-list-pagination` 13/0). Point invoices/transactions
screens at `{rows,nextCursor}`. **Verify:** live-UI regression + the money features that read `_realInvoices`
still tie (re-run the Phase-1 divergence harness for revenue/AR). Risk > gain if shaky — if so, log and defer.

### 2.5 — Mobile performance (optional, cheap wins only)
Measure mobile Lighthouse; take the non-risky wins (lazy-load, defer, image sizing). **Verify:** before/after
Lighthouse numbers recorded; no functional regression (gates green).

### 2.6 — Defense-in-depth (owner-decision; do NOT attempt blind)
CSP `unsafe-inline` drop (509 inline handlers → event delegation), Postgres RLS (`RLS_DESIGN.md`), Sentry
(needs DSN), express 4→5. Each is large/low-ROI per LAUNCH_STATUS §2 and HANDOVER. Record the exact scope +
risk in §Owner Handoff; implement only on an explicit owner go, as staged verified work.

---

## Phase 3 — Owner Handoff (external config the agent cannot do — compile, don't execute)

The agent cannot touch the Stripe dashboard, DNS, or Railway env. Compile this checklist and keep it current;
these are the real launch gates (source: `LAUNCH_STATUS.md §1`).
- **Stripe:** Business price → **$249/mo**; create **Scale $400/mo** + set `STRIPE_PRICE_SCALE`; enable
  **Stripe Identity**; confirm `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_REDIRECT_URI`.
- **Email:** verify **`finflow.app` in Resend** (SPF+DKIM), set `RESEND_API_KEY`, `EMAIL_FROM=noreply@finflow.app`, `ADMIN_EMAIL` (off the sandbox sender).
- **Providers (go-live keys):** Plaid prod, Belvo prod, OAuth connectors (QuickBooks/Xero/Zoho/Square/PayPal/Coinbase/Shopify), Finch, Codat, optional market-data keys.
- **Core env:** `SESSION_SECRET`, `APP_URL` (the live https domain — **not dab1**), `CONNECTOR_ENC_KEY`, `ANTHROPIC_API_KEY`, and **`ALLOW_INDEXING=1`** at launch (verify `x-robots-tag` empty + `robots.txt Allow: /`).
- **Infra:** Cloudflare (proxied DNS, TLS Full strict, WAF), tested backups + restore drill, least-privilege DB role (`SKIP_INIT_DDL=1` + `scripts/migrate.js`), secrets rotation cadence, uptime monitor on `/healthz`.
- **Housekeeping:** move the repo **out of OneDrive** (the `.git/index.lock` fight); prod test-data cleanup (QA Tester / Claude TestCPA links + ZZ-QA rows — this is a Rule 8 data change: enumerate, hold for owner).

---

## Phase 4 — Done-gate (the agent's final verification before handing back)

1. **3× full sweep GREEN** — `node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js`, 0 RED each run (catches flakiness).
2. **VERIFICATION.md re-sweep on real seeded data** — every cell green against owner-expected values (Rule 6: expected values are owner-supplied, never derived from the code under test). This, not any ledger, is sign-off.
3. **Smoke (the non-keyed parts live):** sign up → entity → invoice + expense → record payment → P&L / balance sheet / consolidated → post a manual journal and confirm every surface moves together → connect one sandbox bank. The keyed legs (email delivery, live provider round-trips) are flagged for the owner (need their keys).
4. **Hand back:** the branch is committed step-by-step; give the owner the fast-forward-merge + push commands and the current §Owner Handoff checklist. The owner does the final push (deploy).

---

## Progress Log (agent appends; newest last)
- 2026-10-06 — Dashboard↔P&L journal parity (Phase 1.1 reference instance). Branch `dash-je-fix` `470dce2`.
  Harness `verify-journal-dashboard-parity.js` 10/0 (RED 9/10 on pre-fix) + `verify-gl-post-journal.js` 18/0
  (monthly assertions added) + FX 12/0 + money gates 1–4 green. Server GL reconcile confirmed live
  (`/api/gl/reconcile-check` all entities booksBalanced, `glRevenue==oracleRevenue==50390`). HELD for owner push.

- 2026-10-07 — **1.1 / L3 expense breakdown reconciles on every surface.** New shared seed
  `fullLegScenario.js` (every leg via real endpoints, hand-computed expected values) + `jsdomBoot`
  `{baseSeed:false, apiSeed}` options. Harness `verify-expense-breakdown-all-surfaces.js`: RED 6/10 on
  pre-fix (server Σ602, dashboard Σ602, Expenses page Σ565 vs 614) → GREEN 10/10. Gates step1–4 green;
  regression green: expense-breakdown-reconcile 8, fa1-dashboard-expense-label 6, gl-dashboard-readswap 11,
  journal-dashboard-parity 10, gl-post-journal 18, gl-post-journal-fx 12, dashboard-render 9, b5-currency 5,
  entity-switch-money-clear 8. bundle:check in sync.

- 2026-10-07 — **1.0 baseline** on `29ad941`: full sweep **419/419 GREEN** (real Postgres 17, pinned clock,
  3 shards). Frozen failure list: empty.
- 2026-10-07 — **1.1 / L5 "This month" cards.** Harness `verify-this-month-cards.js` (full-leg June seed +
  July rows, today pinned 2026-07-25): RED 11/13 on pre-fix (shown 69/27/0/27/2/2/2/46/46/5.0/6 = all-time)
  → GREEN 13/13 (controls CN/VC "This Month" green both sides). Gates step1–4 green; regression green:
  f129-entity-symbol 7, f129 4, f136-paymentsmade 8, f144-receipts 8, f72-payables 2, fc1-overdue-date 12,
  vendors-payables-ui 2, c1-journals 12, timesheet-entity-scope 6, timesheet-switch-reload 3,
  expense-breakdown-all-surfaces 10. bundle:check in sync.

- 2026-10-07 — **1.1 / L9 one quarter per Quarter view** + the 1.1 parity instrument. Harnesses
  `verify-quarter-intent.js` RED 3/8 on pre-fix (native net −$20; EUR rev €1.5K / net €222) → GREEN 8/8;
  `verify-full-leg-parity.js` (every headline surface vs hand values, year/month/quarter: server reports,
  P&L + rows, GL reconcile + P&L, balance sheet, cash-flow; dashboard KPIs, chart REV/EXP vs server monthly,
  Invoices/Payments Received/Vendors/Cash Flow/Reports cards) GREEN 27/27 (RED on pre-fix at the quarter
  check). Gates step1–4 green; regression green: b5-currency 5, dashboard-render 9, f102-payroll-boot 10,
  f126-mrr-fx-convert 10, f85-client-period-basis 3, journal-dashboard-parity 10, verification-cells 26,
  a8c-fx-reconcile 13, cogs-page-revenue 7, fk1-inventory-cogs 6.

- 2026-10-07 — **1.1 / L10 accountant portal parity.** Consolidated two-currency check first (no change
  needed): USD full-leg + TTD business @0.15 → server consolidated 796 / 621.5 / 174.5, Entities page
  $796 / $622 / $175, both entities GL-reconciled. Portal: harness `verify-accountant-portal-parity.js`
  (owner writes full-leg + a past-due invoice; verified accountant, active filing link; jsdom portal + CSV
  blob capture) RED 8/11 on pre-fix (790 / 0 / 0 / 8 / 0 / ''/8/−8) → GREEN 12/12. Gates step1–4 green;
  regression green: all 23 verify-accountant-* (incl. books-ap 8, entity-scope 36, fiscal-year 6, client-ui
  6), client-accountant-xss 9, expense-breakdown-all-surfaces 10, full-leg-parity 27, quarter-intent 8,
  this-month-cards 13.

- 2026-10-07 — **1.1 / L12–L13 generated reports.** Probe generated all 12 Reports-page reports on the full-leg
  books. Harness `verify-reports-parity.js` (full-leg + a prior-FY paid run 888 and a prior-FY 'yes' expense
  10): RED 4/10 on pre-fix (Cash Flow out 1178, Payroll 1637, W-2 1637, Deductible 10) → GREEN 10/10.
  `verify-f137-tax-reports.js` W-2 expectation corrected from "Σ every run" (12,500, draft included) to the
  owner's FY payroll (expected.js COMPONENTS.fy.payroll 6,200) + its own 3,000 run = 9,200 → 20/20.
  Gates step1–4 green; regression green: f137-balance-sheet-report 6, f137-cashflow-ar-ap-reports 12,
  f137-sales-payroll-reports 9, f137g-pl-statement 17, pl-statement-period-ui 4, f57-cash-card 14,
  full-leg-parity 27. bundle:check in sync.

- 2026-10-07 — **1.1 / L16 page exports.** Executed Export on 9 pages with real rows. Harness
  `verify-page-exports.js` RED 12/14 on pre-fix (4 exports "No data", deductible Yes/Yes, dates without year)
  → GREEN 14/14. `verify-export-csv.js` (quoting) now injects the store the export reads (`_realInvoices`)
  + asserts the new header and ISO dates → 8/8. Regression green: pdf-export 10, step4-client-gate 5.

- 2026-10-07 — **1.1 / L6 cash leg + L15.** Harness `verify-journal-cash.js` (full-leg seed; posted, then the
  income JE flipped to Draft): RED 8/11 on pre-fix (BS cash −200, cash-flow 80/280, forecast none, BS lines
  435 ≠ 453) → GREEN 11/11 (cash −182 → −212 after the reversal, on BS, cash-flow, forecast). Full-leg
  hand cash updated (in 110 / out 292 / −182) in fullLegScenario, full-leg-parity (28/28), reports-parity
  (10/10). Gates step1–4 green; regression green: f123-balance-sheet-cash 13, f57-cash-card 14,
  cashflow-forecast, f137-balance-sheet-report 6, f137-cashflow-ar-ap-reports 12, f40-cashflow-route-gone 3,
  and all 33 verify-gl-* (incl. bs-readswap 15, readswap-consistency 18, statements 21, reversal 16,
  status-reversal 25, post-journal 18 / -fx 12, consolidation 13, payroll-cashout 16).

- 2026-10-07 — **1.1 / L8 + L11 Rule-10 class.** Harness `verify-calendar-dates-tz.js` re-runs itself under
  HARNESS_TZ America/New_York and Asia/Tokyo (sign boundary — the corollary). RED on pre-fix: NY 5 FAIL / Tokyo
  3 FAIL (asymmetric exactly as Rule 10 predicts: lock date + personal window fail west only; Due This Week 7
  and the portal list fail both) → GREEN 12/12. computeBooks now returns its resolved `window`; the portal
  books response passes it on. Gates step1–4 green; regression green: accountant-portal-parity 12,
  accountant-client-ui 6, accountant-entity-scope 36, accountant-fiscal-year 6, accountant-books-ap 8,
  fc1-overdue-date 12, f72-payables 2, this-month-cards 13, tz-matrix, tz-probe, date-label-tz 12,
  finflow-dates.test 16, lock-entity-scope 7, c1-client-lock 6, lock-external-dates 16, lock-password 12 /
  -ui 4, period-lock-guard 24, personal-account-scope 4.

## Findings Ledger (numbered; newest last)
Numbered `L<n>` (launch run) so they never collide with the lost audit's `N<n>` series.
- **L1** (open) renderInvestments null-textContent boot error — Phase 1.3.
- **L2** (open) `APP_URL`/dab1 dead-domain audit — Phase 1.4.
- **L3** (FIXED, see Progress Log) Expense breakdown ≠ opex total on 3 surfaces. Full-leg seed (opex 614):
  server `expenseBreakdown` Σ=602 and dashboard bars Σ=602 (posted expense JE 12 in no category); Expenses
  page bars Σ=565 (only orphan payments as "Bill payments" — issued bill 40, vendor credit −3, JE 12 missing)
  and a different category list from the dashboard. AI-insights "Expenses this month" line used the
  Expenses-page list. Same class as the 470dce2 reference fix (N20 leg dropped downstream).
- **L4** (WITHDRAWN) Payroll empty-state "No payroll runs recorded" — the jsdom probe read `textContent`,
  which includes hidden nodes. Executed check: `#payroll-empty-state` is `display:none` with 3 runs loaded;
  the visible page lists all 3 runs. Not a defect.
- **L5** (FIXED, see Progress Log) Cards labelled "This month" summed ALL TIME: Payments Received ·
  Received, Vendors · Paid, Bills · Paid (also a different definition: Σ fully-paid bills), Payments Made ·
  Paid / Vendors Paid, Sales Receipts count, Quotes count, Manual Journals Debits/Credits, Projects ·
  Billable Hours, Timesheet · Hours Logged (+ its breakdown). Controls already right: Credit Notes /
  Vendor Credits "This Month", Banking Inflow/Outflow (MTD).
- **L6** (cash leg FIXED, see Progress Log) Manual-journal balance-sheet legs post to `J`-namespaced shadow
  accounts (J1010, J1100, J2000 …). A JE "Dr Checking 30 / Cr Revenue 30" moved revenue but no cash figure:
  balance-sheet Cash read only `bal['1000']`, the 13-week forecast reads that, and the cash-flow report is
  built from tables. All cash surfaces agreed (BS cash == cash-flow net == −200) while all omitting the JE's
  +30/−12 (Rule 6). FIXED for cash: J1000/J1010/J1020 are cash on every cash reader.
- **L6b** (open, design) The same J-shadowing for AR (J1100), AP (J2000), Inventory (J1200), Tax Payable
  (template 2200 "Tax Payable" ≠ system 2200 "Payroll Liabilities"): a JE to AR/AP moves no AR/AP figure.
  Fixing it needs computeBooks AR/AP to carry the JE legs, or the balance-sheet reconcile gate
  (glAR == books AR, glAP == books AP) breaks and the BS falls back to the oracle. Accounting design → Owner
  Handoff (journal account map).
- **L7** (open) Paid payroll cash-out is dated by `run_date` (= the run's CREATION instant) in both the
  GL `payroll_paid` entry and the cash-flow report — not the date it was marked paid. A June run marked
  paid in October shows its cash out in the creation month. No `paid_at` column exists. (F85 family.)

- **L8** (FIXED) Bills · "Due This Week" compared dates as INSTANTS (`new Date(b.due_date)` vs a local-midnight
  `Date`) and summed face amounts — a bill due today dropped out (both NY and Tokyo: 7 vs 6). Now calendar
  strings over [today, today+7] and the unpaid BALANCE (as the Overdue card, F-C1).
- **L9** (FIXED, see Progress Log) Quarter view mixed two quarters: native KPIs resolve "quarter" to TODAY's
  fiscal quarter, but `_cogsPeriodParams` (COGS subtracted from Net profit) and `_applyConvertedKPIs`
  (display-currency KPIs) sent `monthIdx=currentMonthIdx` — the month last browsed in Month view. Browse to
  June → Quarter: native net −$20 (Q2 COGS against Q3 zero revenue/opex); EUR revenue €1.5K (Q2×2) beside $0.
- **L10** (FIXED, see Progress Log) Accountant portal re-derived money from raw rows on 4 surfaces (headline
  cards were already canonical): Invoices Outstanding Σ full amounts of non-paid (790 vs AR 725), Collected
  Σ fully-paid (0 vs Σ amount_paid 60), Overdue by status literal (0 vs canonical 85), Expenses Total = rows
  only (8 vs opex 614), Deductible yes-only (0 vs 4), and the **CSV export's P&L SUMMARY** = paid invoices /
  expense rows (''/8/−8 vs 835/614/221) — its quote helper also wrote 0 as an empty cell. The overdue banner
  and the dashboard "overdue" status line used the same status literal.
- **L11** (FIXED) Accountant portal `getFiltered()`: `new Date(d)` + viewer-local `getMonth()`, CALENDAR
  quarters, 'year' = every record, and invoices filtered by DUE date (server recognises by ISSUE date); portal
  `fmtDate()` showed date-only values a day early west of UTC. Same class found in the main app: personal
  finance window (local-midnight bounds — a row dated the 1st dropped out west of UTC) and the period-lock
  display in `toggleLocking` ("March 30" for a March 31 lock west of UTC).
- **L18** (open, non-money) Remaining Rule-10 members: task due dates (index.html `fmtDue` + `new Date(due) <
  new Date()` overdue flag), accountant-portal task "due" labels, accountant-dashboard deadline overdue/
  upcoming split (`new Date(d.date) < today`), and the MRR chart's month buckets (local `new Date(y, m, 1)`
  windows vs `created_at`/`end_date`).
- **L12** (FIXED) Generated reports ignored the active period / recognition set: **Payroll Summary** and
  **1099/W-2** summed EVERY run ever, drafts included (full-leg + prior-FY run: 1637 vs recognised FY 550;
  on the VERIFICATION seed 12,500 vs owner FY payroll 6,200 + 3,000); **Cash Flow Statement** listed every
  month ever (out 1178 vs FY 280) while the Cash Flow page sums the period. Controls already right: P&L,
  Sales by Customer, Expense Report, AR, AP, Income Tax Estimate.
- **L13** (FIXED) **Tax-Deductible Expenses** report: 'yes' rows only, all time (10, a prior-year row) vs the
  server / Income Tax Estimate rule yes 100% + half 50% over the fiscal year (4). Same class as L10's portal
  Deductible card.
- **L14** (open, cosmetic) P&L report groups expenses as Payroll / "Bills & other" / categories — the
  journal leg is folded into "Bills & other", not the shared "Bills & vendors" / "Journal entries" list (D3).
  Sums correctly (614); label-only divergence.
- **L15** (FIXED with L6) Balance Sheet report: Total Assets 453 but its lines were Cash −200 + AR 635 = 435 —
  the 18 of journal cash (J1010) was in the total with no line. Now Cash −182 + AR 635 = 453.
- **L16** (FIXED) Page exports: Vendors / Bills / Quotes / Items exports read globals nothing assigns
  (`allVendors`, `allBills`, `_quotes`/`allQuotes`, `userItems`/`allItems`) → always "No data to export." with
  rows on screen; Expenses "Tax Deductible" = `(ded||deductible)?'Yes':'No'` → the string 'no' exported as
  Yes, 'half' as Yes; Invoices/Expenses dates exported as display labels without a year ("Aug 5"); the Vendors
  export carried a typed `balance`, not the computed owing (20861a9).
- **L17** (open) Customers page "Revenue" column and "Total revenue" card (and its CSV) are a TYPED number on
  the customer record (`c.revenue`) — Acme's contact shows 0.00 with 700 invoiced to "Acme". Same class as the
  vendor typed-balance fix 20861a9; needs a customer↔invoice link (invoices carry `client` as free text).

## Decisions (irreversible-safe choices the agent made)
- **D1 — Working branch & pushing.** Commits go on `dash-je-fix` only. This run executes in an ephemeral
  cloud container: an unpushed commit is lost when the container is reclaimed, and the owner cannot fetch
  from it. So the agent pushes `dash-je-fix` (fast-forward only) to origin at phase boundaries. It never
  pushes or merges `main`; Railway deploys only from `main`, so a branch push deploys nothing.
- **D2 — Baseline run.** Harnesses run as the non-root `postgres` user on a clean `git archive` copy of
  the commit under test (so harness side-effects like `public/.min` can't dirty the repo).
- **D3 — Expense category list (L3).** One decomposition everywhere: direct categories + "Payroll" +
  "Bills & vendors" (issued bills + orphan payments − vendor credits) + "Journal entries". The Expenses
  page label "Bill payments" is retired in favour of the dashboard's "Bills & vendors" (it showed a
  different, partial leg). Four bars: ≤4 categories show by name; more ⇒ top 3 + "Other".
- **D5 — "This month" cards (L5).** A card whose sub-label says "This month" shows this calendar month
  (the existing `inThisMonth` string-date test, now `window._inThisMonth`), never all-time. Bills "Paid ·
  This month" = cash paid against bills this month (bill-linked payments made) — the same rows the Vendors
  and Payments Made "Paid" cards use. Cards with no period label (Largest/Avg payment, Cash/Card sales)
  stay all-time. Quotes have no business date, so their month is `created_at`.
- **D6 — Quarter = today's quarter (L9).** The Quarter view has no navigator (the month navigator is hidden
  for it) and its prior-period baseline is already `curFyIdx − 3`, so "Quarter" means today's fiscal quarter
  on every surface; `_periodIntentIdx(period)` is the single source for native windows and server intents.
- **D7 — Reports follow the active period (L12/L13).** Every generated report covers the dashboard's active
  period (year ⇒ fiscal year), the convention P&L / Sales by Customer / Expense Report already used. Payroll
  runs belong to the period they are FOR (F85) and only approved + paid runs are payroll (decision 2); draft /
  voided runs are listed as "not in totals". W-2 uses the same recognised set; **paid-only W-2 wages is an owner
  tax-policy question (Owner Handoff)**. Deductible weighting = the server's (yes 100%, half 50%).
- **D4 — Commit trailer.** The plan's template says `Claude Opus 4.8`; commits use the attribution of the
  model actually running this session (accuracy over copying a stale template).
