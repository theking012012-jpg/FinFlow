# VERIFICATION.md — FinFlow

**This file replaces "do a thorough audit" with a finite list.**

An audit by reading is sampling: read the code twice, get two different lists, forever.
There is no completeness property in "look harder", and the defects that have actually cost
production time — the payroll double-count, the load-order-dependent KPI, the decoupled
breakdown labels, the ignored status filter — are **behavioural**. They are not visible in
source at all. No amount of reading finds them.

What is finite is the set of things the app *shows* and *does*. That set comes from the UI,
not from what someone notices, and it does not grow while work is in progress.

**Issues are not enumerable. Checks are. Run the checks; the failures are the issue list.**

- **Part A — Figures:** **108** checks. Every number the app displays, per period view.
  *(A1 15 + A2 6 + A3 3 + A4 3 + A5 18 + A6 18 + A7 23 + A8 18 + A9 4 = 108. Was "~84" with an A7
  header reading 21 against 23 enumerated rows — corrected under **F81**; then **A8 VIEWER
  INDEPENDENCE** added at 6 and widened to 18 (timezone 6 + fiscal-year 6 + display-currency 6);
  then **A9 future-dated exclusion** added at 4 under decision **D2**. "Done = every check green"
  needs an unambiguous denominator, so this is recounted whenever a subsection changes.)*
- **Part B — Actions:** ~22 checks. Every mutating action, including double-submit and
  navigation-order behaviour.

**Done = every check green.** Anything not on this list is *unverified*, not assumed correct.

---

## Sequencing — agreed order of work

Recorded because an agreed plan that lives only in conversation is re-litigated or quietly
abandoned. This is the order; it is not a menu.

1. **Harness** — real Postgres, real schema, real server, real HTTP. *Steps 1–3 done; step 4
   (client surfaces via jsdom) and `/books` outstanding.*
2. **One full COLD sweep** — run **every** check in Parts A and B before fixing anything.
   Fix-as-you-find guarantees an endless drip (sweep rule 1).
3. **FREEZE the failure list.** That batch is the round. Anything found later goes on a separate
   list for the next round (sweep rule 2).
4. **Then, as ONE structural batch** — not three separate patches, because they share a root and
   patching them individually is the instance-not-class failure Rule 13 names:
   - **audit trail** (F90) via a shared write path a new route cannot bypass, including the
     side-effect writers (F92);
   - **money-engine consolidation** — one date comparison helper, string-based, shared by every
     leg on both client and server (F87);
   - **server-side period resolution** — the client sends *intent*, the server resolves the
     window from the server clock and the entity timezone (F89, F88/2i).
5. **Re-run every check** after the batch, not only the ones that failed (sweep rule 3).

## Rules of a sweep

1. **Run every check before fixing anything.** Fix-as-you-find guarantees an endless drip —
   fix payroll, find the status bug, fix that, find the label bug. Run all of them cold,
   collect every failure, then stop. One batch, one day, with a number attached.
2. **Freeze the failure list.** That batch is the scope of this round. Anything discovered
   afterwards goes on a *separate* list for the next round. Scope does not grow mid-round.
3. **Re-run everything after the fixes** — not only the ones that failed. A fix that breaks
   a different surface must surface in the same run, not at 3am three weeks later.

## Environment

