# FinFlow — Behavioral Trace (wire-level)

> Companion to [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md). That doc describes
> *structure*; this one describes *behavior* — for each core user action, exactly
> what fires from the click through to the screen updating, with `file:line`
> citations at every hop. Where a path can't be followed with certainty it says
> **NOT TRACED — <why>** rather than guessing.
>
> **Note on duplicate definitions:** several handlers exist in both
> [app-main.js](public/app-main.js) (in-memory original) and
> [finflow-bundle.js](public/finflow-bundle.js) (API-persisting patch). The
> bundle loads later and reassigns `window.<fn>`, so **the bundle version is the
> one that runs** at click time. Each flow notes which wins.

## Table of contents
- [A. Create + save a new INVOICE](#a-create--save-a-new-invoice)
- [B. Mark an invoice PAID](#b-mark-an-invoice-paid)
- [C. Add a new EXPENSE](#c-add-a-new-expense)
- [D. Owner salary + add a PAYROLL employee](#d-owner-salary--add-a-payroll-employee)
- [E. Add and RESTOCK inventory](#e-add-and-restock-inventory)
- [F. EDIT an existing record (invoice + employee)](#f-edit-an-existing-record)
- [G. DELETE a record (expense) + RBAC](#g-delete-a-record-expense--rbac)
- [H. SWITCH ENTITY](#h-switch-entity)
- [Lighter coverage — all other routes](#lighter-coverage--all-other-routes)
- [Global state glossary](#global-state-glossary)
- [Refresh cascade reference](#refresh-cascade-reference)

---

## A. Create + save a new INVOICE

**1. TRIGGER.** The invoice modal's save button calls `saveInvoice()`. The modal
is opened by `openInvoiceModal()` ([app-main.js:1919](public/app-main.js#L1919)),
which is invoked from the dashboard quick-action dispatch
([app-main.js:5123](public/app-main.js#L5123), `if(id==='invoices') openInvoiceModal();`).
`openInvoiceModal` clears `inv-client`, `inv-amount`, `inv-due`, `inv-status`
(default `pending`), `inv-desc` and opens `invoice-modal`.

**2. CLIENT PATH.** The active handler is the bundle's
`window.saveInvoice` ([finflow-bundle.js:669](public/finflow-bundle.js#L669))
(it reassigns the in-memory `saveInvoice` from
[app-main.js:1928](public/app-main.js#L1928)). In order:
- reads + sanitizes `inv-client` via `sanitizeText(...,200)` and `inv-amount`
  via `validateAmount(...)` ([670-675](public/finflow-bundle.js#L670)).
- **validates:** empty client → `notify('Client name is required')` and return;
  `amount===null || amount<=0` → `notify('A valid positive amount…')` and return
  ([677-678](public/finflow-bundle.js#L677)).
- reads `inv-due`, `inv-status` (default `pending`), `inv-desc` → `notes`
  ([680-682](public/finflow-bundle.js#L680)).
- resolves active entity: `_entityId = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null`
  ([687-688](public/finflow-bundle.js#L687)).
- calls `api('POST','/api/invoices', {...})` ([690](public/finflow-bundle.js#L690)).
  `api` is the shared fetch helper ([finflow-bundle.js:176](public/finflow-bundle.js#L176)):
  `credentials:'same-origin'`, JSON body, throws on non-ok.

**3. REQUEST.** `POST /api/invoices` — payload
`{ client, amount, due_date (or null), status, notes, entity_id }`
([690-697](public/finflow-bundle.js#L690)).

**4. SERVER PATH.** Route `app.post('/api/invoices')`
([server.js:621](server.js#L621)). Middleware before it (registration order):
`apiLimiter` → `requireAuth` ([221](server.js#L221)) → plan check
([464](server.js#L464)) → **entity middleware** ([473](server.js#L473)): body
`entity_id` is the explicit override, validated as a positive int and
**ownership-checked** against `entities` for this user (403 if not owned)
([483-491](server.js#L483)) → RBAC ([517](server.js#L517)) (POST allowed for all
non-viewer roles). Handler:
- validates `client` + `amount != null` → 400 otherwise ([623](server.js#L623)).
- `eid = entity_id || req.entityId || null` ([624](server.js#L624)).
- period-lock guard: `isLocked(userId, due_date)` → 403 if the period is locked
  ([625](server.js#L625), helper [568](server.js#L568)).
- **DB write:** `db.insert('invoices', {...})`
  ([626](server.js#L626)) → [database.js:449](database.js#L449). Writes columns
  `user_id`, `entity_id=eid`, and `data` JSONB = `{ client, amount, due_date,
  status, notes }` (client trimmed 200, notes 500).
- `logAudit(req,'CREATE','invoices',row.id,…)` ([627](server.js#L627), inserts
  into `audit_log` [550](server.js#L550)).

**5. RESPONSE.** `201` with the inserted row flattened by `rowToObj`
([628](server.js#L628)) — includes top-level `id`, `entity_id`, and all `data`
fields.

**6. CLIENT UPDATE** ([finflow-bundle.js:699-716](public/finflow-bundle.js#L699)):
- **optimistic:** `window.userInvoices.unshift({ _dbId: saved.id, client, amount,
  due, due_date, status, notes, color })`.
- `closeModal('invoice-modal')` → `renderInvoices()` → `notify('Invoice created…')`.
- `loadInvoicesFromDB()` (re-fetch `/api/invoices?entity_id=` and remap,
  [641-666](public/finflow-bundle.js#L641)) — fire-and-forget.
- `window._refreshDashboardUI?.()` ([715](public/finflow-bundle.js#L715)).
- `refreshFinancials('invoices')` ([716](public/finflow-bundle.js#L716)) → see
  [refresh cascade](#refresh-cascade-reference): re-fetches `/api/invoices`,
  rebuilds `userInvoices` + `_realInvoices`, re-renders the open page, then
  `_refreshDashboardUI`.

**7. WHERE IT SHOWS UP.**
- **Invoices page** `invoice-list` rows — `renderInvoices`
  ([finflow-bundle.js:757](public/finflow-bundle.js#L757)); its stat cards via
  `updateInvoices`.
- **Dashboard KPIs:** `d-rev`, `d-profit`, `d-outstanding` (and `d-exp`
  unchanged) — recomputed by `updateKPIs`
  ([finflow-bundle.js:5248](public/finflow-bundle.js#L5248)) via
  `computeRevenue(period)` ([app-main.js:1577](public/app-main.js#L1577)) and
  `computeExpenseBreakdown(period).total` ([app-main.js:1522](public/app-main.js#L1522)).
  A new `pending` invoice raises **outstanding**; a `paid` one raises **revenue**
  and **profit**.
- **Dashboard Business transactions** `d-txns` — `updateDashboard`
  reads `_realInvoices` ([app-main.js:1797](public/app-main.js#L1797)).
- **Revenue-vs-Expenses chart** — `buildMonthlyArrays`→`updateOverviewChart`
  inside `_refreshDashboardUI` ([finflow-bundle.js:5525](public/finflow-bundle.js#L5525)).
- **AI insights / Health score** pick up the new revenue next time they render
  (both read the same canonical helpers).

---

## B. Mark an invoice PAID

**1. TRIGGER.** "Mark paid" button rendered only on `pending` invoices:
`<button … onclick="markInvoicePaid(${idx})">`
([finflow-bundle.js:779](public/finflow-bundle.js#L779)).

**2. CLIENT PATH.** Active handler `window.markInvoicePaid(idx)`
([finflow-bundle.js:723](public/finflow-bundle.js#L723)) (overrides the
in-memory one at [app-main.js:1913](public/app-main.js#L1913)):
- `inv = window.userInvoices[idx]`; bail if missing.
- if `inv._dbId` → `api('PUT', '/api/invoices/'+inv._dbId, { status:'paid' })`
  ([728](public/finflow-bundle.js#L728)).
- optimistic: set `inv.status='paid'`, `inv.color='var(--t2)'`
  ([730-731](public/finflow-bundle.js#L730)).

**3. REQUEST.** `PUT /api/invoices/:id` — payload `{ status: 'paid' }`.

**4. SERVER PATH.** `app.put('/api/invoices/:id')`
([server.js:630](server.js#L630)). Same middleware chain (PUT blocked only for
`viewer`). Handler:
- `ownedBy('invoices', id, userId)` ([631](server.js#L631), helper
  [529](server.js#L529)) → 404 if not owned.
- period-lock guard on `row.due_date` ([633](server.js#L633)).
- builds `patch` from present fields; here only `status` → lowercased
  ([639](server.js#L639)).
- **DB write:** `db.updateById('invoices', row.id, patch)`
  ([641](server.js#L641)) → [database.js:586](database.js#L586). **Writes only
  the `data` column** (`SET data=$1`), so `user_id` and **`entity_id` columns are
  preserved** untouched.
- re-selects the row, `logAudit('UPDATE',…)`, returns it.

**5. RESPONSE.** `200` with the updated row.

**6. CLIENT UPDATE.** `renderInvoices()` → `notify('Invoice marked as paid')` →
`refreshFinancials('invoices')` ([732-734](public/finflow-bundle.js#L732)).

**7. WHERE IT SHOWS UP.** Invoice row badge flips `pending`→`paid` (and the
button set changes to "View"). **Dashboard:** `d-rev` and `d-profit` rise,
`d-outstanding` falls (the invoice leaves the `status !== 'paid'` set) —
recomputed by `updateKPIs`/`computeRevenue`. **Health score** `hs-rec`
(receivables = paid/invoiced) improves — `updateHealthScore`
([app-main.js:3473](public/app-main.js#L3473)).

---

## C. Add a new EXPENSE

**1. TRIGGER.** Expense modal save button → `saveExpense()`. Modal fields:
`bexp-desc`, `bexp-amount`, `bexp-cat`, `bexp-ded`.

**2. CLIENT PATH.** **Two** bundle definitions exist: the wiring patch at
[finflow-bundle.js:819](public/finflow-bundle.js#L819) and a later "medium"
override at [finflow-bundle.js:1928](public/finflow-bundle.js#L1928) that wraps
the previous via `const _mediumSaveExpense = window.saveExpense`
([1927](public/finflow-bundle.js#L1927)). **The :1928 version is the live one.**
Both perform the same core POST; tracing the base
([819-865](public/finflow-bundle.js#L819)):
- sanitize `bexp-desc` (`sanitizeText(...,300)`) + `validateAmount(bexp-amount)`.
- **validates:** no desc → `notify('Description is required')`; bad amount →
  `notify('A valid positive amount…')` ([827-828](public/finflow-bundle.js#L827)).
- `cat = bexp-cat || 'Other'`, `ded = bexp-ded || 'no'`.
- active entity `_entityId2` ([834-835](public/finflow-bundle.js#L834)).
- `api('POST','/api/expenses', {...})` ([837](public/finflow-bundle.js#L837)).

**3. REQUEST.** `POST /api/expenses` — `{ description, category, amount,
deductible, expense_date: <today YYYY-MM-DD>, entity_id }`
([837-844](public/finflow-bundle.js#L837)).

**4. SERVER PATH.** `app.post('/api/expenses')`
([server.js:660](server.js#L660)). Middleware identical to flow A. Handler:
- requires `description` + `amount != null` → 400 ([662](server.js#L662)).
- `eid = entity_id || req.entityId || null`; `edate = expense_date || today`.
- `isLocked(userId, edate)` → 403 ([665](server.js#L665)).
- **DB write:** `db.insert('expenses', {...})` ([666](server.js#L666)) — columns
  `user_id`, `entity_id=eid`, `data` = `{ description(≤300), category, amount,
  deductible, expense_date }`.
- `logAudit('CREATE','expenses',…)`.

**5. RESPONSE.** `201` flattened row.

**6. CLIENT UPDATE** ([846-861](public/finflow-bundle.js#L846)):
optimistic `window.bizExpenses.unshift({_dbId:saved.id, desc, cat, amount, ded,
date:'Today'})` → `closeModal('expense-modal')` → `renderExpenses()` →
`notify('Expense logged')` → `loadExpensesFromDB()` → `_refreshDashboardUI?.()`
→ `refreshFinancials('expenses')` ([861](public/finflow-bundle.js#L861)).

**7. WHERE IT SHOWS UP.**
- **Expenses page** `expense-list` rows — `renderExpenses`
  ([finflow-bundle.js:884](public/finflow-bundle.js#L884)); stat cards
  `ex-total`, `ex-biz`, `ex-ded`, `ex-top` + category bars via `updateExpenses`
  ([app-main.js:1951](public/app-main.js#L1951)) which reads
  `computeExpenseBreakdown()`.
- **Dashboard** `d-exp` rises, `d-profit` falls — `updateKPIs` →
  `computeExpenseBreakdown(period).total` (the canonical total includes this new
  real expense row).
- **Dashboard** `d-txns` (expense side) + the Revenue-vs-Expenses chart's expense
  series (`_refreshDashboardUI` repopulates `EXP_*` per-month arrays,
  [finflow-bundle.js:5533](public/finflow-bundle.js#L5533)).
- **Cash-flow card** `cf-out`/`cf-net` and **AI/Health** expense-derived figures
  update on their next render.

---

## D. Owner salary + add a PAYROLL employee

This is two related actions; payroll uses `entity_id` heavily and is the source
of the "no entity_id revert" guarantee.

### D1 — Save/alter OWNER salary

**1. TRIGGER.** Two entry points exist:
- the payroll CTA card → `saveOwnerPayrollCard()`
  ([app-main.js:2843](public/app-main.js#L2843)), fields `payroll-cta-*`.
- the owner modal → `saveOwnerPayroll()` — bundle override
  ([finflow-bundle.js:1206](public/finflow-bundle.js#L1206)) wrapping the
  in-memory original ([app-main.js:2292](public/app-main.js#L2292)).

**2. CLIENT PATH (CTA card path, the simpler/explicit one).**
`saveOwnerPayrollCard` ([app-main.js:2843](public/app-main.js#L2843)):
- reads `payroll-cta-fname/lname/gross/tax/role`; **validates** fname & gross
  ([2849-2850](public/app-main.js#L2849)).
- `activeIdx = ENTITIES.findIndex(e=>e.active)`, `entity = ENTITIES[activeIdx]`,
  `existing = ownerPayrollByEntity[activeIdx]` ([2851-2853](public/app-main.js#L2851)).
- builds `payload = { fname, lname, gross, tax_rate, is_owner:true,
  entity_id: entity?._dbId, role, emp_type:'owner', av_class:'av-blue' }`
  ([2854](public/app-main.js#L2854)).
- if `existing?._dbId` → `PUT /api/payroll/:id`; else `POST /api/payroll`
  ([2857-2865](public/app-main.js#L2857)) (raw `fetch`, `credentials:'include'`).

**(Owner-modal path.)** `saveOwnerPayroll` ([finflow-bundle.js:1206](public/finflow-bundle.js#L1206))
runs the in-memory original first, then **loops `ownerPayrollByEntity` keyed by
entity index** and PUTs (if `_dbId`) or POSTs each entity's owner row, each
scoped to its own `entity_id` ([1216-1257](public/finflow-bundle.js#L1216)).
After persisting it also **idempotently syncs owner net salary into
`personal_transactions`** for the current month
([1265-1296](public/finflow-bundle.js#L1265)).

**3. REQUEST.** `POST /api/payroll` (new) or `PUT /api/payroll/:id` (update).
Owner payload includes `is_owner:true` (POST only) + `entity_id`. **The PUT
payload's `entity_id` is *not* applied by the server** (see step 4).

**4. SERVER PATH.**
- POST `app.post('/api/payroll')` ([server.js:818](server.js#L818)): requires
  `fname` → 400; `db.insert('payroll', {...})` with `entity_id: b.entity_id||null`
  and `data` = `{ fname, lname, role, emp_type, gross, tax_rate, av_class,
  is_owner }` ([821](server.js#L821)).
- PUT `app.put('/api/payroll/:id')` ([server.js:824](server.js#L824)):
  `ownedBy('payroll',…)` → 404; builds `patch` **only** from
  `fname,lname,role,emp_type,av_class,gross,tax_rate`
  ([829-831](server.js#L829)) — **`entity_id` is not in the accepted set** — then
  `db.updateById('payroll', row.id, patch)` ([832](server.js#L832)), which writes
  only the `data` column. **⇒ the `entity_id` column cannot be changed or nulled
  by an edit.** (This is the documented "no entity_id revert via code" guarantee.)
- Middleware: GET `/api/payroll` ([806](server.js#L806)) itself applies the
  fail-safe scope `r.entity_id == null || (entityId && r.entity_id===entityId)`
  ([810](server.js#L810)) and sorts owner-first.

**5. RESPONSE.** `200`/`201` flattened payroll row (incl. `id`, `entity_id`).

**6. CLIENT UPDATE.**
- CTA path ([2866-2883](public/app-main.js#L2866)): writes
  `ownerPayrollByEntity[activeIdx]` with `saved.id`, syncs `window.ownerPayroll`,
  calls `syncAllPayrollsToPersonal()`, `await loadPersonalFinance()`,
  `renderPayroll()`, `notify`.
- Modal path ([1298-1311](public/finflow-bundle.js#L1298)):
  `refreshFinancials('expenses')` → `loadPersonalFinance()` →
  `finflow.refresh(['personal-finance'])` → re-`loadEntityData(activeIdx)` →
  `renderPayroll()`.

**7. WHERE IT SHOWS UP.**
- **Payroll page** owner card/rows — `renderPayroll` ([app-main.js:2079](public/app-main.js#L2079)).
- **Dashboard** `d-exp`/`d-profit` — `computeExpenseBreakdown` includes owner
  gross × elapsed months ([app-main.js:1557-1561](public/app-main.js#L1557)).
- **Expenses page** "Payroll" breakdown line + `ex-total` — `updateExpenses`
  ([app-main.js:1971](public/app-main.js#L1971)).
- **Personal finance** income line "Owner salary — <entity>" —
  `loadPersonalFinance` ([app-main.js:3025](public/app-main.js#L3025)).
- **AI insights** payroll-tax-withheld line ([app-main.js:3445](public/app-main.js#L3445)).

### D2 — Add a PAYROLL employee

**1. TRIGGER.** Add-employee modal save → `saveNewEmployee()`
([app-main.js:2904](public/app-main.js#L2904)); opened by
`openAddEmployeeModal()` ([2887](public/app-main.js#L2887)); fields `emp-fname`,
`emp-lname`, `emp-jobtitle`, `emp-type`, `emp-gross`, `emp-taxrate`
(live net preview via `previewEmpNet` [2896](public/app-main.js#L2896)).

**2. CLIENT PATH.** `saveNewEmployee` ([2904-2929](public/app-main.js#L2904)):
validates fname & gross ([2911-2912](public/app-main.js#L2911)); random
`avClass`; resolves `entity = ENTITIES[activeIdx]`; raw `fetch` `POST /api/payroll`
with `is_owner:false` + `entity_id: entity?._dbId` ([2918-2919](public/app-main.js#L2918)).

**3. REQUEST.** `POST /api/payroll` — `{ fname, lname, role, emp_type, gross,
tax_rate, is_owner:false, av_class, entity_id }`.

**4. SERVER PATH.** Same `app.post('/api/payroll')`
([server.js:818](server.js#L818)) as D1; `is_owner` stored false.

**5. RESPONSE.** `201` flattened row.

**6. CLIENT UPDATE** ([2922-2928](public/app-main.js#L2922)): optimistic
`payrollEmployees.push({_dbId:saved.id,…})`, sync `window.payrollEmployees`,
`closeModal('add-employee-modal')`, `renderPayroll()`, `notify`.
(Note: this path does **not** call `refreshFinancials`; the dashboard expense
total reflects the new employee on its next render via `computeExpenseBreakdown`,
which reads `window.payrollEmployees`.)

**7. WHERE IT SHOWS UP.** Payroll page employee rows (`renderPayroll`); and —
once any dashboard render runs — `d-exp`/`d-profit`, Expenses "Payroll" line, all
through `computeExpenseBreakdown` (owner + employees gross × elapsed months).

---

## E. Add and RESTOCK inventory

### E1 — Add inventory item

**1. TRIGGER / 2. CLIENT PATH.** The add-item save handler lives in the wiring
layer (`saveInventoryItem` / inventory modal). It POSTs `/api/inventory` with
`{ name, sku, units(or qty), max_units, cost, entity_id }` and unshifts into
`window.inventory`. **NOT TRACED — exact add-item handler function name not
confirmed by grep in the read scope;** the restock + render + server side below
are fully traced. (The server contract is the authority: see step 4.)

**4. SERVER PATH (add).** `app.post('/api/inventory')`
([server.js:726](server.js#L726)): `u = max(0, qty||units)`, `mx = max_units||200`,
`db.insert('inventory', { user_id, entity_id: b.entity_id||null, sku, name, units:u,
max_units:mx, cost, low_stock: u < mx*0.1 ? 1 : 0 })` ([730](server.js#L730)).

### E2 — Restock (the fully-traced action)

**1. TRIGGER.** "Restock" button on each inventory row:
`onclick="restockItem(${idx})"` ([finflow-bundle.js:1103](public/finflow-bundle.js#L1103)).

**2. CLIENT PATH.**
- `window.restockItem(idx)` ([finflow-bundle.js:1008](public/finflow-bundle.js#L1008)):
  ensures `window.inventory` is loaded; captures `_restockDbId = item._dbId`
  (stable, not index) ([1014-1015](public/finflow-bundle.js#L1014)); sets modal
  title; opens `restock-modal`.
- Save → `window.saveRestock()` ([1023](public/finflow-bundle.js#L1023)):
  re-finds the item by `_dbId` ([1025-1027](public/finflow-bundle.js#L1025));
  reads `restock-qty`, **validates** `>0` ([1031](public/finflow-bundle.js#L1031));
  clamps `qty = min(qtyRaw, 100000)`.
  - **Important nuance:** when `item._dbId` exists it sends the **new absolute
    total** via `PUT /api/inventory/:id` with `{ units: newUnits }`
    (`newUnits = item.units + qty`, [1038-1039](public/finflow-bundle.js#L1038)),
    **not** the dedicated `/restock` route. The server `/restock` route exists
    ([server.js:746](server.js#L746)) but this client path uses the generic PUT.

**3. REQUEST.** `PUT /api/inventory/:id` — `{ units: <new total> }`.

**4. SERVER PATH.** `app.put('/api/inventory/:id')`
([server.js:733](server.js#L733)): `ownedBy('inventory',…)` → 404;
`newUnits = b.units` clamped ≥0; recomputes `low_stock = newUnits < newMax*0.1`;
`patch = { units, max_units, low_stock }` (+ optional name/cost);
`db.updateById('inventory', row.id, patch)` ([742](server.js#L742)) — **`data`
column only, entity_id preserved**.

**5. RESPONSE.** `200` flattened inventory row.

**6. CLIENT UPDATE** ([1040-1048](public/finflow-bundle.js#L1040)):
optimistic `item.units = newUnits`; `item.low = item.units < item.max*0.1`;
`closeModal('restock-modal')`; `renderInventory()`; `notify('+N units…')`;
`refreshFinancials('none')` (re-renders the open page + dashboard UI without
re-fetching invoices/expenses — see cascade).

**7. WHERE IT SHOWS UP.** **Inventory page** row units + low-stock badge
(`renderInventory`). **AI insights** low-stock lines —
`(inventory||[]).filter(i=>i.low)` ([app-main.js:3433](public/app-main.js#L3433),
[3446](public/app-main.js#L3446)). Inventory does **not** feed revenue/expense
KPIs, so dashboard money figures are unchanged.

---

## F. EDIT an existing record

The "when I alter something" path. Two concrete examples; both rely on
`db.updateById` writing **only the `data` column** so the `entity_id` column
survives the edit.

### F1 — Edit an employee (clean full-field edit)

**1. TRIGGER.** Pencil button on employee rows:
`onclick="openEditEmployee(${e._dbId||e.id||0})"`
([app-main.js:2111](public/app-main.js#L2111)).

**2. CLIENT PATH.** `openEditEmployee(id)`
([app-main.js:2367](public/app-main.js#L2367)) finds the emp in
`window.payrollEmployees` and fills `edit-emp-*` fields. Save →
`window.saveEditEmployee()` ([app-main.js:2383](public/app-main.js#L2383)):
reads `edit-emp-id/role/type/gross/tax`; raw `fetch` `PUT /api/payroll/:id` with
`{ role, emp_type, gross, tax_rate }` ([2393-2396](public/app-main.js#L2393))
(**no `entity_id` sent**).

**3. REQUEST.** `PUT /api/payroll/:id` — `{ role, emp_type, gross, tax_rate }`.

**4. SERVER PATH.** `app.put('/api/payroll/:id')`
([server.js:824](server.js#L824)) — `ownedBy` guard, patch limited to the
whitelisted fields, `db.updateById('payroll', id, patch)`
([832](server.js#L832)). **`db.updateById` ([database.js:586](database.js#L586))
selects the row, merges `patch` into existing `data`, and runs
`UPDATE … SET data=$1, updated_at=NOW() WHERE id=$2` — it never touches the
`user_id` or `entity_id` columns.** So editing an employee preserves its entity.

**5. RESPONSE.** `200` updated row.

**6. CLIENT UPDATE** ([2399-2403](public/app-main.js#L2399)): optimistic patch of
the in-memory emp object; `closeEditEmployee()`; `renderPayroll()`; `notify`.

**7. WHERE IT SHOWS UP.** Payroll row; and `d-exp`/`d-profit` + Expenses
"Payroll" line on next dashboard render (gross feeds `computeExpenseBreakdown`).

### F2 — Edit an invoice (status edit)

The invoice list has no full field-edit modal; the live "alter" path for an
invoice is **mark-paid** (flow B), a `PUT /api/invoices/:id` patching `status`
via `db.updateById` ([server.js:641](server.js#L641)) — same entity_id-preserving
mechanism. A general field edit would follow the identical PUT handler
([server.js:630](server.js#L630)), which accepts `client/amount/due_date/status/
notes` but not `entity_id`. (Customer edit is another full-field example:
`PUT /api/customers/:id` [server.js:705](server.js#L705) → `db.updateById`.)

---

## G. DELETE a record (expense) + RBAC

**1. TRIGGER.** Red "✕" on each expense row:
`onclick="deleteExpense(${idx})"` ([finflow-bundle.js:899](public/finflow-bundle.js#L899)).

**2. CLIENT PATH.** `window.deleteExpense(idx)`
([finflow-bundle.js:868](public/finflow-bundle.js#L868)):
`exp = bizExpenses[idx]`; `confirm('Delete expense "…"?')` — abort if cancelled
([871](public/finflow-bundle.js#L871)); if `exp._dbId` →
`api('DELETE','/api/expenses/'+exp._dbId)` ([873](public/finflow-bundle.js#L873)).

**3. REQUEST.** `DELETE /api/expenses/:id` (no body).

**4. SERVER PATH.** **RBAC gate first:** the role middleware
([server.js:517-525](server.js#L517)) rejects `DELETE` unless role ∈
{`admin`,`owner`} → **403 "Only admin or owner can delete records."** (viewer &
accountant are blocked here, before the handler). Then
`app.delete('/api/expenses/:id')` ([server.js:687](server.js#L687)):
`ownedBy('expenses',…)` → 404; `isLocked(userId, row.expense_date)` → 403;
`db.deleteById('expenses', id)` ([691](server.js#L691)) →
[database.js:612](database.js#L612) `DELETE FROM expenses WHERE id=$1`;
`logAudit('DELETE',…)`.

**5. RESPONSE.** `200 { ok: true }` (or 403/404 per above).

**6. CLIENT UPDATE** ([874-877](public/finflow-bundle.js#L874)): optimistic
`bizExpenses.splice(idx,1)`; `renderExpenses()`; `notify('Expense deleted')`;
`refreshFinancials('expenses')`. (On a 403, `api` throws → caught →
`notify('Could not delete expense — …')` [879](public/finflow-bundle.js#L879);
the in-memory array is **not** spliced because the throw happens before splice.)

**7. WHERE IT SHOWS UP.** Expenses page rows + stat cards (`renderExpenses`);
Dashboard `d-exp` falls / `d-profit` rises (`computeExpenseBreakdown` over the
now-shorter `_realExpenses` after the `refreshFinancials('expenses')` re-fetch);
chart expense series.

---

## H. SWITCH ENTITY

**1. TRIGGER.** Entity picker item → `window.switchEntity(idx)`
([index.html:4852](public/index.html#L4852)). (An app-main wrapper also routes
into it at [app-main.js:406](public/app-main.js#L406).)

**2. CLIENT PATH.** `switchEntity(idx)` ([index.html:4852](public/index.html#L4852)):
- flips the local active flag: `ENTITIES.forEach((e,i)=>e.active=i===idx)`
  ([4853](public/index.html#L4853)).
- updates sidebar brand `sb-brand-name` + `biz-currency-badge` immediately
  ([4858-4861](public/index.html#L4861)); `renderEntities()`.
- **awaits** `POST /api/entities/:id/activate` ([4869](public/index.html#L4869)).
- `await sleep(100ms)` to let the session commit
  ([4875](public/index.html#L4875)).
- `await loadEntityData(idx)` ([4878](public/index.html#L4878)); `notify`.

**3. REQUEST.** `POST /api/entities/:dbId/activate`, then the five GETs inside
`loadEntityData`, each with `?entity_id=<dbId>`.

**4. SERVER PATH.**
- `app.post('/api/entities/:id/activate')` ([server.js:602](server.js#L602)):
  clears `is_active` on **all** the user's entities, sets `is_active:1` on the
  target, and **persists `req.session.entityId = eid`**
  ([606-613](server.js#L613)). This makes the chosen entity the server-side
  default for any later request without an explicit `?entity_id=`.
- The subsequent list GETs (`/api/invoices|expenses|customers|inventory|payroll`)
  run through the entity middleware, which honors the explicit `?entity_id=`
  (ownership-checked) and apply the fail-safe scope predicate
  ([server.js:619](server.js#L619), [658](server.js#L658), [698](server.js#L698),
  [724](server.js#L724), [810](server.js#L810)).

**5. RESPONSE.** activate → `{ ok:true }`; each GET → that entity's rows
(plus legacy `entity_id IS NULL` rows).

**6. CLIENT UPDATE — `loadEntityData(idx)`** ([app-main.js:1214](public/app-main.js#L1214)):
- **re-entrancy guard** `_loadEntityDataRunning` ([1215](public/app-main.js#L1215)).
- **zeroes immediately** so stale data never shows: `REV/EXP/PROFIT` spliced to
  twelve zeros ([1219-1222](public/app-main.js#L1219)); clears
  `invoice-list/expense-list/customer-list/inventory-list/payroll-list`
  ([1224](public/app-main.js#L1224), [1254-1255](public/app-main.js#L1254)).
- resolves `_eid = ENTITIES[idx]._dbId`; bails if missing
  ([1229-1230](public/app-main.js#L1230)).
- **parallel re-fetch with `?entity_id=`**: invoices, expenses, customers,
  inventory, payroll ([1233-1239](public/app-main.js#L1233)).
- **atomic swap** of globals: truncates then rebuilds `userInvoices`,
  `bizExpenses`, `customers`, `inventory`, `payrollEmployees`; resets
  `ownerPayroll` ([1247-1283](public/app-main.js#L1247)); sets
  `window._realInvoices` / `window._realExpenses`
  ([1328-1329](public/app-main.js#L1328)).
- **owner payroll per-entity:** restores `ownerPayrollByEntity[idx]` from the
  `is_owner` row, syncs `window.ownerPayroll` when this idx is active
  ([1287-1320](public/app-main.js#L1287)).
- `syncAllPayrollsToPersonal()` ([1323](public/app-main.js#L1323)).
- **rebuilds the 12-month chart arrays** `REV/EXP/PROFIT` from the new data,
  fiscal-year aligned ([1337-1359](public/app-main.js#L1337)); payroll is
  deliberately **not** injected into `EXP[]` ([1352-1355](public/app-main.js#L1352)).
- **re-renders:** `renderInvoices`, `renderExpenses`, `renderCustomers`,
  `renderInventory`, `renderPayroll`, `updateDashboard`, `buildCharts`
  ([1362-1368](public/app-main.js#L1362)); then `await _bootDashboardWiring()`
  ([1371-1372](public/app-main.js#L1372)) and `loadBankingFromDB()`
  ([1375](public/app-main.js#L1375)).
- rebuilds `_topClients` from paid invoices ([1378-1386](public/app-main.js#L1386)).
- `finally`: recomputes `MONTH_FULL`/`MONTHS`, clears the running guard
  ([1390-1392](public/app-main.js#L1390)).

`_bootDashboardWiring` ([finflow-bundle.js:5440](public/finflow-bundle.js#L5440))
then re-fetches invoices/expenses for the active entity, rebuilds the chart, and
re-runs `updateKPIs`/`updateExpenseBars`/`updateTransactions`/`updateInvoiceStats`,
plus the `_forceKPIs` direct writes ([5486](public/finflow-bundle.js#L5486)).

**7. WHERE IT SHOWS UP.** Effectively the **entire app** re-renders for the new
entity: sidebar brand/currency; all list pages (invoices/expenses/customers/
inventory/payroll); dashboard KPIs (`d-rev/d-exp/d-profit/d-outstanding/d-invest`)
via `updateKPIs` → `computeRevenue`/`computeExpenseBreakdown`; the
Revenue-vs-Expenses chart; `d-txns`; banking widget; and AI/Health panels on
their next render — all now reading the swapped entity-scoped globals.

---

## Lighter coverage — all other routes

`action → endpoint → table → screens that refresh`. Server CRUD shape is uniform
(`requireAuth` → plan → entity middleware (fail-safe scope) → RBAC → `db.*`).
"Screens refresh" = the `finflow.refresh([...])` sections or `refreshFinancials`
hint the save handler fires (dispatch map at
[finflow-bundle.js:5943](public/finflow-bundle.js#L5943)).

| Action | Endpoint(s) | Table | Screens refreshed |
|---|---|---|---|
| Quotes CRUD | `/api/quotes` [1375](server.js#L1375) | `quotes` | quotes list (`refreshFinancials('invoices')`) |
| Sales receipts | `/api/sales-receipts` [1534](server.js#L1534) | `sales_receipts` | `finflow.refresh(['invoices','dashboard','money-in','reports'])` [3011](public/finflow-bundle.js#L3011); feeds `_receipts`→`computeRevenue` |
| Payments received | `/api/payments-received` [1570](server.js#L1570) | `payments_received` | `['invoices','dashboard','money-in','reports']` [3092](public/finflow-bundle.js#L3092); feeds `_paymentsReceived`→`computeRevenue` |
| Payments made | `/api/payments-made` [1647](server.js#L1647) | `payments_made` | `['expenses','dashboard','money-out','budget','reports']` [3252](public/finflow-bundle.js#L3252); feeds `_paymentsMade`→`computeExpenseBreakdown` |
| Credit notes | `/api/credit-notes` [1607](server.js#L1607) | `credit_notes` | credit-notes list + dashboard |
| Vendor credits | `/api/vendor-credits` [1686](server.js#L1686) | `vendor_credits` | money-out / expenses |
| Vendors | `/api/vendors` [1409](server.js#L1409) | `vendors` | `banking` dispatch reloads vendors ([5950](public/finflow-bundle.js#L5950)) |
| Bills | `/api/bills` [1443](server.js#L1443) | `bills` | `banking` dispatch reloads bills; `refreshFinancials('expenses')` |
| Recurring bills | `/api/recurring-bills` [1477](server.js#L1477) | `recurring_bills` | banking/expenses; server scheduler [2120](server.js#L2120) |
| Recurring invoices | `/api/recurring-invoices` [1508](server.js#L1508) | `recurring_invoices` | invoices; server scheduler |
| Journals | `/api/journals` [1179](server.js#L1179) | `journals` | `renderJournals` (`'journal'` dispatch) |
| Chart of accounts | `/api/chart-of-accounts` [1218](server.js#L1218) | `chart_of_accounts` | `renderCOA` (`'chart-of-accounts'`) |
| FX rates / txns / settle | `/api/fx-rates` [3008](server.js#L3008), `/api/fx-transactions` [3028](server.js#L3028), `/settle` [3054](server.js#L3054) | `fx_rates`, `fx_transactions` | reports/fx panels; SQL fail-safe scope |
| FX summary | `/api/fx-summary` [3071](server.js#L3071) | `fx_transactions` (read) | reports |
| COGS | `/api/cogs` [2968](server.js#L2968), `/calculate` [2996](server.js#L2996) | `inventory_movements` (read) | reports/COGS |
| Inventory movements | `/api/inventory-movements` [2928](server.js#L2928) | `inventory_movements` | inventory/reports |
| Timesheet | `/api/timesheet` [1731](server.js#L1731) | `timesheet` | `renderTimesheet` (`'time-tracking'`) |
| Team / RBAC | `/api/team` [1770](server.js#L1770), `/api/permissions` [2202](server.js#L2202) | `team_members` | team page (`renderTeam`) |
| Goals | `/api/goals` [890](server.js#L890) | `goals` | personal finance / goals |
| Projects | `/api/projects` [925](server.js#L925) | `projects` | `renderProjects` |
| Budget targets | `/api/budget-targets` [1006](server.js#L1006) | `budget_targets` | `'budget'` dispatch (`renderBudget` + `_loadBudgetFromDB`) |
| Documents | `/api/documents` [1263](server.js#L1263) (+`/download` [1282](server.js#L1282)) | `documents` | `renderDocuments` |
| Templates | `/api/templates` [1298](server.js#L1298) | `templates` | template pickers |
| Banking | `/api/banking` [2164](server.js#L2164) | `personal_transactions` (`source='banking'`) | banking widget; `loadBankingFromDB` [3882](public/app-main.js#L3882) |
| Bank reconciliation | `/api/bank-reconciliation` [2575](server.js#L2575), `/match` [2605](server.js#L2605) | `bank_reconciliation`, `invoice_payments` | reconciliation panel |
| Invoice payments | `/api/invoice-payments` [2541](server.js#L2541) | `invoice_payments` | invoices/reports |
| Scenario | `/api/scenario` [2436](server.js#L2436) | `user_settings` blob | scenario planner |
| Tax filing | `/api/tax-filing` [2404](server.js#L2404) (read) | invoices+expenses (computed) | `calcAndRenderTax` (`'tax-filing'`) |
| Reports | `/api/reports` [2263](server.js#L2263), `/profit-loss` [2326](server.js#L2326), `/balance-sheet` [2355](server.js#L2355), `/cash-flow` [2373](server.js#L2373), `/cashflow` [2228](server.js#L2228) | invoices+expenses (+fx/cogs) computed | `renderReports` / `renderCashflow` |
| MRR | `/api/mrr` [2186](server.js#L2186) | `user_settings` blob | `renderMRR` [5983](public/finflow-bundle.js#L5983) |
| Settings | `/api/settings` [1051](server.js#L1051) | `user_settings` | currency/format across app |
| Connections | `/api/connections` [2469](server.js#L2469) | `user_settings` blob | integrations panel |
| AI chat / scan | `/api/ai` [1830](server.js#L1830), `/api/ai/scan` [1990](server.js#L1990) | `ai_cache` (write), reads invoices/expenses/customers | AI chat panel (502 if no `ANTHROPIC_API_KEY`) |

---

## Global state glossary

Every `window.*` global that holds domain data: what it holds, who populates it,
who reads it.

| Global | Holds | Populated by | Read by |
|---|---|---|---|
| `window.ENTITIES` | entity list `{name, currency, _dbId, active}` | `loadEntitiesFromDB` [index.html:4617](public/index.html#L4617); `switchEntity` flips `active` [4853](public/index.html#L4853) | `_entQ` [bundle:16](public/finflow-bundle.js#L16), every save handler's entity resolve, `loadEntityData` |
| `window.userInvoices` | UI-shaped invoices (incl. `_dbId`, `color`, `due`) | `ffLoadData` [bundle:99](public/finflow-bundle.js#L99); `loadEntityData` [app-main:1258](public/app-main.js#L1258); `refreshFinancials` [bundle:5731](public/finflow-bundle.js#L5731); save handlers unshift/splice | `renderInvoices`, `updateDashboard` outstanding [1777](public/app-main.js#L1777), health receivables [3454](public/app-main.js#L3454) |
| `window._realInvoices` | raw API invoices for the active entity | `loadEntityData` [1328](public/app-main.js#L1328); `bootDashboardWiring` [5452](public/finflow-bundle.js#L5452); `refreshFinancials` [5743](public/finflow-bundle.js#L5743) | **`computeRevenue`** [1581](public/app-main.js#L1581), `d-txns` [1798](public/app-main.js#L1798), chart builder |
| `window.bizExpenses` | UI-shaped expenses (`_dbId, desc, cat, amount, ded, date`) | `ffLoadData` [102](public/finflow-bundle.js#L102); `loadEntityData` [1266](public/app-main.js#L1266); save handlers | `renderExpenses` [884](public/finflow-bundle.js#L884) |
| `window._realExpenses` | raw API expenses for the active entity | `loadEntityData` [1329](public/app-main.js#L1329); `bootDashboardWiring` [5453](public/finflow-bundle.js#L5453); `refreshFinancials` [5757](public/finflow-bundle.js#L5757) | **`computeExpenseBreakdown`** [1541](public/app-main.js#L1541), `d-txns`, chart |
| `window._receipts` | sales receipts | loader [bundle:2944](public/finflow-bundle.js#L2944) | `computeRevenue` [1582](public/app-main.js#L1582), `updateKPIs` [5253](public/finflow-bundle.js#L5253) |
| `window._paymentsReceived` | payments received | loader [bundle:3028](public/finflow-bundle.js#L3028) | `computeRevenue` [1583](public/app-main.js#L1583), `updateKPIs` [5254](public/finflow-bundle.js#L5254) |
| `window._paymentsMade` | bill payments out | loader [bundle:3189](public/finflow-bundle.js#L3189) | `computeExpenseBreakdown` [1553](public/app-main.js#L1553), `updateKPIs` [5256](public/finflow-bundle.js#L5256) |
| `window.ownerPayroll` | active entity's owner row | `loadEntityData` [1311](public/app-main.js#L1311); `saveOwnerPayrollCard` [2877](public/app-main.js#L2877) | `computeExpenseBreakdown` [1557](public/app-main.js#L1557), `renderPayroll`, AI tax line [3445](public/app-main.js#L3445) |
| `window.payrollEmployees` | non-owner employees (active entity) | `ffLoadData` [111](public/finflow-bundle.js#L111); `loadEntityData` [1279](public/app-main.js#L1279); `saveNewEmployee` [2924](public/app-main.js#L2924) | `computeExpenseBreakdown` [1558](public/app-main.js#L1558), `renderPayroll` [2079](public/app-main.js#L2079) |
| `window.ownerPayrollByEntity` | map `entityIdx → owner row` | `loadEntityData` [1306](public/app-main.js#L1306); `saveOwnerPayrollCard` [2867](public/app-main.js#L2867); `saveOwnerPayroll` loop [bundle:1216](public/finflow-bundle.js#L1216) | `saveOwnerPayroll` persistence loop; owner-payroll sync on switch |
| `window.inventory` | UI-shaped inventory (`_dbId, units, max, cost, low`) | `ffLoadData` [108](public/finflow-bundle.js#L108); `loadEntityData` [1276](public/app-main.js#L1276) | `renderInventory`, `restockItem` [1013](public/finflow-bundle.js#L1013), AI low-stock [3433](public/app-main.js#L3433) |
| `window.holdings` / `holdingsData` | investments | `ffLoadData` [117](public/finflow-bundle.js#L117); `loadHoldingsFromDB` [bundle:4645](public/finflow-bundle.js#L4645) | `updateKPIs` portfolio [5319](public/finflow-bundle.js#L5319), `renderInvestments` |
| `window.customers` | customers | `ffLoadData` [105](public/finflow-bundle.js#L105); `loadEntityData` [1273](public/app-main.js#L1273) | `renderCustomers` [3496](public/app-main.js#L3496) |
| `window.goals` | savings goals | `ffLoadData` [114](public/finflow-bundle.js#L114) | personal finance / goals render |
| `REV[] / EXP[] / PROFIT[]` | 12-month chart arrays (module-scope) | `loadEntityData` [1357-1359](public/app-main.js#L1357) | chart, AI best/weakest month [3430](public/app-main.js#L3430), health growth [3475](public/app-main.js#L3475) |
| `_topClients` | top-4 paid-invoice clients | `loadEntityData` [1383](public/app-main.js#L1383) | cash-flow sources [1841](public/app-main.js#L1841), AI top-client [3437](public/app-main.js#L3437) |
| `window.currentPeriod` | `'month'\|'quarter'\|'year'` | period toggle UI | every compute fn's period arg |
| `window._ffAuthed` / `CURRENT_USER` | auth flag / user | `ffOnAuth` [82](public/finflow-bundle.js#L82); entity-boot [5589](public/finflow-bundle.js#L5589) | all `ff:authed`-gated IIFEs |

---

## Refresh cascade reference

Two refresh entry points; both ultimately repaint the dashboard through the
canonical compute layer.

### `window.finflow.refresh(sections)` — [finflow-bundle.js:5940](public/finflow-bundle.js#L5940)
1. For each section, runs its `dispatch[section]()` re-render
   ([5943-5964](public/finflow-bundle.js#L5943)) — e.g. `'invoices'`→
   `renderInvoices`, `'banking'`→ reload vendors+bills, `'personal-finance'`→
   `loadPersonalFinance`.
2. If `sections` is empty **or** includes `'dashboard'`, it computes a **hint**
   from the section names and calls `refreshFinancials(hint)`
   ([5967-5971](public/finflow-bundle.js#L5967)):
   - any of `invoices/money-in/quotes/receipts/payments-received/credit-notes/
     recurring-invoices/revenue` present (and no expense-side) → `hint='invoices'`
   - any of `expenses/money-out/vendors/bills/payments-made/vendor-credits/
     recurring-bills/payroll/budget/costs` (and no income-side) → `hint='expenses'`
   - both, or generic → `hint='all'`
3. Else (sections given but no dashboard) → just `_refreshDashboardUI()`
   ([5972-5973](public/finflow-bundle.js#L5973)).

### `window.refreshFinancials(hint)` — [finflow-bundle.js:5714](public/finflow-bundle.js#L5714)
Which fetches re-run, by hint ([5721-5727](public/finflow-bundle.js#L5721)):

| hint | re-fetch `/api/invoices?entity_id=` | re-fetch `/api/expenses?entity_id=` |
|---|---|---|
| `'all'` | ✓ | ✓ |
| `'invoices'` / `'revenue'` | ✓ | — |
| `'expenses'` / `'costs'` | — | ✓ |
| `'none'` | — | — |

Then it:
- rebuilds `window.userInvoices`+`_realInvoices` (if invoices fetched,
  [5730-5744](public/finflow-bundle.js#L5730)) and `bizExpenses`+`_realExpenses`
  (if expenses fetched, [5746-5758](public/finflow-bundle.js#L5746)).
- detects the open page (`window.currentPage` / `.page.active`,
  [5763](public/finflow-bundle.js#L5763)) and runs that page's render
  ([5800-5801](public/finflow-bundle.js#L5800)).
- **always** repaints the dashboard via `_refreshDashboardUI()` (fallback
  `updateDashboard()`) ([5804-5807](public/finflow-bundle.js#L5804)).

### `window._refreshDashboardUI()` — [finflow-bundle.js:5525](public/finflow-bundle.js#L5525)
No fetch. Recomputes from current globals:
- repopulates per-month `EXP_SAL/RENT/SW/MKT` from `_realExpenses`
  ([5533-5553](public/finflow-bundle.js#L5533)).
- rebuilds + redraws the Revenue-vs-Expenses chart
  ([5555-5563](public/finflow-bundle.js#L5555)).
- `updateKPIs(invs, exps, period)` ([5567](public/finflow-bundle.js#L5567)) →
  writes `d-rev/d-exp/d-profit/d-outstanding/d-invest` via
  `computeRevenue(period)` + `computeExpenseBreakdown(period).total`
  ([5293-5300](public/finflow-bundle.js#L5293)).
- `updateExpenseBars`, `updateTransactions`, `updateInvoiceStats`
  ([5569-5571](public/finflow-bundle.js#L5569)).

**Net effect:** any save → `finflow.refresh`/`refreshFinancials` → at most a
two-endpoint re-fetch → canonical recompute → dashboard + open page repaint,
**no full page reload**.

---

*Generated read-only. Line numbers reflect the current working tree. Items
marked **NOT TRACED** were left unverified rather than guessed.*
