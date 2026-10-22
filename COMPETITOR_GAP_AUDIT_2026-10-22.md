# FinFlow vs competitors: feature gap audit

**Date:** 2026-10-22
**Method:** a read-only walk of every tab on production (`finflow-production-dab2.up.railway.app`, test account `luxurythebrand01+cowork1`, entity Northwind Studio). Nothing was created, edited or deleted.
**Compared against:** QuickBooks Online (QBO), Xero, Zoho Books, FreshBooks and Wave. Harvest is used as the comparison for time tracking. The baseline is the features those products ship as standard, from working knowledge of them; it was not re-researched today.

**Legend**

| Mark | Meaning |
|---|---|
| ✅ | On par |
| 🟡 | Partial |
| ❌ | Missing |
| ⭐ | FinFlow is ahead |

Priorities run from **P1** (expected by any paying customer, so blocks a serious launch) to **P3** (nice to have).

---

## 0. Verify first: possible money issue found during the walk

| # | What was seen | Why it matters |
|---|---|---|
| V1 | The Nov 2026 payroll run is marked **paid** (gross $8,000, net $6,700, paid Oct 14). The Chart of Accounts shows **Payroll Liabilities −$6,700**, a negative liability. **Payroll Expense is $0**, and `/api/gl/pnl` returns 6100 = 0. The AI page says "Payroll-to-revenue: 0%". | Probable cause: the run's *period* is November, which is after today, so D2 excludes the expense, but the cash payment made Oct 14 still hits the balance sheet. The balance sheet ties out only because of the negative liability. **Proposed rule:** expense recognition and payment should follow the same date rule, or paying a future-period run should be blocked or warned. This needs a harness, not a narrative. |
| V2 | Banking shows **Total balance $0 "across all accounts"** while a Plaid account is linked and synced. | A linked bank should show its balance. This is likely the same family as LR16. |

---

## 1. Time tracking (Timesheet + Projects)

This is the weakest area. Time is recorded, but it never turns into money.

| Capability | Competitors | FinFlow |
|---|---|---|
| Invoice from billable time | All (QBO, Xero, FreshBooks, Zoho, Harvest) | ❌ The "billable value" figure goes nowhere **(P1)** |
| Billed/unbilled status, no double billing | All | ❌ **(P1)** |
| Edit an entry | All | ❌ Delete only (LR10) **(P1)** |
| Description or notes per entry | All | ❌ **(P1)** |
| Employee picked from Team or Payroll | All | ❌ Free text **(P1)** |
| Default rate per project, person or task | All | ❌ Rate is typed every time **(P2)** |
| Start/stop timer | All | ❌ **(P2)** |
| Weekly timesheet grid | All | ❌ Flat list **(P2)** |
| Period navigation (previous/next month, custom range) | All | ❌ Fixed to the current month **(P2)** |
| Client and task on each entry | All | ❌ Project only **(P2)** |
| Submit and approve | QBO Time, Zoho, Harvest | ❌ **(P3)** |
| Time reports by client, project or person | All | ❌ No time report in Reports **(P2)** |
| Projects: client, edit, status change | All | 🟡 Client shows "—"; no edit; no status control **(P2)** |
| Project profitability (revenue − labour − expenses) | QBO, Xero, Zoho | ❌ Only a "billable value vs budget" figure **(P2)** |
| Expenses assigned to a project | QBO, Xero, Zoho, FreshBooks | ❌ **(P2)** |
| "Avg per day" metric | n/a | 🟡 Divides by the number of days that have entries, so it misleads **(P3)** |

---

## 2. Sales (Invoices, Customers, Quotes, Receipts, Payments, Credits, Recurring)

