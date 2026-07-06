# FinFlow — Path B (Real RBAC) Scoping Audit

> Read-only scoping audit produced before building real role-based multi-user
> access. Reference doc for all subsequent RBAC phases — the route→permission
> map (§3) and the two-engine collision flags (§4) especially. No code was
> changed to produce this.

## TL;DR verdict

- **Data scoping is SCATTERED, not centralized.** ~**146 user-scoped query sites in `server.js`** thread `req.session.userId` by hand (79 raw-SQL `WHERE user_id=$N` + 67 `db.allByUser(...)` calls), plus 39 in `accountant-routes.js` and 3 in `admin-routes.js`. There is a partial helper layer, but it does **not** own the scoping decision — every caller passes the id, and 79 raw queries bypass the helper entirely.
- **But there's a huge de-risker:** the app already ships a **working cross-user access pattern** — `accountant_clients` — where a non-owner user reads an owner's `user_id`-scoped data gated by an `access_level`. Team RBAC is the same shape. You don't need to invent the account layer; you need to generalize one that already works.
- **Recommended model:** *don't* add `account_id` to 37 tables. Keep `user_id` as the scope key (it becomes the "account id"), and resolve an **effective account id** in middleware (mirroring the existing `req.entityId` resolver). Invited users get their own `users` row + a membership link to the owner.
- **Honest size: 2–3 weeks** for a solid build; ~1 week for a coarse MVP. The cost is not the concept — it's the ~146 mechanical rethread sites + per-site "is this scope or identity?" classification + new invite/auth flow.

---

## 1. Data scoping depth

**Model.** Every domain table is the generic shape `id · user_id · entity_id · data(JSONB) · timestamps` (database.js:47-59). **All 34 generic tables carry `user_id`:**
`users, entities, invoices, expenses, customers, inventory, payroll, personal_transactions, goals, holdings, user_settings, password_resets, quotes, bills, vendors, recurring_bills, recurring_invoices, recurring_personal_transactions, sales_receipts, payments_received, credit_notes, payments_made, vendor_credits, items, timesheet, projects, team_members, budget_targets, journals, chart_of_accounts, lock_settings, audit_log, documents, templates, autocat_rules`.
Typed tables also carry `user_id` (`personal_accounts, snapshots, invoice_payments, bank_reconciliation, payroll_runs, payroll_run_lines, inventory_movements, fx_rates, fx_transactions, audit_trail, ai_cache, ai_usage, platform_fees`). The `accountant_*` set scopes by `accountant_id`; `accountant_clients` carries **both** `accountant_id` and the client's `user_id`.

**Query-site count (the real scope of change):**

| File | `WHERE user_id=$N` (raw SQL) | `db.allByUser(...)` | Notes |
|---|---:|---:|---|
| server.js | 79 | 67 | **~146 scope sites** — the main surface |
| accountant-routes.js | 39 | 0 | already cross-user by design |
| admin-routes.js | 3 | 0 | admin/global |
| database.js | (helpers) | — | 5 helper methods take `userId` |

**Centralized or scattered? → SCATTERED (with a thin helper veneer).** Evidence:
- `db.allByUser(table, userId, filterFn, sortFn)` (database.js:617) and friends (`getByUser`, `allByEntity`, `deleteByUser`, `ownedBy`) exist — but they take the scope id **as a parameter**. They centralize the *SQL*, not the *decision*. Example call sites all pass it literally:
  `db.allByUser('invoices', req.session.userId, r => r.entity_id == null || ...)` (server.js:656).
- **79 raw `pool.query('... WHERE user_id=$1', [req.session.userId])`** sites skip the helpers entirely.
- `req.session.userId` appears **251×** in server.js — a mix of *scope keys* (change these) and *actor identity / ownership-of-acting-user / session bootstrap* (keep these). Every site needs a scope-vs-identity judgment.

