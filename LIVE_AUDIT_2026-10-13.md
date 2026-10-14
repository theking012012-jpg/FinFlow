# FinFlow — Live Launch-Readiness Audit

**Date:** 2026-10-13
**Target:** `https://finflow-production-dab2.up.railway.app` (dab2 production instance)
**Account:** "Northwind Studio" test account (owner: Sam Owner) + "Island Traders" (TTD) entity
**Method:** Browser automation (Chrome), read-only verification + owner-approved test-data entry & flow tracing.
**Scope note:** Live app can prove surface-consistency, wall integrity, flow propagation and errors. It does **not** replace `VERIFICATION.md` (owner-supplied expected values on seeded data). FIFO layer-ordering, in particular, needs the harness.

---

## FIX STATUS — updated 2026-10-14, second pass (branch `claude/laughing-hawking-lkvv38`, not yet merged to `main`)

The audit text below is kept as written; each finding now carries a **Status** line. Every fix was verified by a
harness run on a real scratch Postgres (and the real app in jsdom where the defect is in the browser): **it fails on
the old code and passes on the fix**, and the related existing harnesses were re-run green. Exact counts are in each
commit message and in `AUDIT_MASTER.md` (rows LA1–LA16). These fixes are **not on the live site** until `main` is
merged and Railway deploys it; the owner's full PowerShell sweep has not been run on them yet.

