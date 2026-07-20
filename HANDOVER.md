# FinFlow — Session Handover (19 Jul 2026)

Paste this as the opening briefing for a fresh session.

---

## Role & conventions

Continuing **FinFlow** (solo-founder SaaS accounting/finance platform). The user is the planning/review layer; **Claude Code (VS Code, Opus) does the coding**. You are the review/verification layer.

- Prompts for Code marked **📋 SEND TO CODE**, delimited with `BEGIN PROMPT` / `END PROMPT` (the user has asked twice where prompts end — always delimit them).
- Notes to the user marked **💬**.
- `AUDIT_MASTER.md` is the source of truth (~260 lines, findings F1–F47 + a PRE_LAUNCH backlog).
- Live: `finflow-production-dab1.up.railway.app` — Railway, **auto-deploys from `main`**. Current `origin/main` = **`4a62d05`**.

**Discipline:** read-only investigate → propose → diff → pg-mem/jsdom verify → hold for approval → commit. **Never commit or push without explicit say-so.** Root fixes only. Two-engine hazard: edit wiring sources, never `finflow-bundle.js` (the F13 pre-commit hook regenerates it).

**Commit convention:** alternate `fix(...)` / `feat(...)` and `docs(audit)` commits — don't mix code and doc changes in one.

## Methodology rules (each earned by a real failure)

1. **Views agreeing ≠ correct.** Sanity-check the formula itself, not just that surfaces match. F7's reconciliation cluster made everything agree on a wrong number.
2. **Verify the whole parameter surface**, never a single point. Checking only "Year" is what hid F33.
3. **Demand exhaustive enumeration** before accepting any "this is canonical now" claim. F32 Stage 1 shipped against one monthly-array builder while a second sat on the old basis.
4. **Never auto-merge or auto-route money rows.** Ambiguous cases go to a NEEDS DECISION bucket for the human.
5. **A `$0` from a failure is indistinguishable from a real `$0`** (F31). This applies to *verification* too — an empty table can't prove a fix works.

## Environment traps (cost real time this session)

- **Your bash sandbox git ≠ Code's git.** `core.autocrlf` is unset in the sandbox but `=true` in Code's global config, and it is **not** in `.git/config`. So the sandbox shows phantom CRLF churn (`postgres.js` 389/389, bundle 398/395) that **cannot land in a commit**. Reproduce Code's view with `git -c core.autocrlf=true status -s`. **Do not raise EOL diffs as findings** — I did, and Code was right to push back. Logged as F43 (repo has no `.gitattributes`).
- **Browser: screenshots time out** on this app (long-running script). Use `javascript_tool` instead — it's reliable.
- **Stale tabs freeze.** If `Runtime.evaluate` times out at 45s, create a **fresh tab** and navigate — that fixes it every time.
- **You cannot type the password** (entering credentials is off-limits). You don't need to: the user's Chrome already holds an authenticated session (`/api/me` → id 1, theking012012@gmail.com).
- **`/api/reports` verification gotcha:** pass the **per-window** `elapsedMonths` (1/1/0/1/7 for Jun/Jul/Aug/Q3/Year), **not** the fiscal month index. Passing the index scales payroll accrual and produces a bogus expense mismatch (June "$42K"). This cost one false alarm.

## Live dataset (tiny — every number hand-checkable)

| Table | Rows |
|---|---|
| invoices | 3 — $10,000 / $5,000 / $4,000, all `paid`, all issued July 2026 |
| expenses | 1 — "Office Rent" $1,000, 2026-07-02 |
| sales_receipts | 1 — "usb" $40, 2026-07-16 |
| bills | **0** |
| payments_made | **0** |
| payments_received (Store A) | 1 — $1,000, **empty `invoice_ref`**, 2026-07-16 |

**Baseline gate** (must hold after any no-op change):

