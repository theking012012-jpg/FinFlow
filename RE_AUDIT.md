# FinFlow Re-Audit — 2026-05-20

Post-fix re-audit of every file after security fixes (auth middleware, db.allByUser migration, duplicate route removal, landing page buttons, scroll fix). This is the current state of the codebase.

---

## File-by-File Summary

---

### database.js

**What works:**
- `initDB()` creates all 34 JSONB tables plus all special tables (`accountants`, `accountant_clients`, `accountant_earnings`, `accountant_reviews`, `accountant_reports`, `admin_log`, `ai_cache`, `ai_usage`, `session`) with correct indexes.
- `db.allByUser()`, `db.allByEntity()`, `db.updateById()`, `db.deleteById()`, `db.deleteByUser()`, `db.getByUser()` — all use parameterised SQL `WHERE` clauses on indexed columns. Safe and fast.
- `_ensureTable()` correctly allowlists against the TABLES array before auto-creating — no arbitrary table injection risk.
- Pool config is reasonable (max 20, idle/connect timeouts set). SSL conditional on `NODE_ENV`.

**Broken or incomplete:**
- `db.all()` (line ~327): still does `SELECT * FROM ${table}` — full table scan, no WHERE clause. The comment in the code says it could extract a userId filter, but this is never implemented — always full-scans and filters in JS.
- `db.get()` (line ~292): `SELECT * FROM ${table} ORDER BY id` — full table scan, JS `.find()`. Used by `ownedBy()` and `activeEntity()` in server.js.
- `db.update()` (line ~381): `SELECT * FROM ${table}` — full table scan, JS `.filter()`.
- `db.delete()` (line ~416): full table scan, then bulk delete.
- `db.upsert()` (line ~439): full table scan.
- `accountant_reports` schema (lines 156–163): columns are `(accountant_id, reporter_id, reason)`. This conflicts with the INSERT in `accountant-routes.js` which specifies `(accountant_id, client_id, type, content)`. See C-2 below.

---

### server.js

**What works:**
- Session config: `httpOnly: true`, `secure` in production, `sameSite: 'none'` in production — correct for cross-site cookie use.
- `requireAuth`, `requireAccountant`, `requireAdmin` middleware correctly check the appropriate session field.
- `checkPlan` middleware correctly queries users table via `pool.query` and handles trial expiry.
- `safeUser()` strips `password_hash` before returning to client.
- Stripe webhook registered before `express.json()` — raw body preserved for signature verification.
- Rate limiting: `authLimiter` (30/15 min) on auth routes, `apiLimiter` (200/min) on all `/api` routes.
- Helmet, compression, and CORS applied.
- CRON scheduler (`runRecurringScheduler`) uses `db.all()` intentionally — correct for system-wide processing.
- AI routes guarded by `checkPlan` and AI usage caps per billing month.
- Audit logging (`logAudit()`) called consistently on mutations.
- ~30 routes correctly migrated to `db.allByUser()` in the last fix pass.
- 5 duplicate accountant routes removed from server.js.

**Broken or incomplete:**
- **Mass assignment** (line ~1412): `POST /api/payments-made` spreads raw `req.body` directly: `{ ...req.body, user_id: req.session.userId }`. A client can inject any JSONB field including `entity_id` or internal flags. Same issue on `PUT /api/payments-made/:id`. See C-3.
- `activeEntity()` uses `db.all('entities', filterFn)` — full table scan across all entities for all users. Should be `db.allByUser('entities', userId)`.
- `ownedBy()` uses `db.get('entities', filterFn)` — same full-scan problem.
- `db.all()` still used in the permissions route and MRR route — fetches all rows then JS-filters by `user_id`. See M-5.
- Hardcoded date in `openJournalEntryModal()`: sets date field to `'2026-04-29'` — static string, wrong on every day except that one. See M-1.
- Duplicate routes: `/api/auth/me` (GET) and `/api/me` (GET) both return identical data. See L-1.
- Reconciliation has no persistence: no `POST /api/reconciliation` or `GET /api/reconciliation` route. See H-5.

---

### admin-routes.js

**What works:**
- All routes correctly protected by `requireAdmin` middleware.
- Admin log INSERT goes to `admin_log` table (confirmed created by `initDB()`).
- Accountant approval/rejection flow correct: updates `status` and `verified_at`, sends email via Resend.
- Commission tier management works via direct `pool.query` on the accountants table.

