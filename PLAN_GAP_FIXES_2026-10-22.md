# FinFlow: plan for the 2026-10-22 gap findings

**Source:** `COMPETITOR_GAP_AUDIT_2026-10-22.md` (live walk of production) and `PROMPT_GAP_INVESTIGATION.md`.
**Method:** code reading only (read, grep, `git log`/`show`/`blame`), on `main` at `726f915`. No harness ran, no
database or server started, and no tracked file was edited. **Everything below is UNEXECUTED** (see §6).
**Status:** not committed. The owner commits.

---

## 0. Read this first: production is behind `main`

The live walk was of **production, which still runs `9682467`** (Railway builds paused since 2026-10-21). Checked with
`git merge-base --is-ancestor`: the round-1 to round-4 commits (`80b0671`, `cb3d91d`, `adfefb1`, `e5a658b`,
`5b2879c`) are **not** in production. Several "missing" items in the audit are therefore **already fixed on `main`, just not
deployed**:

| Audit item | Fixed on `main` by | In production? |
|---|---|---|
| Quote edit + convert to invoice | LR9 (`adfefb1`) | ❌ |
| Time entry edit | LR10 (`adfefb1`) | ❌ |
| Banking "+ Add" manual line | LR11 (`80b0671`) | ❌ |
| Bank Rec statement vs book, signed difference | LR16 (`cb3d91d`) | ❌ |
| Banking "Total balance $0" now shows "—" | LR16 (`cb3d91d`). This only stops the fake $0; see V2 | ❌ |
| "Card sales via Stripe" on a manual receipt | LR20 (`80b0671`) | ❌ |
| "+ Add Account" stub | LR25 (`adfefb1`) | ❌ |

**Batch 0 (owner): deploy `main` once Railway is back.** It clears seven audit rows at no build cost.

---

## 1. Findings table

Legend: **Confirmed** = code path traced end to end · **Not a bug** = the code already does it · **On main** = fixed,
not deployed · **Not built** / **Built, not wired** = what exists today · **Unclear** = what would settle it.
New findings found during this investigation are numbered **G1–G12** (to be logged in `AUDIT_MASTER.md` on approval;
this task may not edit tracked files).