- Revenue **exactly $19,040** = $10K + $5K + $4K invoices + $40 receipt
- Jun / Jul / Aug / Q3 / Year = `$0 / $19.0K / $0 / $19.0K / $19.0K`
- Server: june `0/7000/-7000`, july `19040/8000/11040`, aug `0/0/0`, q3 `19040/8000/11040`, year `19040/50000/-30960`
- AP `$0`, AR `$0`
- dashboard == `/api/reports`

**Verification pattern that works:** create a scratch row → verify the behavior → delete it → **re-confirm the exact baseline**. Don't leave test data behind.

## Completed & live-verified this session

- **F33/F25** (period-window unit) — verified live. Opens on Jul 2026, Quarter = real Q3, revenue period-filters, KPI + chart + label move together, dashboard == `/api/reports` at every period. Formula sanity-checked against the actual invoice line items.
- **Mechanical sweep** (`e1319ef`) — F37 (local dates), F39 (recurring-invoice `end_date`), F26 (`entity_id` on receipts), F23 (banking `tx_type`/`tx_date`), PL#6 (FX settle modal), F42 (banking MTD filter). Live-verified by creating/deleting scratch rows: F23 ✅, F26 ✅ (new receipt `entity_id: 1` vs legacy `null`), F37 ✅, F39 ✅, F42 ✅ (inflow $200, no longer stuck $0).
- **F36 closed** (`85a9d2f`, Step 2) — `issue_date` on invoices + bills. **Live-verified decisively:** a scratch invoice with `issue_date: 2026-06-15` but `created_at: 2026-07-20Z` recognized in **June**, not July. Deleted, baseline restored.
- **F38 Step 3** (`8ecdbd4`) — `recalcBillStatus`, `amount_paid`, `payments_made.bill_id`, AP drawdown. Inert on 0 bills (AP $0 confirmed live).

**Still unverified:** PL#6 (modal exists, never exercised — needs an FX transaction). F23's *legacy-row* backward-compat read is **unverifiable** on this account (zero legacy rows exist) — mark it so rather than pretending it's closed.

## 🔴 FIRST THING NEXT SESSION — F38 Step 4

Not started. The issued-bill expense leg at **all five accrual sites, both engines**:

| # | Site | file:line |
|---|---|---|
| 1 | `computeBooks` opex | `server.js:3791-3797` |
| 2 | `computeExpenseBreakdown` | `app-main.js:1588-1601` |
| 3 | `buildMonthlyArrays` | `dashboard.js:72-94` |
| 5 | profit-loss monthly rows | `server.js:3230-3231` |
| 10 | `updateKPIs` | `dashboard.js:166-167` |

Uniform transform at each:

```
expense = Σ expenses
        + Σ (RECOGNIZED_BILL bills, FULL amount, by issue_date, in window)   ← new leg
        + Σ (payments_made WHERE bill_id IS NULL)                            ← orphans stay expense
        (+ payroll where the site already has it)
```

