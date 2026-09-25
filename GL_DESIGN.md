# FinFlow — General Ledger (GL) Design

_Design only — no code shipped. This de-risks the GL build so it can be done in small, verified,
reversible steps. Written 2026-09-16 against the real code (`server.js` computeBooks + posting paths,
`database.js` schema). Same discipline as `RLS_DESIGN.md` / `FX_CONSOLIDATION_DESIGN.md`._

## Why this exists

FinFlow today is a **source-document (shoebox) system**: each feature (invoice, expense, bill, payroll
run, payment) stores a row, and every report is `computeBooks` **re-summing those rows**. It works, but:

1. **Reconciliation is manual and fragile.** Most of the correctness pain in this repo — the payroll
   double-count, F25/F55, the FX consolidation bug, the "six surfaces must agree" problem, hundreds of
   harnesses whose whole job is proving *these rows sum to that figure* — exists **because** there is no
   ledger where the numbers tie out by construction. A real double-entry GL makes those bug classes
   impossible, not merely tested.
2. **No trial balance, no credible balance sheet.** `/api/reports/balance-sheet` today is AR-only (cash
   is `null`/untracked, `server.js:~4810`). There is no trial balance because there is nothing for a
   "difference = 0" to fall out of.
3. **Accountant credibility (roadmap #3).** Every serious competitor (QuickBooks, Xero, Zoho, Wave,
   Sage, NetSuite) is a double-entry GL under the hood. An accountant opening FinFlow looks for the trial
   balance and journal detail immediately. The GL is table stakes for the marketplace, not a nice-to-have.

**None of the existing work is wasted:** `computeBooks`' per-figure logic becomes the **posting rules**
for the GL, and the **oracle** that proves the migration is correct (see "computeBooks as the oracle").

## What exists today (grounded)

- **`chart_of_accounts`** — already has `code, name, category, nature, balance`, entity-scoped, idempotent
  (`idx_chart_of_accounts_idem_key`). A usable COA skeleton; not yet wired to any posting.
- **`journals`** — already REAL double-entry: POST refuses to save unless `Σdebit == Σcredit`
  (`server.js:2364`), has lines, idempotency, period-lock check. This is the seed of the ledger.
- **`isLocked(userId, entityId, date)`** — period locks, enforced on many mutations.
- **Immutable audit trail** (`audit_trail`, append-only) — `verify-audit-immutability`.
- **Void-not-delete** pattern already exists for payroll runs (`status='voided'`, stays dated, drops from
  books).
- **Per-leg FX conversion** (this session): `computeBooks(entityId=null)` converts each leg to base at its
  recognition date. The GL reuses this for `amount_base`.
- **Missing:** any `ledger_entries` / `ledger_lines` table; source docs do NOT post to accounts; no cash/
  bank account; no trial balance.

## Goal / non-goals

**Goal:** every money event posts a balanced double-entry to typed accounts, so the trial balance ties to
zero by construction; trial balance / balance sheet / P&L are derived from the ledger; corrections are
reversing entries, never destructive edits; multi-entity consolidation sums `amount_base`.

