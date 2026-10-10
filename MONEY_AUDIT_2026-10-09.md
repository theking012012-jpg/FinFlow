# FinFlow — Money audit, 2026-10-09 (FROZEN LIST)

Read-only audit of every money figure: where it is computed, where it is shown, and whether each
surface reads the one correct source or recomputes it. No code was changed. This list is **frozen**
(CLAUDE.md "What done means" rule 2): anything found from here on goes on the next round's list.

**How each item was verified.** Every item carries one of two labels, and they are not the same claim:

- **EXECUTED.** Measured against a real Postgres 17 scratch cluster with the real schema, real
  routes and real rows. It ran as the non-root `postgres` user on a clean `git archive` copy of
  `e713ad1` (decision D2). The measured value equals the predicted bug value, and the hand-computed
  correct value differs (Rules 3, 4, 6). The instruments are
  `tools/money-audit-2026-10-09/money-audit-probe.js` (pinned clock) and `money-audit-probe2.js`
  (real clock). They touch only their own scratch cluster.
- **CODE-READ.** Established by reading the code at the cited lines. The item has not been executed
  and must not be cited as verified (Rule 14).

**L42 and L59–L63.** These were named in chat but never written down anywhere. L59–L63 cannot be
recovered without inventing them (Rule 7). This audit re-derived its findings from scratch, in both
directions (Rule 13). L42, the deductible vocabularies, is **M15** below.

**Cleared by execution (not a defect):** a negative credit note (−100) is refused. `body-shape.js`
N105 rejects negative `amount` on every write.

---

## 0. Why the drip happens: second implementations (structural)

Each money figure has one correct source on the server: `computeBooks`, which is GL-gated through
`glProfitLoss` / `glBalanceSheet`. The **native** dashboard path does not read it. The browser
re-implements the same books a second time:

| Client mirror (2nd implementation) | Server source it copies | Divergences found in this audit |
|---|---|---|
| `computeRevenue` (app-main.js:2352) | `computeBooks.revenue` | journal leg read from the journal list, not the GL (**M21**) |
| `computeExpenseBreakdown` (app-main.js:2032) | `computeBooks.opex` + `tax.deductible` | deductible vocabulary (**M15**) |
| `buildMonthlyArrays` (finflow-api-wiring-dashboard.js:46) | `computeBooks.monthly` | payroll dropped (**M10**), future-dated rows (**M38**) |
| `arOutstanding` (app-main.js:2273) | `computeBooks.outstanding` / `arSummary` | overdue definitions (**M24**) |
| `_journalPnL` (app-main.js:2329) | GL `source_type='journal'` | re-dated journals (**M21**) |
| Entities page `getConsolTotal` (index.html:7611) | `computeBooks(null)` consolidated | NULL-entity rows double (**M23**) |
| `_applyPersFilter` (app-main.js:4314), portal personal (accountant-routes.js:912) | none: two personal engines | **M12**, **M26** |

The display-currency path (`_applyConvertedKPIs`, app-main.js:5289) already paints the dashboard
from `/api/reports`, the server figures. **Proposed root fix (owner decision):** the native path does
the same, and the mirrors above are deleted. Every "fix one, find another" round so far has been one
of these mirrors drifting.

---

## 1. Frozen defect list (ranked)

Severity:
- **S1:** ordinary use silently loses or misstates money in the books (P&L, AR/AP, cash), or a
  control reports success while doing nothing.
- **S2:** a displayed money figure is wrong in ordinary use.
- **S3:** wrong under specific conditions (multi-entity, imports, integrations, legacy data), or on a
  secondary surface.
- **S4:** labels, latent or edge cases, and design notes.

