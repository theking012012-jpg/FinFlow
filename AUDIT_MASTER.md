# FinFlow — Master Audit

**Rewritten:** 22 July 2026 · full site-wide re-audit against the code at `f27166d`
**Supersedes:** every prior status in `AUDIT_MASTER_ARCHIVE_2026-07-22.md` (the previous 134 KB document, kept for its fix narratives — do **not** trust its statuses).
**Method:** every row below was re-verified by reading the shipped code, not by trusting a prior row. Where a root cause is uncertain, it says so.
**Provenance:** see [Audit pass log](#audit-pass-log) at the foot of this file — what was read, what was *not* covered, and the reproducible greps behind every count.

---

## 📍 THIS FILE IS A LEDGER, NOT A PROOF OF CORRECTNESS

**Correctness is established by [`VERIFICATION.md`](VERIFICATION.md), not by this document.**

`AUDIT_MASTER.md` records what someone happened to *notice* — findings, root causes, decisions, fix history. It is inherently a sampling method: audit by reading twice and you get two different lists. It can never state that a figure is *correct*, only that no one has reported it wrong. Every defect that actually cost production time here (the payroll double-count, the load-order-dependent KPI, the decoupled breakdown labels, the ignored status filter) was **behavioural** — invisible in source at any depth of reading.

`VERIFICATION.md` is the finite counterpart: every figure the app displays and every mutating action it performs, each asserted against an **owner-supplied expected value** on a real seeded database. It does not grow while work is in progress.

**Done = every check in `VERIFICATION.md` green.** Anything not on that list is explicitly *unverified* — not assumed correct. A ✅ row in this file means "this finding was addressed and verified as described in its row"; it does **not** mean the surrounding figure is proven right.

Working rules for changing this codebase live in [`CLAUDE.md`](CLAUDE.md) — the three failure modes and twelve rules, each traced to a defect that already shipped here. Read it before touching anything.

---

## ⛔ STANDING RULE — TICK-OFF DISCIPLINE (mandatory, from now on)

> **Every fix that is completed and verified MUST be ticked off in this file in the very next prompt/commit — not later, not batched.**
>
> A fix is not done until its row carries all four of:
> 1. **✅ status**
> 2. **commit hash**
> 3. **what changed** (mechanism, not a restatement of the problem)
> 4. **how it was verified** (the actual check that was run)
>
> **No exceptions. Any work reported as complete without its row ticked is treated as NOT DONE.**
>
> Corollary, learned the hard way from F37 and F50: if a fix covers *part* of a class, the row says **PARTIAL** and lists what is left. "✅ FIXED" on a partial sweep is how this document became untrustworthy.

---

## ⚙️ LOAD-BEARING INFRASTRUCTURE CONFIG — do not "clean up"

Configuration whose current value is deliberate and whose removal would break something with no obvious cause. Recorded because none of this is reconstructable from memory, and the failure would surface months later at deploy time, not at edit time.

### `nixpacks.toml` → `npm install --production` is LOAD-BEARING (2026-07-23)

```toml
[phases.install]
cmds = ["npm install --production"]
```

**Why it must stay `--production`.** The test harness added `embedded-postgres` (a real PostgreSQL 17.10 binary, ~tens of MB per platform) as a **devDependency**. `--production` (≡ `--omit=dev`) means Railway never installs devDependencies, so `embedded-postgres` and its `@embedded-postgres/*` platform packages are **not fetched on deploy at all**.

**What breaks if someone drops the flag** (or adds a build step that installs devDeps, or an npm version changes the default): Railway's build would resolve the `@embedded-postgres/linux-x64` optional dependency and pull its tarball — a bundled Linux Postgres binary. It would **not fail the build** and would **not error** — it would silently add a large binary to every deploy image and lengthen every build, with nothing pointing at the cause. A future engineer debugging slow deploys would have no reason to suspect a test dependency.

**The two things that together keep it safe — both must hold:**
1. `embedded-postgres` stays in `devDependencies`, never `dependencies` (check `package.json`).
2. `nixpacks.toml` keeps `--production`.

Neither alone is a guarantee people would question in review; the pairing is the guard. If you ever need the harness to run *on* Railway (it should not — Rule 3: scratch only, never near production infra), that is a separate, deliberate decision, not a side effect of dropping a flag.

*(The binary itself ships inside the platform tarball — there is no postinstall network download; the platform `postinstall` only hydrates symlinks. So the risk is image bloat and build time, not a failed fetch. Still worth preventing.)*

---

## 📐 STANDING DECISIONS

Decisions recorded **as decisions**, not as history. Each is dated at the point it was made and states the intended shape so it cannot be re-litigated or half-built later. A decision here is **not** a claim that anything is implemented — implementation status is tracked by its finding row.

### D1 · Business taxation — SELF-INPUTTED ESTIMATOR (decided 2026-07-23)

**FinFlow performs NO tax calculation.** Business taxation follows the identical principle already applied to payroll in **F8** (`469fd1a`, which removed the multi-jurisdiction payroll tax engine and replaced it with user-defined deduction rows).

The intended shape:
- **The owner supplies their own rate.** No jurisdiction logic, no bracket tables, no rate inference. FinFlow holds no tax knowledge and must never appear to.
- **The app projects an estimate off the canonical F32 accrual basis** — the same issue-based revenue every other figure uses. Not paid-only, not a second basis.
- **No tax payment tracking exists.** There is no tax-payment record type and none is planned under this decision. Any "tax paid / YTD" figure therefore has **no source** and must render as *"Not tracked"* — never a computed, inferred or fabricated number. (The prior `ytdPaid = liability × 0.75` fabrication was removed under **PL#11**.)
- **Filing is out of scope.** No submission, no forms, no deadlines-as-obligations.

**Implementation is DEFERRED.** This records the target so a future session cannot (a) rebuild a taxation engine, (b) re-derive a different basis, or (c) ship a half-estimator. The current `GET /api/tax-filing` does **not** implement this decision — see **F76**.

**Scope note:** which taxes a combined estimate would even cover (corporation tax, VAT, PAYE, NIS — separate obligations on different periods) remains an **open owner question**, deferred with the implementation. One combined figure may not be useful; splitting is a feature, not a fix.

> **Explicitly not recorded as history:** an earlier session was *believed* to have made this decision, but a search of `AUDIT_MASTER.md`, the archive, `PRE_LAUNCH_FIX_PLAN.md` and the full git log found **no record of it**. Rather than reconstruct an undocumented decision as though it had been minuted, it is recorded here as a decision **made on 2026-07-23**.

### D2 · Future-dated documents are NOT recognised until their date arrives (decided 2026-07-23)

**A future-dated invoice, bill or expense contributes ZERO to every figure — including Year — until its own date is reached.** (Moved here from open finding F93 on the owner's ruling.)

**Rationale.** The basis is accrual, **ISSUE-BASED** (F32 / Rule 11). Revenue is recognised when an invoice is *issued*; a document dated in the future has not been issued, it is **scheduled**. The same applies to bills on the expense side. Beyond the accounting principle there is an integrity one: if future-dated documents were recognised, anyone could inflate a current period by post-dating, which an accounting product must not permit.

**Three consequences — to check and log, NOT to fix now:**

**(a) The app currently ALLOWS future dates, with no bound and no scheduled state.** Verified read-only 2026-07-23:
- `POST /api/invoices` (`server.js:878`), `/api/expenses` (`:925`), `/api/bills` (`:2019`) apply **no upper-bound date validation** — only `isLocked`, which guards the *past*. A row dated 2027 inserts cleanly.
- Client: **zero `max=` attributes** across all 21 `type="date"` inputs (`public/index.html`) — `inv-issue`, `bill-issue`, `exp-date` included.
- So implementing D2 will make future-dated documents **disappear from every figure**. Without a visible **SCHEDULED** state they will look deleted, and a user who post-dated an invoice will report it as a data-loss bug. **The scheduled state is part of the fix, not a later nicety** — logged as **F94**.

**(b) "Future" relative to WHOSE clock — this decision is not safely implementable until period resolution is server-side.** Under F87 "now" is currently the **viewer's** browser clock, so the same document could be scheduled for a New York reader and recognised for a London one. A recognition boundary that depends on the reader is exactly the F87 defect. **D2 therefore has a hard dependency on F88/2i** (server-resolved windows, entity-scoped) and on F89 (the boundary must not come from an untrusted client clock). Sequenced into the same structural batch; implementing D2 before that batch would bake viewer-dependence into the recognition cutoff itself.

**(c) A Part A check is required and the seed needs a future-dated row.** The current seed has no future-dated document, so this decision is **untested**. Added as check **A9** in `VERIFICATION.md`; the seed row (a future-dated invoice after the pinned clock but inside FY2026) is folded into the held seed revision and re-derived there. Expected: it contributes **0** to Month, Quarter **and** Year, and to AR — so a green A9 requires the correct behaviour, and the current code (which recognises it) will **FAIL** A9 until D2 is built.

---

## ⬜ OPEN DECISIONS — awaiting an owner ruling

**Why this section exists.** A ledger with only one shape — "finding" — forces everything else
to be homeless, and homeless items stay in chat. A reconciliation on 2026-07-23 found five items
living only in conversation; every one of them was a *class*, a *limitation*, a *plan* or an
*open question* — never a finding. Those shapes now have rows, so having nowhere to write
something is the exception rather than the norm.

**An open decision is not a finding.** Nothing is broken; a choice has not been made. The danger
is different and quieter: while it stays open, **the code's current behaviour silently becomes
the decision**, and nobody ever ruled on it.

| # | Decision needed | Blocks | Default if unruled |
|---|---|---|---|
| **F86** | Does A7.4 "Payments Received" mean `invoice_payments` (settlements) or `payments_received` (the page's own table)? | A7.4, and possibly Cash Flow cash-in A7.9–11 | the seed's current choice, unexamined |
| **D1 scope** | Which taxes a combined figure would cover (corporation tax, VAT, PAYE, NIS) | the D1 implementation | — |
| **F90 sequencing** | Audit trail before launch, as rated? | launch order | — |

*(F93 — future-dated recognition — decided 2026-07-23, now **STANDING DECISION D2**. F91 seed revision — Apr rows + INV-6 — **approved and applied 2026-07-23**.)*

---

## ⚠️ KNOWN LIMITATIONS — true, accepted, and not going to be fixed today

**Why this section exists.** Same reconciliation. A limitation is not a defect in the product —
it is a **boundary on what a green run proves**. Recording it is what stops a passing check being
read as stronger evidence than it is, which is the failure `VERIFICATION.md` exists to prevent.

| # | Limitation | What a green result does NOT prove |
|---|---|---|
| **F91** | **Q3 == Jul on all six figures** — Aug/Sep are future (D2), so Q3 legitimately holds only July. (Q2-vs-Jun maskers were FIXED by the Apr rows.) | that a quarter with later-month activity aggregates correctly — but Q2 now tests that. Q3==Jul is correct here, and load-bearing for A9.2 |
| **F83** | The harness exits 0 even when checks fail | nothing about CI; a red run and a green run are indistinguishable to any automated caller |
| **Seed via SQL** | The seed is written by direct SQL, not the POST endpoints (forced by `run_date = NOW()`, F85) | that invoice/expense/bill **creation** works — the seed exercises the schema, not the write paths |
| **A1.13–15** | Investments asserts `shares × stored price`; production overwrites with live quotes before painting | that live price refresh works |
| **A8 vs date-only seed** | A date-only seed cannot detect viewer dependence — all viewers are wrong identically | timezone independence, unless a row sits inside the inter-viewer gap |
| **Part B drift** | Eight Part B checks are BLOCKED at a month boundary (F85/`run_date = NOW()`) | those behaviours, on any run where the tripwire fires |

---

## 🚨 LAUNCH BLOCKERS

One week to launch. This list is deliberately short and deliberately not padded. Each item is here because a paying user hits it in normal use, or because it puts a wrong number on screen.

| # | Blocker | Why it blocks | Est. |
|---|---|---|---|
| ~~**B1**~~ | ✅ **DONE** `e1a8f3e` — **F55** Dashboard KPIs never repainted after a save or delete | harness 16/16; owner live-check outstanding | ~~15 min~~ |
| **B2** | **F64** — every money figure ≥ $1,000 renders abbreviated to 1 decimal (`$1.2K`), including itemized invoice/expense/bill rows; sub-$1K rounds to whole dollars; the "Show cents" setting does nothing | An accounting product that will not show you the exact amount of an invoice is not an accounting product. | 2–3 h |
| **B3** | ✅ **F56 DONE** `0756960` (5 AR surfaces unified) · **F57 still open** — Cash Flow page uses a different basis from the Dashboard | Two adjacent screens show different numbers for the same thing. | ~2 h left |
| **B11** | **F71** — payroll accrues with no effective dating: today's roster is applied retroactively to every past month | Owner-surfaced. Adding an employee today silently changes last January's expenses. **Needs an owner ruling on the basis before coding.** | 0.5 d |
| **B4** | **F58** — credit notes and vendor credits are never applied as contra | Revenue and AP are **overstated** by the full value of every credit note issued. Wrong money, silently. | 4–6 h |
| ~~**B5**~~ | ✅ **DONE** `57ca8b2` — **F60** rolling-vs-fiscal axis mismatch + fabricated Rent, **F61** period-blind bars (+ a stale-row bug found in the same code) | harness 13/13; owner live-check outstanding | ~~1–2 h~~ |
| ~~**B6**~~ | ✅ **DONE** `f36ca7b` — **F62** 9 server GETs fabricated empty results on failure, **F67** client turned failed fetches into empty arrays | harness 42/42; class **C7 closed**; owner live-check outstanding | ~~2–3 h~~ |
| ~~**B7**~~ | ✅ **DONE** `c9d2d16` — **F59** silent FX failure left native money under a foreign label, **+ F70** (found during the fix) 2 of 3 currency controls stamped the *previous* symbol on converted figures | harness 20/20; owner live-check outstanding | ~~30 min~~ |
| ~~**B8**~~ | ✅ **DONE** `532390b` — dedupe guards on the money-bearing create routes. ⚠️ **The audit's list was wrong twice** — see the C1 row | harness 34/34; owner live-check outstanding | ~~2 h~~ |
| **B9** | **F54** — team-member data scope is incoherent: reads and creates are actor-scoped, updates/deletes on 9 tables are account-scoped | An invited member logs in to an **empty app**, and everything they create is invisible to the owner. **Alternative that also unblocks: disable team invites for launch** (hide the invite UI, 403 the route). | 1 d, or 30 min to disable |
| ~~**B12**~~ | ✅ **DONE** `bb50d2f` — **F130** an expired trial rendered as a broken app ("Unable to load" on every card, no explanation, no way to pay) | Every trial user reaches this state by definition; it is the moment they decide whether to pay. Probe 21/21; owner visual check outstanding. **Read-only-vs-hard-lock still an open owner decision.** | ~~1–2 h~~ |
| **B10** | **F51 + F65** — honesty pass: 5 placeholder surfaces presented as live features, a "750+ integrations" marketplace banner, and 8 buttons that report a completed action with no backend | Refund/chargeback and trust risk. This is a labelling and button-removal pass, not engineering. | 3–4 h |

**Total blocker estimate: ~3 working days** (or ~2 if team invites are disabled rather than fixed).

### Explicitly NOT blockers — ship after launch
F25, F26 (legacy backfill), F30, F32 residual, F33-companion, F39, F40, F41, F44, F45, F47, F52, F61, F63, F66, F68, F69, class C2 (native dialogs), class C3 (timezone — see caveat below), class C6 (silent catch), PL#5, PL#8, PL#10-recurring.

> **Timezone caveat.** Class C3 is *not* a blocker but it is the one non-blocker most likely to produce a support ticket in week one: 15 server-side record-date defaults stamp **UTC**, so a user at a negative UTC offset recording an expense after ~20:00 local gets **tomorrow's** date, which lands the row in the wrong month at month-end. If there is spare time after the blockers, do the 15 server sites first.

---

## Phase 1 — Reconciliation: what changed in this pass

The previous document was stale in both directions. Summary of every correction:

### Rows that claimed OPEN but had shipped → corrected to FIXED
| Row | Old claim | Verified reality |
|---|---|---|
| **F33** | "CRITICAL OPEN" | **Core FIXED.** One canonical `_periodWindow` (`app-main.js:1693`) feeds both client engines and the server via `?start&end&elapsedMonths` (`server.js:3205-3212`). Commits `d39aed4`, `146019c`. One companion still open — now split out as **F33-C**. |
| **F34** | "Step 1 in progress / A + B pending" | **Path B COMPLETE in code.** Server core `063c98c`/`71a5f24`; all 4 client surfaces present and verified: KPIs (`app-main.js:4383`), chart (`4434`), breakdown (`4451`), transactions (`4465`), investments (`4425`). Native = identity by construction. **New defect on the failure path → F59.** |
| **F48** | "pending approval" | **FIXED.** `98ec1a6` (scope/ownership/overpayment guards) + `d60ecea` (AR = `Σ max(0, amount − amount_paid)`, `server.js:4110-4114`). Verified in code. |
| **F50** | "reopened" | **RE-FIXED** `c16ee28`. Memo un-latch + `_ffEnsureCompleteBoot` + PWA refresh net, all present in `index.html:3630-3740`. |
| **F53** | (already ticked) | **Confirmed closed.** Single `_fmtMoney` (`app-main.js:548`); grep confirms **zero** surviving K-only formatters. But it exposes **F64**. |
| **PL#3** | "partial" | **FIXED** `64eb95c` — `ENTITY_LIMITS` + 402 at `server.js:811-815`. |
| **PL#4** | "open" | **FIXED** `7be0a1d` — page reads `/api/audit-log` (`index.html:4366`). |
| **PL#11** | "open" | **FIXED** `7be0a1d` — `calcAndRenderTax` deleted; no fabrication remains in the client. |
| **F46** | (already ticked) | **Confirmed** — allowlist at `server.js:3094-3095`. |
| **F4** | (already ticked) | **Confirmed** — error handler is at `server.js:4618`, after the last route (`4608`). |

### Rows that claimed FIXED but are not → REOPENED
| Row | Old claim | Verified reality |
|---|---|---|
| **F37** | "✅ FIXED — live-verified" | **REOPENED as PARTIAL.** The sweep touched **`app-main.js` only** (8 sites). **35 UTC record-date sites remain**: 15 server-side, 20 in 9 other client files. Full instance list under class **C3**. This is the exact failure mode the standing rule now forbids. |
| **F26** | "partial" (accurate) | Confirmed still partial — `computeBooks` still reads `sales_receipts` **user-scoped, not entity-scoped** (`server.js:3919`), and legacy rows are still unbackfilled. |
| **F31** | "✅ FIXED" | **Correct for the 3 report routes it covered**, but the class was never swept — **9 more routes still fabricate empty/zero on failure** (→ **F62**). Row narrowed, class opened. |

### Rows confirmed still open, unchanged
F25, F30, F32 (residual `/api/cashflow` reconciliation + Store A row), F33-C, F39 (fixed for invoices), F40, F41, F44, F45, F47, F51, F52, PL#5, PL#8, PL#10, PL#12–15.

### Claims from the old doc that this audit **downgraded or withdrew**
- **"46 appendChild sites — render append vs clear-before-paint."** **Withdrawn as a class.** All 49 `appendChild` sites were read. Every repeat-render site clears first (`c.innerHTML=''` at `index.html:2346`, `catalog.innerHTML=''` at `2377`) or is a run-once injection guarded by `if(!modal)` / an IIFE. **No duplicate-append defect exists.** Two `<select>` option-fill IIFEs (`index.html:5387`) run once at load and are fine.
- **"53 confirm()/alert() sites across 8 files."** Undercount. Actual: **68 sites across 12 files** (40 `confirm`, 28 `alert`). Full list under **C2**.
- **"14 timezone sites."** That was the **server-only** count. Actual total: **35 defect sites** (+ 6 benign formatters correctly left UTC).
- **"58 client save/add handlers, 9 guarded."** Verified in spirit. Precise: **88 client POST call sites** in the main app across 11 files; **9** carry a disable-on-submit guard.
- **"F33 companion: Investments $35.1M is a display bug."** Confirmed correct and closed by F53.

---

## Phase 2 — Class register

A class is only a class if it has a full instance list. Each has one.

### C1 — Duplicate-submit — 🟠 **PARTIAL** — durable DB-level fix DONE for `payroll_runs` (pilot); interim heuristic still backs the other money routes; ~29-route rollout + client token OPEN

> **STATUS — four states (2026-07-25). PARTIAL per the tick-off corollary: a fix covering part of a class says PARTIAL and lists what's left. C1 stays the single home for the double-submit class — no new F-number.**
>
> 1. **Interim heuristic (in place).** `findRecentDuplicate` / `findRecentDuplicateTyped` (`532390b`, 2026-07-22) — the 5s-window pre-check backs the money create routes. Non-atomic (see the 2026-07-24 UPDATE below): a fast-path, not a guarantee.
> 2. **Durable DB-level fix — ✅ DONE, `payroll_runs` PILOT ONLY.**
>    - **Commits:** graceful 23505 handler `577b280`; the UNIQUE index `idx_payroll_runs_uniq` applied as a **one-shot production migration on 2026-07-25** by the owner via the Supabase SQL editor (recorded in `scripts/migrations/2026-07-25-payroll-runs-uniq.sql`) — deliberately NOT in `initDB` (a failed unique build inside the transactional initDB would ROLLBACK and brick boot).
>    - **What changed:** the UNIQUE index on `(user_id, COALESCE(entity_id,0), period)` is the un-bypassable guarantee (`COALESCE` so NULL-entity dups collide); the 23505 handler returns the existing run idempotently (200, never 500 / never orphan lines); the racy pre-check at `server.js:3844` stays as the fast path.
>    - **How verified:** `tests/harness/verify-c1-payroll-pilot.js` on scratch — `Promise.all` race → ONE row; raw-insert control → 2nd rejected 23505; NULL-entity → COALESCE rejects (8/8 + control). Plus production: pre-check returned zero rows; index confirmed via `pg_indexes`.
>    - **NOT executed (UNEXECUTED):** a behavioural double-submit against production — no test payroll was written to prod. The prod guarantee rests on the index (confirmed present) + the scratch behavioural proof.
> 3. **Durable rollout across the remaining create routes — OPEN (full per-table plan; keys confirmed against source this session).**
>    - **Wave 1 — hard UNIQUE constraint (ship now, the payroll one-shot pattern). Each index needs a live-data `GROUP BY <key> HAVING COUNT(*)>1` pre-check first; owner-gated reconcile if dirty.**
>      - `payroll_runs` — `(user_id, COALESCE(entity_id,0), period)` — ✅ DONE (this session).
>      - `holdings` — `(user_id, COALESCE(entity_id,0), ticker)`; 23505 → blend/upsert into the existing lot.
>      - `autocat_rules` — `(user_id, keyword, match_type)`; 23505 → reject-and-edit.
>      - `team_members` — `(user_id, lower(email))`.
>      - `chart_of_accounts` — `(user_id, COALESCE(entity_id,0), code)`.
>      - `fx_rates` — `(user_id, from_currency, to_currency, rate_date)` (already has an inline typed guard; the constraint makes it un-bypassable).
>      - `budget_targets` — `(user_id, COALESCE(entity_id,0))` — already an upsert; the constraint closes its first-write TOCTOU.
>    - **Wave 1b — `entities`** — hard UNIQUE `(user_id, lower(name), jurisdiction)`, GATED on the jurisdiction attribute (**F108**).
>    - **Already safe (no constraint needed):** `snapshots` (period-key upsert), `fx_transactions` (inline typed guard), `connections` (upsert).
>    - **Wave 2 — idempotency TOKEN (blocked on token infra; the ONE shared mechanism, applied to every remaining create route).** Priority first (compounding): `recurring_invoices` / `recurring_bills` / `recurring_personal_transactions`. Then: invoices, expenses, bills, invoice_payments, payments_made, payments_received, sales_receipts, credit_notes, vendor_credits, inventory_movements, inventory/items, restock, customers, vendors, quotes, projects, timesheet, journals, goals, personal_transactions, personal_accounts, banking, bank-reconciliation/match, documents, templates, payroll (roster), accountant-messages. **Verified this session:** no create route outside Wave 1 has a clean natural key (vendors/quotes/inventory/personal_accounts checked — name-only, no reliable key), so none was wrongly dropped into token.
>    - **PREREQUISITE for all of Wave 2:** build token infra — server `idempotency_key` column + persistence + partial UNIQUE index (the client already mints/sends the token, state 4). This one build unblocks the entire wave.
> 4. **Client idempotency token (`public/index.html`) — HELD / deferred, currently INERT.** The submit handler mints+sends `idempotency_key`, but the server has no `idempotency_key` column, so the token is dropped — it becomes operative only when the token column + partial unique index + server persistence ship (part of the token-table rollout, state 3).
>
> **Harness reconciliation owed:** `tests/harness/seed.js` seeds two `2026-07` runs (R2 draft + R3 paid) — same `(user_id, entity_id, period)` — which VIOLATE the new key. The harness seed must be reconciled (move them to distinct periods, update `expected.js`) before the index is ever adopted in `initDB` / the shared seed.

> **⚠️ UPDATE 2026-07-24 — the "CLOSED for money" claim is CONTRADICTED for `payroll_runs`: production has duplicate runs across MULTIPLE periods. The guard is a non-atomic race, not a real dedup.**
>
> **Mechanism (read-only code analysis, no DB access needed).** `POST /api/payroll-runs` is a check-then-insert with NO transaction, lock, or unique constraint:
> - `findRecentDuplicateTyped('payroll_runs', uid, eid, {period})` is a plain `SELECT` (`server.js:3844`, def `:821`), followed by a separate `INSERT` (`server.js:3863`). Both are `await`ed with nothing around them.
> - So two near-simultaneous POSTs (a real double-fire) interleave: A's SELECT and B's SELECT both run **before either INSERT is visible** → both see "no recent dup" → both INSERT. Classic TOCTOU. The 5-second window is irrelevant to the concurrent case; it only ever helped slow-sequential clicks, and a resubmit >5s apart defeats even that (Rule 9's "slow double-submit").
> - **No `UNIQUE(user_id, entity_id, period)`** exists on `payroll_runs` (`database.js:385`) to catch the second insert at the write — nothing backstops the race.
> - Separately, the run INSERT (`:3863`) and its line INSERTs (`:3869`) are not in one transaction — a crash between leaves a run with partial/no lines, which can make a run look "different" in a cleanup diff when it is really a torn write.
>
> **Which mode produced the EXISTING rows** is decided by each duplicate pair's `created_at` delta: `< 5s` ⇒ the TOCTOU race fired (in-window and still missed — a guard BUG); `> 5s` ⇒ window too short (guard INSUFFICIENT). Both modes are live regardless of which one fired.
>
> **Consequence for the cleanup:** deleting the duplicates does NOT stop recurrence — the next Run Payroll click can double-fire identically. Per **Rule 9** the fix is idempotency at the WRITE, but the mechanism is an owner decision and is **not designed or built here**: a hard `UNIQUE(user_id,entity_id,period)` would also forbid a legitimate correction/second run for a period; an idempotency key, `INSERT ... ON CONFLICT`, or a single-transaction `SELECT ... FOR UPDATE` would not. **Cleanup is safe to perform, but is not durable until the guard is replaced.**

> **⚠️ UPDATE 2026-07-25 — CORRECTED DESIGN + PROVEN PILOT (payroll_runs). Enforcement moves to the DATABASE. SHIPPED for payroll (see STATUS above); token + other routes held.**
>
> **Why not the JS layer.** `db.insert` is NOT the single insert path — 15 routes use raw `pool.query` INSERT, including the pilot itself (`payroll_runs` at `server.js:3864`). A `db.insert` chokepoint would not even cover the route being piloted. The guarantee must live where no code path can bypass it — a **DB UNIQUE constraint**.
>
> **Mechanism (two layers):**
> - **Natural-key tables** → UNIQUE on the business key. payroll_runs = `(user_id, entity_id, period)` (owner ruling: a second run for the same period is never legitimate). DDL, idempotent + NULL-safe: `CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_uniq ON payroll_runs (user_id, COALESCE(entity_id,0), period)`. `COALESCE` is load-bearing — a plain UNIQUE treats NULLs as distinct and would let NULL-entity dups through (proven). Named-constraint alt (PG15+): `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE NULLS NOT DISTINCT (...)` inside a `DO`/`EXCEPTION WHEN duplicate_object` block for idempotency.
> - **Token tables** (identical rows can be legitimate) → an `idempotency_key` column + partial UNIQUE index; the client mints a token at ACTION INTENT (not form-open — that doesn't exist for shortcuts/bulk/API) and REUSES it while the intent is in-flight, so a double-click carries one token (`index.html submitPayrollRun`). payroll gets BOTH (belt-and-suspenders); the token becomes operative when the server persists it at the migration step.
> - **Graceful violation:** on 23505 the handler (`server.js:3864`) returns the EXISTING row (200/201), never a 500. `findRecentDuplicateTyped` stays a fast-path; the DB constraint is the guarantee behind it.
>
> **PROVEN BY EXECUTION** — `tests/harness/verify-c1-payroll-pilot.js` (real server + scratch Postgres): two concurrent identical POSTs → exactly ONE run (+2 lines, both 2xx, same id); two different periods → TWO runs; 23505 → existing row. **Rule-14 control (no index):** the raw duplicate is ACCEPTED → two rows, deterministically proving the constraint is what closes the gap (the endpoint race is timing-dependent on localhost → reported, not asserted). 8/8 with the index; control green.
>
> **Scope:** ~30 mutating create routes; payroll_runs is the proven pilot. Per-table natural-key-vs-token classification drafted; **ROLLOUT PENDING the owner's per-table duplicate-semantics rulings** (customers, vendors, items, chart_of_accounts, entities, budget_targets, autocat_rules still need a ruling).
>
> **Shipped vs held (2026-07-25):** SHIPPED for payroll — 23505 handler `577b280`; `idx_payroll_runs_uniq` applied one-shot to production (NOT added to `initDB` — boot-brick avoided), gated on the zero-duplicate pre-check. STILL HELD: server persistence of the client token (state 4) and the ~29-route rollout (state 3). (F107 cross-account remains its own separate open finding.)
>
> **Numbering note:** the owner referenced this as "F107", but **F107 is already the cross-account visibility defect** (2026-07-24, uncommitted). To avoid the F104-class collision, this design is recorded here under **C1** — its true home. If a standalone number is wanted, the next free is **F108** (not F107).

> **⚠️ TWO CORRECTIONS to this row's original list — recorded because both would have produced a fix that looked right and did nothing.**
>
> **1. The tables split two ways, and the existing matcher only works on one.** `findRecentDuplicate` compares `data->>'field'`, so on a **typed** table it compares against NULL and **can never match**. `invoice_payments`, `payroll_runs`, `inventory_movements`, `fx_transactions` are typed. Adding the JSONB matcher to them — the obvious reading of the original row — would have been a **silent no-op** that passed review. New sibling `findRecentDuplicateTyped` (`server.js:778`) matches real columns.
>
> **2. Two routes on the list were already safe.** `fx-transactions` has had an inline typed guard all along (`server.js:4445`); `snapshots/capture` upserts by `period_key` (`server.js:1231`) so it is idempotent by construction. **The real gap was 5 routes, not 7.**
>
> **Bug caught pre-ship:** `inventory_movements` has **no `created_at` column** — it uses `moved_at`. A hardcoded timestamp column would have thrown **42703 on every movement insert**. `tsCol` is now a parameter, and the harness asserts every guarded column *and* timestamp column against the schema parsed out of `database.js`, so this cannot recur.

**Guards added (5):**
| Route | Model | Match key | Consequence of the duplicate |
|---|---|---|---|
| `POST /api/banking` | JSONB | description + amount | duplicate bank transaction |
| `POST /api/invoice-payments` | typed | invoice_id + amount + payment_date | the overpayment check only caught dupes that pushed **past** the balance — two rapid **partial** payments both fit inside it and both booked |
| `POST /api/payroll-runs` | typed | period | duplicate run **and** duplicate `payroll_run_lines` → doubled gross/net |
| `POST /api/inventory-movements` | typed (`moved_at`) | inventory_id + type + quantity | **worst of the set** — a double-clicked sale consumed FIFO layers twice and permanently corrupted COGS. Guard runs **before** `calculateFIFOCOGS` so a duplicate never touches the ledger |
| `POST /api/inventory/:id/restock` | marker | `last_restock_qty` + `last_restock_at` | not an INSERT (it is `units += qty`), so neither matcher applies; guarded with a marker on the row — `inventory` is JSONB, no migration |

**Verified:** 34/34 — every call site checked column-by-column against the parsed schema; reverse check confirms no JSONB matcher points at a typed table; generated SQL asserted for scoping, window, contiguous parameter numbering, and null-handling that does not shift parameter indices.
**Still to confirm live (owner):** double-click *Record Payment* with a partial amount → one payment row, not two. Double-click a sale movement → COGS unchanged by the second click.

**Still OPEN — the client half.** 88 POST call sites in the main app, **9** with a disable-on-submit guard (`index.html:4836`, `4897`, `6331`, `7348`; `app-main.js:494`, `638`, `677`, `725`, `2635`). Server dedupe is now the backstop for money, so this is post-launch: add one `withSubmitGuard(btn, fn)` helper rather than 88 hand-edits.

<details><summary>Original C1 row</summary>

### C1 — Duplicate-submit ✅ mostly closed, 12 gaps
**Server (Layer 3, `findRecentDuplicate`, `server.js:743`):** **27 create routes guarded** — entities, invoices, expenses, customers, inventory, items, payroll, personal_transactions, personal_accounts, goals, projects, holdings, journals, chart_of_accounts, quotes, vendors, bills, recurring_bills, recurring_personal_transactions, recurring_invoices, sales_receipts, payments_received, credit_notes, payments_made, vendor_credits, timesheet, team_members. `fx_rates` has its own typed-column guard (`server.js:4379`).

**Unguarded create routes — 12** (`⚠️` = writes money):
| # | Route | server.js | Risk |
|---|---|---|---|
| 1 | `POST /api/banking` ⚠️ | 3088 | duplicate bank transaction |
| 2 | `POST /api/invoice-payments` ⚠️ | 3603 | invoice settled twice → wrong AR (overpayment guard only catches a *full* re-pay, not two partials) |
| 3 | `POST /api/payroll-runs` ⚠️ | 3726 | payroll run duplicated |
| 4 | `POST /api/inventory-movements` ⚠️ | 4213 | duplicate sale movement → **corrupt FIFO COGS** |
| 5 | `POST /api/fx-transactions` ⚠️ | 4422 | duplicate FX position |
| 6 | `POST /api/inventory/:id/restock` ⚠️ | 991 | double-click adds quantity twice |
| 7 | `POST /api/snapshots/capture` ⚠️ | 1204 | duplicate snapshot skews MoM delta |
| 8 | `POST /api/documents` | 1642 | duplicate doc |
| 9 | `POST /api/templates` | 1675 | duplicate template |
| 10 | `POST /api/autocat-rules` | 1704 | duplicate rule → double-categorization |
| 11 | `POST /api/accountant-messages` | 2822 | duplicate message |
| 12 | `POST /api/bank-reconciliation/match` | 3668 | duplicate match row |

`POST /api/connections` (3492) is an upsert — idempotent by construction, not a gap.

**Client:** 88 POST call sites in the main app; **9 disable-on-submit guards** — `index.html:4836`, `4897`, `6331`, `7348`; `app-main.js:494`, `638`, `677`, `725`, `2635`.

**Course of action:** (a) **blocker** — add `findRecentDuplicate` to routes 1–7 (money); (b) post-launch — routes 8–12; (c) post-launch — a single `withSubmitGuard(btn, fn)` helper applied across the 88 client sites, rather than 88 hand-edits.
**Done when:** a scripted double-POST (same body, <1 s apart) against each of the 12 routes returns the *same* row id twice, not two rows.
</details>

---

### C2 — Native `confirm()` / `alert()` — 68 sites, 12 files
Blocking browser dialogs. Not wrong, but they break the visual language, cannot be styled, are dismissed by browser "prevent additional dialogs", and on the installed PWA look like a system fault.

**`confirm()` — 40 sites**
- `finflow-api-wiring-pages.js` (10): 120, 201, 290, 381, 463, 559, 722, 805, 894, 976
- `finflow-api-wiring-final5.js` (5): 99, 184, 264, 344, 424
- `finflow-api-wiring-stubs.js` (5): 182, 310, 451, 564, 670
- `index.html` (5): 6243, 6382, 7406, 7422, 7439
- `finflow-api-wiring-medium.js` (4): 187, 314, 501, 984
- `app-main.js` (4): 3015, 3758, 4337, 5190
- `finflow-api-wiring-extra.js` (2): 217, 469
- `accountant-dashboard.html` (2): 817, 848
- `finflow-api-wiring-final.js` (1): 253 · `finflow-api-wiring.js` (1): 267 · `admin.html` (1): 1198

**`alert()` — 28 sites**
- `accountant-register.html` (11): 828, 832, 836, 843, 865, 867, 871, 881, 974, 1017, 1025
- `finflow-api-wiring-final5.js` (10): 88, 95, 173, 180, 253, 260, 333, 340, 413, 420
- `index.html` (5): 7359, 7373, 7384, 7391, 7394
- `app-main.js` (1): 2649 · `finflow-api-wiring-stubs.js` (1): 57

**Course of action:** a promise-based `_confirm()` already exists at `index.html:4853` with a comment saying other sites "can migrate to it later" — do that migration; route every `alert()` to the existing `notify(msg, true)`. Mechanical, one file at a time, regenerate the bundle after each wiring source.
**Done when:** `grep -rn "[^a-zA-Z_.]confirm(\|[^a-zA-Z_.]alert(" public/ --exclude=finflow-bundle.js` returns only the `_confirm` definition.

---

### C3 — Timezone: UTC record dates — 35 defect sites 🔴 F37 REOPENED
`new Date().toISOString().slice(0,10)` yields the **UTC** calendar date. This account runs at a negative UTC offset (verified during the F37 work: `todayLocal()` returned 07-19 while UTC read 07-20). Any record created after ~20:00 local is stamped **tomorrow** — which moves it into the wrong month at a month boundary and therefore into the wrong P&L period.

**Server — 15 sites** (record-date defaults):
`server.js`: 902, 1126, 1209, 1564, 2139, 2178, 2218, 2261, 2322, 2362, 3003, 3102, 3621, 4378 · `accountant-routes.js`: 619

**Client — 20 sites** (default-date inputs, none using the existing `todayLocal()`):
- `finflow-api-wiring-final5.js` (10): 60, 72, 144, 157, 224, 236, 304, 316, 384, 396
- `index.html` (3): 4430, 4571, 4833
- `finflow-api-wiring-medium.js` (2): 285, 703
- `finflow-api-wiring-extra.js`: 26 · `finflow-api-wiring-final.js`: 108 · `finflow-api-wiring-pages.js`: 19 · `finflow-api-wiring-postgres.js`: 60 · `accountant-client.html`: 1202

**Correctly UTC — leave alone (6):** `app-main.js:3203`, `finflow-api-wiring-pages.js:643`, `finflow-api-wiring-medium.js:708`, `server.js:2998` (recurrence-interval formatters), `server.js:3271` (FX rate-as-of lookup), `app-main.js` audit-CSV filename.

**Course of action:** client — export the existing `todayLocal()` (`app-main.js:21`) onto `window` and replace all 20. Server — the server **cannot** know the user's local date; it must **stop defaulting dates at all** and either require the client to send one or store `NULL` (this is already the deliberate pattern for `issue_date`, `server.js:859-862`). Do **not** substitute a server-side timezone guess.
**Done when:** a record created at 21:00 local on the last day of a month appears in that month on the dashboard, the Expenses page and `/api/reports`.

---

### C4 — Money formatters ✅ CLOSED (K→M→B), but see F64
Single `_fmtMoney(value, symbol)` at `app-main.js:548` handles K/M/B, sign, zero and caller-supplied symbol. All five formatters delegate: `window.S` (570), `SP` (2790), `SPfrom` (2801), `S2` (3885), `S2b` (`index.html:6513`), plus 12 direct `window._fmtMoney` call sites in `index.html`. **Grep confirms zero surviving K-only or 2-decimal-M sites.** Class closed. The *behaviour* of that single formatter is now **F64** (blocker).

---

### C5 — Free-text inputs with no validation — 17 sites
| Field | Sites | server.js |
|---|---|---|
| **currency** (no allow-list — any 40-char string becomes an entity's currency, then silently fails every FX lookup) | 8 | 802 (`POST /api/entities`), 822 (`PUT`), 1119 (`POST /api/personal-transactions`), 2057 + 2071 (`recurring-personal-transactions` POST/PUT), 4375 ×2 (`fx-rates` from+to), 4423 (`fx-transactions.foreign_currency`) |
| **ticker** (POST uppercases + caps at 20 but validates no charset; **PUT does neither**) | 2 | 1354, 1362 |
| **email** (validated at 4 sites: 408, 2419, 2470, `accountant-routes.js:201`; **unvalidated** where customers/vendors carry one) | 4 | 946 (`POST /api/customers`), 954 (`PUT /api/customers` — writes raw `b[f]`, no type or length check), 1941 (`POST /api/vendors` — `name`/`contact`/`category` inserted **uncapped**), 1953 (`PUT /api/vendors`) |
| **entity/holding name, category** (capped but unvalidated) | 3 | 802, 973, 1013 |

**Course of action:** one `CURRENCY_CODES` allow-list in `tier-config.js`, applied at all 8 currency sites (400 on miss); `/^[A-Z0-9.\-]{1,20}$/` on ticker at both sites; reuse the existing email regex on the 4 customer/vendor sites; cap `POST /api/vendors` strings the way its own PUT already does.
**Done when:** `POST /api/entities {currency:"NOTACURRENCY"}` → 400, and `PUT /api/customers/:id {email:{}}` → 400.

---

### C6 — Silent `catch(e){}` — 45 sites, classified
Read all 45. **Not** a uniform defect.

**Intentional and correct (33)** — chart teardown (`app-main.js:4583`, `4586`, `4442`), optional-render guards (`3663`, `5887`, `finflow-api.js:115`), `sessionStorage` in private mode (`index.html:71`, `finflow-api.js:68`), rollback-after-error (`server.js:2664`), boot-order tolerance (`app-main.js:1453`), etc.

**Genuine bugs — 6, all "a real failure looks like success or emptiness":**
| Site | Effect |
|---|---|
| `app-main.js:4428` (`_applyConvertedKPIs`) | FX conversion failure → native money under a foreign label → **F59** |
| `finflow-api-wiring-medium.js` `loadExpensesFromDB` catch ("Ignore — not logged in yet") | a 500 is indistinguishable from logged-out; page shows empty |
| `finflow-api-wiring-dashboard.js:485` | boot-time entity fetch failure swallowed |
| `finflow-api-wiring-postgres.js:328-329` | vendor/bill reload failures swallowed |
| `finflow-api-wiring-medium.js:59` | entity-activate failure swallowed → user thinks they switched entity, they didn't |
| `index.html:6321` (`catch(err){ }`) | expense fetch failure swallowed |

**Ambiguous — 6:** `admin-routes.js:584,598`; `accountant-client.html:1181,1401`; `accountant-dashboard.html:1109,1205`. Health-check-shaped; low risk; leave with a comment.

**Course of action:** the 6 bugs each get an explicit failure state (the codebase already has the right pattern — `_dashSetState('error')` in `finflow-api-wiring-dashboard.js:378`). Add a one-line comment to the 33 intentional ones so the next audit doesn't re-flag them.
**Done when:** killing the DB and reloading produces visible "Unable to load · Retry" on every money surface, and **no** `$0`.

---

### C7 — Fail-soft fabrication on server GETs ✅ **CLOSED** (`f36ca7b`, 2026-07-22) — was 9 sites 🔴
All 9 now return 500 + a route-specific message (see **F62**). Verified by a whole-file scan: the only surviving bare-empty response is `server.js:2819` ("no accountant linked"), a legitimate result. **Regression guard:** `grep -n "res.json(\[\])\|res.json({})" server.js` must return exactly that one line.

<details><summary>Original instance list</summary>

| Route | server.js | Returns on error | Money? |
|---|---|---|---|
| `GET /api/holdings` | 1339 | `[]` — comment literally says *"fail-soft: empty list keeps the frontend happy"* | ⚠️ zeroes Investments + Net Worth |
| `GET /api/personal-transactions` | 1115 | `[]` | ⚠️ zeroes personal income/expense |
| `GET /api/vendor-credits` | 2308 | `[]` | ⚠️ |
| `GET /api/goals` | 1243 | `[]` | — |
| `GET /api/projects` | 1281 | `[]` | — |
| `GET /api/recurring-bills` | 2012 | `[]` | — |
| `GET /api/recurring-personal-transactions` | 2053 | `[]` | — |
| `GET /api/scenario` | 3456 | `{}` | — |
| `GET /api/connections` | 3489 | `{}` | — |

**Course of action:** replace each with the F31 pattern already in `/api/cashflow` (`server.js:3185-3188`) — `console.error` + `res.status(500).json({error:…})`. A genuinely empty account already returns real `[]` from the success path; only a thrown error reaches the catch.
**Done when:** renaming a table produces 500 + a visible error state, not silent zeros. → tracked as **F62**.
</details>

---

## Findings — OPEN

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

### H1 🟠 HIGH — pre-commit bundle guard built from the working tree, not the index — could ship unreviewed code — **NEW (2026-07-30, found during F87-batch review)**
**Status:** ✅ **FIXED (this commit)** — proven by execution. **Severity: HIGH.** Live on `main` from the hook's introduction until this commit. **Exposure:** any commit with a dirty or partially-staged wiring source.

The hook regenerated `finflow-bundle.js` from the working tree and staged it. `index.html` loads only the bundle, so the committed bundle is the shipped artifact — unreviewed working-tree code could deploy to Railway while the reviewed source diff looked clean.

Not caught by any gate. The gates test app behaviour; this was a defect in the tooling that assembles what ships. Found during review of the F87 batch, after the `index.html` split on 2026-07-30 turned out to be a partial stage — it missed only because `index.html` is not a bundle source.

**What changed (mechanism).** New `bundle.js --from-index` mode reads each source via `git show :public/<file>` and, if the rebuilt bundle differs from the staged one, writes it into the **index only** (`git hash-object -w --path` + `git update-index --cacheinfo`), leaving the working tree untouched. The hook calls that mode and no longer `git add`s the working-tree bundle. Default and `--check` behaviour unchanged for manual dev use.

**How verified.** `tests/h1-from-index.test.sh` — on a scratch branch it partially stages a wiring source (index = edit1, working tree = edit1+edit2) and commits, then reads the **committed** bundle (`git show HEAD:`): it **FAILS against the old hook** (bundle carries the unstaged edit2) and **PASSES against the fixed hook** (bundle carries only the staged edit1). Both runs executed. The test refuses to run against uncommitted work in the files it manipulates. Gates unchanged: step2 63/0, step3 32/1 (A7.4 pre-existing), step4 18/18 all viewers, tz-matrix identical.

**Class: tooling that mutates the commit after review. Check for others** — anything under `.githooks/` or a build step that rewrites staged content from an unstaged source. Currently only two: this bundle write (now index-sourced) and `verification-sync.js` (read-only `--check`, blocks rather than mutating — correct as written).
**Done when:** committed. ✅

---

### H2 🟠 HIGH — step4-client-gate could not fail — **NEW (2026-07-30) → ✅ FIXED (this commit)**
Check 2 computed per-viewer match counts and only `console.log`'d them; `A()` was never called, so a viewer at 5/18 still printed "ALL GREEN — 1 passed, 0 failed". `process.exitCode` was unconditionally 0. Now one assertion per viewer (naming the viewer and its misses) and a conditional exit code (`fail === 0 ? 0 : 1`). **Proven:** perturbing one shared seed input (July Marketing 250→350) drives check 2 red across all four viewers, names each viewer and miss, and exits non-zero; step4 goes 1 → 5 passed on a clean run. Same class as **H1** — a guard that cannot fail.

---

### H3 🟠 HIGH — A7.22b passed trivially — **NEW (2026-07-30) → ✅ FIXED (this commit)**
The probe bill POST (`step3-gate.js`, future-dated bill for the AP-D2 check) was never status-checked, so a failed insert produced a green AP-unchanged assertion — AP was unchanged because nothing was added, not because D2 filtered it. New named check `A7.22-insert` asserts 2xx **and** a non-null id BEFORE A7.22b runs. **Proven:** pointing the probe at a bad endpoint yields `A7.22-insert` FAIL (`HTTP 404, id undefined`) while `A7.22b` still reported PASS — the trivial-green hole demonstrated, not asserted. step3 goes 32/1 → 33/1; A7.4 remains the only red.

---

### H5 🟢 LOW — stale expectation text in step4 — **NEW (2026-07-30) → ✅ FIXED (this commit)**
Removed the footnote (`"(a FAIL on check 1 is EXPECTED…)"`) and the header EXPECTATION comment, both asserting a red step4 was expected. Both predate F87 landing; against a now-green run they directly contradicted the result.

---

### H6 🟢 LOW — seed fingerprint was line-ending sensitive — **NEW (2026-07-30) → ✅ FIXED (this commit)**
`expected.js` `seedFingerprint()` hashed `fs.readFileSync()` with no encoding, i.e. raw bytes including `\r`, so an EOL flip on a `core.autocrlf=true` checkout changed the fingerprint while content was identical. It misfired live during commit `519fe32`. Now read as utf8 and normalized (`\r\n`→`\n`) before hashing, matching `bundle.js` `norm()`. **Proven both directions:** identical across an EOL flip (old algo `4f1e2cba` vs `d93acf2c`; new algo `d93acf2c` both), and still moves on a real seed change (Marketing 250→251 → `a4d77df0`). VERIFICATION.md restamped `69071491` → `d93acf2c`, stamps only — no figure or date. `verification-sync --check` now prints OK with no warning.

---

### H4 — A7.1 oracle change: ✅ RATIFIED (no revert) — **2026-07-30**
During F87 the gate's own AR computation gained a D2 filter, turning A7.1 red→green. Verified the definition **pre-existed**: `"recognised, non-draft, non-future"` and `arOutstanding: 8500` entered `seedData.js` at **`03624f9` (2026-07-23)** — a strict ancestor of F87 (`34de981`, 2026-07-30), seven days earlier — and the comment there states the app had **not yet** implemented the exclusion, i.e. it was planted as a discriminator. VERIFICATION.md carries the same **8,500** (A9.3 `8,500 not 13,500`; Customer B `7,000`; A+B=8,500). F87 left the 8,500 target untouched and only added the missing non-future clause (which is why the gate was red at 13,500). **The gate was brought into line with an existing definition, not fitted to the server.**

**Noted, not actioned:** A7.1's gate-side recomputation now mirrors the server's D2 rule, so it is less an *independent* re-derivation than before. Mitigated — the 8,500 anchor is hand-supplied and predates both, and A7.1 exercises the invoices row list while A5.16-18 exercises the reports engine. Whether A7.1 should stay independent of the server's filter is a separate question from "pre-existing vs invented" (which the evidence settles as pre-existing) and is left to the owner.

---

### F110 🟡 MEDIUM — harness re-pin hazard: the clock pin and `seedData.TODAY_LOCAL` must move together — **NEW (2026-07-30) → 🟠 GUARD LANDED (this commit); re-pin strategy still OPEN**
The node clock pin (`clock.js` `PINNED_ISO`) and `seedData.TODAY_LOCAL` must move in lockstep. Moving the pin alone relocates D2's "today" and reclassifies seed rows: **demonstrated** by moving the pin to `2026-06-25`, which reclassified INV-5 (`2026-07-05`) as future under D2 and drove step3 to **17/17**. Nothing enforces the pairing.

**Not to be confused with the month-straddle.** On `2026-08-01` the pin does NOT move, D2 still resolves against it (every `resolvedToday` call passes `new Date()` = pinned, not Postgres `NOW()`), and no gate figure changes. The only `NOW()`-fed money write is `payroll_runs.run_date` (server.js:3893, Part B); `drift.js` warns and marks Part B checks BLOCKED, and the four gates run none. **The straddle is benign; re-pinning is the hazard.** Proven: under an artificial straddle step2 stayed 63/0 (it keys D2 off `TODAY_LOCAL`, immune to the node clock).

**Guard LANDED (this commit).** A pin↔seed consistency assertion in `clock.js` section 2b compares the pinned instant's **UTC** date (`_utcYmd(PINNED_MS)`) against `seedData.TODAY_LOCAL` and throws at `-r` preload naming both values + the fix. UTC not local: `resolvedToday` keys on `_utcYmd`, and tz-matrix spawns four zones via `-r clock.js`, so a local compare would false-fail eastern viewers — **verified passing under Kolkata (+5:30) and London (+1)**. `seedData.js` is pure data (no requires, no module-scope `new Date()`), so requiring it from clock.js is side-effect-free; neither file is loaded by the app, so the guard cannot fire outside the harness. **Proven:** the pin moved alone to `2026-06-25` throws once, before step3 runs, rather than surfacing as 17/17.

**STILL OPEN:** the four re-pin strategy options (advance the pin+seed in lockstep · make the seed relative to the pin · freeze the DB clock · fail the drift check loudly) remain an owner decision; the guard presupposes none of them.

---

### F87 peripheral instances — ✅ CLOSED (this commit) — **2026-07-31**
The same local-`getMonth` period-membership bug (F87 / Rule 10) on **non-recognition** surfaces: `inThisMonth` feeding the **credit-notes** and **vendor-credits** "this month" sums (`_cnMonthSum`/`_vcMonthSum`, wiring-pages.js), the **recurring-bills YTD** elapsed-month multiplier (`_rbYtd`, wiring-pages.js), and the **docs-this-month** count (wiring-medium.js). All routed through `window.FinFlowDates` (`_toYmd` / `resolvedToday`, UTC calendar-month **string** compare — no Date-to-Date comparison). Dead **`calcMTD`** deleted (wiring-dashboard.js) — zero call sites, re-confirmed repo-wide at `49638c1`.

**Verified by INSPECTION, not execution.** These surfaces are **ungated**, so the four green gates (step2 63/0 · step3 33/1 · step4 5/0 · tz-matrix identical) prove **no regression only**. The fixes mirror the string-compare/UTC pattern whose viewer-independence **is** execution-proven for the recognition legs by step4 and tz-matrix (`arOutstanding`/`computeRevenue`). Per Rule 14 that mirroring is not itself execution.

**Left OUT deliberately** (same shape, different category): the investments rolling chart (legitimately relative-to-now) and personal-finance `_pers*` (separately scoped); plus recurring `next_run` advances, payment-date insert-defaults, and month-label parsers/formatters — none is a period-membership recognition sum.

**H1 note:** first live exercise of the `--from-index` WRITE path since `d83f7e7` — it took the write branch (rebuilt the bundle from the staged sources into the index), left the working tree untouched, and the committed bundle was verified to match the committed sources (fixes present, `calcMTD` absent).

---

### F112 🟢 LOW — VERIFICATION.md stamp date churns daily — **NEW (2026-07-31), OPEN**
Independent of **H6**. H6 stopped the seed **fingerprint** moving on EOL flips; the stamp **DATE** still moves every calendar day the gate runs, so VERIFICATION.md shows modified after any gate run on a new day and someone must decide each time whether to commit a date bump. Observed 2026-07-31 (`07-30 → 07-31`). **Not a defect** — the date records when the figure was last verified. Open question whether the stamp needs a date at all, given the seed fingerprint already identifies *what* was verified. Owner's call; no fix built.

---

### F113 ✅ RESOLVED — Dead-but-built "Record Payment" modal on Invoices: a working feature, silenced by the shadowing pattern — **NEW (2026-07-31, source-verified) → RESOLVED (2026-07-31)**
`openRecordPaymentModal` / `recordPayment` (`index.html:4460-4498`) were fully written and correctly wired to Store B: `recordPayment()` POSTs `{invoice_id, amount, payment_date, method, reference, notes}` to `POST /api/invoice-payments` — the real settlement route, with a real amount input (`rp-amount`), not a full-balance-only settle. They were never reachable. The only caller of `openRecordPaymentModal` anywhere in the repo was `app-main.js:2222`, itself inside `app-main.js`'s own `renderInvoices` (declared `app-main.js:2196`), which built a per-row **"Record Payment"** button (`app-main.js:2212`) for any non-paid invoice. That entire function was shadowed: `finflow-api-wiring-medium.js:200` reassigns `window.renderInvoices` (confirmed the runtime winner — the bundle loads `app-main.js` synchronously first, then the deferred bundle containing `medium.js` runs after and overwrites the binding), and medium.js's replacement template rendered only Remind / View / **Mark paid** / Delete — no "Record Payment" button, no equivalent affordance. The feature was built once, then a later "patch" file replaced its render function without carrying it forward — the exact dead-code-shadowing failure this codebase's own CLAUDE.md opens with.

**Severity rationale (at logging):** MEDIUM, not HIGH/CRITICAL — by itself this was inert, unreachable code; nothing wrong was computed or written as a *direct* result of its absence. Rated MEDIUM rather than LOW because its absence was the root cause of **F114** (a real, reachable capability gap with money consequences) — the two were read together, and reviving F113 turned out to be the whole fix for F114.

**Update 2026-07-31 — revived as the sole settle path.** `finflow-api-wiring-medium.js`'s live `renderInvoices` now calls `openRecordPaymentModal(window.userInvoices[idx])` for every pending or partial invoice, passing the full invoice object (not the old bare id/client/amount strings) so the modal can show Total/Paid/Remaining and check overpayment inline. `markInvoicePaid` — the function that was shadowing this the whole time — is **deleted outright**, not deferred (confirmed by repo-wide grep before deletion: its only callers were its own button and the already-dead `app-main.js` copy). Settle contract (still the unchanged `POST /api/invoice-payments`) verified by execution: step3 50/0, full-payment/partial-stacking/overpayment-rejection all green (A7.23-25). Modal UI itself (rendering, date defaulting, live badge flip) verified by inspection only — no jsdom page-render harness exists in this repo.

**Status:** RESOLVED. A "Record Payment" button reaches the invoice from both `pending` and `partial` status, opens the real modal, and settles via the same route this entry always pointed at.

---

### F114 ✅ RESOLVED — No partial-payment path exists in the reachable UI; "Mark paid" always settles the FULL remaining balance — **NEW (2026-07-31, source-verified) → RESOLVED (2026-07-31)**
Confirmed by source inspection at the time — `window.markInvoicePaid` (`finflow-api-wiring-medium.js:152-181`) computed `remaining = amt − paid` and, when `remaining > 0`, POSTed `{invoice_id, amount: remaining, ...}` — **always the entire remaining balance, never a user-entered amount.** There was no amount input anywhere in the reachable "Mark paid" flow. The one UI element that *did* have an amount field — the dead modal from **F113** — was unreachable.

**Consequence, not merely a missing feature.** A real customer who paid PART of an invoice could not be recorded as a partial through any button in the live app. The owner's only reachable options were: do nothing (the invoice sits at its true status, understating cash actually received), or click "Mark paid" — settling the FULL remaining balance regardless of what was actually received, writing an `invoice_payments` row for **more than the customer paid**. Since the F95 cash-flow fix (`fca024c`) reads `invoice_payments.amount` at `payment_date` directly into Cash Flow's cash-in leg, this was a live, reachable money-correctness risk, not a cosmetic gap.

**Update 2026-07-31 — closed by reviving F113.** The Record Payment modal now defaults the amount field to the Remaining balance (editable) with a "Full" quick-fill, checks `amount > remaining` inline before the POST (surfacing the server's existing overpayment guard as a warning, not a post-save error), and — the concrete gap this entry named — **`partial`-status invoices now get the same "Record Payment" action button `pending` invoices always had** (previously they had none, only delete). A partial invoice's badge also gained its own color (`b-blue`) instead of falling through to `pending`'s amber. Verified by execution (step3, A7.24): a second, smaller payment on an already-`partial` invoice **stacks** — status stays `partial`, `amount_paid` increments (500+300=800, not replaced), a second `invoice_payments` row exists — and a full payment (A7.23) correctly flips a `pending` invoice to `paid` with `amount_paid` == total.

**Status:** RESOLVED. Partial payments are recordable through the reachable UI; Cash Flow now reflects only what was actually received, not an inflated "Mark paid" full-balance guess.

---

### F115 ✅ RESOLVED — `markInvoicePaid` dated the settlement from the VIEWER's local clock, not a resolved calendar date — cross-ref **C3** (same class, was NOT one of its 35 catalogued sites) — **NEW (2026-07-31, source-verified) → RESOLVED (2026-07-31)**
Confirmed by source inspection at the time:
```js
// finflow-api-wiring-medium.js:162-163 (deleted)
const _d = new Date();
const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
```
This built `payment_date` from the **browser's local** `getFullYear()`/`getMonth()`/`getDate()` — a Rule 10 violation on a live path feeding `invoice_payments.payment_date`, which the F95 fix reads straight into Cash Flow's cash-in bucketing.

**Distinct from C3, same root class.** `C3` (`AUDIT_MASTER.md:345`) catalogues 35 sites using `new Date().toISOString().slice(0,10)` — the **UTC** direction. This line didn't match that pattern (no `.toISOString()`, explicit local getters instead) and would not have been caught by C3's own enumeration grep.

**Update 2026-07-31 — closed by deletion + a genuine server-resolved date, not a client substitute.** The whole function (and its local-clock construction) is **deleted**, not patched. `GET /api/auth/me` now returns `today: FinFlowDates.resolvedToday(new Date())` — the server's own clock, UTC calendar date, Phase 1 canonical resolver, the same helper `computeBooks`/cash-flow/COGS already use (`server.js:3280,3487,4094,4488`) — and the client stores it once at boot (`finflow-api-wiring-final.js`, session-restore path) as `window._serverToday`. The Record Payment modal's date field reads **only** that value; if it isn't loaded yet, the field and Save button disable rather than falling back to `new Date()` anywhere (locked decision — no browser-clock path exists in this flow at all, confirmed by re-reading the diff). See **F116** for the one known gap in when `window._serverToday` gets primed.

**Status:** RESOLVED. No client-clock date computation remains on this settle path.

---

### F116 🟢 LOW — `window._serverToday` is primed only on the session-restore path, not on a fresh login — **NEW (2026-07-31, source-verified), OPEN**
**Status:** OPEN. Confirmed by source inspection.

`window._serverToday` is set only inside `finflow-api-wiring-final.js`'s `GET /api/auth/me` handler, which runs on the **session-restore** boot path (an existing session found on page load). A **fresh** login goes through a different path — `POST /api/auth/login` (`app-main.js:640`) — which never calls `GET /api/auth/me` at all. So immediately after a brand-new login, `window._serverToday` is unset, and the Record Payment modal shows its blocked "loading…" date state (disabled field, disabled Save) until any navigation or page reload triggers the session-restore path and primes it.

**Fails safe, not silently wrong.** This is exactly the locked F115 design working as intended — the modal never falls back to the browser clock, so a user hitting this window sees an honestly-blocked field, not a wrong date. Degraded UX, not a money-correctness defect.

**Course of action:** either add `today` to `POST /api/auth/login`'s own response and store it in `app-main.js`'s login handler, or have `bootFinFlowAPI()`/the post-login boot sequence call `GET /api/auth/me` once. Either fix requires touching `app-main.js`, which was deliberately out of scope for the F113/F114/F115 effort (edit the live engines only, not the file whose shadowed `renderInvoices` this same effort was careful to leave alone).
**Done when:** `window._serverToday` is set immediately after a fresh login, with no gap before the Record Payment modal can be used normally.

---

### F117 🟠 HIGH — Duplicate invoice created for the same customer/amount, reachable via double-submit — **NEW (2026-07-31), OPEN**
**Status:** OPEN. **Owner-reported from production, not independently verified this session** — this session has no database access and CLAUDE.md forbids querying production directly. Recorded as evidence supplied by the owner, per Rule 7 ("evidence, not conclusions" cuts both ways — the claim is logged with its source, not re-stated as something this session confirmed).

Owner reports two invoices for customer "saige," identical amount (2,000), both present in production as **ids 8 and 9**. Consistent with a double-submit on invoice creation — the same class of gap already named for other mutating actions in this codebase (Rule 9: dedupe must be a single shared mechanism every mutating handler routes through, not a per-button patch; B8/C1 already documents this recurring on Run Payroll and Approve after being "fixed" once for Record Payment).

**Mechanism identified from source (2026-07-31, read-only).** Two independent gaps, both live; the duplicate needs only either one to be closed, but the class needs the server one.

- **Client — no in-flight lock (`finflow-bundle.js:524` `window.saveInvoice`, runtime winner; loads last via `defer`, shadows `app-main.js:2250`).** The Create button is a plain `onclick="saveInvoice()"` (`index.html:3427`) with no disable. `saveInvoice` is `async` and `await`s `POST /api/invoices` (`bundle:547`) with no `_saving` guard and no button-disable — so a double-click, or an impatient re-click during a slow request, re-enters and fires a **second** POST. Nothing on the client prevents it.
- **Server — dedupe guard is non-atomic (`server.js:931-937`).** `POST /api/invoices` does `findRecentDuplicate(...)` (a plain `SELECT … created_at > NOW() - 5s … LIMIT 1`, `server.js:807-810`) then, if nothing matched, `INSERT`s — with **no transaction, no row lock, and no UNIQUE constraint**. Two near-simultaneous POSTs both run the SELECT *before* either INSERT commits → both see no duplicate → **both insert** (ids 8 & 9). This is a TOCTOU race: the header comment claims it guards "near-simultaneous double POST," but a SELECT-then-INSERT only stops *sequential* re-submits inside the window, never truly concurrent ones. Exactly Rule 9 ("idempotency at the write, not guards on the button") and the C1/B8 class.

**Class (Rule 13) — this is NOT invoice-only.** `findRecentDuplicate` / `findRecentDuplicateTyped` is the sole create-dedupe on **~30 routes** (entities, expenses, customers, inventory, items, payroll, quotes, vendors, bills, recurring_*, sales_receipts, payments_received, credit_notes, payments_made, vendor_credits, timesheet, team_members, journals, chart_of_accounts, holdings, goals, projects, personal_*, invoice_payments, payroll_runs, inventory_movements, fx_*). Every one shares the same non-atomic SELECT-then-INSERT shape, so every one is defeatable by concurrent double-submit. The invoice is just the row that got noticed. The server-side inert idempotency-token hint at `server.js:3921` ("inert until the UNIQUE …") is the half-built C1 backstop.

**Course of action (C1 rollout — HOLD for owner approval; not started).** The durable fix is idempotency **at the write**, shared by every mutating route: a UNIQUE constraint (or idempotency-key column with a UNIQUE index) so a duplicate INSERT is rejected atomically by Postgres regardless of timing, with the route catching the unique-violation and returning the original row (the 200-return contract `findRecentDuplicate` already implements). A client in-flight lock on `saveInvoice` is worth adding too but is **not sufficient alone** (two tabs, network retry, API replay still defeat it) — per Rule 9 it must not be the only fix. Data cleanup of the existing id 8/9 duplicate is a **separate, owner-gated commit** (Rule 8).
**Done when:** creating an invoice twice concurrently for the same customer/amount yields exactly one row, proven by executing the concurrent double-POST against a real scratch DB (Rule 14 — the race path itself is run, not reasoned); and the same backstop covers the enumerated class, not just invoices.

---

### F118 ✅ CANNOT REPRODUCE on live (`adf05fb`, runtime-captured 2026-07-31) — was 🟠 HIGH — Record Payment modal false "exceeds remaining balance" warning on a valid full payment
**Status:** ✅ NOT REPRODUCIBLE on the deployed app. Runtime-instrumented against the real running production instance (`finflow-production-dab2.up.railway.app`) with a read-only console probe wrapping the live `openRecordPaymentModal` — not a mock. The prior "`amount_paid = NULL` poisons `_rpRemaining`" theory is **disproven by execution**.

**What was measured — clicking Record Payment on the real saige $2000 invoice (`_dbId: 9`, `status: pending`):**
- real `inv` object: `{_dbId:9, client:"saige", amount:2000, due:"Jul 30", due_date:"2026-07-31", status:"pending", notes:"", color:"var(--t2)"}` — **no `amount_paid` key at all**.
- `inv.amount = 2000` (number); `inv.amount_paid = undefined`.
- `rp-remaining` cell = `$2.0K` (`_rpRemaining = 2000`); `rp-amount` input prefilled `2000`.
- `_rpCheckOverpay`: `2000 > 2000 + 0.005` → `false` → **warning hidden, Save enabled.** No defect on this path.

`parseFloat(undefined) || 0 = 0` (and `parseFloat(null) || 0 = 0`), so an unpaid invoice yields the **full** remaining — the opposite of a reduced/poisoned value. The live `openRecordPaymentModal` source captured by the probe is exactly `index.html:4481` with the `|| 0` guards.

**Rule 1 winner confirmed:** live `renderInvoices` is the Medium-wiring copy (object-form button `onclick="openRecordPaymentModal(window.userInvoices[0])"`, `partial` badge present). The `app-main.js:2222` positional call site is dead/shadowed. The local `finflow-bundle.js` read this session was **stale** (lacked Medium's Record Payment button); the deployed bundle includes it (live boot log `[FinFlow API Wiring — Medium] … Invoices … patched`, `finflow-bundle.js:1755`).

**Most likely explanation for the original sighting:** it predates one of the same-day Record Payment / modal fixes (2026-07-31); the deployed code no longer exhibits it. Which commit closed it is unconfirmed (no git/bash access this session).

**Done when:** owner confirms the warning no longer appears on a full payment — OR supplies a specific invoice + typed value that still reproduces, captured the same way, in which case reopen with that exact object.

**Original finding (superseded by the runtime capture above):**

**Confirmed real, by owner-supplied production data:** the "saige" invoice stores `amount = 2000`, `amount_paid = NULL`. A user entering exactly `2000` (the full, correct remaining balance) trips the inline overpayment warning and blocks Save. This is a **real defect**, not the display-precision explanation given earlier the same day.

**The prior diagnosis in this session was wrong, and is superseded here.** That diagnosis concluded the warning was a *display* illusion — that `S()`/`_fmtMoney`'s K-abbreviation (`index.html:6280`, `app-main.js:548-560`) collapses any value from $1,950-$2,049 to the identical "$2.0K", so a user typing "2000" after reading an abbreviated display could be **legitimately** overpaying a *different*, more precise true balance. That reasoning was built and "verified" entirely against a **mocked** `inv` object in an isolated Node harness — clean hand-picked JS values for `inv.amount`/`inv.amount_paid`, never the real `GET /api/invoices` response shape. Re-run this session against the now-confirmed real shape (`amount: 2000` as a clean number, `amount_paid: null`, typed "2000", no "Full" click) — **the same mock still evaluates `over === false`, still fails to reproduce the bug.** That is the tell: the mock's assumed data shape is not what the real app is actually working with, and no amount of additional mock scenarios will find a bug that lives in the gap between the mock and reality. The earlier entry's conclusion (display-abbreviation illusion, not a real bug) is **withdrawn**.

**Prime suspect, unconfirmed:** the `amount_paid === null` path. `parseFloat(null) || 0` should yield `0` in isolation (confirmed, trivially) — but the REAL `window.userInvoices[idx]` object the modal actually receives, or a coercion step between the real `GET /api/invoices` response and `openRecordPaymentModal(inv)`, is producing a different `_rpRemaining` than clean math predicts. Not yet identified which step.

**What's needed, not done this session:** instrument the real, running app — log the actual `inv` object `openRecordPaymentModal` receives and the actual `_rpRemaining` value at the moment `_rpCheckOverpay` runs, against a real invoice with `amount_paid = NULL` — and read what comes back, rather than reasoning about it further. This is a code change (temporary logging) and is explicitly out of scope for this AUDIT_MASTER-only turn.

**Course of action:** add temporary diagnostic logging (or use the browser devtools directly) against a real `amount_paid: NULL` invoice, capture the actual `inv` shape and `_rpRemaining` value, then locate the exact divergence from the mocked trace. Do not guess at a fix before that.
**Done when:** the exact line/step producing a wrong `_rpRemaining` (or a wrong `amt`) for a `NULL`-`amount_paid` invoice is identified from a real captured value, not inferred.

---

### F119 🟡 MEDIUM — Live Record Payment invoice mapper drops `amount_paid` — over-collection risk on partial invoices (F56 class) — **NEW (2026-07-31), OPEN**
**Status:** OPEN. Partially measured, partially UNEXECUTED. Surfaced while runtime-instrumenting F118.

**Measured (runtime, production).** The invoice object the live Record Payment button hands to `openRecordPaymentModal(window.userInvoices[0])` has **no `amount_paid` key** — absent, not `null`: `{_dbId, client, amount, due, due_date, status, notes, color}`. So the mapper feeding live `window.userInvoices` on this path does not carry `amount_paid`. Same class as **F56** (`refreshFinancials`' mapper dropped `amount_paid`), whose verification asserted "both mappers carrying `amount_paid`" — so this is a **third** mapper F56 did not cover, or a repopulation path that overwrites the carried value. The shape (`due_date` raw + `due` formatted, `_dbId` but no `id`, no `amount_paid`) does not match the F56-fixed mapper shape.

**Consequence — UNEXECUTED (Rule 14).** For a *fully unpaid* invoice, `amount_paid` absent vs `0` is indistinguishable (`parseFloat(undefined)||0 = 0`), so F118 was harmless. For a *partially-paid* invoice this mapper would report `paid = 0` → `_rpRemaining = full amount` → `rp-paid`/`rp-remaining` cells misreport AND the overpay guard is defeated in the **under-warn** direction (accepts more than the true remaining); `markInvoicePaid`, settling `amount − amount_paid`, would try the full amount → server **400**. This consequence is reasoned, NOT yet executed against a real partial invoice.

**One dropping mapper confirmed by reading (2026-07-31):** `saveInvoice`'s optimistic `unshift` (`finflow-bundle.js:558-567`) builds `{_dbId, client, amount, due, due_date, status, notes, color}` with **no `amount_paid`** — the exact shape the F118 probe captured. Not yet confirmed whether the probed object came from this `unshift` or from `loadInvoicesFromDB`'s re-map that runs just after (`bundle:572`); both must be checked.

**Course of action:** (1) enumerate **all** mappers feeding `window.userInvoices` (Rule 13) — at minimum `saveInvoice` unshift (`bundle:558`, confirmed dropping), `loadInvoicesFromDB` (`bundle:~497`), `refreshFinancials`/postgres mapper (F56-fixed), `finflow-api.js:87`/`bundle:88` — and confirm each carries `amount_paid`; (2) execute the partial case — record a partial payment against a real invoice, reopen Record Payment, capture `inv.amount_paid` + `rp-remaining` the same read-only way — before proposing a fix.
**Done when:** every mapper feeding `window.userInvoices` carries `amount_paid`, verified by capturing a real partially-paid invoice object with `amount_paid` present and `rp-remaining = amount − amount_paid`.

---

### F120 ✅ **FIXED** (`baae74b`, 2026-08-03) — was 🟡 MEDIUM — Chart Y-axis ticks hard-code `'$'` — axis and tiles disagree under a non-USD display currency (F34 class)
**Status:** ✅ FIXED and probe-verified, including the failure path. Owner **visual** check outstanding (see below — that limit is real and is not a formality).

**What changed.** Both dashboard chart Y-axis tick callbacks (`app-main.js:4968` overview, `:5016` cash — line numbers re-confirmed against the current file, the `:4880`/`:4928` below had drifted) now resolve the symbol live:

```js
callback:v=>_fmtMoney(v, CURRENCIES[activeCurrency]?.symbol||'$')
```

**Deliberately NOT `_fmtMoneyAbbr`, and the reason is load-bearing.** The task-level instinct was to mirror the KPI tiles, which use `_fmtMoneyAbbr` (symbol lookup **+** `fxConvert`). Checked first, per the "confirm what currency the series is in" step: under a display currency the overview chart's datasets have **already been replaced with the SERVER-converted buckets** by `_applyConvertedChart` (`app-main.js:4778`, called from `_applyConvertedKPIs:4749`), and in the native path `activeCurrency` **is** the entity's own currency (`_applyDisplayCurrency:4652-4653` sets `_displayCurrency` to null exactly when the two coincide). So the axis value is *always already in `activeCurrency`* and must **never** be converted. `_fmtMoneyAbbr` is a no-op converter only because of the F59 landmine (`fxConvert(n)` called with one of three arguments hits its own `!rates[from]` guard); the day anyone "fixes" that arity, an `_fmtMoneyAbbr` axis would double-convert. The form used here is the same one `_applyConvertedKPIs`' own `set()` helper uses for already-converted server figures (`:4719`).

**How it was verified.** `tests/harness/f120-chart-axis-currency.js` — **15/15**. It executes the real `buildCharts`/`buildCashChart` against a recording `Chart` (the chart *library* is stubbed; `_fmtMoney`, `CURRENCIES` and `activeCurrency` are the real source), captures the callback actually registered on `options.scales.y.ticks`, and calls it. `fxConvert` is made to **double** in the probe, so a converting axis renders `2.5K` instead of `1.2K` and cannot hide.

**Failure path EXECUTED (Rule 14), not described.** Section 4 rebuilds the same spans with the callbacks textually reverted to `_fmtMoney(v,'$')` and runs them: under `activeCurrency='EUR'` the pre-fix code returns `"$1.2K"` where the fixed code returns `"€1.2K"`. Both strings are measured in the same run.

**Rule 1 checked, not assumed.** `grep -rn "window.buildCharts *=\|window.buildCashChart *=" public/ --exclude=finflow-bundle.js` returns **nothing** — neither function is shadowed by a wiring override, so the `app-main.js` copies are the runtime path. (`app-main.js` is also not a bundle source; `bundle.js` concatenates only the 10 wiring files, so no bundle regeneration is involved.)

> ### ⚠️ CORRECTION 2026-08-03 — this row's stated MECHANISM was not running when it shipped.
>
> The reasoning above says the overview axis is safe under a display currency *"because `_applyConvertedChart` has overwritten both datasets with the SERVER-converted buckets."* **That overlay had never executed.** It guarded on `window.charts`, and `charts` is `let charts = {}` (`app-main.js:1598`) — a top-level `let`, which never becomes a global-object property. Proven by execution; full enumeration on **F125**.
>
> **What that means for this fix, precisely.** The axis change is still right and the probe still measures what it says. But between `baae74b` and the F124 commit, the overview chart's values were NATIVE under a display currency while this axis stamped the display symbol on them — the mislabel this row exists to remove, in the one state it was meant to fix. It did not *introduce* the mislabel: the chart's tooltip (`S()`) had been stamping `activeCurrency` on those same native values since long before. F120 made the axis agree with an already-wrong tooltip and described a mechanism that was not yet real.
>
> **Now real** — F124 makes `_applyConvertedChart` reachable, so the premise holds from that commit onward. Recorded rather than quietly amended, because "the fix was correct but its stated reason was not yet true" is exactly the kind of thing that gets cited later as proof the surface was verified.

**⚠️ Limit of what is proved.** The probe proves the *string the callback returns*. It does not render pixels — Chart.js is not loaded. **The final confirmation is visual and is outstanding:** set a non-USD display currency and check that the axis labels beside the KPI tiles carry the same symbol. The probe prints that caveat on every run so it cannot be quietly forgotten.

**⚠️ THE ORIGINAL ENUMERATION WAS WRONG — corrected here.** The row below claimed *"Grep … returns exactly these two sites … the class is two instances, both in `buildCharts`."* Re-run this session:

```
$ grep -rn "ticks:{.*callback:v=>.*_fmtMoney(v,'\$')" public/ --include=*.js --include=*.html | grep -v finflow-bundle.js
public/index.html:4294:  … callback:v=>window._fmtMoney(v,'$')   ← MRR/ARR chart
public/index.html:6327:  … callback:v=>window._fmtMoney(v,'$')   ← Scenario-planner cash chart
```

**Four chart axes, not two.** The original grep missed the `window.` -prefixed form in `index.html`. Those two are **deliberately NOT fixed here**, and not because of scope discipline alone: on both pages the *sibling card values* hardcode `'$'` too (`index.html:4264-4265` `mrr-val`/`arr-val`; `:6280` a **local** `S` shadowing the global one, feeding `sc-rev`/`sc-exp`/`sc-profit`). Fixing only the axis on those pages would make the axis disagree with the cards beside it — trading one internal contradiction for another. They need a surface-level pass and are logged as **F124**, with the cash chart's unconverted series.

---

**Original finding (for the record):**

**Status:** OPEN, confirmed by reading. Pre-existing; surfaced while implementing F64, NOT caused by it.

**What's wrong.** Both overview-chart Y-axis tick callbacks pass a literal `'$'` as the symbol:

```js
// app-main.js:4880 and :4928 (identical)
y:{ ... ticks:{ ..., callback:v=>_fmtMoney(v,'$') }, ...}
```

`_fmtMoney(value, symbol)` takes the symbol from its caller precisely so F34 display-currency and `persCurrency` both work (`app-main.js:543-560`). Every other money surface resolves it live — `CURRENCIES[activeCurrency]?.symbol` — but these two do not.

**Consequence.** With a display currency set (F34 Path B), the dashboard tiles render `€35.2M` while the chart axis beside them renders `$35.2M` for the same figures. The *number* is correct — only the symbol is wrong — so this is mislabelled money, the exact defect class F34 was opened for, on a surface F34 did not enumerate. Not viewer-dependent and not a total error; severity is MEDIUM on that basis.

**Enumeration (Rule 13).** Grep for the hard-coded form across the client returns exactly these two sites; chart *tooltips* (`:4875`, `:4923`, `:4951`) go through `S()` and are correctly FX-aware, as are all KPI tiles. So the class is two instances, both in `buildCharts`.

**Course of action:** replace the literal with the same live lookup the tiles use, then execute the failure path — set a display currency and assert the axis string carries the target symbol (reasoning that "it mirrors the tile pattern" is not verification, Rule 14).
**Done when:** with `display=EUR` active, an executed probe shows axis ticks and KPI tiles rendering the SAME currency symbol.

---

### F121 🟠 HIGH — step-4 client gate compared revenue against GROSS components — a false pass that survived because both sides were wrong (Rule 6 class) — **NEW (2026-08-02), FIXED in the F58 harness commit**
**Status:** FIXED, verified by execution. Found while adding the F58 contra legs.

**What was wrong.** `tests/harness/step4-client-gate.js:180` asserted client revenue against `EXPECTED.COMPONENTS[k].revenue`. Once F58 split COMPONENTS into GROSS invoiced revenue plus a separate `creditNotes` contra, that field stopped being the reported figure. With `window.creditNotes` also unseeded in the gate's jsdom `win` object, the client returned gross **5,000** and the expectation read gross **5,000** — so the check went **green while both sides were wrong**.

**Why it matters more than the one line.** This is `CLAUDE.md` Rule 6 in the harness itself: "client and server agreeing proves only that they share an assumption." The gate that exists to catch divergence was structurally incapable of reporting this one, and it would have certified a completely absent contra leg as verified. Measured, not reasoned: the pre-fix engine run reported `A5.1 revenue (Jun) actual 5000 · expected 3000` on the SERVER gate while the client gate showed revenue PASSING — the two gates disagreeing is what exposed it.

**Fix (both halves — either alone leaves the gate blind).** (1) compare against `EXPECTED.serverFigures(k).revenue`, the NET reported figure; (2) seed `creditNotes`/`vendorCredits` into the gate's `win` object, with status kept CAPITALIZED as `server.js:2307` stores it so the case-insensitive compare is genuinely exercised.

**Generalisation to check next (Rule 13):** every other `EXPECTED.COMPONENTS.*` reference in a gate is the same shape — a raw component asserted where a derived figure is reported. `step4-client-gate.js:103` reads `COMPONENTS[k].cogs`, which is currently safe only because no contra applies to COGS. That safety is incidental, not structural.
**Done when:** no gate asserts a *reported* figure against a raw COMPONENTS field; reported figures come from `serverFigures()` only.

---

### F122 ✅ **FIXED** (2026-08-02) — was 🔴 CRITICAL — `POST /api/reports/cash-flow` omits PAID PAYROLL from cash out — every Cash Flow figure understated outflow by the payroll it had actually paid
**Status:** ✅ FIXED and gate-verified, including the failure path. Owner live-check outstanding.

**What's wrong.** The endpoint (`server.js:3519`) builds its outflow from exactly two legs:

```js
expenses.forEach(e => add(e.expense_date || e.date || e.created_at, 'outflow', e.amount));
paymentsMade.forEach(p => add(p.date || p.created_at, 'outflow', p.amount));
```

There is **no payroll leg**. `payroll_runs` / `payroll_run_lines` are never read. Under decision **D3** (*"recognised when money actually moves"*) paying employees is money moving, so a run marked `paid` is cash out and is currently invisible.

**Measured (`tests/harness/f57-cash-card.js`, real Postgres, real HTTP, real seed):**

```
2026-05  in 1000  out  600  net  400
2026-06  in  500  out  750  net -250
2026-07  in    0  out  750  net -750     ← VERIFICATION A7.13 expects out 1,850
```

Jul short by **1,100**; FY out **2,100** against an expected **3,200** — short by the same 1,100. That 1,100 is exactly **R3**, the one seeded run with `status:'paid'` (`run_date` 2026-07-20, Σlines 1,100). Jun and May match to the penny, because their runs (R1 approved, R0 approved-not-paid) correctly produce no cash. The gap is precisely and only the paid run.

**The seed was built to catch this and no gate ever ran it.** `seedData.js` R0's comment reads *"Approved but not paid ⇒ no cash out"*, and R3 is seeded `paid` specifically to generate payroll cash. `VERIFICATION.md:416-417` states A7.12–14 (cash out) and A7.15–17 (net) with the correct expectations — and **both rows have an empty Result column: never run.** `step3-gate.js` asserts only A7.9–11, cash **in**. The one leg with the defect is the one leg no gate touched. `B4.4` (*"Mark Paid → Cash Flow out increases by Σ lines"*) is also unrun and would have caught it directly.

**Consequence (production).** For any business that runs payroll — the common case — Cash Flow out and net are understated by every paid run. Payroll is typically the LARGEST cash outflow, so the reported net is not slightly off, it is structurally optimistic: the report tells an owner they are cash-positive in a month they were not. Severity CRITICAL on that basis, not on the size of the seed's 1,100.

**Not caused by F57's card work.** The card was rewired to this endpoint and agrees with it exactly; it faithfully mirrors a wrong server leg. Fixing the card cannot fix this — the number is wrong before the client sees it.

**Course of action.** (1) Decide the recognition event with the owner — `status='paid'` at `run_date`, or a genuine payment/settlement date if one exists (the seed's F82 note mentions R3's payment dated 2026-07-22, which is NOT the run_date, so "paid at run_date" may itself be an approximation — this needs the owner, not a guess). (2) Add the leg to the endpoint, keyed on that date, `paid` only — **not** `approved`, which is accrual recognition and would double-count against the P&L's basis-C leg. (3) Enumerate the class (Rule 13): check whether `/books`, the balance sheet's cash proxy (`server.js:3479` uses `max(0, netProfit)`) and the Banking page share the same omission. (4) Then run A7.12–17 and B4.4, which have never executed.
**Done when:** A7.12–14 and A7.15–17 execute green against the server (Jul out 1,850 / net −1,850; FY out 3,200 / net −1,700), and B4.4 executes — marking a run paid increases Cash Flow out by Σ lines.

---

**WHAT WAS DONE (2026-08-02).**

**The fix.** A payroll cash-out leg on the route: paid runs joined to their lines, Σ(gross+bonus+overtime) per run, added at `run_date`. Filter is `LOWER(status) = 'paid'` **only** — deliberately NOT the P&L's `IN ('approved','paid')`. That divergence is the whole point: decision 2 recognises the *expense* at `approved`, but cash does not move until the run is paid, so reusing the P&L filter here would book cash for a run nobody has paid. Entity scoping and the JOIN mirror `computeBooks`' payroll query so the two legs cannot drift apart on scope.

**Verified by execution, both directions.** With the leg, A7.9–17 all pass (step 3: 56 passed, 0 failed). With the leg removed:

```
A7.13  Cash Flow cash-out — Jul   actual  750  · expected 1850
A7.14  Cash Flow cash-out — FY    actual 2100  · expected 3200
A7.16  Cash Flow net — Jul        actual -750  · expected -1850
A7.17  Cash Flow net — FY         actual -600  · expected -1700
```

So the new checks genuinely discriminate — they are not green because everything is green. July is the discriminating period: R3 is the only `paid` run, R0/R1 are approved-not-paid and R2 is draft, so all three contribute 0 and the 1,100 gap is attributable to exactly one row.

**The gate gap is closed, and it was the actual root cause.** A7.12–17 were stated in `VERIFICATION.md:416-417` from the start with **empty Result columns — never executed**. Only cash-IN (A7.9–11) was gated. The one leg carrying the defect was the one leg no check touched. They now run in `step3-gate.js`. Net is asserted from each row's own `net` field rather than recomputed as in−out, so a row whose `net` disagrees with its own components is catchable rather than invisible.

**⚠️ KNOWN APPROXIMATION — follow-up, ties to F85.** `mark-paid` writes **no paid date**. The schema has `run_date` (when the run was created) and a status, and nothing recording *when* payment happened. So a run created in June and paid in July books its cash in **June**. That is wrong whenever the two months differ, and it cannot be fixed at this call site — the date does not exist to read. Same shape as F85: an event that belongs to a period by intent, inferred from a different timestamp. Real fix is a `paid_date` column written by mark-paid; this leg then keys on it. Labelled in-code at the call site so it is not mistaken for settled behaviour.

**Still open on this finding — BOTH CLOSED 2026-08-03, see below.** (1) **B4.4 has still never executed** — "mark a run paid → Cash Flow out increases by Σ lines" is the *transition*, which the static seed cannot exercise. (2) The class enumeration from the course of action is **not done**: whether `/books`, the balance-sheet cash proxy (`server.js:~3479`, `max(0, netProfit)`) and the Banking page share the same omission is unchecked. Both are follow-ups, not part of this commit.

---

**UPDATE 2026-08-03 — both follow-ups closed. (1) B4.4 EXECUTED. (2) Class ENUMERATED and CLOSED.**

#### (1) B4.4 — executed for the first time (`6ebc85a`)

`tests/harness/b4-4-payroll-cash-transition.js` — **19/19**, real server, real scratch Postgres, real HTTP. It creates a payroll run through the real route, walks `draft → approved → paid` through the real transition routes, and asserts on the **delta** in `POST /api/reports/cash-flow` at each step:

```
-- 2 - DRAFT      no month changed its cash out  → {}            totalOutflow Δ 0
-- 3 - APPROVED   no month changed its cash out  → {}            totalOutflow Δ 0
-- 4 - MARK-PAID  exactly ONE month changed      → 1
                  …changed by exactly Σ lines    → 5888          totalOutflow Δ 5888
                  cash IN untouched              → {}
-- 5              changed month key == run_date month → "2026-08"
```

**Its own probe, deliberately not folded into step3.** A run created through the route takes `run_date = NOW()` (`server.js:3968`) — the one money write fed by the database clock, which the node pin does not reach (F110). It therefore lands in the real current month, inside FY 2026, and would move the A5 opex and A7.12–17 cash figures step3 asserts as constants. Every assertion is a delta, so the probe is immune to the calendar date it runs on and to the pin moving.

**Rule 4 — the amount identifies its own source.** Σ lines = **5,888**, built through the route as Emp One 3,000 + bonus 777 and Emp Two 2,000 + overtime 111. Roster-only or gross-only reads 5,000; a dropped overtime leg 5,777; a dropped bonus leg 5,111; net-pay-instead-of-gross differs by the deductions. 5,888 collides with no seeded figure.

**Rule 14 — BOTH failure paths executed, then reverted.**
- **F122 leg deleted** (`server.js:3574` commented out) → **4 FAILED**: `exactly ONE month changed got 0 want 1` · `changed by exactly Σ lines got undefined want 5888 (deltas seen: {})` · `totalOutflow rose got 0 want 5888`. **So B4.4 is the F122 leg's guard**: remove the leg and it goes red.
- **cash leg given the P&L filter** `IN ('approved','paid')` (`server.js:3548`) → **6 FAILED**, and critically it fails at **section 3** (`no month changed its cash out got {"2026-08":5888}`) — cash booked for a run nobody had paid. The two sections separate the two bugs instead of both firing on either.
- `git checkout -- server.js` after each; re-verified 19/19 green. Neither control is left in the tree.

#### (2) Class enumeration (Rule 13) — CLOSED. The omission was unique to `/api/reports/cash-flow`.

Enumerated from BOTH directions, as the rule requires. **Code-side**, there is exactly one cash-out computation in the entire server:

```
$ grep -rn "'outflow'" server.js
3562:  expenses.forEach(e => add(e.expense_date || e.date || e.created_at, 'outflow', e.amount));
3563:  paymentsMade.forEach(p => add(p.date || p.created_at, 'outflow', p.amount));
3574:  (paidRunRes.rows || []).forEach(r => add(r.run_date, 'outflow', r.run_total));   ← F122
```

**Surface-side**, every candidate the course of action named, plus the ones it did not:

| Surface | What it actually computes | Same omission? |
|---|---|---|
| `POST /api/reports/cash-flow` (`server.js:3522`) | the only genuine cash engine — three outflow legs above | **YES — this was it. Fixed.** |
| Dashboard cash card (`cf-in/out/net`) | `cashForPeriod(window._cashMonthly)` over the rows from that same endpoint (F57) | no — it is a consumer, not a second engine |
| Cash Flow report page (`app-main.js:5525`) | same endpoint, same rows | no — same consumer |
| `POST /api/reports/profit-loss` (`server.js:~3400`) | ACCRUAL. Monthly `rows` are revenue/expenses; totals from `computeBooks` | **no cash figure exists to omit from** |
| Accountant `/books` (`accountant-routes.js:513`) | raw collections + `computeBooks` (`:561`, `:564`) — accrual | **no cash figure at all**; `grep -n cash accountant-routes.js` returns one hit, inside an AI prompt string |
| `POST /api/reports/balance-sheet` (`server.js:3480`) | has a field named `cash` — but it is `Math.max(0, books.netProfit)` (`:3488`) | **no — and that is a different, worse defect → F123** |
| Banking page (`GET /api/banking`, `server.js:3194`; `bank-outflow`, `app-main.js:5203`) | raw `personal_transactions WHERE source='banking'` — an imported bank-statement ledger | **no** — different data source entirely; a payroll run is not a bank transaction |

**The two lists reconcile:** every surface that displays a cash-out figure traces to the one endpoint (or to a ledger that is not the books' cash engine), and the one endpoint's three legs are all accounted for. **Class closed.**

**⚠️ ONE THING THIS DID NOT CLOSE — now RESOLVED, 2026-08-03: A7.19 was MIS-SPECIFIED and is RETIRED.** The flag left here read: A7.19 asserts the Banking page's in/out/net *"matches A7.9–17 for that period"*, Banking is a bank-feed ledger and cash-flow is the books' cash engine, and the check had never run.

Answered: **the two are bridged by RECONCILIATION, not equality.** `POST /api/bank-reconciliation/match` exists precisely because they differ — matching is the work of pairing a bank line to a book entry, and an unmatched remainder is the normal state. A business legitimately has book entries with no bank line yet (an unpresented payment) and bank lines with no book entry (a fee nobody recorded). **Demanding equality would make a correctly-reconciling account FAIL.** The seed compounds it: no `source='banking'` row is seeded, so Banking reads empty against real cash-flow figures — as written the check could only ever have failed, for a reason that says nothing about the code.

A7.19 is therefore **RETIRED and marked N/A pending a real Banking-page spec** (`VERIFICATION.md`, with the full reasoning). Retired rather than deleted, so nobody re-derives the same equality from the page title. What belongs there instead is reconciliation behaviour — one match links exactly one bank line to one book entry, the unmatched list shrinks by exactly one, neither total is silently restated — which needs different seed rows and goes on the next round's list.

**This is a check being corrected, not a check being passed.** It moves nothing in Part A's denominator toward green; it removes an expectation nobody could have satisfied.

**Also recorded here (harness bookkeeping):** `B4.4` was removed from `DRIFT_SENSITIVE_CHECKS` (`tests/harness/drift.js`). With its own delta-based probe it is no longer drift-sensitive, and printing `BLOCKED` beside a check that carries a PASS in `VERIFICATION.md` had the harness contradicting the document. `B4.2`/`B4.3` stay on that list — they assert the P&L expense figure, have no probe, and are genuinely drift-sensitive. Verified by running step 2: the blocked line now reads `B1.3, B1.4, B3.1, B3.2, B3.3, B4.2, B4.3`.

**Rating unchanged.** F122 stays ✅ FIXED; this update adds the execution and the enumeration its own "Course of action" asked for.

---

### F123 ✅ **FIXED** (`76ab6fa`, 2026-08-03) — was 🟡 MEDIUM (see the rating correction) — The balance sheet's `cash` was CLAMPED ACCRUAL NET PROFIT; it now reads "Not tracked"
**Status:** ✅ FIXED at the source and probe-verified, including the failure path. **Pre-existing and acknowledged in-code** — not a regression, and not something F122 introduced; the enumeration reached it and it needed a number rather than a sentence in a chat message.

> ## ⛔ RATING CORRECTION — I rated this HIGH on 2026-08-03 on a claim that is FALSE. Withdrawn here.
>
> **What I wrote when logging it** (commit `808175f`, pushed): *"RATED UP … because the 'unconsumed endpoint' premise is false … Reports page → Balance Sheet → a figure captioned 'Cash & Equivalents' that is not cash … three of the six lines on that report are wrong."*
>
> **That was wrong, and it was wrong for the reason `CLAUDE.md` opens with.** I ran `grep` for a fetch of the route, found one in `app-main.js`, and concluded it renders. **I did not apply Rule 1.** The renderer is `generateReport` (`app-main.js:5559`) — and `finflow-api-wiring-extra.js:488` does `window.generateReport = async function (name)`, a **REPLACEMENT** override with no `_orig` reference, in bundle source **#7**, which loads after `app-main.js`.
>
> **Confirmed by execution, not by reading:** loading the two in index.html's order and calling the global returns the wiring copy —
> ```
> after app-main.js  : APP-MAIN COPY
> after the bundle   : WIRING COPY
> ```
> The live `generateReport` **ignores the report name entirely** and renders a generic revenue / expenses / net / outstanding summary. **It never calls `/api/reports/balance-sheet`.** So the app-main Balance Sheet body — and the P&L and Cash Flow bodies beside it — are **dead code**, and *"Cash & Equivalents"* has never been on anybody's screen.
>
> **Correct rating: 🟡 MEDIUM**, which is what the finding was originally logged as before I raised it. The exposure is the **F76 shape** — a live, authenticated endpoint returning a fabricated figure with no consumer, where the risk is a future surface wiring itself to it. That is worth fixing, and it is not a wrong number in front of a user.
>
> **Two things this cost, recorded because the cost is the point.** It put a false severity into a pushed commit; and it nearly produced a fix applied to a dead renderer — the F75 pattern, the single most expensive trap in this repo, avoided only because the Rule 1 check was finally run before editing. The shadowing itself is now its own finding, **F128**.

**What changed (the fix).** `server.js:3510` — `cash` is `null`, with `cashTracked: false` and `totalAssetsExcludesCash: true` alongside it, and `totalAssets` is **AR alone**. The arithmetic states the exclusion rather than relying on `null + ar` coercing to `0 + ar`, which would have reported the same total while claiming cash was untracked. **The dead client renderer was deliberately NOT edited** (F75) — it is dead, and editing it would produce a clean diff that renders nothing. Reviving those report bodies is F128's work, and "Not tracked" belongs in that revival.

**Why `null` and not a better number.** There is nothing to compute it from: no bank-balance record type, and `personal_transactions source='banking'` is an imported statement feed, not a general-ledger cash account. `Σ inflow − Σ outflow` from `/api/reports/cash-flow` is **not** the substitute — that is a period FLOW too, so it repeats the shape error with a better basis and looks more defensible while doing it. Decision **D1**'s discipline, applied: report that it is not tracked.

**How it was verified.** `tests/harness/f123-balance-sheet-cash.js` — **13/13**, real server, real scratch Postgres, real HTTP, real seed. `cash: null`, `cashTracked: false`, AR 8,500, AP 1,100, totalAssets 8,500, equity 7,400.

**⚠️ RULE 4 — what discriminates here, and what does NOT.** The seed's FY netProfit is **−1,700**, so the old clamp *already* produced `cash = 0` and `totalAssets` was **8,500 either way**. **totalAssets cannot tell the two implementations apart on this seed**; asserting it and calling the fix proven would be a green check that proves nothing. Only the `cash` FIELD discriminates. The probe asserts that collision explicitly so a future seed change cannot silently remove the warning.

**Failure path EXECUTED (Rule 14).** The old formula was restored in `server.js` and the probe re-run:
```
response: {"cash":0,…,"totalAssets":8500,…,"equity":7400}
FAIL  cash is null                     got 0     want null
FAIL  cash is NOT a number of any kind  got true  want false
PASS  totalAssets is AR alone           → 8500    ← UNCHANGED by the bug
```
Two assertions moved and `totalAssets` did not — the collision demonstrated rather than predicted. `server.js` restored, probe re-verified 13/13.

**And this is what the old code told that user: cash 0, in a year they lost 1,700.** The `Math.max(0, …)` floor is not a rounding detail; it erases the loss case, which is the account most in need of the number.

**What's wrong.** `POST /api/reports/balance-sheet` (`server.js:3480`) reports:

```js
// server.js:3488
const cash = Math.max(0, books.netProfit);          // proxy: no cash account is tracked
```

`books.netProfit` is the **accrual** bottom line from `computeBooks` — revenue recognised at issue, expenses at issue/approval, minus COGS. It is not cash by any definition, and three separate things are wrong with using it as one:

1. **Wrong basis.** Under decision 3 cash is *"recognised when money actually moves"*. Accrual net profit counts an unpaid invoice as revenue and an unpaid bill as expense. Against the harness seed, FY netProfit is **−1,700** while FY cash net is **also −1,700** — a collision, already flagged as a discrimination trap on F57 — but Jun is −1,850 accrual against −250 cash. They are not the same quantity and do not track each other.
2. **Wrong shape — it is a FLOW presented as a BALANCE.** Net profit is a period figure; cash on a balance sheet is a position at a date. The call passes `'year'`, so what is labelled "cash" is one fiscal year's accrual profit.
3. **The `Math.max(0, …)` floor silently deletes the loss case.** A business with a negative net profit reports cash **0**, not a negative figure and not an honest "not tracked". A loss-making account — precisely the one that needs to look at its balance sheet — is shown a zero that means nothing.

**Class (Rule 13).** This is the F31/PL#11 *fabrication* class, not the F122 *omission* class — the two were adjacent in the enumeration and are deliberately kept apart. Its siblings are the removed `ytdPaid = liability × 0.75` (PL#11) and the flat-25% tax rate (F76): a number with no source, computed anyway.

**Enumerated both directions.** Within the route, `ar` is `books.outstanding` (canonical) and `ap` is arithmetic over recognised bills with the D2 future filter (`server.js:3500-3503`, F38 Step 4) — so **`cash` is the only fabricated input**, and `totalAssets`/`equity` are wrong only because they consume it. Across surfaces, there is a **second** balance sheet: the accountant portal's (`accountant-routes.js:595-599` → `public/accountant-client.html:1030`). It reports `accountsReceivable` / `accountsPayable` / `totalPayroll` and has **no cash line at all**, so it does not carry this defect — but it means the two balance sheets in this product have **different asset structures** (`assets = ar` in the portal, `assets = cash + ar` in the app) and therefore report different Total Assets and different Equity for the same books. Logged here as part of this row's enumeration rather than split off, because removing the fabricated `cash` line is also what reconciles the two.

**Course of action — TAKEN (option a).** Owner ruling 2026-08-03: report it as not tracked. Option (b), removing the report until a cash account exists, was the alternative; it was not needed once the fabrication was removed at the source. Building a real cash account remains a schema decision, owner-gated, and is not this finding.
**Done when — MET, with one part deferred to F128.** No clamped accrual figure is presented as cash: `cash` is `null`, `totalAssets`/`equity` no longer consume it, and the app's balance sheet now has the SAME asset structure as the portal's (AR alone), so the two report the same Total Assets for the same books. **Deferred:** rendering the literal words *"Not tracked"* in a UI — there is no live UI to render them in (the renderer is shadowed, F128). The response carries `cash: null` + `cashTracked: false` so that whatever revives the report has an unambiguous contract to render against.

---

### F124 ✅ **FIXED** (`bb50d2f`, 2026-08-03) — was 🟡 MEDIUM — Three client money surfaces were never FX-converted and/or hardcoded `'$'` — the F34 Path B coverage gap
**Status:** ✅ FIXED and probe-verified, including the failure path. Owner **visual** check outstanding. All three pre-dated F120; none was caused by it.

**The rule applied.** A figure's SYMBOL must name the currency the VALUE is genuinely in. Two ways to break it, both live here: a hardcoded `'$'` (wrong for any non-USD entity) and `activeCurrency` stamped on a figure nobody converted (the F34/F59/F70 defect). The fix picks per surface, on evidence, rather than applying one rule everywhere.

**What changed, surface by surface.**

| Surface | Values are | Treatment |
|---|---|---|
| Dashboard **cash chart** | were native, **now CONVERTED** | `_applyConvertedChart` extended to `charts.cash`; axis + tooltip keep `activeCurrency`, which is now true |
| **MRR / ARR** page (cards + axis) | native, unconverted | new `_fmtMoneyNative` — the **entity's** symbol |
| **Scenario planner** (cards + axis) | native, unconverted | same; the local `S` shadow deleted |

**One new shared helper, not N hand-edits.** `_nativeSymbol()` / `_fmtMoneyNative(n)` (`app-main.js`, beside `_fmtMoneyAbbr`/`_fmtMoneyExact`) with the choosing rule written down at the definition: value already in `activeCurrency` → the abbr/exact pair; value in the ENTITY's currency with no conversion applied → `_fmtMoneyNative`. The scenario planner's `const S = v => window._fmtMoney(v,'$')` was **deleted, not edited** — a second local money formatter is exactly what class C4 closed.

**The cash chart got a real fix, not a relabel.** No new FX wiring was needed and no client rate math was added: monthly profit **is** revenue − expenses (the native path does `PROFIT[i] = REV[i] − EXP[i]` at `app-main.js:1483`), so subtracting the two SERVER-converted buckets already in the overlay's payload gives converted profit by the same arithmetic. Not clamped at 0 the way the bars are — a loss is a real value here and `Math.max` would erase it. `updateCharts` now repaints the native series too, so switching back from a display currency has a way home; without it the chart would have kept converted figures under the native symbol — the same mislabelling, reversed. `_cashSeries()` was extracted so the native path and the overlay build the series from ONE implementation.

> ### 🔴 WHAT THIS FIX UNCOVERED — `_applyConvertedChart` HAD NEVER RUN. Logged as **F125**.
>
> The cash conversion was first written against `window.charts`, copying the overview line beside it. It would have been a no-op, and so has the overview line always been. `charts` is declared `let charts = {}` (`app-main.js:1598`), and a top-level `let` in a classic script binds in the **script scope**, never on the global object — so `window.charts` is permanently `undefined`.
>
> **Proven by execution, not by citing the spec:**
> ```
> after a classic script declaring  let charts = {} :
>   typeof window.charts  = undefined
>   typeof window.alsoVar = object   (var, for contrast)
> ```
> **Consequence: F34 Path B "surface 1 — overview chart from server buckets" has never rendered once.** The overlay guarded on a binding that cannot exist. Fixed here by reading the script-scoped `charts` — the binding every other line in the file already uses — and NOT by exposing `window.charts` globally, which would also wake five dead sites in `finflow-api-wiring-dashboard.js`, one of which writes these same two datasets. That would be a second writer of one figure, this codebase's failure mode 2, and it is F125's decision rather than a side effect of a currency fix.
>
> **This also means F120 shipped on a premise that was not yet true.** `baae74b`'s comment says the overview axis is safe because the datasets are already server-converted. They were not — the overlay was dead — so between `baae74b` and this commit the overview axis stamped the display symbol on native values. The tooltip beside it had been doing the same via `S()` for far longer, so F120 did not introduce the mislabel; it did, however, describe a mechanism that was not running. Corrected on the F120 row.

**How it was verified.** `tests/harness/f124-native-currency-surfaces.js` — **22/22**. Real `renderMRRChart`, `updateScenario`, `renderScenarioChart` from `index.html` and real `_applyConvertedChart`, `updateCharts`, `buildCashChart`, `_cashSeries` from `app-main.js`, run against a recording `Chart` and a stub DOM (the chart LIBRARY is stubbed; every money function is real source). Entity **TTD**, display **EUR**, so `'$'`, `'TT$'` and `'€'` are three different strings and no two failure modes can be confused (Rule 4).

**Failure paths EXECUTED (Rule 14), three of them:**
- pre-fix `index.html` sources rebuilt and run → scenario cards and axis both render `'$'` on a TTD entity;
- the `window.charts` guard restored → the overlay silently leaves both charts native: `overview [1000,2000]`, `cash [600,−1000]` — the shipped behaviour, demonstrated;
- the converted path asserted with a **loss** in it → `cash [300,−500]`, so a clamped copy of the bars' `safe()` would have shown `[300,0]` and been caught.

**⚠️ Limit.** Symbols are asserted as strings; no pixels are rendered. The **visual** confirmation is outstanding.

**Course of action for the rest of the class — NOT fixed here, each with a number:** **F125** (`window.charts` and its five dead consumers), **F126** (MRR and Scenario are still not FX-*converted*, only honestly labelled), **F127** (`_mrrChartData` has no writer), **F129** (the remaining hardcoded-`'$'` business-money surfaces).

---

**Original finding (for the record):**

**Status:** OPEN, confirmed by reading. All three **pre-date** F120 and none is caused by it.

F120 fixed the two dashboard chart axes. The enumeration that produced it (see the correction on F120 — the original grep undercounted by half) turned up three further surfaces where the currency **label** and the currency the **value is actually in** can disagree. They are grouped because they share one root: **F34 Path B converted five surfaces and stopped** — KPI tiles, overview chart, expense breakdown, transactions list, investments. Anything else that renders business money was never enumerated.

| # | Surface | Value is in | Label says | Site |
|---|---|---|---|---|
| a | Dashboard **cash chart** (`#cashChart`) | **native** — `PROFIT[]`, and `_applyConvertedChart` (`app-main.js:4778`) touches `charts.overview` **only** | `activeCurrency` — via `S()` in the tooltip (`:5011`) and, since F120, the axis too | `app-main.js:4974-5020` |
| b | **MRR / ARR** page | native recurring-invoice amounts | hardcoded `'$'` on the cards **and** the chart axis | `index.html:4264-4265`, `:4294` |
| c | **Scenario planner** | native, derived from `BASE` (itself on a stale basis — **F44**) | hardcoded `'$'` via a **local `S`** that shadows the global one | `index.html:6280`, `:6287-6295`, `:6327` |

**(a) is the one with teeth, and F120 did not create it.** The cash chart's tooltip has stamped `activeCurrency` on native values since the F70 fix; F120 brought the axis into line with that tooltip, which is an improvement in the native case (entity currency TTD previously showed `TT$` tiles beside a `$` axis) and changes nothing about the underlying gap: **the series is never converted.** The fix is a converted series — extend `_applyConvertedChart` to `charts.cash`, or blank the chart under a display currency the way `_applyConvertedKPIs` blanks the tiles — **not** a different symbol. Recorded in-code at `app-main.js:5016` so the next reader does not mistake the F120 comment for coverage.

**(b) and (c) are internally consistent today, which is why they must be fixed whole.** On both pages the cards and the axis hardcode the same `'$'`, so they agree with each other and disagree with the rest of the app. Fixing only the axis — the obvious reading of "finish F120" — would make the axis disagree with the cards beside it: one contradiction traded for another. Each page needs its cards and axis moved together, and (c) additionally needs its shadowing local `S` deleted rather than edited (it is a second money formatter, the exact class C4 closed).

**Course of action.** Owner-gated, post-launch, one surface per commit: (a) convert the cash-chart series or blank it; (b) route MRR/ARR through the live symbol lookup, cards and axis in one change; (c) delete the local `S` at `index.html:6280` so the panel uses the global one, then the axis follows for free. Do **not** batch them — they are three different surfaces with three different data provenances, and (c) is entangled with F44.
**Done when:** every client surface rendering business money either shows a figure in `activeCurrency` labelled with `activeCurrency`'s symbol, or shows `—` — and no surface carries its own private `'$'`.

---

### F125 🟠 HIGH — `window.charts` is unreachable, so every consumer of it is dead code — the FX chart overlay has NEVER run — **NEW (2026-08-03, PROVEN BY EXECUTION), PARTIAL**
**Status:** 🟠 **PARTIAL.** The one instance that blocked F124 is fixed (`bb50d2f`); the other **five** are open and need an owner decision, not a copy of the same edit.

**The mechanism.** `app-main.js:1598` declares `let charts = {};`. A top-level `let` in a **classic script** creates a binding in the script's declarative environment record — it does **not** become a property of the global object. `window.charts` is therefore `undefined` forever, and a repo-wide grep confirms nothing else ever assigns it.

**Proven by execution, in jsdom, not by citing the specification:**
```
after a classic script declaring  let charts = {} :
  typeof window.charts  = undefined
  typeof window.alsoVar = object   (var, for contrast)
```

**Every `window.charts` consumer, enumerated (Rule 13) — 7 sites, 2 files:**

| # | Site | What it was supposed to do | State |
|---|---|---|---|
| 1 | `app-main.js` `_applyConvertedChart` — overview | F34 Path B surface 1: paint the SERVER-converted monthly buckets | ✅ fixed `bb50d2f` (reads the script-scoped `charts`) |
| 2 | `app-main.js` `_applyConvertedChart` — cash | F124's converted cash series | ✅ fixed `bb50d2f` |
| 3 | `app-main.js:4971-4973` | destroy orphaned Chart instances, then reset the registry | **OPEN** — the whole `if(window.charts){…}` block is unreachable, including its `window.charts={}` |
| 4 | `finflow-api-wiring-dashboard.js:91,98,101` | update the overview chart from the wiring's monthly arrays | **OPEN** |
| 5 | `finflow-api-wiring-dashboard.js:394` | build the chart if it is missing | **OPEN** — reads `!window.charts?.overview`, always true, so it calls `buildCharts()` **every time** |
| 6 | `finflow-api-wiring-dashboard.js:465` | same guard, second site | **OPEN** |
| 7 | `finflow-api-wiring-dashboard.js:467-472` | write `revByMonth`/`expByMonth` into the overview datasets | **OPEN** |

**The consequence that matters.** **F34 Path B surface 1 has never rendered.** The audit has carried it as complete since `063c98c`/`5639f06` — the F33/F34 reconciliation row in this file lists "chart (`app-main.js:4434`)" among the four verified client surfaces. It was verified by reading. Under a display currency the overview chart has always shown NATIVE figures, while its tooltip (`S()`) and, since F120, its axis both stamped the display symbol on them.

**Why the rest is NOT fixed by the same one-line edit.** The obvious "root fix" — add `window.charts = charts;` beside the declaration — would wake all five remaining sites **at once**, and site 7 writes the *same two datasets* that `_applyConvertedChart` writes. That is a second writer of one figure appearing without anyone choosing it: failure mode 2, arriving as a side effect of a one-line tidy-up. It needs the owner to decide which writer owns the overview chart, and it needs the wiring paths executed before they go live — none of them has ever run.

**Class beyond this variable (Rule 13).** The real class is *"a top-level `let`/`const` in `app-main.js` that other files reach for via `window.`"*. `charts` is the instance that was caught. The same shape is already documented working correctly elsewhere — `finflow-api-wiring-dashboard.js` deliberately uses bare `currentPeriod`/`currentMonthIdx` with `typeof` guards *because* `window.*` would be `undefined` for them (recorded on **F61**) — which shows the trap was known for two variables and never swept for the rest. A full sweep of `let`/`const` top-level declarations in `app-main.js` against `window.<name>` reads in the wiring files is the enumeration this finding needs and does not yet have.
**Course of action:** (1) owner decides the overview chart's single writer; (2) sweep the `let`/`const`-vs-`window.` class properly; (3) then wake or delete sites 3-7, each executed, not pattern-mirrored (Rule 14 — none of these paths has ever run, so "it looks equivalent" is worth nothing here).
**Done when:** no code reads `window.<name>` for a binding that `app-main.js` declares with `let`/`const`, and every chart dataset has exactly one writer.

---

### F126 🟡 MEDIUM — MRR/ARR and the Scenario planner are never FX-converted at all — **NEW (2026-08-03, found while fixing F124), OPEN**
**Status:** OPEN. **F124 made these surfaces HONEST, not converted** — do not read that tick as coverage.

Both render business money that no code converts:
- **MRR / ARR** — `loadMRRData` (`index.html`) sums `GET /api/recurring-invoices` with no `?display=` param and no rate applied.
- **Scenario planner** — projects from `window.BASE`, set by `finflow-api-wiring-medium.js:996` from native invoice/expense rows (and on a superseded basis besides — **F44**).

Since F124 they carry the **entity's** symbol, so nothing is mislabelled. But a user who sets a display currency sees the dashboard in EUR and these two pages in TT$, with no explanation on screen. That is honest and confusing, which is better than dishonest and tidy — and it is not finished.

**What finishing requires** (and why it was not done inside a labelling commit): a converted source. Either `?display=` support on `/api/recurring-invoices` plus a converted `BASE`, or — better, and consistent with where F34 Path B already went — server-computed figures for both surfaces so the client never holds a rate. Client-side conversion is explicitly the wrong answer: the F59 landmine note records that `S()` has never converted and must not start, because the server already returns converted figures and a working client `fxConvert` would double-convert everything on the dashboard.
**Course of action:** owner-gated, post-launch, one surface per commit. Until then, consider a visible "shown in <CCY>" note on both pages so the mixed-currency screen explains itself.
**Done when:** with a display currency armed, MRR/ARR and the Scenario planner show converted figures under the display symbol — or say plainly why they do not.

---

### F127 🟡 MEDIUM — `window._mrrChartData` has no writer anywhere: the MRR chart is a permanent flat zero line — **NEW (2026-08-03, found while fixing F124), OPEN**
**Status:** OPEN, confirmed by grep and by reading.

`renderMRRChart` (`index.html`) does:
```js
const data = window._mrrChartData || new Array(12).fill(0);
```
```
$ grep -rn "_mrrChartData" public/ --include=*.js --include=*.html | grep -v finflow-bundle.js
public/index.html:  const data=window._mrrChartData||new Array(12).fill(0);
```
**One hit. The reader. There is no writer in the repository.** So the fallback is not a fallback — it is the only path, and the MRR chart has always drawn a flat line at zero beneath MRR/ARR cards showing real figures.

**Class:** the same shape as **F65** (controls that report work they did not do) — a surface presenting as live with nothing behind it — and it belongs with the **B10** honesty pass. It is a *chart* rather than a button, which is why F65's enumeration missed it: that sweep walked controls, not renderers.
**Course of action:** either populate `_mrrChartData` from the recurring-invoice history (12 monthly MRR points — the data exists), or remove the chart until it can be. Do not leave a zero line on a money page. If it is populated, F126 applies to it as well.
**Done when:** the MRR chart plots real monthly MRR, or it is not on the page.

---

### F128 🟠 **PARTIAL** (`83e92de`, 2026-08-03) — the WRONG FIGURE is fixed; the shadowing is not — `generateReport`'s live copy used the PRE-F32 paid-only basis, and the app-main report bodies remain dead code
**Status:** 🟠 **PARTIAL**, per the tick-off corollary — the reachable money defect is fixed and probe-verified; the dead-code half is untouched and needs an owner decision. Found by running the Rule 1 check before editing — the check that would also have prevented the F123 mis-rating in this same file.

> ### ⚠️ THE FIRST CUT OF THIS FIX WAS HALF THE CLASS. Recorded because it is Rule 13, again.
>
> The modal was fixed and the row was written as though the finding were closed. **`window.renderReports` (`finflow-api-wiring-extra.js:256`) carried the identical defect** — `invoices.filter(status === 'paid')` for revenue and `Σ expenses` for opex, feeding the three metric cards on the Reports PAGE. Fixing only the modal would have left the page contradicting the modal launched from it, and both contradicting the dashboard: three numbers, one screen away from each other.
>
> **Rule 1 mattered here in the opposite direction to F123.** `renderReports` is one of the five **WRAPPER** overrides, not a replacement — it calls `_origRenderReports()` first (painting the static report lists) and *then* overwrites the metric cards. So the wiring copy owns the values; app-main's own paid-only recompute feeds only the `onclick` arguments that the replacement `generateReport` ignores. Patching app-main would have rendered nothing.
>
> Both surfaces are fixed in this commit, and the probe asserts **page card == modal card** so they cannot drift apart again.

**What changed (the money half — BOTH surfaces).** Neither `window.generateReport` (the modal) nor `window.renderReports` (the page) computes money any more. Both source:

| Figure | Now | Was |
|---|---|---|
| Revenue | `window.computeRevenue(period)` | `invoices.filter(status === 'paid')` — pre-F32 |
| Expenses | `window.computeExpenseBreakdown(period).total` | `Σ expenses` — no bills, no payroll, no contras |
| Net profit | `revenue − COGS − expenses` | `revenue − expenses` — COGS omitted |
| Outstanding | unchanged — `_arOutstanding` (F56) | already canonical |
| Category rows | `breakdown.byCategory` (period-scoped) | its own all-time recompute |

**Delegation, deliberately, not better arithmetic (Rule 2).** This figure already had four implementations — `computeBooks`, `/api/reports`, the client pair, and this one. Writing a fifth *correct* one just relocates the next divergence. `computeRevenue` / `computeExpenseBreakdown` are the canonical CLIENT pair the dashboard KPIs read, they carry every leg including the F58 contras, and step 4 gates them against `VERIFICATION.md` across four timezones. Sourcing from them makes Reports agree with the dashboard **by construction** (Rule 6) — a future basis change lands on both at once, which is the entire point.

**COGS was the last gap, and it was caught by measurement, not review.** With revenue and opex delegated, the probe still read net **−300** where every other surface says **−1,700** — exactly the 1,400 of FY COGS. `updateDashboard` composes `revenue − COGS − opex` (`app-main.js:2167`, mirrored at `:4502`/`:4539`); the report now does the same via the period-scoped `window._cogsTotal` (F25).

**Period — decided and STATED.** The report follows the app's active period selector, like every other money surface, and the modal now labels it ("issued, this fiscal year"). It was silently all-time; changing that without saying so on screen would move a number the user had no way to explain. `currentPeriod` is a top-level `let`, so it lives in the shared global *lexical* scope and is read bare with a `typeof` guard — not via `window` (F125).

**Two honesty fixes in the same render.** The Expenses card says "incl. bills & payroll"; the category table is headed "recorded expenses only", because `byCategory` covers manual expense rows and therefore does **not** sum to the Expenses total above it. Money figures use `_fmtMoneyNative` — they come out of the engines unconverted (F124's rule), and the shared `money()` helper would have stamped `activeCurrency` on them.

**A stale caption is its own defect.** The page's revenue card read *"Paid revenue this period"* — wrong on both counts once the figure is accrual **and** period-scoped. It now reads "Revenue issued, this fiscal year", and the probe asserts the old wording is gone rather than merely that the number changed.

**How it was verified.** `tests/harness/f128-reports-canonical-source.js` — **24/24**. Runs the REAL `generateReport` **and** the REAL `renderReports` bodies from the wiring source against the REAL engines from `app-main.js`, seeded from `seedData.js`, asserting against `expected.js` (Rule 6 — the hand-supplied oracle, not the other engine). Includes `page card == modal card`, so the two surfaces are pinned to each other as well as to the oracle.

**Rule 4 — this seed discriminates hard:**
```
canonical revenue 8800   ·  PAID-ONLY would give 1000
canonical opex    9100   ·  EXPENSES-ONLY would give 1600
canonical net    -1700   ·  omitting COGS gives -300
```
**Failure paths EXECUTED, both surfaces:** each pre-fix body was rebuilt and run. Modal → revenue **1,000**, expenses **1,600**. Page → revenue **1,000**, profit **−600** (against the canonical **−1,700**). Every figure moved.

> **The probe's own first cut had TWO defects, recorded because they are instructive.** (1) It read `p.bill_ref`, a field that does not exist, so the B2 payment became an unlinked orphan and FY opex read **9,600** against 9,100 — precisely the self-inflicted double-count `VERIFICATION.md`'s seed-fidelity warning describes, reproduced inside a test. (2) Its HTML parser stripped non-digits from the whole regex match rather than the capture group, so `font-size:16px` leaked in and every figure came back as **−16**. Both were caught because the numbers were wrong in a way the oracle noticed; a probe asserting something looser would have gone green on both.

**STILL OPEN — the shadowing half, which is why this row is PARTIAL.** `app-main.js:5559`'s `generateReport` remains dead code, and with it three genuinely-written report bodies: the **P&L**, the **Balance Sheet** (whose "Cash & Equivalents" line is F123's `cash: null` contract, still unrendered), and the **Cash Flow Statement** (already wired to the canonical shared `window._cashMonthly` cache — the best of the three). The live copy still ignores the report name and renders one generic card set for every report. Reviving them is an owner decision, not a side effect of a basis fix, and it must not be done by editing the shadowed copy (F75).
**Done when:** the Reports page renders per-report bodies from the canonical figures, no `generateReport` copy is shadowed, and F123's "Not tracked" is what the Balance Sheet body shows.

---

**Original finding (for the record):**

**Status:** OPEN. Found by running the Rule 1 check before editing — the check that would also have prevented the F123 mis-rating in this same file.

**Rule 1, executed:** `app-main.js:5559` declares `generateReport`; `finflow-api-wiring-extra.js:488` assigns `window.generateReport = async function (name)` with **no `_orig` reference** — a replacement, in bundle source **#7**, which loads after `app-main.js`. Loading them in index.html's order and calling the global:
```
after app-main.js  : APP-MAIN COPY
after the bundle   : WIRING COPY
```

**What is dead.** `app-main.js`'s entire report renderer — the **P&L** body, the **Balance Sheet** body (the *"Cash & Equivalents"* line that F123 was briefly mis-rated on), and the **Cash Flow Statement** body, which is the one wired to the F57/D3 shared `window._cashMonthly` cache. None of it executes. The two `onclick="generateReport(…)"` call sites resolve through the global object, so the wiring copy always wins.

**What runs instead, and why that is the actual defect.** The live copy **ignores the report name entirely** — every report renders the same generic card set — and it computes revenue as:
```js
const paid    = invoices.filter(i => i.status?.toLowerCase() === 'paid');
const revenue = paid.reduce((s, i) => s + (i.amount || 0), 0);
```
**Paid-only.** That is the pre-**F32** basis, superseded on 18 July by ACCRUAL, ISSUE-BASED recognition (Rule 11) across `computeBooks`, `computeRevenue`, `/api/reports`, `/books`, the monthly buckets and the accountant portal. It is the same survival F76 records for `GET /api/tax-filing` — and unlike that endpoint, **this one is reachable**: the Reports page's "Generate ↗" button. Expenses are all-time and unwindowed; only Outstanding was ever brought up to date (`_arOutstanding`, F56).

So a user opening any report gets a revenue figure that disagrees with the dashboard, and three genuinely-written statements they can never see.

**Severity HIGH** on the reachable wrong figure, not on the dead code. The dead code is what makes it expensive to fix correctly.

**Class (Rule 13).** Two classes intersect here and both are already named: **F75** (fixes applied to shadowed copies — 28 shadowed functions, 23 replacements; `generateReport` should be checked against that inventory, and if it is absent the inventory is incomplete) and the **pre-F32 basis survival** class with F76. Neither list currently contains this function.
**Course of action:** owner-gated. Either revive the app-main bodies onto the runtime path (they are the better implementation — real per-report bodies, and the Cash Flow one already reads the canonical shared cache) and delete the wiring replacement, or fix the wiring copy's basis and accept one generic report. **Do not edit the app-main copy while it is shadowed** — that is the F75 trap, and F123 came within one edit of it. Whichever way it goes, F123's `cash: null` / `cashTracked: false` contract is what the Balance Sheet body must render as *"Not tracked"*.
**Done when:** the Reports page renders per-report bodies from the canonical accrual figures, no `generateReport` copy is shadowed, and its revenue equals `/api/reports` revenue for the same period.

---

### F130 ✅ **FIXED** (`bb50d2f`, 2026-08-03) — was 🟠 HIGH · **LAUNCH BLOCKER B12** — An expired trial rendered as a BROKEN APP: every read 402s, the client discarded the code, and the only trial UI vanishes on expiry
**Status:** ✅ FIXED and probe-verified, including the discrimination cases. Owner **visual** check outstanding. The read-only-vs-hard-lock product decision is **separate and still open** — see the bottom of this row.

**What was wrong — three things lining up.**

1. **The server blocks everything.** `checkPlan` (`server.js:392-406`) 402s every `/api` request with `{error, code:'TRIAL_EXPIRED'}`. Auth routes are exempt (`server.js:643`), so the user **logs in successfully** and the app **boots successfully** — and then every single data read fails.
2. **The client threw the reason away.** `api()` (`public/finflow-api.js`) did `throw new Error(data.error || res.status)`. Status gone, `code` gone. A caller cannot branch on information the thrower discarded, so a 402 TRIAL_EXPIRED was indistinguishable from any other failure and fell into the F67/F96 error path — **"Unable to load"** cards, plus `sb-brand-name` reading "Unable to load" in the sidebar.
3. **The one piece of trial UI bails at exactly the wrong moment.** The countdown banner returns early on `if(daysLeft<=0||daysLeft>30)return;` (`index.html`) — it disappears the instant the trial ends.

**Net effect: a customer whose trial expired saw a broken product, with nothing on screen saying why and no way to pay.** That is the worst possible moment to look like a bug, and it is a **launch blocker** on commercial grounds rather than accounting ones — every trial user reaches this state by definition.

**What changed.**
- **`finflow-api.js`** — the thrown Error carries `status` and `code`. The message is unchanged, so no existing caller that reads `err.message` behaves differently.
- **`app-main.js`** — new `_ffShowTrialExpired(message)`: ONE blocking, full-screen, **idempotent** gate with an Upgrade CTA routing through the existing `showPage('pricing')` (hard `href` fallback if the SPA router is not up — the whole point is that this fires when things are degraded). Placed in `app-main.js` because it loads synchronously *before* index.html's inline scripts and before the deferred bundle, so every caller can reach it whenever the 402 lands.
- **`app-main.js` `_pick`** — recognises 402 + `TRIAL_EXPIRED`, raises the gate, and the `loadEntityData` catch **short-circuits before `_dashSetState('error')`**. Checked before the fatal/non-fatal split: a 402 on `customers` is the same account-wide event as a 402 on `invoices`.
- **`index.html` `_loadEntitiesFromDBImpl`** — the FIRST fetch on a cold boot, so this is where the experience is decided. Raises the gate and returns **`true`**, so the boot memo latches (F97) instead of re-fetching a guaranteed 402 on every trigger.

**How it was verified.** `tests/harness/f130-trial-expired-paywall.js` — **21/21**, executing all three real code paths against the verbatim 402 body `checkPlan` sends.

**Rule 4 — the discriminator is the CODE, not the status.** A fix keyed on "any 402" or "any failure" would pass the happy case and be wrong, so the probe asserts the negatives too: a **402 without `TRIAL_EXPIRED`** (e.g. the PL#3 `ENTITY_LIMIT` 402) does **not** gate and still throws with its own code; a **500** does not gate (F67 owns it); a **401** does not gate and still returns empty (the auth gate owns it). Idempotency is asserted by firing the gate five times — `loadEntityData` runs five loaders in one `Promise.all`, so without the guard a boot would stack five overlays.

**⚠️ Limits.** The overlay is asserted structurally — the DOM is a stub and no browser renders it, so its **appearance is a visual check** and is outstanding. The CTA is asserted to route to `showPage('pricing')`, not that the pricing page then sells anything.

> ### ⬜ SEPARATE AND STILL OPEN — hard-lock vs READ-ONLY. Flagged, deliberately NOT built.
>
> This fix makes the *failure* honest. It does **not** settle what an expired trial should DO. The two options are materially different products:
> - **Hard lock (current behaviour, now explained).** Simple, and it is what the server already enforces.
> - **Read-only** — books visible, writes blocked. Friendlier, and what most accounting products do: locking someone out of their own financial records to sell them a plan is a poor trade, and an accountant mid-close would be stuck.
>
> Read-only is a **server** change (`checkPlan` would allow GETs and 402 only mutations), not a client one, so it is not a variation on this commit. Owner decision.

**Numbering note.** Drafted in conversation as "F125" before that number was taken by the `window.charts` finding. It is **F130**; F125 is unrelated.
**Done when:** an expired-trial user sees one clear upgrade state on any page load, never "Unable to load" — and the hard-lock/read-only question has an owner ruling.

---

### F129 🟢 LOW — Residual hardcoded-`'$'` business-money surfaces — the rest of F124's class — **NEW (2026-08-03), OPEN**
**Status:** OPEN, enumerated. Logged so F124's tick is not mistaken for closing the class.

F124 fixed the three chart surfaces it was scoped to. The full grep for hardcoded-`'$'` money renders across the client returns these **business-money** instances still open:

| Site | Surface | Note |
|---|---|---|
| `app-main.js:1069-1070` | manual-journal Dr/Cr totals | entity money |
| `app-main.js:2854`, `:3719` | payroll net-pay previews | entity money |
| `index.html:4228` | budget actual / target rows | entity money; see also **F45** (actuals are lifetime, not periodic) |
| `app-main.js:~5481` | the Reports body `fmt` helper | **inside the dead block — F128.** Fix it when that code is revived, not before |

**Deliberately EXCLUDED, with reasons** (so a future pass does not re-flag them): `app-main.js:4168` `S2` and `index.html:6699,6726-6730` are **personal / investment** surfaces, USD-priced by design and governed by `persCurrency`; `index.html:5807-5808` are **plan prices**, genuinely USD; `app-main.js:2654` is explicitly labelled `USD/mo`.

**Rated LOW** because each is a single figure on a secondary surface and none feeds a headline total — but the count is the point: F120's enumeration said two sites, F124's said three surfaces, and the real class is larger than both. The fix is mechanical now that `_fmtMoneyNative` exists.
**Done when:** no client surface rendering ENTITY money carries a literal `'$'`, and the excluded set above is the only `'$'` left.

---

### F54 🟠 HIGH — Team-member data scope is incoherent (reads actor-scoped, writes account-scoped) — **NEW**
**Status:** OPEN, verified in code. Reachable — the invite/accept flow is live and writes `member_user_id` (`server.js:2637-2642`).

**What's wrong.** The account resolver works: an active membership sets `req.accountId` to the owner's id (`server.js:611-645`), and `scopeId(req)` returns it (`711`). But only **86** call sites use `scopeId(req)`; **34 data routes read `req.session.userId` directly**, and every create writes `user_id: req.session.userId`. The split is by table, not by verb:

- **Fully actor-scoped** (member sees + creates in their own empty account): invoices `849/857/863`, expenses `896`, customers `939/943`, inventory `967`, items `1008`, payroll `1102`, journals `1550`, chart_of_accounts `1591`, holdings `1335`, goals, projects, personal_transactions, personal_accounts, snapshots, documents, templates, autocat_rules, audit_log `1629`, timesheet `2351`, banking `3086`.
- **Read actor-scoped but UPDATE/DELETE account-scoped** — quotes `1912/1927`, vendors `1947/1963`, bills `1986/2002`, recurring_bills `2027/2041`, recurring_personal_transactions `2067/2085`, recurring_invoices `2105/2120`, sales_receipts `2154/2159`, payments_received `2193/2199`, credit_notes `2235/2241`, payments_made `2274/2297`, vendor_credits `2339/2345`.

**Consequences.** (1) An invited member logs in to a **completely empty app**. (2) Everything they create lands under their own `user_id` and the owner never sees it. (3) On those 11 tables they can still `PUT`/`DELETE` the **owner's** rows by id, even though the list showed them nothing.

**Course of action.** Pick one and apply it uniformly:
- **Fix (1 day):** replace `req.session.userId` with `scopeId(req)` in every *data* route (reads, creates, `ownedBy()` calls) and keep `req.session.userId` **only** for actor identity — `logAudit`, session writes, `/api/me`, auth routes. `ownedBy(table, id, userId)` (`server.js:713`) gains a `scopeId` caller everywhere.
- **Defer (30 min, recommended for this launch):** hide the team-invite UI and return 403 from `POST /api/team/invite` and `/api/team/accept`. Ship without the team feature; do the sweep after launch.

**Done when:** owner invites a member → member logs in → sees the owner's invoices/expenses → creates an expense → **the owner sees it** → member deletes it → gone for both. And an actor-identity audit row still records the *member's* id, not the owner's.

---

### F55 ✅ **FIXED** (`e1a8f3e`, 2026-07-22) — was 🟠 HIGH — Dashboard Revenue / Expenses / Net Profit never repaint after a mutation
**Status:** ✅ **FIXED & harness-verified.** Owner live-check outstanding (see "Still to confirm live" below).

**What changed.** `refreshFinancials` (`finflow-api-wiring-postgres.js:204-217`) now runs `_refreshDashboardUI()` and `updateDashboard()` as **two sequential steps** instead of `if/else if`. This makes the mutation path identical to the boot path, which already did exactly this (`finflow-api-wiring-dashboard.js:398-400`) — so the fix adopts an existing correct pattern rather than inventing one. The `updateDashboard()` call is wrapped so a KPI render error cannot abort the personal-finance and budget refreshes below it; the error is `console.error`'d, never swallowed (class **C6**).
Also corrected the false comment at `finflow-api-wiring-dashboard.js:459` that claimed *"refreshFinancials calls updateDashboard right after this"* — it did not, and that comment is why the defect survived earlier passes. It now states the requirement on callers.

**How it was verified.** Extracted-block harness, **16/16 green**, run against **both** `finflow-api-wiring-postgres.js` **and** the regenerated `finflow-bundle.js`: both globals run · `updateDashboard` runs **last** · no `else if` survives (structural guard against regression) · a throw in `updateDashboard` does not propagate and **is** logged · missing globals don't throw · `updateDashboard`-only still runs · boot path unchanged · `_refreshDashboardUI` still does not write the canonical trio (guards against a re-introduced F7 double-writer). `node --check` clean; bundle regenerated + drift-checked.
*Harness note:* the last assertion initially failed on the function's own **doc comment**, which names those element ids to warn callers — the check now strips comments and asserts on executable code only. Worth knowing: a raw text grep for those ids in that function reports a false positive.

**Still to confirm live (owner, ~2 min):** with the dashboard open, add an invoice → `d-rev` and `d-profit` move with **no** reload and **no** period switch. Repeat for expense add, invoice delete, bill add.

**Original finding (for the record):**

**What's wrong.** `refreshFinancials` (`finflow-api-wiring-postgres.js:115`) ends with:
```
if (typeof window._refreshDashboardUI === 'function') { window._refreshDashboardUI(); }
else if (typeof window.updateDashboard === 'function') { window.updateDashboard(); }   // :208
```
`_refreshDashboardUI` is defined unconditionally at `finflow-api-wiring-dashboard.js:415`, so the `else` branch is **dead code**. And `_refreshDashboardUI` deliberately does **not** write `d-rev`/`d-exp`/`d-profit` — a comment at `finflow-api-wiring-dashboard.js:462-464` says *"those cards are now owned solely by app-main updateDashboard, which refreshFinancials calls right after this."* **It does not.**

`updateDashboard()` is invoked from exactly two places in the tree: `finflow-api-wiring-dashboard.js:400` (boot / entity switch) and the dead `postgres.js:208`. Plus `_safeRender(updateDashboard)` inside `loadEntityData` and `refreshAllPeriodData` (period switch).

**Effect.** Save an invoice → the invoice list updates, the chart updates, Outstanding updates — **Revenue, Expenses and Net Profit do not**, until you switch period or reload. Same for every delete and every expense.

**Course of action.** Change the `else if` to an unconditional sequenced call — `_refreshDashboardUI()` **then** `window.updateDashboard()` — and delete the misleading comment at `finflow-api-wiring-dashboard.js:462`. One-line change in `postgres.js`; regenerate the bundle.
**Done when:** with the dashboard open, adding an invoice moves `d-rev` and `d-profit` without any reload or period switch. Same for expense add, invoice delete, bill add.

---

### F56 ✅ **FIXED** (`0756960`, 2026-07-22) — was 🟠 HIGH — Outstanding / AR disagreed across five surfaces
**Status:** ✅ **FIXED & harness-verified.** Surfaced by the owner: *Outstanding **$1.4K**, subtitle **"All invoices paid"**.*

**Two defects.** The subtitle only checked whether anything was **overdue** and printed "All invoices paid" whenever nothing was — so a card with real money outstanding was captioned as settled. And `d-outstanding` had **two writers** with **different formulas** (app-main's year-only block + the wiring's `updateKPIs`) — the F7 defect class, regrown.

**What changed.** One canonical `arOutstanding()` (`app-main.js`, exported as `window._arOutstanding`) mirroring the server's `computeBooks` AR leg exactly: `Σ max(0, amount − amount_paid)` over recognized statuses, returning counts too. Applied to **all five** drifted surfaces — dashboard card, invoice stats panel, Invoices page, Payments Received page, customer-detail modal. app-main no longer writes the card at all; the wiring owns it, matching the ownership split already documented there. Subtitle is three-way: *N overdue* / *N unpaid* / *All invoices paid*, amounts suppressed under a display currency.

**Also fixed while here.** `refreshFinancials`' invoice mapper **dropped `amount_paid`** (which `loadEntityData` carries), so after *any* refresh `userInvoices` lost it — and `markInvoicePaid`, which settles `amount − amount_paid`, would try to pay the full amount again on a partially-paid invoice and be rejected **400** by the server's overpayment guard.

**How it was verified.** 30/30. The client helper is compared **case-by-case against a transcription of the server's own AR leg** — fully unpaid, fully paid, partially paid, overdue partial, draft, void, over-credited, legacy status-paid-without-`amount_paid`, mixed book — so the two are checked against *each other*, not against my assumption of the server. Plus: the old formula asserted to genuinely differ, "All invoices paid" unreachable with a non-zero count, app-main writing neither value nor subtitle, every surface calling the one helper, both mappers carrying `amount_paid`.

**Still to confirm live (owner):** record a $400 payment against a $1,000 invoice → dashboard, Invoices page and `/api/reports` all read **$600**, subtitle reads "1 unpaid invoice".

**Original finding (for the record):**

**What's wrong.** Three different formulas write "Outstanding":

| Surface | Formula | Site |
|---|---|---|
| Dashboard card `d-outstanding` (native path) | `Σ amount` over `status !== 'paid'` | `finflow-api-wiring-dashboard.js:188` (and `app-main.js:1975`, year-only) |
| Invoices page `inv-out` | `Σ amount` over `status !== 'paid'` | `finflow-api-wiring-dashboard.js:310`, `postgres.js:129` |
| `/api/reports` + `/books` | `Σ max(0, amount − amount_paid)` over **all recognized** statuses | `server.js:4110-4114` |

Two divergences: (a) a **partially paid** invoice contributes its *full* amount on the client and its *remaining* balance on the server — the exact case F48's AR work was built for; (b) an invoice in a **non-recognized** status (anything outside `pending|overdue|partial|paid`) is counted by the client and excluded by the server.

Secondary: `app-main.js:1973` only writes `d-outstanding` when `currentPeriod==='year'` — but `updateKPIs` overwrites it unconditionally with an all-time figure moments later, so the card ignores the period selector entirely (consistent with the server, which also treats AR as an all-time snapshot — so this half is *correct*, just accidentally).

**Course of action.** Delete both client formulas. Have `updateKPIs` and `updateInvoiceStats` read `outstanding` from the `/api/reports` response the dashboard already fetches, exactly as `_applyConvertedKPIs` does at `app-main.js:4412`. One source, one number.
**Done when:** record a $400 payment against a $1,000 invoice → dashboard Outstanding, Invoices-page Outstanding and `/api/reports.outstanding` all read **$600**.

---

### F57 ✅ **FIXED** (2026-08-02) — was 🟠 HIGH — Cash Flow page uses a different basis from the Dashboard
**Status:** ✅ FIXED and probe-verified, **unblocked by F122**. Owner live-check outstanding.

**What changed.** The dashboard cash card's In/Out/Net now come from `POST /api/reports/cash-flow` — the same endpoint the Cash Flow report reads — summed over the period by the pure `cashForPeriod(rows, period, monthIdx)`. Rows are cached at boot in `window._cashMonthly`, so the card never depends on the report having been opened first (the load-order trap), and both surfaces read that one array, so they cannot drift into two numbers. Previously the card read `getPeriodData()`'s ACCRUAL buckets, which also omit payroll and COGS — a third figure disagreeing with both the KPIs and the report. `cf-avg` and `cf-runway` moved to cash with the net; `cf-in-chg`/`cf-out-chg` were CLEARED rather than left showing accrual deltas beneath cash figures. Label fixed: "Net Profit" → "Net Cash Flow", and the hardcoded "Healthy" indicator (true even in a cash-negative period) now reflects the sign.

**Was blocked, now clear.** This fix was correct-but-unverifiable until **F122**: the card faithfully mirrored an endpoint that omitted paid payroll, so Jul/FY were wrong before the client ever saw them. With F122 fixed, `tests/harness/f57-cash-card.js` goes **14/14** — Jun 500/750/−250, Jul 0/1,850/−1,850, FY 1,500/3,200/−1,700, matching A7.9–17.

**⚠️ DISCRIMINATION TRAP, recorded because it will mislead the next reader.** FY cash net (−1,700) is now numerically IDENTICAL to FY accrual netProfit (−1,700). The collision did not exist before F58 — accrual FY netProfit was −800, and the credit-note contra moved it onto the cash figure. **The FY net cannot distinguish cash basis from accrual**: a card still wired to the old source reads −1,700 there and looks right. June is the discriminating period (cash −250 vs accrual −1,850), and the probe anchors its failure-path assertions there and asserts the collision explicitly so a future seed change cannot silently remove the warning.

**Deliberately NOT done (owner decision outstanding).** `cf-fixed`/`cf-variable` remain an ACCRUAL expense-category split living in a cash card and are not part of In/Out/Net. They now receive the period explicitly — previously called with no argument, so they silently used `currentPeriod` while the rest of the card was scoped by the caller, i.e. two windows in one card. Whether they belong here at all is unresolved.

---

**Original finding (for the record):**

**What's wrong.** `updateCashflow` (`app-main.js:2017`) writes `cf-in`/`cf-out`/`cf-net` from `getPeriodData()` → the `REV[]`/`EXP[]`/`PROFIT[]` monthly buckets. Those buckets **exclude payroll and COGS** by construction (`server.js:4152` comment: *"NO payroll/COGS (the chart never included them)"*; `finflow-api-wiring-dashboard.js:46-108`). Meanwhile `updateDashboard` writes `d-exp` from `computeExpenseBreakdown().total`, which **includes** payroll, and `d-profit` subtracts COGS (`app-main.js:1937-1944`).

So for any business with payroll or inventory, **Dashboard Net Profit ≠ Cash Flow Net**, on the same screen-pair, same period.

Compounding, inside the same function:
- `cf-fixed` + `cf-variable` are computed from `computeExpenseBreakdown().byCategory`, which contains **only raw expense rows** — no bills, no payroll — so `cf-fixed + cf-variable ≠ cf-out` (`app-main.js:2029-2038`).
- `computeExpenseBreakdown()` is called there with **no period argument**, so it silently defaults to `currentPeriod` while `d.exp` is period-scoped by the caller — two windows in one card.
- Income-sources percentages divide `_topClients` (built from **paid-only** invoices, `app-main.js:1451-1457`) by `d.rev` (accrual) → percentages that don't sum sensibly (→ **F69**).

**Course of action — SUPERSEDED (2026-08-02).** The original text offered a choice between rewiring onto the accrual pair or onto cash. Standing decision **D3** settles it: Cash Flow is genuine CASH basis, so the card is sourced from `POST /api/reports/cash-flow` — the same endpoint the Cash Flow report reads — summed over the period by `cashForPeriod` (`app-main.js`). Rows are cached at boot in `window._cashMonthly` so the card does not depend on the report having been opened first, and both surfaces read that one array, so they cannot drift into two numbers (Rule 6).

**Done when (CASH framing — replaces the accrual framing above):** the dashboard cash-flow card's In/Out/Net equal the Cash Flow report and the server for the same period — VERIFICATION **A7.9–17**: Jun 500 / 750 / −250 · Jul 0 / **1,850** / **−1,850** · FY 1,500 / **3,200** / **−1,700**.

**⚠️ BLOCKED ON F122 — the Jul and FY figures are currently UNREACHABLE.** The card is wired and verified to agree with the endpoint, but the endpoint itself omits paid-payroll cash out, so it returns Jul out **750** / FY out **2,100**. The card faithfully mirrors a server leg that is wrong. Jun (500 / 750 / −250) passes today; Jul and FY cannot pass until F122 is fixed. Probe: `tests/harness/f57-cash-card.js`.

---

### F58 ✅ **FIXED** (`8406c43` + `171e97a`, 2026-08-02) — was 🟠 HIGH — Credit notes and vendor credits are never applied as contra (was PL#10, 🟡)
**Status:** ✅ FIXED and gate-verified on BOTH engines, including the failure path. Owner live-check outstanding.

**What changed.** Credit notes are a revenue contra and vendor credits an opex contra, on the server (`computeBooks` + the monthly buckets behind `/api/reports/profit-loss`) and on the client (`computeRevenue`, `computeExpenseBreakdown`, `buildMonthlyArrays`) — the same allowlist and the same window on both sides, so they agree by construction rather than by coincidence (Rule 6). Status vocabulary is credit notes' OWN (`server.js:2307` — `Open`/`Applied`/`Void`, a THIRD vocabulary distinct from invoices and bills); `Open` and `Applied` reduce, `Void` contributes 0, compared case-insensitively.

**SCOPE — P&L only, deliberately.** AR and AP are unchanged (8,500 / 1,100). Per-document contra-AR/AP is the larger per-invoice-link change and is **deferred, not done** — do not read this tick as balance-sheet coverage.

**Verified by execution.** step 2 63/0 · step 3 50/0 (A5 revenue Jun 3,800 / FY 8,800) · step 4 5/0, 18/18 across four timezones spanning the UTC sign boundary, so client == server at every period. Failure path executed: the pre-fix engine reported `A5.1 revenue (Jun) actual 5000 · expected 3800`. Void discrimination executed on both engines independently: flipping CN-2 to `Open` moved June revenue 3,800 → 3,300.

**Seed note (Rule 4).** CN-1 is 1,200 — an amount no other seed row carries. It was briefly 2,000, which is INV-2's amount on INV-2's date for INV-2's customer; that made June revenue 3,000, a figure ALSO reachable by "INV-2 vanished and credit notes were never read". The number could not identify its source. At 1,200 June revenue is 3,800, reachable one way only.

**Related:** the harness commit also fixed **F121** — the step-4 gate was asserting revenue against GROSS `COMPONENTS.revenue`, which went green while both sides were wrong.

---

**Original finding (for the record):**

**What's wrong.** `computeBooks` (`server.js:3915-3922`) loads exactly six collections: invoices, expenses, payments_made, payroll, sales_receipts, bills. **`credit_notes` and `vendor_credits` are read by neither engine.** They are pure CRUD — `server.js:2205-2241` and `2302-2345`, plus client render functions — and never touch a total.

**Effect.** Issue a $2,000 credit note against a customer and **revenue stays $2,000 too high, forever**, on the dashboard, on `/api/reports`, on `/books`, in the accountant portal, and in the AI's answers. Same for vendor credits against AP. Under the issue-based accrual basis the audit committed to (F32 decision note, 18 Jul), a credit note is contra-revenue at its issue date — its absence is a straightforward overstatement.

**Course of action.** Add both as negative legs in **both** engines, symmetrically with the existing bill leg:
- server `computeBooks`: load `credit_notes` + `vendor_credits`; subtract at `date`/`issue_date` inside `inPeriod`, through `sumFX` so FX conversion and coverage flagging come free; add a status allow-list mirroring `RECOGNIZED_BILL` (a `Void` credit note must not reduce revenue).
- client `computeRevenue` (`app-main.js:1717`) and `computeExpenseBreakdown` (`1612`): same subtraction on `window.creditNotes` / `window.vendorCredits`, same `_periodWindow`.
- also subtract from the monthly buckets (`server.js:4147`, `finflow-api-wiring-dashboard.js:64`) so the chart matches.

Linking a credit note to a specific source invoice (proper contra-AR) is a **larger** change — do the aggregate revenue reduction now, the per-invoice link after launch.
**Done when:** a $2,000 credit note dated in the period drops revenue by exactly $2,000 on the dashboard, `/api/reports`, `/books` and the overview chart; a `Void` credit note changes nothing.

---

### F59 ✅ **FIXED** (`c9d2d16`, 2026-07-22) — was 🟠 HIGH — FX display-currency overlay failed silently → native money under a foreign label
**Status:** ✅ **FIXED & harness-verified.** Owner live-check outstanding.

**What changed.** `if(!r.ok) return;` now `throw`s, and the bare `catch(e){}` is a real handler: it blanks all five cards (`d-rev`, `d-exp`, `d-profit`, `d-outstanding`, `d-invest`) to `—` with the hint *"Could not convert to XXX…"* and logs via `console.error` (class **C6** — logged, never swallowed). The `set`/`dash` helpers moved above the `try` so the catch can reach them. The stale-response guard is preserved: a late failure from a currency the user has already switched away from does **not** clobber the newer paint.
**Native flash removed:** `updateDashboard` (`app-main.js:1948-1957`) no longer paints native amounts into the trio when a display currency is armed — `S()` stamps the *display* symbol, so a native value renders under a foreign sign for the whole fetch. It shows `…` and lets the overlay fill. `updateKPIs` (`finflow-api-wiring-dashboard.js:196-211`), which runs *after* the overlay is kicked off, no longer writes `d-outstanding`/`d-invest` under a display currency; the overlay owns them. The invest change-line falls back to a currency-agnostic P/L **percentage**. **Native path byte-identical.**

**How it was verified.** Extracted-function harness, **20/20 green** — the real `_applyConvertedKPIs` run against a stubbed DOM and `fetch`: HTTP 500 · network throw · malformed JSON · success · no-rate-for-pair · **stale-response race**. Plus structural gates on the two flash fixes. F55 harness re-run, still 16/16. `node --check` clean; bundle regenerated + drift-checked.

**Still to confirm live (owner, ~2 min):** set a non-native display currency, block `/api/reports` in DevTools → all five cards must read `—` with a tooltip, **never** a native number under the foreign symbol.

> **⚠️ Landmine documented, deliberately NOT fixed.** `patchSFormatter` calls `fxConvert(n)` with **one** argument (`app-main.js:571`) while `fxConvert` takes **three** (`index.html:5221`) — so it hits its own `!rates[from]` guard and returns the amount unchanged. **`S()` has never converted; it only swaps the symbol.** That is *required* for correctness: the server returns already-converted figures, so a working client-side `fxConvert` would **double-convert every number on the dashboard**. Do not "fix" the arity.

**Original finding (for the record):**

**What's wrong.** `_applyConvertedKPIs` (`app-main.js:4383`) is fire-and-forget from `updateDashboard` (`app-main.js:1948`). On failure it bails without touching the DOM:
```
if(!r.ok) return;                       // app-main.js:4394 — silent
...
}catch(e){}                             // app-main.js:4428 — silent
```
The currency pill has already been relabelled by `updateCurrency` (`app-main.js:4378`), so the user sees **USD figures labelled TTD**. That is the original F34 defect verbatim.

Two adjacent, smaller instances of the same shape:
- `_applyConvertedChart` (`app-main.js:4434`) returns early when `monthly.complete===false`, leaving the **native** chart under the converted label. The comment argues the KPIs already show "—", but the chart still displays native numbers in a foreign currency.
- Ordering: `updateKPIs()` (native) runs *synchronously after* `_applyConvertedKPIs` is kicked off, so `d-outstanding` and `d-invest` visibly flip native → converted on every repaint.

**Course of action.** On any non-native display currency, set the five cards to `'…'` **before** the fetch and to `'—' + title="Could not convert to XXX — retry"` on failure or throw, reusing the existing `dash()` helper at `app-main.js:4400`. Make `updateDashboard` `await` the overlay (or gate the native `updateKPIs` writes behind `!window._displayCurrency`) so there is no native→converted flip. Apply the same `—` treatment to the chart when `monthly.complete===false`.
**Done when:** with a display currency set and `/api/reports` blocked in DevTools, every business figure shows `—` with a hint — never a native number under a foreign symbol.

---

### F60 ✅ **FIXED** (`57ca8b2`, 2026-07-22) — was 🟠 HIGH — Dashboard expense bars: wrong month index + fabricated Rent
**Status:** ✅ **FIXED & harness-verified.**

**What changed.** **(a)** The `EXP_SAL/RENT/SW/MKT` fill in `_refreshDashboardUI` now builds its month list from the `#s-fy` fiscal start, exactly as `buildMonthlyArrays` does, instead of a rolling last-12-months window — so the arrays share the fiscal axis with `REV[]`/`EXP[]`/`MONTH_FULL[]`/`currentMonthIdx`. **(b)** `getPeriodData` sums rent over the period (`sum(EXP_RENT,qs,e)` / `sum(EXP_RENT,0,12)`) instead of `EXP_RENT[0]*3` / `*12`.

**Blast radius checked before editing — this is why the fix is "correct in place" rather than "delete".** `d.sal/d.rent/d.sw/d.mkt` are also read by `buildRiver` (`app-main.js:5720-5779`) and the AI insights (`:4231`, `:4237` — "Payroll cost this quarter"). Removing them, the tidier-looking fix, would have broken both. Correcting the arrays fixes those consumers too: the AI payroll insight and the river diagram were reading the wrong months.

**Deliberately NOT done here.** The larger re-architecture — feed the bars from `computeExpenseBreakdown().byCategory` and retire the `EXP_*` arrays entirely — needs `buildRiver` and the AI insight migrated in the same pass. Tracked as a post-launch refinement, not left implicit.

**How it was verified.** 13/13 harness. The two axes are *proven to genuinely differ* (so the defect was real, not theoretical); the fill block is asserted to construct months identically to `buildMonthlyArrays`; the rent fix is exercised **behaviourally on the real `getPeriodData`** with one-month, in-quarter, out-of-quarter and varying-rent datasets (year: 1 month stays 1 month, not ×12; varying rent reports the true total).

**Still to confirm live (owner, ~2 min):** record rent in one month only → Year view shows that one month's rent, not 12×. Check the Salaries bar matches the month you're actually viewing.

**Original finding (for the record):**

**Two defects in one place.**

**(a) Axis mismatch.** `_refreshDashboardUI` fills `EXP_SAL/EXP_RENT/EXP_SW/EXP_MKT` on a **rolling-last-12-months** index (`finflow-api-wiring-dashboard.js:428-433` — `new Date(_n.getFullYear(), _n.getMonth() - _i, 1)`), while `REV[]`, `EXP[]`, `MONTH_FULL[]`, `currentMonthIdx` and `getPeriodData()` are all **fiscal-year** indexed (`buildMonthlyArrays`, `finflow-api-wiring-dashboard.js:50-59`). With today = July 2026 and a January fiscal start, rolling index 0 = **Aug 2025** but fiscal index 0 = **Jan 2026** — the arrays are read **5 months out of alignment**. `getPeriodData()` then slices them with fiscal indices (`app-main.js:1571`, `1583`, `1592`).

**(b) Fabricated Rent.** `getPeriodData()` does not sum rent — it extrapolates it:
```
quarter: rent: EXP_RENT[0]*3      // app-main.js:1583
year:    rent: EXP_RENT[0]*12     // app-main.js:1592
```
`EXP_RENT[0]` is one month's rent (and, per (a), the *wrong* month's). Multiplying it is an invented number — the same fabrication class as F3/F7/F31.

**Mitigating but not exonerating:** the patched `window.updateDashboard` calls `updateExpenseBars(window._realExpenses)` **last** (`finflow-api-wiring-dashboard.js:392`), which overwrites all four rows with all-time top-4 category totals — so the fabricated value is usually painted over within the same tick. It is still computed, still rendered first, and is what shows if that wiring hasn't booted. And the overwrite introduces **F61**.

**Course of action.** Delete the `EXP_SAL/RENT/SW/MKT` arrays and the `d.sal/rent/sw/mkt` fields from `getPeriodData()` entirely — they are a pre-API vestige with no correct consumer. Feed the four bars from one period-scoped source: `computeExpenseBreakdown(period).byCategory`, top 4 by amount. That fixes (a), (b) and F61 together.
**Done when:** with rent recorded in only one month, the year view shows that **one** month's rent — not 12×; and switching Month/Quarter/Year changes the bars.

---

### F61 ✅ **FIXED** (`57ca8b2`, 2026-07-22) — was 🟡 MEDIUM — Dashboard expense breakdown ignored the period selector
**Status:** ✅ **FIXED & harness-verified.**

**What changed.** `updateExpenseBars` (`finflow-api-wiring-dashboard.js:241`) now filters its rows through the canonical `_periodWindow(currentPeriod)` before aggregating, so the bars agree with the Expenses KPI above them. `currentPeriod`/`currentMonthIdx` are top-level `let`s in `app-main.js` — shared global lexical scope across classic scripts — so the code uses `typeof` guards, not `window.*` lookups, which would be `undefined`.

**Bonus defect fixed in the same place.** The paint loop only wrote as many rows as there were categories (`sorted.slice(0,4).forEach`), so a period with fewer than 4 categories left the surplus rows displaying the **previous period's amounts and labels** — stale money presented as current. All four rows are now cleared to `—` before painting.

**How it was verified.** Real `updateExpenseBars` run against real rows: month view excludes an out-of-period expense and still shows in-period ones; year view includes everything; a 2-category period blanks the other two bars to `—` rather than leaving `STALE`.

**Original finding (for the record):**

`updateExpenseBars(expenses)` (`finflow-api-wiring-dashboard.js:230`) sums **all-time** categories with no date filter, and runs **last** in the patched `updateDashboard`, so it wins. Selecting Month or Quarter changes every other card but not the expense breakdown. Same defect shape as F45 (budget actuals) and F44 (scenario base).
**Done when:** switching to Month changes the four bars to that month's categories only.

---

### F62 ✅ **FIXED** (`f36ca7b`, 2026-07-22) — was 🟠 HIGH — 9 server GETs fabricated empty/zero on a query error (class **C7**; F31's unswept remainder)
**Status:** ✅ **FIXED & harness-verified.** Class **C7 CLOSED.**

**What changed.** All 9 routes now return **500** with a route-specific message instead of `[]`/`{}`, keeping their existing `console.error` diagnostics (user id + pg error code): personal-transactions, goals, projects, holdings, recurring-bills, recurring-personal-transactions, vendor-credits, scenario, connections.
**Fresh-install safety was checked before changing them** — `db.allByUser` already self-heals a known-but-missing table via `_ensureTable` and returns a genuinely empty `[]` (`database.js:681`), so a first-boot missing table never reaches these catches. Only real failures do. Asserted in the harness, not assumed.
The only bare empty response left in `server.js` is the documented "no accountant linked" case at `:2819` — a legitimate result, not a failure path.

**How it was verified.** 27 route-level assertions (each of the 9 × returns 500 / no fabricated empty / still logs) + a whole-file scan proving the single legitimate exception + the `42P01` self-heal guard. Part of the **42/42** green F62/F67 harness.

**Still to confirm live (owner, ~3 min):** rename the `holdings` table in the DB → the Investments card must show an error state with a Retry, **not** `$0`. Rename it back.

**Original finding (for the record):**

The `/api/holdings` case is the sharpest: `server.js:1336-1340` catches, logs, and returns `[]` with the comment *"fail-soft: empty list keeps the frontend happy."* A transient DB error therefore renders **Investments $0** and **Net Worth minus the whole portfolio** — indistinguishable from a real empty portfolio. F31 established that this is unacceptable on money surfaces and fixed it on three report routes; the class was never swept.

**Course of action:** apply the F31 pattern (`server.js:3185-3188`) to all 9. Prioritise the three that carry money: holdings, personal-transactions, vendor-credits.
**Done when:** with `holdings` renamed in the DB, the Investments card shows an error state with a Retry, not `$0`.

---

### F63 🟡 MEDIUM — `bootDashboardWiring` re-wraps `window.updateDashboard` on every call — **NEW**
**Status:** OPEN, verified.

`bootDashboardWiring` (`finflow-api-wiring-dashboard.js:355`) does `const _origUpdateDashboard = window.updateDashboard; window.updateDashboard = function(d){ _orig(d); updateKPIs(...); updateExpenseBars(...); updateTransactions(...); updateInvoiceStats(...); }` with **no idempotency guard**. `loadEntityData` calls it on every entity load (`app-main.js:1453`). Each entity switch therefore adds a wrapper layer: after N switches, one `updateDashboard()` runs the four renderers **N times**, each re-parsing and re-writing the same DOM. Grows without bound for the session.

**Course of action:** guard with a module-scoped `let _patched = false;` around the wrap (the file already uses this pattern for `_booted` at `finflow-api-wiring-dashboard.js:472`).
**Done when:** after 10 entity switches, one `updateDashboard()` produces exactly one `updateKPIs` invocation.

---

### F64 🟠 HIGH — Money is abbreviated everywhere, including itemized rows; "Show cents" is dead — **NEW**
**Status:** OPEN, verified. *Pre-existing behaviour, not an F53 regression* — `patchSFormatter` abbreviated before `96ef6c3` too (verified against `96ef6c3^`). F53 unified the thresholds; it did not change where abbreviation applies.

**What's wrong.** `patchSFormatter` (`app-main.js:567`) replaces `window.S` at init (`app-main.js:1217`) with `_fmtMoney`, which abbreviates **every** value ≥ $1,000 to one decimal and rounds everything below $1,000 to whole dollars (`app-main.js:553-558`). `S()` is the app's universal money renderer — it is used for KPI cards *and* for every table row:

- Invoice list rows: `S(inv.amount)` — `finflow-api-wiring-medium.js:208`, and again in the reminder button's `data-amount` (`212`)
- Every `money()` helper delegates to `S`: `finflow-api-wiring-dashboard.js:22`, `-extra.js:24`, `-medium.js:1020` & `1163`, `-postgres.js:259`

So a $1,234.56 invoice renders **`$1.2K`** in the invoice table. A $12,500 bill renders `$12.5K`. A $47.80 expense renders `$48`. The exact amount is **not displayed anywhere in the product**.

Separately, the **"Show cents"** setting (`index.html:3109`) is persisted (`show_cents`, `app-main.js:4495`) and restored into the checkbox (`finflow-api-wiring.js:73`), but the only code that reads it is the *pre-patch* `S()` at `app-main.js:1517` — which is overwritten at init. The toggle does nothing. A cosmetic lie in Settings.

**Course of action.** Split the concern — abbreviation is a *dashboard-card and chart-axis* affordance, not a money-rendering rule:
1. Add `_fmtMoneyExact(value, symbol)` — full `toLocaleString` with 2 decimals, honouring `#s-cents`.
2. Point `window.S` at the **exact** formatter (it is the general-purpose renderer).
3. Keep `_fmtMoney` (abbreviated) and use it explicitly at the ~12 KPI-card and chart-tick sites that want it — they already call `window._fmtMoney` directly in `index.html`, so this is mostly already the shape.
4. Wire `#s-cents` into `_fmtMoneyExact` so the setting becomes true.

Do **not** try to make one formatter serve both — that is what produced the drift F53 fixed.
**Done when:** an invoice for $1,234.56 shows `$1,234.56` in the invoice table with cents on and `$1,235` with cents off; the dashboard Revenue card still shows `$35.2M`; and toggling Show cents visibly changes the tables.

---

### F65 🟡 MEDIUM — 8 controls report a completed action with no backend — **NEW** (honesty)
**Status:** OPEN, verified. Ships as part of the **B10** honesty pass.

| Control | Site | Claims |
|---|---|---|
| "Rebalance ↗" (Investments) | `index.html:1919` | "Rebalance plan generated ✦" |
| "Send email" (Client Portal) | `index.html:6369` | "Email sent to {client} ✦" |
| "Contact sales" (Pricing) | `index.html:2718` | "Opening enterprise enquiry form… ✦" |
| "Send test" (Notifications) | `app-main.js:5628` | "Test email sent to your address ✦" |
| "Browse all 750+ ↗" | `app-main.js:6127` | "Opening full marketplace…" — under a banner claiming **"750+ apps & services"** that do not exist |
| "Build an app +" | `app-main.js:6128` | — |
| Advisor card click / "Contact" | `app-main.js:6071` | "Connecting you with {name}…" (`ADVISORS = []`) |
| `submitAdvisorApp()` | `app-main.js:6087` | "Application submitted — we'll review within 2 business days ✦" — **no network call at all** |
| "Edit" (Items table, app-main fallback) | `app-main.js:4764` | toasts the item name and does nothing (superseded by `finflow-api-wiring-medium.js:861` at runtime — verify, then delete the dead fallback) |

Honest by comparison: "Export as PDF coming soon ✦" (`app-main.js:5116`) — that one is fine.

**Course of action.** Remove the button, or replace the toast with an honest "Not available yet". Delete the "750+ apps & services" banner outright — it is a factual claim about capability. Keep no control that reports success it did not achieve.
**Done when:** no click in the product produces a success message for work that did not happen.

---

### F66 🟢 LOW — `PUT /api/customers/:id` and `POST /api/vendors` write unvalidated strings to JSONB — **NEW**
**Status:** OPEN, verified. Part of class **C5**.

`PUT /api/customers/:id` (`server.js:954`) copies `['fname','lname','company','industry','email','phone','status','notes']` straight from the body — no trim, no length cap, no type check — so an object, array or 500 KB string lands in JSONB. Its sibling `POST` does cap. `POST /api/vendors` (`server.js:1941`) inserts `name`, `contact`, `category` raw, while its own `PUT` (`1953`) caps all three. Blast radius is bounded by `express.json({limit:'500kb'})`, so this is durability/consistency, not a DoS.

**Course of action:** mirror the caps the sibling routes already use; add `String(...)` coercion; run the email regex on `email`.
**Done when:** `PUT /api/customers/:id {email:{"a":1}}` → 400, and a 400 KB `notes` is rejected or truncated at 500.

---

### F67 ✅ **FIXED** (`f36ca7b`, 2026-07-22) — was 🟡 MEDIUM — Client turned failed entity fetches into empty arrays
**Status:** ✅ **FIXED & harness-verified.**

**What changed.** `loadEntityData`'s `res.ok ? json : []` across all five entity fetches is replaced by a `_pick(res, label)` helper that distinguishes the two cases the old ternary conflated: **401/403 is genuinely nothing** (logged out / no access) and still yields `[]`; **anything else throws**. The catch escalates `console.warn` → `console.error` and paints the shared dashboard error state (`_dashSetState('error')`, now exported from the dashboard wiring rather than duplicated), gated on `window._ffAuthed` so no error state appears pre-login.

**Follow-up (`6b8ecf2`) — self-review caught a defect in the first cut.** The comment claimed only invoices/expenses were fatal; the code made **all five** fetches fatal, so a 500 on customers/inventory/payroll killed the whole dashboard where it previously rendered invoices and expenses fine — a resilience regression, worse than the bug. `_pick` now takes an explicit `fatal` flag: **invoices + expenses fatal** (they drive every money figure; a partial set renders as smaller, wrong totals with no sign anything is missing), **customers + inventory + payroll degrade to `[]`** with a warning. *Same false-comment pattern that let F55 survive three audits — worth noting as a recurring failure mode, not a one-off.*

**How it was verified.** `_pick` extracted and exercised against ok / null-body / 401 / 403 / 400 / 500 / 502; money collections asserted to **throw**, the three list surfaces asserted to **degrade without throwing**, plus a wiring check that the flags are passed the right way round at all five call sites; catch-block assertions for the error paint, log escalation and auth gate; regression guard that the old ternary is gone. **47/47** green.

**Still to confirm live (owner, ~1 min):** block `/api/invoices` in DevTools and switch entity → dashboard shows the error state with a Retry, not `$0`.

**Original finding (for the record):**

`loadEntityData` (`app-main.js:1330-1335`): `const invoices = invRes.ok ? (await invRes.json() || []) : [];` — repeated for expenses, customers, inventory, payroll. A 500 becomes `[]`, which flows into `_realInvoices`/`_realExpenses`, into `buildMonthlyArrays`, into `computeRevenue`, and paints a **$0 dashboard with no error state**. The client-side mirror of C7/F62. The correct pattern already exists in the same tree (`apiGetStatus` + `_dashSetState('error')`, `finflow-api-wiring-dashboard.js:340-380`).

**Course of action:** treat a non-ok response as a throw, and surface `_dashSetState('error')` when `window._ffAuthed` — never substitute `[]`.
**Done when:** blocking `/api/invoices` in DevTools shows the dashboard error state with a Retry, not `$0`.

---

### F68 🟢 LOW — Installed PWA has no service worker — **NEW**
`public/manifest.json` declares `display:standalone` and `start_url:/app`, but there is **no service worker anywhere** (grep: no `serviceWorker`, no `sw.js`, no registration). Every PWA cold-launch is a full network load of `app-main.js` + a 304 KB deferred bundle — which is precisely the window F50's boot race lived in. Icons also declare `purpose:"any"` only, so Android renders an unmasked icon.
**Course of action:** post-launch — a minimal cache-first SW for the app shell (`/app`, `/app-main.js`, `/finflow-bundle.js`, icons), network-first for `/api`. Add a `purpose:"maskable"` icon entry.
**Done when:** a second PWA launch paints the shell from cache and the F50 race window closes structurally rather than by re-fire.

---

### F70 ✅ **FIXED** (`c9d2d16`, 2026-07-22) — was 🟠 HIGH — 2 of 3 currency controls showed converted money under the *previous* currency's symbol — **NEW, found while fixing F59**
**Status:** ✅ **FIXED & harness-verified.** Owner live-check outstanding.

**What was wrong.** The patched `S()` stamps `CURRENCIES[activeCurrency].symbol` on every figure (`app-main.js:573`), but `activeCurrency` was assigned by only **one** of the three currency controls:
| Control | Path | Before |
|---|---|---|
| Header pill | `setCurrency()` → sets `activeCurrency`, then `_applyDisplayCurrency()` | ✅ correct |
| Settings dropdown `#s-currency` | `updateCurrency()` → `_applyDisplayCurrency()` only | ❌ **wrong symbol** |
| Mobile drawer `#smc-currency` | `onchange` → `updateCurrency()` (`index.html:1210`) | ❌ **wrong symbol** |

So switching currency from Settings or the mobile drawer set `_displayCurrency`, fetched genuinely **server-converted** figures, and then rendered them with the **old** currency's symbol — e.g. TTD amounts under a `$`. Mislabelled money, which is precisely what F34 exists to prevent.

**Course of action taken.** Assign `activeCurrency = code` inside **`_applyDisplayCurrency`** (`app-main.js:4362`) — the single funnel all three controls route through — rather than in one caller. Idempotent for `setCurrency`, which already sets it first.

**How it was verified.** Harness runs the real `_applyDisplayCurrency`: non-native switch updates `activeCurrency` + symbol + arms the overlay · selecting the native currency disarms the overlay **and** restores the symbol · idempotent on the header-pill path · exactly one repaint per switch.

**Still to confirm live (owner, ~1 min):** change currency from **Settings** (not the header pill) → the figures and the symbol must both change together.

---

### F71 ✅ **FIXED via basis C** (`8bb47a7`, 2026-07-22) — was 🟠 HIGH — Payroll accrued with no effective dating; roster×time was also double-counted against manual salary rows
**Status:** ✅ **FIXED & golden-master-verified.** Owner ruled **basis C** (payroll_runs = single source of truth) over the three options originally listed — a stronger fix than the effective-dating option (1) below, because it removes the retroactivity, the double-count **and** a cash/accrual mismatch in one move.

**What was wrong (as surfaced by the owner: "why does June show expenses when nothing is logged for that month?").** `computeExpenseBreakdown` (client) and `computeBooks` (server) added `monthlyPayroll × elapsedMonths` — the **current** roster × time, with no start date on the employee record. Three defects: (1) **retroactive** — hiring someone today changed last January's expenses; (2) **double-count** — a salary logged as a manual expense row landed in `expensesTotal` **and** was counted again in the payroll leg, identically on both engines so every reconciliation check passed while the number was wrong; (3) **cash/accrual mismatch** against the F32 revenue basis.

**What changed (basis C).** Payroll expense leg, both engines = **Σ `payroll_run_lines` whose parent `run_date` ∈ period**, via `sumFX` (so it converts like every other leg). A payroll *run* is the event that creates the expense, exactly as an issued invoice creates revenue (F32). The synthetic `monthlyPayroll × elapsedMonths` accrual is **deleted** from both engines. The **roster is demoted to a template** — `rosterMonthlyCost` is reported for the Payroll page but feeds **no** total. **"Salaries" removed** from the manual expense dropdown (Contractors / Professional Fees added — non-payroll comp keeps a home as general expense) so the double-count cannot be re-entered by hand. No effective-dating needed: a run line is already dated.

**Empty-state UX.** Payroll expense is now a legitimate **$0** until a run exists. Rather than a bare $0, the Payroll page shows *"No payroll runs recorded — payroll expense currently shows $0, that is correct not a missing number. Set up a run from your roster to record it,"* with the roster surfaced as the template. `parts.payrollRunCount` distinguishes "no runs → real 0" from "a run totalling 0".

**History was clean — no migration.** The read-only inventory (`scripts/payroll-basis-inventory.js`, run against live Supabase) reported **0 manual salary rows, 0 payroll_runs, 0 overlap**. The double-count was architectural, never realised in data, so there is nothing to backfill or reclassify. Backfilling past months as runs is a separate owner-directed step; nothing was auto-created.

**How it was verified.** Golden master (`tests/golden-master-payroll-basisC.js`) — **executes both engines** against one fixed seed with roster R=5000 and a June run of X=4200 (X ≠ R, X ≠ R×elapsed, so the assertion proves *which source was read*). All 16 payroll assertions + 3 structural (accrual deleted both engines; Salaries gone) green; revenue/AR/AP and all 12 cross-engine checks stayed green; full regression suite green. (The 6 red F25 assertions in the same file are the separate period-scoped-COGS commit's target, not C.)

**Spawned:** **F73** (client leg reads a LIMIT-50 endpoint — theoretical undercount at >50 lifetime runs; deferred to the client-recompute rework).

**Superseded options (for the record — C was chosen over all three):**
1. *Effective-date the roster record* (`start_date`, JSONB, no migration) — fixes retroactivity but leaves the double-count and the cash/accrual mismatch.
2. *Proxy with `created_at`* — wrong the other way.
3. *Label it* — not a fix.

---

### F73 🟢 LOW — Client payroll leg reads a LIMIT-50 endpoint; >50 lifetime runs undercounts until the server figure lands — **NEW (found while implementing basis C)**
**Status:** OPEN, verified. Do **not** fix in isolation — belongs with the client-recompute rework (same class as **F7**, **F56**).

**What's wrong.** Under basis C (`532390b`… see the payroll commit), the payroll expense leg = Σ `payroll_run_lines` whose parent `run_date` ∈ period, on **both** engines. The **server** leg (`computeBooks`) issues a **direct, unlimited** JOIN, so `/api/reports` / `/books` are authoritative and correct at any run count. The **client** leg reads `window.payrollRuns`, populated from `GET /api/payroll-runs` — which is capped: `... ORDER BY pr.created_at DESC LIMIT 50` (`server.js:3778`). So a user with **>50 lifetime payroll runs** gets a client dashboard that **undercounts** payroll (misses the oldest runs) until the async `/api/reports` fetch overwrites the cards with the server's figure.

**Why it's Low, not Med.** (a) It self-heals on every dashboard paint — the server figure lands within the same interaction and is correct; the window is a brief undercount, not a persisted wrong number. (b) It requires >50 runs to trigger at all — a business runs payroll ~12–24×/year, so this is a ~2–4-year horizon, and **zero** runs exist in the data today. (c) It is the exact class the client-recompute rework exists to kill: two engines computing the same figure, the client one working off a truncated dataset — **F7** (duplicate KPI formulas) and **F56** (divergent AR) are the same shape.

**Course of action (with the client-recompute rework, not now).** Either raise/remove the `LIMIT` on the run-history endpoint, or give the dashboard a dedicated unlimited (or server-computed) payroll figure so the client never recomputes off a truncated list. The single-source-of-truth direction the audit already favours (client reads server totals rather than recomputing) closes this by construction.
**Done when:** a user with 60 runs shows the same payroll figure on the dashboard's first paint as `/api/reports` returns — no undercount-then-correct flicker.

---

### F74 ✅ **FIXED** (`85c8384`, 2026-07-22) — was 🟠 — No edit/delete control on non-owner employee rows
**Status:** ✅ **FIXED & harness-verified.** Owner-surfaced alongside PL#9.

**What was wrong.** The runtime `renderPayroll` override (`finflow-api-wiring-medium.js:582`) rendered a literal `<span></span>` for every non-owner row — no edit, no delete — so an employee (e.g. "Maria Garcia") could not be modified or removed. **Not intentional gating**: a rendering gap. The `openEditEmployee` handler already existed (`app-main.js`) but was unreachable because the override never emitted a button calling it; a client `deleteEmployee` did not exist at all, though the server route (`DELETE /api/payroll/:id`, `payroll:write`) did.

**What changed.** Non-owner rows now render edit (`openEditEmployee`) + delete (`deleteEmployee`) controls; the owner row keeps its single pencil and gets no delete. New `window.deleteEmployee(id)` confirms, calls the pre-existing server route, updates the in-memory array (keeping the `let payrollEmployees` binding in sync with `window.`), repaints, and throws (not fake success) on a non-ok response.

**Verified:** 12/12 executing the real override against a stubbed DOM. Same root cause as PL#9 (→ **F75**): both were defects on a shadowed function whose maintained copy lived in the dead app-main version.
**Live check (owner):** the Maria row shows edit + delete; delete prompts, removes the row, and the employee is gone after reload.

---

### F75 🟠 HIGH — Root cause: fixes applied to shadowed (dead) functions — **NEW (systemic; root cause of the PL#9 recurrence)**
**Status:** OPEN (class). **Enumeration complete** (read-only, 2026-07-22); reconciliation not started — awaiting owner prioritisation.

**The pattern.** `app-main.js` defines a function, then a wiring source does `window.NAME = function(){…}`, and the bundle loads **after** app-main, so the override wins at runtime. When the override is a **replacement** (does not call the original), the app-main copy is **dead code** — and a fix applied to it renders **nothing**, while passing review because the source *looks* patched. This is distinct from a **wrapper** override (saves and calls the original), where app-main edits DO take effect.

**Confirmed instances (this defect has already wasted real fixes):**
- **`renderPayroll`** — `2a70564` (gross colour) **and** `3bdae44` (the non-owner edit pencil) **both** landed on the dead app-main copy; the runtime override had neither until `85c8384` today. **Two** wasted fixes on one function. This is the confirmed root of the PL#9/F74 "recurrence."
- **`renderItems` / `filterItemsBySearch`** — `614d29c` added XSS escaping to the dead app-main copy. **No live vulnerability** — verified the runtime override independently escapes (`esc(i.name)`, `medium.js:859`) — but the app-main effort was wasted.

**Blast radius (enumerated).** **28** functions are defined in app-main **and** overridden by a wiring `window.NAME=`. **23 are REPLACEMENT** (app-main copy is dead); **5 are wrappers** (app-main edits live — e.g. `updateDashboard`, which is why the verified F56/F59 fixes there worked). **4** are shadowed by **≥2** wiring files (intra-bundle order decides the winner). Full machine-generated list in the session report.

**Dead-copy edits — verification status (updated 2026-07-23).** Of the 23 replacements, targeted commits hit the dead copy in these cases:

| Function | Commit | Verdict |
|---|---|---|
| `renderPayroll` | `2a70564`, `3bdae44` | ✅ **Resolved** (`85c8384`) — two wasted fixes, now on the runtime path |
| `renderItems` | `614d29c` (XSS) | ✅ **Wasted effort, no live hole** — override escapes independently (`esc()` throughout `renderItemRow`, `medium.js:857`) |
| `filterItemsBySearch` | `614d29c` (XSS) | ✅ **Wasted effort, no live hole** — delegates to `renderItemRow`, which escapes every string field; `price`/`stock` are unescaped but numerically coerced server-side (`parseFloat`/`parseInt`, `server.js` items POST/PUT) so they cannot carry markup |
| `restockItem` | `4286f7f` (security) | ✅ **Wasted effort, no live hole** — override opens a modal not `prompt()` (`medium.js:451`), `saveRestock` rejects `qty<=0` (`medium.js:466`), server clamps `Math.max(1,…)` |
| `saveProduct` | ~~`469fd1a`~~ | ⬜ **FALSE POSITIVE — withdrawn.** `469fd1a` did **not** touch `saveProduct`'s body; the `git log -L :saveProduct:` function-range heuristic swept in an adjacent comment block the commit added nearby. Only `6a3608d` (original file extraction) is content-bearing. Separately checked: the override carries equivalent validation (`sanitizeText`, `validateAmount`, clamps) **and** actually persists via `POST /api/inventory`, which the app-main copy never did |
| `loadPersistedData` | `3bdae44` | 🔶 **UNVERIFIED** — the one remaining suspect |

**Net so far: 4 confirmed wasted fixes, 0 live security holes, 1 false positive withdrawn, 1 unverified.** The `-L` heuristic over-reports — a flagged commit must be confirmed against the actual hunk before it is called a dead-copy edit.

**Course of action (owner to prioritise — do NOT batch-reconcile blindly).** (1) Verify the 3 suspects — does the runtime override carry the fix the dead copy got? (2) For each confirmed-dead pair, either delete the app-main copy (forcing all edits onto the real one) or make the override a thin wrapper that delegates. (3) Add the **guard** below so a future fix to a shadowed copy fails loudly.
**Done when:** no function has a silently-dead second definition, and CI fails if one is introduced.

---

### F76 🟡 MEDIUM — `GET /api/tax-filing` is stale on three counts — **NEW (2026-07-23, read-only verified)**
**Status:** OPEN, verified by code read. **Not currently user-facing** (see urgency note) — that lowers urgency, it does **not** make it correct.

Three defects in one endpoint (`server.js:3464-3492`), reported together because they share a cause: the endpoint predates both the F32 recognition decision and **D1**, and was never revisited.

**1. Hardcoded rate, not owner-configurable.**
```js
const estimatedTax = Math.round(taxableIncome * 0.25);   // server.js:3482
…
rate: 0.25,                                              // server.js:3488 — returned as if authoritative
```
A flat 25% is baked in and echoed back in the response as `rate`, presenting a FinFlow-chosen number as though it were the user's. Directly contradicts **D1**, under which the rate is owner-supplied and FinFlow holds no tax knowledge.

**2. Revenue uses the PRE-F32 paid-only basis — this endpoint disagrees with every other revenue figure in the app.**
```js
const revenue = invoices.filter(i => i.status === 'paid')…   // server.js:3475
```
F32 (18 July, owner decision) moved recognition to **ACCRUAL, ISSUE-BASED** — allowlist `pending`/`overdue`/`partial`/`paid` — across `computeBooks`, `computeRevenue`, `/api/reports`, `/books`, the monthly buckets and the accountant portal. **This endpoint was missed.** It is the last surviving consumer of the superseded basis, so its `revenue`, `taxableIncome`, `estimatedTax` and `quarterly` are all computed from a number no other surface reports. Same multi-writer class as **F7**/**F56** (`CLAUDE.md` failure mode 2).

**3. No `ytdPaid` source of any kind.** The full response is `{revenue, deductible, taxableIncome, estimatedTax, quarterly, rate}` (`server.js:3486-3489`) — there is **no** `paid`/`ytdPaid` field. Nor is there anywhere for one to come from: **no** `tax_payments` table, no tax entry in the 35-table `TABLES` array (`database.js:51-62`), and **not even a "Tax" expense category** (`bexp-cat`: Rent, Software, Marketing, Travel, Equipment, Meals, Contractors, Professional Fees, Other). Tax paid is not merely un-aggregated — it is **unrecordable**. **This confirms `VERIFICATION.md` check A7.23 ("Tax YTD paid") is correctly blocked**, and under **D1** the correct rendering is *"Not tracked"*, not a computed figure.

**Urgency — why this is Medium, not High.** The Tax Filing page is the **F51** static "Coming Soon" placeholder (`app-main.js:6104`); `calcAndRenderTax` was deleted under **PL#11** (`7be0a1d`), so nothing in the main app renders this endpoint's output today. It is live and reachable but unconsumed. The risk is a future surface wiring itself to it and silently importing the pre-F32 basis.

**Course of action.** Do **not** patch the rate in isolation — that would half-build **D1**, which is the failure this finding exists to prevent. Either (a) implement D1 properly: owner-supplied rate parameter, revenue from the canonical `computeBooks` accrual figure (not a fourth private recompute), `ytdPaid` omitted or explicitly `null` with a "Not tracked" contract; or (b) **delete the endpoint** until D1 is implemented, so nothing can wire to a stale basis in the meantime. (b) is cheaper and strictly safer pre-launch.
**Done when:** the endpoint either does not exist, or its revenue equals `/api/reports` revenue for the same period and its rate comes from owner input — and A7.23 renders "Not tracked" rather than a number.

---

### F77 🟠 HIGH — The payroll basis-C golden master is stub-based and violates `CLAUDE.md` Rule 3 — **NEW (2026-07-23; self-reported test debt)**
**Status:** OPEN. **Its green result is NOT evidence of correctness** and must not be cited as such until rebuilt.

**What's wrong.** `tests/golden-master-payroll-basisC.js` asserts against a **hand-written pool stub**, not a real Postgres instance with the real schema. `CLAUDE.md` Rule 3 forbids exactly this for money paths: *"A stub is a second implementation of your database written by the person trying to prove their code correct. It will agree with them."*

**This is not hypothetical — it is the direct cause of defects that shipped.** The stub let the seed use `status:'final'` for a payroll run. **That value cannot exist in the schema** (`payroll_runs.status` vocabulary is `draft` / `approved` / `paid`, `database.js:388`); a real `INSERT` would have been the only thing that could reject it. Because nothing in either engine filters run status, the invalid value was never exercised — and the suite went **62 green** while three real defects shipped:

- the **payroll KPI double-count** (2× a single run's value),
- the **ignored status filter** (a `draft` run contributing its full line total instead of 0),
- the **load-timing defect** (`window.payrollRuns` populated only after visiting the Payroll page, so the Expenses KPI depended on navigation order).

None of the three is visible in source. All three would have been caught by a seed inserted through the real schema and read back through the real endpoints. This is `CLAUDE.md` failure mode 3 in its purest form: **tests that pass against fabricated reality.**

**Related stub-fidelity failures in the same file** (each cost a round trip): an `async` keyword stripped during source extraction; a stub returning `undefined` that silently became `0`; a new `payroll_run_lines` JOIN the stub did not serve (returning 0 payroll and looking like a code bug); and a paren-counter tripped by a `)` inside a code comment.

**Course of action.** Rebuild against a **scratch Postgres** with the real schema, seeded by real `INSERT`s, exercised through the real HTTP endpoints — per `VERIFICATION.md`'s Environment section, which already mandates this ("Real schema, real server, real endpoints, real HTTP. **No pool stubs**"). Part of the structural work, not a quick patch. The existing assertions and the discriminating seed design (Rule 4) are worth keeping; it is the **substrate** that must change.

**Interim handling.** Until rebuilt, the file may be used as a fast regression signal for *structural* regressions only, and every report citing it must state that it is stub-based. **A green run does not satisfy any `VERIFICATION.md` check.**
**Done when:** the golden master runs against real Postgres with the real schema, a seed containing an invalid status value is **rejected before it can be inserted**, and the three defects above are each proven caught by a failing assertion before the fix and a passing one after.

> ### ⚠️ CORRECTION to this row — 2026-07-23 (read-only verified, while building the harness)
>
> The original wording of "Done when" read *"a seed containing an invalid status value is **rejected by the database**"*. **That is not achievable against this schema, and the premise behind it was wrong.**
>
> This row asserted that a real `INSERT` "would have been the only thing that could reject" `status:'final'`. It would not have rejected it. `payroll_runs.status` is a bare column with no constraint:
> ```
> database.js:388     run_date DATE, status TEXT DEFAULT 'draft',
> ```
> and a scan of the whole schema finds exactly **one** CHECK constraint across ~40 tables:
> ```
> $ grep -n "CHECK\|ENUM\|CREATE TYPE" database.js
> 259:        rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
> ```
> `INSERT INTO payroll_runs (status) VALUES ('final')` **succeeds** on real Postgres. Invoice and bill statuses are worse still — they live inside the JSONB `data` column, where a column constraint is not even expressible.
>
> **Consequence for the rebuild:** moving to real Postgres removes the *stub*, but it does **not** restore the guard this row assumed the database would provide. The harness must therefore carry its own explicit status-vocabulary gate over the seed (Rule 11 vocabularies, asserted in code, aborting the seed on an unknown value). Without that, the rebuilt harness reproduces the exact F77 trap on a real database — which would be worse, because it would look authoritative.
>
> Tracked as **F79**. Verified by reading `database.js`; not by execution.

---

### F78 🔴 CRITICAL — `require('./server.js')` fires DDL **and a data-modifying UPDATE** at import time, against whatever `DATABASE_URL` is set — **NEW (2026-07-23, read-only verified while building the harness)**
**Status:** OPEN. Not a harness problem — a property of the shipped server that any tool, test or script inherits.

Importing the server is not inert. `server.js:11` requires `./database`, and `server.js:4750` calls `initDB()` **at module scope, unawaited**:
```
server.js:4750   initDB().then(() => {
server.js:4751     if (require.main === module) {      ← only the LISTENER is guarded
server.js:4752       app.listen(PORT, ...
```
The `require.main` guard covers `app.listen` and the recurring scheduler. **It does not cover `initDB()`**, which runs unconditionally on import. `initDB()` executes `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE` across ~40 tables **and** a data-modifying backfill:
```
database.js:110-116
    UPDATE invoices
       SET data = jsonb_set(data, '{amount_paid}', data->'amount')
     WHERE lower(data->>'status') = 'paid'
       AND jsonb_typeof(data->'amount') = 'number'
       AND COALESCE((data->>'amount_paid')::numeric, 0) < (data->>'amount')::numeric
```
So `node -e "require('./server.js')"` with a production `DATABASE_URL` in the environment **writes to the owner's live books** before a single line of the calling script runs. Nothing downstream can prevent it; by the time your code executes, the UPDATE has committed.

This is precisely the hazard `CLAUDE.md` Rule 7 names — *"`require('../database.js')` executes that module… merely importing it would fire `CREATE TABLE` / `ALTER TABLE` DDL at production. A scan of the script's own SQL would not catch that."* Rule 7 anticipated it for `database.js`. `database.js` is in fact **clean on import** (`database.js:39` only constructs a lazy `Pool`; `initDB` is not self-invoking). It is `server.js` that has the side effect, and it is worse than DDL because of the `UPDATE`.

**Mitigated for the harness, not fixed in the product.** `tests/harness/guard.js` never reads `DATABASE_URL`, scrubs any inherited value from the environment before any module loads, and installs a loopback-only scratch URL — so the harness cannot trigger this. **That protects the harness; it does not protect the next script someone writes.**
**Course of action:** move `initDB()` inside the `require.main === module` guard, or export an explicit `start()` the entrypoint calls. Import must be inert.
**Done when:** `node -e "require('./server.js')"` against a database with a known row count performs **zero** writes, proven by comparing `pg_stat_database` write counters (or an audit trigger) before and after.

---

### F79 🟠 HIGH — Status vocabularies are unenforced: **one** CHECK constraint in ~40 tables, and JSONB statuses cannot be constrained at all — **NEW (2026-07-23, read-only verified)**
**Status:** OPEN. Corrects the premise of **F77** (see the correction block on that row).

`CLAUDE.md` Rule 11 treats status vocabularies as real and checkable. The database does not enforce a single one of them.
```
$ grep -n "CHECK\|ENUM\|CREATE TYPE" database.js
259:        rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
```
One CHECK, on `accountant_reviews.rating`. Specifically:
- `payroll_runs.status` is `TEXT DEFAULT 'draft'` (`database.js:388`) — no CHECK. `INSERT … status='final'` **succeeds**.
- Invoice and bill statuses live inside the JSONB `data` column (generic `id/user_id/entity_id/data` tables, `database.js:63-83`), where a column-level constraint is not expressible at all.

> **Scope of this finding — read it precisely.** This is **not** "the schema has no constraints". Referential integrity is present and deliberately built: `database.js:478-528` carries a *"FOREIGN KEYS: single source of truth"* block that adds `fk_<table>_user` and `fk_<table>_entity` across the tables, with `ON DELETE CASCADE`, plus in-line `REFERENCES` on the accountant and payroll-lines tables. That machinery works — it rejected a harness insert carrying a non-existent `user_id` during the step-2 build, which is how it was found.
>
> The gap is narrower and more specific: **no VALUE-DOMAIN constraint exists on any status column.** FKs answer "does this row point at something real"; nothing answers "is this a status the product recognises". That second question is the one F77 turned on.

**Why this matters beyond tidiness.** F77's stated fix — rebuild the golden master on real Postgres — was justified partly on the belief that a real `INSERT` would have rejected the impossible `status:'final'` seed. It would not have. Real Postgres removes the *stub*, but supplies **no** vocabulary guard. A rebuilt harness that assumes otherwise reproduces the F77 trap on a real database, where it will look far more authoritative than it did on a stub.

**Course of action (two independent halves, do not conflate):**
1. **Harness:** an explicit vocabulary gate over the seed, asserting every status against the Rule 11 allowlists and **aborting** on an unknown value. This is the harness's own guard and is in scope for the harness build.
2. **Product:** decide whether to add CHECK constraints on typed status columns, and a validation layer for JSONB statuses. Owner-gated, separate commit, not part of the harness.
**Done when:** (1) the harness refuses to seed `status:'final'` and says why; (2) the product half has an owner decision recorded, implemented or explicitly deferred.

---

### F80 🟠 HIGH — Payroll leg has **no status filter**; `draft` runs are recognised as expense — on **BOTH** engines — **NEW (2026-07-23, read-only) → EXECUTED + FIX HELD (2026-07-24)**
**Status:** FIX HELD (diff ready, awaiting owner approval) — **both legs, mirrored; verified by execution.** Lands together with **F102** as one change (see the UPDATE below). Contradicts `VERIFICATION.md` decision 2 and `CLAUDE.md` Rule 12.

> **UPDATE 2026-07-24 — client mirror located, defect executed, fix held (mirrored).**
> - **The client half (the "enumerate before fixing" this row asked for).** `computeExpenseBreakdown` recomputes the same leg at **`app-main.js:1699-1707`** and had the identical gap — no `status` predicate. So the defect spanned BOTH engines, not just the server. Fixing the server alone would have left the dashboard/Expenses/AI/health surfaces still counting draft (the F7/F56 regrowth pattern). Both are fixed as one mirrored change: server predicate `status IN ('approved','paid')` (added `pr.status` to the `computeBooks` query, `server.js:4179`), client allowlist `['approved','paid']` (`app-main.js:1706-1711`). Both keep the `paid`-included form, per the ⚠️ implementation trap.
> - **Now EXECUTED, not just read** (this row was "not yet executed"). `tests/harness/verify-f102-payroll-boot.js` on real seeded Postgres: FY opex = **9,400** = `expected.js` (was 12,700 with draft counted). Server sweep **A5.12 (FY opex) flips FAIL→PASS**. The Jul draft run (3,300) is now excluded — Jul payroll drops to the decision-2 value 1,100.
> - **Why bundled with F102 (not fixed alone).** Verifying either fix requires the other: with payroll missing (F102) opex reads 3,200; with draft counted (F80) it reads 12,700; only both together give 9,400. The probe asserts the card is 9,400 and is NEITHER bug value; Rule-14 controls confirm it goes red if either fix is removed.
> - **VISIBILITY checked (F94 class): excluded from the BOOKS ≠ invisible in the UI.** The change touches only the money computation (client `computeExpenseBreakdown` sum, server `payrollTotal`). Executed at boot, the draft run R2 (3,300) is EXCLUDED from d-exp/Expenses/AI/health/`/api/reports`/`/books` (books = 9,400) **and** remains VISIBLE in Payroll Run History with its `draft` badge and **Approve** button (asserted on the rendered `payroll-runs-list` DOM); the empty-state still counts it (not empty); `breakdown.payrollRunCount` still counts every in-period run (I gated only the sum, not the count). So the "unapproved run waiting" affordance is preserved — no visibility was removed to fix the accounting.
> - **Residual (NOT F80).** Sweep A5.10 (Jun opex −150) and A5.11 (Jul opex −500) remain red; both are **non-payroll** and **pre-existing** (bill/expense month-boundary drift from the clock pin, same class as the INV-6 revenue/AR pollution). They wash out at FY scope (A5.12 green) and are unrelated to this fix.
> - **F104 was a duplicate of THIS row, withdrawn.** A finding logged in the same session re-opened Decision 2 as if it were open. It never committed. See the F104 tombstone. Process cause + the reconciliation check that would have caught it: **F105**.

`computeBooks` sources payroll from `payroll_run_lines` joined to `payroll_runs` (basis C, correct), but filters only on user and entity:
```sql
-- server.js:4136-4141
SELECT prl.gross, prl.bonus, prl.overtime, pr.run_date, pr.entity_id, pr.id AS run_id
  FROM payroll_run_lines prl
  JOIN payroll_runs pr ON pr.id = prl.run_id
 WHERE pr.user_id = $1
   AND ($2::int IS NULL OR pr.entity_id IS NULL OR pr.entity_id = $2)
```
There is no `pr.status` predicate anywhere in the leg. Every run contributes its full line total regardless of status, so a **draft** run — explicitly worth 0 under decision 2 — is recognised as expense.

`VERIFICATION.md`'s seed is built to expose exactly this: R1 `approved` 4,200 (Jun), R2 **`draft` 3,300** (Jul), R3 `paid` 1,100 (Jul), all three totals distinct so a leak identifies *which* status leaked. Against that seed this leg should report **July payroll = 4,400** (3,300 + 1,100) where decision 2 requires **1,100**.

Note the required predicate is `status IN ('approved','paid')`, **not** `status = 'approved'` — see the ⚠️ IMPLEMENTATION TRAP on decision 2: `paid` is downstream of `approved`, so filtering to `approved` alone would make the expense **disappear** when a run is marked paid. Check B4.3 exists to catch that.

**Limits of this finding:** confirmed by **reading the query**, not by executing it. The predicted 4,400 is derived from the code and the seed, not measured. The harness (steps 2-3) will measure it.
**Course of action:** do not fix during the sweep. `VERIFICATION.md` rule 1 — run every check first, freeze the failure list, then fix as a batch. Also enumerate the client-side mirror before fixing either (Rule 2): the same figure is recomputed client-side and fixing one surface is how F7/F56 regrew.
**Done when:** A5.10-12 and A1.4-6 report the decision-2 values on real seeded data, and B4.1/B4.2/B4.3 pass — draft 0, approve adds Σ lines once, mark-paid leaves it unchanged.

---

### F81 🟢 LOW — `VERIFICATION.md` check counts are internally inconsistent — **NEW (2026-07-23)**
**Status:** ✅ **FIXED** in the harness commit (documentation-only).

Part A's header said *"~84 checks"*; the A7 section header said *"Page-level figures — 21"* while enumerating rows A7.1 through **A7.23**. Recounting the enumerated rows: A1 15 + A2 6 + A3 3 + A4 3 + A5 18 + A6 18 + A7 23 = **86**.

Minor, but the file's whole purpose is to be a *finite list* whose size does not drift — "done = every check green" needs an unambiguous denominator. Corrected to 23 and 86.

---

### F82 🟡 MEDIUM — Seed/clock conflict: the pinned clock predated two seeded payroll events — **NEW (2026-07-23)**
**Status:** ✅ **RESOLVED by owner decision** (2026-07-23), applied in the harness commit.

`VERIFICATION.md` pinned the clock to **2026-07-15**, but seeded R3 with `run_date` **2026-07-20** and its payment event on **2026-07-22** — both in the *future* relative to "now". Expected July payroll (1,100) and July cash out (1,850) rest entirely on R3.

The risk was a **false failure**: any surface that bounds its window at the current date (the client resolves `_periodWindow` with `elapsedMonths` off `min(now, fyEnd)`) would drop R3, report July payroll as 0, and look exactly like a code defect — sending a sweep chasing a bug that was really a seed artefact.

**Resolution:** the clock moves to **2026-07-25T12:00:00-04:00**; R3 does **not** move, because its date is what discriminates. July remains an incomplete month (so partial-period behaviour is still exercised) and every other seeded date is unaffected. Implemented in `tests/harness/clock.js`.

---

### F83 🟢 LOW — Harness exits 0 even when checks fail — **deliberate for now, tracked commitment** (2026-07-23)
**Status:** OPEN by design. Recorded so it is a decision with an expiry, not an oversight that calcifies.

The harness sets `process.exitCode = 0` unconditionally. That is correct **while it is an instrument**: during a sweep the artefact is the *report* — actual vs expected for every check — and a non-zero exit that truncated output or tripped a wrapper would cost more than it gained. `VERIFICATION.md` rule 1 (run every check before fixing anything) depends on a full run always completing and always being readable.

It becomes **wrong** the moment the harness is used as a regression gate — in a pre-commit hook, in CI, or anywhere a machine reads the exit status. At that point a silently-zero exit means failures ship green, which is F77's failure mode in a new location.

**Course of action:** add `--strict` (non-zero exit on any FAIL) and make that the mode any automated caller uses, leaving bare invocation exit-0 for interactive sweeps.
**Done when:** `--strict` exists, is used by whatever automation adopts the harness, and a deliberately failing check is shown to return a non-zero status.

---

### F93 ✅ DECIDED (2026-07-23) → moved to STANDING DECISION **D2**
**Status:** DECIDED. Future-dated documents are **not** recognised until their date arrives — see **D2** at the top of this file for the ruling, rationale, and the three consequences (a/b/c). Implementation is owner-gated and depends on the F87/F88/F89 structural batch (D2 consequence b). The seed row and Part A check **A9** are tracked under D2(c); the missing scheduled-state UI is **F94**.

---

### F94 🟠 HIGH — No SCHEDULED state: implementing D2 would make future-dated documents vanish — **NEW (2026-07-23, prerequisite for D2)**
**Status:** OPEN. A direct consequence of decision **D2**, logged separately because it is a UI gap, not the recognition rule itself (Rule 13 — the rule and its surface are different work).

D2 says a future-dated document contributes 0 until its date arrives. But the app offers **no way to see a document that exists-but-is-not-yet-recognised**:
- future dates are accepted with no bound (D2 consequence a — no server validation, zero client `max=`);
- there is no `scheduled` status in any vocabulary (invoices: `draft`/`pending`/`overdue`/`partial`/`paid`; bills: `unpaid`/`due_soon`/`overdue`/`partial`/`paid`);
- no list view filters or labels a future-dated row.

So the moment D2 is implemented, a post-dated invoice drops out of every total **with no on-screen trace**. The user who entered it will report it as data loss — the invoice is in the database, correct, and invisible. **A recognised-vs-scheduled distinction must be visible before recognition is withheld**, or D2 trades a correctness bug for a "my invoice disappeared" bug.
**Course of action:** part of the D2 implementation, not separate — a `scheduled` state (or a derived "not yet issued" label), excluded from figures but present and labelled in the relevant lists. Owner-gated with D2.
**Done when:** a future-dated document is visibly marked scheduled, excluded from every figure, and transitions to recognised when its date arrives.

---

### F92 🟠 HIGH — Money-bearing fields are mutated as SIDE EFFECTS of other routes, not by routes of their own — **NEW (2026-07-23, the class behind F90's silent-recalc note)**
**Status:** OPEN. This is the CLASS; F90 recorded two instances of it. Logged separately per Rule 13 — a finding that names one surface when the defect spans several is a sighting.

**The shape:** a function writes a money-bearing field on a record the caller did not name, triggered by an action on a *different* record. It has no route, no request, and no obvious owner. Consequences compound:

1. **It is invisible to any route-based audit** — F90's enumeration walks routes, so a side-effect writer is not on the list by construction. This is why the audit-trail scope needed a second axis.
2. **It is invisible to any route-based permission check** — RBAC middleware (`server.js:692`) gates on `req.method` and `req.path`. A side-effect write happens *inside* an already-authorised request, so it is never separately checked.
3. **It is invisible to double-submit protection** — Rule 9's dedupe keys on the *incoming* row, not on what that row causes downstream.

**Known members (enumerated from the recognition legs, NOT exhaustive — see below):**

| Function | Writes | Triggered by | Logged |
|---|---|---|---|
| `recalcInvoiceStatus` (`server.js:3614`) | `invoices.status`, `invoices.amount_paid` | `POST`/`DELETE /api/invoice-payments` | ✗ |
| `recalcBillStatus` (`server.js:3642`) | `bills.status`, `bills.amount_paid` | `POST`/`PUT`/`DELETE /api/payments-made` | ✗ |
| `initDB` backfill (`database.js:110-116`) | `invoices.data->amount_paid` | **module import** (F78) | ✗ |
| `markBillPaid` → `recalcBillStatus` | as above, plus creates a `payments_made` row | a UI button on a *different* page | ✗ |

Both `status` and `amount_paid` are **directly load-bearing**: `status` drives the `RECOGNIZED`/`RECOGNIZED_BILL` allowlists (revenue and expense recognition), and `amount_paid` drives AR and AP outstanding. So these functions move headline figures without appearing in any route enumeration of what moves headline figures.

⚠️ **This enumeration is NOT complete, and route-based scanning CANNOT complete it.** The list above was derived by reading the recognition legs — which finds the members those legs happen to call, and nothing else. A side-effect writer is invisible to route-based scanning **by definition**: it has no route, so walking routes cannot reach it.

#### What method WOULD find them all

Stating this explicitly, because "incomplete" without a completion method is an excuse rather than a plan. Three approaches, weakest to strongest:

1. **Write-site enumeration (static, tractable now).** Invert the axis: instead of starting from routes, start from the **columns**. Enumerate every call site that writes a money-bearing field — `db.updateById`, `db.insert`, and every raw `pool.query` containing `UPDATE`/`INSERT` against a money table — then classify each as *direct* (inside the route that owns that table) or *side effect* (anywhere else). The side-effect set is the answer. This is complete with respect to the **source**, and it is finite: the write helpers are few and raw `pool.query` mutations can be listed exhaustively.
   *Caveat:* it cannot see a write assembled dynamically (`db.updateById(tableVar, …)`), so any dynamic table name must be resolved by hand.

2. **Database-level capture (behavioural, complete with respect to RUNTIME).** Enable `pgaudit` or an `AFTER INSERT OR UPDATE OR DELETE` trigger on the money tables **in the scratch cluster only**, drive Part B through the real UI, and record every row actually mutated per request. Any mutation not attributable to the route being exercised is a side-effect writer. This catches what static reading misses — including dynamic writes — and needs no production change, since the harness already owns a disposable real Postgres. **This is the method that closes the list.**
   *Caveat:* it only finds paths the harness actually exercises, so its completeness is bounded by Part B's coverage — which is precisely why Part B must be complete first.

3. **Structural elimination (the fix, which makes the question moot).** Route every mutation through the shared logged write path proposed in F90 §2.7. Once no code can write a money field except through that path, "which writers are side effects" stops being a question anyone has to answer — the log lists them, continuously, by construction.

**Recommended order: 1 now (cheap, immediate, bounds the problem), 2 during the Part B sweep (closes the list), 3 as the fix.** Reporting the F92 list as closed on the strength of 1 alone would repeat the mistake this finding is about.
**Course of action:** complete the enumeration, then fold into the F90 shared-write-path fix — routing side-effect writers through the same logged path is what makes them visible. Until then, treat any route-based inventory of money writes as a lower bound.
**Done when:** every side-effect writer of a money-bearing field is enumerated, logged, and reachable from the same audited write path as a direct route write.

---

### F91 🟢 LOW — Seed maskers: two FIXED by the Apr rows; Q3==Jul RECLASSIFIED as correct under D2 — **UPDATED 2026-07-23 (seed revision applied + approved)**
**Status:** RESOLVED as far as it can be. Maskers 2 and 3 are fixed. Masker 1 is no longer a masker — see the reclassification. Downgraded 🟡→🟢.

The adjacent-period sweep found three surviving equalities. Their disposition after the approved seed revision (B0 Apr bill 300, R0 Apr run 900, INV-6 future invoice):

| # | Masker | Was | Disposition |
|---|---|---|---|
| 2 | Q2 bills == Jun bills | both 800 | **FIXED** — B0 (Apr, 300) makes Q2 bills 1,100 ≠ Jun 800 |
| 3 | Q2 payroll == Jun payroll | both 4,200 | **FIXED** — R0 (Apr, approved 900) makes Q2 payroll 5,100 ≠ Jun 4,200 |
| 1 | Q3 == Jul on all six | — | **RECLASSIFIED — correct under D2, not a masker** |

#### Masker 1 reclassified — Q3 == Jul is the RIGHT answer at this clock

The obvious fix — a recognised row in Aug or Sep to make Q3 ≠ Jul — is **impossible under decision D2**. The pinned clock is 2026-07-25, so Aug and Sep are in the **future**, and a future-dated document contributes 0 (scheduled, not issued). There is no recognised activity to place in Aug/Sep, so **Q3 genuinely contains only July** and Q3 == Jul is the correct result, not a bug being hidden.

Two things make this a clean disposition rather than a gap left open:
1. **The quarter-vs-month bug is now caught at Q2**, which discriminates in every leg once B0/R0 land (Q2 ≠ Jun for bills, payroll, opex and net).
2. **With INV-6 present, Q3 == Jul becomes a live assertion, not an artifact.** Correct D2 behaviour gives Q3 revenue = 4,000 (= Jul); the D2 *violation* gives Q3 = 9,000 (≠ Jul). So the equality now tests something real — a divergence would signal the future-recognition bug (A9.2).

Moving Q3's later months into the past would require a different pinned clock, which conflicts with F82 (July must remain an incomplete month). At this clock, Q3 == Jul is a property to preserve, not remove.
**Done:** maskers 2 and 3 eliminated; masker 1 reclassified as correct-under-D2 and load-bearing for A9.2. No further seed change sought for this finding.

---

### F90 🔴 CRITICAL — There is NO audit trail. The table exists and is empty by construction — **NEW (2026-07-23, read-only verified, two-axis enumeration)**
**Status:** OPEN. **PRE-LAUNCH.** Scoped, not fixed.

#### Premise confirmed before scoping (2.1)

A `grep` for `auditLog()` alone would miss a database trigger or a generic middleware. Both were checked:

- **No database triggers, no `plpgsql`, no `CREATE FUNCTION`** anywhere in `database.js`, `server.js`, `accountant-routes.js`, `admin-routes.js`.
- **The only `INSERT INTO audit_trail` in the codebase** is at `server.js:3571`, inside `auditLog()` itself.
- **No middleware logs writes.** All 16 `app.use` handlers were inspected; the `/api` ones are rate limiting, content-type/CSRF gating, plan checking (`:595`), account resolution (`:611`), entity/RBAC (`:640`, `:692`), 404 and error handling.
- **No other history/changelog/events table** is written on any path.

#### 2.2 · This is an ABSENCE, not partial coverage

`auditLog()` is called **twice** in the entire application — `invoice_payments` CREATE (`server.js:3688`) and `payroll_runs` CREATE (`:3835`) — and **zero** times in `accountant-routes.js`. No UPDATE is logged anywhere. No DELETE is logged anywhere.

**A schema with an empty table is not an audit trail.** Calling this "partial coverage" would imply a foundation exists to extend; it does not.

#### 2.3 · Enumeration from the ROUTES

**68 money-touching write routes. 2 logged. 66 unlogged (97%).**

| Record type | Routes (POST/PUT/DELETE) | Logged |
|---|---|---|
| invoices | `:878`, `:894`, `:912` | ✗ none |
| invoice_payments | `:3660` CREATE, `:3692` DELETE | **CREATE only** |
| expenses | `:925`, `:938`, `:955` | ✗ none |
| bills | `:2019`, `:2031`, `:2049` | ✗ none |
| payments_made | `:2299`, `:2320`, `:2343` | ✗ none |
| payments_received | `:2217`, `:2233`, `:2248` | ✗ none |
| sales_receipts | `:2178`, `:2194`, `:2208` | ✗ none |
| payroll_runs | `:3790` CREATE, `:3848` approve, `:3857` mark-paid | **CREATE only** |
| payroll (roster) | `:1105`, `:1115`, `:1131` | ✗ none |
| inventory_movements | `:4307` | ✗ none |
| inventory | `:996`, `:1005`, `:1018` restock, `:1040` | ✗ none |
| **holdings** | `:1390`, `:1405`, `:1416` | ✗ none |
| credit_notes / vendor_credits | `:2257`–`:2290`, `:2362`–`:2395` | ✗ none |
| entities | `:828`, `:846`, `:854`, `:859` activate | ✗ none |
| customers / vendors / items | `:968`…, `:1983`…, `:1050`… | ✗ none |
| user_settings (fiscal year, currency) | `:1475` | ✗ none |
| lock_settings (period close) | `:1582` | ✗ none |
| fx_rates / fx_transactions | `:4500`, `:4524`, `:4548`, `:4574` | ✗ none |
| journals / recurring-* | `:1600`…, `:2064`…, `:2143`… | ✗ none |

**Two silent-mutation paths carry no route of their own and are invisible even in principle:** `recalcInvoiceStatus` (`:3614`) and `recalcBillStatus` (`:3642`) rewrite `status` and `amount_paid` as a side effect of a payment. So even the ONE logged event — `invoice_payments` CREATE — does not record the invoice-status change it caused.

**The two status transitions that RECOGNISE payroll expense under decision 2** (`approve`, `mark-paid`) are bare `UPDATE payroll_runs SET status=…` with no logging. The moment an expense enters the P&L is unrecorded.

#### 2.4 · Enumeration from the DASHBOARD — acceptance test "why did this number change?"

| Displayed figure | Fed by | Answerable today? |
|---|---|---|
| Revenue | invoices, sales_receipts | **NO** |
| Expenses | expenses, bills, payments_made, payroll_run_lines | **NO** |
| Net Profit | all of the above + inventory_movements | **NO** |
| Outstanding / AR | invoices, invoice_payments (+ silent recalc) | **NO** |
| Investments | holdings | **NO** |
| Expense breakdown bars | expenses, bills, payments_made, payroll_run_lines | **NO** |
| Revenue-vs-Expenses chart | as Revenue + Expenses | **NO** |
| Transactions list | invoices, expenses, bills, payments | **NO** |
| COGS (A7.7/7.8) | inventory_movements | **NO** |
| Cash in / out / net (A7.9–17) | invoice_payments, payments_received, payments_made, expenses, payroll | **NO** |
| AP outstanding (A7.20) | bills, payments_made | **NO** |
| Payroll card (A7.21) | payroll roster | **NO** |

**Count of figures where "why did this number change?" cannot be answered: ALL OF THEM.**

Not one figure in `VERIFICATION.md` Part A has an answerable change history. The two logged CREATEs are the *creation* of a payroll run and of an invoice payment — neither tells you why a **total moved**, because the edits, deletions, status transitions and silent recalcs that move totals are all unlogged.

#### 2.5 · Reconciling the two lists

**The route axis was INCOMPLETE, and the dashboard axis caught it.** `holdings` feeds the Investments KPI (A1.13–15) but was absent from the first route enumeration — the money-route filter did not include it. Corrected: 65 → **68 routes**. This is Rule 13 working exactly as intended; the code-side list alone would have shipped a scope that silently omitted a dashboard figure.

**Reverse direction — logged routes feeding nothing displayed:** none. Both logged routes (`invoice_payments`, `payroll_runs` CREATE) do feed displayed figures. So there is no wasted coverage; there is simply almost none.

After correction the two lists reconcile: every record type reachable from a Part A figure appears in the route enumeration, and every money route writes a type that reaches a figure.

#### 2.6 · What a correct record requires, and what the schema supports

| Requirement | Existing column | Status |
|---|---|---|
| CREATE / UPDATE / DELETE | `action TEXT` | ✅ supported |
| Table + record identity | `table_name`, `record_id` | ✅ supported |
| **BEFORE and AFTER values** | `old_value`, `new_value` (TEXT) | ⚠️ **shape exists, but single-field only** — `field_name`/`old_value`/`new_value` model ONE field per row. A multi-field edit needs N rows, or a JSONB before/after pair. *"Was edited"* without *"from what to what"* answers nothing. |
| Actor | `user_id` | ⚠️ present, but must be the **acting** user (`req.session.userId`), not `scopeId` — otherwise an accountant's edit is attributed to the owner |
| Timestamp | `changed_at TIMESTAMPTZ DEFAULT NOW()` | ✅ supported (note F87: this is an instant; rendering it needs the entity timezone) |
| Origin | `ip_address` | ⚠️ present; no user-agent / session / API-vs-UI origin |
| Entity scope | `entity_id` | ✅ supported |

**Schema changes needed:** a JSONB `before`/`after` pair (or an accepted N-rows-per-edit cost), and an `actor_user_id` distinct from the account owner. Everything else the table already carries.

#### 2.7 · The structural guarantee (proposed, not built)

Per-route logging decays exactly as per-button dedupe did (Rule 9) — the next money route ships without it and nobody notices for months. Options, in ascending strength:

1. **Shared write path.** Route every mutation through `db.insert` / `db.updateById` / `db.deleteById`, and log inside those. Strongest, because logging becomes impossible to omit — you cannot write without it. Requires the two raw-`pool.query` mutation paths (`payroll_runs` status transitions, `recalcInvoice/BillStatus`) to be brought onto it.
2. **Commit-time check**, in the shape of the existing F13 bundle hook: a pre-commit scan that fails if a new `app.post|put|delete('/api/…')` touching a money table lacks a logged write. Catches drift at the point of authorship.
3. **Middleware** on `/api` for mutating verbs. Cheapest, but it sees the request, not the row — it cannot record before/after values, so it satisfies the letter and not the point.

**Recommendation: 1 as the mechanism, 2 as the guard against regression.** 3 alone would produce a log that says *"something was edited"* — the failure mode 2.6 identifies.

#### 2.8 · Rating — PRE-LAUNCH. Agreed, and the reasoning is asymmetric

**I agree with the owner's read.** Retrofitting after launch means every record created before the switch has **no history and can never acquire one**. An audit trail is not a feature that improves over time from the moment it is added; it is a property of the data from the moment the data exists. Adding it in month six leaves months one to five permanently unexplainable — and those are precisely the records an accountant will be asked to justify first.

The cost is also asymmetric in the other direction: doing it now is one shared-write-path change while there are 68 routes and no users; doing it later is the same change plus a migration, plus a permanent gap in the record. There is no version of this that is cheaper later.

Additional weight specific to this product: FinFlow is **accounting software with an accountant marketplace**. A professional signing off on figures is expected to be able to show why a number changed. Combined with F87 (two viewers already see different totals) and F90 (no record of who changed what), a disputed figure currently has **no forensic answer at all**.
**Course of action:** owner decision on sequencing. Scoped here; not designed in detail and not built.
**Done when:** every one of the 68 money-touching write paths records CREATE/UPDATE/DELETE with before/after values and the acting user, via a shared mechanism a new route cannot bypass — and the two silent recalc paths are included.

---

### F89 🟠 HIGH — Period boundaries are derived from the BROWSER clock; the server does not disagree — **NEW (2026-07-23, read-only verified)**
**Status:** OPEN. Its own finding, adjacent to F87.

`_fyContext()` (`app-main.js:1721`) derives the entire fiscal calendar from the client machine's clock:
```js
const now = new Date();
const fyStartYear = (now.getMonth() >= fyStartIdx) ? now.getFullYear() : now.getFullYear() - 1;
const monthsInFY  = Math.min(12, Math.max(1, (now.getFullYear()-fyStartYear)*12 + (now.getMonth()-fyStartIdx) + 1));
return { fyStartIdx, fyStartYear, monthsInFY, curFyIdx: …, now };
```
`_periodWindow` builds every window from that context and the client sends the resolved instants to `/api/reports`. The server validates the window only for **plausibility** — both dates parse, `end > start`, span ≤ 366 days, years 2000–2100 (`server.js:3264-3266`) — and otherwise **trusts it**.

**Consequence:** a user whose system clock is wrong gets wrong period boundaries, wrong "current month", and a wrong fiscal year, with **no server-side disagreement**. The books depend on an untrusted clock. Note this is a correctness/consistency issue, not a billing one — trial expiry is server-authoritative (see below), so it is not exploitable for entitlement.
**Course of action:** fold into the F87 consolidation via the architectural change under investigation — the client sends *intent* ("current month", "month index 5") and the **server** resolves the window from the server clock plus the entity timezone.
**Done when:** no period boundary reaching a money figure originates from `new Date()` on the client.

---

### F88 🟠 HIGH — The viewer-dependence CLASS: per-user settings applied to per-entity books — **NEW (2026-07-23, read-only survey)**
**Status:** OPEN — survey, for the consolidation spec. F87 is one instance; this records the shape and the other candidates.

**The pattern:** any setting stored **per USER** but applied to **per-ENTITY books** produces figures that depend on who is reading. The books belong to the entity; nothing about the reader should change a number.

| # | Setting | STORED | APPLIED | Exposure |
|---|---|---|---|---|
| 2a | **Fiscal year start** | `user_settings`, keyed `user_id` only — **no `entity_id`** (`server.js:1469`) | **Client-side**, read from the DOM `#s-fy` (`app-main.js:1735`, `:4550`; `wiring-dashboard.js:53`, `:485`) | **MITIGATED, not fixed** — `/api/settings` reads via `scopeId(req)` = `req.accountId`, which resolves an invited member/accountant to the **owner's** account (`server.js:~3540`), so a member is served the owner's FY. The per-user *shape* is still there, and the mitigation depends entirely on `scopeId` continuing to resolve that way. **The separate accountant-portal path (`accountant-routes.js`) has NOT been checked.** |
| 2b | **Display currency** | **NOWHERE server-side** — `window._displayCurrency` is a browser global (`app-main.js:4457`); no `display_currency` column or field exists | Conversion applied at **read time** via `/api/reports?display=CCY` at each leg's recognition-date rate | Two viewers with different display settings see different figures for the same books. Labelled with the currency, so less silent than F87 — but they reconcile only through a rate that moves, so the same two views do not reconcile *the same way tomorrow*. |
| 2c | **Timezone** | nowhere — implicit in the browser | Client builds boundaries at viewer-local midnight | **F87 — confirmed by execution.** |

#### 2e · Does the ENTITY carry a timezone? **NO — confirmed absent**
A case-insensitive search for `timezone` / `time_zone` / `tz_offset` across `server.js`, `database.js` and `accountant-routes.js` returns **nothing** (excluding `timestamptz` and the harness's own `log_timezone`). Entities have `name`, `currency`, `color`, `is_active`, `sort_order` — no timezone.

**This is the gap, and it is the other half of the Rule 10 fix.** Calendar dates are fixed by comparing strings. But genuine timestamps (`run_date`, `created_at`) are real instants, and assigning an instant to a month *requires* choosing whose month. That choice belongs to the **business**. With no entity timezone there is nowhere to put the answer, so the code falls back to the reader's zone by default.

#### 2f · Audit trail — a general mechanism EXISTS, but is almost entirely unused
`audit_trail` is a **general-purpose** table (`database.js:349-358`), not accountant-portal-specific:
`user_id, entity_id, table_name, record_id, action, field_name, old_value, new_value, changed_at, ip_address`, indexed on `(user_id, changed_at DESC)`.

**Coverage is the problem.** `auditLog()` is called from exactly **two** places in `server.js` — `invoice_payments` CREATE (`:3688`) and `payroll_runs` CREATE (`:3835`) — and **zero** places in `accountant-routes.js`. So across ~40 tables it records two CREATE events and no UPDATE or DELETE at all. Invoice edits, expense edits, bill status changes, entity changes and settings changes are **not** recorded.
*Reported rather than assumed, as asked: the mechanism is real, the coverage is ~nil.*

#### 2g · Period close / lock — a concept EXISTS
`lock_settings` (in the `TABLES` array, `database.js:498`) with `isLocked(userId, date)` (`server.js:~3620`):
```js
const s = rows[0] ? rowToObj(rows[0]) : null;
if (!s || !s.lock_date) return false;
return date <= s.lock_date;
```
Enforced on expense and invoice create/update, returning `403 Period is locked`.

Two observations. **First, this comparison is already the right shape** — `date <= s.lock_date` compares **date STRINGS**, not `Date` objects, so it is timezone-free. It is the pattern F87's fix should generalise. **Second, it is keyed on `user_id`, not `entity_id`** — the same per-user-vs-per-entity shape as the rest of this finding.

**On retroactive restatement (2g):** the data model currently supports **only** a single flat `lock_date` per user. There is no effective-dating anywhere, and no history of setting changes (see 2f — the audit trail would not record a timezone change either, since settings writes are not logged). So if an entity timezone were added and made editable, changing it would silently re-file every boundary-adjacent timestamp, **including inside locked periods** — `isLocked` gates *writes*, it does not freeze *computed figures*. A previously exported report would stop reproducing, and nothing would record why. **The model cannot support retroactive restatement safely today.** Effective-dating (prospective only) would need a new table or a versioned field; the payroll `start_date` shape is the closest existing precedent.

#### 2h · Trial expiry — SERVER-authoritative, confirmed
Not inferred. The gate runs server-side on the server's own clock:
```js
// server.js:354-360
const trialEnds = u.trial_ends ? new Date(u.trial_ends) : null;
if (plan === 'trial' && trialEnds && trialEnds < new Date()) {
  return res.status(402).json({ error: '…', code: 'TRIAL_EXPIRED' });
}
```
The only client-side use of `trial_ends` is the countdown **banner** (`index.html:4272-4275`, `Math.ceil((trialEnd - Date.now())/86400000)`). Setting the system clock back changes the banner text and nothing else — the 402 still fires. **No usage cap or plan limit is computed from the client clock.**

#### 2i · Feasibility of server-resolved windows — CONFIRMED FEASIBLE
Client sites that build a period window: **6** — `app-main.js:1621`, `:1653`, `:1802`, `:4505`, `:4544`, and `wiring-dashboard.js:264`, all routing through the single helper `_periodWindow` (`app-main.js:1744`), itself fed by the single helper `_fyContext` (`:1721`).

**Two chokepoints, not scattered logic.** The change is therefore tractable: `/api/reports` already accepts an explicit window, so it gains an *intent* form (`?period=month&monthIndex=5`) resolved server-side from the server clock plus the entity timezone; `_periodWindow` stops computing instants and passes intent through; the 6 call sites keep their signatures. That removes browser-clock dependence (F89), viewer-timezone dependence (F87) and the client-recompute divergence class in one move.
*Feasibility only — not built, not designed in detail, per instruction.*

**Course of action:** carry 2a/2b/2e into the consolidation spec. Decide whether fiscal year and timezone become **entity** fields. `scopeId`-based mitigation should not be relied on as the design.
**Done when:** every setting that affects a money figure is resolved from the entity, not the viewer, and A8 is green on all three axes.

---

### F87 🔴 CRITICAL — The same books show DIFFERENT TOTALS to viewers in different timezones — **NEW (2026-07-23, PROVEN BY EXECUTION)**
**Status:** OPEN. Multi-tenant. Affects the accountant marketplace directly. **Structural — belongs with the money-engine consolidation, NOT a patch now.**

**⚠️ FLAGGED, not silently changed (2026-07-31) — this status line appears stale against the rest of the ledger; owner confirmation needed before it's rewritten.** As found: this line still reads OPEN / "NOT a patch now", but every downstream reference in this file already treats the fix as landed and green —
- `34de981` ("resolve accounting periods server-side from intent, string-compare calendar dates") is **on `main`**, an ancestor of HEAD, landed 2026-07-30 — the exact fix this entry's own "The fix is NOT a better timezone" section prescribes.
- `H2`/`H3`/`H5`/`H6` (this file) all say **"predate F87 landing"** / reference gates going green **after** it, in the past tense.
- `H4` (this file): *"During F87 the gate's own AR computation gained a D2 filter, turning A7.1 red→green."*
- The **"F87 peripheral instances"** entry (below H6 in this file) is marked **✅ CLOSED (this commit) — 2026-07-31**, and its own text ("route... through the canonical resolver") presupposes the core resolver already exists and works.
- Session handover notes (not this file) report the gates this gate's own "Done when" clause names as satisfied: step4 viewer-independent 18/18 across all four viewers, tz-matrix identical with a discriminating boundary row present (not a weak-seed false green), step2 63/0, step3 32/1 (only the pre-existing, unrelated A7.4 red — since resolved, see F86 above).

**What it should probably say** (proposed, not applied — this entry's text is otherwise left untouched pending your go): **Phase 1 — the date-only calendar-date defect this entry measures and the four-viewer matrix above proves — FIXED, verified by execution (`34de981`; gates as listed above).** **Phase 2 is explicitly NOT built**: the commit message itself says "Phase 2 (entity-timezone for genuine timestamps) is hooked, NOT built," and this entry's own §1d "production blast radius" table still lists `payroll_runs.run_date` (a genuine `NOW()` instant, not a calendar date) as the live viewer-dependent field with no fix applied. So a full "CLOSED" would overclaim — Phase 1 done, Phase 2 open, tracked as the same finding's second half, not a new one (Rule 13: enumerate the class, don't split off a piece to look more done than it is).

Distinct from the 1st-of-month misfiling (same root cause, different blast radius): that one is wrong for *everybody equally*; this one makes two people **disagree about the same database**.

#### The measurement — FOUR viewers spanning the sign boundary

Identical seed, identical pinned instant, identical UTC cluster, seeded and read four times. **The only variable was the process timezone.** Harness: `node tests/harness/tz-matrix.js`.

| Period | Figure | LA (UTC-7) | POS (UTC-4) | LON (UTC+1) | IST (UTC+5:30) |
|---|---|---|---|---|---|
| May | opex | **1,377** | 600 | 600 | 600 |
| May | netProfit | **−777** | 0 | 0 | 0 |
| Jun | opex | **5,650** | **6,427** | 6,527 | 6,527 |
| Jun | netProfit | **−1,050** | **−1,827** | −1,927 | −1,927 |
| Jul | opex | **4,650** | **4,650** | 5,150 | 5,150 |
| Q2 | opex | **7,627** | **7,627** | 7,127 | 7,127 |
| Q3 | opex | **4,650** | **4,650** | 5,150 | 5,150 |

**10 figures differ across viewers of the same database.**

Boundaries differ at every period. June starts `2026-06-01T07:00Z` (LA), `04:00Z` (POS), `2026-05-31T23:00Z` (LON), `2026-05-31T18:30Z` (IST). The fiscal year starts `2026-01-01T08:00Z` for LA and `2025-12-31T18:30Z` for IST — **different calendar years**.

#### ⚠️ CORRECTION — the error is ASYMMETRIC, not universal

An earlier draft of this finding said a row dated the 1st is misfiled *"for every viewer, in every timezone."* **That was wrong**, and the four-viewer matrix disproves it.

June's window opens at the viewer's local midnight. West of UTC that instant is *later* than `00:00Z`; east of UTC it is *earlier*. A date-only row parses to `00:00Z`, so it falls **before** a western boundary (→ previous month, WRONG) and **after** an eastern one (→ correct month, RIGHT).

Measured, on the July column:

- **B2 is a bill issued `2026-07-01`, amount 500.**
- LA and POS (west): July = 4,650 — B2 **excluded**, misfiled into June.
- LON and IST (east): July = 5,150 — B2 **correctly** in July.

**A London user sees correct figures. A New York user does not. Same books, same instant.** With markets in both Europe and North America this is a live split, not a curiosity. Eastern viewers are currently getting the *right* answer by accident of longitude.

#### 1d · Production blast radius — which fields carry a TIME, not a DATE

Date-only fields misfile **uniformly for western viewers** (everyone west is wrong the same way). Viewer-*dependence* — two real users disagreeing **right now** — needs a value carrying a real time-of-day that lands in an inter-viewer gap. Those fields are:

| Field | Source | Carries time? | Notes |
|---|---|---|---|
| `payroll_runs.run_date` | `NOW()` (`server.js:3822`) | **YES — full instant** | The highest-risk field. Also F85. |
| `created_at` on every generic JSONB table | `DEFAULT NOW()` | **YES — full instant** | Used as the period key whenever the explicit date field is absent: `_expDate = e => e.expense_date || e.date || e.created_at` (`server.js:4095`), and the same fallback on invoices and bills. |
| `invoice_payments.payment_date` | client value, else `new Date().toISOString().slice(0,10)` (`server.js:3677`) | date-only | Truncated to a day — uniform misfile, not viewer-dependent. |
| `payments_made.date` | same shape (`server.js:2313`) | date-only | As above. |
| `invoices.issue_date`, `bills.issue_date`, `expenses.expense_date` | user-entered | date-only | As above. |
| `audit_trail.changed_at`, `fx_transactions.settled_at` | `NOW()` | YES | Not on a P&L recognition path today. |

**So the live viewer-dependent surface is: payroll runs, plus any row created through the app whose explicit date field was left empty and which therefore falls back to `created_at`.** A payroll run created between 20:00 and 24:00 local on month-end, or any `created_at`-keyed row in the inter-viewer gap, is filed into different months by different users **today**.

#### Root cause — stated precisely

**An accounting date is a CALENDAR DATE, not an instant.** `'2026-06-01'` has no time and no timezone; it is a label on a square in a calendar.

The system converts it to a moment, and converting a date to a moment *forces a timezone to be chosen*, which makes the answer depend on who is asking:

```js
// app-main.js:1744 — the boundary is built at the VIEWER'S local midnight
const start = new Date(fyStartYear, fyStartIdx + idx, 1);
qs.set('start', w.start.toISOString());          // → 04:00Z for GMT-4, 07:00Z for PDT

// server.js:3978 — and compared as instant-vs-instant
winInc = v => { const d = v ? new Date(v) : null; return !!d && !isNaN(d) && d >= ws && d < we; };
```

Two conversions, two different zones, one comparison. `new Date('2026-06-01')` yields UTC midnight; `new Date(2026, 5, 1)` yields *local* midnight. They are compared as if they were the same kind of thing. They are not.

#### The fix is NOT a better timezone

Not UTC, not the entity's zone, not the viewer's. Any choice still makes an accounting date depend on a timezone, and every choice is wrong for somebody.

**The fix is to remove timezone from the comparison entirely: compare DATE STRINGS to DATE STRINGS, never `Date` objects to `Date` objects.** A period becomes `'2026-06-01' <= d && d < '2026-07-01'` on a normalised `YYYY-MM-DD`, which is a total order on calendar dates and has no zone. Then `new Date` never appears on a recognition path.

That touches every period-filtered leg on both client and server, so it is a consolidation, not a patch. Patching one leg would leave the mirrors divergent — the F55 pattern.

#### Why no audit found this

It is invisible in source. Reading `_periodWindow` tells you a timezone is involved; it does **not** tell you whether any row falls in the gap, and therefore whether any figure moves. Only executing it under two timezones answers that.

**Note on the first run of this experiment: it showed NO difference and was a false negative.** Every seeded row carried a date-only string, which `new Date()` puts at 00:00Z — before *both* viewers' boundaries — so both were wrong identically and nothing moved. The seed could not discriminate (`CLAUDE.md` Rule 4). It only became measurable once a row was timestamped inside the inter-viewer gap. **A green timezone check against a date-only seed proves nothing**; `VERIFICATION.md` A8 carries that warning.
**Course of action:** no fix during the sweep (scope frozen). Carry into the money-engine consolidation as a hard requirement: one date comparison helper, string-based, shared by every leg on both sides. **Permanent check added as `VERIFICATION.md` A8 (6 checks).**
**Done when:** `tz-matrix.js` reports zero differing figures with the boundary row present, and no recognition path calls `new Date()` on a period boundary.

---

### F109 🟢 LOW (FEATURE) — Investments have no CLOSE-POSITION / realized-gain path — **NEW (2026-07-25, owner-requested)**
**Status:** OPEN — feature, owner-gated. No code.

Holdings are stored as an aggregate position (average cost; there is **no sell/close path** today — a position can only be added to or deleted wholesale, so a realized gain can never be recorded).

**Proposed:**
- A **full and partial close**: `realized_gain = shares_closed × (close_price − avg_cost)`.
- Persist a **realized-gains record**: `ticker, shares_closed, close_price, avg_cost, gain, date, scope` (business vs personal).
- Surface it as its **OWN investment-income line** — **NOT** folded into operating Net Profit (investment income is not operating revenue), and **personal-scope closes are excluded from the business books** (entity-scope separation).
- Labelled **tracking, not tax** (mirrors the app's existing no-tax-calculation disclaimers).
- **Cash-flow integration is a follow-on**, not part of the first cut.
**Done when:** a position can be fully/partially closed, the realized gain is computed and persisted, and it shows on a dedicated investment-income line without touching operating Net Profit or the business books for personal scope.

---

### F108 🟡 MEDIUM (DESIGN/DATA) — Entities have no JURISDICTION attribute — blocks a real `(name, jurisdiction)` uniqueness key and jurisdiction-aware accounting — **NEW (2026-07-25, owner-identified)**
**Status:** OPEN — design + owner-supplied backfill required. No code. **Prerequisite for C1 Wave 1b** (the `entities` unique key).

An entity today has a display name but **no structured jurisdiction**. Consequences: `entities` cannot take a meaningful hard unique key (name alone is not unique across jurisdictions — see C1 Wave 1b), and no leg can be jurisdiction-aware.

**Proposed:**
- A **structured, canonical** jurisdiction: **country + region/sub-national code** (e.g. ISO country + region), not free text.
- Enables the C1 Wave 1b constraint `UNIQUE (user_id, lower(name), jurisdiction)` and jurisdiction-aware accounting.
- This is a **registration / identity attribute**. It is **explicitly NOT a revival of the removed payroll tax engine (F8)** — no tax computation is implied or added.
- **Address is metadata, not the key** — the key is the canonical jurisdiction code, not a postal address string.
- **Requires owner-supplied backfill** of the existing entity's jurisdiction before the Wave 1b uniqueness constraint can be built (an un-backfilled NULL jurisdiction would weaken the key).
**Done when:** entities carry a canonical jurisdiction, the existing entity is backfilled, and C1 Wave 1b's `(user_id, lower(name), jurisdiction)` constraint can be applied.

---

### F107 🟡 MEDIUM — A login cannot see which accounts it can ACCESS: Team & Roles reads the owner axis, the account resolver reads the member axis — a membership that scopes your session into another account is structurally invisible — **NEW (2026-07-24, owner-reported, VERIFIED IN CODE) · RE-RATED 🔴 CRITICAL → 🟡 MEDIUM 2026-07-30**
**Status:** OPEN — 🟡 MEDIUM (re-rated 2026-07-30 from 🔴 CRITICAL, on code evidence verified from source at `b55d8f1`). **No code, no DB writes.** Structural defect verified from source; the specific production row (if any) is under read-only investigation (owner-run, since this checkout has no DB access). Log stands regardless of that outcome.

**The two axes point opposite ways (verified):**
- **Account resolver** (`server.js:660-667`) — `SELECT user_id AS account_owner_id FROM team_members WHERE data->>'member_user_id' = $1 AND data->>'status' = 'active'`. Reads rows where **you are the MEMBER**. If one exists, `req.accountId = account_owner_id` (`:671`), and `scopeId(req)` returns that — so **every `/api` data query silently scopes your session INTO that other account's books.**
- **Team & Roles page** (`GET /api/team`, `server.js:2486` + `:2495`) — `uid = req.session.userId`, then `db.allByUser('team_members', uid)` = `WHERE user_id = $1` (`database.js:670`). Reads rows where **you are the OWNER** (people you invited).
- **No endpoint anywhere selects `data->>'member_user_id' = uid` for DISPLAY.** So a user cannot see the memberships that grant *their* login access to *other* accounts.

**Consequence.** A user can be logged into their own login yet operating entirely inside another account's financial data (the resolver scopes silently, no UI indicator), with **no way to discover the membership** — it appears on nobody's screen: not the member's Team page (wrong axis) and, because `GET /api/team` keys on `req.session.userId` rather than `scopeId(req)`, not as the joined account's roster either. The member sees the *data* of the joined account but the *own* (empty) roster — doubly concealing the link. The resolver is fail-safe against *escalation* (absent/pending/revoked → own id, never more), but it does nothing about *visibility*: an active row is invisible to the person it grants access to.

**Why no audit caught it.** RBAC Phase 2 built the resolver (member axis) and the roster page (owner axis) separately; each is internally correct, and neither review asked "can a user enumerate the memberships that scope THEM elsewhere?" Same shape as F87 — the class lived in the gap between two correct-looking halves.

**Related / not yet determined (owner-run, read-only):** whether an ACTIVE `team_members` row currently links `theking012012@gmail.com` (login) as a member of the `luxurythebrand01@gmail.com` account — which would explain a session reading the other account's payroll. If such a row exists AND its `data` blob does not match the invite→accept shape (`status:'pending'`→`'active'` with `invited_by`, `invite_token_hash`, `invite_expires`, `member_user_id` set on accept — `server.js:2555-2611` + accept flow), that is a **second, more serious finding (how did an active cross-account grant get written outside the invite flow?)** — but that requires the data and is NOT asserted here.
**Course of action (owner-gated, not built):** (1) a "Accounts you can access" view that selects `member_user_id = uid` (the missing axis); (2) an active-session banner when `req.accountId !== req.session.userId` so a scoped session is never silent; (3) ensure membership creation/flip is audit-logged (**F90**). Depends on the data investigation for the incident half.
**Done when:** a user can see, in the UI, every account their login can access; a session scoped into another account shows that fact; and the origin of any existing active cross-account row is explained.

---

**⟶ RE-RATE RULING (2026-07-30, code evidence at `b55d8f1`) — the original finding above stands unedited; this is the ruling appended to it.**

**Re-rate basis.** The defect is a **TRANSPARENCY** gap, not an access-control one. Verified in the current source:
- The account resolver is **deny-by-default**. `req.accountId = uid` is set BEFORE the membership query (`server.js:658`); cross-account scoping needs a positive match on an active row whose owner is not the caller (`671-673`); and the catch path returns own id (`676`, *"fail-safe: own id, never escalate"*). Not permit-on-missing.
- **No attacker-triggerable path to an active row.** Invite requires `requirePerm('team:manage')` AND owner/admin `accountRole`, and invites into `scopeId(req)` — the account already controlled (`2557-2562`). Accept requires a valid unexpired token plus, for a pre-existing email, session identity or bcrypt password proof (`2696-2698`). Self-accept is rejected (`2724`). A known entity id does not help: the override checks `WHERE id=$1 AND user_id=$2` against `scopeId(req)`, else 403 (`694-695`).
- **The visibility gap itself is UNCHANGED.** The resolver reads the member axis (`data->>'member_user_id'`, `664`) while `GET /api/team` reads the owner axis (`allByUser`, `2496`). `member_user_id` appears in only four places in server.js — the resolver read, two comments, and the accept write (`2734`). There is no display endpoint on the member axis, so a membership that relocates a session appears on nobody's screen.

**What MEDIUM covers:** a legitimately invited member can be operating inside another account's books with no on-screen indicator and no way to enumerate which accounts their login can reach. Real, and worth fixing — but not the "outsider reads your financials" that CRITICAL implies.

**Public repo weighting, taken honestly:** readable source makes the gap trivially discoverable and the invite mechanics fully known. That argues for fixing the transparency gap promptly. It does not create an access primitive that is not there.

**The rating rests on CODE**, deliberately not on "zero team_members rows" — that is live table state, it is not something the code depends on, and it stops being true the first time anyone is invited. A rating resting on it would expire silently.

**STILL PARKED, needs the owner and a live DB — not assertable from source:** whether an ACTIVE `team_members` row currently links one login into another account, and whether it was produced by the invite→accept flow or written directly. A row of unknown provenance would be a separate finding at a higher grade. This is a query, not an analysis — worth running rather than leaving open indefinitely.

---

### F111 🟡 MEDIUM — no member-axis visibility for team memberships (the remediation half of F107) — **NEW (2026-07-30), OPEN**
The remediation half of **F107**, logged separately because it is a feature, not a patch: (a) an endpoint and UI listing the accounts a login can access, reading the member axis the resolver already queries (`data->>'member_user_id' = uid`); (b) an indicator on any session scoped into an account the user does not own (`req.accountId !== req.session.userId`). F107 records the defect; F111 is the work.

---

### F106 🟡 MEDIUM — No way to delete or VOID a payroll run — once created, a run is permanent from the UI — **NEW (2026-07-24, owner-reported, verified against main)**
**Status:** OPEN — design question for the owner. **No code; do not build the fix.** This is the flip side of **C1** (duplicate-submit): the app can CREATE a duplicate run and offers no way to UNDO one.

**Verified facts (main):**
- **No `DELETE /api/payroll-runs/:id` route.** The payroll-run routes are only `GET /api/payroll-runs`, `POST`, `GET /:id`, `PUT /:id/approve`, `PUT /:id/mark-paid` (`server.js:3808-3887`). No delete, no void.
- **Run History renders no remove/void control** — only Approve (draft) and Mark Paid (approved) buttons (`index.html:4614-4625`).
- The one `app.delete` that looks related, `DELETE /api/payroll/:id` (`server.js:1174`), targets an **employee/roster row** (`payroll` table), **not** a run (`payroll_runs`). Different vocabulary (Rule 11-adjacent): payroll ≠ payroll_runs.
- **Consequence:** a double-fire (C1 gap #3 — `POST /api/payroll-runs` is unguarded, `server.js:3726`/§C1), a wrong-period run, or a test run **cannot be removed without direct DB access** — which is exactly why this session's Part-1 cleanup is a hand-run SQL transaction against live data.

**Open design question (owner decides — DO NOT implement):**
- **Hard DELETE vs VOID?** For `approved`/`paid` financial records, **void** (a reversing entry, or `status='voided'`) is usually the correct accounting pattern. A hard delete leaves no trace, which conflicts with the audit-trail direction (**F90**).
- **Should a `paid` run be removable/voidable at all**, or only reversible by a compensating entry?
- Whatever the mechanism: it **must be audit-logged** (**F90**) and **must not silently restate a closed period** (**F87**/**F94** class — excluded/reversed from the books must remain visible and dated, never a silent figure change).

**Links:** flip side of **C1** (duplicate-submit — creation half; `POST /api/payroll-runs` is C1 unguarded gap #3). Depends on **F90** (audit trail) for the void mechanism, and is constrained by **F87**/**F94** (no silent period restatement). **Rating 🟡 MEDIUM** — a missing remediation capability, not an active wrong-figure bug (the corruption source is C1); escalates in practice because the paired create route writes money and is unguarded.
**Done when:** the owner has decided delete-vs-void and the paid-run policy; only then does it leave OPEN for a scoped fix.

---

### F105 🟠 HIGH (PROCESS) — A finding was double-logged and a settled decision re-opened, because the ledger was searched positionally, not by topic — **NEW (2026-07-24)**
**Status:** OPEN — reconciliation check PROPOSED (design only, not built), per owner sequencing. This is a process defect: the ledger failed at the one thing it exists to do.

**What happened (honest account).** While logging F102/F103 I:
1. **Searched the ledger positionally, not semantically.** I grepped `F99|F100|F101` to find where to *insert* new rows — I never searched the ledger by TOPIC (`payroll`, `draft`, `status filter`). So **F80** — the identical defect, logged the day before — never surfaced, and I logged it again as F104.
2. **Read the seed, not the decisions.** I read `expected.js`/`seedData.js` to get expected numbers, but never opened `VERIFICATION.md`'s **ACCOUNTING BASIS — DECIDED** table. So **Decision 2** (draft contributes 0 — settled) was invisible to me, and F104 posed it as an open question.
3. **Let the engines grade their own homework.** Because I hadn't read Decision 2, my F102 probe used the *other engine* as its oracle (client == server) and went green on 12,700 — a number wrong by decision. Exactly Rule 6.

**Why the ledger did not catch it.** Nothing mechanically links a NEW finding to (a) existing findings on the same code anchor, or (b) a settled decision on the same topic. `verification-sync.js` already reconciles `expected.js` ↔ `VERIFICATION.md` at pre-commit; there is no equivalent reconciliation for the ledger itself.

**Proposed check (design only — DO NOT BUILD until sequenced) — extend the pre-commit reconciliation, same shape as `verification-sync` + `bundle:check`:**
- **(a) Anchor-collision guard.** Every finding declares the code anchors it concerns (`file:line`/function — most already cite them inline). A gate greps every finding's anchors and **fails the commit when two DISTINCT finding numbers claim the same anchor** without one citing the other. F104 named `server.js:4189` **and** `app-main.js:1699` — both already owned by F80's fix scope → collision → flagged. This is mechanical (exact strings), not semantic; buildable now.
- **(b) Decision-citation guard.** `VERIFICATION.md` decisions get stable ids (Decision 1..5 already exist). Any finding whose body contains decision language (`decision needed`, `held for owner`, `does X accrue`, `open question`) MUST cite `Decision N` or assert "no decision exists". The gate extracts each decision's keywords and, if a decision-flavoured finding overlaps a decided topic it does **not** cite, **fails with a pointer to that decision** — so a settled decision cannot be silently re-opened.
- Both run in the existing pre-commit hook and print the offending anchor/decision, like `[verification-sync] OK` does.
**Done when:** the check exists, and re-adding an F104-shaped duplicate (or a finding re-opening Decision 2) fails the commit with a pointer to F80 / Decision 2.

---

### F104 — WITHDRAWN (duplicate of F80). Number retired, do not reuse.
Logged in error on 2026-07-24 re-opening a **settled** decision (`VERIFICATION.md` Decision 2: draft payroll contributes 0). The draft-payroll-recognition defect is **F80** (now updated to cover both the server and client legs). This finding never committed. Root-cause of the double-log and the guard that would prevent it: **F105**.

---

### F102 🟠 HIGH — Dashboard Expenses/Profit OMIT payroll on a cold boot; a payroll action fixes it, a refresh breaks it again — load-order dependence — **NEW (2026-07-23, owner-reported) → EXECUTED + FIX HELD (2026-07-24)**
**Status:** FIX HELD (diff ready, awaiting owner approval — not committed). **Lands as ONE change with the F80 draft filter** (verifying either requires the other). VERIFIED BY EXECUTION.

**Which figure the card shows (the owner's first question).** In NATIVE currency `d-exp` is the CLIENT figure: `updateDashboard` writes `S(computeExpenseBreakdown().total)` (`app-main.js:2048`), and that engine reads `window.payrollRuns || []`. The SERVER's `computeBooks` opex is painted onto `d-exp` ONLY under a non-native display currency (FX overlay, `app-main.js:4607`). So in native currency the client engine is authoritative and was un-cross-checked.

**The bug.** `loadPayrollRuns` (`index.html:4597`) fired only after create/approve/mark-paid and on Payroll-page nav — **never at boot**. So `window.payrollRuns` was empty on a cold boot → the payroll leg was 0 → Expenses/Profit understated on every client surface until a payroll action populated it; a refresh emptied it again.

**Root, not symptom.** Every sibling money store already loads at boot (`_realExpenses` in `loadEntityData`; `bills`/`paymentsMade` from the pages-wiring boot IIFE — confirmed in the bundle at `3929`/`4091`). Payroll runs were the lone omission. Fix: fire `loadPayrollRuns()` from `loadEntityData` (`app-main.js:1490`) so the runs load at boot AND on every entity switch. `loadEntityData` is the runtime winner (exposed once at `app-main.js:1507`; `bundle.js` concatenates only the 10 wiring files, not `app-main.js`, so there is no shadow copy).

**Not the money-engine consolidation.** The client still recomputes what the server computes — two implementations of one figure. That consolidation is step-4 work; A6's client cross-engine probe will guard it once built. Until then this is verified AD HOC by the probe below.

**Verification — `tests/harness/verify-f102-payroll-boot.js` (jsdomBoot, real seeded Postgres), oracle = `expected.js` (Rule 6, NOT the other engine):**
```
client d-exp  "$9.4K"   server opex 9400   expected.js FY opex 9400   → all three agree ✅ (7/7 green)
bug values: payroll-missing 3,200 ("$3.2K")  |  draft-counted 12,700 ("$12.7K")  — d-exp is neither ✅
```
Rule-14 controls (each fix removed in turn, EXECUTED): with boot-load off → d-exp "$3.2K" (3 fail); with draft filter off → d-exp "$12.7K" == server "$12.7K" (client==server still PASSES, oracle assertion FAILS — the Rule-6 trap made visible). Proves both fixes are load-bearing and the probe is not a tautology.
**Done when:** committed (with the F80 filter, one commit), and A6's client cross-engine check exists so this is no longer verified ad hoc.

---

### F103 🟠 HIGH — The rate-limiter key's `|| 'unknown'` fallback reintroduces F100's OWN shared-budget defect through the degrade path — **NEW (2026-07-23, found while re-reading the F100 fix)**
**Status:** ✅ FIXED (this commit) — follow-up to **F100**.

`_rlKey` (`server.js:312`) was `(req.session?.userId) ? 'u:'+userId : 'ip:'+(req.ip || 'unknown')`. `req.ip` is undefined only when `req.socket.remoteAddress` is undefined — a destroyed socket (express 4.19.2 → proxy-addr → `forwarded()` puts the socket address at element 0, so a live request always carries it). Rare, not impossible. Under the fallback, EVERY such request keyed to the single bucket `'ip:unknown'` and they collectively drained one 600/300 budget, locking each other out — **the exact shared-budget defect F100 exists to eliminate, reintroduced through the fallback.**

**Fix:** an unidentifiable request gets its OWN bucket — `'anon:' + crypto.randomUUID()` (unique key ⇒ count of 1 ⇒ never limited). Degrade, never share. `crypto` is already imported (`server.js:10`); rare + `windowMs` TTL ⇒ negligible store growth; not attacker-usable (forcing `req.ip` undefined needs a destroyed socket, which drops the request rather than delivering it under a shared key). One edit to `_rlKey` covers all four limiters that use it (read/write/api/invite); accountant-routes has no separate key generator (only a TODO at `accountant-routes.js:330`), so nothing else needs it.
**Verification:** logic verified by inspection; `server.js` boots clean (exercised by the real server under the F102 harness). The destroyed-socket trigger is **UNEXECUTED** — it cannot be readily induced without tearing down a live socket mid-request.
**Done when:** committed. ✅

---

### F99 🔴 CRITICAL — The rate limiter is below the app's OWN cold-boot cost, and reads share a write-sized budget — the ROOT CAUSE behind F96/F97/F98 — **NEW (2026-07-23, MEASURED)**
**Status:** ✅ FIXED (this commit) — rate-limiter read/write split, read 600 / write 300. Per-user keying is **F100** (next commit). The duplicate-fetch half is step-4 work (see below).

**F96/F97/F98 are how the app REPORTS a failed `GET /api/entities`. This is WHY the fetch fails.**

`apiLimiter = rateLimit({ windowMs: 60_000, max: 200 })` applied globally at `server.js:313`, shared by every `/api` method.

**Measured cold-boot cost (not estimated).** `tests/harness/measure-boot-requests.js` counts at the fetch layer via `jsdomBoot`:

| metric | value |
|---|---|
| total `/api` requests per cold boot | **69** |
| unique method+path | 38 |
| **redundant (duplicate) fetches** | **31** |
| arriving within 2s | 44 |
| GET / non-GET | 66 / 3 |

> ⚠️ **69 IS A FLOOR, NOT A CEILING.** The harness counts only what the SPA's JS requests in jsdom on a dashboard-only boot: page-specific loaders that fire when their tab is opened (MRR, accountant, banking, etc.) do not run, and jsdom fetches no images / fonts / charts. A real browser boot — and any boot that lands on a non-dashboard page, or navigates — is **≥ 69**. Do not size the cap to 69 as if it were the maximum. *(Corroborates the owner's HAR: 38 unique, ~65 total, ~27 redundant.)*

**The arithmetic.** 200 ÷ 69 ≈ **2.9 boots per minute** before `429`. A user who reloads three times, opens the app in three tabs, or navigates a few pages within 60s is locked out — and the failed `GET /api/entities` renders the empty "Create a business" dashboard (F96). The owner's HAR showed 17×`429` on one boot because that boot began with the budget already ~3/4 spent by prior activity in the window.

**Two distinct defects in one limiter:**
1. **Cap below boot cost.** 200/min cannot absorb the app's own boot, let alone reloads.
2. **Reads share a write-sized budget.** A boot is 66 idempotent GETs + 3 writes. A cap exists to bound *mutation* abuse; sizing reads to it throttles normal use. GETs should not share a budget with POST/PUT/DELETE.

**Proposed (held):** split into a per-user **read** limiter (GET/HEAD, **600**/min ≈ 10 boots) and a per-user **write** limiter (**300**/min). Keying is F100.

**Write cap — settled against real usage (owner flagged, checked per Rule 13).** The write budget must survive a bookkeeping BURST, not just a lone action:
- **Bank reconciliation** — `POST /api/bank-reconciliation/match` (`server.js:3754`) is strictly **one POST per item, no batch endpoint** (F101). `matchBankRec` (`index.html:4551`) fires one POST per click; a busy month is 100–300 matches and a fast reconciler rapid-confirms at 2–3/sec = **120–180/min**. A 100/min cap would lock a paying user out **mid-reconciliation** — the exact self-inflicted lockout, on a different surface. **300/min** covers ~5/sec (beyond any human) and still trips a runaway retry-storm/script (orders of magnitude more).
- **Other per-item write loops (swept, Rule 13):** the only client `Promise.all` write-ish burst (`finflow-api-wiring-medium.js:1052`, consolidated-entities) fires `GET /api/reports?entity_id=` per entity — **reads**, covered by the 600 read budget, not writes. No CSV/import write-per-row loop exists. Manual expense/invoice/transaction entry is form-paced (single-digit writes/min), nowhere near the cap. So reconciliation is the binding write surface, and 300 accommodates it.

> ⚠️ **The 31 duplicate fetches are NOT fixed here.** Raising the cap treats the symptom; the app re-fetching `/api/invoices` 7× and `/api/expenses` 7× per boot is the disease, and it belongs to the **money-engine consolidation / server-side period resolution in step 4 of `VERIFICATION.md`'s sequencing plan** — NOT this immediate unblock. Recorded so raising the limit is not mistaken for fixing the redundancy.
**Done when:** a cold boot + reasonable reloads never 429; and (separately, step 4) the duplicate fetches are eliminated so the boot costs ~38, not 69.

---

### F101 🟡 MEDIUM — Bank reconciliation matches one POST per item, with no batch endpoint — forces a high write cap — **NEW (2026-07-23, found while sizing the F99 write cap)**
**Status:** OPEN. Not fixed here; it is *why* the F99 write cap must be 300 rather than tighter.

`POST /api/bank-reconciliation/match` (`server.js:3754`) accepts a single `{ banking_id, invoice_payment_id }`. Reconciling a busy month is therefore 100–300 separate POSTs, one per click. This is the reason the write limiter cannot be tightened to a value that would otherwise be ample for mutation-abuse protection: a legitimate reconciliation session is indistinguishable, by request count, from a runaway loop.

A **batch match endpoint** (`POST …/match` accepting an array of pairs, one transaction) would collapse a whole reconciliation into a handful of requests, let the write cap drop back toward human-action cadence, and remove the burst entirely. It is a small, self-contained server+client change — but it is a **feature change, not the immediate unblock**, so it is logged for the step-4 pass, not done now.
**Done when:** a full reconciliation costs a bounded, small number of requests regardless of item count, and the write cap can be revisited downward.

---

### F100 🔴 CRITICAL — The API limiter is keyed on IP, so users behind one NAT/CGNAT rate-limit each other — **NEW (2026-07-23)**
**Status:** ✅ FIXED (this commit) — authenticated /api keyed on `session.userId`, IP fallback for unauthenticated. Multi-tenant defect.

`apiLimiter` has **no `keyGenerator`**, so express-rate-limit defaults to `req.ip`. `app.set('trust proxy', 1)` (`server.js:278`) is set, so `req.ip` is the client's forwarded IP — which for a mobile carrier's **CGNAT** is a single address **shared by thousands of paying customers**. An office, a school, or two people on the same carrier draw down **one** shared budget: they rate-limit each other out of an app they pay for, and no individual user did anything wrong.

Combined with F99 (a cap already below one user's boot cost), the shared-IP budget is exhausted almost immediately under any concurrency.

**Proposed (held):** key authenticated `/api` traffic on the **user** — `req.session.userId` is already resolved at `server.js:313` (the session middleware at `:279` runs first; account resolution at `:611/:640` does not, so key on `session.userId`, the actor, not `accountId`). Unauthenticated calls keep IP-keying; the auth routes already have the tight `authLimiter`. The accountant per-route `apiLimiter` (`accountant-routes.js`) must be keyed the same way, or the portal keeps the defect.
**Done when:** two users behind one NAT/CGNAT have independent budgets; a shared public IP no longer couples unrelated accounts.

---

### F98 🟠 HIGH — The dashboard error state does not STICK: unguarded d-rev writers overwrite `_dashSetState('error')` — **NEW (2026-07-23, found while verifying the F96 fix)**
**Status:** ✅ FIXED (`b4e8d81`) + VERIFIED by execution. `updateDashboard` now respects a `window._dashLoadError` latch (same shape as the adjacent `_fxPending` guard) and delegates to the error renderer instead of repainting `$0`. Verified in jsdom (`jsdom-spike.js`, `FAIL_ENTITIES`): d-rev settles on `—` and stays; happy path settles `$15.0K`; a successful-but-empty 200 shows "Create a business", never the error state.

Verifying the F96 entities fix in jsdom with an injected `/api/entities` 500 showed, at 100 ms polling, the d-rev trajectory **`"—" → "$0"`** with `_ffAuthed === true` and `typeof _dashSetState === 'function'`. So `_dashSetState('error')` **does fire and does paint `—`** — and is then **overwritten** by a later render.

The overwriters are unguarded: `updateDashboard` writes `d-rev` unconditionally from `computeRevenue()` (`app-main.js:2035`), and the FX overlay writes it at `:4564`. **No error-latch exists** — a grep for `_dashError`/`_dashState`/`dashboardError` finds nothing — so any render that runs after the error paint repaints `$0` from the (empty) client stores, with no awareness that a load failed.

**Consequence:** the F67 pattern (`_dashSetState('error')`) works at the *end* of a data pipeline (loadEntityData, where nothing repaints after) but **not** at boot, where the whole render pipeline runs afterward. So F96's prescribed fix is necessary but insufficient on its own.
**Course of action:** an error-latch every d-rev writer respects — e.g. `window._dashLoadError = true` on a failed load (cleared on success), checked by `updateDashboard` and the FX overlay so they paint/keep `—` instead of `$0` while it is set. Touches ~3 render sites, so it is a scoped multi-writer change, not a one-liner — hence held for a decision rather than folded silently into the F96 fix.
**Done when:** with a failed entities load, d-rev stays `—` (error state) and does not get repainted to `$0` by any dashboard render.

---

### F96 🔴 CRITICAL — Silent `if(!res.ok) return` paints a complete, empty, error-free dashboard — a CLASS (owner-identified, confirmed) — **NEW (2026-07-23)**
**Status:** ✅ FIXED + VERIFIED across the class (5 of 6 sites; `_loadPeriodCOGS` was already correct). Entities instance: `b4e8d81` (see F97/F98). Class treatments — banking, MRR, accountant, recurring-prefill: fixed this commit and **EXECUTED**, not pattern-mirrored, via `tests/harness/boot-failures-gate.js` (**19/19**), each failed on BOTH the status (`!res.ok`) and network (`catch`) paths — the network path was a real gap reasoning had missed (the prefill catch was silent, so it would still have lost data on a dropped connection). The prefill test drives the real modal+save and asserts against the DATABASE that `recurring_profile_id` is unchanged and that the PUT body omits the field.

> ⚠️ **Correction to this row's earlier wording** (which called the four treatments "pattern-mirrors, not individually failure-injected"): they are now each executed. Generic failure injection (`jsdomBoot.js`, one line per endpoint, status or network) closed the tooling gap — see **Rule 14**.

**Root cause link:** F96/F97/F98 make a failed fetch VISIBLE and recoverable; **F99 (rate cap below boot cost) and F100 (IP-keyed budget) are WHY the fetch fails** in production. This finding is the report surface; those two are the disease.

**The pattern:** a client loader does `const res = await fetch(...); if(!res.ok) return;`. A non-ok response is **not** an exception, so the surrounding `try/catch` never fires and **nothing is logged**. The loader returns as if there were simply no data. The user sees an empty surface indistinguishable from a genuinely empty account, with no error and no retry.

**The worst instance — `_loadEntitiesFromDBImpl` (`index.html:5116`).** If `/api/entities` returns non-ok:
- `ENTITIES` stays empty;
- `loadEntityData()` (line 5176) is never reached, so **no financial data loads at all**;
- `sb-brand-name` (line 5157) is never written, so the sidebar keeps its **static HTML default** — the literal text **"Create a business"** (`index.html:1091`);
- the outer `catch` (5216) only `console.warn`s, and only on a thrown exception — a non-ok response doesn't throw, so **nothing is logged**.

Result: a complete, normal-looking, **totally empty** dashboard that is indistinguishable from a brand-new account — for a user who may have a full set of books. This is the F31/F62/F67 class (fake-zero vs honest-error), client side.

#### The class — all six sites, and what the user sees when the fetch fails

| Site | Loader | Endpoint | User sees on non-ok | Money? |
|---|---|---|---|---|
| `index.html:5116` | `_loadEntitiesFromDBImpl` | `/api/entities` | **entire dashboard empty + "Create a business" sidebar** | ⚠️ all |
| `app-main.js:4948` | `loadBankingFromDB` | `/api/banking` | Banking page shows no transactions; in/out/net read empty — looks like a genuinely empty banking history | ⚠️ yes |
| `index.html:4222` | `loadMRRData` | `/api/recurring-invoices` | MRR/ARR cards read $0/stale — looks like "no subscriptions" | ⚠️ yes |
| `index.html:7373` | `loadAccountantMessages` | `/api/accountant-messages` | chat panel stays hidden (the `display='block'` is after the return); looks like no messages / no accountant | no |
| `app-main.js:3286` | `_prefillRecurringForEdit` | `/api/recurring-personal-transactions` | edit modal's "recurring" toggle defaults to OFF — a failed fetch looks identical to "not recurring"; user may silently un-recur a transaction | no (but misleading) |

**The correct pattern, for contrast — `_loadPeriodCOGS` (`app-main.js:4519`).** `if(!r.ok) return;` here is **right**, and its comment says why: *"keep prior `_cogsTotal`; honest-stale > fake-zero."* It preserves the last good value rather than fabricating a zero, and repaints nothing. This is the intended shape when a refresh fails: **stale-but-true, never fake-empty.** Leave it.

**The distinction that decides treatment:** a loader that would render an **empty state indistinguishable from real emptiness** on failure needs the failure made visible (throw → `console.error` → a surface-appropriate error state). A loader that **keeps the prior true value** (4519) is already correct. The instrument differs per surface — `_dashSetState('error')` fits the dashboard (entities); Banking and MRR need their own error affordance, not the dashboard's; the accountant panel and the recurring-prefill modal warrant at least a `console.error` and, for the modal, arguably nothing more since it fabricates no figure.
**Course of action:** fix entities now (with F97). Report the other four for an owner treatment decision — which is this row. Do **not** blanket-convert all five: the recurring-prefill (3286) fabricates no money figure and the accountant panel (7373) is not a money surface, so they may warrant lighter handling than the money surfaces (4948, 4222).
**Done when:** every loader that would paint a fake-empty money surface on failure makes the failure visible and distinguishable from real emptiness; 4519's stale-preserving pattern is left intact.

---

### F97 🔴 CRITICAL — The boot memo latches a FAILED entities load forever; only a hard refresh recovers — **NEW (2026-07-23, owner-identified, confirmed)**
**Status:** ✅ FIXED (`b4e8d81`) + VERIFIED by execution. `loadEntitiesFromDB` now un-latches on any incomplete load (the impl resolves `true`=complete / `false`=failed), not only a missing builder. Verified in jsdom: after an injected `/api/entities` 500, `window._ffBootPromise` is `null` (un-latched) so the next trigger re-fetches. Rule 1 confirmed against `wiring-postgres.js:347` — the wrapper delegates to this copy.

`loadEntitiesFromDB` (`index.html:5231`) memoizes the first boot load in `window._ffBootPromise` (the F50 loader-storm dedupe). It un-latches an incomplete load so a later trigger can re-run a complete one — but the un-latch condition is:
```js
// index.html:5243-5247
p.then(function(){
  if(typeof window._buildMonthlyArrays !== 'function' && window._ffBootPromise === p){
    window._ffBootPromise = null;   // incomplete → don't hand this empty load to the next caller
  }
});
```
It un-latches **only when the deferred builder was missing**. A load that failed because the **fetch failed** (F96: `if(!res.ok) return`), with the bundle already present (`_buildMonthlyArrays` is a function), does **not** meet the condition — so the dead, empty promise **stays latched**. Every subsequent `loadEntitiesFromDB()` returns the memoized empty promise and never re-fetches. That is why the empty state persists until a hard refresh.

The comment directly above it (*"Pre-fix the memo latched that empty load forever"*) records that this was fixed for **one** cause (builder missing) and not the **other** (fetch failed) — the instance-not-class pattern (Rule 13), in the very code that was meant to fix it.

**Rule 1 note (verified, not assumed):** `window.loadEntitiesFromDB` is reassigned at `finflow-api-wiring-postgres.js:348`, which loads after `index.html`. It is a **wrapper**, not a replacement — `const _origLoadEnt = loadEntitiesFromDB; window.loadEntitiesFromDB = async f => { await _origLoadEnt(f); …vendors/bills }` — so the memo in the `index.html` copy **is** on the live path (one of the 5-of-28 wrapper overrides where editing the original takes effect). Editing `index.html:5231` is correct here; this was checked against the wiring source before proposing the fix, precisely because editing a shadowed copy is this repo's most expensive trap.
**Course of action:** un-latch on **any** incomplete load, not just a missing builder — if the load did not populate `ENTITIES`, the memo must not latch. Requires F96's impl to signal success vs failure (it now returns `true`/`false`).
**Done when:** a failed entities load un-latches the memo, so the next trigger re-fetches instead of returning the dead promise; a genuinely-empty account (a real, complete load) still latches normally.

---

### F95 🔴 CRITICAL — Two disjoint money-in stores; Cash Flow is BLIND to one of them, and a real payment's cash timing depends on the entry path — **NEW (2026-07-23, read-only verified)**
**Status:** OPEN. Live. Same class as **F84** (the entry path decides whether the figure is right) and entangled with **F92** (`recalcInvoiceStatus` side-effect). Answers the F86 live question: **yes, a real payment can vanish from — or be mistimed in — Cash Flow depending on how it was entered.**

**Update 2026-07-31 — does NOT collapse; flagging rather than silently marking resolved (`REVIEW_RULES.md` Rule 6).** F86 was closed today: `payments_received` (Store A) is confirmed empty in production and `invoice_payments` (Store B) is now the owner-declared canonical "Payments Received" source. That is a **test/seed sourcing decision**, not a code change, and it does not touch any of this finding's three consequences:

- Re-read `server.js:3503-3512` (current `POST /api/reports/cash-flow`) directly for this update: the cash-in leg still does `db.allByUser('payments_received', uid)` and sums it as `paymentsIn` — it still **never reads `invoice_payments`** anywhere in that route. The three-line snippet quoted below in this entry is unchanged today, line-for-line in substance (only line numbers drifted from other commits).
- `POST /api/payments-received` and the Payments Received page are still fully live (`server.js:2261` et seq.) — "empty in prod" is today's row **count**, not an enforced invariant. Nothing in the code stops a new Store A row tomorrow, so **(C) double-count is still fully reachable**, not closed off.
- **(A) wrong-date recognition** and **(B) invisible partial payment** for `invoice_payments`-based settlements are unaffected either way — the cash-in leg was never wired to that store at all, canonical-store decision or not.

**Net effect of today's F86 decision on this finding: none.** If anything, declaring Store B canonical while cash-in continues to read only Store A makes the gap sharper, not smaller — the "canonical" money-in store is the one Cash Flow's cash-in leg doesn't look at. **Status stays OPEN**, unchanged severity. The consolidation this entry's "Course of action" describes is still the only fix.

#### Two money-in stores, two entry paths

| Store | Written by (UI) | Server route |
|---|---|---|
| **`invoice_payments`** (typed) | **"Mark invoice paid"** — `markInvoicePaid` (`finflow-api-wiring-medium.js:164`), pays the **full remaining** balance | `POST /api/invoice-payments` (`server.js:3660`), then `recalcInvoiceStatus` flips the invoice to `paid` |
| **`payments_received`** (JSONB) | **Payments Received page** — `savePaymentReceived` (`finflow-api-wiring-pages.js:271`) | `POST /api/payments-received` (`server.js:2217`) |

The **only** client writer of `invoice_payments` is the full-balance "mark paid" button — **there is no partial-payment UI**. The Payments Received page reads back **only** `payments_received` (`loadPaymentsReceived`), so an invoice payment never appears on it, and vice versa.

#### What the Cash Flow page actually reads

The Cash Flow page calls `POST /api/reports/cash-flow` (`app-main.js:5309`). Its cash-in leg (`server.js:3449-3451`):
```js
invoices.filter(i => (i.status||'').toLowerCase() === 'paid')
        .forEach(i => add(i.created_at || i.due_date || i.date, 'inflow', i.amount));  // FULL amount, at the INVOICE date
receipts.forEach(r => add(r.date, 'inflow', r.amount));           // sales_receipts
paymentsIn.forEach(p => add(p.date, 'inflow', p.amount));         // paymentsIn = payments_received
```
**`invoice_payments` is not read by any cash-in leg** (confirmed: its only readers are `recalcInvoiceStatus`, the per-invoice `GET`, delete, and an AR sum — never a cash surface). Three consequences follow, all live:

**(A) Invoice payments are recognised at the WRONG DATE.** A "mark paid" creates an `invoice_payments` row at *today* and flips the invoice to `paid`. Cash Flow then books the invoice's **full amount at the invoice's `created_at`/`due_date`, not the payment date**. An invoice issued in May and paid in July shows the cash **in May**.

**(B) A genuinely partial invoice payment is INVISIBLE to cash-in.** If an `invoice_payments` row exists but the invoice is still `partial` (not `paid`), the paid-invoice leg skips it, `invoice_payments` is not read, and it is not in `payments_received`. The cash is nowhere. Through today's UI this only arises via the API/import (no partial UI) — **but it is exactly how the seed is built, and it is a latent defect the instant a partial-payment path ships.**

**(C) Double-count is reachable.** The paid-invoice leg counts *every* `paid` invoice at full amount, unconditionally. So if a user records a receipt on the Payments Received page (`payments_received`, counted at payment date) **and** marks the invoice paid (`invoice_payments` → invoice `paid`, counted again at invoice date), the same cash is counted **twice** in Cash Flow.

#### Proven against the seed

The seed records money-in as `invoice_payments` (INV-1 1,000 on 05-15; INV-2 500 on 06-20). Under the current `/api/reports/cash-flow`:
- INV-1 is `paid` → counted at full 1,000 at INV-1's date (May) → May cash-in 1,000. Expected 1,000 — **right by accident** (full payment, same month).
- INV-2 is `partial` → **invisible** → June cash-in from INV-2 = **0**. Expected **500**. → **A7.9–11 June cash-in FAILS**, and it fails for reason (B), not a seed error.

**Limits:** established by reading the routes, the client callers and the modal set. Not executed end-to-end (the client cash-in surface is step-4 work). No production data read.
**Course of action:** owner-gated design. The two stores must be reconciled into one cash-in truth: either the cash-in leg reads `invoice_payments` at `payment_date` (and stops counting paid invoices at full amount, which double-counts and mistimes), or invoice settlements are mirrored into the single store the cash leg reads. This is part of the money-engine consolidation, not a patch — the cash-in leg lives on `/api/reports/cash-flow`, and `/books`/`computeBooks` must be checked for the same split before any fix.
**Done when:** the same customer payment produces the same Cash Flow cash-in, at the payment date, regardless of which screen recorded it; and no invoice can be counted both as a paid-invoice and as a separate receipt.

> **Stale comment noted:** `server.js:4191` says `amount_paid` "is written ONLY by Store B (invoice_payments/recalcInvoiceStatus), which is **UI-unreachable until F35 lands** — so today it is null everywhere." That is **out of date** — `markInvoicePaid` reaches `invoice_payments` today, and `recalcInvoiceStatus` writes `amount_paid`. A future reader trusting that comment would mis-reason about AR. Flagged, not fixed (it is a comment on a money path; the fix belongs with the consolidation).

---

### F86 ✅ RESOLVED — A7.4 "Payments Received" is ambiguous: two different tables could satisfy it — **NEW (2026-07-23, found by the step-3 probe) → RESOLVED (2026-07-31)**
**Update 2026-07-23:** the live question underneath A7.4 is now answered — see **F95**. The two stores are disjoint and the cash-in leg reads only one. The A7.4 *seed* decision still needs an owner ruling (settlements vs the Payments Received page total), but it should be made **together with the F95 consolidation**, not before it — deciding what A7.4 asserts while the two stores don't reconcile would lock in a target against a broken model.

**Update 2026-07-31 — owner ruling.** `payments_received` (Store A) confirmed **empty in production** — the single test row (customer "king", $1,000, no `invoice_ref`) was deleted, count = 0. Owner decision: `invoice_payments` (Store B) is **canonical** "Payments Received." Option 1 from the original decision list below.

`tests/harness/step3-gate.js` A7.4 rewritten accordingly, **verified by execution** — ran `node -r ./tests/harness/clock.js tests/harness/step3-gate.js` against a real embedded scratch PostgreSQL 17.10 cluster this session:
- Expected value **1,500**, re-derived fresh from `tests/harness/seedData.js` `INVOICE_PAYMENTS` (not reused blind): `{invoice:'INV-1', amount:1000}` + `{invoice:'INV-2', amount:500}` = **1,500**. Confirmed by reading `tests/harness/seed.js:107-115` — a single un-duplicated insert loop over exactly these two rows, for the one seeded user, and `seed()` truncates (`reset()`) before every run, so no double-insert path exists.
- Old check called `GET /api/invoice-payments` with no `invoice_id`; that route requires it (`server.js:3712`) and always 400s without one — the check could never pass as written, regardless of what Store B held. That was the actual defect, not the 1,500 figure.
- Rewrite reads `GET /api/bank-reconciliation`'s `unmatchedPayments` array instead — it returns every one of the user's `invoice_payments` rows unfiltered whenever nothing is reconciled (true for this seed: no `bank_reconciliation` rows are ever seeded), so it doubles as the aggregate read with no new route, over real HTTP, matching every other check's convention in that file.
- **Executed result: `PASS  A7.4  invoice_payments total (Payments Received, Store B canonical)`. Full run: STEP 3 GATE — 34 passed, 0 failed** (up from 33/1, the one prior red). The stamp-only side effect the run wrote into `VERIFICATION.md` (date `2026-07-30`→`2026-07-31` on the six A5 rows, no figures changed) was reverted with `git checkout -- VERIFICATION.md` per instruction — not left in the working tree.

**Status:** RESOLVED, verified by execution. A7.4 now asserts the correct store, correct endpoint, correct figure, and passes for real against a live scratch database. **Does not resolve F95** — see the update on that entry; the two are related but distinct (F86 was a test/seed sourcing question, F95 is a live product code question).

Money-in lives in **two unrelated tables**:

| Table | Written by | Read by |
|---|---|---|
| `invoice_payments` (typed) | `POST /api/invoice-payments` — settles a specific invoice, drives `recalcInvoiceStatus` | `GET /api/invoice-payments?invoice_id=…` — **per-invoice only**, 400 without it (`server.js:3660`) |
| `payments_received` (JSONB) | `POST /api/payments-received` — free-standing customer receipt | the **Payments Received page** (`finflow-api-wiring-pages.js:219`), and `computeBooks` (`server.js:3441`) |

The seed populates **`invoice_payments`** — VERIFICATION's "Payment events" table describes them as *"INV-1 payment received"* / *"INV-2 partial received"*, i.e. settlements against named invoices, and 1,500 is the sum of exactly those two.

But the check is named for the **Payments Received page**, and that page reads `payments_received`, which the seed leaves **empty**. So as written, A7.4 measured against the page would read **0**, not 1,500.

**The decision needed:** does A7.4 mean
1. *"total settlements against invoices"* — source `invoice_payments`, seed is correct, and the check should be renamed so it stops pointing at a page it does not describe; or
2. *"the Payments Received page total"* — source `payments_received`, and the seed must populate that table too.

⚠️ These are **not interchangeable**. `computeBooks` reads `payments_received` at `server.js:3441`, so if the Cash Flow "cash in" leg keys on that table, the current seed would make A7.9–11 read 0 while `invoice_payments` holds the money. Option 2 also raises a double-count question — whether a receipt in both tables would be counted twice — which must be resolved before seeding both.
**Course of action:** owner picks the source. If option 2, the seed gains `payments_received` rows and the cash-in expectations are re-derived. Until then A7.4 is **BLOCKED, not failed** — the harness cannot assert a figure whose source is undecided.

---

### F84 🔴 CRITICAL — A bill paid through the Payments Made form is counted **twice** as expense; the UI offers no way to link it — **NEW (2026-07-23, read-only verified)**
**Status:** OPEN. Live decision-1 violation reachable through ordinary UI use. Found while writing a seed note; it is not a seed note.

**The guard is sound. The UI cannot satisfy it.** `computeBooks` excludes bill-linked payments from opex on one predicate, which the code itself calls the only one:
```js
// server.js:4106-4113
// payments_made: a payment LINKED to a bill (bill_id set) is a SETTLEMENT (Dr AP / Cr Cash),
// NEVER a fresh expense — counting it would double-count against the issued-bill leg above.
// ONLY orphan payments (bill_id IS NULL) — a direct disbursement with no bill — stay expense.
// This bill_id-IS-NULL predicate is the SOLE double-count guard.
const paymentsMadeTotal = sumFX(paymentsMade.filter(p =>
  p.bill_id == null && inPeriod(_pmDate(p))
), p => p.amount, _pmDate, 'payments_made');
```
`bill_id` is taken verbatim from the request body (`server.js:2299`, `2305`) and defaults to `null`. So the guard holds only if the client sends it.

**Enumeration of every write path that creates a `payments_made` row:**

| # | Path | Sends `bill_id`? | Result |
|---|---|---|---|
| 1 | `markBillPaid()` — Bills page "Pay" button (`finflow-api-wiring-pages.js:709`) | ✅ yes | correct — settlement, excluded from expense |
| 2 | `savePaymentMade()` — Payments Made "Make Payment" (`finflow-api-wiring-pages.js:796`) | ❌ **no** | counted as a fresh expense |
| 3 | `savePaymentMade()` — older copy (`finflow-api-wiring-final5.js:322`) | ❌ **no** | shadowed; see below |
| 4 | `PUT /api/payments-made/:id` (`server.js:2319`) | only if supplied | can relink, but nothing surfaces the need |

Path 3 is dead code: the bundle loads `final5.js` at line 2832 and `pages.js` at 3339, and `pages.js:786` does `window.savePaymentMade = …`, so the **pages.js copy wins at runtime** (Rule 1 applied — both were checked rather than assumed). It makes no difference to the outcome: neither copy sends `bill_id`.

**The modal has no bill field.** `#modal-payment-made` contains exactly `pm-vendor`, `pm-amount`, `pm-date`, `pm-method`, `pm-notes` — no bill selector, no invoice-style picker. And the Bills page offers exactly one payment action:
```html
<!-- finflow-api-wiring-pages.js:606 -->
<button class="btn btn-ghost btn-sm" onclick="markBillPaid(${b.id})">Pay</button>
```
— which pays the **full outstanding balance**. There is no partial-bill-payment path anywhere that sets `bill_id`.

**Two ordinary user journeys therefore double-count:**
1. **Paying a bill from the Payments Made page** instead of the Bills page. The bill was already recognised as expense at issue; the payment adds the same amount again. The bill also stays `unpaid`, so AP is overstated too — the money is counted twice as expense and still shown as owed.
2. **Paying a bill in instalments.** "Pay" is all-or-nothing, so a part payment can only be recorded through the unlinked form. Same double count.

**Client mirrors the same predicate** (`app-main.js:1678`, `finflow-api-wiring-dashboard.js:101` and `:184`), so client and server agree — while both double count. `CLAUDE.md` Rule 6: agreement is not correctness.

> ### ⚠️ THIS IS NOT A USER-ERROR PATH — THE UI OFFERS NO WAY TO LINK
>
> It would be easy to read the above as "the user should have clicked Pay on the Bills page". They could not have done anything else. **The Make Payment modal has no bill field at all** — `#modal-payment-made` contains exactly:
>
> `pm-vendor` · `pm-amount` · `pm-date` · `pm-method` · `pm-notes`
>
> No bill selector, no picker, no free-text bill reference. There is no input through which a user *could* express "this payment settles that bill", however carefully they worked.
>
> **And partial bill payments have no linked path in the application whatsoever.** `markBillPaid` computes `outstanding = amount − amount_paid` and pays that full balance in one row (`finflow-api-wiring-pages.js:701-711`); the Bills page exposes only that one button (`:606`). A user paying a bill in two instalments has no correct route available — the unlinked form is the only thing that will accept a part amount, and it double-counts.
>
> **Consequence for the fix: this is a UI change, not just a predicate change.** The predicate at `server.js:4111` is already right. Nothing is repaired by editing it. What is missing is the affordance — a bill selector on the Make Payment modal and a partial-payment path from the Bills page, both sending `bill_id` — plus the client mirrors moving in lockstep (Rule 2). A fix that only touches computation would leave the defect exactly where it is.

**Limits:** confirmed by reading the source and the modal markup. Not executed — no production row counts were taken, and it is unknown whether the owner has actually recorded any bill payment this way. **That is an existing-data question (Rule 8) and is separate from the code fix.**
**Course of action:** do not fix during the sweep (`VERIFICATION.md` rule 2 — freeze scope). The fix is a bill selector on the Make Payment modal plus a partial-payment path from the Bills page, both sending `bill_id`; note Rule 2 — the predicate exists on 3+ surfaces and all must move together. Then, separately and owner-gated, enumerate existing unlinked `payments_made` rows whose vendor and amount match an unpaid bill and report them for a decision.
**Done when:** a payment recorded against a bill from either page sets `bill_id`, opex counts it once, AP drops by the payment; and the existing-row question has an owner decision.

---

### F85 🟠 HIGH — Payroll runs are recognised on `run_date` (creation time), not the period they are FOR — **NEW (2026-07-23, read-only verified)**
**Status:** OPEN. Found while auditing `NOW()` usage for the harness.

`POST /api/payroll-runs` takes a client-supplied `period` (e.g. `"2026-06"`) which is the run's **identity** — the dedupe guard keys on it (`server.js:3801`). But the row's date is stamped by the database:
```sql
-- server.js:3821-3823
INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, ...)
VALUES ($1,$2,$3,NOW(),$4,...)
```
and `computeBooks` filters payroll **by `run_date`, never by `period`**:
```js
// server.js:4145-4147
const _runDate = l => l.run_date;
const payrollTotal = r2(sumFX(runLines.filter(l => inPeriod(_runDate(l))), ...));
```
So June's payroll, run on 2 July, is recognised as a **July** expense. June understates payroll by the full run; July overstates by the same.

> ### ⚠️ `period` IS DECORATIVE
>
> State this plainly, because the shape of the API implies the opposite. `POST /api/payroll-runs` **requires** `period`, rejects the request without it (`server.js:3792`), stores it on the row, uses it as the run's dedupe identity (`server.js:3801`), and displays it back in the run history. Everything about it presents as the authoritative answer to "which month is this payroll for".
>
> **It has no accounting effect.** The expense is filed by `run_date` — `NOW()` at the moment the button was pressed. Selecting period `2026-06` and pressing Run Payroll on 2 July produces a June-labelled run that lands entirely in July's figures. No warning, no divergence indicator; the run history shows "2026-06" while the P&L counts it in July.
>
> A field that looks authoritative and is not is how the next person assumes it works, writes a fix on top of that assumption, and produces a clean diff that changes nothing — the F75 pattern in a different register.

This is the accrual question, not a rounding one: under decisions 1 and 2 an expense belongs to the period it relates to. It also compounds Rule 10 — `run_date` is `NOW()` in Postgres **UTC** while period windows are computed client-side in local time (GMT-4), so a run created between 20:00 and 24:00 local on the last day of a month is stamped into the next month in UTC and misfiles even when run on time.

**Interaction with the harness:** this is why `VERIFICATION.md`'s seed specifies `run_date` per run and the harness writes it explicitly. It also means Part B cannot assert absolute period placement for a run it creates — see the `NOW()` drift decision.
**Course of action:** owner decision on the intended basis — recognise on the `period` the run covers (accrual, likely correct), or keep `run_date` (creation-time). If `period`, the leg filters on it and `run_date` becomes metadata. Either way `run_date` should stop being `NOW()` and become explicit, which also removes the harness's only uncontrollable timestamp.
**Done when:** the basis is decided and recorded here, the payroll leg filters on the decided field, and a run created for a prior period lands in that period's totals.

---

### F72 🟡 MEDIUM — AP / payables overstated for partially-paid bills — **NEW (found while fixing F56)**
**Status:** OPEN, verified. The exact mirror of F56 on the payables side.

`finflow-api-wiring-pages.js:517` (Vendors page) and `finflow-api-wiring-stubs.js:337` (Bills page) both compute payables as `Σ amount` over `status !== 'paid'` — the same formula F56 just removed from the AR side. A bill with `amount_paid` set still reports its **full** face value as owed. F38 Step 3 added `recalcBillStatus` and `bills.amount_paid`, so the data to do this correctly already exists.

**Not folded into the F56 commit deliberately:** bills use a different status vocabulary (`unpaid`/`due_soon`/`overdue`/`partial`/`paid`) than invoices, so the invoice-shaped `arOutstanding` helper does not apply — it needs its own `apPayables()` sibling rather than a bodge.
**Course of action:** add `apPayables(bills)` = `Σ max(0, amount − amount_paid)` over the bill status allowlist; use it at both sites and anywhere `computeBooks` reports AP.
**Done when:** a $1,000 bill with $400 paid reports **$600** payable on the Vendors page, the Bills page and `/api/reports`.

---

### F69 🟢 LOW — Income-sources percentages mix bases — **NEW**
`_topClients` is built from **paid-only** invoices (`app-main.js:1451-1457`) but the bar percentages divide by `d.rev`, which is **accrual** (`app-main.js:2047`). On an account with unpaid invoices the bars sum to well under 100% with no explanation. Fold into the F57 rewire: build `_topClients` from the same recognized-invoice set `computeRevenue` uses.

---

### F33-C 🟡 MEDIUM — Overview chart's expense series excludes payroll and COGS
**Status:** OPEN (split out of F33, whose core is fixed). Now *deliberate* and documented (`server.js:4152`, `finflow-api-wiring-dashboard.js:46`) but still unlabelled on screen: the chart's "Expenses" line and the "Expenses" KPI directly above it are different quantities. Root of the originally-observed "$1,000 chart vs $8,000 KPI" discrepancy.
**Course of action:** either add payroll and COGS to the monthly buckets on **both** sides (`server.js:4147-4151` and `finflow-api-wiring-dashboard.js:64-105`), or relabel the series "Direct expenses" with a tooltip note. Adding them is the more honest option and makes `Σ(buckets) == KPI` at every period, which is also the cleanest verification.
**Done when:** `Σ expByMonth` over the period window equals the Expenses KPI exactly.

---

### F25 ✅ **COGS period-scoped** (`c2bcdb1`, 2026-07-22) — was 🟡 MEDIUM — "Year" fiscal-window consistency
**Status:** ✅ **COGS FIXED & golden-master-verified.** The fiscal-window half was already closed by the F33 unit; this closes the COGS residual the owner surfaced ("why does June's Net subtract COGS from every sale I've ever made?").

**What was wrong.** COGS was an **all-time** FIFO total at every period — on the server (`computeBooks`) and on the client (`window._cogsTotal`, fetched once from `/api/cogs` with no window). So Gross Profit and Net at Month/Quarter subtracted every sale's cost ever recorded. A comment lumped "COGS and AR are all-time snapshots" together, which is how the wrong one hid behind the right one — AR *is* correctly all-time (balance-sheet), COGS is not (P&L).

**What changed.**
- **`computeBooks`** (server): both COGS branches now walk `fifoItemSales` (per-sale `{date, cogs, uncovered, quantity}`) and count only sales whose movement date ∈ period. FIFO layer consumption is still evaluated over **all** sales in date order (a June sale's cost depends on May's purchases), so each sale's cost is correct; only the summed subset is period-scoped. Σ over the year still equals the old all-time total, so **Year is unchanged**.
- **`GET /api/cogs`** (server): accepts the same `?start&end&elapsedMonths` window as `/api/reports` (identical validation), period-scoping its per-item FIFO the same way. **No params ⇒ all-time**, so the COGS page and any un-migrated caller are byte-for-byte unchanged.
- **Client**: COGS is now handled exactly like its siblings `computeRevenue` / `computeExpenseBreakdown` — period-aware, not frozen at all-time. `_loadPeriodCOGS()` refetches the period figure on every period/month switch and repaints (paint-then-correct, like the FX overlay); the COGS page (`loadCOGS`) uses the same window so opening it on a Month view no longer clobbers `_cogsTotal` back to all-time. **This is not the SSOT rework** — net is still computed client-side; only the one frozen COGS input is brought in line with the already-period-aware rev/exp inputs. On failure it keeps the prior value (never fabricates $0 — F62 class).
- **`fifoItemSales`** gained a `quantity` field (additive; existing callers read only date/cogs/uncovered).

**AR deliberately untouched** — it is correctly all-time (balance-sheet). Labelling it "as of today" is a separate cosmetic task, not part of this commit.

**How it was verified.** Golden master (`tests/golden-master-payroll-basisC.js`) — the 6 previously-red F25 assertions (3 COGS + 3 net-profit) now green (June COGS=400, July=200, Quarter=200, Year=600, computed against a FIFO seed), **plus** 5 new endpoint assertions proving `/api/cogs` per-period **equals** `computeBooks` COGS at every window and that no-window ⇒ all-time. Everything basis-C turned green stayed green; full regression suite green (F55/F56/F59/F60/F62/B8).

**Verify live (owner):** on an inventory business, switch dashboard to Month → Net Profit subtracts only that month's COGS, not the all-time figure; open the COGS page on Month view → it shows that month; switch to Year → COGS matches the old all-time number.

---

### F26 🟡 MEDIUM — `sales_receipts` / `payments_received` entity scoping
**Status:** PARTIAL, unchanged. Inserts carry `entity_id` since sweep `e1319ef`, but **`computeBooks` still reads receipts user-scoped, not entity-scoped** (`server.js:3919`: `db.allByUser('sales_receipts', userId)` with no `ent` filter, comment `// user-scoped (no entity_id) — F26`). For a multi-entity user every entity's P&L includes **every** entity's cash sales.
**Course of action:** (1) backfill legacy rows' `entity_id`; (2) then change `3919` to pass `ent` and drop `2131`/`2170`'s `null` entity in `findRecentDuplicate`. Order matters — scoping before backfill would hide existing rows.
**Done when:** with two entities each holding a receipt, each entity's revenue includes only its own.

---

### F30 🟢 LOW — Permissions matrix is display-only
**Status:** OPEN, honestly labelled. `/api/permissions` persists per-account edits to `user_settings` (`server.js:3138`) but enforcement uses the fixed code matrix in `rbac.js`. The grid is relabelled read-only "role defaults" (`index.html:1511`), so it is not a lie — but the route still accepts and stores writes nothing reads.
**Course of action:** post-launch — either enforce the stored matrix in `requirePerm`, or delete `POST /api/permissions` so nothing pretends to save.

---

### F32-residual 🟡 MEDIUM — cash-flow basis + one legacy row
**Status:** Revenue side FIXED and verified (issue-based accrual on both engines). Residual: `POST /api/reports/cash-flow` still sums paid invoices + receipts + `payments_received` and does **not** read `invoice_payments` (Store B) — so since F35 routed payments to Store B, **new payments do not appear in the cash-flow statement at all**. Plus the Store A → Store B migration decision (option 1, recommended) is still un-executed, and the Store A $1,000 row is unresolved.
**Course of action:** point the cash-flow inflow leg at `invoice_payments` + `sales_receipts`, keeping `payments_received` as a legacy leg until migrated. Migration stays gated on owner approval (it rewrites historical money rows) and must be dry-runnable.
**Done when:** a payment recorded today appears in the cash-flow statement's inflow for today's month.

---

### F39 ✅ FIXED (invoices) / **F41** 🟢 OPEN (bills)
`end_date` on recurring **invoices** is complete end-to-end — server accepts it (`server.js:2093`), the scheduler stops on it, and the UI has `#ri-end` (`index.html:6860`, wired in `pages.js:366` and `stubs.js:647`). Commit `e1319ef`.
**F41 — recurring BILLS remain dormant:** `runRecurringScheduler` and `POST /api/recurring-bills` honour `end_date`, but **no `rb-end` input exists anywhere** (verified by grep). A user can never set one, so recurring bills generate forever. Exact parallel to the invoice half.
**Course of action:** copy the `ri-end` field + wiring to the recurring-bill modal (`index.html:6391`) and both save paths.

---

### F40 🟢 LOW — `/api/cashflow` dates paid inflow on `due_date`
`server.js:3175` buckets a paid invoice by `(due_date||'').slice(0,7)` — the month it was **due**, not the month cash arrived. The route is **orphan dead code** (no fetch caller anywhere outside the audit docs), so it is currently harmless.
**Course of action:** delete the route, or repoint it at `invoice_payments.payment_date` before anything starts calling it. Do not leave it dead-but-wrong.

---

### F44 🟢 LOW — Scenario planner BASE uses the pre-F32 basis
`_syncScenarioBase` (`finflow-api-wiring-medium.js:1004-1011`) computes `annualRev` from **paid-only** invoices — the recognition basis F32 replaced everywhere else — and `annualExp` from **all-time** expenses with no window, no bills, no payments_made, no payroll. Every scenario projection starts from a number that appears nowhere else in the app.
**Course of action:** `window.BASE = { rev: computeRevenue('year'), exp: computeExpenseBreakdown('year').total, burn: exp/12 }`.

---

### F45 🟢 LOW — Budget "actuals" are lifetime, not periodic
`finflow-api-wiring-medium.js:1142-1146` sums `catActuals` over **every** expense row with no date filter, then compares against a periodic budget target. Variance becomes meaningless as the account ages — actuals only grow.
**Course of action:** filter through `_periodWindow(currentPeriod)` before aggregating; label the card with the window.

---

### F47 🟢 LOW — Cash-flow route dates a paid invoice by `created_at`
`server.js:3313` keys paid-invoice inflow on `created_at || due_date || date`, so the same invoice is now dated three different ways across the app (`issue_date` for accrual, `due_date` in `/api/cashflow`, `created_at` here). Correct in isolation — `/api/reports/cash-flow` is the cash-basis statement — but it will be re-flagged forever unless documented. Fold into the F32-residual rework: cash basis should key on the **payment** date, not any invoice date.

---

### F51 🟡 MEDIUM — Placeholder surfaces presented as live features (blocker **B10**)
**Verified live-confirmed placeholders:**
| Surface | Evidence |
|---|---|
| **Banking** | static "Bank Sync — Coming Soon" card, `index.html:1987` |
| **Client Portal** | "Coming Soon" card injected at `index.html:6001`; `/api/portal` does not exist; dead `PORTALS=[]` / `createPortal()` / `portal.finflow.io` links still in the tree at `index.html:6352-6390` (inert — `renderPortal` bails on a missing `#portal-list`) |
| **Find Advisor** | "Coming Soon" card, `app-main.js:6053`, behind a **`NEW`-badged** nav item; `ADVISORS=[]`; `submitAdvisorApp()` fakes an application |
| **Tax Filing** | "Coming Soon" card, `app-main.js:6104`. ⚠️ `GET /api/tax-filing` still **serves** a flat-25%, paid-only estimate (`server.js:3412-3421`) — currently unrendered in the main app, but live and fabricated if any surface picks it up |
| **API Connections** | ~98 KB static catalog; `loadStates(){ return {}; }` / `saveStates(s){}` are **empty stubs** (`index.html:2335-2336`) so every "Connect" toggle is in-memory and lost on refresh, while `/api/connections` exists and is never used |
| **Templates** | empty, no persistence (PL#13) |

**Course of action:** remove the `NEW` badge from Find Advisor; delete the dead portal/advisor code so it cannot resurrect; either wire the Connections toggles to the existing `/api/connections` route or remove the toggles; either delete `GET /api/tax-filing` or replace its flat 25% with the real `/api/reports` net × a user-set rate, with `ytdPaid` shown "Not tracked".
**Done when:** every nav item either works or says it doesn't, and no control in a placeholder page produces a success message.

---

### F52 🟢 LOW — Form accessibility
3 form fields with no `id`/`name`, 7 inputs with no associated `<label>` (owner-observed via DevTools Issues). Breaks autofill and screen-reader labelling.
**Course of action:** enumerate via the DevTools "Violating node" links, add `id`/`name` + `<label for=…>`.

---

### PL#5 🟡 MEDIUM — Quotes never convert to invoices
**Status:** OPEN, verified — grep finds **no** conversion function anywhere in the tree. Quotes can be created, listed and marked "accepted" (`pages.js:81`, `stubs.js:94`) and then the trail ends. The Quote → Invoice → Payment lifecycle is broken at the first hop.
**Course of action:** one `POST /api/quotes/:id/convert` that creates an invoice from the quote's fields, stamps `quote.status='converted'` and `invoice.quote_id`, and returns the new invoice; one button on the quote row. Guard against double-conversion via the status.

---

### PL#8 🟢 LOW — Items and Inventory are two parallel systems
No `reorder_point` on items; reorder logic lives only in Inventory, hardcoded to 10% of max. Post-launch.

---

### PL#10 🟡 — split
**Contra half → F58 (blocker).** **Recurring half → FIXED:** `runRecurringScheduler` (`server.js:2951`) runs at boot + hourly (`4114-4115`) and materialises all three recurring types. The old "recurring items are inert" claim is stale.

---

## Findings — CLOSED (verified this pass)

Compact. Full fix narratives live in `AUDIT_MASTER_ARCHIVE_2026-07-22.md`.

| # | Was | Verified at | Note |
|---|---|---|---|
| F1 | 🔴 cross-tenant accountant read | `accountant-routes.js` — `accountant_clients.status='active'` gates all 8 branches | ✅ |
| F2 | 🔴 partial-PUT JSONB corruption | explicit `patch` objects on every PUT | ✅ |
| F3 | 🟠 unrealised FX never computed | `computeUnrealised` at read time, null when no rate | ✅ |
| F4 | 🟠 error handler before 42 routes | `server.js:4618`, after last route `4608` | ✅ verified |
| F5 | 🟠 RBAC resolver inert | resolver `server.js:611`; `member_user_id` written `2637` | ✅ resolver works — **but see F54**, routes don't all use it |
| F6 | 🟠 COGS mis-costing | FIFO everywhere (`fifoItemTotal`/`fifoItemSales`) | ✅ |
| F7 | 🟠 duplicate KPI formulas | `d-rev/d-exp/d-profit` written only by `updateDashboard` | ✅ — **but see F55/F56/F57**, the class regrew on other cards |
| F8 | 🟠 stale payroll brackets | engine removed | ✅ by removal |
| F9 | 🟠 `/books` unscoped, unpaid-as-income | `computeBooks` shared | ✅ |
| F10 | 🟠 dead accountant invite funnel | `/register?ref=` → 302 | ✅ live-verified |
| F11 | 🟠 referral cron paid nobody | `setSubscriptionStatus` `server.js:95` | ✅ code; ⏳ Stripe-gated live check |
| F12 | 🟡 admin phantom fields | ✅ |  |
| F13 | 🟡 unenforced bundle sync | `bundle.js --check` + pre-commit hook | ✅ |
| F14 | 🟡 report routes ignore entity | ✅ |  |
| F15 | 🟡 lexical month sort | ✅ |  |
| F16 | 🟡 mock accountant verification | ✅ + Step F doc upload |
| F17 | 🟡 100% earnings ledger | `tier-config.js` | ✅ code; ⏳ Stripe-gated |
| F18 | 🟡 4/5 uncapped AI sites | `ai-cap.js` on all | ✅ code; ⏳ 2 follow-ups (prompt-cache is a no-op; Haiku-vs-Sonnet undecided) |
| F19 | 🟢 DB TLS + fabricated team emails | ✅ |  |
| F20 | 🟢 dead db helpers | ✅ |  |
| F21 | 🟡 broadcast sent nothing | ✅ code; ⏳ Resend-gated |
| F22 | 🟠 CSRF | `sameSite:'lax'` + 415 content-type gate + 403 Origin gate, `server.js:279`, `316-341` | ✅ live-verified |
| F23 | 🟢 banking field-name split | `tx_type`/`tx_date` + legacy fallback | ✅ |
| F24 | 🟡 consolidated P&L hardcoded COGS | ✅ |  |
| F27 | 🟢 dead Client Books modal | ✅ removed |
| F28 | 🟠 unverified credentials beside "✓ Verified" | ✅ |  |
| F29 | 🟠 stale APP_URL fallbacks | `app-url.js` | ✅ — ⚠️ **custom-domain swap needs BOTH** `APP_URL` env **and** `LIVE_FALLBACK`, plus 3 static files hardcoding `dab1` |
| F31 | 🟠 fabricated $0 on report failure | 3 report routes | ✅ **narrowed** — class unswept → **F62** |
| F33 | 🔴 period-window unit | `d39aed4`,`146019c` | ✅ core — companion → **F33-C** |
| F34 | 🟠 currency toggle relabels only | Path B, `063c98c`→`5639f06` | ✅ code complete — failure path → **F59** |
| F35 | 🔴 Record Payment broken | Step 5 `9937966` | ✅ live-verified |
| F36 | 🟡 no invoice issue date | `85a9d2f` | ✅ live-verified |
| F37 | 🟡 UTC date generation | sweep `e1319ef` | 🔁 **REOPENED — PARTIAL**, see **C3** |
| F38 | 🟠 asymmetric expense accrual | Steps 1–5 | ✅ |
| F42 | 🟢 banking MTD always $0 | within `e1319ef` | ✅ |
| F43 | 🟢 EOL non-determinism | — | 🟢 OPEN, held for decision: add `.gitattributes` with `* text=auto eol=lf` |
| F46 | 🟢 banking tx_type fallthrough | `64eb95c`, `server.js:3094` | ✅ verified |
| F48 | 🔴 Store B ownership/AR | `98ec1a6` + `d60ecea`, `server.js:4110` | ✅ verified |
| F49 | — `reload.js` in prod | — | ✅ **not a FinFlow bug** (extension-injected); CSP tidied `64eb95c` |
| F50 | 🟠 cold-boot $0 race | `c16ee28` | ✅ re-fixed, verified in `index.html:3630-3740` |
| F53 | 🟡 K-only formatters | `96ef6c3` + `640dffe` | ✅ verified — behaviour → **F64** |
| PL#3 | 🟠 entity paywall | `64eb95c`, `server.js:811` | ✅ verified |
| PL#4 | 🟠 wrong audit table | `7be0a1d`, `index.html:4366` | ✅ verified |
| PL#6 | 🟡 FX Settle dead | `e1319ef` | ⚠️ **structurally present, never exercised end-to-end** — settle a real FX transaction and confirm `realised_gain_loss` before calling it done |
| PL#7 | 🟡 fabricated team members | → F19 | ✅ |
| PL#9 | 🟢 invisible payroll gross | ✅ **`85c8384`** | ✅ **NOW GENUINELY FIXED on the runtime path.** `2a70564` had patched the SHADOWED app-main `renderPayroll` (dead code); the runtime winner is the `finflow-api-wiring-medium.js` override, whose gross span had no color token. Fixed there with `color:var(--t1)` (themed, legible light+dark). Root cause of the "recurrence" → **F75**. |
| PL#11 | 🟠 fabricated tax figures | `7be0a1d` | ✅ verified |

---

## Environment-gated — built, cannot be verified without keys

Not defects; they cannot be closed from the code alone. Each needs one live run.

- **Stripe** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs): F11, F17, F21 payout mechanics — PaymentIntent creation, `application_fee_amount` + `on_behalf_of` netting, webhook signature + real event delivery, `sub.metadata.userId` presence, balance-transaction fee reconciliation, end-to-end subscription → cron payout → cancellation.
- **Resend** (`RESEND_API_KEY`, `EMAIL_FROM`): F21 broadcast actually delivers and `{sent,failed,total}` match the dashboard; without a key the route must return `logged:true, sent:0` and the admin must see the honest "logged only" toast.
- **Anthropic** (`ANTHROPIC_API_KEY`, set on Railway): F18 — a real call succeeds, usage increments, a capped user gets `402 AI_CAP_REACHED` with **no** upstream call. Two known follow-ups: prompt caching on `/api/ai` is a **no-op** (blocks below the cacheable minimum, breakpoint after the variable `history`), and the Haiku-vs-Sonnet cost decision is unmade — Sonnet remains default, bounded by caps.
  ⚠️ `POST /api/ai` returns *"Add ANTHROPIC_API_KEY to .env to enable"* when the key **is** set but uncredited — misleading, not a secret leak (regex-checked: no `sk-ant-` value in the response). Fix the message.
- **Boot migrations** (silent failure = landmine): confirm on the live Postgres that `accountant_documents`, `accountants.confirmed_credentials`, `ai_usage.scan_count`, `accountant_ai_usage` and the `accountant_earnings` columns all applied. A missed `ai_usage.scan_count` **fails closed** and disables all AI (503) — safe but total.

---

## Confirmed non-issues (re-checked this pass — do not re-open)

SQL injection (allow-listed identifiers, parameterized values, `ILIKE … ESCAPE`); Stripe webhook signature (`constructEvent` + secret, `server.js:124`); admin auth (`timingSafeEqual` + 5/15 min limit); password reset (32-byte token, 1 h expiry, single-use); bundle sync (byte-exact, drift-checked); landing-page `$469K` hero (marketing mockup); `reload.js` (browser-extension injected — F49); **`appendChild` render-append class (withdrawn — all 49 sites verified clear-first or run-once)**; entity-id ownership check on the explicit `?entity_id=` override (`server.js:650`).

---

## Methodology notes carried forward

1. **Reconciliation proves agreement, not correctness.** The F7/F9/F14/F15/F24 cluster proved every view returned the same number without ever asking whether the number was right — that produced F32 and F33. This pass repeated the mistake's inverse test: F56/F57 exist because *nobody re-checked* whether the surfaces still agree after F35/F38/F48 changed the basis underneath them.
2. **Verify across the surface, not at one point.** F33 was "verified" on the Year period only. F37 was "verified" on one file. Both were wrong.
3. **A partial sweep must be logged as PARTIAL.** See the standing rule.
4. **Where the root cause is uncertain, say so.** Two items in this audit are explicitly *not* root-caused: **PL#6** (FX settle is structurally present but never exercised — the failure mode, if any, is unknown) and **PL#9** (fixed by an external commit, never verified). Both are marked ⚠️ rather than ✅.

---

## Recommended order

1. **B1** (F55) — 15 minutes, largest perceived-quality gain per minute in the whole list.
2. **B7** (F59) + **B6** (F62/F67) — the silent-failure family. Cheap, and they stop wrong money from being *invisible*.
3. **B3** (F56/F57) + **B5** (F60/F61) — the reconciliation family. Do them together; they touch the same three functions.
4. **B4** (F58) — credit-note contra. Largest correctness win.
5. **B2** (F64) — money formatting. Isolated, mechanical, but touches every screen — do it when nothing else is in flight.
6. **B8** (C1 money-7) — server dedupe. Copy-paste of an established pattern.
7. **B9** (F54) — decide fix-or-disable **early**; the disable path is 30 minutes and should be chosen now if the week is tight.
8. **B10** (F51/F65) — honesty pass. Do it last so it covers anything the earlier fixes turn into a placeholder.

After every one of these: **tick the row in this file in the same commit.**

---

## Audit pass log

Provenance for every pass. **Append a new entry per pass — never edit an old one.** The point is that a future session can tell what was actually checked from what was inherited.

---

### Pass 3 — 22 July 2026 · full site-wide re-audit + document rewrite

**Base commit:** `f27166d` · **Working tree:** clean apart from untracked prior audit files · **Mode:** read-only (no source file modified; verified via `git status --short`)
**Trigger:** owner reported the document was stale and untrustworthy — rows contradicting shipped code — with one week to launch.

#### Scope actually covered

| Area | Depth |
|---|---|
| `server.js` (4,643 lines) | **Exhaustive** for middleware, auth, scoping, all 62 `app.post` routes, `computeBooks`, `/api/reports`, cash-flow, error handling |
| `public/app-main.js` (6,153) | **Exhaustive** for money engines, boot, dashboard, formatters, FX overlay, placeholder injection |
| `public/index.html` (7,486) | **Targeted** — money surfaces, page injection, portal/connections/tax, boot scripts, script-load order |
| All 10 wiring sources | **Exhaustive** for `-dashboard.js`, `-postgres.js`, `-medium.js`; targeted for the rest |
| `rbac.js`, `tier-config.js`, `bundle.js`, `app-url.js`, `manifest.json` | **Full read** |
| `database.js` (715) | **Partial** — helper surface and `allByUser` semantics only |
| `accountant-routes.js` (1,622), `accountant-*.html` | **Spot-check** — email validation, `computeBooks` callers, dialog/date classes |
| `admin-routes.js` (624), `admin.html` (1,331) | **Spot-check** — dialog class + fail-soft catches only |

#### Explicitly NOT covered — do not treat these as audited

1. **Nothing was executed.** This pass was 100 % code-read. No live instance, no browser, no clicks, no DB. Every runtime claim (e.g. F55 "doesn't repaint", F60 "off by 5 months") is derived from reading the call graph and is stated as such — each carries a "Done when" that requires an actual run to close.
2. **The accountant portal** (`accountant-routes.js`, `accountant-client.html`, `accountant-dashboard.html` — ~4,400 lines) was **not** exhaustively audited. F1/F9/F16/F17/F27/F28 statuses there are inherited from prior passes, spot-confirmed only.
3. **The admin panel** (`admin-routes.js`, `admin.html`) — same caveat. F12/F21 inherited.
4. **`database.js` schema/`initDB`** was not enumerated; the boot-migration list under "Environment-gated" is inherited, not re-verified.
5. **No dependency/CVE audit** (`npm audit` not run). **No load or performance testing.** **No mobile-device testing** — F68 is a code observation, not a measured one.
6. **Stripe / Resend / Anthropic** paths are unverifiable without keys — see the Environment-gated section.

#### Outcome

| | Count |
|---|---|
| Existing rows reconciled against code | **68** (F1–F53 + PL#1–#15) |
| Corrected OPEN → FIXED | **10** (F33, F34, F48, F50, F53, F46, F4, PL#3, PL#4, PL#11) |
| Reopened FIXED → PARTIAL/narrowed | **2** (F37 → PARTIAL, 35 sites remain; F31 → narrowed, class → F62) |
| New findings | **16** (F54–F69) |
| Classes withdrawn as non-defects | **1** (appendChild render-append) |
| Class counts corrected | **3** (dialogs 53→68; timezone 14→35; client handlers 58→88 POST sites) |
| Severity upgraded | **1** (PL#10 contra half → F58, 🟡 → 🟠) |
| Launch blockers identified | **10** (B1–B10, ~3 working days) |

#### Reproducible checks behind the counts

Re-run these to re-verify any class without re-reading the tree. All exclude the generated `finflow-bundle.js`.

```bash
grep -rn "[^a-zA-Z_.]confirm(\|[^a-zA-Z_.]alert(" public/ --include=*.js --include=*.html | grep -v finflow-bundle.js | wc -l   # C2 → prints 69 = 68 real sites + 1 comment (index.html:4853)
```
```bash
grep -rn "toISOString()\.slice(0, *10)" . --include=*.js --include=*.html | grep -v node_modules | grep -v finflow-bundle.js | wc -l   # C3 → 40 hits (35 defects + 5 benign)
```
```bash
grep -c "findRecentDuplicate(" server.js   # C1 → 28 (1 definition + 27 guarded routes); 62 app.post total
```
```bash
grep -rn "res.json(\[\])\|res.json({})" server.js   # C7 → prints 10; 9 are the fail-soft class, server.js:2808 is a legitimate "no accountant linked" empty result
```
```bash
grep -c "scopeId(req)" server.js; grep -n "db.allByUser('[a-z_]*', req.session.userId" server.js | wc -l   # F54 → 86 vs 34
```
```bash
grep -rn "toFixed(1) *+ *'K'" public/ --include=*.js --include=*.html | grep -v finflow-bundle.js   # C4 → 1 hit, inside _fmtMoney only
```

#### Key judgement calls (so they can be argued with, not silently inherited)

- **F58 raised from Medium to High.** A credit note that never reduces revenue is not a missing feature, it is a wrong number on the P&L. Prior passes filed it as a feature gap.
- **The appendChild class was withdrawn, not deferred.** All 49 sites were read individually; the class does not exist. If a future pass re-raises it, read `index.html:2346` and `2377` first.
- **F64 is called pre-existing, not an F53 regression.** Verified against `96ef6c3^` — `patchSFormatter` abbreviated before the F53 consolidation. F53 unified thresholds; it did not change *where* abbreviation applies.
- **F54 offers a 30-minute alternative (disable team invites) alongside the 1-day fix.** With one week to launch, shipping without the team feature is a legitimate answer; shipping it broken is not.
- **The timezone class was left off the blocker list** despite being 35 sites, because it produces wrong dates at edges rather than wrong totals in normal use. That is a judgement call, flagged in the blocker section as the most likely week-one support ticket.

---

### Pass 2 — 20–21 July 2026 · live health pass + P1 sweep
Live end-to-end pass on `dab2` (47 nav pages, 29 data endpoints, authenticated as owner id 1) → F49–F52. Followed by fixes `64eb95c` (F46, PL#3, F49/CSP), `7be0a1d` (PL#11, PL#4), `d60ecea` (F48 AR follow-up), `c16ee28` (F50 re-fix). Detail retained in `AUDIT_MASTER_ARCHIVE_2026-07-22.md`.

### Pass 1 — 9 July 2026 · two audits merged
`AUDIT_CODE.md` (20 runtime-verified findings) + `CODE_AUDIT_2026-07-09.md` (chat audit), deduplicated into F1–F23. One chat Critical ("stale served bundle") withdrawn as a false positive after a byte-exact re-minify; residual risk retained as F13. Detail in the archive.