**Broken or incomplete:**
- **Duplicate route**: `POST /api/admin/accountants/:id/verify` is defined here AND in `accountant-routes.js`. Express only serves the first registered; the second is unreachable. See H-6.
- Preferred partner toggle sets `avg_rating = 5.0` to mark and `avg_rating = 0` to unmark — destroys the real aggregate rating. See M-3.
- Admin login has no dedicated rate limiter (only the global `authLimiter`). Consider a tighter per-endpoint limit.

---

### accountant-routes.js

**What works:**
- 7 previously unprotected routes now have `requireAccountant` or `requireAdmin` middleware (fixed in last pass).
- Accountant registration, login, and profile update flows are structurally correct.
- `POST /api/accountants/run-monthly-payouts` is protected by `x-cron-secret` header.
- `POST /api/accountants/activate-client` validates Stripe subscription before activating.
- Commission tier computation (`getCommissionRate`) is tiered correctly.
- Review and search endpoints work correctly.

**CRITICAL bugs:**
- **`db` not in scope** (lines ~467, 486–491): `registerAccountantRoutes(app, pool, ...)` never receives `db` as a parameter and never imports it. `POST /api/accountants/clients/:userId/journal` and `POST /api/accountants/clients/:userId/lock` will throw `ReferenceError: db is not defined` on every call → 500. See C-1.
- **Column mismatch** on `POST /api/accountants/clients/:userId/flag`: INSERT specifies `(accountant_id, client_id, type, content)` but the table has `(accountant_id, reporter_id, reason)`. PostgreSQL throws 42703 → 500 on every flag submission. See C-2.
- **`POST /api/accountants/extract-resume` has no auth**: calls Anthropic API on user-supplied text with zero authentication. Any internet request drains API credits. See C-4.
- **Duplicate route**: `POST /api/admin/accountants/:id/verify` defined here AND in `admin-routes.js`. See H-6.

**Other issues:**
- Membership verification uses mock logic: any 6+ digit number passes. See L-5.
- `requireAdmin` and `requireAccountant` re-defined locally (also exist in server.js). See L-3.

---

### public/index.html

**What works:**
- Application shell well-structured with sidebar, topbar, and page sections.
- CSP set via meta tag.
- Security utilities defined inline: `window.esc`, `window.validateEmail`, `window.validateAmount`, `window.sanitizeText`, `window.apiRateLimit`, `window.trapFocus`.
- Chart.js loaded from CDN.
- COA_ACCOUNTS static array provides a default chart of accounts.
- `.main` now has `height:100svh` — Settings and Pricing pages scroll correctly (fixed in last pass).

**Broken or incomplete:**
- Hardcoded date `'2026-04-29'` in `openJournalEntryModal()`. See M-1.
- Reconciliation is fully in-memory; bank account "****4821" is hardcoded. `reconState` lost on page reload. See H-5.
- `COA_ACCOUNTS` is a static 16-account array, not fetched from `/api/chart-of-accounts`. User modifications via API are not reflected in the frontend COA.
- CSP meta tag allows `'unsafe-inline'` for scripts — weakens XSS protection.

---

### public/landing.html

**What works:**
- Fully static marketing page — no server-side dependencies.
- SEO meta, Open Graph, Twitter Card correctly set.
- Navigation, hero, features, pricing table, comparison table, testimonials, CTA, footer all present.
- Smooth scroll, intersection observer reveal animations.
- Responsive breakpoints at 900px.
- "Contact Sales" and "Book a Demo" buttons now use `mailto:` links (fixed in last pass).
- Footer links now anchor to sections (fixed in last pass).

**Issues:**
- Pricing shown as "$199/mo" in the comparison table — must match actual Stripe price IDs. See L-7.
- "Trusted by teams at" uses fictitious company names. Launch risk.
- `og:image` and `twitter:image` point to `https://finflow.io/og-image.png` — file must exist on production server. See L-6.

---

### public/admin.html

**What works:**
- Standard login card correctly calls `/api/admin/login`.
- App shell `#app` hidden until login succeeds.

**Issues:**
- No issues found.

---

### public/accountant-dashboard.html

**What works:**
- Structurally correct dashboard for the accountant portal.
- Links to client detail pages correctly.

**Issues:**
- Standalone CSS with no shared stylesheet — design changes must be replicated across 4+ accountant pages. See L-4.

---

### public/accountant-client.html

**What works:**
- Correctly links back to `/accountant` via `back-btn`.
- Shows client financial overview sections.

**Issues:**
- Standalone CSS (same as above). See L-4.

---

### public/accountant-login.html

**What works:**
- Calls `POST /api/accountants/login` correctly.

