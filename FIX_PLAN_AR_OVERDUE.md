# Fix plan — "Overdue" diverges from the server (credit-note netting + clamp) across surfaces

**Written:** 2026-10-07 (live audit of dab2) · **Branch:** `dash-je-fix` · **For:** Claude Code to verify + fix.
**Class:** Rule 2 / Rule 13 — a money figure (AR overdue/outstanding) computed differently on N surfaces.
This is the SAME class as the dashboard<->journal fix (470dce2) and L3/L5/L6 in LAUNCH_EXECUTION_PLAN.md.
**NOT yet in the Findings Ledger as of 952ab19** — assign it the next free L-number when you log it.

> **ALL harness and sweep runs happen in PowerShell on the owner's machine — never the cloud container.**
> Write the harness, hand the owner the exact `node -r ./tests/harness/clock.js tests/harness/<FILE>.js`
> command and the full-sweep command; the owner runs them (3x for the sweep) and pastes results back.

## The finding (live evidence, dab2, 2026-10-07)
Overdue shows **$14,300** while the server says **$13,050**, and $14,300 **exceeds Outstanding ($13,550)** —
impossible (the 5 overdue invoices are a subset of the 6 outstanding). The $1,250 gap is the one open credit note.

| Surface | Shows | Correct (server) |
|---|---|---|
| Dashboard Outstanding card sub-line (`d-outstanding-chg`) | `5 overdue . $14,300.00` | $13,050 |
| Invoices page Overdue card (`inv-over`) | `$14,300.00` | $13,050 |
| Reminders Outstanding (`rem-out`) | `$14,300.00` | $13,550 (outstanding, netted) |
| Accountant portal Overdue (`s-overdue`/`inv-overdue`/`overdue-banner`) | status-based, GROSS amount | $13,050 |
| `/api/reports.overdue` / `.outstanding` (server) | **13,050 / 13,550** (correct) | - |

Hand-check: 5 past-due invoices, Σ balance = 14,300; one open credit note 1,250; 14,300 - 1,250 = 13,050.

## Canonical formula (server is correct — mirror it)
- `server.js:6364`: `overdue = Math.min(outstanding, Math.max(0, round(_overdueGross - (books.arCreditContra||0))))` — nets contra AND clamps <= outstanding.
- `server.js:10968`: `arSummary.overdueTotal = Math.max(0, Math.min(outstanding, _arOverdueTotal - _arCreditContra))`.
- Overdue basis = unpaid BALANCE (`amount - amount_paid`), recognized statuses, past-due in entity-local today OR literal `overdue` status (F-C1). NOT `status==='overdue'` alone; NOT gross `amount`.

## Three roots (confirm each; Rule 1 runtime-winner; Rule 14 execute the failure)
**Root 1 — client `arOutstanding()` (app-main.js ~2199-2229):** nets contra from `total` but returns
`overdueTotal` UN-netted/UN-clamped (comment literally: "Overdue is invoice-only"). Fix: after `_cnTotal`,
`overdueTotal = Math.max(0, Math.min(total, overdueTotal - _cnTotal))`. One edit fixes every main-app consumer:
dashboard `finflow-api-wiring-dashboard.js:189`, invoices tile `finflow-api-wiring-extra.js:819`,
payments-received `finflow-api-wiring-pages.js:316`, stat writer `finflow-api-wiring-postgres.js:337` /
`app-main.js:2686`. Confirm no `window._arOutstanding=` override, then `node bundle.js && node bundle.js --check`.
**Root 2 — reminders `rem-out` (index.html:10941 `setText('rem-out', money(s.total_outstanding))`):**
`s.total_outstanding` is un-netted; trace its source and net the same contra so reminders shows $13,550.
**Root 3 — accountant portal (accountant-client.html ~1001-1025):** `invoices.filter(i=>i.status==='overdue')`
summing GROSS `amount` — three bugs (literal status, gross not balance, no CN netting). Replace with the
canonical AR overdue computation (prefer a shared helper / server `arSummary` over a 4th copy). Ships direct, not bundled.

## Verification (discriminating — Rule 4 — run in PowerShell)
New `tests/harness/verify-ar-overdue-netting.js` (real embedded PG, real endpoints): seed >=2 past-due invoices
with a PARTIAL payment (balance != amount) + one open credit note, sized so raw != netted != gross (all three
distinct, so each root's bug changes the number; state the buggy values). Assert server `overdue <= outstanding`
and `== min(outstanding, overdueGross - cnContra)`; assert client `arOutstanding().overdueTotal == server overdue`
and `<= total`; assert reminders + accountant portal equal the netted figures. **Prove RED on pre-fix first.**
Then money gates green + full sweep 3x green in PowerShell. Re-verify live on dab2 after deploy: every surface
shows the netted figure and `overdue <= outstanding`.

## Operating rules (LAUNCH_EXECUTION_PLAN.md §0)
One money fix per commit (Root 1 / Root 2 / Root 3 = separate commits, each with its harness assertion). Edit
wiring sources, never `finflow-bundle.js`; regen the bundle. Commit on `dash-je-fix`; do NOT push/merge to `main`
(owner does the final push). Log as the next `L<n>` in the Findings Ledger + append to the Progress Log.