| # | Sev | Finding | Status |
|---|---|---|---|
| M1 | S1 | Deleting a **paid invoice** drops its revenue and AR but keeps its cash | EXECUTED |
| M2 | S1 | Deleting a **paid bill** drops its expense from the P&L though the cash left | EXECUTED |
| M3 | S1 | Accountant-portal journals say "posted" but never reach the books | EXECUTED |
| M4 | S1 | Receipt scanner "+ Add to expenses" saves nothing (fake success) | EXECUTED |
| M5 | S1 | CSV-imported **Paid / Partial** invoices and bills count as fully outstanding (AR / AP) | EXECUTED |
| M6 | S1 | Income-tax estimate deducts only flagged expense rows, not payroll, COGS or bills | EXECUTED |
| M7 | S1 | 13-week cash forecast contains **no payroll** | EXECUTED |
| M8 | S1 | Inventory write-off ("adjustment") is never expensed; ledger keeps phantom stock | EXECUTED |
| M9 | S2 | Payments Received page shows **every entity's** payments (mixed currencies) | EXECUTED (API) |
| M10 | S2 | Overview chart and monthly arrays drop payroll for every UI-created run | EXECUTED (parse) |
| M11 | S2 | "Growth" compares against the last fiscal month, which is in the future: AI says −100%, Health Score Growth = 0 | EXECUTED |
| M12 | S2 | Personal Finance scales recurring items to the whole period (Year view = ×12 in October) | EXECUTED |
| M13 | S2 | Personal asset/liability values have no currency and are shown as USD × rate | EXECUTED |
| M14 | S2 | Owner salary in Personal Finance comes from the roster template, not payroll runs (Rule 12) | EXECUTED |
| M15 | S2 | Four "deductible" vocabularies (was L42): the same expense counts on one surface and not another | EXECUTED (server) |
| M16 | S2 | Cash-flow report omits inventory purchases that balance-sheet cash includes | EXECUTED |
| M17 | S2 | Deleting an expense booked from a bank line strands the bank line forever | EXECUTED |
| M18 | S2 | Stripe: a charge that paid an invoice via Pay-now can be "added to books" again (double revenue); Pay-now refunds never reverse | CODE-READ |
| M19 | S3 | Codat-imported journals are typed by the first character of an opaque account id | CODE-READ |
| M20 | S2 | Client AI insights' payroll figures come from salary-category expense rows and the roster (Rule 12) | EXECUTED |
| M21 | S3 | Re-dating a posted journal changes the list, not the books | EXECUTED |
| M22 | S3 | GL backfill `reset` re-dates paid-payroll cash-out to `run_date` (L7 regression path) | EXECUTED |
| M23 | S3 | Entities-page "Consolidated" plain-sums per-entity figures, so legacy NULL-entity rows count once per entity | EXECUTED |
| M24 | S3 | Two server "overdue" definitions disagree on the same invoice | EXECUTED |
| M25 | S3 | Status-literal `'overdue'` remains in 3 places (AI grounding, portal AI, Bills badge) | EXECUTED |
| M26 | S3 | Portal Personal tab: all-time raw sum, includes **business** bank-feed rows, mixed currencies, capped at 200 rows | CODE-READ |
| M27 | S3 | Invoices page: two writers of "% collected"; "Billed" is all-time under a period label | EXECUTED |
| M28 | S3 | AI quarter insight hard-codes Q4; "top client this month" is an all-time figure; cash-card source % uses mismatched bases | EXECUTED |
| M29 | S3 | Dashboard profit "vs last period" compares net-with-COGS to prior-without-COGS | EXECUTED |
| M30 | S3 | Health Score receivables = status-'paid' face amounts ÷ all invoices (drafts, partials) | EXECUTED |
| M31 | S3 | Recurring Bills "YTD" is a fabricated monthly × month-number; Recurring Invoices "YTD" is all-time | EXECUTED |
| M32 | S3 | COGS is dated by the UTC instant of the click, not the business's date (Rule 10) | CODE-READ |
| M33 | S3 | Bank CSV import collapses two genuine identical same-day transactions into one | EXECUTED |
| M34 | S3 | Inventory purchases credit Cash directly with no link to a bill: recording the supplier bill too double-counts | CODE-READ |
| M35 | S3 | Fake in-memory "Salary — X (April)" rows dated "Apr 30" are injected into the personal list | EXECUTED |
| M36 | S3 | Business Investments card shows USD-priced holdings under a non-USD entity's symbol, unconverted | CODE-READ |
| M37 | S3 | River (Sankey) diagram is a third profit number: no COGS, payroll missing | EXECUTED |
| M38 | S4 | Monthly buckets include future-dated rows while the KPIs exclude them (server and client) | CODE-READ |
| M39 | S4 | `buildMonthlyArrays` buckets expenses by `expense_date` only (KPIs fall back to `date`/`created_at`) | CODE-READ (latent) |
| M40 | S4 | Backfill has no date fallback for expenses, payments or receipts: a legacy dateless row aborts a `reset` part-way | CODE-READ (latent) |
| M41 | S4 | Payroll cash-out is booked at gross, so withholdings are never a liability (design) | CODE-READ |
| M42 | S4 | Run Payroll modal asks for a run date that the server ignores | CODE-READ |
| M43 | S4 | Forecast AR/AP are not net of credit notes / vendor credits; opex run-rate skips orphan payments | CODE-READ |
| M44 | S4 | API v1 summary uses a January fiscal year; entity keys hide NULL-entity rows the summary counts | CODE-READ |
| M45 | S4 | P&L report "Expenses" tile says "incl. payroll + COGS"; the value excludes COGS | EXECUTED |
| M46 | S4 | Cash card "avg monthly net" divides by nominal months (12/3), not elapsed | CODE-READ |
| M47 | S4 | Tax-Deductible report has no D2 bound (future-dated expenses count) | CODE-READ |

