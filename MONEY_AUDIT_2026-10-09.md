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
| M1 | S1 | Deleting a **paid invoice** drops its revenue and AR but keeps its cash | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M2 | S1 | Deleting a **paid bill** drops its expense from the P&L though the cash left | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M3 | S1 | Accountant-portal journals say "posted" but never reach the books | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M4 | S1 | Receipt scanner "+ Add to expenses" saves nothing (fake success) | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M5 | S1 | CSV-imported **Paid / Partial** invoices and bills count as fully outstanding (AR / AP) | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M6 | S1 | Income-tax estimate deducts only flagged expense rows, not payroll, COGS or bills | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M7 | S1 | 13-week cash forecast contains **no payroll** | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M8 | S1 | Inventory write-off ("adjustment") is never expensed; ledger keeps phantom stock | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M9 | S2 | Payments Received page shows **every entity's** payments (mixed currencies) | EXECUTED (API) → FIXED, RED→GREEN (§6.1) |
| M10 | S2 | Overview chart and monthly arrays drop payroll for every UI-created run | EXECUTED (parse) → FIXED, RED→GREEN (§6.1) |
| M11 | S2 | "Growth" compares against the last fiscal month, which is in the future: AI says −100%, Health Score Growth = 0 | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M12 | S2 | Personal Finance scales recurring items to the whole period (Year view = ×12 in October) | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M13 | S2 | Personal asset/liability values have no currency and are shown as USD × rate | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M14 | S2 | Owner salary in Personal Finance comes from the roster template, not payroll runs (Rule 12) | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M15 | S2 | Four "deductible" vocabularies (was L42): the same expense counts on one surface and not another | EXECUTED (server) → FIXED, RED→GREEN (§6.1) |
| M16 | S2 | Cash-flow report omits inventory purchases that balance-sheet cash includes | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M17 | S2 | Deleting an expense booked from a bank line strands the bank line forever | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M18 | S2 | Stripe: a charge that paid an invoice via Pay-now can be "added to books" again (double revenue); Pay-now refunds never reverse | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M19 | S3 | Codat-imported journals are typed by the first character of an opaque account id | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M20 | S2 | Client AI insights' payroll figures come from salary-category expense rows and the roster (Rule 12) | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M21 | S3 | Re-dating a posted journal changes the list, not the books | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M22 | S3 | GL backfill `reset` re-dates paid-payroll cash-out to `run_date` (L7 regression path) | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M23 | S3 | Entities-page "Consolidated" plain-sums per-entity figures, so legacy NULL-entity rows count once per entity | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M24 | S3 | Two server "overdue" definitions disagree on the same invoice | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M25 | S3 | Status-literal `'overdue'` remains in 3 places (AI grounding, portal AI, Bills badge) | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M26 | S3 | Portal Personal tab: all-time raw sum, includes **business** bank-feed rows, mixed currencies, capped at 200 rows | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M27 | S3 | Invoices page: two writers of "% collected"; "Billed" is all-time under a period label | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M28 | S3 | AI quarter insight hard-codes Q4; "top client this month" is an all-time figure; cash-card source % uses mismatched bases | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M29 | S3 | Dashboard profit "vs last period" compares net-with-COGS to prior-without-COGS | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M30 | S3 | Health Score receivables = status-'paid' face amounts ÷ all invoices (drafts, partials) | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M31 | S3 | Recurring Bills "YTD" is a fabricated monthly × month-number; Recurring Invoices "YTD" is all-time | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M32 | S3 | COGS is dated by the UTC instant of the click, not the business's date (Rule 10) | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M33 | S3 | Bank CSV import collapses two genuine identical same-day transactions into one | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M34 | S3 | Inventory purchases credit Cash directly with no link to a bill: recording the supplier bill too double-counts | CODE-READ → FIXED in round 2, RED→GREEN (§7) |
| M35 | S3 | Fake in-memory "Salary — X (April)" rows dated "Apr 30" are injected into the personal list | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M36 | S3 | Business Investments card shows USD-priced holdings under a non-USD entity's symbol, unconverted | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M37 | S3 | River (Sankey) diagram is a third profit number: no COGS, payroll missing | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M38 | S4 | Monthly buckets include future-dated rows while the KPIs exclude them (server and client) | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M39 | S4 | `buildMonthlyArrays` buckets expenses by `expense_date` only (KPIs fall back to `date`/`created_at`) | CODE-READ (latent) → FIXED by code-read; no dedicated RED→GREEN assertion (§6.1) |
| M40 | S4 | Backfill has no date fallback for expenses, payments or receipts: a legacy dateless row aborts a `reset` part-way | CODE-READ (latent) → FIXED, RED→GREEN (§6.1) |
| M41 | S4 | Payroll cash-out is booked at gross, so withholdings are never a liability (design) | CODE-READ → FIXED in round 2, RED→GREEN (§7) |
| M42 | S4 | Run Payroll modal asks for a run date that the server ignores | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M43 | S4 | Forecast AR/AP are not net of credit notes / vendor credits; opex run-rate skips orphan payments | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M44 | S4 | API v1 summary uses a January fiscal year; entity keys hide NULL-entity rows the summary counts | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M45 | S4 | P&L report "Expenses" tile says "incl. payroll + COGS"; the value excludes COGS | EXECUTED → FIXED, RED→GREEN (§6.1) |
| M46 | S4 | Cash card "avg monthly net" divides by nominal months (12/3), not elapsed | CODE-READ → FIXED, RED→GREEN (§6.1) |
| M47 | S4 | Tax-Deductible report has no D2 bound (future-dated expenses count) | CODE-READ → CLEARED by execution (§6.1) |

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


