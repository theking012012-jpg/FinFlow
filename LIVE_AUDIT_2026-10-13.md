# FinFlow — Live Launch-Readiness Audit

**Date:** 2026-10-13
**Target:** `https://finflow-production-dab2.up.railway.app` (dab2 production instance)
**Account:** "Northwind Studio" test account (owner: Sam Owner) + "Island Traders" (TTD) entity
**Method:** Browser automation (Chrome), read-only verification + owner-approved test-data entry & flow tracing.
**Scope note:** Live app can prove surface-consistency, wall integrity, flow propagation and errors. It does **not** replace `VERIFICATION.md` (owner-supplied expected values on seeded data). FIFO layer-ordering, in particular, needs the harness.

---

## VERDICT: NOT launch-ready yet — 2 blockers

The money engine is largely correct and reconciles across surfaces. Two defects are launch-blocking: a dashboard render race that shows **$0** for headline money figures at random, and the **owner-salary Business→Personal crossing does not fire**.

---

## 🔴 BLOCKERS

### B1 — Dashboard KPI cards render `$0` at random (render race)
**Severity: launch-blocking.** On normal, fully-loaded dashboard views, the headline cards — **Revenue, Expenses, Net Profit, Investments** — intermittently display **`$0`** instead of the real value. Non-deterministic: a *different* random subset fails on each load (observed Investments-only once; Revenue+Expenses+Net-Profit several times; all-correct sometimes).

- **Data is correct underneath** — the Money-flow block, Reports, expense breakdown and chart show the right numbers at the same instant the cards show `$0`. This is a **render bug, not a math bug**.
- **Mechanism:** `app-main.js` logs `Cannot set properties of null (setting 'textContent'/'innerHTML')` — "a deferred render hook threw (skipped, boot continues)". The KPI value hook runs before its target node exists → value never written → card stays at its initial `$0`, while the caption ("+$1,217 · +81%") renders from a separate element, giving the nonsensical "`$0` +81%".
- **Evidence:** 133 such console errors across ~8 reloads; error count per load varied (7/35/14/7/21…) tracking the failures. Reproduced on both USD and TTD entities (same bundle).
- **Caution (CLAUDE.md failure #1):** `app-main.js` is subject to dead-code shadowing. Find the runtime-winning copy of the KPI render hook before editing, or the fix diffs clean and does nothing.

### B2 — Owner-salary Business→Personal crossing does NOT fire on PAID
**Severity: launch-blocking** (core walled feature, non-functional). Ran a payroll (Oct 2026), approved it, marked it **Paid** — logged-in user **is** the owner (Sam Owner).

- **Business side correct:** on Paid, the dashboard booked a `Payroll $8,000` expense line (basis-C read the run gross); voiding reversed it.
- **Personal side broken:** after a **full reload**, Personal income was unchanged (~$3.4K: interest, refunds, freelance $1,800). **No Sam Owner / payroll salary income row** for October; no "salary/payroll" income source.
- The app's **own banner** promises *"It reaches Personal as income only when a payroll run is marked paid."* The run was paid; nothing reached Personal. Per CLAUDE.md this is *the one* legal crossing ("owner's salary as personal income on PAID; one row per owner line; removed on void") — it is not working on this deploy.
- **To check:** the paid run exposes a "Remit" step (withholdings $1,300). If the crossing is (incorrectly) gated behind Remit rather than Paid, that's still a spec violation. Void-removal of the personal row couldn't be tested because the row was never created.

---

## 🟠 MEDIUM

- **M1 — Customers CRM empty despite active billing.** Customers page shows **0 customers / $0 lifetime revenue** while invoices total $23,477 billed (Delta/Bright/Acme). Invoices store a **free-text** client name, not linked to CRM records → "Lifetime Revenue $0" is misleading at launch.
- **M2 — Inventory Value ≠ product value.** Inventory **Value card = $90** but the only SKU (Widget, 5 units) shows **$75** — a $15 mismatch on the headline inventory figure. Source of the $15 unverified (possible stray FIFO layer / in-transit stock from the "Stock"-tagged Widget Maker bill). Worth confirming.
- **M3 — Unapplied credit note hits Outstanding & Revenue.** Credit note CN-6629 (Acme −$300, status "Open — not yet applied") already reduces Revenue (Sep −$300 in P&L) and Outstanding AR. The Invoices card reads "Outstanding $2,400 / 2 invoices", but the 2 invoices total $2,700 (the $2,400 nets in a 3rd party's *unapplied* credit). All surfaces agree on $2,400 — but by sharing the same assumption (CLAUDE.md Rule 6). Decide whether unapplied credits should hit Revenue/Outstanding pre-application.

---

## 🟡 MINOR / POLISH

- Dashboard shows no COGS line, so its Revenue/Expenses/Net-Profit cards don't visibly reconcile without opening the P&L (COGS $390 is folded into gross profit). Math is correct.
- "VAT Return" report tile always returns "VAT/GST is not tracked" — correct behavior (estimates-only scope), but odd to surface a tile that can never produce output.
- Expenses "89% of expenses deductible" actually means 89% of the *business* portion ($1,740 / $1,955), not of total — ambiguous label.
- "Business" expenses = 65% of total; the entire "Bills & vendors" ($1,050) category is excluded from "Business" — confirm that classification is intended.
- Every in-app navigation to `/app` triggers a full SPA reload ("Loading your workspace…") — heavy; also what exposes B1's render race.
- A negative-revenue month (Sep −$300) is driven by the credit note — correct, but confirm it reads as intended on statements.

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
Time Tracking · Budget · MRR/SaaS · Banking / Bank Rec · Quotes · Sales Receipts · Payments (Received/Made) · Classes · Scheduled Documents · Reminders · Accountant portal · Documents/Templates · Audit trail · Exports (PDF/CSV/XLSX) · deep FIFO layer-ordering (needs VERIFICATION.md harness) · Island Traders data-entry flow.

---

## TEST DATA LEFT IN THE ACCOUNT (delete when ready)
1. Invoice — **AUDIT TEST ZZ**, $7,777, pending (Money In → Invoices)
2. Expense — **AUDIT TEST EXP**, $888, Rent, Oct 11 (Money Out → Expenses)
3. Bill — **AUDIT TEST VENDOR**, $444, unpaid, BILL-2399 (Money Out → Bills)
4. Payroll — Oct 2026 run created then **voided** (self-reversed; no cleanup needed, but it remains in history as Voided)

Active entity was left on **Island Traders**; switch back to Northwind Studio if needed.
