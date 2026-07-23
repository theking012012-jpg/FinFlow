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
| **F93** | Should a **future-dated** invoice or bill be recognised, or excluded until its date arrives? | future-dated behaviour is unverified in both directions | recognised — inherited, never chosen |
| **F86** | Does A7.4 "Payments Received" mean `invoice_payments` (settlements) or `payments_received` (the page's own table)? | A7.4, and possibly Cash Flow cash-in A7.9–11 | the seed's current choice, unexamined |
| **D1 scope** | Which taxes a combined figure would cover (corporation tax, VAT, PAYE, NIS) | the D1 implementation | — |
| **F91 seed** | Add April and Aug/Sep rows to kill the remaining maskers, accepting re-derived Q2/Q3/FY expectations? | strength of every Q2/Q3 check | maskers persist |
| **F90 sequencing** | Audit trail before launch, as rated? | launch order | — |

---

## ⚠️ KNOWN LIMITATIONS — true, accepted, and not going to be fixed today

**Why this section exists.** Same reconciliation. A limitation is not a defect in the product —
it is a **boundary on what a green run proves**. Recording it is what stops a passing check being
read as stronger evidence than it is, which is the failure `VERIFICATION.md` exists to prevent.

| # | Limitation | What a green result does NOT prove |
|---|---|---|
| **F91** | Aug/Sep carry no seeded rows, so **Q3 == Jul on all six figures**; Q2 bills == Jun bills and Q2 payroll == Jun payroll | that quarter logic works at all — the entire Q3 column is satisfied by code that ignores quarters |
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

### C1 — Duplicate-submit — server side ✅ **CLOSED for money** (`532390b`, 2026-07-22); client-side guards still open

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

### F57 🟠 HIGH — Cash Flow page uses a different basis from the Dashboard — **NEW**
**Status:** OPEN, verified.

**What's wrong.** `updateCashflow` (`app-main.js:2017`) writes `cf-in`/`cf-out`/`cf-net` from `getPeriodData()` → the `REV[]`/`EXP[]`/`PROFIT[]` monthly buckets. Those buckets **exclude payroll and COGS** by construction (`server.js:4152` comment: *"NO payroll/COGS (the chart never included them)"*; `finflow-api-wiring-dashboard.js:46-108`). Meanwhile `updateDashboard` writes `d-exp` from `computeExpenseBreakdown().total`, which **includes** payroll, and `d-profit` subtracts COGS (`app-main.js:1937-1944`).

So for any business with payroll or inventory, **Dashboard Net Profit ≠ Cash Flow Net**, on the same screen-pair, same period.

Compounding, inside the same function:
- `cf-fixed` + `cf-variable` are computed from `computeExpenseBreakdown().byCategory`, which contains **only raw expense rows** — no bills, no payroll — so `cf-fixed + cf-variable ≠ cf-out` (`app-main.js:2029-2038`).
- `computeExpenseBreakdown()` is called there with **no period argument**, so it silently defaults to `currentPeriod` while `d.exp` is period-scoped by the caller — two windows in one card.
- Income-sources percentages divide `_topClients` (built from **paid-only** invoices, `app-main.js:1451-1457`) by `d.rev` (accrual) → percentages that don't sum sensibly (→ **F69**).

**Course of action.** Rewire `updateCashflow` onto `computeRevenue(period)` / `computeExpenseBreakdown(period)` — the same canonical pair `updateDashboard` uses — and derive fixed/variable from the **full** breakdown (`realExpenses + issuedBills + paymentsMade + payroll`), not `byCategory` alone. If the intent is genuinely *cash* basis rather than accrual, then say so on the card and source it from `POST /api/reports/cash-flow` — but do not leave two accrual numbers disagreeing.
**Done when:** Dashboard Net Profit == Cash Flow Net at month, quarter and year, on an account with payroll and inventory; and `cf-fixed + cf-variable == cf-out`.

---

### F58 🟠 HIGH — Credit notes and vendor credits are never applied as contra — **NEW severity** (was PL#10, 🟡)
**Status:** OPEN, verified.

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

### F80 🟠 HIGH — Server payroll leg has **no status filter**; `draft` runs are recognised as expense — **NEW (2026-07-23, read-only verified; not yet executed)**
**Status:** OPEN. Contradicts `VERIFICATION.md` decision 2 and `CLAUDE.md` Rule 12.

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

### F93 ⬜ OWNER DECISION — Should a FUTURE-DATED invoice or bill be recognised? — **NEW (2026-07-23, raised in session, undecided)**
**Status:** OPEN — no decision made. Recorded because an undecided question that lives only in conversation gets silently decided by whatever the code already does.

Nothing in the recognition legs bounds the *upper* end of a period window against "today". An invoice issued `2026-12-01`, entered today, is recognised in December — and appears in FY 2026 revenue immediately, because the FY window runs to the end of the fiscal year, not to now.

**The question:** is that correct? Two defensible answers, and the system has not chosen one — it has merely inherited one.

- **Recognise it.** Accrual is date-based; a dated document belongs to its date. Consistent with decisions 1 and 2.
- **Exclude it until its date arrives.** A period-to-date figure that includes the future is not a period-to-date figure, and a FY total containing unearned December revenue overstates the year.

**Interacts with `elapsedMonths`**, which the client already sends and which exists to express "how much of this period has actually happened" — evidence the codebase half-acknowledges the distinction without settling it.
**Also interacts with F82:** the pinned clock was moved *because* two seeded rows sat in the future, and the harness has never asserted future-dated behaviour in either direction.
**Course of action:** owner decision. Then a `VERIFICATION.md` check per answer — a future-dated invoice in the seed, asserted present or absent. Until decided, **future-dated behaviour is unverified, not correct.**

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

### F91 🟡 MEDIUM — Three seed maskers remain: Q3 is indistinguishable from July, and two Q2 legs from June — **NEW (2026-07-23, found by the adjacent-period sweep)**
**Status:** OPEN — a **known limitation of `VERIFICATION.md`**, recorded so a green Q2/Q3 is not read as more than it is. Also written into `VERIFICATION.md` beside the seed.

After the Rule 4 revision every leg differs month to month (revenue 1,000/5,000/4,000 · COGS 400/200/800 · manual 600/750/250 · bills 0/800/500 · payroll 0/4,200/1,100 · cash in 1,000/500/0 · cash out 600/750/1,850). Three equalities survive:

| # | Masker | Value | Why it exists | What it hides |
|---|---|---|---|---|
| 1 | **Q3 == Jul on ALL SIX figures** | rev 4,000 · COGS 800 · manual 250 · bills 500 · payroll 1,100 · cash out 1,850 | Aug and Sep carry **no seeded rows**, so Q3 contains only July | A "return the anchor month instead of the quarter" bug is **completely undetectable at Q3** |
| 2 | Q2 bills == Jun bills | 800 | no April or May bills | quarter-vs-month confusion in the AP leg |
| 3 | Q2 payroll == Jun payroll | 4,200 | no April or May payroll runs | quarter-vs-month confusion in the payroll leg |

Masker 1 is the serious one: **all six** Q3 figures are identical to July's, so the entire Q3 column is satisfied by code that ignores quarters.
**Course of action:** add at least one row in **August or September** (fixes 1) and one in **April** (fixes 2 and 3). Both change Q2/Q3/FY expected values, so this is a seed revision requiring re-derivation — owner-gated, not done.
**Done when:** no adjacent-period or quarter-vs-month pair shares a value in any leg, and the expected values are re-derived and re-verified.

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

### F86 ⬜ OWNER DECISION — A7.4 "Payments Received" is ambiguous: two different tables could satisfy it — **NEW (2026-07-23, found by the step-3 probe)**
**Status:** OPEN — blocks A7.4, and possibly the Cash Flow "cash in" checks (A7.9–11). **Not a product defect; a specification ambiguity in `VERIFICATION.md`.** Logged rather than guessed, because guessing the source is exactly the seed-fidelity error caught on the holdings scope.

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