---

## 2. Detail and evidence

### M1 — Deleting a paid invoice (S1, EXECUTED)
`DELETE /api/invoices/:id` (server.js:2181) deletes the row and reverses only the invoice's GL
entry. `invoice_payments` has no foreign key (database.js:623), and the client (`deleteInvoice`,
finflow-api-wiring-medium.js:219) has no guard. The payment is orphaned: the cash-flow report reads
`invoice_payments` unjoined (server.js:6638), and the GL keeps Dr Cash / Cr AR, so GL AR goes
negative and the balance-sheet gate falls back to "cash not tracked".

| Seed: invoice 1,000 → payment 1,000 → delete | delete | revenue | cash-flow in | balance sheet |
|---|---|---|---|---|
| Measured | 200 | **0** | **1,000** | source `computeBooks`, cash `null` (log: `glAR=-1000`) |
| Correct | refused, or the payment reversed with it | 1,000 | 1,000 | `gl`, cash 1,000 |

**Root fix (proposal):** refuse delete of any invoice that has a payment (void-by-credit-note is the
accounting path). Class: every parent document with child settlements, so M2 is the same fix.

### M2 — Deleting a paid bill (S1, EXECUTED)
`DELETE /api/bills/:id` (server.js:4408): the linked `payments_made` row keeps `bill_id` pointing at
nothing. `computeBooks` treats bill-linked payments as settlement, never expense (server.js:11009).

**Measured:** expenses 400 → **0** after the delete, cash-flow outflow still 400, balance sheet falls
back (`glAP=-400`). **Correct:** 400.

### M3 — Accountant journals never reach the books (S1, EXECUTED)
Accountant-routes.js:1064 inserts the journal with **no `status`** and never calls
`postJournalToLedger`. The portal form sends `{account: <free-text name>}` with no `code`
(accountant-client.html:1398), so even a later "Posted" flip would be untypeable. The toast says
"Journal entry posted". **Measured:** status 201, stored status `null`, 0 GL entries, revenue 0 → 0
after Dr AR 900 / Cr Revenue 900. **Correct:** revenue 900.

### M4 — Receipt scanner saves nothing (S1, CODE-READ)
`window.addScannedExpense` (index.html:8463) shows "Expense added: …", then pushes into
`window.EXPENSES`. Nothing defines `window.EXPENSES` (repo-wide grep: no other reference), and there
is no `POST /api/expenses`. Every scanned receipt is lost; expenses are understated and profit
overstated. This is the F65 (fake-success) class, which was believed fully closed.

### M5 — CSV-imported Paid / Partial documents (S1, EXECUTED)
`CSV_IMPORT_SPECS` (server.js:6217, 6226) writes `status: 'paid'` with `amount_paid` absent
(invoices) or `0` (bills), and no payment rows. The boot backfill that used to heal this was removed
(database.js:116, N90). **Measured:** imported "Paid" invoice 500 gives Outstanding **500**; imported
"Paid" bill 200 gives balance-sheet AP **200**. **Correct:** 0 and 0. Every invoice migrated from
another tool sits in receivables forever. The CSV has no "amount paid" column mapping, so "Partial"
is also wrong.

### M6 — Income-tax estimate (S1, EXECUTED; the definition is an owner decision)
`/api/tax-filing` (server.js:6758) computes taxable = `computeBooks.revenue − tax.deductible`.
`tax.deductible` only reweights direct **expense rows** flagged yes/half (server.js:10987). Payroll,
COGS, bills, orphan payments and journal expenses are never deducted. The worksheet
(finflow-api-wiring-extra.js:1117) and the accountant Tax Summary read the same figure.

| Seed: revenue 1,000; rent 100 (deductible); bill 200; payroll run 500 | net profit | taxable income |
|---|---|---|
| Measured | 200 | **900** |
| Correct per CLAUDE.md ("saved rate × taxable profit") | 200 | 200 |

### M7 — Forecast has no payroll (S1, EXECUTED)
`/api/cashflow-forecast` (server.js:4022) sources open AR, open AP, recurring documents and a 90-day
direct-expense run-rate. Payroll is absent: no approved-unpaid run, no roster. **Measured:** with an
approved 3,000 run and a 3,000/month roster, the 13-week outflow is **0** and no `payroll` item
exists. For most businesses payroll is the largest outflow, so runway is overstated.

### M8 — Inventory write-off (S1, EXECUTED, real clock)
`POST /api/inventory-movements` accepts `type:'adjustment'` (server.js:11398). `recordStockMovement`
decrements units (server.js:11371) but posts no GL entry. FIFO only walks `purchase` and `sale`
(server.js:9732, 9770).