| # | Item | Verdict | Evidence (file:line) | Root cause |
|---|---|---|---|---|
| V1 | Payroll: P&L 6100 = 0, Payroll Liabilities −6,700 | **Confirmed: presentation and guard defect. Expense timing is accrual-correct.** | §2.1 | November wages paid in October are a prepayment, but the debit is shown as a negative liability; nothing warns when a future period is paid |
| V2 | Banking "Total balance $0" with Plaid linked | **Confirmed: not built** | §2.2 | Plaid balances are never fetched into storage; `bankAccounts` is never filled |
| B1a | Edit invoice | **Built, not wired** + server gap **G3** | `server.js:2210-2256`; no client `PUT` (only `finflow-api-wiring-medium.js:225` DELETE, `index.html:5394` pay link) | UI never built; the route does not re-derive status on an amount edit |
| B1b | Invoice number in lists / "Invoice # —" | **Confirmed: not built** | `finflow-api-wiring-pages.js:355` reads `inv.num`, which nothing writes; no number column; Settings "Invoice prefix" `index.html:4006` has no reader | No numbering exists |
| B1c | Due date "TBD", payment terms | **Confirmed** + **G1** | due optional (`finflow-api-wiring-medium.js:123,155` sends `null`) → "TBD" (`:128`); "Payment terms (days)" `index.html:4008` never read or saved; printed invoice hard-codes "Due within 30 days" (`app-main.js:6240`) | No terms model; Settings fields are decorative |
| B1d | Email invoice, sent/viewed | **Not built** (infrastructure exists) | Resend wrapper `server.js:44`; pattern to copy: `POST /api/payment-reminders/send` `server.js:4326-4378` (recipient resolved server-side, dedupe, audit, `last_reminder_at`); no `/send` route and no `sent_at`/`viewed_at` on invoices | Never built |
| B2 | Customers / vendors "not saved" | **Built partly** (one-click Save), no auto-upsert | invoices store free-text `client` (`index.html:4323`, `app-main.js:2675`); match by name `resolveCustomer` (`server.js:4345-4348`); unsaved lists `server.js:2439` / `:4173`; Save button `app-main.js:4797-4827`, vendors `finflow-api-wiring-pages.js:684-688` | No link from document to contact; no picker |
| B3 | Search / filter / sort | **Mostly not built** | exists: Customers `cust-search`, Items `finflow-api-wiring-medium.js:945-947`, Audit filters, Personal tx filters, marketplace; absent on 17+ list pages (see §3, batch 11) | Each page hand-rolled; no shared component |
| B4a | Edit bill | **Built, not wired** + **G3** | `server.js:4807-4872` (M34 guard, F135, GL resync `:4863`); no client caller | As B1a |
| B4b | "Pay" marks bill fully paid | **Not a bug** | `finflow-api-wiring-pages.js:994-1000` opens the payment form; `:1084-1092` prefills the **outstanding** amount, editable → partial works (M48 `ee7a623`, in production) | The walk read the prefilled full balance as "full payment only" |
| B5 | Quote edit / convert | **On main** (LR9) | `verify-lr9-quote-edit-convert` 7/0 | Not deployed |
| B6a | Invoice from unbilled time, billed status | **Not built** | timesheet row has no `invoice_id` / billed flag (`server.js:5560-5585`); LC1b (2026-10-20) was a *relabel*, not a "never build" ruling (`AUDIT_MASTER.md:81`) | Never built |
| B6b | Edit time entry | **On main** (LR10) | `verify-lr10-edit-time-entry` 6/0 | Not deployed |
| B6c | Notes per entry | **Not built** | `POST /api/timesheet` fields: employee, project, date, hours, billable, rate only (`server.js:5561`) | No column |
| B6d | Employee from Team / Payroll | **Not built** | `employee` is free text, required (`server.js:5562`) | No picker |
| B6e | Default rate from project | **Not built** | projects have name, client, budget, status (`server.js:3005-3017`); no rate | No column |
| B7a | Statement balance tie-out | **On main** (LR16) | modal `index.html:4187-4209`, `updateReconSummary` `app-main.js:981` | Not deployed |
| B7b | Reconciliation report | **Confirmed: not built** + **G2** | `finishReconciliation` `app-main.js:1008-1020` stores the result in a JS object ("in-memory only"), lost on reload; `bank_reconciliation` (`database.js:669-674`) holds match pairs only | Nothing persisted, so nothing to report |
| B7c | Match suggestions ($44 bill for a $5,850 debit) | **Confirmed** (**G4**) | `_bestBill` (`index.html`, C17 block in `loadBankRec`): amount match → vendor-name match → **`_bills[0]`**; C17 `2c4f7a2` is in production; `verify-c17-match-bill-default.js:18-19` never seeds a "no candidate" case (Rule 4 gap) | The fallback preselects an unrelated bill, so one click books a wrong match |
| B7d | Manual bank line | **On main** (LR11) | `verify-lr11-bank-manual-line` 16/0 | Not deployed |
| B8a | Trial Balance / GL Detail in Reports | **Built, not wired** | endpoints `server.js:12976-12981` (trial balance), `:13008-13026` (journal); `reportsData` `app-main.js:6027-6039` has no entry | Menu never extended |
| B8b | Expenses by account (all in 6000) | **Confirmed** | every expense-side posting uses `6000`: `server.js:2341, 4801, 4868, 5390, 5512, 10171`; backfill `:10951-11006` | Category never mapped to an account |
| C1 | Credit-note apply | **Not built** (status only) | statuses Open / Applied / Void `finflow-api-wiring-pages.js:575-591`; both Open and Applied count as contra (`server.js:11997`); no apply-to-invoice route | "Applied $0" = no note marked Applied |
| C2 | AR aging buckets | **Not built** | AR report = total + overdue tile only (`finflow-api-wiring-extra.js:885-940`) | — |
| C3 | Report export PDF/Excel | **Not a bug** (CSV + PDF exist) | `app-main.js:905-912`, C15 real PDF `:5559-5560`; no native `.xlsx` (CSV opens in Excel) | The walk did not open a report's export buttons |
| C4 | Retained earnings year-end roll | **Not built** (presentation) | equity = posted + all-time un-closed earnings (`server.js:11080`), shown as one synthetic line (`:12996-12999`) | No split of current year vs prior years |
| C5 | Item price / margin "—" | **Not a bug** (design) | the only item is a stock-only row (LA16, `finflow-api-wiring-medium.js:892-898`): inventory has cost, no sale price; margin needs a catalogue item with price and cost (`:933-938`) | — |
| C6 | Items "Active 0" | **Confirmed** (**G5**) | stock-only rows get status `'Low Stock'` when units < 10 (`:897`); Active counts `status === 'Active'` (`:931`) | Stock level conflated with status |
| C7 | "Card sales via Stripe" | **On main** (LR20) | — | Not deployed |
| C8 | Timesheet "Avg per day" | **Confirmed** | total ÷ distinct dates with entries, all people combined (`finflow-api-wiring-extra.js:153-154`), labelled "Across team" | Neither per person nor per working day |
| C9 | Duplicate "Find Advisor" tab | **Confirmed** | `app-main.js:7001-7010` injects a nav item + "coming soon" page; marketplace redirects `advisors` → `find-accountant` (`index.html:11124-11127`) | Two entries for one feature |
| C10 | Client Portal "coming soon" | **Confirmed** | nav `index.html:1334`; page `:9037` | Placeholder shipped in nav |

### New findings from this investigation (log on approval)

