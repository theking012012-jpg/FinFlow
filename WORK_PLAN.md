# FinFlow — Work Plan (reconciled 2026-08-03)

The rule of thumb: **one themed batch per session** — fix → verify → commit → push → review-layer re-verify.
Never bundle multiple batches into one prompt. Supersedes the stale `OPEN_WORK_2026-08-01.md`.

---

## Rules of engagement (how work is grouped and run)

1. **One batch per session.** A batch is a set of findings sharing one root, in overlapping files. Two batches in one session = interleaved edits in shared files (`app-main.js`, `server.js`, wiring) = the F124/F130 reconstruction mess. Don't.
2. **Decisions before code.** A decision-gated batch does not start until the ruling is made (see §Decisions).
3. **One fix per commit for money changes** — so a bad money change reverts alone. Display/UX fixes may share a commit.
4. **Every money change re-derives the oracle** — seed rows + `expected.js` + `VERIFICATION.md` in lockstep, failure path executed (Rule 14).
5. **Sole git actor.** Only Code runs git; never a second terminal in parallel. Clear `.git/index.lock` (OneDrive freezes it) before committing; exclude the repo from OneDrive to stop it recurring.
6. **HOLD → review-layer re-verifies → push.** Nothing pushes on Code's say-so alone.

---

## GROUPABLE — do each as its own session

### Batch 1 · Honesty pass  🚩 LAUNCH-GATING · no decision · no money math
- **F51** — placeholder surfaces presented as live features
- **F65** — ~8 buttons that toast success with no backend; the "750+ integrations" banner
- Scope: labelling + button/section removal. Cleanest single prompt.

### Batch 2 · Double-count / double-submit (C1 class) · no decision
- **F84** — bill paid via the *Payments Made form* double-counts (Bills "Pay" path already fixed)
- **F117** — duplicate invoice via double-submit
- (+ the broader C1 ~29-route dedupe rollout)
- Shared root: durable idempotency (unique constraint / idempotency key), not per-button guards.

### Batch 3 · Charts & Reports  ⚠ needs F125 single-writer decision first
- **F125** — `window.charts` unreachable; FX overlay never runs (2 fixed, 5 dead sites)
- **F126** — MRR/ARR + Scenario never FX-converted
- **F127** — `_mrrChartData` has no writer → MRR chart is a flat-zero line
- **F128-remainder** — 3 dead report bodies; every report renders one generic card set
- **F33-C** — overview chart's expense series excludes payroll + COGS
- **F129** — residual hardcoded-`$` surfaces
- Shared code area; they touch each other.

### Batch 4 · Audit trail / write-path · POST-LAUNCH
- **F90** 🔴 — no audit trail (table empty by construction)
- **F92** — money fields mutated as side-effects of other routes
- Shared root: one logged write path a new route can't bypass. (Owner: sequencing — pre-launch or not.)

### Batch 5 · Timezone record-dates (C3 class) · top week-1 support risk
- 35 UTC-stamp server sites (record `created_at`/date defaults)
- **F40**, **F47** — cash-flow date fields
- **F116** — `_serverToday` primed only on session-restore, not fresh login
- One systematic sweep; string-date discipline (the F87 fix, applied to writes).

### Batch 6 · AP/AR outstanding correctness  ⚠ money + oracle change (netting ruled: per-customer)
- **F58 phase 2** — credit notes reduce AR, vendor credits reduce AP, netted per-customer, floored at 0
- **F72** — AP overstated for partially-paid bills
- Both touch payables/receivables outstanding. Full seed/verify loop.

### Batch 7 · Team / multi-tenant access · POST-LAUNCH
- **F54** — team-member scope incoherent (or disable invites for launch, 30 min)
- **F107 + F111** — a login can't see which accounts it can access (owner-axis vs member-axis)
- **F108** — entities have no jurisdiction attribute (enables the `(name, jurisdiction)` key)

### Batch 8 · Input-hygiene sweeps · POST-LAUNCH
- **C2** — 68 native `confirm()`/`alert()` sites
- **C5 + F66** — unvalidated inputs (17 sites; JSONB writes)
- **C6** — 45 silent `catch(e){}`
- Non-money code quality.

---

## SEPARATE — each needs its own pass

| Finding | Why it stands alone |
|---|---|
| **F85** | payroll recognised on `run_date`, not the period it's *for* — recognition-event ruling + oracle change |
| **F94** | no scheduled state (D2 prerequisite) — own recognition + UI work |
| **F79** | DB status CHECK constraints — schema migration |
| **F106** | void/delete a payroll run — design decision |
| **F76** | tax-filing endpoint stale — tied to the D1 tax-scope decision |
| **F75** | fixes applied to shadowed dead functions — systemic discipline, not one edit |
| **F119** | Record Payment mapper drops `amount_paid` — isolated money fix |
| **F26** | receipts entity-scoping — careful data-scope change |
| **F101** | bank-rec batch endpoint — API design |
| **F105** | ledger reconciliation check — process/tooling |
| **F110** | harness re-pin strategy — test tooling |
| **F63** | `bootDashboardWiring` re-wrap — small perf |
| **LOW grab-bag** | F32-residual, F44, F45, F69, F73, F30, F52, F68, F83, F109, F112 — opportunistic |

---

## Owner decisions that unblock work (make these, then the batch can run)

- **F130** — trial: hard-lock vs read-only past expiry (a `checkPlan` server change)
- **F123** — what the balance-sheet cash line becomes once a real cash account exists
- **F76 / D1** — which taxes a combined tax figure covers
- **F125** — the overview chart's single-writer question (blocks Batch 3's 5 dead sites)
- **F85** — the payroll recognition event
- **F58-p2** — netting = per-customer, floored at 0 *(already ruled)*

---

## Recommended sequence

1. **Batch 1** (F51+F65) — clears launch.
2. **Batch 2** (F84+F117) — one root, no decision.
3. **Batch 5** (C3 dates) — week-1 support risk.
4. Rule on F125 / F85 / F58-p2 → **Batch 3**, **Batch 6**, then the recognition standalones (F85, F94).
5. Post-launch: **Batch 4**, **Batch 7**, **Batch 8**, the LOW grab-bag.

Also outstanding, not a batch: **run the Supabase `UPDATE` to clear your own expired trial** (you stay locked out until you do).

---

## Caveat — the ledger titles lie

`AUDIT_MASTER.md` finding *titles* are a lossy index; many say "NEW" but shipped (F64, F58, F87, F95, F96–F100, F78, F80, F102, and today's F57/F120/F122/F123/F124/F128/F130). Real status is each finding's *body*. Before starting any SEPARATE-pile item, re-check its body — some may already be done. A 10-minute body-status reconciliation at the top of a session is worth it before committing to work.

---

## Recovered 2026-08-08

This file was recreated from context after an accidental `git clean -fd` removed the untracked
copy. Content restored to the reconciled 2026-08-03 state (the version in use through this session).
**Commit or `.gitignore` this file** so it can't be lost to `git clean` again. Note that much of the
plan has since progressed — Batch 1 (F51/F65), Batch 2 (F84/F117 + the C1 rollout), F85, F26, F72,
F33-C, F106, F119, F132 and more have shipped; do a fresh body-status reconciliation before relying
on the batch statuses above.