**Issues:**
- Standalone CSS. See L-4.

---

### public/accountant-register.html

**What works:**
- Multi-step flow including CV upload for credential extraction via `POST /api/accountants/extract-resume`.

**Issues:**
- CV upload calls `extract-resume` which has no auth middleware. See C-4.
- Standalone CSS. See L-4.

---

### public/accountants.html

**What works:**
- Marketing/directory page for the accountant marketplace.
- Commission calculator, FAQ, CTA band — all static and functional.

**Issues:**
- "Trusted by" logos use fictitious placeholder names (TechCorp, Globex LLC, Initech Group). Launch risk.

---

### public/reset-password.html

**What works:**
- Correctly extracts token from URL params.
- Handles three states: reset panel, invalid panel, success panel.
- Calls `POST /api/auth/reset-password`.

**Issues:**
- No issues found.

---

### public/finflow-api.js

**What works:**
- IIFE-wrapped, no global scope pollution beyond `window.FF_API`, `window.ffTab`, etc.
- `boot()` calls `/api/auth/me`; on success calls `ffOnAuth()`; on failure shows inline auth gate. Correct session restore pattern.
- `ffOnAuth()` removes auth gate, sets user name, calls `ffLoadData()`.
- `ffLoadData()` batch-fetches 7 endpoints in parallel.

**Issues:**
- `ffRegister()` does not validate the `name` field — empty name passes through to server. See M-7.
- `payrollEmployees` initials mapping: `r.fname[0]` throws `TypeError` if `fname` is null/undefined. See M-4.
- Redundant session check: `boot()` and `finflow-api-wiring-final.js` both call `/api/auth/me` on load in parallel. See L-2.

---

### public/finflow-api-wiring.js

**What works:**
- Settings load/save, goals CRUD, personal transactions CRUD, holdings save, customers CRUD all correctly wired.
- Wraps `showPage` to reload personal data when visiting the personal page.

**Issues:**
- No issues found specific to this file.

---

### public/finflow-api-wiring-dashboard.js

**What works:**
- `bootDashboardWiring()` correctly fetches invoices and expenses and builds monthly revenue/expense arrays.

**Issues:**
- Entity loading uses `setTimeout(..., 600)` — timing hack that silently fails on slow connections. See M-6.

---

### public/finflow-api-wiring-stubs.js

**What works:**
- Vendors, Bills, Recurring Bills, Recurring Invoices, Quotes wired to their endpoints.
- `markBillPaid` correctly updates bill record and vendor `owing`/`ytd_paid` fields.

**Issues:**
- **Duplicate definitions**: `loadQuotes`, `renderQuotesList`, `saveQuote`, `deleteQuote`, `loadVendors`, `renderVendorsList`, `saveVendor`, `deleteVendor` — all defined here AND in `finflow-api-wiring-pages.js`. Last file loaded wins; load-order change silently changes behaviour. See H-3.

---

### public/finflow-api-wiring-pages.js

**What works:**
- Quotes, Sales Receipts, Payments Received, Recurring Invoices, Credit Notes, Vendors, Bills — all wired inside a DOMContentLoaded IIFE.

**Issues:**
- **Duplicate definitions**: same functions as stubs.js. See H-3.
- `window.finflow.refresh()` called without existence guard. See H-4.

---

### public/finflow-api-wiring-final.js

**What works:**
- `doLogout()` correctly calls `POST /api/auth/logout`.
- Expense edit mode wraps `saveExpense` for PUT.
- Holdings edit/delete correctly defined.

**Issues:**
- Redundant `/api/auth/me` call on DOMContentLoaded (also done by `finflow-api.js` `boot()`). See L-2.

---

### public/finflow-api-wiring-extra.js

**What works:**
- Invoice view modal correctly creates DOM dynamically if not present.
- Timesheet full CRUD wired to `/api/timesheet`.
- Team `renderTeam()` fetches from `/api/team`.
- Projects CRUD all implemented.

**Issues:**
- No issues found specific to this file.

---

### public/finflow-api-wiring-postgres.js

**What works:**
- `loadPersistedData()` and `persistAll()` are correctly neutralised (localStorage no-ops).
- `saveJournalEntry()` correctly wired to `POST /api/journals`.
- `addBusiness()` correctly wired to `POST /api/entities`.
- `refreshFinancials()` re-fetches and rebuilds financial arrays.

**Issues:**
- `updateInvoices()` reads from `window._realInvoices` — no defensive shape check. If another wiring file sets `_realInvoices` to a different shape, this uses stale/wrong data silently.