| # | Finding | Evidence |
|---|---|---|
| G1 | Settings fields nothing reads or saves: "Invoice prefix", "Payment terms (days)", "Default tax rate (%) = 12.5". The tax-rate field also implies a VAT engine the product does not have (out of scope) | `index.html:4006-4009`; grep finds no other reference |
| G2 | `finishReconciliation` (a) keeps the result in memory only, (b) still toasts the hard-coded "Main Checking ✓" (an LR16 residue: LR16 fixed the subtitle, not this toast), (c) prints a literal "$0.00" (LR22 literal-$ class) | `app-main.js:1008-1020` |
| G3 | `PUT /api/invoices/:id` and `PUT /api/bills/:id`: an amount edit neither re-derives status / amount_paid (`recalcInvoiceStatus` `server.js:9783`, `recalcBillStatus` `:9911` not called) nor refuses an amount below what is already paid. Latent (no caller), but must close **before** the edit UI ships | `server.js:2210-2256`, `:4807-4872` |
| G4 | C17 bill preselect falls back to the first open bill when nothing matches | `_bestBill` in `loadBankRec` (`index.html`) |
| G5 | Items "Active" excludes stock rows below 10 units | `finflow-api-wiring-medium.js:897, 931` |
| G6 | V1: a debit balance on 2200 is presented as a negative liability; nothing guards paying a run whose period has not started | §2.1 |
| G7 | V1: the payroll period is a free-text field. A typo that `payrollPeriodYmd` cannot parse silently falls back to `run_date` | `index.html:2051`; `finflow-dates.js:177-188` |
| G8 | Run Payroll defaults the period from the **viewer's** clock (`new Date()`), not the business's today (Rule 10). Near a month boundary the default names the wrong month for a business in another timezone | `index.html:7013` |
| G9 | The balance-sheet reconcile gate compares income, expenses, AR and AP but not cash or payroll liabilities, so V1 passed it | `server.js:11624-11634` |
| G10 | Doc drift: `GL_DESIGN.md:139-160` says GL Phase 4/5 are DONE in code; `LAUNCH_STATUS.md:143` lists them as "owner-gated decisions". Both are partly right: the code is built; **running** the backfill on production is the owner-gated step | as cited |
| G11 | Other "coming soon" surfaces beyond the two in the audit: portfolio "Rebalance ↗" toast (`index.html:2355`), role "customization coming soon" text (`index.html:1661`) | as cited |
| G12 | Invoice email: reminders require a saved customer with an e-mail (`server.js:4345-4348`), so B2 blocks B1d | as cited |

---

## 2. Money first

### 2.1 V1: payroll for a future period, paid early

**Trace (each step read in the code):**

1. The period is free text (`index.html:2051`), defaulted to the viewer's current month (`:7013`). "November 2026" was typed in.
2. `POST /api/payroll-runs` stores `period` and `run_date` (`server.js:10417-10423`).
3. **Approve** posts the accrual **Dr 6100 Payroll Expense / Cr 2200 Payroll Liabilities**, dated
   `payrollPeriodYmd(period, run_date)` (`server.js:10495-10503`). For "November 2026" that is **2026-11-01**
   (`finflow-dates.js:177-186`).
4. **Mark paid** stamps `paid_date` = the business's today, which was 2026-10-14 in the walk (`server.js:10579`). It posts
   **Dr 2200 / Cr 1000 Cash** for the cash paid (net basis → 6,700), dated `paid_date` (`server.js:10603-10610`).
5. **GL reads** (`glFinancials`, `server.js:11037-11043`) apply D2 (`entry_date <= today`) to both the all-time and the
   period columns. Today (2026-10-22) the 11-01 accrual is excluded and the 10-14 payment is included.
   Result: 6100 = 0; 2200 = debit 6,700 → presented (credit-natural) as **−6,700**; 1000 down 6,700.
   That is exactly what the walk saw.
6. **computeBooks** recognises run lines on the same date (`server.js:12077-12088`) with the same D2 (`:11821-11823`),
   so it also shows payroll 0.
7. **Balance sheet**: the GL is served when the gate passes (`server.js:11624-11653`). The gate does not check 2200 or cash
   (G9), so it passes. `balanceSheetLines` maps 2200 → "Payroll Liabilities" (`:11709-11711`) → **−6,700 under
   liabilities**. A = L + E still holds (cash −6,700 against liabilities −6,700).
8. **Cash flow**: out on `paid_date` (`server.js:7323-7324`), October. This is correct.
9. **Personal**: the owner's salary is booked dated `paid_date` (`server.js:10533-10544`), October. This is correct (cash in hand).

**The three questions:**

1. **Is a negative payroll liability ever valid?** Not as a presentation. Paying wages before their period is a
   **prepayment**. Under accrual the October books should show an asset (prepaid payroll / employee advance) of 6,700 and no
   expense. From 1 November the accrual lands: 6100 = 8,000, and 2200 = 8,000 − 6,700 = **1,300** (withholdings still to
   remit). The numbers are right; the label and the section are wrong.
