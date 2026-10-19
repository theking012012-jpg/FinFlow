# FinFlow — post-deploy live check RESULTS

**Run:** 2026-10-19, 08:32–17:47 America/New_York · **App:** finflow-production-dab2 (live, post-merge to main)
**Account:** Sam Owner · **Northwind Studio** (USD, default) + **Island Traders** (TTD)
**Method:** Chrome automation, observe-only for A, data-entry flows for B/C, every money figure cross-checked against the app's own APIs (`/api/reports`, `/api/invoices`, `/api/reports/ar-by-customer`, `/api/personal-transactions`, `/api/payroll-runs`) and, where a figure looked wrong, against the server code.

---

## FINAL SUMMARY

- **Part A (A0–A11): 11 PASS, 0 FAIL.** A2 observe-parts passed; its TTD reporting-currency *switch* is BLOCKED by the auto-mode "Modify Shared Resources" safety classifier (needs owner).
- **Part B (B1–B11): 11 PASS, 0 FAIL.** Both launch blockers from 13 Oct are fixed (B1 render race, B2 owner-salary crossing). One finding (F-LC1).
- **Part C (C1–C15): 12 PASS, 1 FAIL (C6), 1 BLOCKED (C14).** C11 templates pass / upload skipped (automation limit).
- **Red console errors across the whole session: 0.** **Full page reloads from in-app nav: none** (document stayed alive ~8.8h; business switch is an overlay, not a doc reload) — the 13-Oct "every nav reloads" issue is fixed.

### FAILs / things to fix (worst first)
1. **C6 — Time tracking not linked to Projects.** Logging 1.5h against "ZZ-LIVECHECK project" shows in the Timesheet + Billable-Hours KPI, but the project stays "0h logged / $0 billed" (API `project.hours=0`). The timesheet stores `project` as free text, no `project_id`. Per-project time/billing rollup is broken. (F-LC2)

