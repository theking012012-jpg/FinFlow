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

**Added by this run (2026-10-07) — owner decisions / config, each with its finding:**
- **Deploy gate (this run's change to the contract):** the owner runs the full sweep once on the final
  `dash-je-fix` commit; when green the agent (or the owner) fast-forwards main: `git fetch origin && git checkout main
  && git merge --ff-only origin/dash-je-fix && git push origin main` (Railway deploys from main).
- **`APP_URL` must be the live https origin** (L2) — the sitemap, email links and OAuth returns are built from it;
  unset ⇒ the dab2 fallback.
- **Pick ONE public domain** (L19): landing.html canonical/og = finflow.io, email plans = finflow.app, app on Railway.
  Then set APP_URL and fix the 4 landing.html meta tags.
- **`DATABASE_CA_CERT`** (audit F19): DB TLS is verified only when it is set; otherwise `rejectUnauthorized:false`.
- **Tax worksheet default** (L28): keep the flat 25% placeholder line, switch to the country-suggested rate the app
  already computes, or start blank (D1: FinFlow holds no tax knowledge).
- **W-2 wages basis** (D7): approved + paid runs today; paid-only is a tax-policy call.
- **Journal account map (L6b) — ratified 3, ONE decision for you.** Journal lines post to `J<code>`; these reach the
  balance-sheet line (shipped `b4c4617`): **1100 → Accounts Receivable · 2000 → Accounts Payable · 1200 → Inventory**.
  Held for you — the JE template collides with the system chart:
  · template **2200 "Tax Payable"** (system 2200 = Payroll Liabilities) — **recommendation: map J2200 → the Tax
    Payable line** (match on MEANING; the user picked "Tax Payable").
  · template **2100 "Credit Card"** (system 2100 = Tax Payable) — **recommendation: map J2100 → a new "Credit card /
    other current liabilities" line** (neither AP nor tax), and longer-term renumber the template (Credit Card → 2300,
    Tax Payable → 2100) so picker and ledger agree. Until you decide, both stay in total liabilities only.
- **Customer ↔ invoice foreign key** (D8/L17): revenue attribution is by name match until invoices carry a customer id.
- **Landing page "750+ App integrations"** (audit F51): ~17 have a real connect flow; the claim is marketing copy.
- **Investments close-position / realised gain** (audit F109) and **entity jurisdiction / region** (F108): features.
- **Per-account settings applied to per-entity books** (audit F149; CLAUDE.md Rule 10 "under investigation"): fiscal
  year start and industry are still account-wide.
- **N17 / N22** (prior audit): owner-decision proposals were lost with the scratchpad — re-raise if still wanted.
- **13 N-numbers with no surviving definition** (N1, N23, N25, N34, N35, N42, N70, N84, N93, N94, N95, N103, N106): if
  you have the original `AUDIT_FINDINGS_2026-10-06.md` anywhere, they can be re-audited; otherwise they are lost.
- **Data (Rule 8 — enumerate, then decide):** legacy NULL-entity `sales_receipts` (F26-b) show in every entity;
  legacy invoices/bills with NULL issue_date still date by created_at (UTC) (L23 fixes new rows only); the Store-A
  $1,000 legacy row (F32-residual).
- **Housekeeping:** untrack the 94 `.fuse_hidden*` files (L20) — AUDIT_MASTER.md is now restored (L26), so nothing
  is lost: `git rm -r --cached '*.fuse_hidden*'` (they are already in .gitignore).
- **Live check after deploy:** load each page signed in and read the console (1.3 was verified locally in Chromium on
  the full + SLIM builds; the deployed app runs `main`).

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

- 2026-10-07 — **1.1 / L7 payroll paid date.** Harness `verify-payroll-paid-date.js`: RED 5/9 on pre-fix (no
  paid_date; GL and cash-flow on the creation month May) → GREEN 11/11 (incl. idempotent re-mark and the
  legacy run_date fallback through the GL backfill). `b4-4-payroll-cash-transition.js` section 5 revisited as its
  own comment asked ("if a paid_date is ever added …"): cash lands in the paid_date month → 20/20.
  VERIFICATION.md B4.4 note updated (verification-sync OK). Gates step1–4 green; regression green:
  gl-backfill 24 / -amountpaid 7 / -createdat-date 6, gl-post-payroll 17, gl-payroll-cashout 16,
  payroll-approve-guard 5, payroll-run-atomic 7, payroll-state-guards 9, boot-modes 3, migrate-entrypoint 3,
  f57-cash-card 14, journal-cash 11, full-leg-parity 28, b4-2-3-payroll-pl-transition 16.

- 2026-10-07 — **seed fix after L7** (`5600e41`, test-only): reports-parity's prior-year paid run and the
  full-leg June run are dated on their real paid dates (mark-paid now stamps today). Missed in L7's regression
  set — caught here; all 8 scenario users re-run green.
- 2026-10-07 — **1.1 / L14 P&L statement lines.** `verify-reports-parity.js` + an L14 assertion: RED on pre-fix
  ("Bills & other $56") → GREEN 11/11. `verify-f137g-pl-statement.js`'s remainder-formula assertion restated
  for the shared list (lines present, Σ == canonical total, no unreconciled gap) → 19/19. Regression green:
  pl-statement-period-ui 4, expense-breakdown-all-surfaces 10, expense-breakdown-reconcile 8, step4 5.
  bundle:check in sync.

