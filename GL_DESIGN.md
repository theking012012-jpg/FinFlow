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
- **Phase 4** — **backfill** (⛔ OWNER-GATED, Rule 8, its own commit): replay historical source docs through
  the posting engine to build opening balances; reconcile GL to computeBooks for all history. No source
  table is mutated. NOT STARTED — needs owner go-ahead (it writes real books).
- **Phase 5** — flip source of truth to the GL (⛔ OWNER-GATED): keep `computeBooks` as a **continuous
  cross-check** (a live "books balanced ✓" signal — a marketable trust indicator). NOT STARTED — this is
  the user-facing go-live and must not happen without explicit owner approval; the dual-write shadow keeps
  the GL fully proven until then.

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
