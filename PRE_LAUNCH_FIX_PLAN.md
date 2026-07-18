# FinFlow — Pre-Launch Fix Plan (Accounting-Grade)

_Compiled from the debugging session. Covers every issue found, with exact file/line locations and step-by-step remediation. Each fix is written to the standard a real accounting system is held to — not just "make the screen populate," but "make the books correct, consistent, and defensible." No code has been changed; this is the work order._

---

## Part 0 — The foundations a real accounting app must have

Most of the individual bugs below share one root cause: **FinFlow currently treats each screen's data as an independent array and sums those arrays in three different files to produce totals.** Real accounting software does not work this way. Before (or alongside) the point fixes, these principles should drive the design, because they turn a pile of CRUD pages into an actual ledger.

1. **A double-entry general ledger is the single source of truth.** Every financial event (invoice, payment, expense, payroll run, FX settlement, credit note) posts balanced debits and credits to accounts in the Chart of Accounts. The P&L, Balance Sheet, Cash Flow, Dashboard KPIs, Tax, and MRR are all *derived from the ledger* — never computed by ad-hoc summing. This single change eliminates the three-file drift and the double-counting described in Issue #1.

2. **One explicit accounting basis, applied everywhere.** Decide cash vs. accrual and apply it consistently:
   - *Accrual:* revenue is recognized when an invoice is **issued** (Dr Accounts Receivable, Cr Revenue). A later payment is **settlement**, not new revenue (Dr Cash, Cr Accounts Receivable).
   - *Cash:* revenue is recognized when **money arrives** (payment received / sales receipt). An unpaid invoice is not yet revenue.
   - Either way, **a given dollar is recognized exactly once.** The current code recognizes it twice.

3. **Contra accounts, not deletions.** Credit notes reduce revenue via a contra-revenue account and stay **linked to the original invoice**; vendor credits reduce payables/expense. You never silently drop a number — you post an offsetting entry that remains auditable.

4. **The audit trail is immutable and complete.** Every create/update/delete of a financial record writes an append-only entry (who, when, table, record, field, old value, new value, IP). Entries are never editable or deletable. This is a baseline expectation for any system that touches money (and a hard requirement under SOX/GAAP-style controls).

5. **Segregation of duties via real, server-enforced roles.** Permissions are enforced on the server, not just hidden in the UI. A viewer cannot post journals; only authorized roles can run payroll or delete records.

6. **Reconciliation ties the ledger to reality.** Bank feeds/statements are reconciled against ledger cash; unreconciled items are visible.

7. **Never fabricate a financial figure.** No hard-coded tax rates presented as fact, no invented "75% paid," no phantom $0. If a number can't be computed from real data, it is labeled an estimate or shown as "—".

The point fixes below are grouped by launch severity. Where a fix has an "Accounting-grade standard," that is the bar to hit — the minimal patch is noted too, but the standard is what makes this trustworthy as an accounting product.

Severity: **P0** = blocks launch (wrong money or fabricated figures) · **P1** = fix before launch (broken/incorrect feature) · **P2** = polish.

Cross-cutting reminder: KPI math is duplicated in `public/app-main.js` (`computeRevenue` ~1620-1644, `computeExpenseBreakdown` ~1580-1612), `public/finflow-bundle.js` (`updateKPIs` ~5155-5165, `buildMonthlyArrays` ~5085-5105), and `public/finflow-api-wiring-dashboard.js` (~74-149). Until it's consolidated (Foundation #1), every KPI change must land in all three.

---

## P0 — Must fix before launch

### Issue #1 — Revenue is both under-counted AND double-counted (the core accounting defect)
**Two problems, same code.**
- **Double-count:** `computeRevenue` (app-main.js:1636-1644) adds *paid invoices* **plus** *payments received* **plus** *sales receipts*. Payments received are linked to invoices via `invoice_ref` (finflow-bundle.js:2981, 3594). So marking an invoice paid and recording its payment counts the same dollar twice. There are even two parallel payment stores — `/api/payments-received` (server.js:2114) and `/api/invoice-payments` (server.js:3423) — compounding it.
- **Under-count:** separately, the receipts/payments arrays are read from underscore globals that are never set (`window._receipts` app-main.js:1627, `window._paymentsReceived` 1628, `window._paymentsMade` 1598), so today they contribute $0.