- 2026-10-07 — **1.1 / L17 customer revenue derived.** Harness `verify-customer-derived-revenue.js` (two contacts
  at one company, a full-name match, a draft, a future-dated and an unmatched invoice; then a form save): RED
  8/8 on pre-fix (typed 999/555/0, card $1,554, input present, save NaN/not listed) → GREEN 8/8. `npm run build`
  regenerated `public/_gen/index.html` (1-line diff: the removed input; the full build reproduces every other
  tracked artefact byte-for-byte). Gates step1–4 green; regression green: bootcache, csv-customer-shape 6,
  entity-leakage-sweep, f157-no-entity-400 15, f66-customer-vendor-validation 12, f150-entity-stamp-no-leak 9,
  f150c-write-side-isolation 33, f90-phaseB3-business 17, team-member-writes 27, tenant-isolation 47,
  min-serving 8, page-exports 14.

- 2026-10-07 — **1.1 / L18 Rule-10 remainder.** Harness `verify-calendar-dates-tz-l18.js` (HARNESS_TZ NY + Tokyo):
  RED 8/14 on pre-fix (MRR Jun 100 west of UTC; task "24 Jul" + red; portal "24 Jul"; deadline "Jul 24") → GREEN
  14/14. `npm run build` regenerated `public/_gen/app-08.js`, `app-18.js` (the edited inline index.html code).
  Regression green: f127-mrr-chart 7, ff1-mrr-by-customer 7, f126-mrr-fx-convert 10, accountant-dashboard-qa 8,
  accountant-rollup 13, accountant-pending-ui 3, accountant-tasks, proposals-ui 23, help-center 23,
  support-request 15, escaping-sweep 3, team-member-writes 27, calendar-dates-tz 12, min-serving 8, step4 5.
- 2026-10-07 — **1.1 coverage close.** Every money figure has now been driven through every surface on the
  full-leg books (+ variants): headline KPIs, breakdown bars, overview chart, month/quarter/year, consolidated
  two-currency, display currency, page cards, generated reports, page exports, accountant portal (+ CSV), cash /
  balance sheet / forecast, payroll, COGS, customers, vendors, investments ($60 dashboard == page == 5×12).
  Open from 1.1: **L6b** (journal AR/AP/inventory/tax legs — owner design).

- 2026-10-07 — **1.4 / L2 dead domain.** Harness `verify-app-domain.js` (boots the server with and without APP_URL,
  reads /sitemap.xml; + a labelled STRUCTURAL no-dab1 check): RED 3/4 on pre-fix (dab1 locs both ways;
  .env.example) → GREEN 4/4. /sitemap.xml now generated from appUrl(); static file removed. Regression green:
  accountant-billing 14, email-resend 10, email-escaping 23, security-headers 13.

- 2026-10-07 — **1.3 / L21 (+L1) console cleanliness.** Instrument (`/srv/ff/probe/console-probe.js`, not shipped):
  real headless Chromium (Playwright) vs the real server on a scratch DB with the VERIFICATION seed; boot + every
  page (54); console errors/warnings + uncaught page errors + a CDP pause-on-exception tracer for CAUGHT throws;
  positive control proves each failure kind is captured. Full build: 0/0/0. SLIM build pre-fix: boot 3 err + 4 warn
  (6 throw sites). Fix in scripts/lazy-pages.js (hydrate-on-access). Portable harness `verify-slim-boot-renders.js`
  (jsdom, SLIM document): RED 7/9 on pre-fix → GREEN 9/9. Chromium after fix: SLIM 0 console output on 54 pages,
  0 null-family throw sites; full build 0 / 0. `npm run build` regenerated public/_gen/index.html (hook only).
  Regression green: min-serving 8, boot-modes 3, help-center-ui 34, f145-render-smoke 9, dashboard-render 9,
  boot-failures-gate, step4 5.

