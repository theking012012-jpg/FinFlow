# FinFlow — Session Handover (20 Jul 2026)

Paste this as the opening briefing for the next session. Continues the F38/F35/F36/Store-A cluster.

---

## TL;DR — what shipped this session

Three commits are **pushed and live** on `origin/main` (auto-deploys via Railway). Current tip = **`9937966`**.

```
9937966  feat(payments): F35 Step 5 — collapse Record Payment to Store B; bill mark-paid writes linked payments_made
57371f3  fix(dashboard): reconcile client expense engines onto window.paymentsMade — dead _paymentsMade global (F32-class)
63a047d  feat(payables): F38 Step 4 — issued-bill expense leg at 5 accrual sites (both engines) + AP amendment
2ebd06c  docs: session handover (previous)
```

- **F38 Step 4** — DONE, **live-verified** on production.
- **Dead-global fix** — DONE, live baseline safe (no-op on current data).
- **F35 Step 5** — code DONE + **offline-verified**, but **NOT live-verified yet** (Chrome extension dropped mid-session). ⬅ **the #1 thing to do next.**

**Uncommitted in working tree:** a `docs(audit)` edit to `AUDIT_MASTER.md` (F38 row → Step 4 done). Blocked only by the OneDrive git-lock nuisance (below), not by content.

---

## Role & conventions (unchanged)

Solo-founder SaaS accounting platform. User = planning/review layer; the coding agent writes code. **This site is for the world to use** — every fix must generalize to all users (existing + new), never hardcode to this account. Verified: all shipped changes are parameterized on `userId`/`entityId`; no account-specific hardcoding.

- `AUDIT_MASTER.md` = source of truth (findings F1–F47 + PRE_LAUNCH backlog).
- Live: `finflow-production-dab1.up.railway.app` — Railway auto-deploys from `main`.
- **Discipline:** read-only investigate → propose → diff → pg-mem/jsdom verify → hold for approval → commit. **Never commit/push without explicit say-so.** Root fixes only.
- **Two-engine hazard:** edit wiring sources, never `finflow-bundle.js` (F13 pre-commit hook regenerates it). Any edit to `dashboard.js`/`pages.js`/`stubs.js`/`medium.js`/`final5.js` requires `node bundle.js && node bundle.js --check` == 0.
- **Commit convention:** alternate `fix(...)`/`feat(...)` and `docs(audit)` — never mix code and doc changes in one commit.

### Methodology rules (each earned by a real failure)
1. **Views agreeing ≠ correct.** Sanity-check the formula itself.
2. **Verify the whole parameter surface** (every period), never one point. (What hid F33.)
3. **Demand exhaustive enumeration** before any "this is canonical now" claim.
4. **Never auto-merge/auto-route money rows.** Ambiguous → NEEDS DECISION bucket for the human. *(Directly relevant to the $1,000 row — see below.)*
5. **A `$0` from a failure is indistinguishable from a real `$0`.**

---

## Baseline gate (must hold after any no-op change)

Live dataset (tiny, hand-checkable): 3 invoices ($10k/$5k/$4k, all `paid`, issued Jul 2026), 1 expense (Office Rent $1,000, Jul 2), 1 sales receipt ($40, Jul 16), payroll $7,000/mo, **0 bills, 0 payments_made**, 1 Store-A `payments_received` row ($1,000, empty `invoice_ref`, Jul 16 — parked, see below).

- Revenue **exactly $19,040**.
- Jun/Jul/Aug/Q3/Year rev·exp·net = `0·7000·−7000` / `19040·8000·11040` / `0·0·0` / `19040·8000·11040` / `19040·50000·−30960`.
- **AP $0, AR $0.** dashboard == `/api/reports` at every period.
- ⚠️ `/api/reports` verification gotcha: pass **per-window** `elapsedMonths` (1/1/0/1/7 for Jun/Jul/Aug/Q3/Year), NOT the fiscal month index.

---

## What shipped — detail

### 1. F38 Step 4 — issued-bill expense leg (commit `63a047d`) ✅ LIVE-VERIFIED

The expense-side mirror of F32's revenue accrual. An **issued bill is an expense when issued** (Dr Expense / Cr AP) at full amount, keyed on `issue_date`; a bill-linked `payments_made` is a **settlement** (Dr AP / Cr Cash), never a fresh expense; only **orphan** payments (`bill_id IS NULL`) stay expense.

Uniform transform applied at all five accrual sites, both engines:

| Site | File | Change |
|---|---|---|
| `computeBooks` opex | `server.js` (~3827, ~3880) | fetch `bills`; opex = expenses + **issuedBills** (RECOGNIZED_BILL, full, by issue_date, in window) + **orphan** payments (`bill_id==null`) + payroll; added `parts.issuedBills` |
| profit-loss monthly rows | `server.js` (~3254, ~3266) | fetch `bills`; bump expense by issue month; orphan-filter payments |
| balance-sheet **AP amendment** | `server.js` (~3305) | `RECOGNIZED_BILL.has(s) && s!=='paid'` → `RECOGNIZED_BILL.has(s)`, reducer `Σ max(0, amount − amount_paid)` (arithmetic-driven, not status-driven; floor stops overpay going negative) |
| `computeExpenseBreakdown` | `app-main.js` (~1600) | bill leg via `window.bills` + orphan filter; added `issuedBills` to return |
| `buildMonthlyArrays` | `dashboard.js` (~89) | bill leg by issue month + orphan filter |
| `updateKPIs` | `dashboard.js` (~166) | bill leg + orphan filter |

`RECOGNIZED_BILL = {unpaid, due_soon, overdue, partial, paid}`. Cash-basis routes (`/api/cashflow`, `/api/reports/cash-flow`) intentionally **unchanged** (decision #2). `/api/reports`, `/books`, profit-loss totals, balance-sheet AR all derive from `computeBooks` — so those 5 sites + the AP reducer are the complete accrual surface (no 6th).

**Verified:** harness 42/42 (server, pg-mem) + 23/23 (client, jsdom-extract). **Live on production:** baseline no-op at all 5 periods (dashboard == /api/reports); scratch $500 issued bill → expense **+$500 immediately before any payment** (Jul 8500 / Year 50500, AP 500); $200 linked payment → expense unchanged, `recalcBillStatus` wrote amount_paid 200/partial, AP 300; both scratch rows deleted → **baseline exactly restored**.

### 2. Dead-global fix (commit `57371f3`) ✅ baseline safe

`window._paymentsMade` was read at 3 client sites but **assigned nowhere** — the loader sets `window.paymentsMade` (no underscore, `final5.js:273` / `pages.js:716`). Classic F32-class name mismatch: the client's orphan-payment leg was reading a permanently-empty array. Changed the 3 readers (`app-main.js:1610`, `dashboard.js:101`, `dashboard.js:168`) to `window.paymentsMade`. No-op on current data (0 payments); makes the orphan leg live-correct so dashboard == /api/reports holds once a real orphan payment exists. **Verified:** client harness 4/4 with production-mimicking globals (`paymentsMade` set, `_paymentsMade` undefined).

### 3. F35 Step 5 (commit `9937966`) ⚠️ CODE DONE, OFFLINE-VERIFIED, **NOT LIVE-VERIFIED**

**(a) Modal collapse.** Three colliding `openRecordPaymentModal` defs → one. The Store-A openers (`final5.js:134`, `pages.js:256`) were **renamed** to `openPaymentReceivedModal`; the inline Store-B opener (`index.html:4160`, `openRecordPaymentModal(invoiceId,client,amount)` → `/api/invoice-payments`, flips status, partials) is now the sole one. The Payments-Received page button (`index.html:2793`) repointed to `openPaymentReceivedModal`; the shim (`index.html:6295`) fallback no longer references `openRecordPaymentModal`. Net: invoice "Record Payment" now routes to **Store B** instead of opening a blank Store-A form.

**(b) Bill "mark paid"** (`pages.js:683`, `markBillPaid`). Now POSTs a **real linked `payments_made`** (bill_id set) for the outstanding balance instead of a bare `PUT status:'paid'`, so `recalcBillStatus` flips the status and the cash-basis cash-flow route sees the outflow; AP drops to 0 arithmetically (no double-count — the bill was already an expense at issue).

**Verified OFFLINE only:** modal resolution 3/3 (invoice → `record-payment-modal` with invoice id; Payments-Received → `modal-payment-received`); `markBillPaid` end-state 4/4 (fully-settled bill stays expense at full amount, AP→0, no double count); grep-clean (no Store-A `openRecordPaymentModal` remains); bundle in sync; `node --check` clean.

**🔴 NOT live-verified.** Store B (`/api/invoice-payments`) is being exercised for the **first time ever** (was UI-unreachable). Live check needed:
1. Hard-refresh app. **Invoices → Record Payment** on an unpaid invoice → an **Amount box for that invoice** must open (NOT a blank "Payment Received / Customer" form). *That single check = the core fix.*
2. Enter partial amount → status pending→**partial**, outstanding drops. Pay rest → **paid**. AR draws down.
3. **Bills → Mark paid** → records a linked payment, bill shows paid, AP reflects it.
4. Delete test rows → baseline restored (Revenue $19,040, AP $0).

---

## ⛔ Decision made this session: the $1,000 Store-A row — PARKED (do NOT delete/route)

`payments_received` id 1, $1,000, empty `invoice_ref`, Jul 16. Inert today (Store A excluded from revenue). **Do NOT route it to `sales_receipts`** — that makes it revenue ($19,040 → $20,040) and re-breaks F32. Do **not** hand-delete it either. Per the "for the world" reframe + methodology rule 4, it is the canonical example of a general problem: **a payment received that matches no invoice.** The correct fix is a product feature, not a cleanup — see backlog.

---

## Open backlog (priority order)

1. **🔴 Live-verify F35 Step 5** (above) — first-ever use of `/api/invoice-payments`. Do this before anything else.
2. **"Unmatched payments" classification feature** (NEW, from this session). Surface any `payments_received`/payment with no invoice match; let the user classify each: *apply to an invoice* (settlement) / *cash sale* (→ sales_receipts, revenue) / *deposit/prepayment* (a liability, unearned revenue). This is the correct general handling and makes the Payments-Received page safe to keep instead of freezing. Unblocks the $1,000 row for real. Bigger than Step 5 — own investigate→propose pass.
3. **F26 (multi-entity)** — user asked to prioritize for real-world use. `sales_receipts` / `payments_received` have no `entity_id`, so multi-entity users' receipts attribute to whichever entity is viewed. Data-model migration: add `entity_id`, backfill, scope like invoices. Single-entity users unaffected.
4. **`docs(audit)` commit** — `AUDIT_MASTER.md` F38-row update is edited in the working tree, uncommitted. Land it (separate doc commit) + add Step 5 + the two new backlog items above.
5. Prior open items still valid: **PL#11** (Tax Filing fabricates `ytdPaid = liability × 0.75`, `app-main.js` `calcAndRenderTax`), **F33 companions** (overview-chart expense series omits payroll → reads 1000 vs KPI 8000; expense-breakdown panel renders $35.1M; July delta "↑0%" vs $0 June), **F34** (currency toggle relabels without converting), **F40/F47** (cash-flow date-basis), **F44** (`_syncScenarioBase` on pre-F32 basis), the External-QA list (logged-out fake dashboard, negative amounts accepted, mobile hamburger, etc.).

---

## Environment traps (cost real time this session)

- **OneDrive locks git.** The workspace is OneDrive-synced. Sandbox git writes create `.git/index.lock` / `HEAD.lock` that OneDrive freezes → the sandbox **cannot remove them** ("Operation not permitted") and they block the next git op (even from the IDE). **Do git ops from the Claude Code / VS Code terminal or the Source Control panel**, not the sandbox. To clear a stuck lock: `cmd /c del /f /q ".git\index.lock"` (PowerShell `Remove-Item -Force` sometimes fails silently under OneDrive). VS Code's background git can also hold the lock — wait a few seconds or use the Source Control GUI.
- **Scratch dirs to delete/gitignore:** `.s5h/` and `.s5v/` in repo root (harness/verify artifacts from this session, untracked). Also older untracked `AUDIT_2026-07-13.md`, `AUDIT_CODE.md`, `CODE_AUDIT_2026-07-09.md`.
- **`authLimiter` = 10 login attempts / 15 min** (`server.js:304`). Rapid re-login → HTTP **429**; wait ~15 min. Working as intended; leave as-is for real users.
- **Claude-in-Chrome extension bridge dropped mid-session** and would not revive by retrying — needs a browser-side reset (`chrome://extensions` → reload the extension, or restart Chrome). Separate from being logged in and from the site being in "approved sites."
- **Sandbox git ≠ IDE git** (CRLF): reproduce the IDE's view with `git -c core.autocrlf=true`. Don't raise EOL-only diffs as findings (F43).

## Verification harness recipe (reproducible)

- **Server:** hook `require('pg')` → `pg-mem` adapter, then `require('./server')` (exports `computeBooks`; only `listen`s when `require.main===module`, so it loads clean). `initDB` throws on the connect-pg-simple `session` DDL (pg-mem lacks `COLLATE`) but **creates the generic tables first**, so `db.insert`/`allByUser`/`computeBooks` work. Extract the real AP reducer + profit-loss builder from `server.js` source via string-slice + `new Function`.
- **Client:** marker-slice `computeExpenseBreakdown`/`_periodWindow`/`_fyContext` (app-main) and `parseDate`/`buildMonthlyArrays`/`updateKPIs` (dashboard), run in a `vm` context with stubbed `window`/`document`. (Do NOT run the whole `app-main.js` in jsdom — it hangs on boot.)
- **Live:** authenticated browser `javascript_tool`; build windows with `window._periodWindow(period, monthIdx)` and call `/api/reports?start&end&elapsedMonths` with the per-window `elapsedMonths`.

---

## First actions next session
1. **Live-verify F35 Step 5** on `9937966` (the click-test above). If the invoice "Record Payment" opens the amount box → working. If broken, fix forward.
2. Land the **`docs(audit)`** commit (working-tree edit ready).
3. Delete/gitignore `.s5h/` `.s5v/`.
4. Then pick up the **unmatched-payments feature** and **F26**.