**Non-goals (for this project):** changing the UX (posting is invisible plumbing, exactly like QBO/Xero);
matching competitor *integration breadth*; bank-feed matching (that's roadmap #4, which sits ON this GL);
tax computation (#5, also on this GL).

## Core data model

**`ledger_accounts`** (promote `chart_of_accounts`; keep code/name/entity_id):
- `type ∈ {asset, liability, equity, income, expense}` (derive from existing `category`/`nature`)
- `normal_balance ∈ {debit, credit}` (asset/expense = debit; liability/equity/income = credit)
- `currency` (entity currency), `is_system` (protects AR/AP/Cash/Retained-Earnings from deletion)

**`ledger_entries`** (journal header — one per money event):
- `id, user_id, entity_id, date` (a **calendar date string**, Rule 10 — never an instant)
- `description, source_type` (`invoice|invoice_payment|sales_receipt|expense|bill|bill_payment|payroll_run|inventory|cogs|credit_note|vendor_credit|fx|manual`)
- `source_id` (the originating row), `currency`, `status ∈ {posted, reversed}`, `reversal_of` (nullable)
- `idempotency_key` (unique index — Rule 9), `created_at` (a genuine timestamp)

**`ledger_lines`** (the debits and credits):
- `entry_id, account_id, debit, credit` (one non-zero per line), `amount_base` (converted at the entry's
  recognition date — reuse the FX work), `memo`

**Invariants (enforced + harnessed):**
- Per entry: `Σdebit == Σcredit` (refuse to post otherwise — mirrors the journals rule).
- Global: `Σ all debits − Σ all credits == 0` (the trial balance; RED-provable by injecting one
  unbalanced line).
- Assets − (Liabilities + Equity) == 0 (balance sheet balances by construction).

## Posting engine (source txn → balanced entry)

One rule per source type. Amounts post in entity currency + `amount_base`.

| Source event | Debit | Credit |
|---|---|---|
| Invoice issued (accrual/issue-based, Rule 11) | AR | Revenue (+ Tax Payable if taxed) |
| Invoice payment (`invoice_payments`) | Cash/Bank | AR |
| Sales receipt (walk-in cash) | Cash/Bank | Revenue (+ Tax Payable) |
| Expense (cash) | Expense | Cash/Bank |
| Bill recognized (`RECOGNIZED_BILL`) | Expense | AP |
| Bill payment (`payments_made`) | AP | Cash/Bank |
| Payroll run (basis C, run lines) | Payroll Expense (gross) | Cash/Bank (net) + deduction liabilities |
| Inventory purchase (movement) | Inventory | Cash/Bank or AP |
| COGS on sale (FIFO, existing engine) | COGS | Inventory |
| Credit note | Revenue (contra) | AR |
| Vendor credit | AP | Expense (contra) |
| FX gain/loss (`fx_transactions` reval) | FX Loss / (Cr) FX Gain | offsetting account |
| Manual journal (existing `journals`) | as entered | as entered |

**Cash/Bank** is the account FinFlow lacks today. Introduce a `Cash/Bank` account per entity (this is also
the anchor for bank reconciliation, roadmap #4). Until bank feeds exist, it's a single Cash account.

## Immutability, corrections, period locks

- Posted entries are **append-only**: never edited or deleted.
- A correction posts a **reversing entry** (mirror image, `reversal_of` set) + a new correct entry. Extends
  the existing payroll void pattern to all types.
- Posting into a **locked period** is refused at the posting layer (reuse `isLocked`); a correction to a
  locked period posts to the current open period with a dated memo, or requires an explicit reopen.
- Double-fire safety via the **shared idempotency key** (Rule 9), not per-button guards.

## computeBooks as the oracle (the key de-risking idea)

`computeBooks` already computes every figure correctly from source docs. During the whole rollout, the GL
figures **must equal computeBooks figures** on real seeded data. That equality **is** the migration proof
(Rule 6 — an independently-derived oracle the GL cannot grade its own homework against). `computeBooks`
stays the source of truth until the GL is proven equal across the full `VERIFICATION.md` seed, then the flip.

## Phased rollout (each phase = its own verified pass + commit)

- **Phase 0** — this design. ✅
- **Phase 1** — schema only: `ledger_accounts` upgrade + `ledger_entries` + `ledger_lines`, idempotent DDL,
  seed a default typed COA (incl. AR, AP, Cash, Revenue, COGS, Payroll, Retained Earnings) per entity. No
  behavior change. Harness: schema + seed integrity. ✅ (`verify-ledger-schema.js`)
- **Phase 2** — posting engine, **dual-write shadow**: the source doc still writes its row AND posts a
  ledger entry; reports still read `computeBooks`. Per type: harness proves the entry balances AND the
  posted leg == the computeBooks leg on a discriminating seed (Rule 4). ✅ **ALL TYPES DONE** —
  invoice, invoice_payment, expense, bill, bill_payment, sales_receipt, payroll, inventory/COGS,
  credit_note, vendor_credit, fx. Each has its own `verify-gl-post-*.js` (all GREEN, oracle-parity +
  trial-balance-ties-to-zero). FX has no computeBooks leg (the dashboard reports fxRealised separately),
  so it is checked against the independent realised-GL formula (Rule 6).
- **Phase 3** — trial balance / balance sheet / P&L / journal / accounts endpoints read PURELY from the GL
  (`glFinancials` + `/api/gl/*`, additive — no existing report path touched). ✅ Capstone
  `verify-gl-statements.js` seeds one of every P&L type at once and proves: TB ties to zero, balance sheet
  balances (A = L + E), and the ledger P&L reconciles to `computeBooks` to the cent (income==revenue,
  expenses==cogs+opex, netProfit==netProfit). GL P&L is period-scoped with the SAME FinFlowDates window +
  D2 as computeBooks; the balance sheet is an as-of-today snapshot. Entity-scoped (consolidated
  multi-currency GL statements are a later enhancement).
- **Phase 4** — **backfill** (owner-gated, Rule 8). ✅ **DONE** — `backfillLedgerForUser` + owner-only
  `POST /api/gl/backfill` (`?entity_id=`, `?dry=1`) replay every existing source doc through the SAME
  posting rules and idempotency keys the dual-write routes use, so an already-posted doc is a no-op —
  backfill and dual-write coexist and re-running is free. No source table is mutated. Capstone
  `verify-gl-backfill.js` (24/0): seed one of every type via the API (dual-write posts), snapshot,
  WIPE the ledger, rebuild via the endpoint, and prove the rebuild is BYTE-IDENTICAL to the dual-write
  ledger (keys, dates, accounts, debits, credits), reconciles to computeBooks, ties the trial balance
  to zero, and is idempotent (a 2nd run posts nothing; dry-run writes nothing). The dual-write path is
  the independent oracle for the backfill (Rule 6).
- **Phase 5** — GL becomes the certified book of record + **continuous cross-check**. ✅ **DONE (safe flip)**
  — `glReconcile` + `GET /api/gl/verify` expose a live **`booksBalanced ✓`** signal: per entity it AND's
  (a) trial balance ties to zero, (b) balance sheet balances (A = L + E), (c) ledger P&L == `computeBooks`
  for the parts the aggregate tracks (revenue, cogs+opex ex-FX). `computeBooks` is KEPT as the
  display/consolidation engine (it still owns multi-currency/display-currency and the accountant portal),
  now continuously proven against the ledger. `verify-gl-verify.js` (11/0) proves the signal is
  RED-provable: it drops to false when the ledger lags the source docs (pre-backfill) and when any entry
  is broken — a signal that can't go red proves nothing.
  - **Phase 5b (IN PROGRESS)** — the read-swap onto the GL, done SAFELY via a reconcile-gated read with
    `computeBooks` as oracle fallback (see the 5b section below). P&L statement slice SHIPPED. Remaining:
    balance sheet (unlocks real GL cash), the dashboard `GET /api/reports`, then harness migration.
  - **Phase 5b (original plan)** — the HARD read-swap (point `/api/reports` + dashboard at the GL
    instead of `computeBooks`). Prereqs before this is safe: (1) universal backfill so every user has a
    complete ledger, (2) consolidated + display-currency `glFinancials` to match `computeBooks`' FX paths,
    (3) migrate the ~50 report/accountant harnesses. Until then the dual-write + verify signal give the
    GL's guarantees with none of the read-swap risk.

## Non-negotiables (map to CLAUDE.md)

- One source type per commit (Rule: one fix per commit).
- Dual-write shadow before any read flips — never change what the user sees until the GL is proven.
- `computeBooks` stays the oracle until the GL matches it byte-for-byte (Rule 6/14).
- Backfill is its own owner-gated commit; no source table is migrated as part of a code change (Rule 8).
- No destructive edits — reversing entries only. Period locks enforced at the posting layer.
- Dates are calendar strings; genuine timestamps resolve in the entity's zone (Rule 10). `amount_base`
  reuses the proven per-leg FX conversion.

## Open questions for the owner

1. **Cash/bank accounts** — introduce a real Cash account now (anchors bank rec #4), or a single implicit
   Cash account to start?
2. **Default COA template** — one standard chart, or per-country (ties to tax, #5)?
3. **Existing `journals`** — fold into `ledger_entries` as `source_type='manual'` (recommended), keeping the
   current UI.
4. **Tax payable accounts** — stub now (so invoices can credit Tax Payable) or defer to #5?

## What this unlocks

Trial balance + credible balance sheet + "provably correct books" (#2), the accountant marketplace's
credibility (#3), and the substrate for bank reconciliation (#4) and localized tax/filing (#5). It is the
foundation the rest of the roadmap stands on.

### #3 shipped — GL certification in the accountant portal
`GET /api/accountants/clients/:id/books` now carries a `certification` block: per permitted entity,
FinFlux's own ledger certifies the books tie out (trial balance to zero, balance sheet balances, GL P&L
== the canonical reports ex-FX), plus an overall `certified`. "FinFlux clients come with certified books"
— a trust signal no competitor has, and one built directly on the GL. `verify-gl-accountant-cert.js`
(12/0) proves it is honest and RED-provable (certified drops to false when a client's ledger is broken or
lags the source docs). `glReconcile` is threaded from server.js into the accountant module for this.

### #4 shipped (slice) — bank reconciliation posts to the GL
The money-out bank-rec actions created source rows via `db.insert`, bypassing the routes' own dual-write.
Now `/api/bank-reconciliation/book-expense` posts Dr Operating Expenses / Cr Cash (key `expense:<id>`) and
`/match-bill` posts Dr Accounts Payable / Cr Cash (key `payment_made:<id>`) — the SAME legs/keys the normal
routes and the backfill use, so nothing double-counts and the ledger stays consistent. Money-IN `/match`
(and `/match-batch`) correctly post NOTHING: they link a bank credit to an already-posted invoice payment
(matching is not a second event). Cash uses the single operating account `1000` (per-bank cash sub-accounts
1010/1020… are a clean later enhancement). `verify-gl-bankrec.js` (11/0). Owner-question #1 resolved:
single Cash account now, per-bank accounts deferred.

### GL hardening - reversal on void/delete (shipped)
`reverseLedgerEntry` posts a MIRROR-IMAGE entry (debits<->credits) dated at the original's date, linked via
`reversal_of`, idempotent on `reverse:<type>:<id>`, wired into every void/delete route (invoice, expense,
bill, sales_receipt, credit_note, vendor_credit, payments_made, invoice_payment, payroll void). Voiding or
deleting a recognised doc now nets its ledger to zero exactly as computeBooks drops it, so the certified
books stay correct through the full document lifecycle. `verify-gl-reversal.js` (16/0) - baseline non-zero,
then delete/void -> every P&L account nets to 0, still reconciled, trial balance ties, one reversal per doc.

### #5 localized estimate defaults (shipped, estimator-only)
FinFlow calculates NO real tax by design (D1 - licensing/liability). `GET /api/tax/suggested-rate` returns a
per-country SUGGESTED starting rate + local label to pre-fill the estimator, every response flagged
non-authoritative ("not tax advice") with the owner's saved rate surfaced as `savedRate` (always wins).
Purely additive - no existing estimate/report path reads it. `verify-tax-suggested-rate.js` (7/0).

### GL hardening - edit lockstep + live dual-write on non-primary paths (shipped 2026-09-24)
Two gaps that could make the certification signal falsely fail (or the balance sheet drift) are now closed.

**1) Edit (PUT) keeps the ledger in lockstep.** Reversal previously fired only on DELETE/void. Now
`resyncDocLedger` runs on invoice/bill PUT and reconciles the canonical entry (`<type>:<id>`) to the doc's
current state: flip to `draft` / out of `RECOGNIZED_BILL` -> reversed (net zero); flip back -> re-instated
(the reversal is removed, canonical key preserved); amount/issue-date edit while live -> the entry's lines
are trued-up in place. The canonical key is never versioned, so backfill stays idempotent. Because
`reconciledToReports` is P&L-based, an un-synced edit would have shown certified=false against a correct
computeBooks; this keeps them equal through the whole lifecycle. `verify-gl-status-reversal.js` (25/0).

**2) Non-primary write paths post LIVE, not just via backfill.** `postSourceLedger` posts the canonical
entry (same legs + keys as backfill, mutually idempotent) from every path that created source rows with a
bare `db.insert`: the recurring scheduler (`runRecurringScheduler` -> invoice + bill), the Stripe import
(sales receipt + processing-fee expense), the Stripe refund (contra receipt) and match-invoice (fee), and
`recordExternalInvoicePayment` (pay-link / webhook cash leg, Dr Cash / Cr AR). The books are now correct the
moment the row is written, not only after a backfill. `verify-gl-dualwrite.js` (13/0).

**Deferred (documented, low value / thorny):** paid-on-create invoice cash leg. When an invoice is created
already `paid`, GL records only the accrual (Dr AR / Cr Revenue), so the balance sheet shows AR outstanding
instead of Cash collected. This is P&L-NEUTRAL (both legs are balance-sheet accounts), so it does NOT affect
`reconciledToReports`, `booksBalanced`, or the certification signal - it is purely a Cash-vs-AR
classification on the balance sheet. The coherent fix is to record a real `invoice_payment` row on paid
creation (so the existing payment posting + reversal + backfill all handle it uniformly), rather than a
synthetic cash leg that a later reversal/resync would leave dangling. Left as a clean follow-up.

### Mobile perf - front-end minify build (shipped 2026-09-24)
App JS is served `no-store` by design (the service worker is the freshness layer, so a stale HTTP cache can
never pin old money-computing code). With HTTP caching off and gzip already on, the remaining mobile lever
is fewer BYTES to parse/execute -> minification. `scripts/minify.js` (terser) writes minified copies of the
served app scripts into `public/.min/`; server.js transparently serves `public/.min/<name>` for `/<name>`
when it exists and is at least as new as its source (mtime guard), under the SAME URL - so index.html, the
SW cache manifest and the bundle drift-guard are all untouched. Purely additive + fail-safe: no terser, a
minify failure, or a stale artifact all fall back to the readable original. `prestart` runs it after
`bundle.js`; `public/.min/` is gitignored (regenerated on deploy). ~43% smaller (905 KB -> 517 KB across the
8 targets). `verify-min-serving.js` (8/0).


### GL Phase 5b (slice 1) - P&L reads from the ledger, oracle-fallback (shipped 2026-09-25)
The read-swap is done WITHOUT the big-bang prereqs (universal backfill, consolidated/FX glFinancials),
by gating the flip per-request: `glProfitLoss(userId, entityId, {period, display})` computes the GL P&L
AND computeBooks, and serves the LEDGER numbers only when every P&L line (revenue, COGS, payroll, opex,
gross, net) matches computeBooks to the cent AND the trial balance ties; otherwise it serves computeBooks
unchanged and logs the divergence (`[GL 5b] P&L divergence ...`). So the user never sees a wrong number:
an incomplete ledger (no backfill), a consolidated view (entityId null), an FX/display-currency request,
or any GL read error all fall back automatically, and each request upgrades to the ledger the moment that
entity's books are provably complete. `POST /api/reports/profit-loss` now sources its canonical totals
through this helper and returns `source: 'gl' | 'computeBooks'` for observability (response shape and
numbers otherwise unchanged - verify-f137g-pl-statement stays 17/0). computeBooks remains the oracle.
`verify-gl-pl-readswap.js` (16/0) proves gl-served parity, broken-ledger fallback with correct numbers,
and consolidated/FX fallback, at both the helper and the live endpoint. The monthly `rows` chart stays
source-doc-derived this slice. NEXT: balance sheet (real GL cash vs today's AR-only stub), then the
dashboard read, then migrate the report/accountant harnesses so the sweep asserts GL as the source.

### GL Phase 5b (slice 2) - payroll cash-out completes the GL cash flow (shipped 2026-09-25)
Prereq for a trustworthy balance-sheet cash figure. Payroll recognised its expense at approve
(Dr Payroll Expense / Cr Payroll Liabilities) but never posted the CASH-OUT when a run was marked paid,
so Payroll Liabilities (2200) never cleared and GL cash was overstated - which is exactly why the
balance-sheet cash upgrade could not be trusted yet. Now `PUT /api/payroll-runs/:id/mark-paid` posts
Dr Payroll Liabilities (2200) / Cr Cash (1000) for the run's line total, keyed `payroll_paid:<id>`
(idempotent), dated at the pay date (run_date, else the period) - mirroring the cash-flow report's F122
paid-payroll outflow. So 2200 nets to zero on payment and GL cash reflects it. Void reverses BOTH legs;
backfill replays the cash-out for every `paid` run (idempotent). P&L is unaffected (both legs are
balance-sheet accounts), so glReconcile/certification are unchanged. `verify-gl-payroll-cashout.js`
(16/0). With this, the remaining cash-completeness question for the balance-sheet cash upgrade is closed
for payroll; the BS cash slice can proceed next (gate cash on trial-balance + P&L + AR + AP reconciling).

### GL Phase 5b (slice 3) - balance sheet reports REAL cash from the ledger (shipped 2026-09-25)
The balance sheet now serves a REAL cash balance (account 1000) from the ledger - the F123 stub could only
say cash "not tracked" (assets = AR only), because there was no cash account to compute from. `glBalanceSheet`
applies the same oracle-fallback discipline as the P&L, with a STRONGER gate for cash trust: serve the GL
balance sheet only when the trial balance ties, the P&L reconciles to computeBooks, AND GL AR/AP equal the
canonical AR/AP (a completeness proxy - and payroll cash-out now posts too, so cash is trustworthy under
this gate). Otherwise the honest AR-only stub, unchanged. Consolidated (entityId null) always falls back.
`POST /api/reports/balance-sheet` delegates to the helper and returns `source`, plus `cash`/`cashTracked`,
`inventory`, `taxPayable`, `payrollLiabilities`, and `totalAssetsExcludesCash`. The Reports-page render
(finflow-api-wiring-extra.js) is now DATA-DRIVEN off `totalAssetsExcludesCash`: real cash + an "incl. cash"
label + Inventory/Tax-Payable/Payroll-Liability lines when GL-sourced; the exact AR-only "excl. untracked
cash" view when served from computeBooks. SQL-seeded harnesses (empty ledger) fall back automatically, so
f123-balance-sheet-cash (13/0) and verify-f137-balance-sheet-report (6/0) stay green unchanged.
`verify-gl-bs-readswap.js` (15/0): real cash 800 with A = L + E when reconciled; cash null + AR-only on a
broken ledger; consolidated fallback; live endpoint parity. NEXT 5b: the dashboard `GET /api/reports` read,
then migrate report/accountant harnesses to assert GL as the source where appropriate.