- **Scratch Postgres only.** Never seed or test against production. Enforced mechanically by
  `tests/harness/guard.js`, not by intention: the harness never reads `DATABASE_URL`, scrubs
  any inherited value, and refuses anything that is not a loopback database whose name says
  it is scratch. (This is not paranoia — see **F78**: importing `server.js` runs DDL *and* a
  data-modifying `UPDATE` before any caller's code executes.)
- Real schema, real server, real endpoints, real HTTP. **No pool stubs** (see `CLAUDE.md`
  Rule 3 — the stub seeded `status:'final'`, a value that cannot exist, and passed).
  Substrate: embedded PostgreSQL **17.10**; production is PostgreSQL **17.6.1** (Supabase).
  Printed in the run header every run.
  ⚠️ Note **F79**: the schema has exactly **one** CHECK constraint in ~40 tables, and JSONB
  statuses cannot be constrained at all — so a real `INSERT` would *not* have rejected
  `status:'final'` either. The harness carries its own status-vocabulary gate; the database
  provides none.
- Clock pinned to **2026-07-25T12:00:00-04:00**, timezone **America/Port_of_Spain**
  (GMT-4, no DST), fiscal year starting **January**.
  *Was 2026-07-15 — moved under **F82**, because R3 (`run_date` 2026-07-20) and its payment
  (2026-07-22) sat in the future, so any window bounded at "now" would drop them and report a
  false failure. R3's date is a discriminator and did not move; the clock did. July is still
  an incomplete month.*
  The pin is **node-side only** — Postgres `NOW()` remains the real clock, so every seeded
  date is written explicitly and nothing relies on a database default (Rule 10).
- Single entity, currency **USD** (FX has its own pass — see Appendix B).
- **Investment price feed frozen** — prices are supplied by the harness and never fetched.
  All outbound network is blocked; any attempt is recorded and printed in the run report
  (the app swallows its own fetch failures, so a blocked call must be surfaced by the harness
  or it would be invisible).

---

# ACCOUNTING BASIS — DECIDED

These are settled. They define what "correct" means for every figure below.

| # | Decision |
|---|---|
| 1 | **A bill is an expense when ISSUED**, not when paid. Payment is settlement — the payments-made leg must **not** add a second expense. (This was a live suspected double-count in `computeBooks`.) |
| 2 | **A payroll run is recognised as expense at `approved`.** `draft` contributes 0. `paid` adds **nothing further** — the expense was already recognised. |
| 3 | **Cash Flow is genuine CASH basis** — recognised when money actually moves, regardless of instrument (card, transfer, cash are all the same thing). The P&L stays accrual. |
| 4 | **Investments** — server-side cached price, refreshed ~4h during market hours, card stamped "as of HH:MM". Frozen during a sweep so an exact value can be asserted. |
| 5 | **Banking MTD card is deleted** — it conflicts with the page's own period selector. Replaced by money in / out / net for the **selected period**. |

### ⚠️ IMPLEMENTATION TRAP on decision 2

`paid` is a state **downstream of** `approved` — a paid run was necessarily approved first,
and its expense was already recognised at that point.

- **CORRECT:** `WHERE status IN ('approved','paid')`
- **WRONG:** `WHERE status = 'approved'` — marking a run paid would make the expense
  **disappear** from the P&L.

"Recognised at approved" means recognition *begins* at approved, not that only rows
currently reading `approved` count. Check B4.3 exists specifically to catch this.

---

# THE SEED

Small enough to compute by hand. Every value chosen so that a plausible bug **changes the
number** — see `CLAUDE.md` Rule 4.

## Invoices
Basis: **ACCRUAL, ISSUE-BASED.** Recognised: `pending`, `overdue`, `partial`, `paid`.
`draft` excluded.

| ID | issue_date | amount | status | amount_paid | customer |
|---|---|---|---|---|---|
| INV-1 | 2026-05-10 | 1,000 | paid | 1,000 | Customer A |
| INV-2 | 2026-06-15 | 2,000 | partial | 500 | Customer A |
| INV-3 | 2026-06-20 | 3,000 | pending | 0 | Customer B |
| INV-4 | 2026-06-25 | **9,999** | **draft** | 0 | Customer A |
| INV-5 | 2026-07-05 | 4,000 | overdue | 0 | Customer B |

*Discriminates:* INV-4 is a large draft — a status leak makes June read 14,999 instead of
5,000. INV-2 is partial, so the old buggy AR formula (full amount, drafts included) gives
18,999 against a correct 8,500.

## Customers (added 2026-07-23 — unblocks A7.5)

| Customer | Invoices | Expected balance |
|---|---|---|
| Customer A | INV-1, INV-2, INV-4 (draft) | **1,500** |
| Customer B | INV-3, INV-5 | **7,000** |

*Discriminates:* Customer A carries all three hard cases at once — a settled invoice
(INV-1, contributes 0 because `amount_paid == amount`), a partial (INV-2, contributes the
**500 balance**, not its 2,000 face value), and a large draft (INV-4, excluded entirely).
Each of the three plausible bugs gives a different, recognisable number: counting face value
→ 3,000; leaking the draft → 11,499; counting only unsettled-by-status → 2,000.

**A + B must equal AR Outstanding (8,500).** That cross-check is the point of the split —
per-customer balances and the AR total are computed by different code, and this is the only
check that makes them reconcile.

## Payment events (required for Cash Flow — decision 3)
| Event | date | amount | direction |
|---|---|---|---|
| INV-1 payment received | 2026-05-15 | 1,000 | in |
| INV-2 partial received | 2026-06-20 | 500 | in |
| B2 bill payment made | 2026-07-05 | 500 | out |
| R3 payroll paid | 2026-07-22 | 1,100 | out |

> ⚠️ **SEED FIDELITY — the B2 payment MUST carry `bill_id` pointing at B2.** This is forced by
> the code, not a modelling choice. `computeBooks` excludes bill-linked payments from opex:
> ```js
> // server.js:4111-4113 — "This bill_id-IS-NULL predicate is the SOLE double-count guard."
> const paymentsMadeTotal = sumFX(paymentsMade.filter(p =>
>   p.bill_id == null && inPeriod(_pmDate(p))
> ), ...);
> ```
> Seeding this payment **unlinked** would make it an orphan disbursement, add a second 500 to
> July opex, and manufacture a double-count that does not exist — a self-inflicted failure
> that would look exactly like decision 1 being violated. The seed must exercise the guard,
> not bypass it.

## Inventory — FIFO
| Purchases | date | qty | unit cost |
|---|---|---|---|
| P0 | 2025-11-01 | 5 | 50 |
| P1 | 2026-04-01 | 4 | 100 |
| P2 | 2026-04-15 | 10 | 200 |

| Sales | date | qty | consumes | COGS |
|---|---|---|---|---|
| S0 | 2025-12-05 | 5 | P0 | 250 |
| S1 | 2026-05-20 | 4 | P1 | 400 |
| S2 | 2026-06-10 | 1 | P2 | 200 |
| S3 | 2026-07-12 | 4 | P2 | 800 |

*Discriminates:* three layers at different unit costs, with an earlier sale exhausting the
cheaper one. A **filter-sales-to-period-then-run-FIFO** bug gives Jun = 200 and Jul = 300
instead of 400 and 600. P0/S0 sit in 2025 so **all-time COGS (1,650) != FY2026 (1,400)** —
so the "all-time COGS at every period" bug is caught at Year view too, not only Month/Quarter.

## Manual expenses (non-payroll categories)
| date | category | amount |
|---|---|---|
| 2026-05-01 | Rent | 600 |
| 2026-06-01 | Rent | **650** |
| 2026-06-10 | Software | **100** |
| 2026-07-03 | Marketing | 250 |

*Discriminates:* July deliberately has **no rent** — any phantom accrual shows immediately.
Category totals are all distinct (Rent 1,200 / Software 150 / Marketing 250 FY), so a
label-to-value offset in the breakdown bars is visible.

⬜ **CODE QUESTION:** do expenses carry a **paid date** separate from the expense date? If
not, Cash Flow out cannot distinguish accrual from cash for expenses, and will always equal
P&L expenses for those rows. Expected values below assume expense date = paid date.

## Payroll
Roster: 2 employees, **5,000/month total**. Under basis C the roster is a template and must
contribute **zero**.

| Run | run_date | status | Σ lines |
|---|---|---|---|
| R1 | 2026-06-30 | **approved** | 4,200 |
| R2 | 2026-07-15 | **draft** | 3,300 |
| R3 | 2026-07-20 | **paid** | 1,100 |

*Discriminates:* the roster (5,000) matches no run, so a pass proves which source was read.
All three totals differ, so a status leak identifies *which* status leaked. Roster × elapsed
months would be ~35,000 — unmissable. R3 being `paid` is what catches the trap above.

## Bills / AP
| ID | date | amount | status |
|---|---|---|---|
| B1 | 2026-06-05 | 800 | unpaid |
| B2 | 2026-07-01 | 500 | paid (paid 2026-07-05) |

## Investments / holdings (added 2026-07-23 — unblocks A1.13-15)

Prices are **supplied by the harness**, never fetched. The live feed reaches CoinGecko /
Finnhub over the network (`server.js:4676`, `4697`); the harness blocks all outbound traffic,
so a frozen price is the only way this figure can be asserted at all.

| Symbol | units | frozen unit price | value |
|---|---|---|---|
| TESTCO | 100 | 50.00 | 5,000 |
| TESTCOIN | 10 | 100.00 | 1,000 |

**Expected Investments = 6,000, IDENTICAL at Month, Quarter and Year.**

### Scope: seeded as BUSINESS holdings, and why that is the faithful path

Holdings are seeded with `entity_id` **set** (business scope), not `NULL` (personal). This was
checked rather than assumed, because seeding the wrong scope would make A1.13–15 pass while
measuring a path production never uses — the seed-fidelity failure class, one level up from
`status:'final'`.

`window.bizHoldings` has exactly three assignments in the codebase: initialised empty
(`index.html:6483`), loaded from `GET /api/holdings?scope=business` (`index.html:6637`), and
filtered on delete (`finflow-api-wiring-final.js:261`). **No path populates it from personal
holdings — there is no fallback.** Both writers of the `d-invest` card read it exclusively
(`finflow-api-wiring-dashboard.js:231` and the FX overlay at `app-main.js:4580`), each with an
explicit comment that it is *not* `window.holdings`, since that cross-wire was fixed once
already under F59.

⚠️ The comment at `finflow-api-wiring-dashboard.js:227` — *"Business positions are empty today
⇒ $0"* — is **STALE**. The owner's production dashboard displays a six-figure Investments
value, and since no fallback exists, that number can only come from populated business-scope
rows. Do not treat that comment as current state.

### What A1.13–15 actually asserts

**`shares × the stored `price` column`** — not live pricing.

In production, `refreshAll()` (`index.html`) overwrites `h.price` with live quotes from
`/api/stock-price` before the card is painted. Under the harness that fetch fails (the server's
outbound call is blocked), so the seeded stored price stands. That is precisely the "price feed
frozen" requirement, and it is the only way an exact value can be asserted — but it means a
green A1.13–15 says nothing about whether live price refresh works. That surface is
**unverified**, and belongs in Appendix A.

*Discriminates:* this is a **balance**, not a period figure — a holding is not "earned" inside
a window. A value that moves with the period selector is a **FAIL**, not a rounding
difference. Two holdings at different unit prices, and units ≠ price in both rows, so a
units/price transposition (10 × 100 vs 100 × 10) or a summed-units-instead-of-value bug
produces a different number rather than the same 6,000.

---

# EXPECTED VALUES

## Components (derived from the seed alone)

| Period | Revenue | COGS | Manual exp | Bills issued | Payroll |
|---|---|---|---|---|---|
| May 2026 | 1,000 | 400 | 600 | 0 | 0 |
| **Jun 2026** | **5,000** | **200** | **750** | **800** | **4,200** |
| **Jul 2026** | **4,000** | **800** | **250** | **500** | **1,100** |
| Q2 (Apr–Jun) | 6,000 | 600 | 1,350 | 800 | 4,200 |
| Q3 (Jul–Sep) | 4,000 | 800 | 250 | 500 | 1,100 |
| **FY 2026** | **10,000** | **1,400** | **1,600** | **1,300** | **5,300** |

> ### ⚠️ KNOWN SEED LIMITATION — Q3 and July are indistinguishable (F91)
>
> Aug and Sep carry **no seeded rows**, so Q3 contains only July and **all six Q3 figures are
> identical to July** (rev 4,000 · COGS 800 · manual 250 · bills 500 · payroll 1,100 · cash out
> 1,850). A "return the anchor month instead of the quarter" bug is therefore **completely
> undetectable at Q3** — the whole column is satisfied by code that ignores quarters.
>
> Two smaller cases: **Q2 bills == Jun bills (800)** and **Q2 payroll == Jun payroll (4,200)**,
> because April and May carry no bills and no payroll runs.
>
> **A green Q2 or Q3 is weaker than a green Jun or Jul.** Fixing this needs a row in Aug or Sep
> and one in April, which moves the Q2/Q3/FY expected values — a seed revision requiring
> re-derivation, tracked as **F91** and not yet done.

**AR Outstanding (all-time, balance-sheet — deliberately ignores the period selector): 8,500**
**AP Outstanding (all-time): 800**

## P&L (accrual) — decisions 1 and 2
`opex = manual expenses + bills issued + payroll` — payments made excluded (settlement).

| Period | Gross Profit | Expenses (opex) | Net Profit |
|---|---|---|---|
| May 2026 | 600 | 600 | **0** |
| Jun 2026 | 4,800 | 5,750 | **−950** |
| Jul 2026 | 3,200 | 1,850 | **1,350** |
| Q2 | 5,400 | 6,350 | **−950** |
| Q3 | 3,200 | 1,850 | **1,350** |
| FY 2026 | 8,600 | 8,200 | **400** |

*Deliberate:* June is a **loss** and May is exactly **zero** — both test sign handling and
zero-vs-empty rendering, which an all-positive seed never exercises.

## Cash Flow (cash) — decision 3

| Period | Cash in | Cash out | Net |
|---|---|---|---|
| May 2026 | 1,000 | 600 | **+400** |
| Jun 2026 | 500 | 750 | **−250** |
| Jul 2026 | 0 | 1,850 | **−1,850** |
| Q2 | 1,500 | 1,350 | **+150** |
| Q3 | 0 | 1,850 | **−1,850** |
| FY 2026 | 1,500 | 3,200 | **−1,700** |

*Jul out = 250 marketing + 500 bill payment + 1,100 payroll paid.*

**This is the key cross-statement check.** FY Cash out (3,200) must **not** equal FY opex
(8,200) — the gap is the unpaid bill B1 (800) and the approved-but-unpaid run R1 (4,200).
If Cash Flow equals the P&L, the cash basis was never implemented.

---

# PART A — FIGURE CHECKS

Mark PASS / FAIL. A FAIL records **actual vs expected**, nothing more — do not diagnose
during the sweep.

## A1 · Dashboard KPI cards — 15
| # | Figure | Jun / Jul / FY | Result |
|---|---|---|---|
| A1.1–3 | Revenue | 5,000 / 4,000 / 10,000 | |
| A1.4–6 | Expenses | 5,750 / 1,850 / 8,200 | |
| A1.7–9 | Net Profit | −950 / 1,350 / 400 | |
| A1.10–12 | Outstanding | 8,500 all three (all-time by design) | |
| A1.13–15 | Investments | **6,000** — identical all three (balance, not a period figure) | |

## A2 · Dashboard expense breakdown bars — 6
| # | Check | Expected | Result |
|---|---|---|---|
| A2.1 | Bars sum to the Expenses KPI | 5,750 (Jun) | |
| A2.2 | Rent bar labelled "Rent" | 650 (Jun) | |
| A2.3 | Software bar labelled "Software" | 100 (Jun) | |
| A2.4 | Payroll appears as its own bar | 4,200 (Jun) | |
| A2.5 | Each label matches its own value (not top-N sorted into static labels) | — | |
| A2.6 | Categories with no spend render "—", not 0 or blank | — | |

## A3 · Revenue vs Expenses chart — 3
| # | Check | Expected | Result |
|---|---|---|---|
| A3.1 | Jun expense bar matches the Expenses KPI | 5,750 | |
| A3.2 | Jun revenue bar matches the Revenue KPI | 5,000 | |
| A3.3 | A month with no activity renders empty, not carried forward | — | |

## A4 · Business transactions list — 3
| # | Check | Expected | Result |
|---|---|---|---|
| A4.1 | Every seeded invoice except INV-4 (draft) appears | 4 rows | |
| A4.2 | Every seeded expense appears | 4 rows | |
| A4.3 | Recognised payroll runs appear | R1, R3 | |

## A5 · Server engine — `/api/reports` and `/books` — 18
| # | Figure | Jun | Jul | FY | Result |
|---|---|---|---|---|---|
| A5.1–3 | revenue | 5,000 | 4,000 | 10,000 | PASS (2026-07-23 · seed c882b311) |
| A5.4–6 | cogs | 200 | 800 | 1,400 | PASS (2026-07-23 · seed c882b311) |
| A5.7–9 | grossProfit | 4,800 | 3,200 | 8,600 | PASS (2026-07-23 · seed c882b311) |
| A5.10–12 | opex | 5,750 | 1,850 | 8,200 | **FAIL** — actual 5,600 / 4,650 / 11,500 (2026-07-23 · seed c882b311) |
| A5.13–15 | netProfit | −950 | 1,350 | 400 | **FAIL** — actual -800 / -1,450 / -2,900 (2026-07-23 · seed c882b311) |
| A5.16–18 | outstanding | 8,500 | 8,500 | 8,500 | PASS (2026-07-23 · seed c882b311) |
## A6 · Cross-engine reconciliation — 18
Client-displayed figure **==** server figure, six figures × three periods.

> Passing A6 while failing A5 means both engines are wrong *together*. Agreement is not
> correctness (`CLAUDE.md` Rule 6) — A5 is the authority; A6 only detects divergence.

## A7 · Page-level figures — 23
| # | Page | Figure | Expected | Result |
|---|---|---|---|---|
| A7.1 | Invoices | total outstanding | 8,500 | |
| A7.2 | Invoices | count excludes draft | 4 of 5 | |
| A7.3 | Invoices | subtitle wording | "1 overdue" (never "All invoices paid") | |
| A7.4 | Payments Received | total received | 1,500 | |
| A7.5 | Customer detail | per-customer balance | **A = 1,500 · B = 7,000 · A+B = 8,500 (== AR)** | |
| A7.6 | Expenses page | period total | 750 (Jun) | |
| A7.7 | COGS page | period COGS | 200 (Jun) | |
| A7.8 | COGS page | no-period call | 1,650 all-time | |
| A7.9–11 | Cash Flow | cash in — Jun/Jul/FY | 500 / 0 / 1,500 | |
| A7.12–14 | Cash Flow | cash out — Jun/Jul/FY | 750 / 1,850 / 3,200 | |
| A7.15–17 | Cash Flow | net — Jun/Jul/FY | −250 / −1,850 / −1,700 | |
| A7.18 | Cash Flow | FY cash out != FY opex | 3,200 != 8,200 | |
| A7.19 | Banking | in/out/net for **selected period** (no MTD card) | matches A7.9–17 for that period | |
| A7.20 | Bills / AP | outstanding | 800 | |
| A7.21 | Payroll | Monthly Payroll card | 5,000 (roster = template, informational only) | |
| A7.22 | Payroll | run history dates | formatted, correct **local** day | |
| A7.23 | Tax | YTD paid | **absent, or the literal text "Not tracked". ANY number = FAIL** (see below) | |

> **A7.23 — how to judge it.** Tax paid has **no source in the system** (Appendix C.2: no table, no
> category, no response field), so under decision **D1** the only honest outcomes are *nothing* or
> *"Not tracked"*. **Both of these PASS:**
> - the figure is **not displayed at all** — the current state, since `calcAndRenderTax` was removed
>   under PL#11 and Tax Filing is the F51 "Coming Soon" placeholder;
> - the figure **is** displayed and reads **"Not tracked"** (or equivalent non-numeric text).
>
> **Any computed, inferred, estimated or placeholder NUMBER FAILS** — including `$0`, `—` presented
> as a value, or a percentage of the liability (the removed `liability × 0.75` fabrication).
>
> This check does **not** require the figure to be displayed. It is a guard against a number
> reappearing without a source, not a request to build the surface.

## A8 · VIEWER INDEPENDENCE — 18

**Every Part A figure must be IDENTICAL regardless of who is looking. Any figure that moves is
a FAIL.**

The books belong to the entity. Nothing about the *reader* — where they are, how their own
fiscal year is configured, what currency they prefer — may change a number. Three axes:

### A8a · Timezone — 6

Run the identical seed and probe under **at least three viewers spanning the sign boundary**.
Harness: `node tests/harness/tz-matrix.js`.

> ⚠️ **The matrix MUST include a positive (east-of-UTC) offset.** UTC-4 and UTC-8 are both west
> and misfile **identically**, so a western-only matrix goes green on the exact bug it exists to
> catch. This already produced one false negative. Required minimum:
> `America/Los_Angeles` (UTC-8/-7), `America/Port_of_Spain` (UTC-4), `Asia/Kolkata` (UTC+5:30 —
> the half-hour offset also catches whole-hour assumptions). `Europe/London` recommended as a
> fourth.

| # | Figure | Expected | Result |
|---|---|---|---|
| A8a.1 | revenue — identical across all viewers | no difference | |
| A8a.2 | cogs | no difference | |
| A8a.3 | grossProfit | no difference | |
| A8a.4 | opex | no difference | |
| A8a.5 | netProfit | no difference | |
| A8a.6 | outstanding | no difference | |

### A8b · Fiscal-year setting — 6

Same seed, same entity, read by two users whose **own** `fiscal_year` settings differ (January
vs April). Every figure must be identical: the fiscal year belongs to the **books**, not the
reader. Year-end is where this hurts most — a January-FY client viewed by an April-FY accountant
would otherwise get different YEAR boundaries on the same data.

| # | Figure | Expected | Result |
|---|---|---|---|
| A8b.1–6 | revenue / cogs / grossProfit / opex / netProfit / outstanding | no difference | |

### A8c · Display currency — 6

Same seed, read with the viewer's display currency set to the entity's native currency vs a
foreign one, then converted back at the stated rate. Figures must reconcile exactly and
consistently. If conversion is driven by the viewer's preference at read time, accountant and
client see figures that do not reconcile — and do not reconcile *differently each day*, since
rates move.

| # | Figure | Expected | Result |
|---|---|---|---|
| A8c.1–6 | revenue / cogs / grossProfit / opex / netProfit / outstanding | reconciles exactly | |

---

**Why this is on the permanent list.** FinFlow has an accountant marketplace: an accountant and
their client read **one** database from **two** places. If a period total depends on where the
reader is sitting or how their own preferences are set, the two of them are looking at different
books and neither can tell. That is a correctness property of a multi-tenant product, not a
formatting detail.

**Why no amount of source reading establishes it.** Reading `_periodWindow` tells you a timezone
is involved. It does not tell you whether any row falls in the gap between two viewers'
boundaries, and therefore whether any figure moves. Only execution answers that.

> ### ⚠️ A GREEN A8 AGAINST A DATE-ONLY SEED IS WORTHLESS
>
> A8 proves no *seeded row* falls in an inter-viewer gap. It does **not** prove the boundaries
> are viewer-independent — they can differ while every figure still agrees.
>
> This is not hypothetical: the **first run of this check reported zero differences and was a
> false negative.** Every seeded row carried a date-only string, which `new Date()` places at
> `00:00Z` — before *every* western boundary — so all viewers were wrong identically and nothing
> moved. It only became measurable once a row was timestamped **inside** the gap.
>
> **The seed must therefore retain at least one row carrying a real time-of-day inside a
> plausible inter-viewer gap**, and the window-comparison half of `tz-matrix.js` output must be
> read alongside the figures. Rule 4, applied to timezone.

## A9 · Future-dated documents are not recognised — 4

**Standing decision D2:** a document dated in the future is *scheduled*, not issued, and
contributes **ZERO to every figure — including Year — until its date arrives.**

Requires a seed row that does not exist yet: **INV-6, a future-dated invoice** dated after the
pinned clock (2026-07-25) but inside FY2026 — proposed `2026-09-01`, amount `5,000`, assigned to
a customer. Folded into the held seed revision (F91 + D2c); expected values below assume the
**correct** (D2) behaviour, so a green A9 requires recognition to be withheld.

| # | Check | Expected | Result |
|---|---|---|---|
| A9.1 | Future invoice contributes 0 to **FY** revenue | FY revenue unchanged (10,000, not 15,000) | ⬜ seed row pending |
| A9.2 | Contributes 0 to its **quarter** (Q3, Jul–Sep) | Q3 revenue unchanged (4,000, not 9,000) | ⬜ seed row pending |
| A9.3 | Contributes 0 to **AR outstanding** | 8,500, not 13,500 | ⬜ seed row pending |
| A9.4 | Appears in a visible **scheduled** state — excluded from totals but NOT invisible | labelled, not vanished (**F94**) | ⬜ seed row pending |

> ⚠️ **A9 currently FAILS by design.** The app has no upper date bound and no scheduled state
> (D2 consequences a and F94), and the recognition legs have no "not after today" filter — so the
> present code *recognises* INV-6 and A9.1–3 fail. A9.4 fails because no scheduled state exists.
> These failures are the **discriminator**: they go on the sweep's failure list and are cleared
> only when D2 is implemented. **D2 itself is blocked on server-side period resolution** (F88/2i,
> F89) — "future relative to whose clock?" is undefined while the boundary is the viewer's
> browser clock (F87).

---

# PART B — ACTION CHECKS

Behavioural. **None of these are findable by reading source** — this is where every defect
that reached production actually lived.

## B1 · Double-submit — 8
For each: click twice rapidly, then **wait 6 seconds and click again** (the existing guard is
a 5-second window — a slow double-submit defeats it; `CLAUDE.md` Rule 9).

| # | Action | Expected | Result |
|---|---|---|---|
| B1.1 | Create invoice | exactly one | |
| B1.2 | Record payment | exactly one | |
| B1.3 | Run Payroll | exactly one run | |
| B1.4 | Approve payroll run | expense counted once | |
| B1.5 | Log expense | exactly one row | |
| B1.6 | Record sale movement | COGS moves once | |
| B1.7 | Restock item | stock moves once | |
| B1.8 | Create bill | exactly one | |

## B2 · Live update without reload — 5
| # | Action | Expected | Result |
|---|---|---|---|
| B2.1 | Add invoice | Revenue + Net Profit move immediately | |
| B2.2 | Log expense | KPI, breakdown, chart **and** transactions all move | |
| B2.3 | Approve payroll run | Expenses move by exactly Σ lines | |
| B2.4 | Record partial payment | Outstanding drops by the payment, not the full amount | |
| B2.5 | Mark paid on a partial invoice | pays the balance, no 400 error | |

## B3 · Navigation-order independence — 3
The load-order defect: `window.payrollRuns` populated only when the Payroll page was
visited, so the Expenses KPI depended on where you clicked first.

| # | Check | Expected | Result |
|---|---|---|---|
| B3.1 | Fresh reload → dashboard first → read Expenses | 5,750 (Jun) | |
| B3.2 | Then visit Payroll → return to dashboard | **unchanged** | |
| B3.3 | Reload → Payroll first → dashboard | **same figure via both routes** | |

## B4 · Status lifecycle — 4
| # | Check | Expected | Result |
|---|---|---|---|
| B4.1 | Draft run present | contributes 0 | |
| B4.2 | Approve it | contributes exactly Σ lines, once | |
| B4.3 | **Mark it Paid** | **expense UNCHANGED — must not disappear** (the decision-2 trap) | |
| B4.4 | Mark Paid | Cash Flow **out** increases by Σ lines | |

## B5 · Cross-cutting — 3
| # | Check | Expected | Result |
|---|---|---|---|
| B5.1 | Change currency in Settings (not the pill) | figures **and** symbol change together | |
| B5.2 | Switch Month → Quarter → Year | every figure moves consistently | |
| B5.3 | Block `/api/reports` in DevTools | all cards show "—", never a stale or native number | |

---

# Appendix A — What this list does NOT cover

State these as unverified rather than assuming them:

- Authentication, sessions, password reset
- Team scoping and permissions (B9-F54)
- Accountant portal access control
- PDF / CSV exports and emailed documents
- Stripe billing (currently disabled — key not set)
- Recurring invoice and bill scheduling
- AI routing, caching, Ask AI
- Mobile / responsive layout
- Performance and scale (e.g. the payroll-runs `LIMIT 50` client cap)

Each needs its own list. Do not let a green sweep imply these were checked.

# Appendix B — Second pass: foreign currency

Re-run Part A with one EUR invoice and one EUR expense added, and a non-USD display currency
selected. Kept separate so the base paper arithmetic stays hand-computable. Checks: figures
convert, symbols match the figures, and a blocked FX rate yields "—" rather than a native
number presented as converted.

# Appendix C — Answered / still open

## ✅ 1. ANSWERED — expenses carry NO paid date

The only date field on an expense is **`expense_date`**. `POST` and `PUT /api/expenses` write
exactly `description`, `category`, `amount`, `deductible`, `expense_date` — and nothing else.
There is no `paid_date`/`payment_date` on expenses anywhere; every `payment_date` in the
codebase belongs to `invoice_payments`, `payments_made` or `payments_received`.

**Consequence — "expense date = paid date" is FORCED BY THE SCHEMA, not a modelling choice we
made.** Therefore, under decision 3 (Cash Flow is genuine cash basis):

- **EXACT** for bills and payroll — both have real payment events (`payments_made`, the payroll
  `paid` transition), so their cash timing is recorded data.
- **ASSUMED** for manual expense rows — the expense date is used as the payment date because
  no other date exists.

The expected Cash Flow values in this document hold under that assumption. **If true expense
cash-timing is ever wanted, that is a schema change, not a fix** — and every Cash Flow figure
involving expense rows would need re-deriving.

## ✅ 2. ANSWERED — tax paid has no source of any kind

Not a broken calculation; there is nothing to calculate *from*:

- **No `tax_payments` table** — no typed tax table of any kind exists.
- **Not in the 35-table `TABLES` array** (`database.js:51-62`).
- **Not even an expense category** — `bexp-cat` is Rent, Software, Marketing, Travel,
  Equipment, Meals, Contractors, Professional Fees, Other. There is no "Tax".
- **No `ytdPaid` field on the response** — `GET /api/tax-filing` returns only
  `{revenue, deductible, taxableIncome, estimatedTax, quarterly, rate}`.

Tax paid is not merely un-aggregated — it is **unrecordable**. This is why the prior
`ytdPaid = liability × 0.75` was pure fabrication (removed under PL#11), and it matches
**decision D1** in `AUDIT_MASTER.md`: no tax payment tracking exists, so the figure must read
*"Not tracked"* and never a computed number. Endpoint staleness is tracked separately as **F76**.

## ⬜ 3. STILL OPEN — owner decision

Which taxes should a combined "tax" figure cover — corporation tax, VAT, PAYE and NIS are
separate obligations on different periods. One combined figure may not be useful; splitting
them is a feature, not a fix. Deferred alongside the D1 implementation, and carried on D1.