| Seed: buy 10 @ 10; write off 4; sell the remaining 6 | units | BS inventory after write-off | loss expensed | BS inventory after selling out |
|---|---|---|---|---|
| Measured | 6 | **100** | **0** | **40** |
| Correct | 6 | 60 | 40 | 0 |

### M9 — Payments Received page is cross-entity (S2, EXECUTED at the API)
`GET /api/invoice-payments` without `invoice_id` is user-scoped only; its own comment admits it
(server.js:9113). The page (finflow-api-wiring-pages.js:274) lists that list and its "Received ·
This month" card sums it (:317). It is also fetched once and never refetched on entity switch
(`_paymentsRecvFetched`). **Measured** for entity A (USD) with A = 300 and B (EUR) = 700:
**2 rows, 1,000**. **Correct:** 1 row, 300.

### M10 — Payroll missing from the monthly arrays (S2, EXECUTED as a pure parse)
`buildMonthlyArrays` buckets a run at `String(r.period).slice(0,7)+'-01'`
(finflow-api-wiring-dashboard.js:92). Run Payroll pre-fills the period as `"October 2026"`
(index.html:6769). Executed through the shipped `FinFlowDates._toYmd`:

- `"July 2026"` → `"July 20-01"` → **2001-07-20**
- `"October 2026"` → **2001-10-01**

Both fall outside the fiscal year, so every UI-created run is dropped. The canonical
`payrollPeriodYmd` gives 2026-07-01 and 2026-10-01; the server buckets
(`computeBooks.monthly`) use it, so the chart changes shape when a display currency is chosen (the
N104 class). Downstream (code-read): the overview chart's expense series, `getPeriodData()`'s
`d.exp` / `d.profit`, the river, AI "best/weakest month", and the M11 growth.

### M11 — Growth uses a future month (S2, CODE-READ)
AI insights (app-main.js:4977) and the Health Score (app-main.js:5027) compute growth as
`(REV[11] − REV[0]) / REV[0]`. `REV[11]` is the **last fiscal month**, which is 0 for 11 months of
the year. Result: AI reads "−100% growth vs January" and the Health Score Growth sub-score reads 0,
dragging the composite down until the final month.

### M12 — Personal recurring scaled to the whole period (S2, CODE-READ)
`_applyPersFilter` (app-main.js:4320, 4356): each recurring source with any occurrence in the window
counts `monthlyEquivalent × monthsInWindow`, where months is the **nominal** length (Year = 12,
Quarter = 3). On 9 October the Year view counts 12 months of salary and rent, and a raise changes all
twelve retroactively. This is the roster × months pattern basis C deleted on the business side, alive
in Personal.

### M13 — Personal values have no currency (S2, CODE-READ)
`personal_accounts.value` has no currency (server.js:2602). It is rendered `SP(value)` = value ×
persCurrency rate (app-main.js:3509, 4476), so it is treated as USD. A TT$ user entering 1,000,000 sees
TT$6.8M, while the edit modal shows 1,000,000. The net-worth snapshot (server.js:2658) and the portal
(accountant-routes.js:917) sum the raw values.

### M14 — Owner salary in Personal from the roster (S2, CODE-READ, Rule 12)
`saveOwnerPayroll` (finflow-api-wiring-medium.js:800–850) creates a monthly personal-income profile
of **roster** gross − deductions, plus a current-month occurrence. The scheduler then materialises it
monthly whether or not a run was approved, paid or voided. The business expense comes from runs; the
personal income comes from the roster. The two diverge on any unrun or voided month, bonus or
overtime.

### M15 — Deductible vocabulary ×4 (S2, EXECUTED on the server; was L42)

| Reader | 'yes' | 'Yes' | true (scanner) | undefined (CSV/Codat import) |
|---|---|---|---|---|
| server `_dedFactor` (server.js:10987) → tax estimate, portal | 1 | 1 | **0** | 0 |
| client `computeExpenseBreakdown` (app-main.js:2049) → Expenses "Tax deductible" | 1 | **0** | **0** | 0 |
| Tax-Deductible report (finflow-api-wiring-extra.js:1084) | 1 | 1 | **1** | 0 |
| expense list label (finflow-api-wiring-medium.js:409) | 100% | 100% | **100%** | **"100% deductible"** |

**Measured:** server deductible for {100 `true`, 40 `"Yes"`} is **40**; correct is 140.
`body-shape.js` does not validate `deductible`.

### M16 — Cash-flow report omits inventory purchases (S2, EXECUTED, real clock)
A stock purchase posts Dr Inventory / Cr **Cash** (server.js:11384). The cash-flow report reads only
invoice payments, receipts, expenses, payments made, paid payroll and journal cash (server.js:6637).
**Measured** (stock-in 10 @ 5): balance-sheet cash **−50**, cash-flow net **0**. Also missing from
that report: FX settlement cash.

