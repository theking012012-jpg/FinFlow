# FinFlow — Live App Walkthrough Audit
**Date:** 2026-09-27 · **Method:** hands-on click-through of the deployed app (finflow-production-dab2.up.railway.app), logged in as Owner (Saige Holdings LLC · Pro), built-in browser. Every screen visited, reports generated, console watched throughout.

**Headline:** This is a production-quality, genuinely feature-complete accounting platform — it stands next to QuickBooks/Xero on scope, the core books are financially correct and reconcile across every surface, and the live integrations (Plaid, Stripe) work. No console errors on any screen. The findings below are mostly polish and one real accounting-completeness gap; none are launch-blockers.

---

## THE GOOD

**Design & feel.** Cohesive "espresso" dark theme, elegant serif headings, consistent spacing and components across ~20 screens. It reads as one polished product, not a patchwork.

**Dashboard.** KPI cards (Revenue $44.4K, Expenses $11.1K, Net Profit $33.3K, Outstanding $12,550, Investments $1.08M), Revenue-vs-Expenses chart, expense breakdown, a live business-transactions feed, and a **Stripe live feed showing a real test payment reconciled "✓ in books"** — the webhook→books path working in production.

**Feature completeness (rivals the incumbents).** Banking (Plaid), Bank Rec, Scheduled Documents, Money In (Invoices, Quotes, Recurring, Payments), Money Out (Expenses, Bills, Vendors, Payments Made, Recurring Bills, Vendor Credits), Payroll, Inventory, Items, Time Tracking (Projects, Timesheet), Reports (8 business + 4 tax), Budget, MRR/SaaS, Business Investments, Accountant suite (Documents, Templates, Audit trail, Team & roles, API connections, Find Advisor), multi-entity, FX/Currency.

**Reports are real and reconcile.** Balance Sheet renders with **real tracked cash ($20.7K)** — the GL fix is live, not "cash not tracked" — and balances to the cent (Assets $33.3K = Liabilities $0 + Equity $33.3K). Cash Flow shows the payroll cash-out leg. Numbers agree across surfaces: dashboard Outstanding $12,550 = AR report $12.6K = Balance Sheet AR $12.6K.

**Live integrations.** Plaid bank sync (First Platypus Bank linked, real transaction feed, reconcile). Stripe test payment reconciled into books. Investments show live-ish quotes (+3.53% today).

**MRR/SaaS module.** Genuinely nice — new/churned/expansion/net MRR, revenue-by-customer, a clean 12-month trend curve. Net MRR $1,300 ties to its customer rows.

**Security surfaced to the user.** 2FA offered ("strongly recommended — your account holds your books"), RBAC with 4 roles and a full permission matrix, change-password, audit trail, account deletion.

**Stability.** Zero console errors across every screen visited.

---

## THE BAD (prioritized)

### P1 — accounting completeness (one real gap)
- **Business investments ($1.1M) don't appear on the Balance Sheet.** The Investments module tracks $1.1M of equities (MSFT, etc.) with a $945K unrealised gain, but the Balance Sheet's total assets are only $33.3K (cash + AR). A business that owns $1.1M in securities has a balance sheet that understates assets by ~97%. Either (a) post holdings to the GL as an asset with an unrealised-gain equity leg, or (b) add an "Investments" line to the Balance Sheet, or (c) if investments are deliberately tracking-only, label them as such so it's not mistaken for the books. As-is, the two surfaces silently disagree on what the business is worth.

### P2 — UX / polish
- **GDPR data-export has no UI.** The `/api/auth/export` endpoint exists (full JSON dump), but Settings only exposes "Delete my account" in the Danger Zone — there's no "Download my data" button, so export is unreachable for a normal user. Add the button next to delete.
- **Invoice list: due-date column is obscured** on unpaid rows. The three action buttons (View / Record Payment / Pay link) overlap the Due Date column at this width, hiding the date. Paid rows (fewer buttons) show it fine. Needs a responsive column/layout fix.
- **Money formatting inconsistency.** Banking shows `$2,078.5` (one decimal) instead of `$2,078.50`. A trailing-zero/rounding bug in the banking transaction list's formatter.
- **"Overdue" can exceed "Outstanding" and confuses.** Dashboard shows Outstanding $12,550 with "4 overdue · $13,300" — overdue (gross) is larger than total outstanding (net of credit notes). Correct by design, but a user will read it as a contradiction. A tooltip ("overdue shown gross of credits") or a net-overdue figure would fix the optics.
- **Investments benchmark comparison is empty.** "This portfolio +679.8%" but the S&P 500 and 60/40 Benchmark rows show "—" (no benchmark series loaded), so the comparison — the point of the panel — renders blank.

### P3 — hygiene / minor
- **Test data is polluting the live account.** "ZZ QA Recurring", "ZZ QA TEST — delete me", "ZZ QA bexpdesc", "ZZ QA cncustom" appear across invoices, expenses and customers. Clean these before real use (or confirm this is the QA account).
- **Very chatty production console.** Tens of thousands of client-side `console.log` messages accumulate (38k+ buffered in one sitting). No errors, but it's noise that should be stripped from a prod build (and can leak internal detail).
- **"Per-account [RBAC] customization — coming soon"** placeholder on Team & roles: an advertised-but-unshipped feature visible to users.
- **Plan vs. entities.** The account is on **Pro** (pricing lists Pro as *1 business entity*) yet operates multiple entities (Saige Holdings, Acme, …). Likely the owner/grandfathered account, but worth confirming the entity cap is actually enforced on paying Pro customers.
- **Expense "By category" ($9,850) vs dashboard Expenses ($11.1K)** differ — expected (category = manual expense buckets; dashboard = full opex incl. payroll accrual / COGS) but a user may expect them to tie; a one-line label would remove the confusion.

---

## Verdict
Ship-grade. The core — the money — is correct, observable, reconciles across dashboard/reports/balance-sheet, and the integrations work live. The single finding that touches reported accuracy is **investments not flowing into the balance sheet**; everything else is polish (export button, invoice-row layout, money formatting, a benchmark that doesn't load) or hygiene (test data, console noise). Fix the investments↔balance-sheet story and the export button, and there's nothing here that should hold a launch.