---

### public/finflow-api-wiring-medium.js

**What works:**
- Invoices, Expenses, Inventory, Payroll CRUD all correctly wired.
- `loadInvoicesFromDB()` maps DB rows to the expected frontend shape.

**Issues:**
- No new issues beyond cross-file duplicate definitions already noted.

---

### public/finflow-api-wiring-final5.js

**What works:**
- Sales Receipts, Payments Received, Credit Notes, Payments Made, Vendor Credits wired to their endpoints.

**Issues:**
- **Not wrapped in an IIFE**: defines global functions directly. Any other script can overwrite them or be overwritten. See M-2.
- **Duplicate definitions**: `renderReceipts`, `renderPaymentsReceived`, `renderCreditNotes` also defined in `finflow-api-wiring-pages.js`. See H-3.
- **`window.finflow.refresh()` called without existence guard**: if `window.finflow` is undefined at call time, throws `TypeError` and halts all subsequent function registrations in that execution context. See H-4.

---

## Priority Fix List

---

### CRITICAL — Will throw errors or corrupt data in production

**C-1. `db` not in scope in `accountant-routes.js`**
`accountant-routes.js` — lines ~467, 486–491
`registerAccountantRoutes` does not receive `db` as a parameter and never imports it. `POST /api/accountants/clients/:userId/journal` and `POST /api/accountants/clients/:userId/lock` throw `ReferenceError: db is not defined` on every call → 500 error.
Fix: Add `const { db } = require('./database');` at the top of `accountant-routes.js`.

**C-2. `accountant_reports` INSERT column mismatch → 500 on every flag submission**
`accountant-routes.js` — `POST /api/accountants/clients/:userId/flag`
INSERT specifies `(accountant_id, client_id, type, content)` but the table has `(accountant_id, reporter_id, reason)`. PostgreSQL throws error 42703 (column does not exist) → 500.
Fix: Change INSERT to use `(accountant_id, reporter_id, reason)` with correct values from `req.body`.

**C-3. Mass assignment on `POST /api/payments-made` and `PUT /api/payments-made/:id`**
`server.js` — line ~1412
`{ ...req.body, user_id: req.session.userId }` spreads the entire request body. A client can inject `entity_id`, `user_id`, or any arbitrary JSONB field.
Fix: Destructure only the expected fields from `req.body` before inserting/updating.

**C-4. `POST /api/accountants/extract-resume` has no authentication**
`accountant-routes.js` — extract-resume route
Accepts uploaded text and calls Anthropic API. Zero auth middleware. Any unauthenticated internet request drains Anthropic API credits.
Fix: Add `requireAccountant` middleware before the handler.

---

### HIGH — Serious functional bugs or security issues

**H-1. `db.all()`, `db.get()`, `db.update()`, `db.delete()`, `db.upsert()` do full table scans**
`database.js`
All five methods fetch every row (`SELECT * FROM ${table}`) then filter in JS. On a multi-user production database, this loads other users' rows into memory on every request and causes O(N) performance degradation.
Fix: Migrate all non-CRON callers to `db.allByUser()`, `db.allByEntity()`, `db.getByUser()`, `db.updateById()`, or `db.deleteById()`.

**H-2. `activeEntity()` and `ownedBy()` full-scan the `entities` table on every authenticated request**
`server.js` — lines ~411–420
Called on every API request that needs the active entity. Scans the entire entities table.
Fix: Replace with `db.allByUser('entities', userId)` + `.find()` or a direct `pool.query` with `WHERE user_id = $1`.

**H-3. Duplicate global function definitions across wiring files**
`finflow-api-wiring-stubs.js`, `finflow-api-wiring-pages.js`, `finflow-api-wiring-final5.js`
`loadQuotes`, `renderQuotesList`, `saveQuote`, `deleteQuote`, `loadVendors`, `saveVendor`, `deleteVendor`, `renderReceipts`, `renderPaymentsReceived`, `renderCreditNotes` — each defined in two different files. Last loaded wins; load-order changes silently change which version is active.
Fix: Remove duplicate definitions; keep one canonical definition per function.

**H-4. `window.finflow.refresh()` called without existence guard**
`finflow-api-wiring-final5.js`, `finflow-api-wiring-pages.js`
If `window.finflow` is undefined when these scripts execute, throws `TypeError` and halts all subsequent function registrations in that execution context.
Fix: Add `if (window.finflow && typeof window.finflow.refresh === 'function')` guard before every call.