### M17 — Bank line stranded (S2, EXECUTED)
`book-expense` / `match-bill` stamp `reconcile_state` on the bank row (server.js:9295, 9344). Deleting
the expense or payment never clears it, and there is no un-action route. **Measured:** after the
delete the 75 bank debit is not back in `unmatchedDebits`. The money left the bank and is in no
expense and no to-do list.

### M18 — Stripe double revenue (S2, CODE-READ; needs Stripe Connect)
Pay-now payments are keyed `'stripe:'+session.id` (server.js:328). `import-charge`'s double-count
guard checks only **open** invoices (server.js:8016). The feed's `appliedToInvoice` checks only
`'stripe-invpay:'+charge` (server.js:7919). A charge that fully paid an invoice through Pay-now shows
"Add to books" and books a second, sales-receipt revenue and cash. The refund webhook only reverses
the `stripe-invpay:` scheme (server.js:500), so Pay-now refunds leave AR settled.

### M19 — Codat journals typed by GUID (S3, CODE-READ; needs Codat)
The importer stores `lines[].account = accountRef.id` (an opaque id, server.js:7621).
`postJournalToLedger` / `_jLineType` type a line by its code's **first character** (server.js:10660,
app-main.js:2320). An id starting `4` is booked as income, `7` as expense, a letter is not posted at
all.

### M20 — AI insights payroll from the wrong source (S2, CODE-READ)
"Payroll-to-revenue" and "Payroll cost this quarter" use `d.sal` (app-main.js:4981, 4986). `d.sal`
is `EXP_SAL`: expense rows whose **category** matches salary/payroll
(finflow-api-wiring-dashboard.js:523), so it is 0 for basis-C payroll. "Payroll deductions this
month" sums the **roster** (app-main.js:4995).

### M21 — Posted journal re-dated (S3, EXECUTED)
`PUT /api/journals/:id` accepts `date` on a posted journal (server.js:3355) without re-posting.
**Measured:** list shows 2026-07-10, ledger keeps **2026-06-15**. The client `_journalPnL` reads the
list date while `computeBooks` reads the GL, so the native and display-currency dashboards disagree.

### M22 — Backfill reset re-dates payroll cash-out (S3, EXECUTED)
Backfill step 7 reads `r.paid_date`, but its SELECT does not select `paid_date` (server.js:10206,
10210), so the cash-out falls back to `run_date`. **Measured:** live entry 2026-07-25 (`paid_date`);
after `POST /api/gl/backfill?reset=1` it is **2026-10-09** (`run_date`). `reconcileAfterImport` runs
the same backfill (non-reset; idempotent, so it only bites on entries it newly posts).

### M23 — Consolidated card plain-sums entities (S3, EXECUTED with the legacy data shape)
`getConsolTotal` (index.html:7611) sums each entity's `/api/reports`. Each entity view includes
NULL-entity rows by design. With one legacy NULL-entity receipt of 120 (the pre-F150 shape; the
scratch constraint was dropped to reproduce F26-b data): X = 120, Y = 120, card **240**, correct 120.
The server already has the correct consolidated `computeBooks(null)`.

### M24 — Two overdue definitions (S3, EXECUTED)
`/api/reports.overdue` filters by status, so 'paid' is excluded (server.js:6431).
`computeBooks.arSummary` is arithmetic (server.js:11184), and it feeds the AR report, the portal and
reminders. **Measured** on an imported 'paid' invoice with a 500 balance: `/api/reports` overdue
**0**, AR-report overdue **500**, Outstanding 500. M5 is what creates such rows.

### M25 — Status-literal overdue (S3, CODE-READ)
Three places still match on the literal status: AI grounding counts `status==='overdue'`
(server.js:5515), the portal AI insights do the same (accountant-routes.js:1486), and the Bills nav
badge counts `overdue|due_soon` literals (finflow-api-wiring-pages.js:768). This is the L35 / F-C1
class; these three were missed.

### M26 — Portal Personal tab (S3, CODE-READ)
Accountant-routes.js:912–921 computes income/expense as a raw sum of the last 200
`personal_transactions` rows. That sum is all-time, **includes business bank-feed rows** (no
`entity_id IS NULL` filter), and mixes currencies. The owner's Personal page filters
`entity_id == null` and uses the windowed engine, so the two never agree.

### M27 — Invoices page (S3, CODE-READ)
"% collected" has two writers: finflow-api-wiring-postgres.js:300 (Σ paid / billed over recognised,
non-future invoices) and finflow-api-wiring-dashboard.js:343 (Σ paid over all invoices / (paid + net
AR)). They differ whenever a credit note is open; the last writer wins. "Billed" is all-time
recognised, but `inv-billed-lbl` shows the period label.

