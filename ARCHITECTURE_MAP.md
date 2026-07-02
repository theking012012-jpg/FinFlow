# FinFlow — Architecture Map

> A reference for how the system actually works end-to-end: what connects to
> where, how data flows, and where every number on screen comes from. Grounded
> in the real code with `file:line` citations. This is documentation, not an
> audit. Where something genuinely isn't in the code, it says **not present**.

---

## 1. SYSTEM OVERVIEW

FinFlow is a single-tenant-per-user accounting SPA. The **browser** loads one
big HTML shell ([public/index.html](public/index.html)) plus two JavaScript
engines ([public/app-main.js](public/app-main.js) and
[public/finflow-bundle.js](public/finflow-bundle.js), served minified). All
data lives in **PostgreSQL** (Supabase in production), reached only through an
**Express** API ([server.js](server.js)) via the thin data layer in
[database.js](database.js). Sessions are stored in the same Postgres database
through `connect-pg-simple` (there is **no Redis** — see §9). Three external
services are wired in but optional: **Stripe** (billing/Connect payouts),
**Resend** (transactional email), and **Anthropic** (AI insights & document
scanning).

```
   ┌─────────────────────────── Browser (SPA) ───────────────────────────┐
   │  index.html  (DOM + inline boot scripts)                             │
   │  app-main.js     → render fns, canonical compute layer               │
   │  finflow-bundle.js → API wiring, KPI overrides, real-time refresh    │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │  fetch('/api/*', credentials: include)   cookie: connect.sid
                   ▼
   ┌─────────────────────────── Express (server.js) ─────────────────────┐
   │  helmet · cors · compression · rate-limit                           │
   │  express-session  ──store──►  Postgres "session" table              │
   │  requireAuth → checkPlan → entity middleware → RBAC middleware      │
   │  /api/* route handlers                                              │
   └───────┬───────────────────────┬──────────────────────┬─────────────┘
           │ db.* (database.js)     │ fetch()              │ SDK
           ▼                        ▼                      ▼
   ┌──────────────┐        ┌────────────────┐    ┌──────────────────────┐
   │ PostgreSQL   │        │ Anthropic API  │    │ Stripe · Resend ·    │
   │ (Supabase)   │        │ (AI)           │    │ Yahoo Finance (quote)│
   │  pg Pool     │        └────────────────┘    └──────────────────────┘
   └──────────────┘
```

