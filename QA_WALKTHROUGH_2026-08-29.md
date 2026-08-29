# QA WALKTHROUGH — full live app audit, 2026-08-29 (prod: finflow-production-dab2.up.railway.app)

Method: every page visited in the browser + live data model inspected (window._realInvoices, ENTITIES,
etc.) to check the money figures actually **reconcile**. Active entity: Saige Holdings LLC. Today: 2026-08-29.

## ✅ Verified WORKING (don't re-touch)
- **All 45 pages render, zero console errors.** No blank/broken tabs.
- **Entity scoping is correct** — Saige (13 invoices, $41,550) → Acme (0, $0, no leak) → back to Saige (restored). No cross-entity leakage.
- **Mapper fix (`f9792d8`) is live** — active entity carries `opening_cash:10000`, `timezone:America/New_York`, `country:US`. Persists across reload.
- **Scheduled Documents (our B1–B5 + Phase 3/4) all live and correct**: runway active ("Projected cash balance · from opening $10,000", stays positive), F88 chips show America/New_York + US, agenda "This week" section, honest create modal ("New recurring invoice · Creates a repeating schedule"), missed-band wired.
- **Doc view renders** (letterhead, BILL TO, line items, PAID badge, dates formatted "16 Aug 2026").
- **Dashboard revenue reconciles**: Consolidated Revenue $30.6K = recognized billed $31,550 − credit note $1,000 ✓. Server-side money is D2-correct.
- **Write/persist path works** (Adobe invoice + opening_cash both persisted).

## ❌ DEFECTS (priority order)

