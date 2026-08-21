# FinFlow — Outstanding Work (session handoff)

---

## ⭐ CURRENT — remaining after the 2026-08-21 audit + fix sessions

**Shipped & verified this pass (all committed/pushed):** F186 (dashboard Net used all-time COGS at boot →
period-scoped), F187 (draft invoice showing in the tx feed → filtered), M1 (connector key decoupled from
`SESSION_SECRET`), L1 (session regen), L2 (hashed reset tokens), L4 (`/api/ai` scope), L8 (cron compare),
L6 (fonts→Jost), M2 (4 flaky client harnesses stabilised), M3 (`npm audit fix`), plus the VERIFICATION.md
cell closure (A1–A6, B2, B5.1/B5.3). **Money engine 150/0 gates, full sweep 140/140 GREEN, 0 open money bugs.**

> Nothing below is an open money bug or a core-product launch blocker.

### A. Real work remaining — each its own scoped pass, NOT a batch edit
1. **L3 — CSP `script-src 'unsafe-inline'` removal.** The app has **623 inline event handlers** (466 in
   index.html); CSP nonces don't cover inline handlers, and adding a nonce disables `'unsafe-inline'`, which
   would freeze the app. Requires migrating all 623 handlers to `addEventListener`, page by page. Or accept
   `'unsafe-inline'` (rest of the CSP is already tight). Evidence: `PARTB_L3_L5_2026-08-21.md`.
2. **L5 / F92 — dead shadowed app-main functions removal.** A batch removal of the 15 confirmed replacements
   was ATTEMPTED and REVERTED — it broke `c6-hdrain` + `f132-readonly` even after AST-precise analysis (the
   functions have non-obvious boot-timing coupling). Must be done **one function at a time, each re-verified
   against the full suite**. Zero functional benefit (runtime already correct); pure maintainability.

### B. Needs your keys (post-launch; code built + verified to the network boundary)
3. **8 connectors** — Belvo, Finch, Codat, Paystack, Flutterwave, dLocal, Mercado Pago, Wise. Each needs
   live keys + one sandbox transaction. (Plaid, Stripe, WiPay already live-verified.)

### C. Needs an owner decision (code isn't blocked — the ruling is)
4. **F128** — revive the 3 dead-shadowed report bodies (P&L / Balance Sheet / Cash Flow), or keep the
   generic card set? Money figures already correct.
5. **F94** — scheduled-document UI design.
6. **D1** — which taxes a combined tax figure covers (corp tax / VAT / PAYE / NIS).
7. **F86** — "Payments Received" source: `invoice_payments` (settlements) vs the `payments_received` table.

### D. Verification gaps (low-risk; optional to close)
8. **L4 (`/api/ai` scope) + L8 (cron compare)** — shipped and READ-verified, but not execution-verified (no
   AI/cron harness exists). Two small probes would put them on the permanent list.

### E. Never tested — NOT broken, just unverified (Appendix A)
9. Mobile / responsive device testing · PDF / CSV exports · live AI (`ANTHROPIC_API_KEY`) · transactional
   email (`RESEND_API_KEY`) · performance/scale (the payroll-runs `LIMIT 50` client cap).

### F. Test-infra debt (harmless)
10. Occasional `c6-hdrain` jsdom flake under max full-sweep load (passes standalone) · F110/F111 clock re-pin
    (a few Part-B checks not fully automated) · a couple of harnesses too slow for the sandbox cap.

### G. Post-launch batches (from WORK_PLAN.md)
11. **F54** team/multi-tenant scoping · **C2 / C5 / C6** input-hygiene sweeps.

**Done this pass (was remaining):** the `CONNECTOR_ENC_KEY` Railway step (M1) · Part B cells B5.1/B5.3 · the
full VERIFICATION.md A1–A6 / B2 / B5 cell closure · F186 + F187 render bugs.

---

Last updated: 2026-08-13 (below). Mirror of the Progress task list. **No open money bugs, no launch blockers** per the 2026-08-09 reconciliation in `AUDIT_MASTER.md`. Full detail for each item lives in `AUDIT_MASTER.md` under its finding number.

**Just shipped this session (done):** C3 client record-date fix (local dates, execution-verified), F152 (charts now run — `loadChartJS` wrap), F153 (charts now show data — single-writer `_setMonthlyArrays`). All committed + pushed (`0363e5f`). F151f (quick tab-switch no longer force-reloads → no data blink) committed + pushed (`4e6de6b`).

---