### M28 — AI / cash-card labels (S3, CODE-READ)
- The quarter insight hard-codes `MONTH_FULL[9]–[11]` and a prior quarter of `sum(PROFIT,6,9)`
  (app-main.js:4984).
- "Top client this month/quarter" is the all-time ranking, divided by period revenue
  (app-main.js:4987, 4992).
- Cash-card sources show % = all-time client total / period `d.rev` (app-main.js:2730), which can
  exceed 100%.

### M29 — Profit delta basis (S3, CODE-READ)
app-main.js:2611 computes current = revenue − COGS − opex. Prior = revenue − opex (:2624, :2629),
with a stale comment calling COGS "all-time". The "vs last period" % is skewed for inventory
businesses.

### M30 — Health receivables (S3, CODE-READ)
app-main.js:5022: Σ face amount of status-'paid' invoices ÷ Σ all invoices, including drafts and
future-dated invoices and ignoring `amount_paid`. This is the F56 class.

### M31 — Recurring "YTD" cards (S3, CODE-READ)
Recurring Bills YTD = current monthly profile × calendar month number, a projection, not the bills
actually generated (finflow-api-wiring-pages.js:1113). Recurring Invoices YTD = all-time Σ of
scheduler invoices (:448).

### M32 — COGS dated by click instant (S3, CODE-READ, Rule 10)
`inventory_movements.moved_at` is `NOW()` (database.js:707). COGS and its GL entry take its **UTC**
day (server.js:11374, 9770), and the stock-out modal has no date field. A sale entered at 21:00 on the
31st in a UTC−4 business lands in the next month, while the invoice revenue lands in this one.

### M33 — Bank CSV dedupe (S3, EXECUTED)
The CSV dedupe key is `sha1(date|amount|description)` (server.js:6333). **Measured:** two genuine
same-day 4.50 coffees import as **1** (1 skipped). OFX is unaffected (FITID).

### M34 — Inventory purchase vs supplier bill (S3, CODE-READ, design)
Stock-in posts Dr 1200 / Cr **1000 Cash** (server.js:11388) with no AP option and no link to a bill.
A user who also records the supplier's bill (the normal workflow) gets the cost twice: as bill opex
and as COGS when sold. Cash also goes out twice in the GL.

### M35 — Fake personal salary rows (S3, CODE-READ, order-dependent)
`syncAllPayrollsToPersonal` (app-main.js:3384–3397, the runtime winner; no wiring shadow) unshifts
`{desc:'Salary — <entity> (April)', date:'Apr 30', amount: net in USD}` into `persTransactions` and
re-renders. These rows appear in the personal list and running balance until the next
`_applyPersFilter`.

### M36 — Business investments currency (S3, CODE-READ)
The native Investments card sums USD-priced holdings and paints them with `S()`, the entity's symbol,
without conversion (finflow-api-wiring-dashboard.js:208).

### M37 — River diagram (S3, CODE-READ)
`buildRiver(d)` (app-main.js:6650) uses `REV`/`EXP` arrays: no COGS, payroll dropped (M10), and a
"Salaries" node from category rows. That makes it a third profit figure on the dashboard.

### M38–M47 (S4)
- **M38:** `computeBooks.monthly` (server.js:11248) and `buildMonthlyArrays` include future-dated
  rows. KPIs apply D2, so Σ chart ≠ Year KPI when scheduled documents exist.
- **M39:** chart expense bucket uses `exp.expense_date` only (finflow-api-wiring-dashboard.js:73).
- **M40:** backfill uses `e.expense_date` / `pm.date` / `s.date` with no fallback (server.js:10173,
  10189, 10203). `postLedgerEntry` throws on a dateless row, aborting a `reset` after it has already
  deleted the ledger. Latent: every current writer stamps a date.
- **M41:** mark-paid books gross as cash out and clears 2200 in full (server.js:9662), so
  withholdings are never owed (design, owner).
- **M42:** Run Payroll's run-date field (index.html:6802) is ignored; `run_date = NOW()`
  (server.js:9544).
- **M43:** forecast AR/AP are not net of credit notes or vendor credits; the opex run-rate excludes
  orphan payments made.
- **M44:** `/api/v1/reports/summary` uses fiscal start 0, not `accountFyStartIdx` (server.js:4258).
  An entity-scoped key's lists exclude NULL-entity rows that its summary includes.
- **M45:** P&L report tile "Expenses — incl. payroll + COGS" shows opex, which excludes COGS
  (finflow-api-wiring-extra.js:1004).