**Scoping by something other than user_id (the slot-in hints):** Two precedents already exist —
1. **`req.entityId` resolver** (server.js:473-514): one middleware resolves the active entity from query/session/DB **with an ownership check**, then routes read `req.entityId`. This is the exact template for a `req.accountId` resolver.
2. **`accountant_clients` cross-user access** (accountant-routes.js:442-461): an accountant's routes resolve a *client's* `user_id`, check `access_level` from `accountant_clients`, then run `WHERE user_id = $clientId`. **This is Path B in miniature, already working in prod.**

---

## 2. Auth & session model

- **Sessions:** `connect-pg-simple` over the Postgres `session` table; login/register set `req.session.userId`, `req.session.userRole`, `req.session.userEmail` (server.js:324-326, 349-351).
- **`users` table:** generic JSONB shape; credentials live in `data` — `email`, `password` (**bcrypt, cost 12**, `bcrypt.hashSync(password,12)` server.js:294), `name`, `plan`, `trial_ends`, **`role`** (register hardcodes `'owner'` server.js:297; login reads `user.role||'owner'` server.js:350).
- **What an invited user's row needs:** their own `users` row (own email + password) **plus a link to the owner's account**. Cleanest is to reuse the `accountant_clients` idea: a membership row `{ member_user_id, account_owner_id, role, status }`. On login, middleware resolves `req.accountId = account_owner_id` (for an owner, = their own id) and `req.role = membership.role`.

---

## 3. Current team/permissions plumbing (what's reusable)

- **`POST /api/team`** (server.js:2161) writes to `team_members`: `{ user_id: OWNER, name, email, role∈{admin,accountant,viewer} }`. **No credentials, no `users` row** — display records only. Reusable as the *membership table* if you add `member_user_id` + `status` and wire real invites.
- **`/api/permissions`** (server.js:2598-2615): persists to `user_settings` (key=`'permissions'`). **Saved shape** = the array `savePermissions()` posts: `PERMS.map(p => ({ a, ac, v }))` (index.html:5083) — i.e. an ordered array, one `{a,ac,v}` per matrix row (Owner is implicit/always-true and not stored). Enforcement would read exactly this array, indexed against the `PERMS` row order.
- **Coarse middleware** (server.js:517-526): the *only* enforcement today. Gates by method×role: `DELETE → admin/owner only`; `POST/PUT/PATCH → block viewer`. Reads `req.session.userRole` (never the matrix). **Extend, don't replace:** keep it as a backstop, add a per-route permission check in front.
- **`ownedBy(table,id,userId)`** (server.js:529) and `userFilter(userId,entityId)` (server.js:544) — the two shared scope helpers to make account-aware.

### Route → permission map

| Matrix row (PERMS order) | Routes to gate | Today's guard |
|---|---|---|
| **View all reports** | `GET /api/reports` [2659], `/api/cashflow` [2624], `POST /api/reports/profit-loss` [2722], `/balance-sheet` [2751], `/cash-flow` [2769], `GET /api/tax-filing` [2800] | auth only |
| **Create invoices** | `POST/PUT/DELETE /api/invoices` [658/670/687], `recurring-invoices` [1860…], `sales-receipts` [1888…], `payments-received` [1926…], `quotes` [1676…], `credit-notes` [1965…] | viewer blocked (coarse) |
| **Manage expenses** | `…/api/expenses` [700/713/730], `bills` [1748…], `payments-made` [2007…], `vendors` [1712…], `vendor-credits` [2053…] | viewer blocked; delete=admin/owner |
| **Run payroll** | `POST /api/payroll` [867], `payroll-runs` [3217], `…/approve` [3266], `…/mark-paid`, `GET/POST /api/personal-salary` [899] | none granular (any non-viewer) |
| **Manage team** | `POST/PUT/DELETE /api/team` [2161/2176/2185], `POST /api/permissions` [2606] | none granular |
| **Bank connections** | `GET/POST /api/connections` [2865/2878], `banking` [2560…], `bank-reconciliation` [2971/3001/3015] | none granular |
| **Entity management** | `POST/PUT/DELETE /api/entities` [617/626/634], `…/activate` [639] | delete=admin/owner only |
| **Audit log** | `GET /api/audit-log` [1404], `/api/audit-trail` [2907] | auth only |
| **API access** | — **no route exists** (3 incidental string hits, no `/api/api-keys`) | n/a — cosmetic row; needs a feature first |