2. **Do computeBooks and the GL agree?** Yes: both show 0 expense for October (steps 5-6). Per Rule 6, that is a shared
   assumption, not proof. Here the assumption (expense belongs to its period) happens to be right; what neither engine
   checks is the balance sheet's presentation (G9).
3. **Which VERIFICATION checks cover payroll timing, and why did none catch this?** Decision 2 (`VERIFICATION.md:98`),
   the payroll seed R0-R3 (`:216-229`), B4.1-B4.4 (`:680-683`), A7.21-A7.22 (`:436-437`), and harnesses
   `verify-f85-payroll-period-basis`, `verify-payroll-paid-date`, `verify-gl-payroll-cashout`, `b4-4-payroll-cash-transition`.
   **Every seeded run is paid in or after its own period** (R3: run 2026-07-20, period July). No seed pays before the
   period starts, and no check asserts the sign or section of 2200 on the balance sheet. The seed cannot discriminate this
   case (Rule 4).

**Proposed rule. Owner decision D1:**

| Option | What it does | Figures changed | Recommendation |
|---|---|---|---|
| **A** | Keep expense on the period (accrual, F85, decision 2). (1) A **debit** balance on 2200 is presented as **"Prepaid payroll"** under current assets, never as a negative liability. (2) **Mark paid** on a run whose period starts after the business's today returns `409 FUTURE_PERIOD` unless `confirm_future: true`; the UI asks "This run is for November 2026. Its expense lands on 1 Nov. Pay now as a prepayment?" (3) The period becomes a month picker (closes G7) defaulted from the business's today (closes G8). | **Balance sheet lines only**: Payroll Liabilities −6,700 → 0; new asset "Prepaid payroll" 6,700; total assets +6,700 and total liabilities +6,700; equity unchanged. The CoA page keeps the raw account balance, labelled "(prepaid)". **Unchanged and already correct:** dashboard, P&L, AI page, cash flow, Personal | ✅ **Recommended** |
| B | Recognise expense on the **pay date** when paid before the period | October P&L +8,000 expense; dashboard net −8,000; AI payroll-to-revenue; November −8,000. Contradicts decision 2 / F85 ("period by intent") and B4.3 | ❌ |
| C | **Block** paying a run before its period starts | No figures change; prevents a legitimate prepayment | Acceptable fallback if the owner prefers no prepayments |

**Harness design (`verify-v1-payroll-future-period`), not run.** Real PG, the real routes, clock pinned at 2026-07-25:

- **Seed:** one business on the net basis; one employee, gross 8,000, deductions to net 6,700; create run **"August 2026"**,
  approve, mark paid (`paid_date` = 2026-07-25).
- **Assertions:**
  - CONTROL: `/api/gl/pnl` (year) 6100 = 0 for July (the bug gives the same).
  - `/api/reports/balance-sheet`: `payrollLiabilities` = **0** and a "Prepaid payroll" asset line = **6,700**.
    **Bug gives −6,700 and no asset line.**
  - Assets = liabilities + equity (control).
  - Mark paid without `confirm_future` → **409**. **Bug: 200.**
- **Second control run:** "July 2026" approved and paid → 2200 = **1,300** (withholdings), no prepaid line. This
  discriminates sign handling: both runs use the same route, and only the date relation differs.
- **Related re-runs:** `verify-f85-payroll-period-basis`, `verify-payroll-paid-date`, `verify-gl-payroll-cashout`,
  `verify-gl-post-payroll`, `verify-gl-bs-lines-foot`, `verify-gl-bs-api-equity`, `verify-f137-balance-sheet-report`,
  `b4-4-payroll-cash-transition`, `verify-m41-payroll-withholdings`.

### 2.2 V2: Banking total balance

**Trace:**

- **Client:** `const bankAccounts=[]` (`app-main.js:5618`) has no writer anywhere. grep finds the declaration, the sum
  (`:5680`) and the render (`:5695`) only.
  - Production (`9682467`) rendered `S(0)` = "$0".
  - `main` (LR16) renders "—" when no account reports a balance (`:5679, 5689`). That is honest, but there is still no
    number.
- **Server:**
  - `POST /api/plaid/exchange` calls `/accounts/get` (`server.js:7698`) only to read `institution_id`. The accounts'
    `balances` are discarded.
  - The stored item holds `item_id, access_token, institution_name, linked_at, cursor` (`:7708`), with no balances.
  - grep for `balances` in `server.js` finds only Wise (`:8544-8546`).
- **Same root as LR16?** Same family. LR16 removed the fabricated $0 and logged "a real account balance needs the
  provider's reported balance or an opening balance". This is that open item.

**Proposed fix (size M):**

- Store each linked account's provider balance (name, mask, type, `current`, `available`, `iso_currency`, `as_of`) on the
  Plaid item at exchange, and refresh it on sync with `/accounts/balance/get`.
- `GET /api/plaid/items` returns those accounts; the client fills `bankAccounts` from them.
- Total Balance sums **per currency**. It never adds different currencies; with more than one currency, show a line per
  currency or convert with a label.
