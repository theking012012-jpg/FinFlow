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

## Findings Ledger (numbered; newest last)
- (open) renderInvestments null-textContent boot error — Phase 1.3.
- (open) `APP_URL`/dab1 dead-domain audit — Phase 1.4.

## Decisions (irreversible-safe choices the agent made)
- (none yet)