- 2026-10-07 — **1.3 / L22 non-SPA pages.** Chromium probe of landing, accountant-dashboard, accountant-client (+ admin):
  the portal's Tabler icon stylesheet was REFUSED by CSP. Class enumerated (every page × every stylesheet / script /
  font × the CSP the server sends + SRI well-formedness): 3 instances. Harness `verify-csp-allows-page-resources.js`
  (real server, every public/*.html): RED 3 on pre-fix → GREEN 36/0. Chromium after fix: portal 0 console output,
  icon glyph resolves (13 px wide); admin `Chart` defined (pre-fix: refused). Regression green: security-headers 13,
  csp-report 14, slim-boot-renders 9, accountant-portal-parity 12, step1-gate.

- 2026-10-07 — **1.2 re-audit.** Recovered the Master Audit (newest of 23 `.fuse_hidden` copies), triaged every row
  the 2026-08-09 reconciliation left open against current code (4 read-only agents, file:line evidence) ⇒ §1.2 map.
  Fixed so far: L23 (N102, entity record dates; RED 17/19 → GREEN 19/0; 111 route harnesses green), L24 (F44,
  scenario base; RED 5/6 → GREEN 6/0 ×3; scenario/boot/parity regression green), L25 (F45, budget actuals;
  RED 5/7 → GREEN 7/0; budget regression green), L26 (hook / ledger / count), L29 (native money exact; RED 9/10 →
  GREEN 10/0; 25 report/format harnesses green, f124 + f129 source-slice harnesses restated for the exact formatter), L30 (register today; RED 2/3 → GREEN 3/0; 8 auth
  harnesses green), L31 (membership audit; RED 6/7 → GREEN 7/0; 22 team/rbac/audit harnesses green), L32 (tz-matrix crash exit 0 → 1), L27 (shadowing guard).
- 2026-10-07 — **2.1 GL single source of truth.** The flip already exists in a safer form than a flag: every report
  read-swaps to the GL only when GL == computeBooks for that entity/period (5b), else serves computeBooks; backfill is
  owner-gated. New harness `verify-gl-backfill-full-leg.js` (full-leg dataset, live ledger wiped and rebuilt) found
  L33 (backfill skipped journals; GL and books agreed on the wrong 715/113) and L34 (gate excluded journal expense
  accounts ⇒ GL never served journal users). Both fixed: 28/28 lines identical, idempotent, TB/BS balanced, GL serves
  745/614/131. Regression: 51 GL/reports/parity/gate harnesses green. The prod backfill RUN stays owner-gated (Rule 8).
- 2026-10-07 — **2.3 VERIFICATION empty cells.** A7.5–8 / A7.18 were NOT gate-executed (the plan assumed they were);
  new `verify-verification-a7-gaps.js` runs them on the real seed (9/0); A8a via `tz-matrix.js` (4 viewers incl.
  UTC+5:30: identical); A8b via new `verify-a8b-fiscal-year-viewer.js` (discriminating Apr-vs-Jan FY seed, 5/0).
  Stamped. Two rows' Expected text is stale vs expected.js (A7.6 750 → 5,450; A7.18 8,200 → 9,100) — stamped PASS*
  with an owner note, not rewritten (expected values are the owner's). A7.1 / A7.20 / A7.21 stamped from step3-gate.
- 2026-10-07 — **2.2 / 2.4 / 2.5 / 2.6** recorded as D11 (investments posting design, owner decides) / D12 (pagination
  deferred: risk > gain) / D13 (mobile: nothing measured, nothing changed) / D14 (defense-in-depth: owner).
  Phase 2 complete for the agent. Owner: no more full sweeps from the
  agent — the owner runs the sweep once at the end; the agent pushes main after it is green.

- 2026-10-08 — **L35 AR overdue netting** (FIX_PLAN_AR_OVERDUE.md). Commits on dash-je-fix: `930b714` harness
  (expected RED R1×3, R2×2), `a5307a4` Root 1, `3b08167` Root 2; Root 3 already fixed by L10. All UNEXECUTED in the
  container per the plan; owner runs the harness per commit + money gates + 3× sweep in PowerShell. Logged L36.

- 2026-10-08 — **L36 + L6b** (FIX_PLAN_OPEN_DIVERGENCES.md). L36: harness `39c464d` → client `37ec40b` → portal
  `00c0996`. L6b: harness `bba8895` → fix `b4c4617` (AR/AP/Inventory; tax/credit-card map held for the owner, D16).
  All UNEXECUTED in the container per the plan; owner runs harnesses per commit + gates + 3× sweep in PowerShell.

- 2026-10-08 — Owner results: L6b GREEN 11/0; L36 still 1 FAIL (portal) at `00c0996`; step4-client-gate crashed.
  Owner pushed main → `4db4fcc`. Follow-ups on dash-je-fix: `49a0d3c` L36b (consolidated-scope today),
  `165e924` step4 gate extracts the L36 helpers, `2bf9b2f` same for f57 / journal-dashboard-parity /
  verification-cells. Logged L37 (golden master stale since F87). Full sweep ×3 deferred by the owner to the end.

## Findings Ledger (numbered; newest last)
Numbered `L<n>` (launch run) so they never collide with the lost audit's `N<n>` series.
- **L1** (FIXED, as part of L21) renderInvestments null-textContent boot error — Phase 1.3.
- **L21** (FIXED) The production SLIM build (`SLIM_APP=1`, public/_gen) lazy-wraps 47 screens in `<template>`s
  hydrated only on showPage, but boot code renders into them (`getElementById(id).textContent = …`) ⇒ six throw
  sites — renderPersonal, renderCustomers, renderInvestments, updateCashflow, updateAI, updateBrandName — and the
  throws ABORTED their callers: **`[FinFlow] refreshFinancials failed`**, `syncAllPayrollsToPersonal failed`,
  `[boot] a deferred render hook threw`. Real Chromium, SLIM: boot 3 errors + 4 warnings, Payroll 3 warnings.
  The full (non-SLIM) build was already clean (0 on boot + 54 pages).
- **L2** (FIXED) Dead-domain audit. Shipped code named the dead `dab1` origin in `public/sitemap.xml` (every
  `<loc>` → search engines handed dead URLs) and `.env.example` (`ALLOWED_ORIGIN`, `APP_URL` example values).
  `app-url.js` LIVE_FALLBACK was already dab2. Password-reset / Stripe return / email links all build from
  `APP_URL` (or the request host) — correct once the env is set (Owner Handoff).
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
- **L6b** (FIXED for AR / AP / Inventory — harness owner-executed GREEN; full sweep pending; Tax / Credit-card mapping = owner decision —
  FIX_PLAN_OPEN_DIVERGENCES.md) A posted journal's balance-sheet leg landed on a J-account (J1100 / J2000 / J1200)
  that no balance-sheet LINE read, and computeBooks AR / AP were invoices / bills only, so a JE "Dr AR 130" moved no
  AR figure, the gate passed vacuously, and the GL totals ≠ the sum of the lines. Fix `b4c4617`:
  `JOURNAL_BS_LEDGER_CODES {J1100 ar, J2000 ap, J1200 inventory}`; `computeBooks.journalBalances` read from the GL;
  glBalanceSheet lines + gate two-sided (GL path and oracle); accountant-portal BS likewise. D16: the
  invoice / bill SUBLEDGERS (`outstanding`, AP card, overdue) are unchanged — the balance sheet shows control
  accounts. Harness `verify-gl-journal-bs-legs.js` (`bba8895`, RED expected ×5 pre-fix). UNEXECUTED here (plan rule).
  OWNER-EXECUTED (PowerShell, 2026-10-08): `bba8895` 6 FAILED (one more than predicted — the template-2100/2200
  assertion also failed pre-fix because it checks AR 1,130 / AP 460, which the bug did not produce) → `b4c4617`
  ALL GREEN 11/0. Money gates green. Full sweep ×3: deferred by the owner to the end.
- **L7** (FIXED) Paid payroll cash-out was dated by `run_date` (the run's CREATION instant) in both the GL
  `payroll_paid` entry and the cash-flow report (F122's known approximation — no paid date existed). A June
  run marked paid in October showed its cash leaving in June. Now `payroll_runs.paid_date` (stamped once by
  mark-paid, the business's calendar date) dates both; legacy paid rows keep `run_date` (no data change).
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
- **L18** (FIXED) Remaining Rule-10 members: task due dates (index.html `fmtDue` + `new Date(due) <
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
- **L14** (FIXED) P&L report grouped expenses as Payroll / "Bills & other" (a remainder: exp − payroll −
  manual categories) / categories — the journal leg and bills folded into one line, not the shared list (D3).
  Now the shared list, every category; any client/server gap shows as "Unreconciled difference".
- **L15** (FIXED with L6) Balance Sheet report: Total Assets 453 but its lines were Cash −200 + AR 635 = 435 —
  the 18 of journal cash (J1010) was in the total with no line. Now Cash −182 + AR 635 = 453.
- **L16** (FIXED) Page exports: Vendors / Bills / Quotes / Items exports read globals nothing assigns
  (`allVendors`, `allBills`, `_quotes`/`allQuotes`, `userItems`/`allItems`) → always "No data to export." with
  rows on screen; Expenses "Tax Deductible" = `(ded||deductible)?'Yes':'No'` → the string 'no' exported as
  Yes, 'half' as Yes; Invoices/Expenses dates exported as display labels without a year ("Aug 5"); the Vendors
  export carried a typed `balance`, not the computed owing (20861a9).
- **L17** (FIXED) Customers page "Revenue" column, "Lifetime Revenue" card (and its CSV) were a TYPED number on
  the customer record — Acme's contact showed 0.00 with 700 invoiced to "Acme". Now derived on read (N24
  pattern). Also: wiring `saveCustomer` pushed into `window.customers`, a binding `renderCustomers` never
  reads (it reads app-main's top-level `let customers`), so a new customer wasn't listed until reload.
- **L19** (open, owner) Canonical domain is undecided in code: `landing.html` canonical + og:url + og/twitter
  image = `https://finflow.io/`, email is planned on `finflow.app` (Resend), the app runs on Railway dab2. Pick
  ONE public domain; then set APP_URL and fix the 4 landing.html tags (Owner Handoff).
- **L20** (open, owner/housekeeping) **94 `.fuse_hidden*` files are tracked in git** (root + `public/`), ~MBs of
  FUSE/OneDrive temp leftovers (first added in e644813): copies of the old **AUDIT_MASTER.md** ("FinFlow — Master
  Audit", up to 447 KB) and of index.html. Not served (express static ignores dotfiles). They should be
  untracked + `.gitignore`d — AFTER the newest audit copy is recovered (Phase 1.2 uses it). Same root cause as
  the "move the repo out of OneDrive" handoff item.
- **L22** (FIXED) Page resources the browser refuses — measured in real Chromium. (a) accountant-client.html
  loaded Tabler icons from cdn.jsdelivr.net, but `style-src` allows only Google Fonts ⇒ blocked ⇒ all 36 `ti` icons
  in the accountant portal rendered blank. (b) That link AND admin.html's Chart.js `<script>` carried a TRUNCATED
  sha384 SRI (63 chars). Chromium measured (`/srv/ff/probe/sri-probe.js`, control vs truncated): "Failed to find
  a valid digest" ⇒ resource refused ⇒ the admin overview/traffic charts never rendered. Fix: Tabler 3.29.0
  CSS + woff2 vendored at public/vendor/tabler-icons (MIT; npm `@tabler/icons-webfont`), admin uses the already
  vendored /vendor/chart.umd.js (4.4.1, as index.html), CSP `style-src` / `font-src` gain `'self'` (enforced and
  report-only policies; same-origin only, no new third party). The Admin page's single 401 in the console is its
  unauthenticated session probe — expected, not a defect.

- **L23** (FIXED — N102 of the prior audit) Server-filled business dates were the UTC day, not the entity's. F88 had
  routed expenses / journals / receipts / payments-received / credit notes / payments made / vendor credits
  through `entityTodayYmd`, but these still stamped UTC: Stripe webhook refund row (server.js ~515), invoices and
  bills sent without an issue date (stored NULL ⇒ dated by `created_at`'s UTC day in the books, GL and lock),
  invoice created as paid (its settling payment), timesheet, POST /api/invoice-payments (whose lockGuard ALREADY
  checked the entity's today — lock and row could be different days), processor payments
  (`recordExternalInvoicePayment`: Stripe "Pay now", WiPay, Mercado Pago, dLocal), Stripe import charge / refund /
  fee (`created` instants read as UTC), Stripe match-invoice (payment booked on the MATCH day, its fee on the
  charge day), POST /api/fx-rates, FX settlement GL entry (route + backfill; `settled_at` = DB clock), accountant
  journal, client FX-rate form. Fix: one helper `entityYmdOf(entityId, instant)` (entityTodayYmd delegates to it).
  New rows only; existing rows untouched (Rule 8 — NULL-issue-date legacy invoices/bills still date by created_at).
  Excluded, with reason: personal-finance rows (per-user, no entity: personal tx, snapshots, owner-salary personal
  tx), bank-feed fallbacks used only when Plaid/Belvo/OFX omit a date, rate-lookup dates, the global live-FX feed,
  API fetch windows, export filenames, payroll `run_date` (F85: payroll recognises on `period` / `paid_date`).

- **L24** (FIXED — audit F44) Scenario planner baseline used paid-only invoices and all-time raw expense rows, no COGS
  (seed: baseline 0 / 58 vs the dashboard's Year 745 / 614 + COGS 40). Now `_syncScenarioBase` = computeRevenue('year'),
  computeExpenseBreakdown('year').total + FY COGS (/api/cogs period=year); repaints when the COGS fetch lands.

- **L25** (FIXED — audit F45) Budget actuals were Σ raw expense rows of ALL TIME against ANNUAL targets: prior-year
  spend counted, and payroll / bills / journal expense never counted (a Payroll target read 0). Now actuals =
  this fiscal year's categories from the shared breakdown (D3 list), case-insensitive. Decision **D10**.

- **L26** (FIXED — audit H1 / F81 / F105 residue) (a) `.githooks/pre-commit` was tracked mode 100644 — on Linux/macOS
  git SKIPS a non-executable hook ("hint: … ignored because it's not set as executable"), so neither the H1
  `bundle.js --from-index` guard nor the `verification-sync` block ever ran here; now 100755 (on Windows git runs
  hooks regardless of mode). (b) `AUDIT_MASTER.md` — the ledger CLAUDE.md requires to be tracked — was missing;
  restored verbatim from the newest copy with a provenance banner. (c) VERIFICATION Part B "~22" → 23 (rows counted).

- **L27** (GUARDED — audit F75) 27 app-main functions are shadowed by wiring `window.NAME =` (20 replacements, 7 wrappers;
  4 shadowed twice: renderExpenses, saveExpense, saveHolding, showPage) and NO guard stopped a new one landing.
  `verify-no-new-shadowing.js` [STRUCTURAL, labelled] recomputes the set (27, matching an independent count) and fails
  on any unreviewed name; self-tests inject `window.computeRevenue` / `window.updateCashflow` and are caught. The 27
  existing pairs remain (shrinking them is a refactor, post-launch); Rule 1 still applies to each.
- **L28** (owner decision — audit F51 residue) The Income Tax Estimate worksheet pre-fills an editable "Income tax 25%"
  line when no rate/lines are saved (a documented placeholder, labelled "rough estimate"); /api/tax-filing also
  returns `estimatedTax` at 25% (unconsumed). D1 says FinFlow holds no tax knowledge — choose: keep 25%, use the
  country-suggested rate the app already computes (/api/tax/suggested-rate), or a blank 0% line. Owner Handoff.
- **L29** (FIXED — audit F64 / F129 residue) `_fmtMoneyNative` (entity money, unconverted) delegated to the K/M/B
  abbreviator, so every amount ≥ 1,000 on ALL 12 generated reports, the Reports page tiles, the Scenario planner and
  the budget rows read "TT$12.3K" — F64 (launch blocker B2) had only been fixed for window.S. The shared full-leg seed
  keeps amounts < 1,000 "so abbreviation can't show", which is why nothing caught it. Now exact (honours Show cents);
  chart axes use `_fmtMoneyNativeAbbr`. Same class: bank-reconciliation difference used a literal '$' AND dropped the
  minus sign on a negative difference; timesheet rate used a literal '$'.

- **L30** (FIXED — audit F116 residue) Registration never primed `window._serverToday` (register returned no `today`;
  doRegister didn't set it) ⇒ a new account's first session had Record Payment's Save disabled ("Still loading
  today's date") until reload. Register now returns `today` like login; doRegister sets it.

- **L31** (FIXED — audit F107 residue, F90 class) None of the five team-membership writes (create, role/entity-access
  change, revoke, invite/re-invite, accept) left an audit row, though each grants or removes access to an account's
  books. Now each records CREATE / UPDATE / DELETE / INVITE / ACCEPT on the owning account, actor attributed; the
  invite token hash (a bearer secret) is stripped from the trail.

- **L32** (FIXED — audit F83 residue) A crashed tz-matrix probe printed a bare "FATAL" (no colon) and returned, so the
  clock.js exit latch (keys on `FATAL:`) never fired and the run exited 0 — measured: crash ⇒ exit 0. Now prints
  `FATAL:` ⇒ exit 1 (measured), clean run still 0. verify-c1-payroll-pilot / verify-f102-payroll-boot measured
  exit 1 on a crash under the clock preload every runner uses (their own `exitCode = 0` is overridden by
  embedded-postgres's async-exit-hook `process.exit(0)` either way; the latch is what works) — no change needed.

- **L33** (FIXED — Phase 2.1) The GL backfill (owner's one repair tool for history) had NO manual-journal step, and
  computeBooks reads the journal P&L FROM the GL (N20) — so a posted journal that never reached the ledger (pre-N20,
  or a failed best-effort post) counted on no surface, and backfilling could not restore it. Measured on the full-leg
  dataset: after backfill GL AND computeBooks both said revenue 715 / net 113 (hand-computed 745 / 131) — they
  agreed, so /api/reports served source:'gl' with the wrong figures (Rule 6). Backfill step 12 now replays posted
  journals through the live `postJournalToLedger` (same key ⇒ identical entries).

- **L34** (FIXED — Phase 2.1) The GL 5b P&L read-swap gate computed opex as accounts 6000 + 6100 only; manual-journal
  expense accounts (J5100 …) are expenses computeBooks counts, so ANY entity with a posted expense journal "diverged"
  (gl opex 602 vs 614 on the full-leg set) and the GL never served — the structural cure stayed off exactly for
  journal users. Gate opex = all expense accounts except 5000 COGS and 7000 FX (the balance-sheet gate's rule).

- **L35** (FIXED — harness + gates owner-executed; full sweep pending — FIX_PLAN_AR_OVERDUE.md) AR "Overdue" was not netted of open credit
  notes on the client, so it could exceed Outstanding — live dab2 2026-10-07: Overdue $14,300 > Outstanding $13,550
  (server overdue $13,050). Class enumerated (Rule 13, both directions): server `/api/reports.overdue` and
  `computeBooks.arSummary.overdueTotal` already net + clamp (correct). **Root 1** client `arOutstanding()` returned
  overdue gross/unclamped ⇒ dashboard sub-line, Invoices "Overdue" tile, Payments Received, AR-report fallback —
  fixed `a5307a4` (one edit, all consumers). **Root 2** reminders `rem-out` = Σ listed candidates' gross balances —
  fixed `3b08167` (canonical `ar_outstanding`, D15). **Root 3** accountant portal (status literal, gross, no netting)
  — already fixed by L10 `1e72aa2` (portal reads `arSummary.overdueTotal`); live dab2 ran `470dce2`, pre-L10.
  Harness `verify-ar-overdue-netting.js` (`930b714`): seed partial + literal-overdue + not-due invoices + open CN ⇒
  hand-computed outstanding 3,100 / overdue 2,300; buggy 3,500 (R1, R2) and 1 · 1,500 (R3 pre-L10).
  **EXECUTED by the owner (PowerShell, 2026-10-08):** `930b714` 6 FAIL (R1 ×4 incl. "overdue ≤ outstanding", R2 ×2)
  → `a5307a4` 2 FAIL (R2) → `b413e3d` ALL GREEN 12/0; against `470dce2` (live at audit time) 9 FAIL incl. all
  three R3 assertions. Gates green: step1 26/0, step2 63/0, step3 56/0, step4 5/0, full-leg-parity 28/0,
  accountant-portal-parity 12/0, payment-reminders 25/0, reminders-context 10/0, ar-by-customer 15/0.
  Full sweep ×3: NOT yet run (run 1 was stopped by the owner before any harness reported).
- **L36** (FIXED — owner verification pending; FIX_PLAN_OPEN_DIVERGENCES.md) The client's AR "today" is the UTC day
  (`arOutstanding`: `resolvedToday(new Date())` with no zone; accountant portal `_portalOverdueInvoices`:
  `new Date().toISOString()`), while the server's overdue/D2 boundary is the ENTITY's day. For an entity far from
  UTC, near midnight an invoice due "today" can be overdue on the server and not on the client (or vice versa), so
  overdue COUNT/amount can differ by that invoice for a few hours. Fix: pass the entity tz (client has
  `_activeEntityTz()`) / the server's `window.today` (`books.window.today`). Class enumerated: 19 client sites, 15 gate
  an accounting boundary. Fix: `_entityToday()` (app-main, beside `_activeEntityTz`, the `_isScheduled` pattern)
  routed through all 15 — AR/overdue/D2, fiscal context, period windows, banking month, dashboard FY window ×2, AR/AP
  report fallbacks, documents month, inThisMonth, bills past-due + this-week, recurring-bills YTD, Invoices D2,
  MRR months (`37ec40b`); portal overdue list uses the server's `window.today` (`00c0996`). Exempt: personal-finance
  range (no entity), the user's own task list. Harness `verify-ar-today-entity-tz.js` (`39c464d`, Tokyo at the
  pinned instant: RED expected ×7 pre-fix). UNEXECUTED here (plan rule).
  OWNER-EXECUTED (PowerShell, 2026-10-08): `39c464d` 7 FAILED → `37ec40b` 1 FAILED → `00c0996` STILL 1 FAILED
  (portal pill). **L36b — the root the portal fix missed:** the portal opens on the "All entities" view, so
  `computeBooks(entityId=null)` resolved today via `entityTodayYmd(null)` = the UTC day; `window.today` and the
  server overdue summary were therefore UTC for every consolidated view (accountant portal, `/api/reports` and
  `/api/reports/profit-loss` with no entity, `glConsolidated`). Fix `49a0d3c`: `scopeTodayYmd(userId, entityId,
  permittedEntityIds)` — a single entity ⇒ its day; a consolidated scope whose entities share one timezone ⇒ that
  zone's day; MIXED zones ⇒ UTC (KNOWN LIMITATION — a consolidated view across zones has no single calendar day;
  owner decision if it matters). Routed through computeBooks, glConsolidated, /api/reports, /api/reports/profit-loss.
  Expected ALL GREEN 10/0 at `49a0d3c` — UNEXECUTED (owner to run). **Main (`4db4fcc`) carries `00c0996` but NOT
  `49a0d3c`, so the portal fix is ineffective in the All-entities view until the next push.**
  Harness breakage from L36 (test-only): source-slicing probes that extract `_fyContext` / `_periodWindow` /
  `arOutstanding` threw `ReferenceError: _entityToday` — owner-observed on step4-client-gate (fixed `165e924`);
  enumerated the class: f57-cash-card, verify-journal-dashboard-parity, verify-verification-cells (fixed `2bf9b2f`).
  The fourth slicer, tests/golden-master-payroll-basisC.js, is L37.
- **L37** (OPEN — suspect, by READING only, not executed; test-only) `tests/golden-master-payroll-basisC.js`
  `loadClientEngine()` slices `_fyContext` / `arOutstanding` but its `win` stub has NO `FinFlowDates`; those functions
  have called `window.FinFlowDates.resolvedToday` since F87, so the client leg should throw a TypeError — i.e. it has
  been dead since F87, independent of L36. It lives in tests/ (not tests/harness/) so the sweep never runs it,
  which is why nobody saw it. Rule 5 corollary: retire it (its basis-C coverage is in the harness suite) or make the
  client engine importable. Not fixed here — owner to decide; confirm by running
  `node tests/golden-master-payroll-basisC.js` in PowerShell.

### 1.2 re-audit map (prior audit = the recovered Master Audit, `.fuse_hidden0000000d00000007`, 3,289 lines)
Source recovery: 23 `.fuse_hidden*` copies are tracked; the largest is a strict superset of every other copy's
finding IDs, so it is the newest. The N-series (N1–N114) lived only in a lost scratchpad file
(`AUDIT_FINDINGS_2026-10-06.md`); 88 N-numbers appear in commits (each landed with a fail-then-pass harness and was
re-verified by execution in this session's PR #1 review). **13 N-numbers have no surviving definition anywhere**
(N1, N23, N25, N34, N35, N42, N70, N84, N93, N94, N95, N103, N106 — not in commits, code, the uploaded transcripts,
or the recovered ledger) — they cannot be re-audited without inventing them (Rule 7); see Owner Handoff. N17/N22 are
owner decisions whose written proposals were lost; N102 = L23.

Master-audit rows the 2026-08-09 reconciliation left OPEN, re-checked against current code (read-only, file:line
evidence in the agents' reports; money items then executed):
| Row | Now | Evidence / disposition |
|---|---|---|
| F64 money abbreviated | FIXED, 1 leftover | `window.S = _fmtMoneyExact` (app-main 686); budget rows still abbreviate (index.html 6126/6133) ⇒ **L29** |
| F57 Cash Flow basis | FIXED | updateCashflow reads `_cashMonthly` from /api/reports/cash-flow (app-main 2660) |
| F58 credit notes / vendor credits contra | FIXED | server 10801/10906, client computeRevenue/computeExpenseBreakdown |
| F71 payroll effective dating | FIXED | basis C — run lines by `period` only (server 10866, app-main 2053) |
| F142 payments-made entity scope | FIXED | server 4802 |
| F44 Scenario base pre-F32 | **STILL PRESENT ⇒ L24** | wiring-medium 1092: paid-only revenue, all-time raw expenses |
| F45 Budget actuals lifetime | **STILL PRESENT ⇒ L25** | wiring-medium 1246: Σ all expense rows, no window |
| F126 Scenario never FX-converted | PARTIAL (by design) | MRR/ARR converted; scenario stays native (labelled native, index.html 8728) |
| F129 literal '$' | PARTIAL ⇒ **L29** | updateReconSummary (app-main 1138), timesheet rate (wiring-extra 133) |
| F92 side-effect money writes | PARTIAL (= F90 structural) | recalc writers audit-log; no single audited write path — deferred |
| F32-residual | FIXED in code | cash-flow inflow = invoice_payments + receipts; legacy row = data (owner) |
| F51 placeholder surfaces | PARTIAL | in-app fixed; landing.html:368 still claims "750+ App integrations" (~17 real) ⇒ Owner Handoff (marketing copy); tax estimate falls back to a flat 25% when no rate saved (server 6730) ⇒ **L28** |
| F65 fake-success controls | FIXED | all 9 sites removed or made honest |
| F94 scheduled state | FIXED | `_isScheduled` badges + Scheduled Documents tab |
| F52 form a11y | PARTIAL | 5 unlabeled inputs + 54 id-without-label ⇒ Phase 2.5 / post-launch |
| F63 / F68 | FIXED | `_ffDashWrapped`; sw.js + maskable icon |
| F109 close-position | STILL PRESENT (feature) | owner-gated feature, not a defect |
| F116 server today on login | FIXED; register gap ⇒ **L30** | doRegister (app-main 806) never sets `_serverToday`; /register returns no `today` |
| F54 / F111 team scope + visibility | FIXED | scopeId everywhere; /api/my-access + scoped banner |
| F107 | PARTIAL ⇒ **L31** | membership create/accept/change/remove not audit-logged (server 5160–5520) |
| F108 jurisdiction | PARTIAL (design) | country required + validated; no region / uniqueness key — owner |
| F149 per-entity profile | PARTIAL (design) | rename bug fixed; fiscal_year + industry still per account — Rule 10 "under investigation" class, owner |
| F30 permissions matrix | STILL PRESENT (orphaned) | /api/permissions stored, never enforced, no UI caller; UI says "coming soon" — harmless, log only |
| F19 DB TLS | PARTIAL (env) | verified only if DATABASE_CA_CERT set ⇒ Owner Handoff |
| F26-b NULL-entity receipts | STILL PRESENT (data) | owner-gated backfill (Rule 8) ⇒ Owner Handoff |
| F75 dead-code shadowing | STILL PRESENT (27 = 20 replace + 7 wrap), no guard ⇒ **L27** | structural allowlist guard so a NEW shadow cannot land silently |
| F77 stub golden master | PARTIAL | step2-gate rejects 'final' on real PG (23514); the stub file still exits 0 — label/retire |
| F110 clock↔seed pin | FIXED (guard) | clock.js 94–107 |
| F81 VERIFICATION counts | PARTIAL | Part B says ~22, sections sum to 23 ⇒ fixed with L26 doc pass |
| F83 harness exit codes | PARTIAL ⇒ **L32** | unconditional `exitCode = 0`: verify-c1-payroll-pilot:145, verify-f102-payroll-boot:161, tz-matrix catch:187 |
| F105 process | STILL PRESENT (process) | no anchor-collision check; ledger was untracked — L26 restores it |
| H1 pre-commit from index | FIXED in code, **NOT IN EFFECT ⇒ L26** | `.githooks/pre-commit` is mode 100644 ⇒ git skips it; bundle/verification-sync guards never ran |


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
- **D8 — Customer revenue attribution (L17).** Invoices carry the client as free text, so a customer's lifetime
  revenue = Σ recognised invoices (issued ≤ today) whose `client` matches the customer's full name, else its
  company; an invoice is attributed ONCE (shared company ⇒ lowest customer id). Stored typed values are left in
  the database untouched (Rule 8) and no longer read or written. A real customer↔invoice foreign key is the
  long-term model (Owner Handoff).
- **D9 — Third-party page assets are vendored (L22).** Rather than widen the CSP to the jsDelivr CDN for styles and
  fonts, the asset is served same-origin (the precedent set by jsPDF / Chart.js in /vendor), and the CSP gains only
  `'self'` for `style-src` / `font-src`. No SRI on same-origin files (it guards third-party hosts, and a truncated
  digest is what broke these two pages).
- **D10 — Budget actuals period (L25).** Targets are stored annual, so actuals are the current FISCAL YEAR (the
  dashboard's Year window) per category, using the D3 category list — a target named "Payroll" or "Bills & vendors"
  tracks those legs. Monthly budget views are a feature, not this fix.
- **D11 — Investments-on-ledger: DRAFT design, NOT built (2.2 — owner decides).** Today business holdings are
  tracking-only (no GL effect; personal holdings, entity_id NULL, stay off the books regardless). If approved:
  (a) new system account **1300 Investments (asset)** and **7100 Investment gain/loss** (income-type, outside opex and
  outside netProfit like 7000 FX, so the P&L read-swap gate is untouched); (b) BUY (holding created or shares added)
  ⇒ Dr 1300 / Cr 1000 Cash at cost (shares × cost_per) on the purchase date — this needs a purchase DATE, which
  holdings do not store (created_at would be an instant ⇒ Rule 10 entity-zone resolution); (c) SELL / close position
  (does not exist — audit F109) ⇒ Dr 1000 proceeds / Cr 1300 cost basis (FIFO, like inventory) / Cr|Dr 7100 realised
  gain; (d) unrealised gain is NOT posted (no mark-to-market journal; shown as a memo on the balance sheet), which keeps
  the GL independent of a live price feed; (e) DELETE of a holding = reversal of its BUY, never a silent drop; (f) the
  backfill gets a step 13 with the same keys ('holding_buy:<id>'), and a reconcile harness (GL 1300 == Σ open cost
  basis) is the gate. Open owner questions: post at all? cost basis method (FIFO vs average)? does a purchase move
  Cash (it does in reality — today's books would then show a cash drop they never showed before)?
- **D12 — 2.4 client keyset pagination: DEFERRED.** The client's money features read the full `_realInvoices` /
  `_realExpenses` arrays (revenue, AR, every page total, the shared breakdown, exports). Paging those lists changes
  what every client-side figure sees; the Phase-1 parity harnesses would have to prove every surface still ties.
  Risk > gain before launch (the plan's own exit clause). Server side remains ready (`db.pageByUser`).
- **D13 — 2.5 mobile performance: no change this run.** No Lighthouse/mobile measurement tooling here and the plan
  forbids un-measured "wins"; the SLIM build (lazy screens, L21) is already the production path.
- **D14 — 2.6 defense-in-depth: owner decision, recorded only** (CSP `unsafe-inline` drop / RLS / Sentry DSN /
  express 5) — scope and risk in LAUNCH_STATUS §2 and HANDOVER; nothing implemented blind.
- **D15 — Reminders "Outstanding" card (L35 Root 2).** The owner's expected value is the netted AR ($13,550), which is
  not a sum of the listed reminder candidates. The card therefore shows the canonical `computeBooks.outstanding`
  (`summary.ar_outstanding`) and is relabelled "All open invoices, net of credits"; the list sum stays in the API
  as `summary.total_outstanding`.
- **D16 — Balance sheet = control accounts; Outstanding = subledger (L6b).** A manual journal to AR / AP is a
  control-account adjustment with no customer / invoice behind it, so it moves the balance-sheet AR / AP / Inventory
  lines (and the gate on both sides) but NOT the invoice-subledger figures — dashboard "Outstanding", overdue (L35
  clamp), the AP card, the client `arOutstanding` mirror. The difference between BS AR and Outstanding is exactly the
  posted journal AR leg.
- **D4 — Commit trailer.** The plan's template says `Claude Opus 4.8`; commits use the attribution of the
  model actually running this session (accuracy over copying a stale template).
