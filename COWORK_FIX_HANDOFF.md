# FinFlow — fix handoff from 2026-10-19 live check

Source: `COWORK_LIVE_CHECK_RESULTS.md` (full run). This file is the actionable subset for engineering.
Workflow reminder (CLAUDE.md): **read-only investigate → report → propose → diff → verify → HOLD → commit.**
Each item below is one fix per commit. Do NOT commit without owner approval. Where a client function is edited,
**find the runtime-winning copy first** (Rule 1: `app-main.js` vs `finflow-api-wiring-*.js`).

---

## FIX-1 (bug, launch-relevant) — Time entries don't link to Projects
**Severity:** high. Per-project time + billing rollup is dead.

**Evidence (live):**
- Created project "ZZ-LIVECHECK project" (id 1, budget $500). Logged 1.5h (Sam Owner) against it.
- Timesheet shows 1.5h; **Billable Hours KPI = 1.5h**. But the **project row = "0h logged / $0 billed"**.
- `GET /api/timesheet` row keys: `[id,user_id,entity_id,created_at,updated_at,date,rate,hours,project,billable,employee]` — **`project` is a free-text string, no `project_id`.**
- `GET /api/projects` → `{id:1, name:"ZZ-LIVECHECK project", hours:0, budget:500, billed:0}` — hours never incremented.

**Root cause:** the timesheet↔projects relationship is by name-string, not FK. The Projects page rollup keys on `project_id` (or computes nothing), so a logged entry never attributes to the project.

**Fix direction:**
- Add `project_id` to the timesheet entry (POST `/api/timesheet` write path) — link to a real project row; keep the free-text only as a fallback label.
- Compute `project.hours` / `project.billed` / "Unbilled" from the sum of linked entries (Rule 2: enumerate every surface that reads project time — Projects page cards + row, Dashboard "Unbilled", any invoice-from-project flow).
- Backfill is **owner-gated and separate** (Rule 8): existing free-text entries won't have an id — report them, don't auto-migrate inside the code fix.

**Verify (Rule 14 — execute the failure path):** on a real DB, create 2 projects + log hours to each at different rates, assert each project's hours/billed equals the sum of ITS entries (seed so a wrong join gives a different number — Rule 4).

---

## FIX-2 (correctness/label) — "Full year total" is year-to-date; future-period paid payroll shows $0
**Severity:** medium (trust/label). Not a math divergence — client & server agree.

**Evidence (live):**
- Dashboard Expenses card is labelled **"Full year total"**; Reports "Year" P&L has **10 rows, Jan–Oct** only (current month = Oct).
- Two PAID payroll runs in future periods — Nov 2026 $8,000 (paid 14 Oct) and Dec 2026 $8,000 (paid during this test) — contribute **$0**: `POST /api/reports/profit-loss {period:'year'}` → `totalExpenses:4469, payroll:0`.
- Marking the Dec run paid did **not** change the Year Expenses figure before/after.

**Root cause:** the "Year" window in `computeBooks`/`glProfitLoss` runs Jan 1 → current month end (YTD), while payroll books to its explicit period (F85). A future-period run is correctly posted to its month but falls outside the YTD window — so the "Full year total" label overstates what the number includes.

**Decision needed (owner):** pick ONE —
(a) relabel the card/report to "Year to date," or
(b) make the full-year view include posted future-period runs within the fiscal year.
Then make label and window agree. (Check the accountant portal + consolidated views use the same definition — Rule 6.)

**Verify:** seed a paid run in a future month of the current FY; assert the "Year" figure matches whichever definition is chosen, and that dashboard == Reports == P&L == accountant portal.

---

## FIX-3 (audit coverage) — Quotes, Projects, Time, Budget leave no audit row
**Severity:** medium (audit hole; budget & time feed billing).

**Evidence (live):** after creating a quote, a project, a time entry and a budget target, the Audit trail shows **no** rows for any of them. The audit filter has no categories for Quotes / Projects / Time-tracking / Budget. (Invoices, receipts, payments, bills, expenses, payroll, inventory, journals, settings etc. ARE logged, field-level.)

**Fix direction:** add `auditLog()` calls to the create/update/delete handlers for at least **budget targets** and **time entries** (quotes/projects for parity), and add their categories to the audit filter. Rule 13: enumerate the whole class of unaudited mutating handlers, don't patch just these four.

**Verify:** create/edit/delete each; assert one audit row per field change with correct user + timestamp.

---

## FIX-4 (minor UI) — Record-Payment stale "exceeds balance" warning
**Evidence (live):** Record Payment on a $100 invoice (remaining $100), entered **$40** → still showed "⚠ Amount exceeds the remaining balance." Save succeeded correctly (invoice went partial, $60 left), so it's a display-only validation bug.
**Root cause:** the warning isn't re-evaluated on amount change (likely compares against a stale/initial value). **Find the runtime-winning copy** before editing (Rule 1).
**Verify:** type amounts above/at/below remaining; warning appears only when amount > remaining.

---

## FIX-5 (mobile polish) — Invoices list overflows horizontally at phone width
**Evidence (live, ~390px):** the Invoices row action buttons (View / Record Payment / Pay link / ×) don't wrap → horizontal scroll clips the left edge (client name + amount, e.g. "Bright Labs"→"ight Labs", "$2,500"→",500"). Dashboard, Expenses, Personal are clean at phone width.
**Fix direction:** wrap row actions or collapse them into an overflow menu below ~480px; ensure the row's identity column can't be scrolled off.
**Verify:** 390px viewport — no horizontal scroll on the Invoices list; client + amount always visible.

---

## NOT CODE WORK (owner / re-test, not bugs)
- **A2 TTD reporting-currency switch** — feature is live & correct (field present, default USD, API `reporting_currency:null`/effective USD); the *switch action* was blocked by the auto safety classifier, not broken. Owner to exercise, or set task to auto-approve, then re-verify All-entities totals flip to TT$ and back.
- **C14 accountant portal** — not testable without an accountant login. Needs verification before launch (core walled surface).
- **Bank Rec** — no single statement-vs-book balance figure; it's a matching workbench. Only act if a reconciliation summary was intended.

## STILL REQUIRED BEFORE LAUNCH (beyond these fixes)
- **VERIFICATION.md fully green**, incl. the **FIFO layer-ordering** harness case (cannot be proven by live click-through).
- Re-run the changed areas of this check after fixes + the two blocked items above.
- Island Traders (TTD) data-entry flow not re-exercised this run.

## Confirmed working (no action) — from this run
B1 render race fixed · B2/B6 owner-salary crossing fixed (create on paid, remove on void) · P&L reconciles end-to-end · AR reconciles ($10,177 across all surfaces; overdue $1,200 = Bright $1,500 net $300 credit) · revenue accrual/issue basis · expense accrual + Stock→Inventory · B5 flow tests single-write · personal/business wall intact · multi-currency (TTD) reconciles · tax estimates-only · 0 console errors · no full page reloads from nav.