**H-5. Reconciliation not persisted**
`index.html` (reconciliation section) + `server.js` (no reconciliation API route)
`reconState` is in-memory only — lost on page reload. Bank account "****4821" is hardcoded.
Fix: Add `POST /api/reconciliation` and `GET /api/reconciliation` routes persisting to a `reconciliation` table.

**H-6. Duplicate `POST /api/admin/accountants/:id/verify` route**
`admin-routes.js` and `accountant-routes.js`
Express serves the first registered; the second definition is unreachable but creates confusion and a security risk if registration order changes.
Fix: Remove the duplicate from `accountant-routes.js`.

---

### MEDIUM — Functional bugs that affect reliability or UX

**M-1. Hardcoded date `'2026-04-29'` in `openJournalEntryModal()`**
`index.html` / `server.js` — journal entry modal
Date field is pre-populated with a static past date on every open.
Fix: Replace with `new Date().toISOString().slice(0, 10)`.

**M-2. `finflow-api-wiring-final5.js` not wrapped in an IIFE**
`public/finflow-api-wiring-final5.js`
All function definitions in global scope. Any other script can accidentally overwrite or be overwritten.
Fix: Wrap entire file in `(function(){ ... })();`.

**M-3. Preferred partner toggle overwrites `avg_rating`**
`admin-routes.js`
Sets `avg_rating = 5.0` to mark preferred, `avg_rating = 0` to unmark. Destroys the real aggregate rating.
Fix: Add `is_preferred_partner BOOLEAN DEFAULT FALSE` column to accountants table; toggle that field.

**M-4. Payroll initials mapping crashes on null `fname`**
`public/finflow-api.js` — line ~99
`r.fname[0]` throws `TypeError` if `fname` is null/undefined.
Fix: `((r.fname || '')[0] || '') + ((r.lname || '')[0] || '')`.

**M-5. `db.all()` still used in permissions and MRR routes**
`server.js` — permissions route and MRR route
Full-table scan then JS filter by `user_id`. Should use `db.allByUser()`.
Fix: Replace with `db.allByUser('permissions', req.session.userId)` and `db.allByUser('user_settings', req.session.userId, r => r.key === 'mrr_data')`.

**M-6. `setTimeout(..., 600)` timing hack for entity loading**
`public/finflow-api-wiring-dashboard.js`
`loadEntitiesFromDB()` delayed 600ms after `/api/me` resolves. Silently fails on slow connections.
Fix: Call `loadEntitiesFromDB()` directly in the `.then()` callback, not in a timeout.

**M-7. `ffRegister()` does not validate the `name` field**
`public/finflow-api.js` — line ~59
Empty name passes through to server and is stored as the user's display name.
Fix: Add `if(!n || !e || !p)` to the validation check.

---

### LOW — Polish, housekeeping, and launch checklist

**L-1. Duplicate `/api/auth/me` and `/api/me` GET routes**
`server.js`
Both routes return identical data. `/api/me` is redundant.
Fix: Remove `/api/me` and update any callers to use `/api/auth/me`.

**L-2. Double session-restore fetch on every page load**
`public/finflow-api.js` (`boot()`) and `public/finflow-api-wiring-final.js` (DOMContentLoaded)
Both call `GET /api/auth/me` in parallel on load — two unnecessary round trips.
Fix: Remove the session-restore call from `finflow-api-wiring-final.js`; rely solely on `finflow-api.js` `boot()`.

**L-3. `requireAdmin` and `requireAccountant` defined in multiple files**
`server.js` and `accountant-routes.js`
Logic changes must be updated in multiple places.
Fix: Extract to a shared `middleware.js` and `require()` it everywhere.

**L-4. Accountant portal pages have no shared stylesheet**
All `accountant-*.html` files
CSS variables and base styles duplicated across 4 files.
Fix: Extract to `public/accountant-shared.css` and link from each page.

**L-5. Membership verification uses mock logic**
`accountant-routes.js`
Any 6+ digit number passes. Must integrate with a real professional body API before the accountant marketplace is live.

**L-6. `og:image` and `twitter:image` must exist on production server**
`public/landing.html`
Both point to `https://finflow.io/og-image.png`. If missing, all social media link previews show a broken image.
Fix: Create and deploy a 1200×630px `og-image.png` before launch.

**L-7. Landing page pricing must match Stripe price IDs**
`public/landing.html`
Comparison table shows $199/mo. Confirm this matches the Stripe price configured in `server.js` and the Stripe dashboard. Any mismatch is a trust/compliance issue.