## Priority order

### 1. Ready to ship — one approval away
- [x] **F139 — tax-worksheet single-source. ALREADY DONE (committed `bc8cd70`).** Client Income-Tax worksheet and accountant Tax Summary now read one `computeBooks` deductible leg. Re-verified GREEN on real scratch Postgres 2026-08-13: client taxable === accountant taxable === 12000, deductible 2000 includes the 100/50 variants, client revenue is accrual 14000 (not cash 4000). The prior "HELD awaiting commit" note was stale. **Harness caveat:** `verify-f139-tax-consistency.js` had to be updated to run — its seed inserted `entity_id=NULL`, which the F150 constraint (`chk_*_entity_nn`, added afterward) now rejects (code 23514); the seed now creates one active entity and stamps it. That harness-seed fix is the only F139 item left, and it's test-debt, not a money fix.

### 2. Root architecture
- [ ] **F88 / C3-server — entity-timezone recognition (+F85 carry-period).** Roots the C3 server half. Genuine timestamps (run_date=NOW()) and any server date default must resolve against the ENTITY timezone, not UTC/created_at; better, events carry their intended period explicitly (F85). Do NOT add a created_at fallback to receipts — breaks the F34 recognition==filter invariant (Rule 6). Client C3 half already shipped+verified.

### 3. Duplicate-submit rollout (money paths DONE 2026-08-13; only non-money routes remain)
- [x] **Client double-submit guard helper — DONE (`26c395e`, 2026-08-13).** Shared `withSubmitGuard(btn, fn, opts)` added (`app-main.js`): re-entry refused in-flight, always re-enables in `finally`, label restore. Adopted in the 2 money-adjacent handlers that lacked a lock (`addFXRate`/`addFXTransaction`). The 13 money-mutating handlers already had `if(window._savingXxx)return` re-entry locks ("C1 Wave 1b") — the old "88 sites / 9 guarded" note was stale. Verified: `verify-f117-client-submit-guard.js` 18/18, fail-then-pass. Did NOT churn the 13 already-locked handlers (no-op rename = risk without benefit near launch).
- [x] **Bank-rec match idempotency — DONE (`d2fe703`, 2026-08-13).** Legacy `POST /api/bank-reconciliation/match` (no client caller) hardened with natural-key SELECT-before-INSERT, mirroring `/match-batch`. No migration. Verified: `verify-f117-bankrec-match-idempotent.js` 5/5, double-POST → 1 link (unfixed → 2).
- [ ] **C1/F117 — remaining server token rollout: NON-MONEY routes only.** 2026-08-13 audit of all 63 POST routes: every money route is covered (idempotency_key or heuristic + client lock); `/match-batch`, `/inventory/:id/restock`, `/fx-transactions/:id/settle` confirmed already idempotent (not gaps). Only non-money routes still lack a durable key — `stripe/webhook` (should key off Stripe event id), `team/accept` (gated, F54), `ai` (ai_cache), `accountant-messages`, `connections` (audit_trail). None create a financial duplicate. Low priority, post-launch. Detail in the C1 block of `AUDIT_MASTER.md`.

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

## Working-tree hygiene (2026-08-13)
- ⚠ **Stale `public/finflow-bundle.js` on disk.** OneDrive reverted the working-tree bundle to an OLDER copy — it is MISSING the C3/F37, F152, and F153 changes that ARE correct in the committed HEAD bundle. Git shows it as modified. Do NOT commit it. Restore with `git checkout -- public/finflow-bundle.js` (or regenerate via `node bundle.js`). Committed HEAD and production (Railway deploys from git) are unaffected.
- `tests/harness/clock.js` and `tests/harness/seedData.js` show as modified but are byte-identical to HEAD (line-ending/mtime noise) — safe to `git checkout` / ignore.

## Standing constraints (from CLAUDE.md — read it fully first)
- Owner runs ALL git commits/pushes in PowerShell; assistant cannot commit (OneDrive `.git/index.lock`).
- Edit wiring SOURCES, never `public/finflow-bundle.js` (F13 hook regenerates it).
- Money paths verified by EXECUTION with discriminating seeds + reproducing negative controls (Rule 4/14).
- Data changes owner-gated and always a separate commit (Rule 8).
- Never fabricate; build read-only instruments (Rule 7). Enumerate the class, not the instance (Rule 13).
- Find the runtime winner before editing a client function — dead-code shadowing (Rule 1). Grep references too, not just `name(` calls (F152/F153 lesson).