| Capability | Competitors | FinFlow |
|---|---|---|
| Invoice number shown in the list | All | ❌ The list shows client only; Payments Received shows "Invoice # —" **(P1)** |
| Edit an invoice | All | ❌ View / Record Payment / Pay link / delete only **(P1, verify)** |
| Due date and payment terms (Net 15/30, etc.) | All | 🟡 Most invoices show "TBD" and Review flags "Missing due date" **(P1)** |
| Search, filter and sort lists (status, date, customer) | All | ❌ On every list page **(P1)** |
| Email an invoice from the app, with sent/viewed tracking | All | ❌ No Send action; pay link only **(P1)** |
| Customers saved automatically from invoices | All (customer chosen first) | ❌ 7 of 7 customers say "not saved as a customer yet" **(P1)** |
| Customer statement and per-customer balance | All | ❌ Revenue column shows "—" **(P2)** |
| Convert a quote to an invoice, edit a quote | All | ❌ (LR9) **(P1)** |
| Quote expiry date | All | 🟡 Field exists but shows "—" **(P3)** |
| Apply a credit note to an invoice | All | 🟡 "Applied $0"; no apply action seen **(P2)** |
| Partial payments | All | ✅ |
| Online payment link | All | ✅ Stripe / WiPay / dLocal / MP ⭐ (regional coverage) |
| Recurring invoices | All | ✅ (none set up to test) |
| Late-payment reminders | All | ✅ Draft, review, then send ⭐ (no auto-spam) |
| Sales-receipt "Card sales: via Stripe" label | n/a | 🟡 Applies to a manual card receipt, so the label is wrong **(P3)** |
| Deposits/retainers, progress invoicing | QBO, Zoho, FreshBooks | ❌ **(P3)** |
| Customer portal | QBO, Zoho, FreshBooks | ❌ "Coming soon" **(P2)** |

---

## 3. Purchases (Expenses, Bills, Vendors, Payments Made, Vendor Credits, Recurring Bills)

| Capability | Competitors | FinFlow |
|---|---|---|
| Edit an expense | All | ✅ |
| Edit a bill | All | ❌ View / Pay / delete only **(P1, verify)** |
| Partial bill payment from the list | All | 🟡 "Pay" marks the bill fully paid; partial only via Payments Made **(P2)** |
| Bill due dates | All | 🟡 5 of 8 show "—" **(P2)** |
| Vendors saved automatically from bills | All | ❌ 8 of 8 say "not saved as a vendor yet" **(P1)** |
| Receipt OCR / AI scan | QBO, Xero (Hubdoc), Zoho, FreshBooks | ✅ ⭐ Claude-powered |
| Expense attached to a customer or project (rebillable) | QBO, Xero, Zoho, FreshBooks | ❌ **(P2)** |
| Mileage tracking | QBO, Xero, FreshBooks, Zoho | ❌ **(P3)** |
| Purchase orders | QBO (Plus), Xero, Zoho | ❌ **(P3)** |
| 1099 / contractor tracking | QBO, Xero (US), Zoho | ❌ Out of scope (tax filing) per owner |

---

## 4. Banking (Banking, Bank Rec, Auto-categorise)

| Capability | Competitors | FinFlow |
|---|---|---|
| Bank feed (Plaid) | All | ✅ |
| Statement import (CSV/OFX) | All | ✅ |
| Account balance shown | All | ❌ "$0 across all accounts" (V2) **(P1)** |
| Reconcile to a statement (opening/closing balance tie-out, reconciliation report) | All | ❌ Matching only; no statement balance step (LR16) **(P1)** |
| Smart match suggestions (amount, date, payee) | All | ❌ The bill dropdown offers $44 bills against a $5,850 debit **(P1)** |
| Manual bank line ("+ Add") | All | ❌ Toast-only stub (LR11, in the code queue) **(P1)** |
| Bank rules | All | ✅ Auto-categorise rules + AI ⭐ |
| Transfers between own accounts | All | ❌ "Transfer to savings" sits uncategorised **(P2)** |
| Split a transaction | All | ❌ **(P2)** |

---

## 5. Payroll

| Capability | Competitors | FinFlow |
|---|---|---|
| Run payroll, void, withholdings, remit | QBO Payroll, Xero (some regions), Gusto | ✅ (manual deductions) |
| Owner's salary flowing to Personal | none | ⭐ |
| Payslips/pay stubs to employees | All payroll products | ❌ **(P2)** |
| Automatic tax calculation | All payroll products | ❌ Manual by design (tax estimates only). State this on the page so users aren't surprised **(P3)** |
| Payroll expense in the P&L | All | ⚠️ See V1 |
| Timesheet hours feeding hourly pay | QBO, Gusto | ❌ **(P3)** |

---

## 6. Products (Inventory, Items)

| Capability | Competitors | FinFlow |
|---|---|---|
| FIFO stock and COGS | QBO Plus, Xero, Zoho | ✅ |
| Low-stock alerts | All | ✅ |
| Item sale price and margin | All | ❌ Price shows "—", avg margin "—" **(P2)** |
| Items used as invoice line items | All | 🟡 Not verified on this walk |
| Item status | n/a | 🟡 "Active 0" while one item exists **(P3)** |
| Services in the item catalogue | All | 🟡 Filter exists; none to test |

---