| Finding | Status | Commit |
|---|---|---|
| B1 cards show `$0` | ✅ Fixed (LA1). Root cause differs from the audit's suspicion — see B1. | `ee83114` |
| B1 console "Cannot set properties of null" | 🟠 Open (LA2) — not reproduced on test data; the log now names the hook | `ee83114` |
| B2 owner salary not reaching Personal | **WITHDRAWN 2026-10-14 — not a defect.** Live repro (Cowork, deployed main): mark-paid booked the owner-salary row (id 113, $4,000, Personal) and the Personal page shows it in Month / Quarter / Year. The 10-13 "no row" was read off the rendered page during the B1 render race. LA3's changes (flag the owner on Edit, mark-paid says what crossed) remain as improvements. | `23a4716` |
| M1 Customers 0 | ✅ Fixed (LA4) | `06a7559` |
| M2 Inventory $90 vs $75 | ✅ Fixed (LA5) — $90 was right, the row was wrong | `58aa2e8` |
| M3 credit note in Outstanding / Revenue | ✅ Amounts correct as they are; caption fixed (LA6) | `98f4cec` |
| No COGS on dashboard | ✅ Fixed (LA13) | `f0a7491` |
| VAT Return tile | ✅ Removed (LA9) | `a99215f` |
| "Business" / "89% deductible" labels | ✅ Fixed (LA8) | `9cc150a` |
| Full reload on every navigation | ⚪ Not reproduced (LA11) — needs the exact click from the owner | — |
| Negative-revenue September | ⚪ Not a defect (LA12) — owner decision: keep credit notes netted | — |
| Found while fixing: Vendors 0 (same as M1) | ✅ Fixed (LA14) | `2391779` |
| Found while fixing: literal "$" money (62 matches classified) | ✅ Fixed (LA15a business app, LA15b accountant client view, LA15c marketplace rates in the accountant's own currency) | `1cdc309` · `2ed98f8` · `f51e6cc` |
| Found while fixing: Items page 0 | ✅ Fixed (LA16) — owner decision: one product list | `cfb01ad` |
| Found while fixing: "1099 / W-2 Summary" is US-only naming | ✅ Renamed "Payroll by person" (LA10) — owner decision | `b551af9` |
| Found while fixing: accountant sign-up pricing was never saved | ✅ Fixed (LA17) | `f51e6cc` |
| Found while fixing: consolidated accountant view dropped an unconvertible business silently | ✅ Now says which currency is missing and how to fix it (LA15b) | `2ed98f8` |
| Found while fixing: e2e lifecycle test stale since C6 | ✅ Test fixed (LA18) | `cce19e7` |

**Verdict now:** ONE blocker (B1) — fixed on the branch, still live until it is merged and deployed (the 2026-10-14 Cowork
repro saw Revenue / Expenses / Net Profit = $0 again on a hard reload). B2 is withdrawn (above). Launch-ready once the branch
is merged and deployed, the owner's full sweep is green, and the next live check (which should also cover the "Not yet
exercised" list below) shows no `$0` cards and names any remaining boot error (LA2).

---

## VERDICT (as audited, 2026-10-13): NOT launch-ready yet — 2 blockers

The money engine is largely correct and reconciles across surfaces. Two defects are launch-blocking: a dashboard render race that shows **$0** for headline money figures at random, and the **owner-salary Business→Personal crossing does not fire**.

---

## 🔴 BLOCKERS

### B1 — Dashboard KPI cards render `$0` at random (render race)
**Severity: launch-blocking.** On normal, fully-loaded dashboard views, the headline cards — **Revenue, Expenses, Net Profit, Investments** — intermittently display **`$0`** instead of the real value. Non-deterministic: a *different* random subset fails on each load (observed Investments-only once; Revenue+Expenses+Net-Profit several times; all-correct sometimes).

- **Data is correct underneath** — the Money-flow block, Reports, expense breakdown and chart show the right numbers at the same instant the cards show `$0`. This is a **render bug, not a math bug**.
- **Mechanism:** `app-main.js` logs `Cannot set properties of null (setting 'textContent'/'innerHTML')` — "a deferred render hook threw (skipped, boot continues)". The KPI value hook runs before its target node exists → value never written → card stays at its initial `$0`, while the caption ("+$1,217 · +81%") renders from a separate element, giving the nonsensical "`$0` +81%".
- **Evidence:** 133 such console errors across ~8 reloads; error count per load varied (7/35/14/7/21…) tracking the failures. Reproduced on both USD and TTD entities (same bundle).
- **Caution (CLAUDE.md failure #1):** `app-main.js` is subject to dead-code shadowing. Find the runtime-winning copy of the KPI render hook before editing, or the fix diffs clean and does nothing.

> **Status — ✅ FIXED (LA1, `ee83114`). The root cause was not the null errors.** The KPI cards always exist (the
> dashboard is never a lazy page). The cause was the stat-card **count-up animation**: it read the card's text once when
> it started and wrote that value on every frame for ~700 ms, ending with a write of that starting value. A card still
> showing `$0` (painted before the data arrived) when the animation started had its real value, painted moments later,
> overwritten with `$0`. Investments and Outstanding are written as exact amounts (`$2,700`), which the animation picks
> up — hence "`$0` +81%" on Investments (its caption is not animated). Fix: the animation stops as soon as anything else
> writes the card, and never animates a zero; it moved to `public/finflow-counter.js` and the `app-main.js` copy was
> deleted. Verified: in the real app on the old code the Outstanding card ends at `$0` after a mid-animation repaint;
> on the fix it keeps the real value.
> One part of the evidence does not fit this cause: amounts shown as `TT$…` can never trigger the animation. If `$0`
> cards were really seen on the TTD business, that is a separate defect — please say if so.
>
> **The null errors — 🟠 OPEN (LA2).** They do not appear with any test data. The boot log now names the failing hook
> and where it threw, so the next live check will identify it.

### B2 — Owner-salary Business→Personal crossing does NOT fire on PAID
> **WITHDRAWN 2026-10-14 (live repro by Cowork on deployed main, observe-only):** run #3 "November 2026" approved → marked paid
> at 10:57:28 UTC−4; `GET /api/personal-transactions` immediately carried `{id:113, amount:4000, currency:USD, source:payroll,
> entity_id:null, payroll_run_id:3, description:"Owner salary — Northwind Studio (November 2026)"}`, and after a hard reload
> the Personal page listed it (+$4,000) in Month / Quarter / Year (Year income $3.4K → $7.4K). The code was unchanged since
> 10-13; the 10-13 conclusion came from reading the rendered Personal page during the B1 render race instead of the API.
> Read-only probes agree: id 112 was handed out at run #2's mark-paid (row later removed by its void). The section below is
> kept as originally written.

**Severity: launch-blocking** (core walled feature, non-functional). Ran a payroll (Oct 2026), approved it, marked it **Paid** — logged-in user **is** the owner (Sam Owner).

- **Business side correct:** on Paid, the dashboard booked a `Payroll $8,000` expense line (basis-C read the run gross); voiding reversed it.
- **Personal side broken:** after a **full reload**, Personal income was unchanged (~$3.4K: interest, refunds, freelance $1,800). **No Sam Owner / payroll salary income row** for October; no "salary/payroll" income source.
- The app's **own banner** promises *"It reaches Personal as income only when a payroll run is marked paid."* The run was paid; nothing reached Personal. Per CLAUDE.md this is *the one* legal crossing ("owner's salary as personal income on PAID; one row per owner line; removed on void") — it is not working on this deploy.
- **To check:** the paid run exposes a "Remit" step (withholdings $1,300). If the crossing is (incorrectly) gated behind Remit rather than Paid, that's still a spec violation. Void-removal of the personal row couldn't be tested because the row was never created.

> **Status — ✅ FIXED (LA3, `23a4716`); live cause to confirm.** The crossing fires on **Paid** (not Remit) and works —
> but only for a run line whose roster person is marked as the owner. The only way to mark the owner was the separate
> owner card: **Add employee always saved the person as a regular employee**, Edit employee could not change it, and a
> paid run with no owner line put nothing on Personal and said nothing. An owner added through Add employee therefore
> never crossed — the symptom seen here. Fix: "This is me — the business owner" on Add and Edit employee (one owner per
> business), and Mark Paid now says what reached Personal, or that nobody on the run is marked as the owner and how to
> fix it. Verified: on the old code an owner added as an employee gets 0 Personal rows; on the fix, 1 row of their net
> pay; void still removes it. **I could not read the live data**, so confirm Northwind's cause with the read-only probe:
> `node tools/live-audit-2026-10-13/b2-owner-salary-probe.js <account email>` (DATABASE_URL set). If Sam Owner is not
> marked as owner there, edit Sam on the roster, tick "This is me", and pay a run.

---

## 🟠 MEDIUM

- **M1 — Customers CRM empty despite active billing.** Customers page shows **0 customers / $0 lifetime revenue** while invoices total $23,477 billed (Delta/Bright/Acme). Invoices store a **free-text** client name, not linked to CRM records → "Lifetime Revenue $0" is misleading at launch.
  - **Status — ✅ FIXED (LA4, `06a7559`).** Invoice clients that match no saved customer are now listed as "Not saved",
    on the same revenue basis, with a Save button that opens the add form filled in; the counts and Lifetime Revenue
    include them. Nothing is written until you save. The same gap on **Vendors** (bills to a name with no vendor record)
    is fixed too (LA14, `2391779`).
- **M2 — Inventory Value ≠ product value.** Inventory **Value card = $90** but the only SKU (Widget, 5 units) shows **$75** — a $15 mismatch on the headline inventory figure. Source of the $15 unverified (possible stray FIFO layer / in-transit stock from the "Stock"-tagged Widget Maker bill). Worth confirming.
  - **Status — ✅ FIXED (LA5, `58aa2e8`). $90 is correct; the row was wrong.** 20 bought @ $15, then 10 @ $18, then 25
    sold leaves 5 @ $18 = $90 (FIFO), and COGS 300 + 90 = $390 matches the P&L. The row multiplied 5 units by the
    item's current cost field ($15). Rows now show each item's FIFO value from the same calculation as the card, so
    they always add up to it.
- **M3 — Unapplied credit note hits Outstanding & Revenue.** Credit note CN-6629 (Acme −$300, status "Open — not yet applied") already reduces Revenue (Sep −$300 in P&L) and Outstanding AR. The Invoices card reads "Outstanding $2,400 / 2 invoices", but the 2 invoices total $2,700 (the $2,400 nets in a 3rd party's *unapplied* credit). All surfaces agree on $2,400 — but by sharing the same assumption (CLAUDE.md Rule 6). Decide whether unapplied credits should hit Revenue/Outstanding pre-application.
  - **Status — the $2,400 and the September −$300 are correct; the caption is fixed (LA6, `98f4cec`).** An issued credit
    note reduces revenue and what the customer owes when it is issued, whether or not it has been applied to a specific
    invoice yet — QuickBooks and Xero treat a credit memo the same way. What misled was the caption: the Invoices card
    and the dashboard now read e.g. "2 invoices · $2,700 less $300 in credit notes". No figure changes.

---

## 🟡 MINOR / POLISH

- Dashboard shows no COGS line, so its Revenue/Expenses/Net-Profit cards don't visibly reconcile without opening the P&L (COGS $390 is folded into gross profit). Math is correct.
  **✅ LA13 `f0a7491`** — Net Profit now reads "after $390 cost of goods sold" (server figure, same period; hidden under a display currency).
- "VAT Return" report tile always returns "VAT/GST is not tracked" — correct behavior (estimates-only scope), but odd to surface a tile that can never produce output.
  **✅ LA9 `a99215f`** — removed from the Reports menu.
- Expenses "89% of expenses deductible" actually means 89% of the *business* portion ($1,740 / $1,955), not of total — ambiguous label.
  **✅ LA8 `9cc150a`** — now "89% of expense entries".
- "Business" expenses = 65% of total; the entire "Bills & vendors" ($1,050) category is excluded from "Business" — confirm that classification is intended.
  **✅ LA8 `9cc150a`** — that card was never a business/personal split; it is the recorded expense entries (bills and payroll are in the total, not in it). Now labelled "Expense entries", captioned "Excl. bills & payroll · 65% of total".
- Every in-app navigation to `/app` triggers a full SPA reload ("Loading your workspace…") — heavy; also what exposes B1's render race.
  **⚪ Not reproduced (LA11)** — no link in the app goes to `/app`; the sidebar switches pages without reloading. Full reloads happen only on login, logout, account switch and the logged-out pricing link. A browser tool navigating to `/app` reloads by definition. If a specific click reloads the page, please note which.
- A negative-revenue month (Sep −$300) is driven by the credit note — correct, but confirm it reads as intended on statements.
  **⚪ Not a defect (LA12)** — the credit note is recognised in its own month (see M3).

---

## ✅ VERIFIED CORRECT

- **P&L reconciles end to end:** Revenue 15,400 − COGS 390 (FIFO) = Gross 15,010 − Expenses 3,005 = **Net 12,005**; monthly rows each reconcile. Net profit agrees across Dashboard, Reports NET RESULT, Money-flow and P&L.
- **AR reconciles:** Bright 1,500 + Delta 1,200 + Acme −300 = **$2,400**; Overdue 1,200 (Delta). Matches dashboard Outstanding.
- **Revenue basis = accrual / issue-based** (15,400 = 15,700 billed − 300 credit note), per Rule 11.
- **Expense/AP basis = accrual** and *consistent* with revenue (unpaid test bill $444 booked immediately); "Stock"-tagged bills correctly capitalize to inventory instead of expensing.
- **Revenue flow test PASS:** test invoice $7,777 propagated correctly to Invoices, Dashboard, Money-flow, transactions, chart. Single write, no double-fire.
- **Expense flow test PASS:** test expense $888 propagated to Expenses page, Dashboard, breakdown, Money-flow. Single write, no double-fire.
- **AP flow test PASS:** test bill $444 propagated correctly. Single write.
- **Payroll basis-C correct (business side):** roster ($8,000) and voided runs produce $0 booked expense; a Paid run books the gross from the run lines; void reverses.
- **Personal→Business wall: clean.** Personal has its own bank feed ("separate from every business"), its own investment holding ($3.4K — *not* the business MSFT $2.7K), its own multi-currency + all-countries bank selector; no personal data appears on any business surface, and no business revenue/holdings appear in Personal.
- **Multi-entity / multi-currency works:** Northwind Studio (USD) and Island Traders (TTD) each book in their own currency; TTD entity renders `TT$` formatting throughout and its books reconcile (Rev TT$8,000 − Exp TT$1,250 = Net TT$6,750).
- **Tax = estimates-only** honored (Personal + Reports carry the "FinFlow performs no tax calculation" disclaimer; no VAT engine).
- Mutating actions created exactly one row each (no B8-class double-fire on invoice/expense/bill creation).

---

## NOT YET EXERCISED (pending, for a complete sweep)

*Still pending as of 2026-10-14 — none of the fixes above covered these areas. The next live check should include them.*
Time Tracking · Budget · MRR/SaaS · Banking / Bank Rec · Quotes · Sales Receipts · Payments (Received/Made) · Classes · Scheduled Documents · Reminders · Accountant portal · Documents/Templates · Audit trail · Exports (PDF/CSV/XLSX) · deep FIFO layer-ordering (needs VERIFICATION.md harness) · Island Traders data-entry flow.

---

## TEST DATA LEFT IN THE ACCOUNT (delete when ready)

*Still in the live account as of 2026-10-14 — removing it is the owner's call (data changes are owner-gated).*
1. Invoice — **AUDIT TEST ZZ**, $7,777, pending (Money In → Invoices)
2. Expense — **AUDIT TEST EXP**, $888, Rent, Oct 11 (Money Out → Expenses)
3. Bill — **AUDIT TEST VENDOR**, $444, unpaid, BILL-2399 (Money Out → Bills)
4. Payroll — Oct 2026 run created then **voided** (self-reversed; no cleanup needed, but it remains in history as Voided)

Active entity was left on **Island Traders**; switch back to Northwind Studio if needed.