- **Display only:** never posted to the GL. Bank balance vs GL cash (1000) is exactly what reconciliation compares.
- **D7 (upgraded, §4):** per account, show the bank's balance (with "as of"), the books' balance and the difference,
  with a "Reconcile" link. Belvo and CSV-imported accounts have no provider balance, so they show the books' balance
  and say so. An opening-balance entry (Dr 1000 / Cr 3100) is a later option.
- **Risk:** entity isolation (balances stored per business item, `_bankCtx` M60 already scopes items); no money in books.
- **Harness design:** `verify-v2-bank-balance`.
  - The provider is external, so its HTTP responses come from a recorded Plaid sandbox fixture at the `plaidCall`
    boundary. This is labelled as a provider fixture; the DB, routes and SPA are real.
  - Two accounts, 1,234.56 and 765.44 USD → Total Balance **"$2,000.00"**. **Bug: "—" (main) / "$0" (production).**
  - Two businesses: B never sees A's balance (control).
  - Related: `verify-plaid-linking`, `verify-plaid-entity-scope`, `verify-plaid-sync-changes`, `verify-lr16-bank-rec`.

---

## 3. Build plan (ordered; each batch is commit-sized)

Order: money correctness → what a paying customer hits in week 1 → the rest. Each batch: harness written first, RED on
current code, GREEN on the fix, then the listed related harnesses (owner runs the 3× full sweep at the end).

