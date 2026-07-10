# FinFlow — Master Audit (merged)

**Date:** 9 July 2026
**Sources merged:** the code-agent audit (`AUDIT_CODE.md`, 20 findings, runtime-verified) + the chat audit (`CODE_AUDIT_2026-07-09.md`), deduplicated into one list. Where the two overlapped, the runtime-verified version is kept. Three chat-only items are added (M-A/M-B/M-C). One chat finding was **withdrawn**: the "stale bundle" Critical — the code agent re-minified both sources with the repo's own `terser@5.48.0` and got the committed `.min.js` byte-for-byte, so the bundles are in sync. (The residual risk lives on as F13: nothing *enforces* that sync.)

**Verified by running code** (not guessed): bundle byte-match, Express error-handler ordering, partial-PUT JSONB corruption, `/register?ref=` fallthrough, and the auth-boundary 401s.

---

## Master findings

| # | Sev | Finding | file:line | Fix | Source |
|---|-----|---------|-----------|-----|--------|
| F1 | ✅ **FIXED** (was 🔴 Critical) | Any verified accountant can read **any** user's books — `link-client` writes `accountant_id` onto an arbitrary user with no consent; `/books` trusts it via a `UNION` branch with no status check | `accountant-routes.js:638,441` | **Done:** deleted `link-client` (sole JSONB writer, UI-unreachable) + orphaned `referralMonthsForTier`; replaced all 8 JSONB `(data->>'accountant_id')::int=$1` access branches + 4 status-less gates (notes/flag/checklist) with `accountant_clients.status='active'`; removed admin `jsonbClients` listing branch. Live-DB test: breach closed, legit active path preserved. **Deferred hygiene:** stale `users.data.accountant_id` values are now inert (no reader) — optional one-time `UPDATE users SET data = data - 'accountant_id'`. | both (agent escalated) |
| F2 | ✅ **FIXED** (was 🔴 Critical) | Partial `PUT` nulls `amount` and deletes fields on recurring bills/invoices (whole-object patch with `undefined` keys); reproduced corrupt JSONB | `server.js:1859,1931`; `database.js:674` | **Done:** recurring bills/invoices PUT rebuilt with conditional patches (`if (x!=null) patch.x=…`), mirroring the invoices/expenses PUT idiom. **Also fixed the same corruption class in `payments_made` PUT (server.js:2096)** — its `|| default` coalescing reset missing fields (amount→0, date→today, vendor/method/notes/ref→''). Both reproduced (partial PUT wiped/clobbered siblings) and verified fixed via live-DB test. Swept all 50 `updateById`/`update` sites: holdings PUT and all other money PUTs already used conditional patches (safe). | agent |
| F3 | 🟠 High | `unrealised_gain_loss` displayed/summed but **never computed** (only `realised` is written) | `server.js:2754,3529`; `index.html:4564`; `database.js:343` | Compute `(current_rate − rate_at_txn) × foreign_amount`, or hide for open positions | both |
| F4 | ✅ **FIXED** (was 🟠 High) | Global error handler sits **before ~42 routes** → those return HTML/stack instead of JSON (stack leak in non-prod) | `server.js:2521` (routes 2617–3560) | **Done:** relocated the global error handler to the very bottom (after all routes + the `/api` 404 + the `*` SPA fallback), a pure move with handler logic unchanged. The `/api` 404 + `*` fallbacks were already at the bottom — only the handler was mis-placed. Verified on the real app: handler is the last router layer (after `/api` 404 → `*`); live tests confirm affected-route errors → JSON 500, `/api` 404 → JSON, SPA/landing still serve. | agent |
| F5 | 🟠 High | RBAC account-resolver is inert — `team_members.member_user_id` is written **nowhere**, so `req.accountId` always == own id; team/accountant data-sharing is dead | `server.js:480,489,572` | Populate `member_user_id`/`status` on team-member create, or remove the spine | both (agent proved mechanism) |
| F6 | 🟠 High | Weighted-average COGS mis-costs fractional units (`Math.max(units,1)`) and returns 0 cost for un-purchased sales → gross profit overstated; also coexists with FIFO elsewhere | `server.js:2743,3438` (FIFO at `3359`) | `units>0 ? total/units : 0` + "no cost basis" flag; pick one costing method everywhere | both |
| F7 | 🟠 High | Same dashboard KPI (`d-exp`/`d-profit`) written by 2+ disagreeing formulas — one includes payroll, one doesn't; a third basis exists server-side | `app-main.js:1828` vs `finflow-api-wiring-dashboard.js:190`; `server.js:2724` | One shared revenue/expense function; one KPI writer | both |
| F8 | 🟠 High | Stale/incorrect payroll bracket constants (e.g. CA federal top base `31016`→`31057.56`; ON bases off); all 2024, undated, drift yearly | `server.js:3134,3153` | Correct CA constants; dated per-year table + bracket-edge unit tests | both (agent pinned numbers) |
| F9 | 🟠 High | Accountant `/books` reads `WHERE user_id=$1` with **no entity scoping** — totals won't reconcile with the client's entity-scoped dashboard | `accountant-routes.js:453` | Accept/require `entity_id`; scope every query | both |
| F10 | 🟠 High | Accountant invite funnel is dead — no `/register` route, so `/register?ref=` serves `landing.html` (ignores `ref`); signup never forwards the code | `accountant-routes.js:602`; `server.js:3569` | Add `/register` route serving the SPA; capture and forward `?ref=` to `/api/auth/register` | agent |
| F11 | 🟠 High | Referral payout cron filters on `subscriptionStatus` which is **never written**, so it pays nobody; webhook never calls activate/suspend | `accountant-routes.js:805`; `server.js:100` | Write `subscriptionStatus` from Stripe webhook; wire webhook → activate/suspend routes | agent (corrects chat's "double-pay") |
| F12 | 🟡 Medium | Admin panel surfaces never-written fields (`subscriptionStatus`, `trialEnds` — code writes `trial_ends`) as if real | `admin-routes.js:223,411` | Populate them or read `trial_ends`/`plan` | agent |
| F13 | 🟡 Medium | No build step; `.min` sync is manual (today in sync, but unenforced); `nixpacks.toml --production` omits terser so bundles can't rebuild on deploy | `package.json:6`; `nixpacks.toml:2` | Add `"build": "node bundle.js && terser …"`, run in CI; serve source or build on deploy | both (agent corrected severity) |
| F14 | 🟡 Medium | `/reports/profit-loss`, `/balance-sheet`, `/cash-flow` ignore entity scope; `cash-flow` also queries non-existent `receipts`/`payments` tables (error swallowed → legs always empty) | `server.js:2779,2808,2826,2829` | Add `matchEnt`; fix table names to `sales_receipts`/`payments_made` | both |
| F15 | 🟡 Medium | Month-keyed report rows sort **lexically** (`"Apr '25, Dec '25, Feb '25…"`), mixing order and years | `server.js:2798,2847` | Key by `YYYY-MM`; format label at render | agent |
| F16 | 🟡 Medium | Accountant credential "verification" is an always-pass mock (any ≥6-char number); session set before approval | `accountant-routes.js:124,262` | Real registry lookups, or label "unverified / self-declared" | both |
| F17 | 🟡 Medium | Earnings ledger records **100%** of a client bill as accountant earnings (Stripe already paid out 96%); `commission_cents` summary always 0 (`service_commission` never created) | `accountant-routes.js:1434,747`; `admin-routes.js:311` | Record net (post-fee); one consistent `type` | both |
| F18 | 🟡 Medium | Main AI chat `/api/ai` has **no per-plan usage cap** (the `ai_usage` cap is only on the auto-categorize route) — uncapped cost | `server.js:2250` (cap at `1656,1716`) | Check/increment `ai_usage` before calling Anthropic | agent |
| **F21** | 🟡 Medium | **Admin broadcast sends nothing** — counts the audience, logs to `admin_log`, returns `sent: N` as if delivered | `admin-routes.js:492` | Integrate Resend send, or relabel as "logged only" | **chat add** |
| **F22** | 🟡 Medium | **CSRF unverified** — `sameSite:'none'` in prod + `express.urlencoded` enabled, no CSRF tokens on state-changing routes; JSON routes partly shielded by CORS preflight, form-encoded may not be | `server.js:194,211` | Add CSRF tokens or require a custom header on all mutations; **verify against a live instance** | **chat add (open)** |
| F19 | 🟢 Low | DB pool `ssl.rejectUnauthorized:false` in prod (MITM risk); fabricated `${fname}.${lname}@company.com` team emails shown as real | `database.js:20`; `server.js:2199` | Use provider CA + `rejectUnauthorized:true`; show blank email | both |
| F20 | 🟢 Low | 6 dead `db.*` helpers (`get/all/update/delete/upsert/getByUser`, 0 callers) carrying full-table-scan pattern; `42P01→_ensureTable→[]` swallows typos (hides F14) | `database.js:562-726` | Delete unused helpers; log loudly on `42P01` for known tables | agent |
| **F23** | 🟢 Low | **`banking` rows use `type`/`date`** while the rest of `personal_transactions` uses `tx_type`/`tx_date` — same table, two schemas; date/type filters skip banking rows | `server.js:2623` | Standardize on `tx_date`/`tx_type` | **chat add** |

**Withdrawn:** chat "C1 — stale served bundle (Critical)." Bundles verified in sync by byte-exact re-minify. Residual risk retained as F13.

---

## Confirmed non-issues (checked, not defects)
SQL injection (allow-listed table/field names, parameterized values, `ILIKE … ESCAPE`); Stripe webhook signature (`constructEvent` + secret); admin auth (`timingSafeEqual` + 5/15min limit); password reset (32-byte token, 1h expiry, single-use); bundle sync (byte-exact); landing-page `$469K` hero (marketing mockup).

---

## Recommended fix order

1. ~~**F1** — active cross-tenant data breach. Ship first.~~ ✅ **FIXED.**
2. ~~**F2** — silent data corruption on every partial edit.~~ ✅ **FIXED** (+ payments_made, same class).
3. ~~**F4** — cheap; unblocks correct JSON errors for 42 endpoints (do before/with F14/F15).~~ ✅ **FIXED.**
4. **F3, F6, F8** — money is wrong on screen (FX P/L, COGS/gross profit, payroll tax). Add tests.
5. **F7, F9, F14, F15** — reconcile revenue/expense/report into one entity-scoped source.
6. **F10, F11, F5, F16, F17, F12, F21** — repair or remove the accountant/RBAC/broadcast funnel end-to-end (interdependent; decide whether the marketplace ships at all before fixing piecemeal).
7. **F13, F18, F22, F19, F20, F23** — hardening: build pipeline, AI cap, CSRF (verify live), DB TLS, dead-code/error hygiene, banking field names.

---

*Two independent audits reconciled. F1–F20 from the runtime-verified code audit; F21/F22/F23 added from the chat audit; the chat "stale bundle" Critical withdrawn as a false positive. F22 (CSRF) is the one item neither pass settled — verify it against a running instance.*