The **`bill_id IS NULL` predicate is the sole double-count guard** — a linked payment is a settlement, not a fresh expense. Cash-basis routes (`/api/cashflow`, `/api/reports/cash-flow`) stay unchanged (decision #2).

**Fold in the approved AP amendment:** `server.js:3305` change `RECOGNIZED_BILL.has(s) && s !== 'paid'` → `RECOGNIZED_BILL.has(s)` with reducer `Σ max(0, amount − amount_paid)`. Rationale: excluding `'paid'` buys nothing (a truly paid bill contributes 0) but lets a wrongly-set status hide real liability; the floor prevents overpayment driving AP negative. Harness cases: bill $500 / `amount_paid` 200 / status forced `'paid'` → AP **$300**; `amount_paid` 600 on $500 → contributes **0**, never −100.

Touches `dashboard.js` → **bundle regen required** (`node bundle.js && node bundle.js --check` == 0). Step 4 must be a **provable no-op** on current data (0 bills → new leg sums to 0 → every KPI byte-identical to baseline). Any drift is stop-and-report.

## Then: Step 5 (F35)

Delete the two Store A `openRecordPaymentModal` openers (`final5.js:134`, `pages.js:256`); the surviving inline `index.html:4144` 3-arg opener routes invoice payments to Store B (`invoice_payments`). Bill "record payment" writes `payments_made` with `bill_id`. **Bill "mark paid" (`pages.js:683`) must create a real linked `payments_made`, not just set `amount_paid`** — otherwise the cash-basis cash-flow route can't see the outflow. This is the only step with user-visible behavior change; give it its own deploy and verification.

## ⛔ Blocked on the user

**The $1,000 Store A row.** `payments_received` id 1, $1,000, **empty `invoice_ref`**, 2026-07-16. The migration rule as originally written ("no match → cash sale") would route it to `sales_receipts`, which **is revenue** — taking revenue $19,040 → $20,040 and reintroducing the exact F32 defect that was verified fixed. Amendment applied: empty ref is its own **NEEDS DECISION** bucket, never auto-routed (enforced in `scripts/inventory-store-a.js`).

It is **inert today** (Store A is already excluded from revenue), so it blocks only the Payments-Received read-only freeze at the end of Step 5. The user must rule: real cash sale, payment against an invoice, or junk to delete. Nothing in the data matches it — invoices are $10K/$5K/$4K; the one other $1,000 figure is an *expense* (Office Rent, Jul 2 vs this row's Jul 16).

## Open backlog (each needs its own investigate→verify pass)

**Live wrong-money, highest priority after the cluster:**
- **PL#11** — Tax Filing fabricates figures: flat 25% rate + hardcoded `ytdPaid = liability × 0.75` (`calcAndRenderTax`, `app-main.js:5907`).
- **F33 companion** — expense breakdown renders **$35,140K (~$35.1M)** on a $19K-revenue business.
- **F33 companion** — overview chart's *expense* series reads `1000` for July while KPI/API read `8000` (payroll missing from the chart).
- **F33 companion** — deltas vary per period now (the frozen ↑700%/↓39% is fixed) but July shows "↑ 0%" against a $0 June; correctness unconfirmed.

**Other open:** F34 (currency toggle relabels without converting), F23/F26/F30, F41 (recurring bills' `end_date` dormant — no `rb-end` field), F43 (no `.gitattributes`), F44 (`_syncScenarioBase`, `medium.js:980` — still on **pre-F32 paid-only revenue**), F45 (budget actuals all-time), F46 (banking `type` unvalidated — any string accepted, client silently defaults unknown to *outflow*), F47 (cash-flow keys paid-invoice inflow on `created_at`).

**External QA:** 🔴 logged-out visitors see a fake logged-in dashboard with demo data while APIs correctly 401; 🔴 negative invoice/expense amounts accepted (`-10`), no validation; 🟠 mobile hamburger broken at 390px; 🟠 Privacy/Terms/Security links all `#`; 🟠 AI error leaks `ANTHROPIC_API_KEY` while UI says "AI is ready"; 🟡 modal a11y; 🟡 horizontal scroll at 390px.

**PL backlog:** audit trail reads the wrong table (`audit_trail` vs `audit_log`), quotes never convert, FX Settle (PL#6 now fixed but unverified), credit notes/vendor credits not contra, Client Portal vaporware, Banking/Templates/API-Connections placeholders, PL#3 entity paywall unenforced server-side.

**Also open:** console/perf (`loadPersonalFinance` fires 6–8× per load, `loadEntityData` double-call, `reload.js` dev script in production), issue-4 honesty pass, Holdings two-engine.

## Env-gated (not bugs)

Stripe vars unset → no payments. Anthropic key set but uncredited → AI errors. F18 follow-ups parked (prompt-caching is a no-op; Haiku-vs-Sonnet ≈3× cost lever needs a live test). `APP_URL` on the Railway domain — **custom-domain swap is two places**: `app-url.js` `LIVE_FALLBACK` + `sitemap.xml`/`landing.html`/`.env.example`.
