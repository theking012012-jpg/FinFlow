# GL Consolidation & Multi-Currency — Design Spec (aim: beyond the industry leaders)

Status: SHIPPED 2026-09-25. Built to this spec; all slices A-E landed, harness-verified. This is the plan for the last and highest-value
piece of the ledger: consolidated, multi-currency financial statements read from the GL — done to a
standard that beats NetSuite OneWorld / Sage Intacct, not just matches QuickBooks/Xero.

## 0. Where we are (grounding facts)
- Every report read is already ledger-sourced for a SINGLE entity in its NATIVE currency, reconcile-gated
  with `computeBooks` as oracle fallback (Phase 5b: glProfitLoss / glBalanceSheet / dashboard).
- Two cases still fall back to computeBooks on every request: (a) consolidated (`entity_id=all`),
  (b) display-currency / FX. Removing these is the goal.
- FX infra present: `fx_rates` (per-user rate store), `pickRate(rows, from, to, date)` (carry-forward,
  missing→null), `latestFxRates`, realized + unrealized handling, a 7000 FX Gain/Loss account.
- IMPORTANT: `ledger_lines.debit_base/credit_base` are currently IDENTITY (= native). The ledger is
  CURRENCY-PURE (each entity's lines are in its own currency). computeBooks already converts ON READ for
  consolidation (F24: base = users.data.base_currency, else first entity's currency, else USD).
- DECISION: consolidation converts ON READ (keep the ledger currency-pure), mirroring computeBooks' F24,
  and reusing fx_rates/pickRate. We do NOT store a group-base amount at post time (a group base can change;
  native reporting must stay exact). This also means no backfill/migration to start.

## 1. What the leaders do (baseline to beat)
- The GL is the single source of truth for ALL reports; no parallel engine (we converge to this; the
  computeBooks fallback is a migration net, the end-state is GL-only).
- Multi-entity consolidation is the SMB-vs-midmarket line. QBO/Xero = one org per entity + 3rd-party
  consolidation. NetSuite OneWorld / Sage Intacct = real-time consolidated financials, the flagship.
- Foreign-entity translation follows ASC 830 / IAS 21:
  - Income statement at the PERIOD AVERAGE rate.
  - Balance sheet (assets/liabilities) at the CLOSING (period-end) rate.
  - Equity at HISTORICAL rate.
  - The residual balancing figure is the Cumulative Translation Adjustment (CTA), carried in equity.
- Intercompany eliminations: intercompany AR/AP and intercompany revenue/expense are removed on
  consolidation so the group isn't inflated by trading with itself.

## 2. What "better than the leader" means for FinFlow (the differentiators)
1. PROVABLE consolidation. Extend the existing "certified books" trust signal to the group: a consolidated
   trial balance that ties to zero, A=L+E after CTA, and every consolidated figure traceable to its source
   entities. Leaders give you the number; we give the number + a RED-provable audit that it's right.
2. HONEST FX coverage. Never silently use a stale/missing rate. Every consolidated response carries a
   coverage flag (which entity/period/rate pairs are missing) — reusing the fxCoverage pattern. If any
   required rate is missing, that leg/entity is flagged and the view falls back rather than mislead.
3. Reconcile-gated safety. Consolidated reads serve from the GL only when they reconcile to computeBooks
   (the oracle) to the cent; else fall back. The user never sees a wrong consolidated number — a safety
   net the leaders do not have.
4. Real-time, no "close" required; one plan, unlimited entities (already the model — a pricing edge).
5. Transparent CTA. Show the CTA as an explicit, explained line (rates used, per-entity contribution),
   not a black-box plug.

## 3. Architecture
`glConsolidated(userId, { entityIds, baseCurrency, period, fyStartIdx, monthIdx })` — pure reader:
- For each entity: pull its native per-account period + as-of balances (the existing glFinancials query,
  generalised to accept an entity list / loop).
- Translate per ASC 830: income/expense accounts at the period AVERAGE rate (entityCurrency→baseCurrency),
  asset/liability at the CLOSING rate, equity at historical (approx: opening/first-seen rate; v1 may use
  closing for posted equity + track CTA as the plug — see risks).
- CTA = the figure that makes translated assets == translated (liabilities + equity + retained earnings).
  Post it to a dedicated equity sub-account presentation line (3200 Cumulative Translation Adjustment) —
  presentation-only in the reader, not a stored posting.
- Intercompany elimination pass (slice D): detect intercompany docs (a sale from entity A to entity B,
  same owner) and remove the matched AR/AP + revenue/expense before totalling.
- Return the same shape as glFinancials (accounts, trialBalance, incomeStatement, balanceSheet) PLUS
  `cta`, `perEntity[]`, `fxCoverage`, so the report helpers (glProfitLoss/glBalanceSheet) can consume it.
- Gate: reconcile the consolidated result to `computeBooks(userId, null, ...)` (which already consolidates
  on read) to the cent; serve GL when it matches AND all rates present AND trial balance ties; else oracle.

New COA account: `3200 Cumulative Translation Adjustment` (equity). Add to DEFAULT_COA +
ensureLedgerAccountsForEntity (additive; existing entities get it lazily).

## 4. Phased slices (each its own commit + harness; every one reconcile-gated with oracle fallback)
- Slice A — single-entity DISPLAY currency from the GL. Translate one entity's GL to a requested display
  currency at per-leg rates (P&L avg, BS closing). Removes the FX fallback for the single-entity case.
  Harness: gl display == computeBooks display to the cent; missing rate → fallback.
- Slice B — consolidated SAME base currency (all entities already share the base). Pure summation across
  entities, no translation. Removes the consolidated fallback for same-currency groups. Harness: 2-entity
  same-currency group; consolidated gl == computeBooks(null); trial balance ties.
- Slice C — consolidated MULTI-currency with ASC 830 + CTA (the hard part). Average-rate P&L, closing-rate
  BS, CTA plug in equity; A=L+E after CTA. Harness: 2 entities in different currencies with a known rate
  set → assert the exact translated totals + CTA by hand-computed oracle; missing rate → coverage flag +
  fallback.
- Slice D — intercompany elimination. Detect + eliminate intercompany AR/AP + revenue/expense; show the
  elimination column. Harness: A invoices B; consolidated revenue/AR exclude the intercompany amount.
- Slice E — consolidated certification + coverage surface. Extend the accountant "certified books" block
  and the reports `source`/coverage to the group; RED-provable. Harness: break one entity's ledger →
  consolidated certified=false; missing rate → coverage=false + honest fallback.

## 5. Non-negotiables (map to CLAUDE.md + GL_DESIGN)
- computeBooks stays the oracle until the consolidated GL matches it to the cent (Rule 6/14).
- Never show a wrong consolidated/translated number: reconcile-gate + fallback + coverage flags.
- Dates are calendar strings; rates resolve at the correct calendar date (avg = period, closing = as-of).
- No destructive posting; CTA is a presentation figure in the reader (revisit if we later post it).
- Each slice: real-PG harness, RED-provable, discriminating seed, owner-oracle (hand-computed FX).

## 6. Risks
- ASC 830 equity-at-historical is the subtle bit: true historical rate needs per-equity-event dating.
  v1 approximation (posted equity at closing + CTA absorbs the difference) is defensible and testable;
  document it and refine. Getting this wrong = misleading consolidated equity, so it is harness-pinned
  against a hand-computed oracle, and falls back on any mismatch.
- Rate coverage: real accounts will have gaps. Coverage flags + fallback prevent silent mis-translation.
- Performance: consolidating N entities loops N glFinancials reads; acceptable for typical N (<20), and
  the dashboard consolidated loop already fetches per-entity. Revisit with a single grouped query if N is large.

## 7. What this unlocks
NetSuite/Intacct-class real-time multi-entity consolidation with ASC 830 translation — plus provable
certification, honest FX coverage, and reconcile-gated safety the incumbents don't offer. This is the
feature that lets FinFlow legitimately claim "better than the big competitors" for multi-entity, multi-
currency businesses — the last major piece of roadmap #2's ledger.


## 8. SHIPPED (2026-09-25)
`glConsolidated(userId, {entityId?, display?, period, ...})` implements the plan:
- PRIMARY view: per-line conversion at each line's entry-date rate to base (matches computeBooks F24), so
  it RECONCILES to the cent and the base trial balance ties (no CTA on the precise view). Handles single
  entity + display currency (slice A), same-currency consolidation (slice B), and multi-currency (slice C).
- SUPPLEMENTARY: ASC 830 view (income at period AVG rate, balance sheet at CLOSING rate) with `cta` =
  residual. Verified against a hand-computed 2-entity, 2-rate oracle (CTA = 120).
- Intercompany DETECTION (slice D): sales/bills whose counterparty name matches another owned entity are
  detected and exposed as an `eliminated` group P&L view, WITHOUT silently altering the reconciled/certified
  primary totals (reliable auto-elimination needs an explicit counterparty link — data-model follow-up).
- FX COVERAGE: any missing rate flags `fxCoverage.complete=false` and forces oracle fallback — never a
  silent mis-translation.
- Wiring: glProfitLoss + glBalanceSheet serve consolidated/display from glConsolidated, reconcile-gated with
  computeBooks as oracle fallback; POST /api/reports/profit-loss, /balance-sheet and GET /api/reports all
  benefit. glReconcile(userId, null) certifies the CONSOLIDATED books (slice E), RED-provable. The Reports
  balance sheet renders a CTA row when present.
- Harnesses: verify-gl-consolidation (13/0), verify-gl-intercompany (8/0); the four Phase 5b read-swap
  harnesses migrated to assert consolidated now serves from the ledger. Full report/GL/FX/accountant
  regression green.
- FOLLOW-UPS (documented, not blocking): true GAAP historical-rate equity + auto-elimination via an explicit
  intercompany counterparty field; P&L UI surfacing of the eliminated/intercompany figures (API exposes them).