---

## 6. Fix pass, 2026-10-10 (branch `claude/money-math-audit-bazpjo`, uncommitted, held for owner approval)

Every fix was proved the same way. A harness on a real scratch Postgres, seeded through the real routes, is run
against the **unfixed** code (it must fail, with the predicted bug value) and against the fix (it must pass).
Browser items boot the real SPA in jsdom and read rendered text. Every assertion prints the measured value, the
correct value and the value the bug gives (Rule 4). One fix = one patch = one commit.

### 6.1 Results per finding

| # | Fix | Harness | Checks GREEN on fix | Checks RED on unfixed code |
|---|---|---|---|---|
| M1 / M2 | Deleting an invoice or bill that has payments linked is refused (409) until the payments are removed | `verify-m1m2-delete-settled-docs` | 16 | 10 of 16 |
| M3 | Accountant journals: each line needs an account code; the journal really posts to the ledger (or is rolled back) | `verify-m3-accountant-journal-posts` | 10 | 6 of 10 |
| M4 | Receipt scanner saves through POST /api/expenses (idempotent, currency- and date-checked) | `verify-m4-scanner-save` | 8 | 6 of 8 |
| M5 | CSV import: Paid / Partial rows record a real payment for the paid part; a Partial row without a paid amount is refused and counted | `verify-m5-csv-paid-import` | 10 | 7 of 10 |
| M6 | Taxable income = revenue − every ordinary cost (COGS, opex incl. payroll and bills) + non-deductible rows; owner worksheet and accountant Tax Summary | `verify-m6-taxable-income` | 7 | 5 of 7 (pre-M32 test) |
| M7 | 13-week forecast includes payroll: approved/draft runs, else a roster estimate for months with no run | `verify-m7-forecast-payroll` | 6 | 5 of 6 |
| M8 | Inventory write-off is costed FIFO, expensed (Dr 5000 / Cr 1200) and shown on the COGS page | `verify-m8-inventory-writeoff` | 9 | 6 of 9 (pre-M32 test) |
| M9 | Payments Received list is scoped to the active business | `verify-m9-payments-received-scope` | 3 | 2 of 3 |
| M10 / M29 / M37 | Dashboard KPIs, deltas, monthly chart and river read the server books (/api/reports); provisional client builder mirrors the server rules | `verify-m-dashboard-server-books, verify-m10-client-monthly-builder` | 6 + 1 | 4 of 6, 1 of 1 |
| M11 | Growth compares elapsed fiscal months only | `verify-m11-growth-elapsed-months` | 3 | 3 of 3 |
| M12 | Personal period income = the rows actually in the period (no × nominal months) | `verify-m12-m13-m35-personal-figures` | 15 (shared) | 14 of 15 (shared) |
| M13 | Personal assets/liabilities carry a currency; every net-worth sum (page, breakdown, investments panel, snapshot, accountant portal) adds USD equivalents; one row mapper | `verify-m12-m13-m35-personal-figures, verify-m13-networth-currency-server` | 15 (shared) + 10 | 14 of 15, 8 of 10 |
| M14 | Owner's personal salary comes from PAID payroll runs (one row per run line, removed on void); the roster no longer creates personal income | `verify-m14-owner-salary-from-runs (+ the shared personal test)` | 11 | 7 of 11 |
| M15 | One deductible vocabulary (yes / half / no, FinFlowDates.deductibleFactor) on every surface | `verify-m15-deductible-vocabulary` | 8 | 4 of 8 |
| M16 | Cash-flow report includes ledger cash from stock purchases, FX settlements and paid-gap rows | `verify-m16-cashflow-ledger-cash` | 3 | 2 of 3 (pre-M32 test) |
| M17 | Deleting an expense or payment made releases its bank line | `verify-m17-bank-line-release` | 6 | 3 of 6 |
| M18 | Stripe Pay-now payments carry the payment-intent reference: no second 'add to books', refunds find the payment | `verify-m18-stripe-paynow-dedupe` | 7 | 4 of 7 |
| M19 | Codat journals map each line through Codat's own account list (unmapped → skipped and counted) | `verify-m19-codat-journal-accounts` | 4 | 4 of 4 |
| M20 | AI payroll figures come from payroll-run lines | `verify-m20-ai-payroll-runs` | 3 | 3 of 3 |
| M21 | Re-dating a posted journal re-dates its ledger entry | `verify-m21-journal-redate` | 7 | 4 of 7 |
| M22 | Backfill keeps the payroll cash-out on the paid date | `verify-m22-backfill-paid-date` | 2 | 1 of 2 |
| M23 | Entities 'Consolidated' reads the server's consolidated books | `verify-m23-entities-consolidated` | 2 | 1 of 2 |
| M24 | One overdue definition (computeBooks.arSummary) on /api/reports | `verify-m24-one-overdue-definition` | 4 | 2 of 4 |
| M25 | No status-literal 'overdue': AI grounding, portal AI and the Bills badge are date-based | `verify-m25-overdue-literals, verify-m25-bills-badge` | 5 + 1 | 2 of 5, 1 of 1 |
| M26 | Portal Personal tab: personal rows only, calendar YTD, per currency, not capped | `verify-m26-portal-personal` | 6 | 4 of 6 |
| M27 | Invoices '% collected' has one writer; 'Billed' labelled all-time | `verify-m27-invoices-collected` | 2 | 2 of 2 |
| M28 | AI quarter and 'top client' use the selected period | `verify-m28-ai-period-labels` | 3 | 3 of 3 |
| M30 | Health receivables = collected ÷ recognised, non-future billing | `verify-m30-health-receivables` | 1 | 1 of 1 |
| M31 | Recurring YTD cards = documents actually generated this fiscal year | `verify-m31-recurring-ytd` | 2 | 2 of 2 |
| M32 | Stock movements carry the business day (movement_date); COGS dated on it | `verify-m32-stock-movement-date` | 3 | 3 of 3 |
| M33 | Bank CSV import keeps genuine identical same-day rows | `verify-m33-bank-csv-identical-rows` | 4 | 3 of 4 |
| M35 | No fabricated 'Salary — X (April)' rows | `verify-m12-m13-m35-personal-figures` | 15 (shared) | (shared) |
| M36 | Business Investments card converts USD holdings to the entity's currency | `verify-m36-business-investments-currency` | 3 | 2 of 3 |
| M38 / M39 | Monthly buckets exclude future-dated rows (server and client) and use the KPIs' date fallbacks (client) | `verify-m-dashboard-server-books` (M38 server: Σ monthly = Year), `verify-m10-client-monthly-builder` | (in the 6 + 1 above) | (in the RED counts above). **M39's date fallback has no dedicated assertion** — fixed by reading the code, not executed in isolation |
| M40 | Backfill falls back to created_at for dateless rows (no reset abort); receipts too | `verify-m40-backfill-dateless-rows` | 4 | 4 of 4 |
| M42 | Run Payroll's run date is used | `verify-m42-payroll-run-date` | 2 | 2 of 2 |
| M43 | Forecast AR/AP net of credit notes / vendor credits; run-rate includes orphan payments | `verify-m43-forecast-credits` | 3 | 3 of 3 |
| M44 | API v1 summary uses the account's fiscal start; entity keys include NULL-entity rows | `verify-m44-api-summary-scope` | 2 | 2 of 2 |
| M45 | P&L 'Expenses' tile label matches its value | `verify-m45-pl-expenses-tile` | 2 | 2 of 2 |
| M46 | Cash card average over elapsed fiscal months | `verify-m46-cash-avg-monthly` | 2 | 2 of 2 |
| M47 | CLEARED — the Tax-Deductible report already bounds future dates (kept as a guard) | `verify-m47-tax-deductible-future` | 1 | 0 of 1 (passes on old code) |
| M48 | Bill 'Pay' opens the payment form: amount + date, partial payments, one writer | `verify-m48-m49-bill-pay-expense-date` | 12 (shared) | 10 of 12 (shared) |
| M49 | Add expense has a date field (default today) | `verify-m48-m49-bill-pay-expense-date` | 12 (shared) | (shared) |
| M50 | Deleting a business deletes its ledger in the same transaction | `verify-m50-entity-delete-ledger` | 5 | 1 of 5 |
| M34, M41 | HELD — owner decision (6.2) | — | — | — |