---

## 4. Two-engine exposure (override hazards to flag before building)

Team/permission/entity code is split across **`index.html` (inline)** + **`finflow-api-wiring-*.js` (overrides)** — the same pattern that caused earlier bugs. Confirmed collisions:

- ⚠️ **`saveOwnerPayroll`** — defined in app-main.js:2320 **and overridden** in finflow-api-wiring-medium.js:612 (`window.saveOwnerPayroll = async …`). Genuine two-engine collision; touch with care.
- ⚠️ **`renderTeam`** — defined in index.html:5047, **wrapped** in finflow-api-wiring-extra.js:285. Any frontend role-gating must go through the wrapper, not fight it.
- **`openInviteModal`** — single owner: finflow-api-wiring-extra.js:559 (the real invite entry point to rebuild).
- **`renderEntities`** / **`loadEntitiesFromDB`** — define-in-`index.html` + wrap-in-wiring (already known).
- **Auth** is server-only — no frontend duplication. Clean.
- **Reminder:** any wiring-source edit needs `node bundle.js` + terser (two build artifacts), or the override silently reverts.

---

## Proposal, plan, and estimate

### (b) Org/account layer — recommended
**Do NOT add `account_id` to ~37 tables.** Keep `user_id` as the scope key; treat the owner's `user_id` as the account id. Add:
- A **membership table** (evolve `team_members`): `{ id, account_owner_id (=user_id scope), member_user_id, email, role, status }`. Invited users get a real `users` row; the link carries their role.
- A **`req.accountId` resolver middleware** modeled on the `req.entityId` one: owner → own id; member → `account_owner_id` from membership. Then rethread scope sites from `req.session.userId` → `req.accountId`, keeping `req.session.userId` for *identity/audit*.
- **Precedent to copy:** `accountant_clients` already does cross-user, access-level-gated reads — lift its resolve-then-scope shape.

### (d) Phased build plan (risk flagged)
1. **Auth/invite spine** *(medium)* — invite → email token → accept → `users` row + membership; `req.accountId` + `req.role` in middleware. ⚠️ *Riskiest security surface — get the ownership check airtight, like the `req.entityId` resolver.*
2. **Rethread data scope** *(large but mechanical)* — ~146 `server.js` sites `req.session.userId`→`req.accountId`. ⚠️ *Each needs scope-vs-identity classification; audit-writes must keep the real actor.* Recommend first funneling raw SQL through a `scopeId(req)` helper to shrink future blast radius.
3. **Per-route permission enforcement** *(medium)* — a `requirePerm('run_payroll')` guard reading the saved matrix; apply per the route→permission map; keep the coarse middleware as backstop.
4. **Frontend gating** *(medium)* — hide/disable by `req.role`/matrix; ⚠️ *route through the `renderTeam`/`saveOwnerPayroll` overrides, don't reintroduce the two-engine bug.*
5. **Harden** — viewer can't mutate via direct API; member can't escalate role; entity ownership checks use `accountId`.

### (e) Honest size
**2–3 weeks** for a solid, tested build (phases 1–5), dominated by phase 2's ~146 rethread-and-classify sites and phase 1's auth correctness. A **coarse MVP (~1 week)** is viable if you (i) reuse `accountant_clients`' pattern wholesale, (ii) enforce at role granularity via one `requirePerm` layer instead of per-row-persisted matrix, and (iii) ship frontend gating for polish. The scattered scoping is the tax — if it were centralized this would be a 3–5 day job; it isn't, so it's weeks.