- **M46:** cash card `cf-avg` = cash net ÷ `d.months` nominal (app-main.js:2706).
- **M47:** Tax-Deductible report filters by the client window with no D2 (future-dated count)
  (finflow-api-wiring-extra.js:1082). The server deductible applies D2.

---

## 3. Money map (figure → one correct source → every surface → reads or recomputes)

| Figure | Correct source | Surfaces that **read** it | Surfaces that **recompute** it |
|---|---|---|---|
| Revenue | `computeBooks.revenue` (GL-gated `glProfitLoss`) | /api/reports, P&L report, portal /books, AI context, API v1, COGS page, display-currency KPIs, Entities per-entity | dashboard native (`computeRevenue`), overview chart (`buildMonthlyArrays`), river, Sales by Customer rows, Scenario base, Entities consolidated (M23) |
| COGS | `fifoItemSales` (one walker for `computeBooks` + `/api/cogs`) | everything (`window._cogsTotal`) | none (dating is M32; write-offs are M8) |
| Opex | `computeBooks.opex` | /api/reports, P&L totals, portal, display KPIs | dashboard native, Expenses page, bars, budget, scenario, chart |
| Payroll expense | run lines approved\|paid (`computeBooks`) | P&L, Payroll Summary, W-2 | client `computeExpenseBreakdown`; chart (M10, broken); **wrong sources:** AI (M20), Personal (M14), forecast (M7, none) |
| Net profit | rev − COGS − opex | display KPIs, reports | dashboard native, AI, health, river (M37), delta (M29) |
| AR / Outstanding | `computeBooks.outstanding` (+ journal AR on the BS) | BS, AR report total, reminders, portal | `arOutstanding` (dashboard card, Invoices, Payments Received, AR fallback) |
| Overdue | `computeBooks.arSummary` | AR report, portal | /api/reports (status-filtered, M24), AI (M25), Bills badge (M25) |
| AP | `computeBooks.accountsPayable` (+ journal AP) | BS, Vendors card, AP report | vendor rows (not net of vendor credits) |
| Cash balance | GL 1000 + J-cash (`glBalanceSheet`) | BS, forecast start | none |
| Cash movement | `/api/reports/cash-flow` | cash card, Cash Flow report | (source itself omits inventory and FX: M16) |
| Tax estimate | `computeBooks.tax.deductible` (definition: M6) | worksheet, portal | Expenses-page deductible (M15), Tax-Deductible report (M15/M47) |
| Forecast | own sourcing (server.js:4022) | forecast page | (M7, M43) |
| Personal income/spend | none; two engines | — | `_applyPersFilter` (M12, M14, M35), portal (M26) |
| Personal net worth | `personal_accounts` + personal holdings | page, snapshot, portal | (no currency: M13) |

---

## 4. Limits of this audit (stated, not assumed)

- **CODE-READ items are unexecuted.** They are labelled per item and must not be cited as verified.
  M4, M11, M12, M13, M14, M18, M19 and M20 are the high-severity unexecuted ones. They need
  jsdom/Chromium execution, or Stripe/Codat sandboxes.
- **Not run:** the full harness sweep. This was a read-only audit; the sweep runs once after the fix
  pass.
- **Not covered in depth:** admin/platform billing (not the user's books), MRR page (a manual tracker,
  not booked), budget and scenario (re-checked only via L24/L25 sources), PDF/CSV export formatting
  beyond the deductible label, holdings gain/loss math.
- **Production data not read.** Data-dependent items are M5, M23 and M40. Their size in the owner's
  books needs a read-only instrument run by the owner (Rule 7). This audit did not touch production.

---

## 5. Execution results, 2026-10-10 (CODE-READ → EXECUTED)

The 14 browser-only items were executed with `tools/money-audit-2026-10-09/client-items.js`. It boots the
real app in jsdom against a scratch Postgres seeded through the real routes, with the clock pinned to
25 Jul 2026 and the fiscal year starting January. It reads rendered screen text only. M4 was executed
separately by `tests/harness/verify-m4-scanner-save.js`.

Every item below measured **exactly the predicted bug value**. None was cleared.

