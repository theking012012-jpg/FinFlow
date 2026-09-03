# FinFlow — Live Visual Audit (2026-09-02)

> ## ✅ RESOLVED 2026-09-02 — ALL findings fixed + verified
> Every substantive finding below was fixed the same day, each with a discriminating harness (red→green)
> and a green canary sweep (step3 money gate 56/0, f88-parity 49/0, recurring-scheduler 31/0, f126 10/0,
> f129 7/0, d2 6/0, cashflow/AR/AP 12/0, sales-payroll 9/0). New harnesses:
> verify-fc1-overdue-date (9/0), verify-fh1-payroll-in-opex (13/0, also covers F-D1), verify-fe1-personal-daychange (5/0),
> verify-fa1-dashboard-expense-label (6/0), verify-fe2-biz-allocation (5/0), verify-fk1-inventory-cogs (6/0),
> verify-fg1-budget-usage (6/0), verify-ff1-mrr-by-customer (7/0), verify-fl1-scheduler-audit (6/0), verify-polish-batch (10/0).
> **HIGH:** F-C1 overdue (server.js:4411 date-based) · F-H1 payroll→opex (period-parse fix in finflow-dates.payrollPeriodYmd).
> **MEDIUM:** F-E1, F-A1, F-E2, F-K1, F-G1, F-F1/F2, F-L1 — all fixed. **POLISH:** F-B1, F-B2, F-J2, F-L2, F-D1(via F-H1).
> **Deferred (low-value/needs product call):** F-B5 (this-month labels), F-B6 (date format), F-I1 (FX dedupe), F-I2 (rounding), F-J1 (bank-rec wording), F-M1 (advisors redirect is intentional).
> Details of each finding, as originally observed, remain below for reference.

---