| # | Batch | Files | Size | Risk | Harness (RED → GREEN) | Related re-runs |
|---|---|---|---|---|---|---|
| 0 | **Deploy `main`** (owner) | — | — | — | Owner's 3× sweep (running now) + post-deploy checks | — |
| 1 | ✅ **DONE 2026-10-22 (uncommitted): V1** — prepaid payroll at the ledger (1250) + future-period confirm + month picker (G6, G7, G8); see AUDIT_MASTER V1 | `server.js` (`balanceSheetLines`, mark-paid), `index.html` (Run Payroll modal, markPayrollPaid confirm) | M | Money, GL presentation, audit (confirm logged) | `verify-v1-payroll-future-period` (§2.1) | §2.1 list |
| 2 | ✅ **DONE 2026-10-22 (uncommitted): G3** — edit routes hardened. Amount below paid → 409; amount edit re-derives status (invoice + bill, **one shared helper**) | `server.js` (PUT invoices, PUT bills) | S | Money, GL | `verify-g3-doc-edit-guard`: invoice 1,000 paid 400 → PUT 300 = 409 (**bug 200, AR −100**); PUT 1,200 → AR 800, GL 1100 = 800, status partial. Same for a bill | `verify-gl-resync-on-edit`, `verify-invoice-mark-paid`, `verify-bill-mark-paid`, `verify-f135-*`, `verify-gl-entity-immutable-edit` |
| 3 | ✅ **DONE 2026-10-23 (uncommitted): G4** — bank-rec match suggestions ranked (amount exact → amount within 1% → vendor name → date within 14 days); **no preselect** when nothing qualifies | `index.html` (`loadBankRec` debits block) | S | Money (a wrong match books AP) | extend `verify-c17-match-bill-default`: debit 5,850 vs bills 44 / 44 / 120 → selection **empty** (**bug: first $44 bill**); amount-tie ranking control | `verify-c8-bankrec-unmatched`, `verify-m61-bankrec-actions-scope`, `verify-lr16-bank-rec`, `verify-bankrec-render` |
| 4 | ✅ **DONE 2026-10-23: B7b + G2** — persist reconciliations (new `bank_reconciliations` table: business, account, statement date, statement balance, book balance, cleared line ids, who, when; audited, idempotency key, Rule 9) + Reconciliation report; fix the "Main Checking" toast and literal "$0.00" | `database.js` + migration, `server.js` (POST/GET), `app-main.js` (`finishReconciliation`), report entry | M | Audit, entity isolation | `verify-b7-reconciliation-saved`: finish → reload → the report lists it with balance 965.00 / cleared 2 (**bug: nothing after reload**); difference ≠ 0 → 400 | `verify-lr16-bank-rec`, `verify-gl-bankrec` |
| 5 | ✅ **DONE 2026-10-23: V2** — provider balances | `server.js` (Plaid exchange/sync/items), `app-main.js` (`bankAccounts`) | M | Isolation; display only | `verify-v2-bank-balance` (§2.2) | §2.2 list |
| 6 | ✅ **DONE 2026-10-23: B1b** — invoice numbers. Per-business sequence, unique index (user, business, number), prefix from Settings (closes the prefix part of G1); shown in Invoices, Payments Received, PDF, AR | `database.js` + migration, `server.js` (`POST /api/invoices`, the one writer, LA7), lists | M | Isolation, audit. **Existing rows: owner-run numbering script (dry run default, `--apply --expect N`, Rule 8)** | `verify-b1b-invoice-numbers`: 2 businesses × 2 invoices → INV-0001/0002 each; 5 concurrent creates → 5 distinct; Payments Received shows the number (**bug "—"**) | `verify-la7-invoices-one-writer`, `verify-c1-invoice-*`, `verify-invoice-line-items` |
| 7 | **B1a + B4a**: Edit invoice / Edit bill UI (prefilled form + line items, the LR9 `load()` pattern), after batch 2 | `finflow-api-wiring-medium.js` (invoices), `finflow-api-wiring-pages.js` (bills) | M | Money (via batch-2 server rules) | `verify-b1a-edit-invoice`: edit 700 → 800 keeps lines, GL 4000 = 800, one audit UPDATE; edit below paid shows the server's refusal | batch 2 set + `verify-lr9-quote-edit-convert` |
| 8 | **B1c + G1**: payment terms per business (saved setting); blank due = issue + terms; printed invoice shows the real due date; remove or relabel "Default tax rate" (**owner decision D6**) | `server.js` (settings, `POST /api/invoices`), `finflow-api-wiring.js` (`saveSettings`, the runtime winner), `app-main.js:6240` | S/M | Money (overdue KPI moves when dues appear). **No backfill of old null dues** (Rule 8: they show "No due date") | `verify-b1c-terms`: terms 15, issue 2026-07-01, blank due → due 2026-07-16, overdue on 07-25 (**bug: "TBD", not overdue**) | `verify-c16-bill-overdue-badge`, `verify-aging-reports-reconcile`, `verify-m27-invoices-collected` |
| 9 | **B2**: contact picker + upsert. Invoice/bill form picks a saved contact or types a new one; save upserts by normalised name **per business** in the same transaction; nullable `customer_id` / `vendor_id` link. Existing data: the unsaved lists already enumerate it; an owner-run create script (dry run default, Rule 8) | `server.js` (`POST /api/invoices`, `POST /api/bills`), forms, migration | M | Isolation, audit (CREATE per contact) | `verify-b2-contact-upsert`: invoice to "Acme Ltd" twice → 1 customer; "acme ltd " → same; business B gets its own; unsaved list empties (**bug: 0 customers, "not saved"**) | `verify-la4-customers-from-invoices`, `verify-la14-vendors-from-bills`, `verify-f66-customer-vendor-validation`, `verify-customer-derived-revenue` |
| 10 | **B1d**: Email invoice + sent/viewed. `POST /api/invoices/:id/send`, copying the reminder route: server-side recipient, idempotency, audit, `sent_at`/`sent_count`; `viewed_at` stamped when the customer opens the pay-link page | `server.js`, invoice row actions | M | Audit; outbound mail. **Needs a verified Resend domain (owner action, D8)** | `verify-b1d-send-invoice` (Resend at its boundary, checked wrapper as LR23): send → 1 mail, `sent_at` set; double send → 1 mail; no e-mail → 400 NO_EMAIL | `verify-lr23-*` |
| 11 | **B3**: one shared list control (search across named fields, status chips, date range, column sort) over the arrays already loaded client-side; applied to Invoices, Bills, Expenses, Quotes, Payments received/made, Receipts, Credit notes, Vendor credits, Recurring invoices/bills, Vendors, Journals, Timesheet, Projects, Bank lines, Documents; Customers and Items moved onto it | new `public/finflow-list.js` + each page's render (the runtime winners) | M + S/page | **KPI cards must read the unfiltered array** (Rule 2) | `verify-b3-list-controls`: filter invoices "overdue" → only overdue rows; KPI cards unchanged; sort by amount desc (control: no filter = all rows) | each page's existing render harness |
| 12 | **B8a**: Trial Balance + GL Detail in Reports, each showing the business's `/api/gl/verify` status ("books verified ✓" or "ledger not reconciled: figures may differ from the P&L") | `app-main.js` (`reportsData`), `finflow-api-wiring-extra.js` (`generateReport`, the runtime winner) | S | Read-only | `verify-b8a-tb-report`: TB debits = credits = seeded totals; a broken entry → banner shown | `verify-gl-statements`, `verify-gl-verify`, `verify-reports-parity` |
| 13 | **B8b**: expense accounts by category (60xx per business, created on first use; the posting rules map category → account) | `server.js` (posting helpers + backfill rules) | M/L | GL. The gate compares the opex **total** (`server.js:11630`), so it still holds. **History: owner decision D5** | `verify-b8b-expense-accounts`: Rent 500 → 6010, Software 120 → 6020; P&L lines by account; total opex unchanged (control) | `verify-gl-post-expense`, `verify-gl-post-bill`, `verify-gl-backfill` (byte-identity must be updated deliberately), `verify-expense-breakdown-reconcile` |
| 14 | **B6c-e**: time entry notes; employee picked from the payroll roster + team (free-text fallback kept for contractors); project default rate | `server.js` (timesheet, projects), `finflow-api-wiring-extra.js` | M | Low | `verify-b6-time-fields`: project rate 120 prefills; notes saved and shown; employee list = roster names | `verify-fix1-timesheet-projects`, `verify-lr10-edit-time-entry`, `verify-timesheet-entity-scope` |
| 15 | **B6a**: invoice from unbilled time. `POST /api/invoices/from-time {project_id, entry_ids}` creates a **draft** through the one invoice writer (lines = hours × rate) and stamps `invoice_id` on the entries in the same transaction (`FOR UPDATE`; an entry can carry one invoice); deleting the draft releases them | `server.js`, migration, timesheet/projects UI | L | Money (revenue at issue), audit, double billing | `verify-b6a-invoice-from-time`: 3 entries → 1 draft = Σ; 2nd call with the same entries → 409 / same invoice (**no double billing**); delete draft → entries unbilled again | `verify-la7-invoices-one-writer`, `verify-invoice-line-items`, batch 14 |
| 16 | Quick fixes: G5 Items Active count; C8 avg per day (D9); C9 remove "Find Advisor" injection; C10 + G11 hide coming-soon surfaces (D4) | `finflow-api-wiring-medium.js`, `finflow-api-wiring-extra.js`, `app-main.js:7001-7010`, `index.html` | S | None | one assertion each (RED first) | page render harnesses |
| 17 | P2: AR aging buckets (C2), credit-note apply-to-invoice (C1), earnings split current year / prior years (C4) | `server.js`, `finflow-api-wiring-extra.js` | M each | Money (AR, credit contra) | each with a discriminating seed (e.g. invoices 10 / 45 / 75 / 120 days overdue → one per bucket) | `verify-aging-reports-reconcile`, `verify-gl-post-creditnote`, `verify-gl-bs-api-equity` |