**Accounting-grade standard:**
1. Choose the basis (recommend **accrual** for a business ledger; expose a cash-basis toggle for reports/tax).
2. Recognize revenue **once**:
   - Accrual: revenue = invoices at issue (Dr AR / Cr Revenue) + sales receipts (cash sales: Dr Cash / Cr Revenue). Payments received are **settlement of AR** (Dr Cash / Cr AR) and must **not** add to revenue.
   - Cash: revenue = payments received + sales receipts only; unpaid invoices excluded.
3. Collapse the two payment stores into one AR-settlement concept so a payment always references the invoice it settles.
4. Derive the KPI from the ledger, not three array sums (Foundation #1).

**Minimal patch (if ledger work is deferred):** pick cash OR accrual in `computeRevenue`; if accrual, stop adding `paymentsIn` to revenue (treat it as AR settlement) and keep invoices+receipts; if cash, count payments+receipts and drop paid-invoice recognition. Fix the underscore-alias so whichever arrays you *do* use are actually populated (alias `_receipts`/`_paymentsReceived`/`_paymentsMade` to their plain names in app-main.js). Apply in all three compute copies.

**Test:** issue a $1,000 invoice, mark it paid, record its payment. Revenue must rise by **$1,000, not $2,000.** A $500 cash sales receipt adds $500. Reconcile the dashboard total against a hand-built P&L.

### Issue #2 — Data only appears after a manual refresh (boot race → data-integrity risk)
**Symptom:** pages load empty; refresh fixes it. In an accounting app, "sometimes the screen is empty / sometimes stale" is a data-integrity problem, not just UX.
**Root cause:** four uncoordinated boot paths race to load entity data; `ff:authed` fires before data is awaited; the loader silently drops overlapping calls.
- Racing callers of `loadEntitiesFromDB`: app-main.js:1193, 609, 660; finflow-bundle.js:5484-5493; finflow-api-wiring-dashboard.js:469-479 (per-file `_booted` guards don't coordinate).
- `ff:authed` dispatched before `await`: app-main.js:1191-1193 (also doLogin 606-609, doRegister 657-660).
- `_heavyInit` renders ~28 sections on `ff:authed` while arrays are empty: app-main.js:5571-5611.
- Drop-guard: app-main.js:1255.

**Accounting-grade standard:** loads should be **deterministic and atomic** — a single coordinated bootstrap per session, each entity-scoped fetch completes before render, and switching entities never shows another entity's figures even for a frame (critical when numbers are money).

**Fix steps:**
1. Convert the drop-guard to a queue: store the latest requested `idx` and re-run in the `finally` (app-main.js:1255 + finally ~1436).
2. Dispatch `ff:authed` **after** `await loadEntitiesFromDB()` in all three auth paths.
3. Collapse to one bootstrap; remove/neutralize the two 600 ms timer boots (finflow-bundle.js, finflow-api-wiring-dashboard.js) or gate them on one shared `window._booted`.
4. **Test:** hard-refresh 5+ times logged in, and immediately after login; every page shows correct entity-scoped data with no manual refresh and no cross-entity flash.

### Issue #11 (NEW) — Tax Filing shows fabricated numbers
**Symptom:** Tax Filing (badged "NEW") displays "Tax paid YTD" and "Amount due" that are invented.
**Root cause:** `calcAndRenderTax()` (app-main.js) ignores the `/api/tax-filing` backend and computes locally with a **flat 25% rate** and a hard-coded **`ytdPaid = liability * 0.75`** — i.e. it *assumes* you've paid 75% of your tax, with no basis.

**Why P0:** presenting a made-up "amount due" in a tax screen is the kind of thing that erodes trust instantly and can cause real harm if acted on.

**Accounting-grade standard:** tax must be computed from actual ledger figures using the correct jurisdiction/entity rates and real recorded tax payments, or explicitly presented as a rough estimate with assumptions shown. Never display an invented "paid" figure.
**Fix steps:**
1. Drive taxable income from the ledger (revenue − allowable deductions) on the chosen basis.
2. Replace the flat 25% with real rate logic (entity type / jurisdiction; at minimum a user-set effective rate).
3. Source "paid YTD" from **actual recorded tax payments**, not a 0.75 multiplier. If none exist, show $0 paid.
4. Wire the page to `/api/tax-filing` so estimates persist and are auditable; label the screen "Estimate" until real filing logic exists.
5. **Test:** with no tax payments recorded, "paid YTD" is $0 and "due" equals the full computed liability; add a payment and confirm it reduces the balance.

---

## P1 — Fix before launch

### Issue #3 — Multi-entity paywall is bypassable and unenforced
- Gated: `openAddEntityModal` app-main.js:4241. Bypass: `openAddBizModal` app-main.js:418 (sidebar index.html:1081). No server check: `POST /api/entities` server.js:785.
**Accounting-grade standard:** entitlements are enforced server-side; the client gate is only convenience.
**Fix:** enforce plan + entity-count in server.js:785 (return 402/403); route both client buttons through one guard that renders the upgrade modal on 402/403; gate on "not Business," not `==='pro'`. **Test:** non-Business + 1 entity → both buttons blocked; direct API POST → 402.

### Issue #4 — Audit Trail reads the wrong table and covers almost nothing
- Page reads `/api/audit-trail` → `audit_trail`, written by only 2 of 132 endpoints (server.js:3434, 3576), with no field/old/new values. Real history goes to `audit_log` via `logAudit()` — 12 sites (server.js:752 def; 835,852,860,878,895,903,1433,1448,1499,1523,1608), read by `/api/audit-log` (1582).
**Accounting-grade standard:** a **complete, immutable, field-level** audit log covering **every** create/update/delete of financial data — user, timestamp, table, record, field, old→new, IP — with no ability to edit or delete entries. This is non-negotiable for an accounting system.
**Fix steps:**
1. Standardize on one append-only audit table with field-level diffs; make the page read it.
2. Route every financial mutation through one audit helper (extend from ~12 endpoints to full coverage: invoices, expenses, customers, items, inventory, quotes, credit notes, vendor credits, payroll, entities, team, settings).
3. Enforce immutability (no UPDATE/DELETE on audit rows; DB-level if possible).
4. **Test:** edit an invoice amount, a customer, an expense; each yields one dated row with correct old→new; confirm rows can't be altered; filters work.

### Issue #5 — Quotes don't become invoices (broken document lifecycle)
- No convert-to-invoice exists. "Value (open)" counts pending only (finflow-api-wiring-pages.js:83,88). Three conflicting quote wirings (pages.js / stubs.js / bundle.js) compute the value card differently.
**Accounting-grade standard:** a proper sales document lifecycle — **Quote → (accepted) → Invoice → Payment** — with each document linked to the next for traceability, and no revenue recognized until an invoice (accrual) or payment (cash) exists.
**Fix steps:**
1. Add "Convert to invoice" on accepted quotes (POST a linked invoice; optionally auto-convert on acceptance) and keep a quote→invoice reference.
2. Define "open value" (pending, or pending+accepted-not-yet-invoiced) and label it accordingly.
3. Collapse the three quote implementations into one.
4. **Test:** accept → convert → invoice created and linked; Revenue/AR update per basis; cards agree regardless of load order.

### Issue #6 — FX "Settle" button is dead
- `settleFXTransaction()` index.html:4600 returns early before any logic; no detail view to enter the rate. Backend `POST /api/fx-transactions/:id/settle` (server.js:3940-3955) works.
**Accounting-grade standard (IAS 21-style):** open FX positions carry an **unrealized** gain/loss at period-end; on settlement the **realized** gain/loss posts to the P&L. Both must flow into the ledger and FX cards.
**Fix steps:**
1. Add a settlement-rate modal; wire `settleFXTransaction` to POST `{ rate_at_settlement }`.
2. Post the realized gain/loss to a "Foreign Exchange Gain/Loss" P&L account (ledger).
3. Refresh via `loadFXData()`. **Test:** open position → settle → status settled, realized G/L on P&L, Net FX card updates.

### Issue #7 — Team members are fabricated from payroll (no real access control)
- `GET /api/team` synthesizes team rows from payroll with fabricated emails and auto-roles (Full-time → accountant) at server.js:2325-2351; ids `p<id>` aren't in `team_members`, so edits 404.
**Accounting-grade standard:** access control is explicit and enforces **segregation of duties** — real invited users with server-enforced roles; an employee existing on payroll must never silently gain "accountant" access.
**Fix steps:**
1. Stop deriving team members from payroll (drop the `...pay.map(...)` block, server.js:2325); list owner + invited members only.
2. Enforce roles server-side on every financial route (Foundation #5).
3. **Test:** team list shows only real users, all editable; a payroll employee has no app access unless explicitly invited.

---

## P2 — Polish before launch

### Issue #8 — Items/Inventory: reorder threshold promised but absent, and inventory is two parallel systems
- Item modal has no reorder/max field (index.html:3382-3391); `saveItem` omits them (finflow-api-wiring-medium.js:923). Items "Low Stock" is a manual status (app-main.js:4485). Real reorder logic lives only in the separate Inventory backend, hard-coded to 10% of max (default 200): server.js:945,954,966,3805.
**Accounting-grade standard:** one inventory system with proper **valuation (FIFO/COGS — already partially present)**, per-item reorder points, and stock movements that post to inventory/COGS accounts in the ledger.
**Fix:** unify Items and Inventory; add `reorder_point` (+ optional `max`) to the model and form; compute Low Stock from `units < reorder_point`; ensure stock in/out posts COGS. **Test:** set reorder point, drop below it, item flags Low Stock; a sale reduces stock and books COGS.

### Issue #9 — Gross column renders black/invisible on payroll
- Gross span sets no color (app-main.js:2230); `body` (index.html:149) and `.card` (430) declare none, so it inherits default black.
**Fix:** add `color:var(--t1)` to app-main.js:2230; set a base `color:var(--t1)` on `body`. **Test:** legible in dark and light themes.

### Issue #10 — Credit Notes / Vendor Credits not applied; recurring items and compute drift
**Accounting-grade standard:** credit notes are **contra-revenue linked to the original invoice**; vendor credits are **contra-AP/expense**; both post to the ledger and appear on statements. Recurring invoices/bills are **schedules that generate real documents on their run date** — they are not themselves recognized until they generate an invoice/bill.
**Fix steps:**
1. Apply credit notes as contra-revenue (data at finflow-bundle.js:3007-3011) and vendor credits as contra-expense/AP (3167-3171), linked to source documents, in the ledger and all KPI copies.
2. Make recurring profiles generate actual invoices/bills on schedule (server-side job) rather than sitting inert; recognize only the generated documents.
3. Consolidate the three KPI compute copies into the ledger-derived model (Foundation #1).

### Issue #12 (NEW) — Banking is a "Coming Soon" placeholder
- `#page-banking` (index.html:1935-1947) is a static "Bank Sync — Coming Soon" card requiring Plaid env vars; the sidebar item leads nowhere functional.
**Accounting-grade standard:** bank feeds exist to enable **reconciliation** (Foundation #6). Either ship the Plaid integration wired to Bank Rec, or hide the nav item pre-launch so the product doesn't advertise a dead feature.
**Fix:** hide/disable the Banking nav entry until Plaid is configured, or complete the integration and connect imported transactions to Bank Rec. **Test:** no dead-end nav items in the shipped build.

### Issue #13 (NEW) — Templates is a static mockup
- `renderTemplates()` renders a hard-coded `invTemplatesData` array (app-main.js:4960); nothing calls `/api/templates` (GET/DELETE orphaned), so Preview/Edit don't persist.
**Fix:** wire Templates to `/api/templates` for real CRUD/persistence, or mark it not-ready and hide it. **Test:** create/edit a template, reload, changes persist.

### Issue #14 (NEW) — Client Portal is vaporware (no backend at all)
- Under the "CLIENTS" header, presented as a real client-facing feature. `renderPortal()` maps over `PORTALS = []` (index.html:5982), commented "populated from DB" — but **nothing ever fetches it, and there is no `/api/portal` (or any client-portal) route on the server** (zero matches). The only way an entry appears is `addPortal()` pushing an in-memory object "New Client N" with hard-coded `$0 / $0 / Never` (index.html:6013-6016), lost on refresh. Portal links point to `portal.finflow.io/client/{slug}` (a destination that doesn't exist); "Send email" fires a toast and sends nothing.
**Why P1:** advertising a client portal that doesn't exist — with fake links a user might share — is a real credibility/trust risk.
**Accounting-grade standard:** a client portal exposes real, read-only, permission-scoped statements (outstanding balance, paid history, invoices) backed by actual data and authenticated per-client links. Anything less should not be shown.
**Fix:** either build it (server routes for per-client portal data + real tokenized links + real email send) or **hide the CLIENTS section and Client Portal nav item** until it exists. **Test:** no shareable link resolves to a non-existent page; nothing claims to email a client without doing so.

### Issue #15 (NEW) — API Connections is a static catalog; "Connect" doesn't connect
- The Connections page renders a large hard-coded list of integration names/categories (index.html:2230+ — dozens of processors) as cards. There's no `/api/connections` wiring; the buttons don't perform real OAuth/connection. Only the Stripe "live feed" has any motion, and it's a demo.
**Impact:** lower severity (clearly aspirational), but it presents ~30 categories of integrations as if connectable when none are.
**Fix:** mark the catalog "Coming soon," or implement real connection flows for the few you actually support (e.g., Stripe) and hide the rest. **Test:** every "Connect" either works or is clearly labeled unavailable.

### Note — Cash Flow works but inherits the revenue basis
`renderCashflow()` → `updateCashflow()` computes from the local period data (real invoices/expenses), not the `/api/cashflow` endpoint (which is orphaned). It functions, but it inherits the recognition/double-count basis from Issue #1 — fixing #1 correctly makes Cash Flow correct too.

### Note — Scenario Planner can't save
The Scenario Planner is a legitimate what-if calculator driven by its sliders and your base figures, but it cannot persist a scenario — `/api/scenario` and the scenario snapshot endpoints are orphaned. Acceptable for launch; just be aware "save scenario" isn't wired.

### Note — MRR uses `/api/recurring-invoices`, not `/api/mrr`
MRR works (computes from active recurring invoices) but the `/api/mrr` endpoint is orphaned dead code. Low priority: either delete the endpoint or point the feature at it for consistency.

---

## Part 2 — Complete side-panel status (every nav item)

Definitive audit of all 40+ nav destinations so nothing is ambiguous. "Works" = real backend + persistence; caveats noted.

**MAIN**
- Dashboard — Works, but numbers affected by Issue #1 (double-count + under-count).
- Banking — **Placeholder** ("Coming Soon" card; needs Plaid). Issue #12.
- Bank Rec — Works (`/api/bank-reconciliation`).
- FX / Currency — Works, except **Settle is dead** (Issue #6).

**MONEY IN**
- Invoices — Works. · Customers — Works (boot-race #2). · Quotes — Works as CRUD, but **no convert-to-invoice** and inconsistent value card (Issue #5).
- Payments Received — Works as a page, but **feeds the double-count** (Issue #1). · Sales Receipts — Works, feeds revenue (Issue #1 alias). · Recurring Invoices — Works as CRUD, **not recognized/generated** (Issue #10). · Credit Notes — Works as CRUD, **not applied as contra-revenue** (Issue #10).

**MONEY OUT**
- Expenses — Works. · Vendors — Works. · Bills — Works (no payables KPI, Issue #10 note). · Payments Made — Works as page, **not in Expense KPI** (Issue #1 alias). · Recurring Bills — Works as CRUD, **not generated** (Issue #10). · Vendor Credits — Works as CRUD, **not applied as contra-expense** (Issue #10).

**OPERATIONS**
- Payroll — Works (gross column cosmetic, Issue #9). · Inventory — Works (reorder gap, Issue #8). · Items — Works (reorder gap + duplicate of Inventory, Issue #8).
- Time Tracking → Projects — Works (`/api/projects`). · Timesheet — Works (`/api/timesheet`).
- Tax Filing — **Fabricated figures** (Issue #11). · Reports — Works (`/api/reports`). · Budget — Works (`/api/budget-targets`). · MRR / SaaS — Works (via recurring-invoices; `/api/mrr` orphaned). · Investments — Works (`/api/holdings` + snapshots).

**ADMIN / RECORDS**
- Accountant submenu (My Accountant / messages) — Works (`/api/accountant-messages`). · Find Advisor — directory feature (`loadDirectory`), functional.
- Documents — Works (`/api/documents`). · Templates — **Static mockup**, no persistence (Issue #13). · API connections — **Static catalog**, not connectable (Issue #15).
- Entities — Works, but **paywall bypassable/unenforced** (Issue #3). · Team & roles — **Phantom members, no real RBAC** (Issue #7). · Audit trail — **Reads wrong/empty table, minimal coverage** (Issue #4).
- Manual Journals — Works (`/api/journals`). · Chart of Accounts — Works (`/api/chart-of-accounts`). · Transaction Locking — Works (`/api/lock-settings`). · Cash Flow — Works (local compute; inherits Issue #1 basis). · Settings — Works (`/api/settings`).

**PERSONAL**
- Personal Finance — Works (`/api/personal-transactions` + snapshots). · Investments — Works. · Scenario Planner — Works as calculator, **can't save** (orphaned `/api/scenario`).

**INTELLIGENCE**
- AI Insights — Works (`/api/ai`). · Auto-categorise — Works (`/api/autocat-rules`).

**CLIENTS**
- Client Portal — **Vaporware, no backend** (Issue #14).

**Summary of the "not real" features to hide or build before launch:** Banking (#12), Templates (#13), Client Portal (#14), API Connections (#15) — plus Tax Filing (#11) which is worse because it shows *invented* numbers rather than an empty state.

---

## Suggested execution order

1. **Foundation #1-#2 decision** (ledger + basis) — even a lightweight ledger removes Issues #1, #10, and the three-file drift at the root. If deferring, at least fix the #1 double-count now.
2. **Issue #1** (double-count + alias) and **#2** (boot race) — correct money, stable loads.
3. **Issue #11** (Tax fabrication) — stop showing invented figures.
4. **Issues #4, #7, #3** (audit completeness, real RBAC, server entitlements) — the controls an accounting app is judged on.
5. **Issues #5, #6, #10** (document lifecycle, FX realization, contra accounts).
6. **Issues #12, #13, #14, #15** (hide-or-finish the non-real features: Banking, Templates, Client Portal, API Connections) — do this early too if launching soon, since hiding a nav item is a one-line change and stops the product advertising things it can't do.
7. **Issues #8, #9** (inventory unify, gross color) — polish.

Non-negotiable before calling this an accounting product: revenue recognized once (#1), no fabricated tax figures (#11), and a complete immutable audit trail (#4). Do not ship features that don't exist (#12/#13/#14/#15) without clearly labeling them — hide them if they're not ready. Everything else is correctness and polish on top of those.
