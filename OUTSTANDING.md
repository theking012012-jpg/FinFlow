# FinFlow — Outstanding Work (session handoff)

Last updated: 2026-08-13. Mirror of the Progress task list. **No open money bugs, no launch blockers** per the 2026-08-09 reconciliation in `AUDIT_MASTER.md`. Full detail for each item lives in `AUDIT_MASTER.md` under its finding number.

**Just shipped this session (done):** C3 client record-date fix (local dates, execution-verified), F152 (charts now run — `loadChartJS` wrap), F153 (charts now show data — single-writer `_setMonthlyArrays`). All committed + pushed (`0363e5f`).

---

## Priority order

### 1. Ready to ship — one approval away
- [ ] **F139 — commit verified tax-worksheet fix.** Client Income-Tax worksheet vs accountant Tax Summary computed tax on different revenue+deduction legs. Fix written + executed fail-then-pass on real scratch Postgres; HELD awaiting owner approval to commit. Highest leverage.

### 2. Root architecture
- [ ] **F88 / C3-server — entity-timezone recognition (+F85 carry-period).** Roots the C3 server half. Genuine timestamps (run_date=NOW()) and any server date default must resolve against the ENTITY timezone, not UTC/created_at; better, events carry their intended period explicitly (F85). Do NOT add a created_at fallback to receipts — breaks the F34 recognition==filter invariant (Rule 6). Client C3 half already shipped+verified.

### 3. Duplicate-submit rollout (post-launch; server already backstops money)
- [ ] **C1/F117 — durable dup-submit rollout.** DB idempotency shipped for payroll_runs + invoice_payments. Roll the same pattern (ALTER ADD idempotency_key + unique idx + 23505 recovery) across the remaining ~29–31 create routes, plus client per-modal token. Per-table plan drafted in the C1 block.
- [ ] **Client double-submit guard helper.** 88 POST sites, 9 guarded. Add one shared `withSubmitGuard(btn, fn)` rather than 88 hand-edits.

### 4. Owner decisions (nothing broken — current behaviour silently becomes the decision)
- [ ] **F128 — revive dead-shadowed report bodies?** P&L / Balance Sheet (incl F123 cash line) / Cash Flow never render; live copy shows one generic card set. Must NOT edit the shadowed copy (F75/Rule 1). Money figure already correct.
- [ ] **F94 — scheduled-doc UI (design call).** Blocked on F88 (period resolution).
- [ ] **F86 / D1 scope / F90.** F86: "Payments Received" = invoice_payments (settlements) or the payments_received table? (blocks A7.4 / cash-in). D1: which taxes a combined figure covers (corp tax, VAT, PAYE, NIS). F90: audit trail required before launch, as rated?
- [ ] **F110/F111 — harness re-pin strategy.** 4 options (advance pin+seed in lockstep · seed relative to pin · freeze DB clock · fail drift loudly). Test-debt.

### 5. Display / FX polish (medium; only affects display currency ≠ entity currency)
- [ ] **F126 — FX-convert MRR/ARR + Scenario planner.** F124 made these honest, not converted — the tick is not coverage.
- [ ] **F125 — sweep let-bindings reached via window.** Chart render itself now closed (F152/F153). "Done when": no code reads `window.<name>` for a binding app-main declares with let/const; every chart dataset has one writer. F153's `_setMonthlyArrays` is the model pattern.
- [ ] **F129 + F64 — display polish.** Cosmetic.

### 6. The real "done" gate
- [ ] **Full VERIFICATION.md re-sweep.** Run EVERY check on real seeded data (run all → freeze failure list → fix → re-run all). This — not the AUDIT_MASTER ledger — is what establishes correctness. Do before launch sign-off.

### 7. Deferred / accepted (no launch blockers)
- [ ] **F54 / F107 / F108** (team/multi-tenant), **F92** (structural dead-shadow elimination), **F19** (DB TLS, verified, deferred), **F109** (close-position feature, owner-gated), **F83** (harness exits 0 even on failure — CI hazard).

---

## Standing constraints (from CLAUDE.md — read it fully first)
- Owner runs ALL git commits/pushes in PowerShell; assistant cannot commit (OneDrive `.git/index.lock`).
- Edit wiring SOURCES, never `public/finflow-bundle.js` (F13 hook regenerates it).
- Money paths verified by EXECUTION with discriminating seeds + reproducing negative controls (Rule 4/14).
- Data changes owner-gated and always a separate commit (Rule 8).
- Never fabricate; build read-only instruments (Rule 7). Enumerate the class, not the instance (Rule 13).
- Find the runtime winner before editing a client function — dead-code shadowing (Rule 1). Grep references too, not just `name(` calls (F152/F153 lesson).