**Shared work:** batches 2 and 7 share the edit helper; batch 9 covers customers **and** vendors; batch 11 is one
component for every list; batches 6 and 10 share the invoice document (number + send).

---

## 4. Owner decisions (upgraded 2026-10-22 to the "better than standard" bar, §7)

Competitor behaviour is from working knowledge, not re-researched. Verdict = how the pick compares with QBO / Xero.
**Status:** recommendations logged 2026-10-22 under the owner's direction ("better in every way"); the owner confirms
them when batch 1 starts.

| # | Decision | What QBO / Xero do | Recommendation (upgraded) | Verdict |
|---|---|---|---|---|
| D1 | Payroll paid before its period (V1) | Both generally post payroll expense on the **pay date** | **Option A** (§2.1): expense stays in its period (accrual); an early payment shows as **"Prepaid payroll"** (current asset), never a negative liability; **Mark paid** on a future period asks: "This run is for November 2026. Its expense will be recorded on 1 Nov. Pay it now as a prepayment?" (server-enforced `confirm_future`, audited); a **month picker** defaulting to the business's today replaces the free-text period | **Better**: real accrual accounting, and the confirm says where the expense lands |
| D2 | Editing a paid or part-paid invoice/bill | QBO edits freely (can leave an overpayment); Xero requires removing payments first | Edit any field; the amount may not go below what's paid; the lock date applies; every change is audited old → new (already field-level) | **Better**: safer than QBO, less friction than Xero, and neither has field-level history |
| D3 | Contacts for existing free-text names | Customer picked first (picker) | Picker + automatic save going forward; existing names through **"Save all N" with a preview** in the app, plus a **near-duplicate warning** ("Acme Ltd" vs "ACME Limited"); nothing changes without the owner's click (Rule 8) | **Better** |
| D4 | "Coming soon" tabs (Find Advisor, Client Portal, Rebalance, role customisation) | Don't ship placeholder tabs | Remove Find Advisor (a duplicate); hide Client Portal and Rebalance until built; keep the role note as plain text | Standard |
| D5 | Expense history when accounts split by category | Both let you reclassify past transactions | Going forward at launch, **plus a reclassify tool soon after**: a preview of which past expenses move to which account, then an audited per-business ledger rebuild (the Phase 4 byte-identity backfill pattern) | **Better** once the tool ships. Launch-only, it's below standard, and is flagged as such |
| D6 | Settings "Default tax rate 12.5%" | n/a (they ship tax engines) | **Remove** it (no VAT/GST engine by design; the field implies one) | Correct for scope |
| D7 | Bank balance per account | Xero shows **statement balance vs balance in Xero** per account | **Changed from "—":** per account, show the **bank's balance** (provider, with "as of" time), the **books' balance** and the **difference**, with a "Reconcile" link; totals **per currency**; an account with no provider balance shows the books' balance and says so | **Better**: Xero's view plus multi-currency and an as-of time |
| D8 | Invoice e-mail sender | Verified domain required | Verify a sending domain in Resend before batch 10; per-invoice **sent / delivered / opened** status | **Better** on status |
| D9 | Timesheet "Avg per day" | Harvest: per-person utilisation vs capacity | Remove now (it misleads); later, hours per person per working day vs capacity | Stopgap now (below standard); better later |

---

## 5. Out of scope

