# Fix plan — the two open divergence-class items: L6b (journal balance-sheet legs) + L36 (client AR "today")

**Written:** 2026-10-08 (grounded in `origin/main`) · **Branch:** `dash-je-fix` · **For:** Claude Code to verify + fix.
**Class:** Rule 2 / Rule 13 (a figure diverges across surfaces) and, for L36, Rule 10 (accounting date = entity's day).
These are the last two OPEN items in LAUNCH_EXECUTION_PLAN.md's ledger. Same family as the dashboard↔journal fix
(470dce2), L3, L5, L6 (cash), L35 (overdue).

> **ALL harness and sweep runs happen in PowerShell on the owner's machine — never the cloud container.**
> Write/extend the harness, hand the owner the exact `node -r ./tests/harness/clock.js tests/harness/<FILE>.js`
> command + the full-sweep command; the owner runs them (3× for the sweep) and pastes results back. The agent
> commits per step on `dash-je-fix` and does NOT push/merge to `main` — the owner does the final push.

---

## L36 — client AR "today" is the UTC day, server uses the entity's day (Rule 10) — do this one first (small, low-risk)

### Verify (RED first — Rule 14)
Seed one invoice **due on the entity's local "today"** for an entity far from UTC (e.g. Asia/Tokyo UTC+9 or
Pacific/Pago_Pago UTC-11), at an instant where the UTC day ≠ the entity day (near midnight). The server's
overdue/D2 boundary is the entity day; the client's is UTC — so the invoice is overdue on one and not the other.
State the buggy split in the test.

### Root + fix
- **Client `arOutstanding()`** — `public/app-main.js:2270` `const _arToday = window.FinFlowDates.resolvedToday(new Date());`
  → pass the active entity zone: `resolvedToday(new Date(), window._activeEntityTz())`. **The correct pattern
  already exists 80 lines up** at `app-main.js:691` (the D2 future-dated check uses `resolvedToday(new Date(), _activeEntityTz())`) —
  mirror it. Audit the other `resolvedToday(new Date())` AR/period sites (2169, 2196, 2270, 4285, 5828) and fix the
  ones that gate an **accounting** boundary (overdue/D2/AR); a pure display label can stay (label-only is exempt per Rule 10).
- **Accountant portal** — `public/accountant-client.html:1080 _portalOverdueInvoices()` uses `new Date().toISOString()`
  (UTC). The portal is a standalone page with no `_activeEntityTz`; thread the entity day in from the server summary
  the portal already fetches (prefer the server's `books.window.today` / `arSummary` overdue over recomputing on the
  client — that also closes L35 Root 3 permanently), or pass the entity's tz/today in the portal payload.
- Runtime winner: `arOutstanding` is `app-main.js`, set on `window._arOutstanding`, no wiring override — confirm with
  `grep -rn "window._arOutstanding *=" public/finflow-api-wiring-*.js`. After any client edit: `node bundle.js && node bundle.js --check`.

### Done when
Client overdue COUNT/amount == server for the far-from-UTC entity at the midnight instant; `verify-ar-today-entity-tz.js`
RED→GREEN; the L35 overdue harness + money gates stay green (PowerShell). Commit as its own L-number.

---

## L6b — journal legs to AR / AP / Inventory / Tax post to `J`-shadow accounts that no balance-sheet reader sees

A JE "Dr Accounts Receivable 100 / Cr Revenue 100" moves revenue (P&L leg already carried) but **AR does not move on
the balance sheet** — the leg posts to `J1100` (postJournalToLedger, `server.js:10639` posts every line to `'J'+code`),
while the BS reads only system codes: `glBalanceSheet` `accountsReceivable: bal['1100']` / `inventory: bal['1200']` /
`accountsPayable: bal['2000']` / `taxPayable: bal['2100']` / `payrollLiabilities: bal['2200']` (server.js:~10584),
and `computeBooks` AR = `books.outstanding` (invoices only), AP = `books.accountsPayable` (bills only). The reconcile
gate `eq(glAR, ar) && eq(glAP, apNet)` (server.js:10575, `glAR=bal['1100']`, `glAP=bal['2000']`) stays green
**vacuously** — both sides drop the JE — so nothing alerts; the leg is silently lost (Rule 6: agreement ≠ correctness).
This is the exact twin of **L6** (cash), which was fixed by teaching the cash readers the J-codes
(`JOURNAL_CASH_LEDGER_CODES = ['J1000','J1010','J1020']`, server.js:10627).

