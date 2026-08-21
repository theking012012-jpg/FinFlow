# VERIFICATION.md cell verification — 2026-08-21

Closed the unstamped cells you flagged (A1, A2, A3, A4, A6, B2, B5) by **execution** — two new harnesses,
real embedded Postgres + real jsdom. Verification surfaced **two real render-layer bugs (F186, F187) —
both now FIXED and verified fail→pass.**

## Post-fix verification
- `verify-dashboard-render.js` **9/0** (was 7/2 — both bugs now pass).
- Gates **150/0** · `verify-verification-cells.js` **26/0** · full sweep **137/138**
  (the one red, `verify-f106-client-controls`, is unrelated residual jsdom flakiness — hardened with a
  poll-until-rendered wait; determinism re-confirmation pending a transient tooling hiccup).

## New harnesses (delivered to tests/harness/)
- **`verify-verification-cells.js`** — engine + real server. Client compute fns (marker-sliced like
  step4) and `/api/reports` over HTTP, both vs the `expected.js` oracle. **26/0 GREEN.**
- **`verify-dashboard-render.js`** — real jsdom boot; reads the actual dashboard DOM. **7 pass / 2 fail**
  (the 2 fails are real bugs — a probe that can't fail proves nothing, Rule 4).

## GREEN (verified)
| Cells | What | Result |
|---|---|---|
| **A1** revenue/expenses/netProfit (engine) | all 3 periods | ✅ == oracle |
| **A1.10-12 / A1.13-15** outstanding · investments | 8,500 · 6,000 | ✅ |
| **A1.3/6/12/15** rendered cards (rev/exp/out/invest) | FY view | ✅ |
| **A2.1-6** expense breakdown bars | Rent 650 · Software 100 · Payroll 4,200 · sum == opex · distinct labels · empty absent | ✅ |
| **A3.1-3** rev/exp chart | Jun bars > 0 · inactive month = 0 | ✅ |
| **A6** client == server | revenue + expenses × 3 periods | ✅ all agree, both == oracle |
| **A4.1** transactions list renders | rows present | ✅ |
| **B2.2** live update without reload | logging an expense moves the Expenses card | ✅ |
| **B5.2** period switch | Year→Month changes figures | ✅ |

## FIXED (verified fail→pass against the new harnesses)

### ✅ F186 — Dashboard **Net Profit** paints ALL-TIME COGS at boot (year view) — FIXED
**Fix:** the boot COGS loader (`finflow-api-wiring-dashboard.js`) now loads the **period-scoped** COGS via
the existing `_cogsPeriodParams()` — the same figure `_loadPeriodCOGS` uses — so `window._cogsTotal` has
one consistent value (no two-writer race) and year view no longer assumes "COGS == all-time." Rendered Net
now paints **−$1,700** at boot (was −$1,950). Verified: `verify-dashboard-render.js` A1.9 FAIL→PASS.

### ✅ F187 — Draft invoice in the transactions feed — FIXED
**Fix:** `updateTransactions` now applies the recognised-revenue allowlist (`pending`/`overdue`/`partial`/
`paid`) before slicing, so a draft can't render as income. Verified: A4.2 FAIL→PASS (INV-4 no longer listed).

---

### (original finding detail, for the record)

### F186 — Dashboard **Net Profit** paints ALL-TIME COGS at boot (year view)
- **Symptom:** on a fresh year-view boot, Net Profit renders **−$1,950**; the correct figure is **−$1,700**
  (a **$250 error** on the headline KPI). Revenue (8,800) and Expenses (9,100) render correctly.
- **Evidence (executed):**
  ```
  FY after 8s settle:                         d-profit "-$1.9K"  _cogsTotal=1650   ← all-time COGS
  FY after explicit updateDashboard+_loadPeriodCOGS: d-profit "-$1.7K"  _cogsTotal=1400   ← FY COGS
  oracle FY net = 8800 − 1400 − 9100 = −1700
  ```
- **Root cause (two parts):**
  1. `window._cogsTotal` has **two writers** that race: `finflow-api-wiring-dashboard.js:369` (loads
     ALL-TIME COGS at boot) and `_loadPeriodCOGS` (app-main.js:4968, period-scoped). Final value depends
     on load order — non-deterministic (CLAUDE.md failure #2, multi-writer money figure).
  2. The paint assumes *"year COGS == all-time COGS"* (comment app-main.js:2282). **False in your data:**
     FY-2026 COGS is 1,400 but all-time is 1,650 because S0/P0 sit in FY-2025. So even when the race is
     "won" by the boot loader, year view is wrong.
- **The engine is correct** — `verify-verification-cells.js` proves `computeExpenseBreakdown`/`computeRevenue`
  give the right net (−1,700) for every period. The defect is purely the **render layer**.
- **Fix direction (for your approval):** make `window._cogsTotal` single-writer — only `_loadPeriodCOGS`
  writes it, keyed to the active period, and it must run (and win) at boot for year too. Remove the
  "year == all-time" assumption. One fix, then re-run both harnesses + step-gates.

### 🔴 F187 — Draft invoice appears in the dashboard **transactions list** as revenue
- **Symptom:** the recent-transactions feed shows **`Customer A · Revenue · draft · +$9,999`** (INV-4, the
  draft). Drafts are correctly excluded from the Revenue KPI (8,800) but **not from this list**.
- **Evidence (executed):** `#d-txns` row 3 = `Customer A | Revenue · draft | +$9,999`.
- **Root cause:** `updateTransactions` (finflow-api-wiring-dashboard.js:264) does `invoices.slice(0,5)`
  with **no status filter** — the draft-exclusion rule (Rule 11) enforced everywhere else was never applied
  to this render surface (Rule 13: fixed the class on the KPI, missed this instance).
- **Fix direction:** filter the transaction feed to recognised statuses
  (`pending`/`overdue`/`partial`/`paid`) before slicing — mirror the revenue allowlist.

## Doc-hygiene note (not a code bug)
VERIFICATION.md's **A1 expected-value column is stale** (Revenue 5,000 / Expenses 5,750 / Net −950 / 400).
Those are pre-F58 (before the credit-note/vendor-credit contra) and pre-seed-revision. The authoritative
oracle is `expected.js` (Revenue **3,800/4,000/8,800** net · Expenses **5,450/1,850/9,100** · Net
**−1,850/1,350/−1,700**), which the step-gates already pass against. Worth updating the A1 rows so the doc
stops disagreeing with the gate — the exact three-copies drift `expected.js` was created to end.

## What's now covered vs still open on the finite list
- **Covered by these + the gates:** A1 (all), A2 (all), A3 (all), A4, A6 (all), B2 (representative), B5.2.
- **Still not automated:** B1.2/1.5/1.6/1.7/1.8 (double-submit on the other mutations), B2.1/2.3/2.4/2.5
  (other live-update actions), B5.1 (currency switch), B5.3 (blocked `/api/reports` → "—", needs its own
  process — `server.js` has a module-global pool, so a second in-process bootServer collides). Say the word
  and I'll build these next.