**Scope:** Full page-by-page audit of production (https://finflow-production-dab2.up.railway.app/app), logged in as Owner, entity **Saige Holdings LLC (USD)**. HEAD `c3321c8`. ~46 pages checked visually + cross-checked against the data layer (`/api/reports`, `/api/invoices`, `/api/bills`, live holdings). Today pinned 2026-09-02.

**Bottom line:** The app is largely solid — every money list reconciles internally and across pages (Billed−Collected=Outstanding, Balance Sheet balances, P&L ties out), this session's fixes are confirmed live (investments stale-price, FX display conversion, F94 scheduled docs, F126 MRR/ARR). But the audit found **two HIGH-severity money bugs** and a cluster of medium display/logic bugs.

---

## HIGH — real, affects money figures

### 1. "Overdue" is always $0 — past-due unpaid invoices/bills never counted  (F-C1)
With today = 2026-09-02, three invoices are past due & unpaid — **sean $1,000** (due Aug 31), **Adobe $10,000** (due Aug 31), **saige $2,000** (due Jul 31) = **$13,000** — plus bill **ZZ QA rbvendor $250** (due Aug 31). Every surface (Dashboard, Invoices, Payments Received, Bills, Vendors) shows **Overdue $0.00 / 0 invoices**.

Root cause — `server.js:4411`:
```js
const overdue = (invoices||[]).filter(i => (i.status||'').toLowerCase() === 'overdue')...
```
Overdue is matched by a **literal `status === 'overdue'`**, but nothing transitions a `pending` invoice to `overdue` when its due date passes — so a past-due unpaid invoice stays `pending` forever and never counts. Bills side (~`server.js:5871`) has the same pattern. Note: "Outstanding/Payables" (status ≠ paid) works correctly — *only* the overdue aggregation is broken.

**Fix:** overdue = rows where status is unpaid-ish (pending/partial/unpaid/due_soon) **AND** due_date < entity-today (use `entityTodayYmd`, consistent with F88). Client OVERDUE KPIs mirror the same rule. Money surface → discriminating harness (red=$0 with a seeded past-due pending invoice; green=counts it) + full sweep + own commit.

### 2. Payroll excluded from Expenses / Net Profit  (F-H1)
`/api/reports`: expenses **$4,100**, netProfit **$37,990**. The **$7,000 July payroll run (status paid)** is NOT in expenses (July monthly expense is only $2,600). Yet the P&L modal labels its figure "$4.1K · **incl. payroll** + COGS", and the AI Insights page independently reports "**Payroll-to-revenue: 0%**" (should be ~17%).

So either (a) payroll should post to the P&L → **Net Profit is overstated by ~$7K (18% of the $38K shown on every screen)**, or (b) the "incl. payroll" label is wrong. Needs an accounting-treatment decision, then a calc fix or label fix. Money surface → harness + own commit.

---

## MEDIUM — visibly wrong numbers / broken sections

- **F-E1 · Personal Investments Day's Change = -$158.1K (-151.4%)** on a $104.4K portfolio — a daily loss bigger than the whole portfolio. Correct value from the data (dayChgPx -3.92 × 210 shares) is **-$823 (-0.79%)**. Business investments compute the same field correctly, so the bug is in the personal day-change path (~192× too large).
- **F-A1 · Dashboard expense breakdown mislabels categories.** Server returns `{category:"Rent", $2,850}`; other widgets show "Rent" correctly, but the dashboard widget renders it under a hardcoded **"Salaries"** slot (binds by position, not category name) and leaves Rent/Software/Marketing blank.
- **F-E2 · Business Investments asset allocation all $0** (Equities/Fixed income/Real estate/Cash) despite $1.0M portfolio — holdings not classified. (Personal donut populates fine.)
- **F-K1 · Inventory COGS contradiction.** KPI "COGS this month **$3,500 · MAC**" vs COGS Summary "**$0 · FIFO**" vs reports cogs=0 (P&L shows 100% gross margin). The $3,500 equals Inventory Value — the KPI appears to show inventory value as COGS; method label also disagrees.
- **F-G1 · Budget "570% over budget" is misleading.** SPENT $2,850 counts ALL expenses (the Rent) against the one budgeted category (Marketing $500) whose actual is $0 / VAR +$500 (under budget). Headline says over-budget while the only budgeted line is under.
- **F-F1 · MRR "Revenue by customer" stuck on "Loading…"** — `#mrr-by-customer` is written by no code (never wired). Pre-existing, not F126.
- **F-F2 · MRR churn / active-customers / New-Churned-Expansion-Net breakdown** all "—" placeholders (only MRR/ARR + 12-mo trend are real).
- **F-L1 · Audit trail misses scheduler-generated rows** (last audited invoice id=16 / Aug 4, but recurring auto-gen invoice id=20 exists from Aug 31, unaudited).

---

## LOW / polish
- F-B1 recurring pages "Next Run" card subtitle wrongly reads "No profiles yet" while showing profiles.
- F-B2 Payments Received shows raw enum methods ("bank_transfer", "other") vs formatted "Card (Stripe)".
- F-B3 payments not linked to invoices (Invoice # = "—"; Avg-days-to-pay "No data yet").
- F-B4 Customers directory Revenue/Status columns blank despite KPIs.
- F-B5 "This month" subtitle inaccurate on several TOTAL cards (data is Jul/Aug) — systemic.
- F-B6 date formats inconsistent ("Aug 29 2026" vs ISO "2026-09-15").
- F-D1 P&L modal chart shows a spurious "Jul '01" bucket (server monthly data is clean).
- F-I1 three duplicate USD→TTD 6.79 FX rate rows. F-I2 header shows "6.80" vs stored 6.79.
- F-J1 Bank Rec "All bank transactions matched" wording with 0 pairs. F-J2 Scenario "Cash runway 0 mo" while profitable (untracked cash).
- F-L2 Connections counts: "755+" vs 734; "Live 4" vs "9 live". F-M1 "Find Advisor" nav opens the Find Accountant page.
- Console 401 flood on boot is cosmetic (live fetches return 200).
- Test data ("ZZ QA …", 3× MSFT holdings) still present — owner cleanup.

---

## POSITIVE — verified working
Investments stale-price fix (both business & personal show "Live" immediately, no flash); FX display conversion (Personal→TTD: correct TT$ symbol + math at 6.80); F94 Scheduled Documents (entity tz/currency/US-holidays all correct, forecast reconciles); F126 MRR/ARR (native + display); Balance Sheet balances (Assets=Liab+Equity); P&L reconciles; multi-entity/multi-currency (4 entities); every money list total reconciles; Payroll/Reports/Quotes/Credit-notes/Vendor-credits all consistent. **Overdue is the only broken money aggregation — outstanding/payables/collected are all correct.**
