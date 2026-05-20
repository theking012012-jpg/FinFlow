# FinFlow — Full System Audit
**Date:** 2026-05-19  
**Auditor:** Claude Sonnet 4.6 (automated)  
**Scope:** All server-side routes, database schema, client pages, modals, buttons, forms, and wiring JS.

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Database Schema](#2-database-schema)
3. [Authentication & Session](#3-authentication--session)
4. [Server Routes (server.js)](#4-server-routes-serverjs)
5. [Admin Routes (admin-routes.js)](#5-admin-routes-admin-routesjs)
6. [Accountant Routes (accountant-routes.js)](#6-accountant-routes-accountant-routesjs)
7. [Client Pages — HTML](#7-client-pages--html)
8. [Client-Side JavaScript Wiring](#8-client-side-javascript-wiring)
9. [Security Issues](#9-security-issues)
10. [Performance Issues](#10-performance-issues)
11. [Broken / Dead UI Elements](#11-broken--dead-ui-elements)
12. [Logic & Consistency Issues](#12-logic--consistency-issues)
13. [API Route Summary Table](#13-api-route-summary-table)

---

## 1. Project Overview

FinFlow is a multi-tenant SaaS financial management platform built on:

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (Express) |
| Database | PostgreSQL via `pg` Pool |
| Session | `express-session` + `connect-pg-simple` |
| Auth | bcrypt passwords, session cookies (HTTP-only) |
| AI | Anthropic Claude (claude-haiku-3-5 / claude-3-5-sonnet) |
| Email | Resend API |
| Payments | Stripe (subscriptions + Connect for accountants) |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Rate Limiting | express-rate-limit: 30/15min auth, 200/min API |

### Architecture Pattern
- All domain data is stored as JSONB inside `data` column in PostgreSQL
- A shared `rowToObj(pgRow)` function spreads `...pgRow.data` to flatten fields
- Session stores `userId` (integer), `accountantId` (integer), `isAdmin` (boolean)
- Multi-entity: every user can have multiple "businesses" (entities), each with its own isolated ledger
- RBAC: `viewer` (read-only), accountant (no DELETE), `admin`/`owner` (full access)

---

## 2. Database Schema

### 2.1 JSONB Tables (auto-created by `database.js`)

All tables follow: `(id SERIAL PRIMARY KEY, user_id INTEGER, entity_id INTEGER, data JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`  
Indexes: `idx_<table>_user_id` on `user_id`, `idx_<table>_entity_id` on `entity_id`.

| Table | Purpose | Key JSONB Fields |
|-------|---------|-----------------|
| `users` | User accounts | `email`, `password_hash`, `name`, `plan`, `stripe_customer_id`, `trial_ends_at`, `referral_code`, `referred_by` |
| `entities` | Business entities per user | `name`, `industry`, `currency`, `tax_id`, `fiscal_year`, `address`, `website`, `is_active` |
| `invoices` | Sales invoices | `client`, `amount`, `due_date`, `status` (pending/paid/overdue), `notes`, `entity_id` |
| `expenses` | Business expenses | `description`, `category`, `amount`, `deductible` (yes/no/half), `expense_date`, `entity_id` |
| `customers` | Customer records | `fname`, `lname`, `company`, `industry`, `email`, `phone`, `revenue`, `status`, `notes` |
| `inventory` | Stock items | `sku`, `name`, `units`, `max_units`, `cost`, `low_stock` |
| `payroll` | Employee/owner payroll | `fname`, `lname`, `role`, `emp_type`, `gross`, `tax_rate`, `av_class`, `is_owner` |
| `personal_transactions` | Personal finance + banking | `description`, `category`, `amount`, `type` (income/expense), `date`, `source` (banking) |
| `goals` | Savings goals | `name`, `current_val`, `target_val`, `monthly_contrib`, `color` |
| `holdings` | Investment portfolio | `ticker`, `name`, `asset_type`, `shares`, `cost_per`, `price`, `dividend`, `color` |
| `user_settings` | Misc key-value store | `key` (e.g. `settings`, `mrr_data`, `permissions`), `value` (JSONB) |
| `password_resets` | Password reset tokens | `token`, `email`, `expires_at` |
| `quotes` | Sales quotes | `client`, `amount`, `expiry_date`, `status` (pending/accepted/declined), `notes`, `num` |
| `bills` | Vendor bills | `vendor`, `amount`, `due_date`, `status`, `notes`, `num` |
| `vendors` | Vendor directory | `name`, `company`, `email`, `phone`, `category`, `notes` |
| `recurring_bills` | Repeating bills | `vendor`, `amount`, `frequency`, `next_date`, `status`, `notes` |
| `recurring_invoices` | Repeating invoices | `client`, `amount`, `frequency`, `next_date`, `status`, `notes` |
| `sales_receipts` | Point-of-sale receipts | `customer`, `num`, `amount`, `date`, `method`, `notes` |
| `payments_received` | Invoice payments received | `customer`, `invoice_ref`, `amount`, `date`, `method`, `notes` |
| `credit_notes` | Customer credits | `customer`, `num`, `amount`, `date`, `status`, `notes` |
| `payments_made` | Outgoing bill payments | `vendor`, `bill_ref`, `amount`, `date`, `method`, `notes` |
| `vendor_credits` | Vendor credits | `vendor`, `num`, `amount`, `date`, `status`, `notes` |
| `items` | Product/service catalogue | `name`, `sku`, `type`, `price`, `cost`, `tax_rate`, `description` |
| `timesheet` | Time tracking entries | `employee`, `project`, `date`, `hours`, `billable`, `rate`, `notes` |
| `projects` | Project management | `name`, `client`, `status`, `budget`, `start_date`, `end_date` |
| `team_members` | Team RBAC | `name`, `email`, `role`, `entity_id` |
| `budget_targets` | Budget planning | `category`, `monthly_budget` |
| `journals` | Manual journal entries | `date`, `description`, `lines` (array), `posted_by` |
| `chart_of_accounts` | COA | `code`, `name`, `type`, `description` |
| `lock_settings` | Period locking | `period`, `locked`, `locked_by` |
| `audit_log` | Activity trail | `user_id`, `action`, `target`, `diff`, `timestamp` |
| `documents` | File attachments | `name`, `type`, `size`, `url`, `category` |
| `templates` | Document templates | `name`, `type`, `content` |
| `autocat_rules` | Auto-categorisation rules | `pattern`, `category`, `confidence` |

### 2.2 Real-Column Tables

| Table | Purpose | Key Columns |
|-------|---------|------------|
| `session` | Express session store | `sid`, `sess`, `expire` |
| `accountants` | Accountant profiles | `id`, `first_name`, `last_name`, `email`, `password_hash`, `firm`, `country`, `specialisation`, `bio`, `status` (pending/verified/rejected/suspended), `referral_code`, `avg_rating`, `hourly_rate`, `packages`, `stripe_account_id` |
| `accountant_clients` | Accountant↔User links | `id`, `accountant_id`, `user_id`, `status` (pending/active/suspended), `referral_month`, `referral_months_total`, `activated_at`, `last_login`, `last_invoice`, `last_expense` |
| `accountant_earnings` | Commission ledger | `id`, `accountant_id`, `user_id`, `type` (referral/service), `amount_cents`, `period_month`, `status` (pending/paid), `description` |
| `accountant_reviews` | Client→Accountant reviews | `id`, `accountant_id`, `reviewer_user_id`, `rating`, `comment`, `created_at` |
| `accountant_reports` | Flags/reports filed by accountants | `id`, `accountant_id`, `user_id`, `transaction_type`, `transaction_id`, `reason`, `created_at` |
| `admin_log` | Admin action log | `id`, `admin_user`, `action`, `target`, `details`, `created_at` |
| `ai_cache` | Cached AI responses | `id`, `cache_key`, `response`, `model`, `tokens_in`, `tokens_out`, `created_at` |
| `ai_usage` | AI usage tracking | `id`, `user_id`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `endpoint`, `cached`, `created_at` |

### 2.3 Database Helper Functions (`db` object)

| Method | SQL | Safe? |
|--------|-----|-------|
| `db.all(table, predicate)` | `SELECT * FROM table` + JS filter | **NO — full table scan** |
| `db.allByUser(table, userId)` | `SELECT * WHERE user_id = $1` | Yes — indexed |
| `db.allByEntity(table, userId, entityId)` | `SELECT * WHERE user_id = $1 AND entity_id = $2` | Yes — indexed |
| `db.get(table, predicate)` | `SELECT * FROM table` + JS `.find()` | **NO — full table scan** |
| `db.insert(table, userId, entityId, data)` | `INSERT ... RETURNING *` | Yes |
| `db.update(table, predicate, data)` | `SELECT *` + JS find + `UPDATE WHERE id = $1` | **NO — full table scan for find** |
| `db.delete(table, predicate)` | `SELECT *` + JS find + `DELETE WHERE id = $1` | **NO — full table scan for find** |
| `db.upsert(table, userId, entityId, key, data)` | `SELECT *` + JS find + INSERT or UPDATE | **NO — full table scan** |

---

## 3. Authentication & Session

### 3.1 Middleware

| Middleware | Checks | Used on |
|-----------|--------|---------|
| `requireAuth` | `req.session.userId` exists | All `/api/*` user routes |
| `requireAccountant` | `req.session.accountantId` exists | All `/api/accountants/*` routes (except public) |
| `requireAdmin` | `req.session.isAdmin === true` | All `/api/admin/*` routes in admin-routes.js |
| Entity middleware | Resolves `req.entityId` from active entity | After `requireAuth` on entity-scoped routes |

### 3.2 Auth Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account; bcrypt hash; 14-day trial; sends welcome email via Resend |
| POST | `/api/auth/login` | Validate credentials; set `req.session.userId`; rate-limited (30/15min) |
| POST | `/api/auth/logout` | Destroy session |
| POST | `/api/auth/forgot-password` | Generate reset token; email via Resend |
| POST | `/api/auth/reset-password` | Validate token; update password hash |
| GET | `/api/auth/me` | Return current user data |
| GET | `/api/me` | Alias for `/api/auth/me` |
| PUT | `/api/auth/change-password` | Verify old password; set new bcrypt hash |
| DELETE | `/api/auth/account` | Delete account and all data |

### 3.3 Session Configuration
- Cookie: HTTP-only, `sameSite: 'lax'`, secure in production
- Store: PostgreSQL (`connect-pg-simple`) — session table
- Secret: `SESSION_SECRET` environment variable

---

## 4. Server Routes (server.js)

### 4.1 Entity Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/entities` | requireAuth | List user's entities |
| POST | `/api/entities` | requireAuth | Create new entity |
| PUT | `/api/entities/:id` | requireAuth | Update entity fields |
| DELETE | `/api/entities/:id` | requireAuth | Delete entity |
| POST | `/api/entities/:id/activate` | requireAuth | Set entity as active (switches ledger context) |

**Note:** `activeEntity()` uses `db.all('entities', ...)` — full table scan.

### 4.2 Invoice Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/invoices` | requireAuth | List invoices for active entity |
| POST | `/api/invoices` | requireAuth | Create invoice |
| PUT | `/api/invoices/:id` | requireAuth | Update invoice (RBAC: viewer blocked) |
| DELETE | `/api/invoices/:id` | requireAuth | Delete invoice (RBAC: viewer/accountant blocked) |

### 4.3 Expense Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/expenses` | requireAuth | List expenses for entity |
| POST | `/api/expenses` | requireAuth | Create expense |
| PUT | `/api/expenses/:id` | requireAuth | Update expense |
| DELETE | `/api/expenses/:id` | requireAuth | Delete expense |

### 4.4 Customer Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/customers` | requireAuth | List customers |
| POST | `/api/customers` | requireAuth | Create customer |
| PUT | `/api/customers/:id` | requireAuth | Update customer |
| DELETE | `/api/customers/:id` | requireAuth | Delete customer |

### 4.5 Inventory Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/inventory` | requireAuth | List inventory |
| POST | `/api/inventory` | requireAuth | Create item |
| PUT | `/api/inventory/:id` | requireAuth | Update item |
| DELETE | `/api/inventory/:id` | requireAuth | Delete item |
| POST | `/api/inventory/:id/restock` | requireAuth | Add stock units |

### 4.6 Payroll Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/payroll` | requireAuth | List payroll records for entity |
| POST | `/api/payroll` | requireAuth | Create payroll record |
| PUT | `/api/payroll/:id` | requireAuth | Update payroll record |
| DELETE | `/api/payroll/:id` | requireAuth | Delete payroll record |
| GET | `/api/personal-salary` | requireAuth | Fetch owner payroll records across all entities (cross-entity) |

### 4.7 Personal Finance Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/personal-transactions` | requireAuth | List personal transactions |
| POST | `/api/personal-transactions` | requireAuth | Create transaction |
| PUT | `/api/personal-transactions/:id` | requireAuth | Update transaction |
| DELETE | `/api/personal-transactions/:id` | requireAuth | Delete transaction |

### 4.8 Goals Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/goals` | requireAuth | List goals |
| POST | `/api/goals` | requireAuth | Create goal |
| PUT | `/api/goals/:id` | requireAuth | Update goal |
| DELETE | `/api/goals/:id` | requireAuth | Delete goal |

### 4.9 Holdings (Investments) Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/holdings` | requireAuth | List holdings |
| POST | `/api/holdings` | requireAuth | Create holding |
| PUT | `/api/holdings/:id` | requireAuth | Update holding |
| DELETE | `/api/holdings/:id` | requireAuth | Delete holding |

### 4.10 Quotes Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/quotes` | requireAuth | List quotes |
| POST | `/api/quotes` | requireAuth | Create quote |
| PUT | `/api/quotes/:id` | requireAuth | Update quote |
| DELETE | `/api/quotes/:id` | requireAuth | Delete quote |

### 4.11 Vendor & Bill Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/vendors` | requireAuth | List vendors |
| POST | `/api/vendors` | requireAuth | Create vendor |
| PUT | `/api/vendors/:id` | requireAuth | Update vendor |
| DELETE | `/api/vendors/:id` | requireAuth | Delete vendor |
| GET | `/api/bills` | requireAuth | List bills |
| POST | `/api/bills` | requireAuth | Create bill |
| PUT | `/api/bills/:id` | requireAuth | Update bill |
| DELETE | `/api/bills/:id` | requireAuth | Delete bill |

### 4.12 Recurring Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/recurring-bills` | requireAuth | List recurring bills |
| POST | `/api/recurring-bills` | requireAuth | Create recurring bill |
| PUT | `/api/recurring-bills/:id` | requireAuth | Update |
| DELETE | `/api/recurring-bills/:id` | requireAuth | Delete |
| GET | `/api/recurring-invoices` | requireAuth | List recurring invoices |
| POST | `/api/recurring-invoices` | requireAuth | Create recurring invoice |
| PUT | `/api/recurring-invoices/:id` | requireAuth | Update |
| DELETE | `/api/recurring-invoices/:id` | requireAuth | Delete |

### 4.13 Sales Receipts, Payments, Credit Notes Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/sales-receipts` | requireAuth | List / create |
| PUT/DELETE | `/api/sales-receipts/:id` | requireAuth | Update / delete |
| GET/POST | `/api/payments-received` | requireAuth | List / create |
| PUT/DELETE | `/api/payments-received/:id` | requireAuth | Update / delete |
| GET/POST | `/api/credit-notes` | requireAuth | List / create |
| PUT/DELETE | `/api/credit-notes/:id` | requireAuth | Update / delete |
| GET/POST | `/api/payments-made` | requireAuth | List / create |
| PUT/DELETE | `/api/payments-made/:id` | requireAuth | Update / delete |
| GET/POST | `/api/vendor-credits` | requireAuth | List / create |
| PUT/DELETE | `/api/vendor-credits/:id` | requireAuth | Update / delete |

### 4.14 Items Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/items` | requireAuth | List catalogue items |
| POST | `/api/items` | requireAuth | Create item |
| PUT | `/api/items/:id` | requireAuth | Update item |
| DELETE | `/api/items/:id` | requireAuth | Delete item |

### 4.15 Timesheet & Projects Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/timesheet` | requireAuth | List / create time entries |
| PUT/DELETE | `/api/timesheet/:id` | requireAuth | Update / delete |
| GET/POST | `/api/projects` | requireAuth | List / create projects |
| PUT/DELETE | `/api/projects/:id` | requireAuth | Update / delete |

### 4.16 Team Members Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/team` | requireAuth | List team members |
| POST | `/api/team` | requireAuth | Add team member |
| PUT | `/api/team/:id` | requireAuth | Update team member |
| DELETE | `/api/team/:id` | requireAuth | Remove team member |

### 4.17 Journals & Chart of Accounts Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/journals` | requireAuth | List / create journal entries |
| DELETE | `/api/journals/:id` | requireAuth | Delete journal |
| GET/POST | `/api/chart-of-accounts` | requireAuth | List / create COA entries |
| PUT/DELETE | `/api/chart-of-accounts/:id` | requireAuth | Update / delete |

### 4.18 Documents & Templates Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/documents` | requireAuth | List / upload documents |
| GET | `/api/documents/:id/download` | requireAuth | Download document |
| DELETE | `/api/documents/:id` | requireAuth | Delete document |
| GET/POST | `/api/templates` | requireAuth | List / create templates |
| PUT/DELETE | `/api/templates/:id` | requireAuth | Update / delete |

### 4.19 Auto-Categorisation Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/autocat-rules` | requireAuth | List / create rules |
| PUT/DELETE | `/api/autocat-rules/:id` | requireAuth | Update / delete |
| POST | `/api/autocat-rules/run` | requireAuth | Run rules against all expenses |

### 4.20 Special / Aggregated Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/budget-targets` | requireAuth | Load budget targets (from `user_settings`) |
| PUT | `/api/budget-targets` | requireAuth | Save budget targets |
| GET | `/api/settings` | requireAuth | Load user settings |
| PUT | `/api/settings` | requireAuth | Save user settings |
| GET | `/api/lock-settings` | requireAuth | Load period lock settings |
| POST | `/api/lock-settings` | requireAuth | Update period lock |
| GET | `/api/audit-log` | requireAuth | Fetch audit trail |
| GET | `/api/mrr` | requireAuth | Load MRR/SaaS data |
| PUT | `/api/mrr` | requireAuth | Save MRR data |
| GET | `/api/permissions` | requireAuth | Load RBAC permissions |
| POST | `/api/permissions` | requireAuth | Save RBAC permissions |

### 4.21 Banking Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/banking` | requireAuth | List banking transactions (`personal_transactions` WHERE `source='banking'`) |
| POST | `/api/banking` | requireAuth | Create banking transaction |
| DELETE | `/api/banking/:id` | requireAuth | Delete banking transaction |

### 4.22 AI Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ai` | requireAuth | Chat with Claude; includes prompt caching + response caching |
| GET | `/api/ai/cache` | requireAuth | View AI cache stats |
| POST | `/api/ai/scan` | requireAuth | Receipt scanner — send image to Claude Vision |

**AI Implementation Details:**
- Model: `claude-haiku-3-5` (receipt scan), `claude-3-5-sonnet-20241022` (chat)
- Cache key: SHA-256 hash of `(userId + prompt + contextHash)`
- `ai_cache` table stores response + token counts
- `ai_usage` table tracks per-request cost (input + output tokens × price)
- Prompt context includes: invoices, expenses, payroll, goals, entity info

### 4.23 Stripe Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/stripe/webhook` | Stripe signature | Handles: `checkout.session.completed`, `customer.subscription.deleted`, `account.updated` (for Connect) |

**Webhook events handled:**
- `checkout.session.completed`: Upgrade user plan (Pro/Business), update `trial_ends_at`; call `activateClientCommission()` if referral code present
- `customer.subscription.deleted`: Downgrade plan to `trial`
- `account.updated`: Mark Stripe Connect account as verified for accountants

### 4.24 Recurring Scheduler
- Runs on startup + `setInterval` every 1 hour
- Processes `recurring_invoices`: creates `invoices` when `next_date <= today`, advances `next_date`
- Processes `recurring_bills`: creates `bills` when `next_date <= today`, advances `next_date`
- No locking mechanism — concurrent executions on multi-process deployments would create duplicates

### 4.25 Page Routes

| Path | Serves |
|------|--------|
| GET `/` | `public/landing.html` |
| GET `/app` | `public/index.html` (main app) |
| GET `/join` | `public/accountant-register.html` |
| GET `/accountant` | `public/accountant-dashboard.html` |
| GET `/accountant-login` | `public/accountant-login.html` |
| GET `/accountants` | `public/accountants.html` |
| GET `/admin` | `public/admin.html` |

---

## 5. Admin Routes (admin-routes.js)

All routes require `requireAdmin` (checks `req.session.isAdmin`).

### 5.1 Admin Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/login` | None | Password from `ADMIN_PASSWORD` env var; sets `req.session.isAdmin = true` |
| POST | `/api/admin/logout` | requireAdmin | Destroy admin session |
| GET | `/api/admin/me` | requireAdmin | Return admin session info |

### 5.2 Admin Data Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/overview` | requireAdmin | Aggregated stats: user count, accountant count, AI usage, earnings, reports |
| GET | `/api/admin/accountants` | requireAdmin | List accountants with search/status filter, client count, total earnings |
| POST | `/api/admin/accountants/:id/verify` | requireAdmin | Approve / reject / suspend / reinstate accountant; sends Resend email |
| POST | `/api/admin/accountants/:id/preferred-partner` | requireAdmin | Set `avg_rating` to 5.0 (preferred) or 0 (remove) |
| GET | `/api/admin/users` | requireAdmin | List users with search/plan filter |
| POST | `/api/admin/users/:id/suspend` | requireAdmin | Suspend / unsuspend user account |
| GET | `/api/admin/reports` | requireAdmin | List flagged transaction reports from accountants |
| POST | `/api/admin/reports/:id/dismiss` | requireAdmin | Delete report |
| GET | `/api/admin/earnings` | requireAdmin | List all accountant earnings with summary |
| POST | `/api/admin/earnings/mark-paid` | requireAdmin | Bulk mark earnings as paid (accepts array of IDs) |
| GET | `/api/admin/costs` | requireAdmin | AI usage/cost tracking + Stripe balance |
| GET | `/api/admin/log` | requireAdmin | Admin action log |

**Note:** A duplicate `POST /api/admin/accountants/:id/verify` is also defined in `accountant-routes.js` WITHOUT `requireAdmin` — see Security Issues §9.

---

## 6. Accountant Routes (accountant-routes.js)

### 6.1 Accountant Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/accountants/register` | None | 4-field validation; bcrypt hash; referral lookup; auto-membership check (simulated); Resend welcome email |
| POST | `/api/accountants/login` | None | bcrypt compare; sets `req.session.accountantId` |
| POST | `/api/accountants/logout` | None | Clears `accountantId` from session |
| GET | `/api/accountants/me` | requireAccountant | Return accountant profile |

### 6.2 Client Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/accountants/clients` | requireAccountant | List accountant's linked clients with activity timestamps |
| GET | `/api/accountants/clients/:userId/books` | requireAccountant | Fetch full client data: invoices, expenses, entities, settings, payroll, journals, customers, bills |
| POST | `/api/accountants/clients/:userId/journal` | requireAccountant | Post journal entry into client's books |
| POST | `/api/accountants/clients/:userId/lock` | requireAccountant | Lock a reporting period for a client |
| GET | `/api/accountants/clients/:userId/notes` | requireAccountant | Get accountant notes for client |
| POST | `/api/accountants/clients/:userId/notes` | requireAccountant | Save accountant notes for client |
| POST | `/api/accountants/clients/:userId/flag` | requireAccountant | Flag a transaction (inserts into `accountant_reports`) |

### 6.3 Invitations & Referrals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/accountants/invite` | requireAccountant + verified status | Send email invite to client via Resend |
| POST | `/api/accountants/link-client` | **NO AUTH** | Link user to accountant by referral code |
| POST | `/api/accountants/activate-client` | **NO AUTH** | Activate client commission (sets status=active, starts earning timer) |

### 6.4 Earnings & Commission

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/accountants/earnings` | requireAccountant | List earnings with summary |
| POST | `/api/accountants/record-commission` | **NO AUTH** | Record service commission (4% of bill amount) |
| POST | `/api/accountants/run-monthly-payouts` | `CRON_SECRET` header only | Process monthly commission payouts |
| POST | `/api/accountants/suspend-client` | **NO AUTH** | Suspend client commission |
| POST | `/api/accountants/reactivate-client` | **NO AUTH** | Reactivate suspended client |

### 6.5 Directory & Reviews

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/accountants/directory` | None (public) | Public accountant directory |
| GET | `/api/accountants/:id/reviews` | None (public) | Public reviews for accountant |
| POST | `/api/accountants/review` | `req.session.userId` check | Post review (payment-gated: user must be on paid plan) |
| POST | `/api/accountants/report` | `req.session.userId` check | Report an accountant |
| GET | `/api/accountants/my-accountant` | `req.session.userId` check | Get linked accountant for current user |
| POST | `/api/accountants/request-access` | `req.session.userId` check | Request accountant access to user's books |

### 6.6 Admin Routes in accountant-routes.js (SECURITY ISSUE)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/accountants/pending` | **NO requireAdmin** (TODO comment) | List pending accountants — unprotected |
| POST | `/api/admin/accountants/:id/verify` | **NO requireAdmin** (TODO comment) | Approve/reject accountants — unprotected; DUPLICATE of admin-routes.js version |

### 6.7 CV/Resume Extraction

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/accountants/extract-resume` | None | Upload PDF/image CV; Claude Haiku vision extracts: name, email, firm, specialisation, country, bio |
| POST | `/api/accountants/verify-membership` | None | Membership lookup — **currently mock/simulated with setTimeout** |

### 6.8 Client Billing via Accountant Dashboard

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/accountants/invite` | requireAccountant | Sends Resend email with referral link |

**Duplicate routes between accountant-routes.js and server.js:**
- `GET /api/accountants/directory` — defined in both
- `GET /api/accountants/my-accountant` — defined in both  
- `POST /api/accountants/request-access` — defined in both
- `POST /api/accountants/report` — defined in both
- `POST /api/accountants/review` — defined in both

---

## 7. Client Pages — HTML

### 7.1 `landing.html` — Marketing Landing Page

**Navigation:**
| Element | Target | Notes |
|---------|--------|-------|
| FinFlow logo | `href="/"` | Working |
| Features | anchor `#features` | Working |
| AI | anchor `#ai-demo` | Working |
| Pricing | anchor `#pricing` | Working |
| Compare | anchor `#compare` | Working |
| Accountants | `href="/accountants"` | Working |
| Sign in | `href="/app"` | Working |
| Start free trial | `href="/app"` | Working |

**Hero:**
| Button | Target | Notes |
|--------|--------|-------|
| Start 14-day free trial | `href="/app"` | Working |
| See how it works | JS smooth scroll | Working |

**Broken Elements:**
| Element | Issue |
|---------|-------|
| Enterprise "Contact sales" button | `<button class="p-cta">` — NO onclick, NO href — BROKEN |
| "Book a demo" button | `<button>` with no action — BROKEN |
| All footer links | All `href="#"` — dead links (Features, Pricing, AI, Integrations, Changelog, comparisons, About, Blog, Security, Privacy, Terms, Contact) |

**Static/Fake Content:**
- Stats section: hardcoded values (9.4 rating, 37% cheaper, 14s scan time, 750+ integrations)
- Testimonials: 3 fake profiles (Sarah Chen, Marcus Reid, Priya Nair)
- "Trusted by" logos: TechCorp, Globex LLC, Initech Group, NovaTech, Pinnacle Co, Summit Inc — all fictional
- AI chat demo: animated via setTimeout — NOT real API call
- Pricing: toggle is JS-only display; clicking Pro/Business shows no real Stripe Checkout

### 7.2 `accountant-login.html` — Accountant Login

**Form:**
| Field | ID | Notes |
|-------|-----|-------|
| Email | `email` | Required |
| Password | `password` | Required |

**Buttons:**
| Button | Action | API |
|--------|--------|-----|
| Sign in | `login()` | `POST /api/accountants/login` → redirect to `/accountant` |

**Footer links:**
- "Register as an accountant" → `href="/join"` (working)
- "Are you a client? Sign up" → `href="/app"` (working)

### 7.3 `accountant-register.html` — 4-Step Registration Wizard

**Step 1 — Profile:**
| Element | Notes |
|---------|-------|
| CV upload | Drag-or-click; `POST /api/accountants/extract-resume` auto-fills fields |
| First name | Required |
| Last name | Required |
| Email | Required |
| Password | Required |
| Firm / Practice | Optional |
| Country | Dropdown |
| Specialisation | Text |
| Bio | Textarea |

**Step 2 — Verification:**
| Option | Notes |
|--------|-------|
| Membership number | CLIENT-SIDE SIMULATION ONLY — `setTimeout` fake lookup; does NOT call real API |
| Employer reference | Static field (not verified) |
| Institution | Static field (not verified) |

**Step 3 — Pricing:**
| Field | Notes |
|-------|-------|
| Hourly rate | Number |
| Service packages (up to 4) | Name + price fields |
| Pricing note | Textarea |

**Step 4 — Success (auto-shown):**
- Shown after successful `POST /api/accountants/register`
- **BUG:** `.catch(() => { setStep(4); })` — if the API call FAILS, the success screen is shown anyway (line ~987 in file)

### 7.4 `accountant-dashboard.html` — Accountant Workspace

**Boot:** `boot()` → `GET /api/accountants/me`; redirects to `/accountant-login` if not authenticated.

**Sidebar Navigation:**
| Tab | Page ID |
|-----|---------|
| Dashboard | `page-dashboard` |
| Deadlines | `page-deadlines` |
| Clients | `page-clients` |
| Invite Client | `page-invite` |
| Earnings | `page-earnings` |
| My Profile | `page-profile` |

**Dashboard page:**
- Stat cards: Active Clients, Pending, MTD Earnings, Upcoming Deadlines (all from API data)
- Client table (first 5): Plan, Status, Activity badge, Activated date, "View books" button
- Deadlines list (first 5): Due date, urgency badge, days remaining

**Clients page:**
- Full client table: Name, Email, Plan, Status, Activity, Commission months, "View books" button
- Referral URL display + "Copy link" button (copies to clipboard)
- Tier progress table (Starter/Growth/Elite)

**Deadlines page:**
- "Add deadline" button → modal (client name, filing type, due date, "Save deadline" button)
- **NOTE:** Deadlines are stored IN-MEMORY only — lost on page refresh; no persistence API

**Earnings page:**
- Stat cards: Total Earned, This Month, Pending Payout (from `GET /api/accountants/earnings`)
- Earnings history table: Date, Type, Description, Amount, Status

**Profile page:**
- Fields: First name, Last name, Email (disabled), Firm, Country, Specialisation, Experience, Bio
- Verification status display
- **NOTE:** No save button visible for profile edits in the partial read — profile update API is not confirmed

**Bills modal (client billing):**
- Client select dropdown (populated from clients list)
- Service description field
- Amount field (minimum $50)
- Fee breakdown: Client pays / FinFlow fee (4%) / You receive (96%)
- "Send payment link" button → `submitBill()`

**Books modal (inline viewer):**
- Period filter: All time / Year to date / This month / Last 3/6/12 months
- Entity tabs (if multiple entities)
- Summary cards: Total Income, Total Expenses, Net Profit, Tax Deductible
- Invoice status: Paid / Pending / Overdue counts
- P&L Statement, Expenses by Category (client-side calculation)
- Invoices list, Expenses list
- Section tabs: Overview / Payroll / Balance Sheet / Journals / Customers
- Accountant Notes textarea + "Save Note" button → `POST /api/accountants/clients/:userId/notes`
- Journal entry form: Date, Description, account lines (debit/credit) → `POST /api/accountants/clients/:userId/journal`
- Period locking: 6 months shown, each has "Lock" button → `POST /api/accountants/clients/:userId/lock`

**NOTE:** `viewBooks()` now opens `accountant-client.html` in a new tab (full-screen workspace) instead of the inline modal.

### 7.5 `accountant-client.html` — Full Client Workspace

**URL params:** `?client=userId&name=clientName`  
**Data source:** Single `GET /api/accountants/clients/:userId/books`

**Sections:**
| Section | Contents |
|---------|----------|
| Dashboard | KPI cards (Income, Expenses, Profit, Deductible), period filter, entity filter |
| Invoices | Invoices table |
| Customers | Customer table |
| Expenses | Expenses table |
| Payroll | Payroll list |
| P&L | Profit & Loss statement |
| Balance Sheet | Assets, Liabilities, Net Equity |
| Journals | Journal entries + Add entry form → `POST /api/accountants/clients/:userId/journal` |
| Tax | Estimated tax liability, deductible summary |
| Notes | Accountant notes → `GET`/`POST /api/accountants/clients/:userId/notes` |

**Buttons:**
| Button | Action | API |
|--------|--------|-----|
| Export CSV | Client-side CSV generation | None |
| Flag transaction | `flagTxn()` → `POST /api/accountants/clients/:userId/flag` | Inserts into `accountant_reports` |
| Lock period | `POST /api/accountants/clients/:userId/lock` | Writes to `lock_settings` |
| Post journal entry | `POST /api/accountants/clients/:userId/journal` | Writes to `journals` |
| Save notes | `POST /api/accountants/clients/:userId/notes` | Writes to `user_settings` |

### 7.6 `accountants.html` — Marketing Page for Accountants

**Buttons/Links:**
| Element | Target |
|---------|--------|
| "Register your practice" nav link | `href="/join"` |
| "Sign in to dashboard" nav link | `href="/accountant-login"` |
| Hero "Register your practice →" | `href="/join"` |

- Static marketing: how-it-works steps, feature cards, tier cards, commission calculator
- Commission calculator: client-side JS only, no API calls

### 7.7 `reset-password.html` — Password Reset

- Extracts `?token` from URL query string
- Shows invalid-panel if no token present
- `POST /api/auth/reset-password` with `{ token, password }`
- Min 6 chars client-side validation

### 7.8 `admin.html` — Admin Dashboard

**Login:**
- Password input → `adminLogin()` → `POST /api/admin/login`

**Sidebar sections (all behind requireAdmin server-side):**
| Section | API |
|---------|-----|
| Dashboard (overview) | `GET /api/admin/overview` |
| Pending accountants | `GET /api/admin/accountants/pending` — **UNPROTECTED on server (see §9)** |
| All accountants | `GET /api/admin/accountants` |
| Users | `GET /api/admin/users` |
| Reports | `GET /api/admin/reports` |
| Earnings | `GET /api/admin/earnings` |
| Costs | `GET /api/admin/costs` |
| Log | `GET /api/admin/log` |

**Admin actions:**
- Approve/reject accountant → `POST /api/admin/accountants/:id/verify`
- Set preferred partner → `POST /api/admin/accountants/:id/preferred-partner`
- Suspend/unsuspend user → `POST /api/admin/users/:id/suspend`
- Dismiss report → `POST /api/admin/reports/:id/dismiss`
- Mark earnings paid → `POST /api/admin/earnings/mark-paid`

### 7.9 `index.html` — Main Application (SPA)

**Sidebar Navigation (full list):**
| Nav Item | Page | Notes |
|----------|------|-------|
| Dashboard | `page-dashboard` | Default active |
| Banking | `page-banking` | |
| Money In > Invoices | `page-invoices` | Badge showing count |
| Money In > Customers | `page-customers` | |
| Money In > Quotes | `page-quotes` | |
| Money In > Payments Received | `page-payments-received` | |
| Money In > Sales Receipts | `page-sales-receipts` | |
| Money In > Recurring Invoices | `page-recurring-invoices` | |
| Money In > Credit Notes | `page-credit-notes` | |
| Money Out > Expenses | `page-expenses` | |
| Money Out > Bills | `page-bills` | Badge showing count |
| Money Out > Vendors | `page-vendors` | |
| Money Out > Payments Made | `page-payments-made` | |
| Money Out > Recurring Bills | `page-recurring-bills` | |
| Money Out > Vendor Credits | `page-vendor-credits` | |
| Payroll | `page-payroll` | |
| Inventory | `page-inventory` | Badge shown |
| Items | `page-items` | |
| Time Tracking > Projects | `page-projects` | |
| Time Tracking > Timesheet | `page-timesheet` | |
| Reports | `page-reports` | |
| Budget | `page-budget` | |
| MRR / SaaS | `page-mrr` | |
| Investments (Business) | `page-biz-investments` | |
| Accountant > Manual Journals | `page-manual-journals` | |
| Accountant > Chart of Accounts | `page-chart-of-accounts` | |
| Accountant > Transaction Locking | `page-transaction-locking` | |
| Documents | `page-documents` | |
| Templates | `page-templates` | |
| API connections | `page-connections` | |
| Entities | `page-entities` | |
| Team & roles | `page-team` | |
| Audit trail | `page-audit` | |
| Personal > Personal finance | `page-personal` | |
| Personal > Investments | `page-investments` | |
| Personal > Scenario planner | `page-scenario` | |
| Intelligence > AI insights | `page-ai` | |
| Intelligence > Auto-categorise | `page-autocat` | |
| Clients > Client portal | `page-portal` | |
| Settings (gear icon) | `page-settings` | |
| Plans & pricing | `page-pricing` | |

**Topbar Controls:**
| Control | Action |
|---------|--------|
| Business switcher | Dropdown; `toggleBizMenu(event)` |
| + Add business | `openAddBizModal(event)` |
| Month/Quarter/Year buttons | `setPeriod(this, 'month|quarter|year')` |
| Theme toggle | `toggleTheme()` |
| Currency picker | `toggleCurrencyMenu()` → dropdown with currency rates |
| Export PDF button | `exportPDF()` — generates AI report via Claude, then prints |
| Export CSV button | `exportAllCSV()` — client-side CSV of all data |
| Ask AI button | `toggleAIPanel()` — slides in right-side panel |
| Notifications bell | `toggleNotifPanel()` — slides in right-side panel |

**AI Panel:**
- Slide-in panel from right edge
- Suggestion chips: "Why did expenses spike?", "Forecast next quarter", "Top 3 cost cuts", "Cash runway?", "Review my portfolio"
- Input: `POST /api/ai` with full financial context
- Powered by Claude (claude-3-5-sonnet)

**Command Palette:**
- Activated by Cmd/Ctrl+K
- Search across pages and actions
- Keyboard navigation (↑↓ + Enter)

**Dashboard Page (`page-dashboard`):**
| Element | Data Source |
|---------|------------|
| Revenue KPI | Paid invoices (period-filtered) |
| Expenses KPI | All expenses (period-filtered) |
| Net Profit KPI | Revenue - Expenses |
| Outstanding KPI | Unpaid invoice total |
| Revenue vs Expenses chart | Chart.js bar chart — real monthly data |
| Expense breakdown bars | Top 4 categories by amount |
| Business transactions list | Recent invoices + expenses |
| Money flow river diagram | SVG Sankey-style visualization |
| Stripe live feed | Shows recent Stripe payment events |

**Budget Page (`page-budget`):**
| Element | Data Source |
|---------|------------|
| Total/Spent/Remaining/Variance KPIs | `GET /api/budget-targets` + real expenses |
| Budget vs actuals table | Per-category: progress bar + variance |
| "Edit targets" button | Opens modal → `PUT /api/budget-targets` |
| AI budget insight | Claude analysis box |

**MRR / SaaS Page (`page-mrr`):**
| Element | Data Source |
|---------|------------|
| MRR/ARR/Churn/Customers KPIs | `GET /api/mrr` |
| MRR breakdown (New/Churned/Expansion/Net) | Same |
| Revenue by customer | Client-side from MRR data |
| MRR trend chart | Chart.js line chart |

**Entities Page (`page-entities`):**
| Element | Action |
|---------|--------|
| + Add entity button | `openAddEntityModal()` |
| Entity cards list | Clickable → `POST /api/entities/:id/activate` |
| Consolidated P&L | Client-side aggregation across entities |
| Currency selector | `setConsolCurrency()` with FX rates |

**Create Business Page (`page-create-business`):**
| Field | Notes |
|-------|-------|
| Business name | Required |
| Industry, Currency, Tax ID, Fiscal year start | Dropdowns |
| Business address | Textarea |
| Website | URL input |
| Your name, Initials | Auto-initials from name |
| Email | Pre-filled from session |

---

## 8. Client-Side JavaScript Wiring

### 8.1 `finflow-api.js` — Auth Gate & Boot

- Renders a full-screen auth gate modal on page load if not authenticated
- `FF_API` global object exposes: register, login, logout, me, getInvoices, getExpenses, getCustomers, getInventory, getPayroll, getGoals, getHoldings
- `ffLoadData()` loads all 7 resource types in parallel on auth success
- Wires: register → `POST /api/auth/register`, login → `POST /api/auth/login`
- `ffLogout()` → `POST /api/auth/logout` + page reload

### 8.2 `finflow-api-wiring.js` — Settings, Goals, Transactions, Holdings, Customers

| Function | Wires to |
|----------|---------|
| `loadSettingsFromDB()` | `GET /api/settings` — applies currency, dark mode, notifications, business profile fields |
| `saveSettings()` | `PUT /api/settings` |
| `saveGoal()` | `POST /api/goals` |
| `deleteGoal(idx)` | `DELETE /api/goals/:id` |
| `saveTransaction()` | `POST /api/personal-transactions` |
| `saveHolding()` | `POST /api/holdings` |
| `loadPersonalFromDB()` | `GET /api/personal-transactions` |
| `saveCustomer()` | `POST /api/customers` (create) or `PUT /api/customers/:id` (edit) |
| `deleteCustomer(idx)` | `DELETE /api/customers/:id` |

### 8.3 `finflow-api-wiring-medium.js` — Invoices, Expenses, Inventory, Payroll

| Function | Wires to |
|----------|---------|
| `loadInvoicesFromDB()` | `GET /api/invoices` |
| `saveInvoice()` | `POST /api/invoices` |
| `markInvoicePaid(idx)` | `PUT /api/invoices/:id` (status=paid) |
| `deleteInvoice(idx)` | `DELETE /api/invoices/:id` |
| `loadExpensesFromDB()` | `GET /api/expenses` |
| `saveExpense()` | `POST /api/expenses` |
| `deleteExpense(idx)` | `DELETE /api/expenses/:id` |
| `loadInventoryFromDB()` | `GET /api/inventory` |
| `saveProduct()` | `POST /api/inventory` |
| `restockItem(id, qty)` | `POST /api/inventory/:id/restock` |
| `deleteInventoryItem(idx)` | `DELETE /api/inventory/:id` |
| `saveOwnerPayroll()` | `POST /api/payroll` or `PUT /api/payroll/:id` |

### 8.4 `finflow-api-wiring-final.js` — Session Restore, Expense Edit, Holdings Edit/Delete

| Function | Wires to |
|----------|---------|
| Boot auto-restore | `GET /api/auth/me` — skip login if valid session |
| `doLogout()` | `POST /api/auth/logout` + reload |
| `saveExpense()` (edit mode) | `PUT /api/expenses/:id` |
| `editExpense(id)` | Populates expense modal for editing |
| `saveHolding()` (edit mode) | `PUT /api/holdings/:id` |
| `deleteHolding(idx)` | `DELETE /api/holdings/:id` |

### 8.5 `finflow-api-wiring-final5.js` — Sales Receipts, Payments Received, Credit Notes, Payments Made, Vendor Credits, AI

Wires full CRUD for:
- Sales Receipts → `/api/sales-receipts`
- Payments Received → `/api/payments-received`
- Credit Notes → `/api/credit-notes`
- Payments Made → `/api/payments-made`
- Vendor Credits → `/api/vendor-credits`

Also wires: AI panel → `POST /api/ai`, receipt scanner → `POST /api/ai/scan`

### 8.6 `finflow-api-wiring-extra.js` — Invoice View, Timesheet, Reports, Budget, Investments, Team

| Function | Wires to |
|----------|---------|
| `viewInvoice(idx)` | Renders invoice view modal (client-side, no API) |
| `loadTimesheet()` | `GET /api/timesheet` |
| `saveTimesheetEntry()` | `POST /api/timesheet` |
| `deleteTimesheetEntry(id)` | `DELETE /api/timesheet/:id` |
| Reports metrics | `GET /api/invoices` + `GET /api/expenses` (client-side calculation) |
| Budget rows | `GET /api/budget-targets` + `GET /api/expenses` |
| Investments data | `GET /api/holdings` |
| Team from payroll | `GET /api/payroll` (filters `is_owner=false`) |

### 8.7 `finflow-api-wiring-pages.js` — Quotes, Recurring, Bills, Vendors

Wires full CRUD (with edit support) for:
- Quotes → `/api/quotes`
- Sales Receipts (duplicate wiring)
- Payments Received (duplicate wiring)
- Recurring Invoices → `/api/recurring-invoices`
- Credit Notes (duplicate wiring)
- Recurring Bills → `/api/recurring-bills`
- Vendor Credits (duplicate wiring)
- Payments Made (duplicate wiring)

### 8.8 `finflow-api-wiring-stubs.js` — Quotes, Bills, Vendors (duplicate)

Another wiring layer for:
- Quotes → `/api/quotes` (duplicate of pages.js)
- Bills → `/api/bills`
- Vendors → `/api/vendors`
- Recurring Bills → `/api/recurring-bills` (duplicate)
- Recurring Invoices → `/api/recurring-invoices` (duplicate)

### 8.9 `finflow-api-wiring-dashboard.js` — Dashboard KPIs & Charts

- `buildMonthlyArrays(invoices, expenses)` — builds 12-month data arrays
- `updateOverviewChart(revArr, expArr, labels)` — updates Chart.js bar chart
- `calcMTD(invoices, expenses)` — current-month totals
- `updateKPIs(invoices, expenses, period)` — sets Revenue, Expenses, Profit, Outstanding cards
- `updateExpenseBars(expenses)` — top 4 expense categories
- `updateTransactions(invoices, expenses)` — recent activity list

### 8.10 `finflow-api-wiring-postgres.js` — Base Neutralizer & Refresh Dispatcher

- Neutralizes `loadPersistedData()` and `persistAll()` (makes them no-ops)
- `addBusiness()` → `POST /api/entities`
- `refreshFinancials()` → fetches invoices + expenses, dispatches to correct render function for current page
- Render dispatch covers 25+ pages including: invoices, expenses, customers, payroll, inventory, items, quotes, vendors, bills, payments-received, payments-made, sales-receipts, recurring-invoices, recurring-bills, credit-notes, vendor-credits, projects, timesheet, investments, personal, manual-journals, chart-of-accounts, reports, budget

---

## 9. Security Issues

### CRITICAL

#### S1 — Unauthenticated Mutation Endpoints
The following routes in `accountant-routes.js` have **no authentication middleware** and can be called by anyone:

| Route | Risk |
|-------|------|
| `POST /api/accountants/link-client` | Anyone can link any user to any accountant |
| `POST /api/accountants/activate-client` | Anyone can activate commission for any accountant-client pair |
| `POST /api/accountants/record-commission` | Anyone can inject earnings records |
| `POST /api/accountants/suspend-client` | Anyone can suspend any client |
| `POST /api/accountants/reactivate-client` | Anyone can reactivate any client |

#### S2 — Admin Routes Without `requireAdmin`
In `accountant-routes.js`:
- `GET /api/admin/accountants/pending` — **no requireAdmin**, returns full pending accountant list
- `POST /api/admin/accountants/:id/verify` — **no requireAdmin**, allows anyone to approve/reject/suspend accountants

The comment in code reads `// TODO: add requireAdmin`. This is a live privilege escalation vulnerability.

#### S3 — `db.all()` Full Table Scan — Data Leakage Risk
`db.all(table, predicate)` executes `SELECT * FROM <table>` with no WHERE clause, then filters in JavaScript. In a race condition or under heavy load, this could return rows belonging to other users before the JS predicate filters them. All routes that use `db.all()`, `db.get()`, `db.update()`, or `db.delete()` are affected. The safe `db.allByUser()` and `db.allByEntity()` should be used instead.

#### S4 — CRON_SECRET Not Validated Cryptographically
`POST /api/accountants/run-monthly-payouts` is protected only by checking `req.headers['x-cron-secret'] === process.env.CRON_SECRET`. If the secret leaks, anyone can trigger monthly payouts. Should use `timingSafeEqual` to prevent timing attacks.

### HIGH

#### S5 — `activeEntity()` Uses Full Table Scan
The `activeEntity()` helper called in many server routes uses `db.all('entities', e => e.user_id === userId && e.is_active)`. This is a full table scan of the entities table on every authenticated API request.

#### S6 — No CSRF Protection
No CSRF tokens are issued or validated. All state-changing POST/PUT/DELETE routes rely solely on the session cookie. Since cookies are `sameSite: 'lax'`, cross-site POST requests from `<form>` elements are blocked, but AJAX-based CSRF via same-site scripts remains a risk.

#### S7 — Duplicate Route Registrations
Routes defined in both `accountant-routes.js` AND `server.js`:
- `GET /api/accountants/directory`
- `GET /api/accountants/my-accountant`
- `POST /api/accountants/request-access`
- `POST /api/accountants/review`
- `POST /api/accountants/report`

The first-registered handler wins in Express. The `accountant-routes.js` file is imported before the duplicates in `server.js`, meaning the `accountant-routes.js` versions take effect. This is confusing and a maintenance hazard.

#### S8 — Accountant Registration: `.catch(() => setStep(4))`
In `accountant-register.html` line ~987: if `POST /api/accountants/register` throws any error, the catch block silently shows the success screen (Step 4). Users see "Application received!" even when registration failed — they will never know and cannot retry correctly.

#### S9 — Membership Verification is Simulated
`POST /api/accountants/verify-membership` is a client-side simulation using `setTimeout`. There is NO real membership API call. Any accountant can "verify" their membership status by entering any text. The backend registration also performs only simulated verification.

#### S10 — No Rate Limiting on Accountant Auth
`authLimiter` (30/15min) is applied to user auth routes but it is not confirmed to be applied to `POST /api/accountants/login`. Brute-force attacks on accountant credentials are possible.

### MEDIUM

#### S11 — Password Reset Token Not Rate-Limited
`POST /api/auth/forgot-password` can be called repeatedly. No rate limiting on this specific endpoint means email-bombing a user is possible.

#### S12 — AI Endpoint Sends Full Financial Context
`POST /api/ai` builds a context string from invoices, expenses, payroll, goals, and entity info, then sends it to Anthropic. The prompt includes actual financial figures. Ensure data is scoped strictly to `req.session.userId` (it appears to be, but should be explicitly audited).

#### S13 — Admin Password Stored as Plain Env Var
`POST /api/admin/login` compares `req.body.password === process.env.ADMIN_PASSWORD`. No bcrypt, no rate limiting on admin login. Brute-force and timing attacks are possible.

---

## 10. Performance Issues

### P1 — db.all() Called on Every Request
The following server.js patterns cause full table scans:
```
db.all('entities', ...)    // in activeEntity() — called by nearly every route
db.all('invoices', ...)    // some list routes
db.get('users', ...)       // in auth middleware
```
On large databases this will cause severe slowdown. All `db.all()`, `db.get()`, `db.update()`, `db.delete()` calls should be replaced with parameterized indexed queries.

### P2 — Recurring Scheduler Has No Distributed Lock
The scheduler runs `setInterval(every 1 hour)` on startup. On multi-process/cluster deployments (PM2 cluster mode, Heroku dynos), every process runs the scheduler independently, creating duplicate recurring invoices and bills.

### P3 — AI Context Sent on Every Chat Message
`POST /api/ai` rebuilds the full financial context (all invoices, expenses, payroll) on every message. While there is response caching (`ai_cache`), the upstream DB queries run on every request that isn't cache-hit.

### P4 — Books Endpoint Fetches Everything
`GET /api/accountants/clients/:userId/books` fetches invoices, expenses, entities, settings, payroll, journals, customers, and bills for a client in parallel — no pagination, no date filtering server-side. Large accounts will cause slow responses and large payloads.

### P5 — No Database Indexes Beyond user_id/entity_id
There are no indexes on frequently-queried JSONB fields like `data->>'status'`, `data->>'due_date'`, or `data->>'expense_date'`. Filtering by invoice status or date range requires scanning all rows for a user.

---

## 11. Broken / Dead UI Elements

| Page | Element | Issue |
|------|---------|-------|
| `landing.html` | "Contact sales" button | No onclick, no href — completely non-functional |
| `landing.html` | "Book a demo" button | No onclick, no href — completely non-functional |
| `landing.html` | All footer links | All `href="#"` — 20+ dead links including Privacy Policy, Terms, Blog, About |
| `landing.html` | Pricing section | Clicking Pro/Business plan buttons does not open Stripe Checkout |
| `landing.html` | AI chat demo | Hardcoded animation — does not call real AI API |
| `landing.html` | "Trusted by" logos | Fictional company names |
| `landing.html` | Testimonials | Fake profiles |
| `accountant-register.html` | Membership verification | Client-side setTimeout simulation — never calls real API |
| `accountant-register.html` | Step 4 success screen shown on API error | `.catch(() => setStep(4))` — false success |
| `accountant-dashboard.html` | Filing Deadlines | In-memory only — lost on refresh; no save endpoint |
| `index.html` | "Stripe live feed" section | Described as "real time" but source of live data is unclear |
| `index.html` | Notification bell badge shows "5" | Hardcoded badge count — not from real API |

---

## 12. Logic & Consistency Issues

### L1 — `flagTxn()` Inserts into `accountant_reports` (Semantic Mismatch)
In `accountant-client.html`, `flagTxn()` inserts a record into the `accountant_reports` table. The same table is used for admin reports (reporting problematic accountants). This creates semantic confusion in the admin dashboard where both types appear mixed together.

### L2 — Multiple Wiring Files Wire the Same Endpoints
The following endpoints are wired in multiple JS files:
- `saveReceipt()` / `deleteReceipt()` — in both `finflow-api-wiring-final5.js` AND `finflow-api-wiring-pages.js`
- `savePaymentReceived()` / `deletePaymentReceived()` — in both `finflow-api-wiring-final5.js` AND `finflow-api-wiring-pages.js`
- Quotes — in both `finflow-api-wiring-pages.js` AND `finflow-api-wiring-stubs.js`
- Recurring bills/invoices — in both `finflow-api-wiring-pages.js` AND `finflow-api-wiring-stubs.js`

Last-defined `window.functionName` wins. This is a maintenance hazard and causes unpredictable behavior.

### L3 — Personal Salary (`/api/personal-salary`) Cross-Entity
`GET /api/personal-salary` returns owner payroll records across ALL entities for the user. This is intentional (to populate "Monthly Income" in personal finance), but it uses `db.all('payroll', ...)` — a full table scan. Any payroll entry with `is_owner=true` for any entity belonging to the user is returned. Deduplication logic exists but is fragile (deduped by `fname+lname+gross`).

### L4 — MRR Stored in `user_settings`
MRR data (Monthly Recurring Revenue, churn, expansion) is stored as a single JSONB blob in `user_settings` with `key='mrr_data'`. This means MRR history cannot be queried, filtered, or audited independently.

### L5 — Banking Transactions Stored in `personal_transactions`
Banking records are stored in the `personal_transactions` table with `source='banking'`. The `GET /api/banking` route filters `WHERE source = 'banking'` in JavaScript after fetching all user personal transactions. There is no PostgreSQL WHERE clause for this filter (it's JS-side only).

### L6 — Budget Targets Stored in `user_settings`
Budget targets are stored as `key='budget_targets'` JSONB blob in `user_settings`. Cannot be queried by category or time period without deserializing the entire blob.

### L7 — Permissions Stored in `user_settings`
RBAC permissions for team members are stored as `key='permissions'` blob in `user_settings`. There is no row-level verification that the permission structure matches the team members in `team_members` table.

### L8 — No Validation of Entity Ownership Before Activation
`POST /api/entities/:id/activate` should verify that entity `id` belongs to `req.session.userId`. If this check is missing, a user could activate another user's entity.

### L9 — Recurring Scheduler Has No Error Recovery
The recurring scheduler runs in a `try/catch` and logs errors, but does not retry failed generations. If a single record fails (e.g., DB timeout), it silently skips without alerting.

### L10 — `next_date` Advancement for Recurring Records
The frequency advancement logic (weekly/monthly/quarterly/annual) for recurring invoices and bills uses simple date arithmetic. Monthly advancement from January 31 would produce February 31 (invalid), which `new Date()` in JavaScript would roll to March 2 or 3 — creating incorrect billing dates.

---

## 13. API Route Summary Table

| Method | Path | Auth | Module |
|--------|------|------|--------|
| POST | `/api/auth/register` | None | server.js |
| POST | `/api/auth/login` | None | server.js |
| POST | `/api/auth/logout` | requireAuth | server.js |
| GET | `/api/auth/me` | requireAuth | server.js |
| GET | `/api/me` | requireAuth | server.js |
| POST | `/api/auth/forgot-password` | None | server.js |
| POST | `/api/auth/reset-password` | None | server.js |
| PUT | `/api/auth/change-password` | requireAuth | server.js |
| DELETE | `/api/auth/account` | requireAuth | server.js |
| GET/POST | `/api/entities` | requireAuth | server.js |
| PUT/DELETE | `/api/entities/:id` | requireAuth | server.js |
| POST | `/api/entities/:id/activate` | requireAuth | server.js |
| GET/POST | `/api/invoices` | requireAuth | server.js |
| PUT/DELETE | `/api/invoices/:id` | requireAuth | server.js |
| GET/POST | `/api/expenses` | requireAuth | server.js |
| PUT/DELETE | `/api/expenses/:id` | requireAuth | server.js |
| GET/POST | `/api/customers` | requireAuth | server.js |
| PUT/DELETE | `/api/customers/:id` | requireAuth | server.js |
| GET/POST | `/api/inventory` | requireAuth | server.js |
| PUT/DELETE | `/api/inventory/:id` | requireAuth | server.js |
| POST | `/api/inventory/:id/restock` | requireAuth | server.js |
| GET/POST | `/api/payroll` | requireAuth | server.js |
| PUT/DELETE | `/api/payroll/:id` | requireAuth | server.js |
| GET | `/api/personal-salary` | requireAuth | server.js |
| GET/POST | `/api/personal-transactions` | requireAuth | server.js |
| PUT/DELETE | `/api/personal-transactions/:id` | requireAuth | server.js |
| GET/POST | `/api/goals` | requireAuth | server.js |
| PUT/DELETE | `/api/goals/:id` | requireAuth | server.js |
| GET/POST | `/api/holdings` | requireAuth | server.js |
| PUT/DELETE | `/api/holdings/:id` | requireAuth | server.js |
| GET/POST | `/api/items` | requireAuth | server.js |
| PUT/DELETE | `/api/items/:id` | requireAuth | server.js |
| GET/POST | `/api/quotes` | requireAuth | server.js |
| PUT/DELETE | `/api/quotes/:id` | requireAuth | server.js |
| GET/POST | `/api/bills` | requireAuth | server.js |
| PUT/DELETE | `/api/bills/:id` | requireAuth | server.js |
| GET/POST | `/api/vendors` | requireAuth | server.js |
| PUT/DELETE | `/api/vendors/:id` | requireAuth | server.js |
| GET/POST | `/api/recurring-bills` | requireAuth | server.js |
| PUT/DELETE | `/api/recurring-bills/:id` | requireAuth | server.js |
| GET/POST | `/api/recurring-invoices` | requireAuth | server.js |
| PUT/DELETE | `/api/recurring-invoices/:id` | requireAuth | server.js |
| GET/POST | `/api/sales-receipts` | requireAuth | server.js |
| PUT/DELETE | `/api/sales-receipts/:id` | requireAuth | server.js |
| GET/POST | `/api/payments-received` | requireAuth | server.js |
| PUT/DELETE | `/api/payments-received/:id` | requireAuth | server.js |
| GET/POST | `/api/credit-notes` | requireAuth | server.js |
| PUT/DELETE | `/api/credit-notes/:id` | requireAuth | server.js |
| GET/POST | `/api/payments-made` | requireAuth | server.js |
| PUT/DELETE | `/api/payments-made/:id` | requireAuth | server.js |
| GET/POST | `/api/vendor-credits` | requireAuth | server.js |
| PUT/DELETE | `/api/vendor-credits/:id` | requireAuth | server.js |
| GET/POST | `/api/timesheet` | requireAuth | server.js |
| PUT/DELETE | `/api/timesheet/:id` | requireAuth | server.js |
| GET/POST | `/api/projects` | requireAuth | server.js |
| PUT/DELETE | `/api/projects/:id` | requireAuth | server.js |
| GET/POST | `/api/team` | requireAuth | server.js |
| PUT/DELETE | `/api/team/:id` | requireAuth | server.js |
| GET/POST | `/api/journals` | requireAuth | server.js |
| DELETE | `/api/journals/:id` | requireAuth | server.js |
| GET/POST | `/api/chart-of-accounts` | requireAuth | server.js |
| PUT/DELETE | `/api/chart-of-accounts/:id` | requireAuth | server.js |
| GET/POST | `/api/documents` | requireAuth | server.js |
| GET | `/api/documents/:id/download` | requireAuth | server.js |
| DELETE | `/api/documents/:id` | requireAuth | server.js |
| GET/POST | `/api/templates` | requireAuth | server.js |
| PUT/DELETE | `/api/templates/:id` | requireAuth | server.js |
| GET/POST | `/api/autocat-rules` | requireAuth | server.js |
| PUT/DELETE | `/api/autocat-rules/:id` | requireAuth | server.js |
| POST | `/api/autocat-rules/run` | requireAuth | server.js |
| GET | `/api/banking` | requireAuth | server.js |
| POST | `/api/banking` | requireAuth | server.js |
| DELETE | `/api/banking/:id` | requireAuth | server.js |
| GET/PUT | `/api/settings` | requireAuth | server.js |
| GET/PUT | `/api/mrr` | requireAuth | server.js |
| GET/PUT | `/api/budget-targets` | requireAuth | server.js |
| GET/POST | `/api/lock-settings` | requireAuth | server.js |
| GET | `/api/audit-log` | requireAuth | server.js |
| GET/POST | `/api/permissions` | requireAuth | server.js |
| POST | `/api/ai` | requireAuth | server.js |
| GET | `/api/ai/cache` | requireAuth | server.js |
| POST | `/api/ai/scan` | requireAuth | server.js |
| POST | `/api/stripe/webhook` | Stripe sig | server.js |
| POST | `/api/admin/login` | None | admin-routes.js |
| POST | `/api/admin/logout` | requireAdmin | admin-routes.js |
| GET | `/api/admin/me` | requireAdmin | admin-routes.js |
| GET | `/api/admin/overview` | requireAdmin | admin-routes.js |
| GET | `/api/admin/accountants` | requireAdmin | admin-routes.js |
| POST | `/api/admin/accountants/:id/verify` | requireAdmin | admin-routes.js |
| POST | `/api/admin/accountants/:id/preferred-partner` | requireAdmin | admin-routes.js |
| GET | `/api/admin/users` | requireAdmin | admin-routes.js |
| POST | `/api/admin/users/:id/suspend` | requireAdmin | admin-routes.js |
| GET | `/api/admin/reports` | requireAdmin | admin-routes.js |
| POST | `/api/admin/reports/:id/dismiss` | requireAdmin | admin-routes.js |
| GET | `/api/admin/earnings` | requireAdmin | admin-routes.js |
| POST | `/api/admin/earnings/mark-paid` | requireAdmin | admin-routes.js |
| GET | `/api/admin/costs` | requireAdmin | admin-routes.js |
| GET | `/api/admin/log` | requireAdmin | admin-routes.js |
| POST | `/api/accountants/register` | None | accountant-routes.js |
| POST | `/api/accountants/extract-resume` | None | accountant-routes.js |
| POST | `/api/accountants/verify-membership` | None | accountant-routes.js |
| POST | `/api/accountants/login` | None | accountant-routes.js |
| POST | `/api/accountants/logout` | None | accountant-routes.js |
| GET | `/api/accountants/me` | requireAccountant | accountant-routes.js |
| GET | `/api/accountants/clients` | requireAccountant | accountant-routes.js |
| GET | `/api/accountants/clients/:userId/books` | requireAccountant | accountant-routes.js |
| POST | `/api/accountants/clients/:userId/journal` | requireAccountant | accountant-routes.js |
| POST | `/api/accountants/clients/:userId/lock` | requireAccountant | accountant-routes.js |
| GET | `/api/accountants/clients/:userId/notes` | requireAccountant | accountant-routes.js |
| POST | `/api/accountants/clients/:userId/notes` | requireAccountant | accountant-routes.js |
| POST | `/api/accountants/clients/:userId/flag` | requireAccountant | accountant-routes.js |
| POST | `/api/accountants/invite` | requireAccountant | accountant-routes.js |
| POST | `/api/accountants/link-client` | **NONE** | accountant-routes.js |
| POST | `/api/accountants/activate-client` | **NONE** | accountant-routes.js |
| GET | `/api/accountants/earnings` | requireAccountant | accountant-routes.js |
| POST | `/api/accountants/record-commission` | **NONE** | accountant-routes.js |
| POST | `/api/accountants/run-monthly-payouts` | CRON_SECRET | accountant-routes.js |
| POST | `/api/accountants/suspend-client` | **NONE** | accountant-routes.js |
| POST | `/api/accountants/reactivate-client` | **NONE** | accountant-routes.js |
| GET | `/api/admin/accountants/pending` | **NONE** | accountant-routes.js |
| POST | `/api/admin/accountants/:id/verify` | **NONE** | accountant-routes.js |
| GET | `/api/accountants/directory` | None (public) | accountant-routes.js + server.js |
| GET | `/api/accountants/my-accountant` | session.userId | accountant-routes.js + server.js |
| POST | `/api/accountants/request-access` | session.userId | accountant-routes.js + server.js |
| POST | `/api/accountants/review` | session.userId | accountant-routes.js + server.js |
| POST | `/api/accountants/report` | session.userId | accountant-routes.js + server.js |
| GET | `/api/accountants/:id/reviews` | None (public) | accountant-routes.js |

---

*End of audit. Total routes documented: ~115. Total pages: 9 HTML files. Total wiring JS files: 10.*
