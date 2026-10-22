# FinFlow: investigate the 2026-10-22 gap findings (READ ONLY), then write a plan

**Read first:** `CLAUDE.md` (binding), then `COMPETITOR_GAP_AUDIT_2026-10-22.md` (the full findings; the § numbers below refer to it).

## Hard rules

**READ ONLY.** In this task you must not:
- edit any tracked source file
- write to the production database
- run git write commands
- call a mutating route on production

**Code reading only.** A 3× harness sweep is running on this machine. Do NOT:
- run any harness or test
- start any Postgres (embedded or scratch)
- run `npm install`
- start the server
- run any process that binds a port or competes for CPU

Read files, use grep, and use `git log`/`git show`/`git blame`. Nothing else.

Your only deliverable file is `PLAN_GAP_FIXES_2026-10-22.md` in the repo root. Do not commit it; the owner will.

**Evidence rule:** a narrative is not a verification. For each finding, state:
- **Confirmed:** proven by tracing the code path end to end, with file:line for each step. Write the harness that *would* go RED into the plan as a design; do not run it.
- **Not a bug:** you found the code that already does it, with file:line and why the live walk missed it.
- **Unclear:** say what would settle it.

## What to investigate

### A. Possible money bugs (do these first, in depth)

**V1. Payroll missing from the P&L.**
- Live state: the Nov 2026 run is marked **paid** (gross $8,000, net $6,700, paid 2026-10-14). The P&L (`/api/gl/pnl` and computeBooks) shows Payroll Expense 6100 = $0, and the Chart of Accounts shows Payroll Liabilities 2200 = **−$6,700**.
- Find out exactly which date each side uses: the expense/accrual side (period? run date?) and the payment/cash side (paid date?). Find where D2 (nothing after today counts) is applied to each.
- Answer three questions:
  1. Is a negative payroll liability ever valid?
  2. Do computeBooks and the GL agree?
  3. Which `VERIFICATION.md` checks cover payroll timing, and why didn't they catch this?
- Trace it through the code and design the harness that would go RED. Do not run it.
- Propose the correct rule (for example: recognise expense on the pay date, or block/warn on paying a future-period run). List every figure the rule changes: dashboard, P&L, balance sheet, AI page, Personal income.

**V2. Banking shows "Total balance $0" with a Plaid account linked and synced.**
- Trace where the total comes from and whether Plaid balances are fetched or stored.
- Check whether this is the same root cause as LR16 (Bank Rec balances).

### B. P1 gaps: for each, find out what exists today

For each item, give:
- **Exists?** Server route, client UI, DB columns, with file:line.
- **Why it looks missing:** not built, built but not wired, wired but hidden, or a data issue.
- **Proposed fix and size:** S (<½ day), M (1–2 days) or L (3+ days).
- **Risk:** does it touch money, the GL, entity isolation or audit?
- **Harness plan:** what the RED test asserts.

Items:
1. **Invoices:**
   - Edit invoice. Note especially that editing after a payment or posting must reverse and re-post in the GL.
   - Invoice number in the list and on Payments Received ("Invoice # —").
   - Due dates showing "TBD", and payment terms.
   - Email invoice with sent/viewed status. Resend is a dependency: what works with the sandbox sender?
2. **Customers and vendors not saved from invoices and bills** (7/7 and 8/8 say "not saved"). Should creating an invoice or bill upsert the contact? Check how existing free-text names would be migrated, and treat that as Rule 8 data, owner-run.
3. **Search, filter and sort on list pages.** Inventory every list page and propose one shared component.
4. **Bill edit;** "Pay" marking a bill fully paid versus partial payment.
5. **Quotes:** edit and convert to invoice (LR9).
6. **Time to invoice:**
   - invoice from unbilled time, with billed/unbilled status and no double billing
   - edit an entry (LR10)
   - notes field
   - employee chosen from Team/Payroll instead of free text
   - default rate taken from the project
7. **Bank reconciliation:**
   - statement opening/closing balance tie-out
   - reconciliation report
   - match suggestions ranked by amount, date and payee (today it offers $44 bills for a $5,850 debit)
   - manual bank line (LR11)
8. **Reports:**
   - Trial Balance and GL Detail in the Reports menu (the `/api/gl/*` endpoints already exist)
   - Breaking operating expenses out by account in the CoA and P&L. Today everything rolls into 6000. How do expense categories map to accounts today?
   - This interacts with the GL Phase 4/5 (backfill/flip) decision. Say how.

### C. Quick checks (one line each)

From audit §2–§8:
- Credit-note apply action
- AR aging buckets
- Report export to PDF/Excel
- Retained earnings year-end roll
- Item sale price and margin showing "—"
- Items "Active 0"
- "Card sales via Stripe" label on manual receipts
- "Avg per day" metric on the Timesheet
- The duplicate "Find Advisor" coming-soon tab
- Client Portal coming-soon tab

## Plan format (`PLAN_GAP_FIXES_2026-10-22.md`)

1. **Findings table:** item → Confirmed / Not a bug / Unclear → evidence (file:line) → root cause.
2. **Money section first** (V1, V2): the proposed rule, the affected figures, and the harness design. Mark any **owner decision** needed.
3. **Build plan:**
   - Ordered batches, each one commit-sized, with: files touched, size, risk, harness (RED → GREEN), and the related harnesses to re-run.
   - Group shared work. For example, one list component covers search on every page; contact upsert covers both customers and vendors.
   - Order by: money correctness → things a paying customer hits in week 1 → the rest.
4. **Owner decisions:** a list of choices, each with a recommendation. Examples:
   - Payroll recognition rule.
   - Whether editing a paid invoice is allowed.
   - Contact upsert for existing data.
   - Whether to hide "coming soon" tabs.
5. **Out of scope:** tax filing, VAT/GST engine.
6. **UNEXECUTED:** everything is proven by code reading only. List which findings most need an executed harness once the sweep is done, starting with V1.

Stop after writing the plan. Build nothing.