### HIGH
1. **D2-BILLED — invoice "Total Billed" counts a future-dated invoice.** [owner's flagged "reemergence"]
   Invoices page shows **Billed $41,550** (includes the future Adobe $10k, issue 2026-08-31); should be
   **$31,550**. Outstanding ($2,000) is correct (excludes future via `_arOutstanding`), and the **server**
   excludes future from every figure (`server.js:6312`) — so Total Billed diverges from both. The collection
   **%** is also wrong/unstable: seen as **71%** (29,550/41,550) and **94%** (29,550/31,550) on different
   renders → two renderers fight over `inv-paid-pct`. Net: Billed $41,550 with "94% collected" don't math out.
   • Fix: in the invoice KPI renderer (`public/finflow-api-wiring-postgres.js`, bundle line ~5905), filter
     `invs` to the recognized non-future set once (`issue_date ≤ today`, status in pending/overdue/partial/paid)
     and compute Billed + Collected + % + Outstanding from it — matching `_arOutstanding` and the server.
     Bundle source → `node bundle.js` regen. Harness: seed paid + unpaid + future invoice, assert
     Billed − Collected == Outstanding and future excluded from Billed until its date.

2. **INVEST-DAYCHANGE — Investments "Day's Change" is mathematically impossible.**
   Personal Investments: **Day's Change −$180.0K / −225% today** on an $80K portfolio. Biz-investments shows
   Day's Change "—" with "0.44%". You can't lose 225% in a day. Likely a broken day-delta calc (wrong base,
   or simulated live-price seed). Alarming + untrustworthy. Investigate the day-change computation on both
   investment surfaces.

### MEDIUM
3. **DATE-ISO — raw ISO timestamps shown as dates.** payments-received and FX render
   `2026-08-16T00:00:00.000Z` instead of "16 Aug 2026". The doc-view formats correctly, so these cells just
   aren't using `FinFlowDates.fmtLabel`. Fix those date cells.
4. **DOCVIEW-BALANCE — paid invoice shows "Balance Due $150.00" (should be $0).** The doc-view "Balance Due"
   doesn't net `amount_paid` for paid/partial invoices.
5. **BUDGET-LOGIC — "Spent $2,600 / 520% used / Over budget"** counts the Rent expense ($2,600) against a
   Marketing-only $500 budget. Total spend vs single-category budget is misleading — decide total-vs-total or
   per-category only.
6. **SCENARIO-RUNWAY — "Cash runway 0 mo"** on the scenario planner despite +$26.9K net profit and $10k cash.
   Runway calc looks wrong (treating profit as burn, or divide error).
7. **FX-DUP — three identical "USD → TTD 6.7900 · 2026-07-21" rows** on the FX page. Duplicate rate data or a
   render dup — check dedupe.

### LOW / polish
8. **REPORTS-LABELS** — Reports KPI cards mislabeled: "Last Generated $30.6K" (that's Revenue), "Scheduled
   $27.0K Net profit" (label/value mismatch). Values are right, labels are wrong.
9. **MRR-DISCREP** — MRR page shows **$919**; recurring monthly value is $1,000 and the consolidated card
   showed $1,000. Reconcile the MRR basis.
10. **INVENTORY-COGS** — Inventory shows "COGS this month $1,000 (MAC)" but "COGS Summary (FIFO) Total COGS
    $0.00" — two methods disagree on one page.
11. **BILLS-LABEL** — Bills "Total Bills 1 / Unpaid balance" is ambiguous (the one bill is paid; unpaid
    balance is $0).
12. **PENDING-NO-VIEW (UX)** — pending/unpaid invoices show Record Payment/Pay link but no "View" button;
    only paid invoices have View. Consider allowing view of a pending invoice.

## DATA-ENTRY QA (part 2 — pushed real data through every create flow)
Created a record in ~20 modules via the real save handlers, reloaded, and confirmed **all persisted
server-side and scoped to the active entity**. No console errors, no broken pages under the new data.

- **New entity**: "ZZ QA Entity" (CAD) created, switchable, **fully isolated** ($0 ledger; Saige restored). ✓
- **Create → save → persist → scope: ALL WORKING** — invoice, customer, vendor, quote, sales-receipt,
  credit-note, vendor-credit, bill, expense, payment-made, recurring-bill, recurring-invoice, project,
  item, inventory-product, chart-of-account, payroll-employee, investment-holding, timesheet, goal.
- **Correct validation/guards (NOT bugs)**: manual journal requires ≥2 balanced lines; standalone
  "Payment Received" is intentionally retired ("record against its invoice instead"); FX add requires both
  currencies.

### New defects found during data entry
- **ENTITY-REGION (MEDIUM):** the "+ Add entity" modal's **Timezone & Country dropdowns are empty** (only a
  blank option) unless the Scheduled-Documents page has run `_f94FillRegion` first. So a business created
  from the Entities page saves with **null timezone/country → F88 holiday/timezone scheduling inactive** for
  it. Fix: call `window._f94FillRegion()` when `openAddEntityModal()` opens (it populates 40 tz / 54 country
  options). Confirmed live: dropdown had 1 option before the fill call, 40/54 after.
- **COA-UNDEFINED (LOW):** a Chart-of-Accounts row renders the literal **"undefined"** when an account field
  is missing ("undefined ZZ QA coacode …"). Defensive-rendering gap — show '' / '—' instead. Totals stay
  correct ($0). Possibly induced by a minimally-filled test account; verify with a fully-filled one.

### 🧹 CLEANUP — test data to delete (all labelled "ZZ QA", all under **Saige Holdings LLC**, entity_id 1)
Deletes are owner-only (I can't delete data). Remove via each page's ✕:
invoice "ZZ QA TEST — delete me" ($500, id 19) · customer · vendor · quote · sales-receipt · credit-note ·
vendor-credit · bill · expense · payment-made · recurring-bill · recurring-invoice ($300) · project · item ·
inventory product · COA account · payroll employee (ZZ QA empfname/emplname) · investment holding (MSFT) ·
timesheet entry · goal. **Plus the entity "ZZ QA Entity" (id 4)** on the Entities page.
Tip: most list pages let you spot them by the "ZZ QA" prefix.

## Suggested fix order
D2-BILLED first (it's the owner's flagged regression and the trust-critical one), then INVEST-DAYCHANGE, then
the MEDIUM batch (date formatting, docview balance, budget, scenario, fx-dup), then LOW polish. Each with a
discriminating harness that exercises the **real** data/render path, not stubbed globals (that stubbing is
what let D2-BILLED and the earlier mapper bug pass a green sweep).