Every RED run failed with the **predicted bug value** printed beside the correct one (logs: one per harness).
The four tests whose seeds date stock movements (M6, M8, M16, M32) were re-run in their pre-M32 form against the
unfixed schema, so they measure the bug value instead of failing on the missing column:
M6 taxable **900** (correct 160) · M8 year COGS **80** (correct 160) · M16 cash out **30** (correct 100) ·
M32 sale dated **2026-10-10** (the server's real clock; correct 2026-07-20).

**Full sweep on the fixed tree: 494 / 494 GREEN, 0 RED** (`tests/harness/run-verification-sweep.js`,
sequential), before patch 27b. Re-run in full after 27b: see 6.1c. Baseline before the fix pass: 451 / 452 (only `verify-fc1-overdue-date.js` red, a structural
regex — see 6.4). The 42 extra harnesses are this pass's.

**Production instrument:** `prod-readonly-counts.js` gains read-only checks [M14] and [M13] (6.5). Executed on
scratch with one planted case each plus a control each. Each found exactly the planted row and not the control.

### 6.1b Independent validation (A1–A21 whole-app sweep and the browser items tool), and a regression it caught

- `sweep-businessA.js` (server, A1–A21 seeded through the real routes, October clock) on the fixed tree:
  Year revenue **2,140**, expenses **5,060**, net **−2,960**, outstanding **2,047**, overdue 1,697. That is
  the expected sheet.
- `client-items.js` (browser, the 14 client items): unfixed tree **14 / 14 DEFECT CONFIRMED** at the predicted
  bug value; fixed tree **14 / 14 CORRECT**. The tool was tightened to compare what each item means. Its old
  exact-string expectations could not match a correct screen:
  - M11 "not 0/100" is now a boolean.
  - M37 compares the net figure without the margin suffix.
  - M45 accepts the corrected caption.
  - M13's Car is entered in TTD. A row with no currency is legacy USD by definition.

  Its stock-movement seed now works on both schemas.
- `sweep-client.js` (browser dashboard, A1–A21) **caught a real regression in the dashboard fix**. The
  `/api/reports` overlay wrote Outstanding with the abbreviating formatter, so it showed **$2.0K**. The card had
  always shown the exact AR balance, **$2,047**. Fixed in patch `27b` (`S()`, exact) and re-verified: 4 / 4,
  `$2,047`. Running it also exposed a **tool fidelity bug**: jsdomBoot re-pins the server process to 25 Jul while
  the tool forces the browser to 9 Oct, so server and browser disagreed on "today". The old client recomputed on
  the browser's clock and matched by accident. The tool now pins both to 9 Oct; the unfixed tree still passes
  it, 4 / 4.

### 6.1c Full sweep re-run after patch 27b

`tests/harness/run-verification-sweep.js` on the final round-1 tree (with 27b and the tool fixes):
**494 / 494 GREEN, 0 RED.**

### 6.2 Held for an owner decision (design; not built) — SUPERSEDED: both built in round 2 (section 7)

**M34 — inventory purchase vs supplier bill.** Stock-in posts Dr 1200 Inventory / Cr 1000 Cash. A user who also
enters the supplier's bill gets the cost twice (bill opex now, COGS when sold) and cash out twice in the GL.
Proposal: stock-in asks "Paid by: Cash now / Supplier bill (on credit)". On credit, stock-in creates a bill
linked to the movement and flagged as an inventory purchase. That bill posts Dr 1200 / Cr 2000 AP, is
**excluded from operating expense** (the cost reaches the P&L once, as COGS when sold), and paying it settles AP
as today. Surfaces that must all exclude the flagged bill from opex (Rule 2): `computeBooks` opex,
GL bill posting, client `buildMonthlyArrays`, the expense breakdown, tax deductions, forecast run-rate.
Until then the safe workflow is: record the purchase as stock-in only, and pay the supplier as a payment made
linked to nothing. Do not also enter the supplier's bill.

**M41 — payroll withholdings.** Approve posts Dr 6100 / Cr 2200 at gross. Mark-paid posts Dr 2200 / Cr 1000
at **gross** (server.js `payroll_paid`). So the books assume the withholdings left the bank the same day as net
pay, and 2200 never shows tax owed. Totals agree once the tax is remitted; only the timing and the liability
are missing. Options:
- (a) Book net at mark-paid. Withholdings stay in a liability (2210 "Payroll withholdings payable") until a new
  "Remit withholdings" action pays them. This needs new UI, cash-flow report and forecast legs.
- (b) Keep gross, and label it on the payroll page: "withholdings are treated as paid with net pay".

FinFlow is estimates-only and has no remittance flow today, so (b) is the small honest step and (a) is a
feature.

### 6.3 Found during the fix pass — post-freeze list (fixed in round 2, section 7; M51 corrected there)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| M51 | S2 | Switching the **personal display currency** replaces the real net worth with a fabricated `baseNetWorth + 2 × period surplus`. `_updatePersCurrencyValues` (app-main.js, the currency-switch fast path, no wiring shadow) is a second writer of `pers-nw`, and of `pers-nw-chg` ("+surplus this month") beside `renderPersonal`'s real `computePersNetWorth` and snapshot delta. | EXECUTED (jsdom, `verify-m12-m13-m35-personal-figures.js` seed): accounts net worth USD 1,147.06 (TT$7.8K). After `setPersCurrency('TTD')` the tile showed **TT$10.9K** = (0 + 2 × 800 surplus) × 6.80. A page reload shows the right figure. |
| M52 | S3 | **Business expenses cannot be edited.** The edit wrapper (finflow-api-wiring-final.js) adds Edit buttons to `#expense-list tr / .expense-row`, but rows are `.tx-row` divs, so no button ever renders. Its save and populate code also reads `exp-desc` / `exp-date` / `exp-category`, which do not exist (the modal uses `bexp-*`), and it looks the row up in `window.expenses`, not `bizExpenses`. A wrong expense can only be deleted and re-entered. | CODE-READ (selector and id mismatch read from source; not executed). |

### 6.4 Existing harnesses whose expectations changed (each change is the fix, not a loosened test)

- `verify-reports-parity.js`: tax "taxable" 741 → **135**. This is M6: taxable income = net profit 131 + the
  4 of non-deductible expense rows. The old 741 deducted flagged expense rows only.
- `verify-gl-backfill.js`: 1800 → **1820** (opex 1,800 + COGS 20). This is M32: the sale is now dated the business's
  day (2026-07-25 under the pinned clock). The old 1800 held only because the sale was stamped with the server's
  REAL clock, a future day under the pinned clock, so its COGS fell outside the year.
- `verify-fc1-overdue-date.js`: its STRUCTURAL regex (the one pre-existing red in the baseline sweep) now
  points at the single overdue source, `computeBooks.arSummary` (M24).
- `verify-fx-client-consolidation.js`: the Entities "Consolidated" figure reads the server's consolidated
  books (`window._consolBooks`, M23). The harness sets them and asserts the null state shows "—".
- Accountant-journal fixtures in 7 harnesses (`verify-accountant-*`, `verify-e2e-full-lifecycle`,
  `verify-f90-accountant-audit`) now give each line an account code. M3: a journal line without an
  account cannot reach the ledger, so the route refuses it rather than saying "posted".
- Inventory fixtures (`verify-gl-post-inventory`, `verify-gl-statements`, `verify-quarter-intent`,
  `client-items.js`) set `movement_date` beside `moved_at` (M32).

### 6.5 Existing data — reported, not changed (Rule 8; each is a separate owner decision)

- **M14:** personal salary rows already created from the roster stay. Their recurring profile stops
  generating new ones. A run marked paid after deploy for a month that already has such a row would show
  both. `prod-readonly-counts.js` check **[M14]** counts them per account.
- **M13:** personal assets and liabilities saved before values had a currency are read as USD, which is
  exactly how they have always been shown. Check **[M13]** lists them. Re-enter any that were typed in
  another currency.
- **M32:** stock movements from before `movement_date` existed keep their old dating (the UTC day of
  `moved_at`).
- **M5:** imported Paid / Partial rows from before the fix have no payment rows. Production check M5a found
  none in the owner's real businesses (section 5).

---

## 7. Fix pass round 2, 2026-10-10 (M34, M41, M51, M52 + M54; held for owner approval)

Owner instruction: fix M34, M41, M51 and M52 to the industry standard (the QuickBooks / Xero model), same rules.
Each fix was RED on the round-1 tree and GREEN on the fix, run as targeted harnesses only. **The owner runs full
sweeps** (PowerShell). One fix per patch.

| # | Fix | Harness | GREEN | RED on the round-1 tree |
|---|---|---|---|---|
| M51 | **Corrected by execution.** The visible defect is that the personal assets / liabilities list kept the OLD currency after a display-currency switch. The fabricated net worth logged in round 1 is overwritten in the same tick and never reaches the screen: it was a latent second writer, seen only when a test called the internal function directly. Fix: one writer. `setPersCurrency` repaints through `renderPersonal` + `renderPersAccounts`; `_updatePersCurrencyValues` and `baseNetWorth` are deleted (asserted STRUCTURALLY, labelled) | `verify-m51-personal-currency-switch` | 10 | 2 of 10 (Car row `$1.0K`, correct `TT$6.8K`; structural) |
| M52 | Business expenses are editable. The Edit button is rendered by `renderExpenses` itself. Edit uses the Add modal's real `bexp-*` fields (incl. the M49 date) and saves by PUT, then the list refetches. Server: one rule set for create and edit (`_expenseRuleError`: a description, an amount above 0). The amount of an expense booked from a bank line cannot be changed (409: delete and re-book; M17 releases the line). | `verify-m52-expense-edit-server`, `verify-m52-expense-edit-ui` | 14 + 9 | 5 of 14 (an edit to 0 or a blank description stored; a create of 0 booked; a bank-matched amount changed) · no Edit button. Negative amounts and impossible dates were already refused by body-shape (kept as controls). |
| M41 | Withholdings are a liability until remitted. Mark-paid takes **net** pay out of cash; the withholdings stay in Payroll liabilities (2200). New **Remit** action (`PUT /api/payroll-runs/:id/remit`, date, lock- and idempotency-safe): Dr 2200 / Cr 1000. The same legs apply in the ledger rebuild, the cash-flow report (net on the paid date, withholdings on the remit date), the 13-week forecast (unremitted withholdings, estimated due date labelled) and void. The payroll page shows "Withholdings owed" with Remit. Runs paid **before** the fix (`paid_basis` NULL) keep their gross cash-out on every path, including a rebuild (Rule 8). | `verify-m41-payroll-withholdings`, `verify-m41-payroll-withholdings-ui` | 21 + 7 | 8 + FATAL (cash −2,000 vs −1,750; liabilities 0 vs 250; no remit route) · 2 of 7 |
| M34 | Stock bought **on credit**. Stock In → "Paid by: Supplier bill" creates the supplier's bill linked to the purchase (`inventory_movement_id`); the movement books Dr 1200 / Cr 2000. The bill posts nothing itself and is never opex. One shared rule, `FinFlowDates.isOpexBill`, is used by computeBooks opex and monthly buckets, the edit re-sync, the ledger rebuild, the consolidation elimination and the three client legs. Every bill still counts in AP. A purchase bill's amount, date and status come from the purchase (409 on edit / delete); vendor and due date stay editable. Bills page tags it "Stock". | `verify-m34-inventory-on-credit`, `verify-m34-client-opex-legs`, `verify-m34-stock-in-on-credit-ui` | 19 + 3 + 7 | 14 of 19 (cash −200 vs 0, AP 0 vs 200, opex 200, tax deductions 280 vs 80) · 3 of 3 (600 / $3.1K / "down 960%") · no "Paid by" |
| M54 | *(found in round 2; same contra mechanism, its own patch)* A ledger rebuild posted EVERY stock purchase Cr Cash, so opening stock (live: Cr 3100 Equity) became cash spent after a reset. Each purchase now stores its contra (`contra_code`); the rebuild uses it. Rows from before the column: reference "Opening stock" → 3100, else 1000 (no data change). | `verify-m54-opening-stock-rebuild` | 4 | 2 of 4 (rebuild cash −71 vs −21, equity 0 vs −50) |

Existing harnesses re-run on the round-2 tree, all GREEN:
- **Personal:** the round-1 personal-figures test.
- **Expense:** M4, M15, M48/M49, `c1-client-lock`, `dashboard-render`, `no-new-shadowing`.
- **Payroll (7):** M7, M14, M22, `payroll-paid-date`, `gl-payroll-cashout`, `payroll-state-guards`, `b4-4`.
- **Runs paid with deductions (13):** including `e2e-full-lifecycle`, `full-leg-parity`, `reports-parity` and `gl-backfill-full-leg`.
- **Bill / AP / inventory / GL (31):** including `gl-post-bill`, `consolidated-ap`, `stock-single-writer`, `gl-backfill` and `gl-statements`.

**Not run by me (owner's sweep):** the full sweep, and the A1–A21 tools. `sweep-businessA.js` pays a September run
with 10% tax, so after M41 its cash and balance sheet carry 200 of withholdings owed. Its P&L headline (2,140 /
5,060 / −2,960 / 2,047) is unaffected.

**Found in round 2, NOT fixed (logged for round 3):**

| # | Sev | Finding | Evidence |
|---|---|---|---|
| M53 | S3 | Personal net-worth history is keyed on the ACTIVE BUSINESS. `POST /api/snapshots/capture` stores a personal net-worth snapshot under `req.entityId`. `GET /api/snapshots` returns the unscoped rows plus the active business's rows. An owner with several businesses gets a personal "change this month" that depends on which business is selected, and a month can hold two rows. | EXECUTED (jsdom): seeding June/July snapshots with no business beside the app's own July capture under the active business gave `+$0 this month` instead of `+$300`. Read from `server.js` `/api/snapshots` (GET filter, capture upsert key). |

Commit-time note: index.html changes (M41 payroll UI, M34 stock-in, M49) need `npm run gen` output (`public/_gen`)
staged with them, as earlier client commits did.

---

## 8. Personal / business wall, 2026-10-10 (owner rule; held for owner approval)

**The rule (now in `CLAUDE.md` → Product facts):**
- **Business → Personal:** only ONE thing crosses — the owner's salary, as income, when a payroll run is marked PAID.
- **Personal → Business:** nothing, ever.
- Personal data is personal by WHAT IT IS, never by which business is active. The request middleware always
  resolves a business when one exists, so no personal route may take its scope from it.

Enumerated from both directions:
- **Code side:** every read and write of `personal_transactions`, `personal_accounts`,
  `recurring_personal_transactions`, `holdings`, `goals` and `snapshots`.
- **Surface side:** every Personal-page function that reads business globals, and every business surface that reads
  personal tables (AI context, API v1 and the accountant portal: clean).

| # | Crossing | Fix | Harness | GREEN | RED (before) |
|---|---|---|---|---|---|
| M55 | Personal page **wrote the business payroll roster** ("Monthly salary" card → POST/PUT /api/payroll) and showed roster figures: a "Synced from payroll" summary, an "Income from payroll" banner with a per-business breakdown, and an income caption "<business>: <roster net>". | Card, banner, breakdown and roster caption removed. `GET /api/personal-salary` (its only reader) removed. The owner's salary is set on the Payroll page only. | `verify-m55-personal-no-roster` | 5 | 4 of 5 |
| M56 | A bank line written from the consolidated "all businesses" view was stored entity-less and **landed in Personal**. Personal edit/delete accepted a **business** bank line. Business banking delete accepted a **personal** transaction or another business's line. | Bank-feed writers (manual, statement import, Plaid, Belvo) refuse a business-context request that resolves no business. Personal routes touch entity-less rows only. Banking delete is limited to the scope in view. An account with **no business** keeps its personal bank feed (by design). | `verify-m56-bank-feed-is-business` | 10 | 8 of 10 |
| M57 | Bank reconcile **match / match-batch** accepted a personal transaction (or another business's line) and matched it to a business invoice payment. The matched list was unfiltered, showing personal and other businesses' matches. | A bank line of the business in view only, matched to that business's payment. The matched list is filtered to that business. | `verify-m57-bankrec-match-scope` | 8 | 6 of 8 |
| M58 | A holding saved **without a scope** was filed under the active business; an unscoped list **merged** personal and business. | No scope ⇒ personal; business only with `scope=business`. | `verify-m58-holdings-scope` | 5 | 5 of 5 |
| M59 | Personal accounts tagged with a business by the old POST (kept, Rule 8) showed, and counted in net worth, only while that business was selected. | The list and the net-worth snapshot read all of the person's accounts (as the accountant portal already did). | `verify-m59-personal-accounts-any-business` | 2 | 1 of 2 |
| M53 | Personal net-worth / portfolio snapshots were stored under the active business; the history read "personal + the active business". The series and "change this month" depended on the business switcher, and a month could hold two rows. | One personal row per period. History reads every snapshot of the person: the personal row per period, else the most recently saved. | `verify-m53-personal-snapshots` | 3 | 3 of 3 |

Corrections made while doing this (Rule 14: execution overruled reasoning):
- **M56's first version was wrong.** It treated every bank line as business data. `verify-f54-team-scope`
  (existing) failed: bank connections are per scope by design, and an account with no business uses the bank feed
  as its personal feed. Re-scoped to the actual crossings above.
- **`verify-f101-batch-match`'s fixture** seeded bank lines with **no business** and matched them to a business's
  invoice payments: the M57 breach itself. It now stamps them with the business, as production does. It is green on
  the old and new code, so the fixture change masks nothing.
- **`verify-owner-salary-per-entity`** drove the removed Personal salary card. It now drives the Payroll page's
  owner form with the same seed and guarantee (N60), plus a wall assertion.

Harnesses re-run on the result, all GREEN:
- Banking, Plaid and Belvo (22, incl. `tenant-isolation` 47/47 and `entity-leakage-sweep` "ALL SCOPED").
- Personal, net worth and snapshots.
- Holdings, including `f154-investments-entity-switch-leak` and `team-member-writes`.
- Reconcile.
- UI guards: `slim-boot-renders`, `dashboard-render`, `no-new-shadowing`, `boot-failures-gate` 19/19.

The full sweep is the owner's.

**Existing data — reported, not changed (owner decision):** personal salary rows the old roster sync created (not
from a paid run). Under the wall rule they should not be in Personal, but they may record salary that was really
taken. `prod-readonly-counts.js` [M14] counts them per account. Legacy rows filed under a business (bank lines from
the all-view, personal accounts, snapshots) are read by the rules above, without rewriting any row.

## 9. Personal bank feed, 2026-10-11 (owner request; held for owner approval)

Owner: "personal needs its own bank and api regardless".

| # | Defect | Fix | Harness | GREEN | RED (before) |
|---|---|---|---|---|---|
| M60 | A person with a business had **no personal bank feed**. Every bank route (Plaid, Belvo, statement import, manual line, delete, unlink) took its scope from the business in view. A bank linked "for Personal" was stored under the active business (personal → business), listed on its Banking page, and absent from Personal. Import / Plaid / Belvo dedupe looked across all of the user's scopes, so a statement already imported into a business was skipped in Personal ("already there"). Personal bank-feed rows saved as `credit` / `debit` (an account with no business) were in **no** Personal total, and the accountant portal counted a personal `credit` as **spending**. The "all businesses" view listed, and could unlink, Personal's bank. | Bank routes take an explicit `scope=personal` (query or body), never inferred from the active business. Personal rows are keyed to the person (`user_id` = session user, no business) and written as `income` / `expense` (bank direction kept as `bank_direction`). Linking one's own personal bank does not need the business `bank:manage` permission. Dedupe is per scope. A personal Belvo widget session is its own (`belvo:personal`). The "all businesses" view lists no bank and cannot unlink or disconnect one. New `GET/PUT /api/personal-bank` (the person's bank country — it picks Belvo / Plaid / manual and the day/month order of an imported CSV). One reading of a personal row's type, `FinFlowDates.personalTxType`, used by the Personal page and the accountant portal (its SQL sum mirrors it). Personal page: new **Your bank** card (country, Link bank, Import, Sync, Unlink). The region rule is one function, `ffBankRegion`, shared with the business Banking page. | `verify-m60-personal-bank-feed` (server, Plaid + Belvo mocked at HTTP only) · `verify-m60-personal-bank-ui` (jsdom) | 39 · 11 | 23 of 39 · 6 of 11 (then FATAL: no card) |

Portal reader isolated (Rule 14): the fixed tree with only the old `accountant-routes.js` put back gives
`[2130, 371.05]`, exactly the stated bug value, against the correct `[2380, 121.05]`.

Existing harnesses changed. Each change follows the fix; none is a loosened test:
- `verify-connections-isolation` and `verify-connections-entity-scope` reached Personal's Plaid items and Belvo status
  through the "all businesses" view (`?entity_id=all`). That view is a business surface: under the wall it lists no
  bank, which is now asserted. Personal's bank is read through its own scope (`?scope=personal`), with the same
  guarantee as before (Personal keeps its own connection, and a business disconnect leaves it untouched).
- `verify-banking-region-routing`: the region rule moved from `ffBankLinkFromPage` to the shared `ffBankRegion`. The
  harness installs and executes all three functions; the source check is labelled STRUCTURAL.

Data: pre-M60 personal bank-feed rows saved as `credit` / `debit` are read correctly and not rewritten (Rule 8).
`prod-readonly-counts.js` [M60] counts them.

Limits (stated, not assumed):
- Plaid and Belvo were exercised against HTTP mocks, not their sandboxes; no live link was made.
- A team member's personal feed is keyed to that member's own user. That follows from the code; it was not executed.
- The Personal card's file picker (Import) is not driven in jsdom. The import route it calls is executed with
  `scope=personal` in the server harness, and the client's `scope` is executed for Link and Plaid.

### M61, found during M60, then fixed (owner: "fix it")

| # | Defect | Fix | Harness | GREEN | RED (before) |
|---|---|---|---|---|---|
| M61 | Bank-reconcile actions looked the bank line up by user only. From business A: **book-expense** booked B's bank line as an expense in B's books; **match-bill** paid B's bill from B's line; **ignore** (no scope check at all) stamped `reconcile_state: 'ignored'` on a **personal** bank line (business → personal write) or on B's line; **unmatch** (`DELETE /api/bank-reconciliation/:id`) deleted B's match. The M57 class: match / match-batch were limited in M57, and these four routes were not. | One rule, `_bankLineInView`, used by every one of these actions: the line must belong to the business in view. A personal line is refused as personal (`PERSONAL_TXN`, as book-expense already did); another business's line is not found (404). The check runs before the "already actioned" short-cut, so another scope's line is not even reported. Unmatch deletes only a match whose bank line belongs to the business in view. | `verify-m61-bankrec-actions-scope` | 19 | 15 of 19 (the 4 that pass are controls) |

Seed (Rule 4): each wrong action has its own B line (140 / 155 / 170), so one wrong action cannot mask the next. The
first run used one shared B line, and two checks were masked by it; the seed was corrected before the fix was written.
A control makes the browser's call (no `entity_id`; the server resolves the active business) and checks that it still
works for the business's own line and still refuses B's.

Re-run GREEN: every harness that calls these routes (`bank-money-out` 20, `gl-bankrec` 11, `m17-bank-line-release`,
`f101` ×2, `f117`, `bill-payment-check`, `lock-external-dates`, `m52-expense-edit-server`, `plaid-sync-changes`,
`f54-team-scope`, `bankrec-render`), plus `m56`, `m57`, `m60`, `tenant-isolation` 47/47 and `entity-leakage-sweep`
"ALL SCOPED". Not run: `f86-payments-source-instrument` and `step3-gate` (an instrument and a sweep gate, not
behaviour harnesses).

Data: matches or reconcile stamps already made across scopes are not changed (Rule 8). Once the owner wipes the
database, there are none.