Tax filing, a VAT/GST/sales-tax engine, 1099 / contractor tax forms (owner ruling 2026-09-30; CLAUDE.md product facts).
Also not planned here: P3 items (timer, weekly grid, approvals, mileage, purchase orders, deposits, custom roles, write
API, native mobile).

---

## 6. UNEXECUTED: what needs an executed harness first (after the sweep)

Everything in this plan is **proven by code reading only**; no harness ran (a 3× sweep was running). Order to execute:

1. **V1:** `verify-v1-payroll-future-period` on the current code, to confirm −6,700 / no prepaid line / mark-paid 200.
   This is the only item that touches the balance sheet.
2. **G3:** edit-route amount below paid (`verify-g3-doc-edit-guard`). It must be RED before batch 7 wires the UI.
3. **G4:** the C17 no-candidate seed. Confirm the first bill is preselected.
4. **G2 / B7b:** finish reconciliation → reload → nothing saved.
5. **V2:** provider balance never stored (fixture-based).
6. **B1b:** Payments Received "Invoice # —" on a seeded invoice.
7. **G5, C8:** minor; one assertion each.

Not verified in any way here: the Resend sandbox restriction (D8, working knowledge) and what the Plaid sync response
carries for balances (read the provider docs when building batch 5).

---

## 7. The bar: better than the industry standard, in what we offer and how we offer it

**Owner direction, 2026-10-22:** "I want the entire site at an improved version of the industry standard. Everything
needs to be better. We are going in new to a market; we need to be better in every way, not just what we offer, but
in how we offer it."

So every batch has two scopes: **parity** (what QBO / Xero ship) and **the better element**. The better element is part
of the batch's scope and its harness; it is not an optional extra. A batch is not done until both are GREEN.

**How we offer it (applies to every batch):**
- **Say why.** Every suggestion, warning and refusal names its reason in plain words ("exact amount · vendor named in
  the description"; "this run is for November, so its expense lands on 1 Nov").
- **Preview before anything bulk or irreversible.** Show what will change, then ask (contacts "Save all", the
  reclassify tool, number backfill).
- **Never a dead end.** Every refusal says what to do next and links there.
- **Every figure traceable.** A number on a card opens the rows that make it.
- **Correct for every business:** per-currency totals, never mixed; dates in the business's timezone; nothing that
  assumes one country.
- **Audited.** Every change records who, when and old → new.
- **No placeholders.** No "coming soon" in the navigation.

**The better element per batch:**

| # | Batch | Parity (standard) | Better element |
|---|---|---|---|
| 1 | V1 payroll | Post payroll | Accrual by period + "Prepaid payroll" + a confirm that states where the expense lands; month picker in the business's timezone |
| 2 | Edit guards | Edit documents | Amount can't drop below what's paid; the refusal says how much is paid and what to do |
| 3 | Bank match | Ranked suggestions | Each suggestion shows **why** it matched; never preselects a guess |
| 4 | Reconciliation | Saved reconciliation + report | Cleared lines **lock** once reconciled; a later edit to a reconciled line is flagged on the next reconciliation |
| 5 | Bank balances | Bank balance per account | Bank vs books vs difference per account, per currency, with "as of" (D7) |
| 6 | Invoice numbers | Sequential numbers | Per business, never reused; a gap report for the accountant |
| 7 | Edit screens | Edit invoice / bill | Shows the change history (old → new) right on the document |
| 8 | Terms + due dates | Net-N terms | Due date computed and shown live as you type; the printed invoice states the real date |
| 9 | Contacts | Pick a customer | "Save all N" with preview + near-duplicate warning (D3) |
| 10 | Invoice e-mail | Send + sent status | Sent / delivered / opened per invoice; a resend never double-sends |
| 11 | Lists | Search / filter / sort | Filters never change the KPI cards (Rule 2); the filter state is shown in words ("Showing 4 overdue of 31") |
| 12 | TB + GL detail | Trial balance report | Shows the ledger's live "books verified ✓" status beside the figures |
| 13 | Expense accounts | Expense by account | Reclassify tool with preview (D5) |
| 14 | Time fields | Notes, people, rates | The project rate prefills and says where it came from |
| 15 | Invoice from time | Bill unbilled time | Double billing impossible at the database level, not just hidden on screen |
| 16 | Quick fixes | Clean UI | No placeholders anywhere (D4) |
| 17 | P2 reports | AR aging, credit apply, earnings split | Every bucket and line opens its rows |

Where FinFlow is already ahead (keep and market): native multi-business with consolidation, per-business accountant
permissions, a field-level audit trail, FX at every tier, regional payment rails, schedules aware of each business's
timezone and holidays, and personal + business in one app behind a hard wall.

## 8. Work order

Work begins **after the owner's 3× sweep finishes**. First: deploy `main` (batch 0, owner, when Railway is back), then
batch 1 (V1). Before launch: batches 1-9, 12 and 16. Right after launch: 10, 11, 13, 14, 15, 17. Batch 11 can start
with Invoices and Bills only if the launch date needs it.
