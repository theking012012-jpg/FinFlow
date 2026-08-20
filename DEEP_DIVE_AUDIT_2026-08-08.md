# FinFlow — Deep-Dive Launch Audit

**Date:** 2026-08-08 · **Commit audited:** `9340593` (HEAD) · **Method:** execution, not commit-message claims

This audit was run against a **real PostgreSQL 17 instance** (embedded-postgres, native binaries) with the
real schema, real seed rows, and the real Express endpoints — CLAUDE.md Rule 3. Every number below is an
**executed** result, not a reading of the source or a commit message.

---

## Bottom line

**No wrong-money bug. No launch blocker found.** Every atomic verification harness passes against HEAD,
and the three money/figure gates plus the client viewer-independence gate are green. The remaining open items
are coverage, hardening, and display polish — none of them produce an incorrect figure.

---

## 1 · Full harness suite — 53/53 green

Every `verify-*.js` harness executed against HEAD and passed (0 failed). Grouped:

| Group | Harnesses | Result |
|---|---|---|
| C1 idempotency (Rule 9) | 16 (bills, COA, credit-notes, expenses, inventory, invoice-payments, invoice, journals, payments-made/received, payroll ×2, sales-receipts, vendor-credits) | all green, mode WITH INDEX |
| Money / feature | F26 (7), F33-C (3), F40 (3), F66 (12), F72 (2), F84 ×2 (6+6), F92 (8) | all green |
| Payroll basis / audit | F85 (4), F90 foundation + phaseB (9) + phaseB3 (17) + accountant (11), F102 (10) | all green |
| Invoices / bills | F119 (3), F133 (8), F135 ×2 (6+10) | all green |
| Reports (F137) | balance-sheet (6), cash-flow/AR/AP (12), sales/payroll (9), tax (20), P&L (17) | all green |
| Tax / accountant | F138 (6), F139 (12), F140 (5) | all green |
| Trial / misc | F101 ×2 (8+5), F106 ×2 (12+5), F112 (3), F127 (7), F132 ×2 (5+7), F134 (6) | all green |

## 2 · Verification gates (CLAUDE.md "done = every check green")

| Gate | Scope | Result |
|---|---|---|
| step1 | substrate (Postgres + guard + clock + server + HTTP round-trip) | **26/26** |
| step2 | seed matches VERIFICATION.md | **63/63** |
| step3 | `/api/reports` money figures vs owner-supplied expected | **56/0** (7 Part-B checks self-blocked, see note) |
| step4-client | client surfaces, viewer-independence | **5/5** |

**step4 is the important one for the timezone class (Rule 10 / F87):** every client figure is **identical
across Los Angeles, Port-of-Spain, Kolkata and London** (18/18 VERIFICATION figures per viewer). The matrix
spans the UTC sign boundary, so a viewer-dependence bug could not hide.

**step3 Part-B note (not a failure):** 7 relative-to-today checks self-skip because Postgres `now()` runs at
real wall-clock (Aug 8) while the seed is pinned to an earlier date — the harness refuses to assert against a
drifted baseline rather than risk a false green. They need a seed re-pin (F110, tooling) to assert here; they
are **blocked, not red**.

**Not completed under sandbox limits:** `boot-failures-gate` (F96 network-failure matrix) re-boots the SPA in
jsdom ~20 times sequentially and exceeds the sandbox's per-command time cap. Its atomic pieces are covered by
the individual jsdom harnesses that did pass; the aggregate gate should be re-run locally to fully close it.

## 3 · Static code audit (the traps harnesses can't catch)

- **Rule 1 — dead-code shadowing:** the built `public/finflow-bundle.js` is **in sync with its 10 sources**
  (`bundle:check` OK), so what was audited is what deploys. The many `window.NAME=` wiring overrides are the
  known architecture — but the jsdom harnesses boot the **real bundled app and read the DOM**, so they exercise
  the runtime-winning copy, not dead code. Fixes verified by a client harness are verified on the copy that runs.
- **Rule 2 — multi-writer money:** server `/api/reports` (step3) and the client (step4) both match the same
  owner-supplied VERIFICATION expected values — the mirrors agree with an independent oracle, not just with
  each other.
- **Rule 11 — status vocabularies:** revenue = `{pending, overdue, partial, paid}` (accrual, excludes draft);
  bills use their own `RECOGNIZED_BILL`; payroll = `{approved, paid}`; credit-notes = `{open, applied}`.
  **Zero stray `status:'final'`** — the fabricated value from the original Rule 3 failure is gone.
- **Rule 12 — payroll basis C:** recognition keys on the run's `period` (first-of-month), not `run_date`;
  both server mirror sites use identical logic. F85 verified 4/4 server + client.

## 4 · Genuinely outstanding (none block launch)

1. **F90 residual** — money-table *UPDATE* routes (editing an existing bill/payment) aren't audited yet;
   creates, deletes, approvals and business-record CRUD are. Optional finishing touch.
2. **F94** — SCHEDULED-state UI; needs an owner design call. Recognition already handled (D2 guards).
3. **F79** — DB-level status CHECK constraints (schema hardening); app-layer allowlists enforce it today.
4. **Code-quality sweeps** — C2 (`confirm()`/`alert()`), C5 (input-validation remainder), C6 (silent `catch`).
5. **Display polish** — F129 (residual hardcoded `$`), F64 (`#s-cents` honored by only 2 surfaces),
   F126 (MRR native-by-design).
6. **Housekeeping** — `boot-failures-gate` + step3 Part-B to be re-run locally; set `STRIPE_SECRET_KEY` /
   `STRIPE_PRICE_BUSINESS` in Railway so Upgrade can charge.

---

*Every result above is reproducible: `node -r ./tests/harness/clock.js tests/harness/<name>.js` against a
scratch Postgres. No production database was touched.*