## 7. Accounting (Reports, Chart of Accounts, Journals, Locking, Classes, Budget)

| Capability | Competitors | FinFlow |
|---|---|---|
| P&L, balance sheet, cash flow, AR, AP | All | ✅ |
| Trial balance and general ledger report in the Reports menu | All | ❌ The GL endpoints exist (`/api/gl/*`) but the menu has no Trial Balance or GL Detail entry **(P1)** |
| AR/AP aging buckets (0–30/31–60/61–90/90+) | All | 🟡 Verify the AR report has buckets **(P2)** |
| Period comparison (this period vs last, month by month) | All | ❌ **(P2)** |
| Report export to PDF/Excel | All | 🟡 Verify **(P2)** |
| Custom chart of accounts (sub-accounts, many expense accounts) | All | 🟡 13 accounts; all operating expenses roll up into one 6000 line **(P1)**. Competitors break the P&L out by expense account. |
| Manual journals | All | ✅ |
| Lock date | All | ✅ Per entity ⭐ |
| Classes/locations | QBO Plus, Xero (tracking), Zoho | ✅ |
| Budget vs actual | QBO Plus, Xero, Zoho | 🟡 Annual by category only; no month-by-month grid **(P2)** |
| Year-end close / retained earnings roll | All | ❓ Retained earnings $0; check a year-end roll exists **(P2)** |
| Sales tax/VAT | All | Out of scope (owner ruling 2026-09-30) |

---

## 8. Multi-entity, FX, accountant, platform

| Capability | Competitors | FinFlow |
|---|---|---|
| Multiple businesses under one login, consolidated P&L | QBO/Xero charge per file; consolidation needs an add-on | ⭐ Native |
| Per-business accountant permissions (None/View/Filing) + personal | none | ⭐ |
| Accountant marketplace | QBO ProAdvisor, Xero Advisor directory | ✅ |
| "Find Advisor" tab | n/a | ❌ A second, "coming soon" duplicate of Find Accountant. Hide it **(P2)** |
| Multi-currency + daily rates + FX gain/loss | QBO Plus, Xero Established, Zoho | ✅ ⭐ (included, not up-tiered) |
| Audit trail, field-level | QBO (limited), Xero (history), Zoho | ⭐ Old → new values, security events |
| Role permissions | All | 🟡 Fixed 4 roles; "customization coming soon" **(P3)** |
| Read-only API + Google Sheets | Write APIs at all competitors | 🟡 Read-only **(P3)** |
| Scheduled documents (timezone + holiday aware) | none | ⭐ |
| Personal finance and investments in the same app | none | ⭐ (differentiator) |
| Client portal | QBO, Zoho, FreshBooks | ❌ "Coming soon". Hide it until built **(P2)** |
| Mobile app | All | 🟡 Responsive web/PWA only **(P3)** |

---

## Recommended order

**P1: fix before launch (customers will notice within the first week)**

1. **V1/V2:** verify and fix payroll-period expense recognition, and the bank balance showing $0.
2. **Sales basics:**
   - invoice number in lists
   - edit invoice
   - due date and payment terms
   - email invoice with sent status
   - customers saved automatically
3. **Purchases basics:** edit bill; vendors saved automatically.
4. **Search, filter and sort on every list.** One shared component, applied everywhere.
5. **Quotes:** edit and convert to invoice (LR9).
6. **Time to invoice:** invoice from unbilled time, billed status, edit entry, notes, employee chosen from Team (LR10 is part of this).
7. **Bank reconciliation:**
   - statement balance tie-out
   - reconciliation report
   - match suggestions by amount and date
   - manual bank line (LR11)
8. **Reports:**
   - Trial Balance and GL Detail in the menu
   - expense accounts broken out in the chart of accounts and P&L

**P2: first post-launch release**

- Timer, weekly grid, period navigation, time reports.
- Project profitability and expenses assigned to projects.
- Customer statements and credit-note apply.
- Transfers and split transactions.
- Payslips.
- Item prices and margin.
- Period-comparison reports and export.
- Monthly budget grid.
- Hide the "coming soon" tabs (Find Advisor, Client Portal).

**P3: later**

- Approvals, mileage, purchase orders, deposits and progress invoicing.
- Custom roles, write API, native mobile.

**What to lean on in marketing (genuinely ahead):** native multi-entity with consolidation, per-business accountant permissions, field-level audit trail, Caribbean/LatAm payment rails, FX included at every tier, scheduled documents aware of each business's timezone and holidays, and personal and business finance in one place.