### Findings to decide on (not hard fails)
- **F-LC1** — "Full year total" Expenses (dashboard) and Reports "Year" P&L are year-to-**date** (Jan–Oct, 10 rows). Two PAID payroll runs in future periods (Nov $8,000, Dec $8,000 during testing) contribute $0 to the Year figure (`payroll:0`). Arguably correct period-explicit booking (F85), but the "Full year total" label says otherwise. So "marking payroll paid raises expenses" is NOT visible in the Year view for a future-period run.
- **F-LC3** — Audit trail doesn't cover Quotes, Projects, Time-tracking or Budget (no categories; those create/edit leave no audit row).
- **F-LC4** — Invoices list overflows horizontally at phone width (~390px): row action buttons don't wrap → h-scroll clips the left edge (client/amount). Dashboard/Expenses/Personal are clean on mobile.
- Minor: Record-Payment modal showed a stale "Amount exceeds the remaining balance" warning for a valid $40 on a $100 invoice (didn't block the save).

### BLOCKED / SKIPPED
- **A2 (TTD reporting-currency switch)** — BLOCKED by auto safety classifier. The feature is live and correct (field present, default = "Your first business's currency (USD)", API `reporting_currency:null`/effective USD); only the act of switching is blocked. You can run it, or switch the task to automatic approval.
- **C11 Documents upload** — SKIPPED: upload is offered and the page renders, but completing it needs the native OS file picker (not automatable) + a file on the Chrome host; the hidden input can't be driven without breaking the app's binding.
- **C14 Accountant portal** — BLOCKED: no accountant login credentials available.

---

## PART A | # | Check | Result |
- A0 reporting-currency feature deployed — **PASS** (API `reporting_currency:null`/effective USD; Entities "Report in:" US/GB/EU/TT/More…)
- A1 no $0 cards, no boot errors, P&L match — **PASS** (2 hard reloads, 0 `deferred render hook`/`Cannot set properties of null`; Rev $23,177 / Exp $4,337 / Net $18,450 match dashboard + P&L)
- A2 reporting currency default + switch — **PASS (observe) / BLOCKED (switch)**
- A3 payroll runs `jurisdiction:null` — **PASS** (all 3 runs null, none "TT")
- A4 owner flag on Sam — **PASS** (flagged via Type="Owner/Director"; "Across all entities→Personal $4,000/mo"; note: a Type dropdown, not a checkbox in the edit form)
- A5 customers/vendors from docs + "Not saved" — **PASS** (fixes 13-Oct M1)
- A6 inventory rows add to value card — **PASS** ($90=$90; fixes 13-Oct M2)
- A7 Outstanding names credit notes — **PASS** ("$10,477 less $300 in credit notes"; fixes M3)
- A8 labels (Expense entries / no VAT tile / Payroll by person / COGS caption) — **PASS**
- A9 one product list ("Stock item") — **PASS**
- A10 each business own currency — **PASS** (Island Traders TT$ on Dashboard, Chart of Accounts, invoice preview TT$11,813)
- A11 accountant signup pricing currency — **PASS** (Trinidad&Tobago → TTD, rate fields TT$; not submitted)

## PART B
- B1 P&L reconciles end-to-end — **PASS** (every month row reconciles; Net $18,450 identical across Dashboard/Reports/P&L)
- B2 receivables reconcile — **PASS** (AR-by-customer = Dashboard = Invoices = $10,177; overdue $1,200 = Bright Labs $1,500 past-due net $300 credit)
- B3 revenue basis (accrual/issue) — **PASS** ($23,477 issued − $300 credit = $23,177)
- B4 expense basis / Stock→Inventory — **PASS** (unpaid $444 expensed; Widget Maker $180 "Stock" → inventory)
- B5 flow tests write exactly once — **PASS** (invoice $777, expense $88, bill $44 — one row + correct deltas each)
- B6 payroll + owner salary (old B2) — **PASS** (Dec run paid → Personal "Owner salary …(December 2026)" $4,000; void removes it; Nov left paid). Finding F-LC1 on expense window.
- B7 personal/business wall — **PASS** (only owner-salary crosses; nothing personal on business)
- B8 Island Traders TTD reconciles — **PASS** (TT$8,000 − TT$1,250 = TT$6,750)
- B9 tax estimates only — **PASS** (disclaimers present, no VAT/GST)
- B10 13-Oct findings re-checked — **PASS** (all resolved; no full reloads)
- B11 console across B — **PASS** (0 errors)

## PART C
- C1 Quotes — **PASS** (quote $100, Revenue unchanged; convert-to-invoice not offered)
- C2 Sales receipts — **PASS** ($50 → Revenue +$50, Outstanding unchanged)
- C3 Payments received — **PASS** ($40 → Outstanding −$40, invoice partial/$60 left, listed once; minor stale warning)
- C4 Payments made — **PASS** ($30 → payables −$30, bill paid, listed once)
- C5 Classes — **PASS** (class shows $20 cost)
- C6 Time tracking — **FAIL** (timesheet 1.5h ✓ but project shows 0h logged — F-LC2)
- C7 Budget — **PASS** (Rent actual $2,496 incl. C5 $20; actual+remaining=budget)
- C8 MRR/SaaS — **PASS** (MRR $0 = Σ active monthly recurring $0)
- C9 Scheduled Documents — **PASS** (0 scheduled, matches 0 recurring)
- C10 Reminders — **PASS** (Bright Labs $1,500 overdue; draft read; not sent)
- C11 Documents & Templates — **PASS (templates) / SKIPPED (upload)**
- C12 Audit trail — **PASS** (accurate for covered entities; quotes/projects/time/budget unaudited — F-LC3)
- C13 Bank Rec — **PASS** (50 unmatched bank / 2 unmatched payments / 1 matched; consistent; no single statement-vs-book figure)
- C14 Accountant portal — **BLOCKED** (no accountant login)
- C15 every page + phone width — **PASS** (all opened pages clean, 0 console errors; phone Dashboard/Expenses/Personal clean; Invoices h-scroll — F-LC4)

---

## ZZ-LIVECHECK records created (for owner cleanup)
1. Invoice "ZZ-LIVECHECK flow" $777 pending (id 6)
2. Expense "ZZ-LIVECHECK flow" $88 Rent (id 9)
3. Bill "ZZ-LIVECHECK flow" $44 unpaid, BILL-4614 (id 5)
4. Payroll Dec 2026 run — created→approved→paid→**VOIDED** (self-reversed; remains in history as Voided)
5. Quote "ZZ-LIVECHECK quote" $100, QT-6163
6. Sales receipt "ZZ-LIVECHECK receipt" $50, SR-0093
7. Invoice "ZZ-LIVECHECK invoice" $100 partial ($40 paid/$60 left) (id 7)
8. Payment received $40 on invoice 7
9. Bill "ZZ-LIVECHECK bill" $30 PAID, BILL-1111 (id 6)
10. Payment made $30, PM-1861
11. Expense "ZZ-LIVECHECK expense" $20, class "ZZ-LIVECHECK class" (id 10)
12. Class "ZZ-LIVECHECK class" (via expense tag)
13. Project "ZZ-LIVECHECK project" budget $500 (id 1)
14. Time entry 1.5h on "ZZ-LIVECHECK project" (id 1)
15. Budget target: Rent $5,000/mo (config)

## Console errors / full reloads
- **Red console errors: 0** across the entire session (A, B and C).
- **Full page reloads:** none from sidebar nav or period buttons (document alive ~8.8h, `performance.now()` never reset). Business switch shows "Loading your workspace…" overlay WITHOUT a document reload (by design). Only intentional reloads: the two Ctrl+Shift+R in A1, and one early URL navigation to `#settings`.