| # | Measured on screen | Correct value |
|---|---|---|
| M11 | AI: "Full year revenue: $1,820 — -100% growth vs Jan 2026"; Health "Growth" 0/100 | no −100%; growth from elapsed months |
| M12 | Personal "Yearly income" $12.0K (one 1,000 occurrence this year) | $1.0K |
| M13 | Asset entered as 1,000, personal currency TTD → shown TT$6.8K | TT$1.0K |
| M14 | Owner salary 4,000/month saved, no payroll run → Yearly income $60.0K | $1.0K (no run, no salary) |
| M20 | AI "Payroll-to-revenue: 0%" with a 2,000 approved run on 1,820 revenue | 110% |
| M25 | Bills nav badge 0, while the Overdue card shows $400 | 1 |
| M27 | "% collected" is 29% after the Invoices writer, 30% after the dashboard writer | one value |
| M28 | Quarter view in Q3: "Oct 2026–Dec 2026 revenue" | Jul 2026–Sep 2026 |
| M29 | July profit "↓ 897% vs prior period" | ↓ 954% (June net 280 incl. COGS) |
| M30 | Health "Receivables" 3/100 | 29/100 (550 collected / 1,900 billed) |
| M31 | Recurring Bills "YTD" $700, no bill generated yet | $0 |
| M35 | List shows "Salary — Business A (April) · Apr 30 +$4,000" beside the real owner-salary row | no fabricated row |
| M37 | River: "$920 net profit · 51% margin" while dashboard Net is −$1.1K | −$1,110 (same as dashboard) |
| M45 | P&L tile "Expenses $2,900 — incl. payroll + COGS" (COGS is 30) | $2,930, or the label fixed |

M37's 920 also confirms M10 on the rendered screen: the "July 2026" payroll run (2,000) is missing from
the monthly arrays.

**Read-only production instrument (built and executed on scratch):**
`tools/money-audit-2026-10-09/prod-readonly-counts.js`. It is SELECT-only with bound parameters, uses its
own pg client (never requires `database.js`), and prints full error detail per check. It counts M5a/M5b,
M1, M2, M17, M21, M22, M23, M40, M50 and M9. On a scratch database seeded with one instance of each, every
check found exactly the planted case. M22 and M40 had nothing planted and returned none. Owner runs it:

    DATABASE_URL=<production url> node tools/money-audit-2026-10-09/prod-readonly-counts.js
    DATABASE_URL=<production url> USER_ID=<your user id> node tools/money-audit-2026-10-09/prod-readonly-counts.js

**Still CODE-READ (not yet executed):**
- M18 (Stripe) and M19 (Codat), which need provider sandboxes.
- The lower-severity items M26, M32, M34, M36 and M38–M47.

Every S1 and S2 item except M18 is now EXECUTED.

### Production counts (owner-run, 2026-10-10 03:47 UTC, all accounts)

These were run by the owner with `prod-readonly-counts.js` against the live database. They measure what
the data-dependent findings have actually touched so far.

| Check | Live result | Reading |
|---|---|---|
| M1 / M2 orphan payments | none | No live damage yet. The defects are still open in the code. |
| M5b bills paid but still owed | none | No live damage yet |
| M5a invoices paid/partial with money still owing | 4 rows, all **partial**: user 1 entity 11 (350); user 6 entity 8 (2 rows, 5,200); user 6 entity 10 (2,500). **No 'paid' rows** | No 'paid-but-owing' rows, so the M5 shape has not reached production. Re-run with the verdict column (2026-10-10): invoices #53, #40, #49 are **partial, backed by payments** (genuine). **Invoice #42 (user 6, entity 8): partial, amount 2,500, amount_paid 0, no payment rows**, so the full 2,500 is counted as owed. Either nothing was paid (the amount is right, the label is wrong) or it was imported as partial and the paid part is missing (the M5 shape). Owner to check; any correction is a separate, owner-approved data step (Rule 8). **Identified by the [WHO] check (2026-10-10):** user 6 = `client2@test.com` (a test login), entity 8 = "Aurora Retail Co", entity 10 = "Maple Consulting Inc". So #40, #42 and #49 are test data, not the owner's books. #53 is in user 1 (the owner, 5 businesses), entity 11 = "Business A", the Cowork sweep's test business. **Result: no M5a row in the owner's real businesses.** #42 remains a valid example of the M5 shape in test data. |
| M17 stranded bank lines | none | No live damage yet |
| M21 journal date ≠ ledger date | none | No live damage yet |
| M22 payroll cash-out ≠ paid date | none | No live damage yet |
| M23 money rows with no business | 1 sales receipt, 150, user 2 | **Corrected 2026-10-10 by [WHO]:** user 2 owns **no businesses at all**, so this row is not counted under several businesses (the M23 double-count needs at least 2). It is an orphan in an account with no books. Not in the owner's account (user 1). Cleanup is owner-gated (F26-b). |
| M40 dateless rows | user 1 (the owner's own login): 7 invoices + 2 bills with no issue_date | Dated by created_at (the L23 legacy fallback). Backfill falls back to created_at for these, so no rebuild abort. 0 dateless expenses/payments/receipts. |
| M50 ledger of deleted businesses | none | The Cowork test "Business A" had not yet been deleted at run time |
| M9 payments across businesses | users 1 = the owner (2 businesses, 7 payments), 5 = `123test@test.com` (2, 10), 6 = `client2@test.com` (3, 5) | These accounts' Payments Received page mixes businesses today |

