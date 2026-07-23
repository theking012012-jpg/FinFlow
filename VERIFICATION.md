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

- **Part A — Figures:** ~84 checks. Every number the app displays, per period view.
- **Part B — Actions:** ~22 checks. Every mutating action, including double-submit and
  navigation-order behaviour.

**Done = every check green.** Anything not on this list is *unverified*, not assumed correct.

---

## Rules of a sweep

1. **Run every check before fixing anything.** Fix-as-you-find guarantees an endless drip —
   fix payroll, find the status bug, fix that, find the label bug. Run all of them cold,
   collect every failure, then stop. One batch, one day, with a number attached.
2. **Freeze the failure list.** That batch is the scope of this round. Anything discovered
   afterwards goes on a *separate* list for the next round. Scope does not grow mid-round.
3. **Re-run everything after the fixes** — not only the ones that failed. A fix that breaks
   a different surface must surface in the same run, not at 3am three weeks later.

## Environment

- **Scratch Postgres only.** Never seed or test against production.
- Real schema, real server, real endpoints, real HTTP. **No pool stubs** (see `CLAUDE.md`
  Rule 3 — the stub seeded `status:'final'`, a value that cannot exist, and passed).
- Clock pinned to **2026-07-15**, timezone **GMT-4**, fiscal year starting **January**.
- Single entity, currency **USD** (FX has its own pass — see Appendix B).
- **Investment price feed frozen** to a fixed cached value for the duration of the sweep.

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

| ID | issue_date | amount | status | amount_paid |
|---|---|---|---|---|
| INV-1 | 2026-05-10 | 1,000 | paid | 1,000 |
| INV-2 | 2026-06-15 | 2,000 | partial | 500 |
| INV-3 | 2026-06-20 | 3,000 | pending | 0 |
| INV-4 | 2026-06-25 | **9,999** | **draft** | 0 |
| INV-5 | 2026-07-05 | 4,000 | overdue | 0 |

*Discriminates:* INV-4 is a large draft — a status leak makes June read 14,999 instead of
5,000. INV-2 is partial, so the old buggy AR formula (full amount, drafts included) gives
18,999 against a correct 8,500.

## Payment events (required for Cash Flow — decision 3)
| Event | date | amount | direction |
|---|---|---|---|
| INV-1 payment received | 2026-05-15 | 1,000 | in |
| INV-2 partial received | 2026-06-20 | 500 | in |
| B2 bill payment made | 2026-07-05 | 500 | out |
| R3 payroll paid | 2026-07-22 | 1,100 | out |

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
| S2 | 2026-06-10 | 2 | P2 | 400 |
| S3 | 2026-07-12 | 3 | P2 | 600 |

*Discriminates:* three layers at different unit costs, with an earlier sale exhausting the
cheaper one. A **filter-sales-to-period-then-run-FIFO** bug gives Jun = 200 and Jul = 300
instead of 400 and 600. P0/S0 sit in 2025 so **all-time COGS (1,650) != FY2026 (1,400)** —
so the "all-time COGS at every period" bug is caught at Year view too, not only Month/Quarter.

## Manual expenses (non-payroll categories)
| date | category | amount |
|---|---|---|
| 2026-05-01 | Rent | 600 |
| 2026-06-01 | Rent | 600 |
| 2026-06-10 | Software | 150 |
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

---

# EXPECTED VALUES

## Components (derived from the seed alone)

| Period | Revenue | COGS | Manual exp | Bills issued | Payroll |
|---|---|---|---|---|---|
| May 2026 | 1,000 | 400 | 600 | 0 | 0 |
| **Jun 2026** | **5,000** | **400** | **750** | **800** | **4,200** |
| **Jul 2026** | **4,000** | **600** | **250** | **500** | **1,100** |
| Q2 (Apr–Jun) | 6,000 | 800 | 1,350 | 800 | 4,200 |
| Q3 (Jul–Sep) | 4,000 | 600 | 250 | 500 | 1,100 |
| **FY 2026** | **10,000** | **1,400** | **1,600** | **1,300** | **5,300** |

**AR Outstanding (all-time, balance-sheet — deliberately ignores the period selector): 8,500**
**AP Outstanding (all-time): 800**

## P&L (accrual) — decisions 1 and 2
`opex = manual expenses + bills issued + payroll` — payments made excluded (settlement).

| Period | Gross Profit | Expenses (opex) | Net Profit |
|---|---|---|---|
| May 2026 | 600 | 600 | **0** |
| Jun 2026 | 4,600 | 5,750 | **−1,150** |
| Jul 2026 | 3,400 | 1,850 | **1,550** |
| Q2 | 5,200 | 6,350 | **−1,150** |
| Q3 | 3,400 | 1,850 | **1,550** |
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
| A1.7–9 | Net Profit | −1,150 / 1,550 / 400 | |
| A1.10–12 | Outstanding | 8,500 all three (all-time by design) | |
| A1.13–15 | Investments | frozen seed value, identical all three | |

## A2 · Dashboard expense breakdown bars — 6
| # | Check | Expected | Result |
|---|---|---|---|
| A2.1 | Bars sum to the Expenses KPI | 5,750 (Jun) | |
| A2.2 | Rent bar labelled "Rent" | 600 (Jun) | |
| A2.3 | Software bar labelled "Software" | 150 (Jun) | |
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
| A5.1–3 | revenue | 5,000 | 4,000 | 10,000 | |
| A5.4–6 | cogs | 400 | 600 | 1,400 | |
| A5.7–9 | grossProfit | 4,600 | 3,400 | 8,600 | |
| A5.10–12 | opex | 5,750 | 1,850 | 8,200 | |
| A5.13–15 | netProfit | −1,150 | 1,550 | 400 | |
| A5.16–18 | outstanding | 8,500 | 8,500 | 8,500 | |

## A6 · Cross-engine reconciliation — 18
Client-displayed figure **==** server figure, six figures × three periods.

> Passing A6 while failing A5 means both engines are wrong *together*. Agreement is not
> correctness (`CLAUDE.md` Rule 6) — A5 is the authority; A6 only detects divergence.

## A7 · Page-level figures — 21
| # | Page | Figure | Expected | Result |
|---|---|---|---|---|
| A7.1 | Invoices | total outstanding | 8,500 | |
| A7.2 | Invoices | count excludes draft | 4 of 5 | |
| A7.3 | Invoices | subtitle wording | "1 overdue" (never "All invoices paid") | |
| A7.4 | Payments Received | total received | 1,500 | |
| A7.5 | Customer detail | per-customer balance | ⬜ owner (depends on assignment) | |
| A7.6 | Expenses page | period total | 750 (Jun) | |
| A7.7 | COGS page | period COGS | 400 (Jun) | |
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