The pg `Pool` is created once in [database.js:18](database.js#L18) with
`ssl: { rejectUnauthorized: false }` in production — required because Railway +
Supabase present self-signed TLS certs.

---

## 2. STARTUP / BOOT SEQUENCE

**Server boot.** [server.js:3121](server.js#L3121) calls `initDB()` (creates all
tables/indexes idempotently, [database.js:41](database.js#L41)), then
`app.listen` and kicks off the recurring-bills/invoices scheduler on an hourly
`setInterval` ([server.js:3128](server.js#L3128)).

**Page load.** `GET /app` serves [public/index.html](public/index.html)
([server.js:171](server.js#L171)). `GET /` serves the marketing
`landing.html` instead ([server.js:168](server.js#L168)). Script order in the
shell:

1. `<script src="/app-main.min.js">` — **non-defer**, line
   [index.html:3360](public/index.html#L3360). Defines render functions and the
   canonical compute layer (`computeRevenue`, `computeExpenseBreakdown`) plus
   global state arrays. Runs synchronously as the parser hits it.
2. Many inline `<script>` blocks in between (page-specific helpers, modals).
3. `<script src="/finflow-bundle.min.js" defer>` — line
   [index.html:6116](public/index.html#L6116). The API-wiring engine. Because
   it's `defer`, it executes after the DOM is parsed and after app-main.

**Auth handshake.** The bundle's IIFE registers `boot()` on `DOMContentLoaded`
([finflow-bundle.js:135-142](public/finflow-bundle.js#L135)). `boot()` calls
`FF_API.me()` → `GET /api/auth/me`:
- **200** → `ffOnAuth(user)` ([finflow-bundle.js:74](public/finflow-bundle.js#L74)):
  removes any login overlay, calls `ffLoadData()`, then sets
  `window._ffAuthed = true` and dispatches the `ff:authed` event.
- **non-200 / throw** → `showAuthGate()`
  ([finflow-bundle.js:35](public/finflow-bundle.js#L35)) injects the gold sign-in
  overlay. `ffLogin`/`ffRegister` re-enter `ffOnAuth` on success.

**The `ff:authed` gate.** Almost every other wiring IIFE waits for auth before
patching: `if (!window._ffAuthed) { window.addEventListener('ff:authed', _run, {once:true}); return; }` (e.g.
[finflow-bundle.js:194](public/finflow-bundle.js#L194),
[628](public/finflow-bundle.js#L628),
[5065](public/finflow-bundle.js#L5065)). This is the core boot-timing idiom:
**run after DOM, but block on authentication.**

**Initial data fetches.** `ffLoadData()`
([finflow-bundle.js:88](public/finflow-bundle.js#L88)) fans out 7 parallel GETs
(invoices, expenses, customers, inventory, payroll, goals, holdings) through
`FF_API`, maps each into the in-memory arrays (`window.userInvoices`,
`bizExpenses`, `customers`, `inventory`, `payrollEmployees`, `goals`,
`holdings`), then calls `updateDashboard()` and drains a deferred render queue
(`renderInvoices`, `renderExpenses`, … `updateAI`) one item per idle tick.

**Entity boot (second pass).** A separate IIFE
([finflow-bundle.js:5577](public/finflow-bundle.js#L5577)) waits for `ff:authed`,
then after a 600 ms `setTimeout` re-fetches `/api/auth/me` into
`window.CURRENT_USER` and calls `loadEntitiesFromDB()` if entities aren't loaded
yet. Loading/selecting an entity runs `loadEntityData(idx)`
([app-main.js:1214](public/app-main.js#L1214)), which re-fetches all per-entity
data **with an explicit `?entity_id=` query string** and atomically swaps the
global arrays + `window._realInvoices` / `window._realExpenses`.

---

## 3. AUTH & ENTITY SCOPING (the core security model)

**Authentication.** `POST /api/auth/login`
([server.js:337](server.js#L337)) looks the user up by lower-cased email, checks
`bcrypt.compareSync`, and on success stores `req.session.userId`,
`userRole`, `userEmail`. The session cookie is `connect.sid`, `httpOnly`,
`secure` + `sameSite:'none'` in production, 7-day maxAge
([server.js:207-213](server.js#L207)). `requireAuth`
([server.js:221](server.js#L221)) rejects any request without
`req.session.userId` with **401**.

**The middleware chain on `/api`** (order matters — Express runs in
registration order):
1. `apiLimiter` — 200 req/min ([server.js:219](server.js#L219)).
2. **Plan check** ([server.js:464](server.js#L464)) → `checkPlan`
   ([server.js:227](server.js#L227)): expired trial → **402 TRIAL_EXPIRED**.
   `/auth/`, `/stripe/`, `/accountants`, `/admin` are exempt.
3. **Entity resolution** ([server.js:473](server.js#L473)) — sets
   `req.entityId`:
   - explicit `?entity_id=` (query) or body `entity_id` is the source of truth;
     it is validated as a positive int and **ownership-checked** against the
     `entities` table for the current user (403 if not owned)
     ([server.js:483](server.js#L483)).
   - else `req.session.entityId` if present.
   - else the user's first active entity (`ORDER BY is_active … LIMIT 1`,
     [server.js:500](server.js#L500)); otherwise `req.entityId = null`.
4. **RBAC** ([server.js:517](server.js#L517)): `viewer` = read-only,
   `accountant` = no DELETE, `admin`/`owner` = all.

**The canonical scoping predicate.** Every list read scopes by `user_id` (SQL,
indexed) **and** entity, using a **fail-safe** rule: a row is visible if it has
no entity (`entity_id == null`, legacy/unassigned) **or** an active entity is
known and matches. It never falls open to "all rows" when entity is null.

JS form (used with `db.allByUser`):
```js
r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId)
```
SQL form (used in raw queries):
```sql
(entity_id IS NULL OR ($N::int IS NOT NULL AND entity_id = $N))
```

**Where it's applied.** The JS predicate appears on every GET list route —
invoices [619](server.js#L619), expenses [658](server.js#L658), customers
[698](server.js#L698), inventory [724](server.js#L724), holdings
[975](server.js#L975), journals [1180](server.js#L1180), chart-of-accounts
[1219](server.js#L1219), vendors [1410](server.js#L1410), bills
[1444](server.js#L1444), and the reports/cashflow/tax `matchEnt` helper
([2232](server.js#L2232), [2267](server.js#L2267), [2408](server.js#L2408)).
The SQL form covers COGS/inventory-movements [2286](server.js#L2286), fx-summary
[2302](server.js#L2302)/[3079](server.js#L3079), payroll-runs
[2814](server.js#L2814), and fx-transactions [3031](server.js#L3031). Writes set
the column from `req.entityId` (e.g. holdings POST
[server.js:985](server.js#L985), banking POST [2172](server.js#L2172),
payments-made POST [1654](server.js#L1654)).

---

## 4. DATA MODEL

**Convention.** Almost every table is the same generic JSONB shape, created by a
loop over `TABLES` ([database.js:30-59](database.js#L30)):

```
id SERIAL PK · user_id INT · entity_id INT · data JSONB · created_at · updated_at
```

All domain fields live inside `data`. `rowToObj()`
([database.js:420](database.js#L420)) flattens a row to
`{ id, user_id, entity_id, created_at, updated_at, ...data }`, so route handlers
and the frontend see domain fields at the top level. `objToData()`
([database.js:432](database.js#L432)) strips the reserved columns back out on
write. **Key nuance:** `db.updateById` writes only the `data` column (preserves
the `entity_id` column), while `db.update`/`db.insert` write the `entity_id`
column explicitly ([database.js:578](database.js#L578),
[592](database.js#L592), [453](database.js#L453)).

Real `data` field names per entity (from the route handlers and the frontend
mappers in `loadEntityData` / `ffLoadData`):

| Table | Key `data` fields (real names) |
|---|---|
| `invoices` | `client`, `amount`, `due_date`, `status` (`paid`/`pending`/`overdue`), `notes` |
| `expenses` | `description`, `category`, `amount`, `deductible` (`yes`/`half`/`no`), `expense_date` |
| `customers` | `fname`, `lname`, `company`, `industry`, `email`, `phone`, `revenue`, `status`, `notes` |
| `inventory` | `sku`, `name`, `units`, `max_units`, `cost`, `low_stock` |
| `payroll` | `fname`, `lname`, `role`, `emp_type`, `gross`, `tax_rate`, `av_class`, `is_owner` (bool) |
| `holdings` | `ticker`, `name`, `asset_type`, `shares`, `cost_per`, `price`, `dividend`, `color` |
| `bills` | vendor/amount/`status` (`"Unpaid"` etc.) — JSONB `data` |
| `vendors` | `name`, … (sorted by `name`) |
| `journals` | journal-entry lines — JSONB `data` |
| `chart_of_accounts` | `code` (sorted), account fields |
| `sales_receipts` / `payments_received` / `payments_made` | `amount`, `date` |
| `goals` | `name`, `current_val`, `target_val`, `monthly_contrib`, `color` |
| `personal_transactions` | `source` (e.g. `'banking'`), `date`, amount, category |

**Typed (non-JSONB) tables** with explicit columns: `payroll_runs` &
`payroll_run_lines` ([database.js:253](database.js#L253)), `invoice_payments`
([232](database.js#L232)), `bank_reconciliation` ([242](database.js#L242)),
`inventory_movements` ([280](database.js#L280)), `fx_rates` /
`fx_transactions` ([293](database.js#L293)), `audit_trail`
([217](database.js#L217)), the whole **accountant marketplace** set
(`accountants`, `accountant_clients`, `accountant_earnings`,
`accountant_reviews`, `accountant_messages`, `accountant_deadlines`,
[80-342](database.js#L80)), `ai_cache` / `ai_usage` ([192](database.js#L192)),
`platform_fees` ([377](database.js#L377)), and the `session` table
([69](database.js#L69)). `holdings` gets a belt-and-suspenders
`ALTER TABLE … ADD COLUMN IF NOT EXISTS entity_id`
([database.js:65](database.js#L65)) even though the generic loop already adds it.

Missing tables auto-create on `42P01` via `_ensureTable`
([database.js:396](database.js#L396)), gated by the `TABLES` allowlist.

---

## 5. API SURFACE

All routes are under `/api`, guarded by `requireAuth` (except auth/stripe
webhook), then plan + entity + RBAC middleware. Grouped by domain:

**Auth & account** — `POST /api/auth/register` [282], `/login` [337],
`/logout` [364], `/forgot-password` [371], `/reset-password` [422];
`GET /api/auth/me` [449] & `/api/me` [456]; `PUT /api/auth/change-password`
[1115], `DELETE /api/auth/account` [1129]; `GET|PUT /api/settings`
[1051]/[1058].

**Entities** — `GET|POST /api/entities` [580]/[583],
`PUT|DELETE /api/entities/:id` [589]/[597],
`POST /api/entities/:id/activate` [602].

**Money in** — invoices [618], customers [697], quotes [1375],
sales-receipts [1534], payments-received [1570], credit-notes [1607],
recurring-invoices [1508], invoice-payments [2541]/[2551], mrr [2186]/[2190].

**Money out** — expenses [657], vendors [1409], bills [1443],
payments-made [1647], vendor-credits [1686], recurring-bills [1477].

**Inventory & items** — inventory [723] (+`/restock` [746]), items [762],
inventory-movements [2928]/[2938], cogs [2968] (+`/calculate` [2996]).

**Payroll** — `GET|POST|PUT|DELETE /api/payroll` [806]/[818]/[824]/[836],
`/api/personal-salary` [846], payroll-runs [2809]/[2821] (+`/:id` [2861],
`/approve` [2870], `/mark-paid` [2879]), `/api/payroll/preview` [2888].

**Banking & personal** — banking [2164]/[2167]/[2179] (reads
`personal_transactions` where `source==='banking'`), personal-transactions
[855], goals [890], holdings [973], projects [925], timesheet [1731],
team [1770], budget-targets [1006]/[1025], bank-reconciliation [2575]/[2605].

**Reports & accounting** — cashflow [2228], reports [2263],
reports/profit-loss [2326], balance-sheet [2355], cash-flow [2373],
tax-filing [2404], scenario [2436]/[2449], journals [1179],
chart-of-accounts [1218], audit-log [1253], audit-trail [2511],
lock-settings [1157]/[1164], fx-rates [3008]/[3016],
fx-transactions [3028]/[3037] (+`/:id/settle` [3054]), fx-summary [3071],
documents [1263]/[1268], templates [1298], autocat-rules [1327]
(+`/run` [1354]), connections [2469]/[2482], permissions [2202]/[2210].

**AI (needs `ANTHROPIC_API_KEY`)** — `POST /api/ai`
([server.js:1830](server.js#L1830)): chat over the user's financials; caches in
`ai_cache` for 24 h; model chosen by `COMPLEX_QUERY_RE` (Sonnet vs Haiku).
`GET /api/ai/cache` [1932] lists recent answers. `POST /api/ai/scan` [1990]:
document/receipt vision extraction (10 MB JSON cap). Both call
`https://api.anthropic.com/v1/messages` directly with `process.env.ANTHROPIC_API_KEY`
([1895](server.js#L1895), [2016](server.js#L2016)); a missing/failed key returns
**502** with "Add ANTHROPIC_API_KEY to .env to enable."

**Stripe & external** — `POST /api/stripe/webhook` (raw body, before json
parser, [87](server.js#L87)), `POST /api/stripe/checkout` [260],
`GET /api/stock-price` [3089] (proxies Yahoo Finance quote).

**Admin & accountant marketplace** — registered from
[admin-routes.js](admin-routes.js) ([server.js:1943](server.js#L1943)) and
[accountant-routes.js](accountant-routes.js)
([server.js:1985](server.js#L1985)); `/api/accountant-messages`
[1947]/[1967] are inline.

**Tail handlers.** Any unmatched `/api/*` returns JSON 404
([server.js:3113](server.js#L3113)); everything else falls through to
`landing.html` ([server.js:3116](server.js#L3116)). These are **after** all
routes, so they don't shadow anything. The global error handler
([server.js:2101](server.js#L2101)) returns a generic 500.

---

## 6. THE CANONICAL COMPUTE LAYER (how numbers are produced)

Two pure functions in [app-main.js](public/app-main.js) are the single source of
truth, both exported on `window`:

**`computeRevenue(period)`** — [app-main.js:1577](public/app-main.js#L1577).
Inputs: `window._realInvoices`, `window._receipts`, `window._paymentsReceived`.
Revenue = **paid invoices + sales receipts + payments-received**, period-scoped
(`month`: current calendar month by `date||due_date||created_at`; `quarter`:
current quarter by `due_date`; `year`: all records). Returns a number.

**`computeExpenseBreakdown(period)`** — [app-main.js:1522](public/app-main.js#L1522).
Inputs: `window._realExpenses`, `window._paymentsMade`, `window.ownerPayroll`,
`window.payrollEmployees`. Returns:
```
{ total, realExpenses, paymentsMade, payroll, business, deductible, byCategory, months, period }
```
- `total = realExpenses + paymentsMade + payroll`
- **Elapsed-month payroll** ([1528-1531](public/app-main.js#L1528)):
  `months` = 1 for month, `(currentMonth − quarterStart + 1)` for quarter,
  `currentMonth + 1` for year. `payroll = monthlyPayroll × months` — salary is
  accrued per elapsed month, **never ×12 forward-projected** mid-year. The
  payroll array is built fresh (`op ? [op, ...emps] : [...emps]`),
  never mutating `window.payrollEmployees`.
- `deductible`: `yes`=100%, `half`=50%, `no`=0 of real rows only.
- `byCategory`: from real expense rows only (payroll & bill-payments are added
  as separate lines by the consumers, not folded into a category).

**The identity:** every screen computes `profit = computeRevenue() − computeExpenseBreakdown().total`.

**Screens that consume the canonical layer (all agree on profit):**

| Screen | Function | Revenue | Expense |
|---|---|---|---|
| Dashboard KPIs (app-main) | `updateDashboard` [1756](public/app-main.js#L1756) | `computeRevenue()` | `computeExpenseBreakdown().total` |
| Dashboard KPIs (bundle override) | `updateKPIs` [5248](public/finflow-bundle.js#L5248) | `computeRevenue(period)` [5298](public/finflow-bundle.js#L5298) | `computeExpenseBreakdown(period).total` [5293](public/finflow-bundle.js#L5293) |
| Expenses page | `updateExpenses` [1951](public/app-main.js#L1951) | — | `computeExpenseBreakdown()` |
| AI insights | `updateAI` [3417](public/app-main.js#L3417) | `computeRevenue()` [3425](public/app-main.js#L3425) | `computeExpenseBreakdown().total` [3424](public/app-main.js#L3424) |
| Health score | `updateHealthScore` [3451](public/app-main.js#L3451) | `computeRevenue()` [3462](public/app-main.js#L3462) | `computeExpenseBreakdown().total` [3461](public/app-main.js#L3461) |

The dashboard has **two** writers: app-main's `updateDashboard` writes
`d-rev/d-exp/d-profit` first; the bundle then overrides via `updateKPIs` (patched
onto `window.updateDashboard` at [5466](public/finflow-bundle.js#L5466)) plus a
belt-and-suspenders `_forceKPIs` block ([5486](public/finflow-bundle.js#L5486)).
Both now route through the same canonical helpers, so they can't disagree.

**Screens deliberately on a DIFFERENT basis (operating-only).** The **cash-flow
card** (`updateCashflow`, [app-main.js:1818](public/app-main.js#L1818)) writes
`cf-in`/`cf-out`/`cf-net` straight from `getPeriodData()` (`d.rev`/`d.exp`/
`d.profit`), and **`buildRiver(d)`** ([app-main.js:4749](public/app-main.js#L4749))
draws its Sankey from the same `d.*`. These use the **operating-only** figures
(real invoices/expenses by month), **not** the receipts-inclusive canonical
revenue or payroll-inclusive expense total. They are intentionally left on that
basis. The fixed/variable split and "runway" on that card are derived from real
categorised rows with honest "—" empty states ([1827-1837](public/app-main.js#L1827)).

---

## 7. SCREEN-BY-SCREEN DATA SOURCE MAP

> For any number on screen, trace it: **screen → source(s) → compute fn → what
> the user sees.** Source globals are populated by `ffLoadData`
> ([finflow-bundle.js:88](public/finflow-bundle.js#L88)),
> `loadEntityData` ([app-main.js:1214](public/app-main.js#L1214)), and the
> per-document loaders (`_receipts`, `_paymentsReceived`, `_paymentsMade`,
> `loadHoldingsFromDB`).

| Screen / widget | Feeding globals / fetches | Compute fn | What the user sees |
|---|---|---|---|
| **Dashboard — Revenue KPI** (`d-rev`) | `_realInvoices` + `_receipts` + `_paymentsReceived` | `computeRevenue(period)` | Period revenue, all paid-in sources |
| **Dashboard — Expenses KPI** (`d-exp`) | `_realExpenses` + `_paymentsMade` + `ownerPayroll`/`payrollEmployees` | `computeExpenseBreakdown(period).total` | Real expenses + bill payments + elapsed-month payroll |
| **Dashboard — Profit KPI** (`d-profit`) | (the two above) | `rev − exp` | Canonical profit |
| **Dashboard — Outstanding** (`d-outstanding`) | `userInvoices` (status ≠ paid) | inline in `updateDashboard`/`updateKPIs` | Unpaid total + overdue count/amount |
| **Dashboard — Investments** (`d-invest`) | `holdings`/`holdingsData` | inline in `updateKPIs` [5319](public/finflow-bundle.js#L5319) | Portfolio value (shares×price) + unrealized P/L |
| **Dashboard — Revenue-vs-Expenses chart** | `_realInvoices`/`_realExpenses` | `buildMonthlyArrays` → `updateOverviewChart` ([5456](public/finflow-bundle.js#L5456)) | 12-month bars |
| **Dashboard — Business transactions** (`d-txns`) | `_realInvoices` + `_realExpenses` (entity-scoped, sliced 5+5) | inline in `updateDashboard` [1797](public/app-main.js#L1797) | Recent income/expense rows |
| **Dashboard — Expense bars** (`exp-sal/rent/sw/mkt`) | `getPeriodData()` `d.sal/rent/sw/mkt` (from `EXP_SAL/RENT/SW/MKT`) | `updateDashboard` [1786](public/app-main.js#L1786) / `updateExpenseBars` | Category mini-bars |
| **Cash-flow card** (`cf-in/out/net/avg/fixed/variable/runway`) | `getPeriodData()` (operating-only); fixed/var from `computeExpenseBreakdown().byCategory` | `updateCashflow` [1818](public/app-main.js#L1818) | Operating in/out/net + real fixed-vs-variable split |
| **River / Sankey** | `getPeriodData()` (operating-only) | `buildRiver` [4749](public/app-main.js#L4749) | Money-flow diagram |
| **Invoices page** | `userInvoices` | `renderInvoices` | Invoice rows + stats |
| **Expenses page** (`ex-total/biz/ded/top` + bars) | `_realExpenses` + `_paymentsMade` + payroll | `updateExpenses` [1951](public/app-main.js#L1951) | Canonical total, deductible, largest cost, category bars incl. Payroll & Bill-payment lines |
| **Payroll page** | `payrollEmployees` + `ownerPayroll` (per-entity via `ownerPayrollByEntity`) | `renderPayroll` | Employee/owner rows, gross/net |
| **Inventory page** | `inventory` (`units`, `cost`, `low`) | `renderInventory` | Stock rows + low-stock flags |
| **AI insights panel** | `_realInvoices`/`_realExpenses`/`_receipts`/`_paymentsReceived`/`inventory`/payroll + `REV[]`/`PROFIT[]` for trend deltas | `updateAI` [3417](public/app-main.js#L3417) | Headline rev/profit/margin (canonical), real best/weakest month, real low-stock, top client; honest empty states |
| **Financial Health Score** (`health-score`, `hs-cf/pr/rec/gr`) | canonical rev/exp/profit + `userInvoices` (paid ratio) + `REV[]` (growth) | `updateHealthScore` [3451](public/app-main.js#L3451) | Composite + 4 sub-scores; each sub-score `—` when no data; composite needs ≥2 sub-scores else "Not enough data yet" |
| **Personal finance** | `/api/personal-transactions`, `/api/personal-salary`, goals | `loadPersonalFinance` [3025](public/app-main.js#L3025) | Income/expense, salary sync, goals |
| **Investments page** | `holdings` via `loadHoldingsFromDB` [4645](public/finflow-bundle.js#L4645) (`?entity_id=`) | `renderInvestments` | Holdings table, donut, totals |

Health-score sub-scores ([3467-3475](public/app-main.js#L3467)):
`cfScore = 50 + (profit/throughput)×50`; `prScore = 50 + margin`;
`recScore = paid/invoiced×100`; `grScore = 50 + revenueGrowth×50` — each `null`
(→ "—") when its inputs don't exist.

---

## 8. REAL-TIME UPDATE FLOW

There is **no full page reload** on save. After any DB write, a save handler
calls `window.finflow.refresh([sections])`
([finflow-bundle.js:5940](public/finflow-bundle.js#L5940)):

```
save handler  →  POST/PUT/DELETE /api/<thing>
              →  optimistic in-memory array update
              →  window.finflow.refresh(['expenses','dashboard',...])
                   ├─ per-section dispatch → renderXxx() for affected pages
                   └─ if list includes 'dashboard' (or empty):
                          refreshFinancials(hint)
                            ├─ re-fetch /api/invoices and/or /api/expenses (?entity_id=)
                            ├─ rebuild window.userInvoices / _realInvoices / _realExpenses
                            ├─ re-render the currently open page (_curPage dispatch)
                            └─ window._refreshDashboardUI()
                                 ├─ buildMonthlyArrays → updateOverviewChart
                                 └─ updateKPIs → updateExpenseBars → updateTransactions
```

`refreshFinancials(hint)` ([finflow-bundle.js:5714](public/finflow-bundle.js#L5714))
only re-fetches the side it needs (`'invoices'`/`'revenue'` → invoices,
`'expenses'`/`'costs'` → expenses, `'all'` → both, `'none'` → neither). The
section→hint mapping is computed in `finflow.refresh`
([5967-5971](public/finflow-bundle.js#L5967)). `_refreshDashboardUI`
([5525](public/finflow-bundle.js#L5525)) repopulates the per-month expense
arrays and recomputes KPIs through the canonical layer, so the dashboard reflects
the save immediately. Document loaders (`_receipts`/`_paymentsReceived`/
`_paymentsMade`) each call `finflow.refresh([...,'dashboard',...])` after their
own POST/PUT/DELETE (e.g. [3011](public/finflow-bundle.js#L3011),
[3092](public/finflow-bundle.js#L3092), [3252](public/finflow-bundle.js#L3252)).

**Entity switch** is heavier: `loadEntityData(idx)` zeroes the chart arrays, then
re-fetches invoices/expenses/customers/inventory/payroll for that entity and
atomically swaps all globals ([app-main.js:1214](public/app-main.js#L1214)),
followed by `_bootDashboardWiring`.

---

## 9. EXTERNAL SERVICE WIRING

**Sessions / Redis.** Despite "Redis sessions" in common shorthand, there is
**no Redis** in this codebase. Sessions use `connect-pg-simple` against the
Postgres `session` table ([server.js:196-203](server.js#L196),
[database.js:69](database.js#L69)). Requires `SESSION_SECRET`
([server.js:38](server.js#L38)) and `DATABASE_URL`.

**Stripe** ([server.js:28](server.js#L28)). Initialized only if
`STRIPE_SECRET_KEY` is set; otherwise `stripe = null` and the server logs
`"[Stripe] STRIPE_SECRET_KEY not set — billing features disabled."`
([server.js:30](server.js#L30)). With the key unset:
- `POST /api/stripe/checkout` returns **400** "Stripe not configured."
  ([server.js:261](server.js#L261)).
- `POST /api/stripe/webhook` returns **400** "Stripe not configured."
  ([server.js:88](server.js#L88)).
Additional env vars: `STRIPE_WEBHOOK_SECRET` (signature verify,
[92](server.js#L92)), `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS`
([266](server.js#L266)), `APP_URL` (redirect URLs). The webhook upgrades/cancels
the user's plan and logs a 4% `platform_fees` row for accountant Connect billing
([106-132](server.js#L106)).

**Resend** ([server.js:16-22](server.js#L16)). Initialized only if
`RESEND_API_KEY` is set; if the package isn't installed it logs
`"[Resend] Package not installed — email will be skipped."`. Used for
password-reset email in `POST /api/auth/forgot-password`
([395](server.js#L395)); env `EMAIL_FROM` (default `FinFlow <noreply@finflow.app>`)
and `APP_URL` for the reset link. With the key unset, reset proceeds but the
email send is skipped (logged at [409](server.js#L409)).

**Anthropic** ([server.js:1830](server.js#L1830), [1990](server.js#L1990)).
Called via raw `fetch` to `api.anthropic.com/v1/messages` with header
`x-api-key: process.env.ANTHROPIC_API_KEY` ([1895](server.js#L1895),
[2016](server.js#L2016)). Models from `AI_MODEL_COMPLEX` /
`AI_MODEL_SIMPLE` (defaults `claude-sonnet-4-20250514` /
`claude-haiku-4-5-20251001`, [1863-1864](server.js#L1863)). Prompt-caching beta
header is set, and answers are cached 24 h in `ai_cache`. With the key
unset/invalid, the upstream call fails and the route returns **502** "AI service
unavailable. Add ANTHROPIC_API_KEY to .env to enable." ([1913](server.js#L1913)).

**Yahoo Finance** — `GET /api/stock-price` proxies
`query1.finance.yahoo.com` for live quotes ([server.js:3093](server.js#L3093));
no key required, returns `{ price: null }` on error.

**Database TLS** ([database.js:18-26](database.js#L18)) — pg `Pool` with
`ssl: { rejectUnauthorized: false }` in production (self-signed Supabase/Railway
certs), `keepAlive`, max 10 connections.

---

*Generated read-only from the codebase. Cited line numbers reflect the current
working tree.*