### STEP 1 — the account map (the one genuine owner decision; Code proposes, owner ratifies)
The JE picker template (`COA_ACCOUNTS`, app-main.js:1184) **collides** with the system/DEFAULT_COA codes:

| JE template code | template name | system/DEFAULT_COA same code | → maps to BS line? |
|---|---|---|---|
| 1100 | Accounts Receivable | 1100 AR | **AR** (unambiguous) |
| 1200 | Inventory | 1200 Inventory | **Inventory** (unambiguous) |
| 2000 | Accounts Payable | 2000 AP | **AP** (unambiguous) |
| 2100 | **Credit Card** | 2100 = **Tax Payable** (system) | ⚠️ ambiguous — needs owner |
| 2200 | **Tax Payable** | 2200 = **Payroll Liabilities** (system) | ⚠️ ambiguous — needs owner |

Code proceeds on the three unambiguous mappings now. For the two ⚠️ rows, Code surfaces a one-line recommendation
(e.g. template 2200 "Tax Payable" → the BS **Tax Payable** line; template 2100 "Credit Card" → a BS **Other current
liabilities / Credit card** line) and holds ONLY that choice for the owner — it does not block AR/AP/Inventory.
Record the ratified map in the ledger + Owner Handoff ("journal account map").

### STEP 2 — carry the JE legs into the figure (mirror the P&L-leg fix 470dce2 and the L6 cash fix)
Two-sided, so the reconcile gate stays a real check (not vacuous):
1. **`computeBooks`**: AR (`books.outstanding`) carries the posted-journal AR leg, AP carries the AP leg, Inventory
   carries the inventory leg — read FROM the GL `source_type='journal'` J-accounts (same technique as the P&L je leg
   already in computeBooks), so reversals net to zero by construction and consolidation/FX match.
2. **`glBalanceSheet` + the reconcile gate**: the AR reader becomes `bal['1100'] + bal['J1100']` (and AP `+bal['J2000']`,
   inventory `+bal['J1200']`, tax per the ratified map) so `glAR == books AR` still holds WITH the leg on both sides —
   the gate now fails if exactly one side carries it (give it teeth). Keep TB and BS balanced (the JE is balanced by
   construction; its other leg already lands in P&L/cash/equity).
- Edit server-side only (no client change needed for the BS figures); no data migration (Rule 8) — this is a read-path
  change going forward, exactly like the revenue fix. The owner-gated prod **backfill** of historical JEs is separate
  and already tracked (L33/L34).

### STEP 3 — verify (discriminating — Rule 4 — PowerShell)
New `tests/harness/verify-gl-journal-bs-legs.js` (real embedded PG, real `/api/journals` + `/api/reports/balance-sheet`
+ `/api/gl/reconcile-check`):
- Post "Dr AR 100 / Cr Revenue 100" → **BS AR += 100**, reconcile `glAR==booksAR`, TB+BS balanced. (RED pre-fix: AR Δ0.)
- Post "Dr Expense 60 / Cr AP 60" → **BS AP += 60**, reconcile `glAP==booksAP`.
- Post an inventory JE and a tax JE (per the ratified map) → the right BS line moves; the wrong one doesn't.
- Reverse one (Posted→Draft) → the BS line returns to baseline, reconcile stays green (proves two-sided + teeth).
- Seed amounts so each leg's value is distinct (Rule 4) and state the pre-fix Δ0 in the test.
Then money gates + GL/reports/parity regression + full sweep 3× green (PowerShell). Re-verify live on dab2 after deploy:
a JE to AR/AP/Inventory moves the Balance Sheet line and reconcile stays `booksBalanced`.

---

## Operating rules (LAUNCH_EXECUTION_PLAN.md §0)
Do L36 first (small), then L6b STEP 1 (hold the 2-row map for the owner) → STEP 2 → STEP 3. One fix per commit, each
with its harness assertion. Edit wiring sources / server, never `finflow-bundle.js`; regen the bundle. Commit on
`dash-je-fix`; the owner does the final push. Log L36 and L6b as FIXED in the Findings Ledger + Progress Log when their
harnesses are green in PowerShell; record the ratified account map under Owner Handoff.
