# New-session prompt — F128, D1, F86

Paste the block below into a fresh Cowork session with the `finflow-FINAL7` folder connected.

---

```
Work through three owner-decision items in the FinFlow repo (this connected folder): F128, D1, F86.
Read CLAUDE.md FULLY first — it overrides your defaults; every rule exists because breaking it caused
a real production bug. These three are DECISION-GATED: for each, INVESTIGATE and report the current
state with file:line evidence, SURFACE the decision with 2–3 concrete options + a recommendation, and
WAIT for my ruling before writing code. Then implement the ruling, EXECUTION-verify it (not by reading),
update VERIFICATION.md, and HOLD — I run all git commits myself in PowerShell.

━━━ ENVIRONMENT (learned the hard way — don't rediscover) ━━━
- The folder is a OneDrive FUSE mount; the device's local Linux VM (device_bash) may be down, and the
  repo's node_modules PG binaries are cloud-synced/not runnable there. So work in the CLOUD container:
  stage the source in (device_stage_files), copy to an ext4 dir, `npm install` fresh so
  embedded-postgres unpacks a runnable linux-x64 binary.
- CRITICAL harness gotcha: embedded-postgres drops privileges to the `postgres` system user to run
  initdb (Postgres refuses to run as root). So the working copy must live OUTSIDE /root (e.g. /srv/ffv,
  chmod 755 so it's traversable), be chown'd to postgres, and the PG binaries need +x after staging
  (chmod -R +x node_modules/@embedded-postgres/linux-x64/native/bin). Run every harness AS postgres:
    runuser -u postgres -- env SESSION_SECRET=test HOME=/srv/ffv bash -c \
      'cd /srv/ffv && node -r ./tests/harness/clock.js tests/harness/<FILE>.js'
- Authoritative money gates (VERIFICATION.md Part A/B): step1-gate, step2-gate, step3-gate,
  step4-client-gate — baseline 150/0. Full regression: `node tests/harness/run-verification-sweep.js`
  (~140 harnesses, ~10 min, sequential; each boots its own Postgres). Clock is pinned 2026-07-25.
- Client jsdom harnesses: poll for window.<fn> to be defined AND settle for boot DATA before the first
  driven action (fixed-settle races the async bundle and flakes). One bootServer per PROCESS
  (server.js has a module-global pool — a 2nd in-process boot collides).
- index.html ships app-main.js DIRECTLY + finflow-bundle.js (a concat of the 10 finflow-api-wiring-*.js
  sources). EDIT WIRING SOURCES, never the bundle; regenerate with `node bundle.js`. The F13 pre-commit
  hook does `bundle.js --from-index`. Rule 1 (dead-code shadowing): before editing any client function,
  find the runtime winner — `window.NAME =` in a wiring file WINS over app-main's copy unless the
  override captures the prior value (a wrapper). Editing the dead copy = clean diff, zero effect.

━━━ WORKFLOW (non-negotiable) ━━━
read-only investigate → report evidence → SURFACE DECISION → (my ruling) → diff → EXECUTE the failure
path (Rule 14) → HOLD → I commit. One fix per commit for money changes. A money figure lives on N
surfaces (Rule 2) — fix all or log the rest with numbers. Never fabricate; build a read-only instrument
if you can't reach data (Rule 7). "Done" = the relevant VERIFICATION.md checks green on real seeded data.

━━━ THE THREE ITEMS ━━━

▸ F128 — Financial-statement report bodies (P&L / Balance Sheet / Cash Flow).
  CONTEXT + LIKELY-STALE: OUTSTANDING lists this as "revive the 3 dead-shadowed report bodies (they
  never render; live copy shows one generic card set)." BUT the 2026-08-20 session handover says F128
  is ALREADY DONE — the reports render rich, canonical-sourced, print-ready via window.generateReport
  (the F137-a…k series), verified GREEN (P&L 17/17, Balance Sheet 6/6, Cash Flow+AR+AP 12/12 in the
  verify-f137* harnesses). FIRST TASK: reconcile the ledger vs reality — RUN the verify-f137* harnesses
  and open the Reports page path in jsdom to confirm what actually renders today. If the reports render
  correctly via generateReport, F128 is effectively RESOLVED and the only residue is the dead-shadowed
  bodies in app-main (that's L5/F92 dead-code territory — do NOT bulk-remove; a batch removal was tried
  and reverted because the "dead" functions have non-obvious boot-timing coupling). Report the true
  state and let me decide: (a) close F128 as done, (b) remove the specific dead bodies incrementally
  (one at a time, each re-verified full-suite), or (c) there's a real rendering gap to fix.

▸ D1 — tax figure scope.
  CONTEXT: tax PAID has no source of any kind (VERIFICATION.md Appendix C.2 — no tax_payments table,
  not in the 35-table TABLES array, not even an expense category; GET /api/tax-filing returns no ytdPaid
  field). The prior fabricated `ytdPaid = liability × 0.75` was REMOVED (PL#11). The tax RATE is now
  owner-supplied and DONE (commit 55f07d0). The OPEN decision: corp tax, VAT, PAYE and NIS are separate
  obligations on different periods — should there be ONE combined "tax" figure, or split by type, and
  does the app track tax PAYMENTS at all? Investigate what tax surfaces exist today (the Income Tax
  Estimate worksheet, the accountant Tax Summary, GET /api/tax-filing) and SURFACE options: (a) keep
  "Not tracked" for paid tax (current honest state), (b) add a typed tax-payments table for specific
  taxes, (c) split the estimate by tax type. Recommend one. Any schema change is owner-gated and its
  OWN commit (Rule 8). Whatever ships must never display a computed/estimated tax-PAID number without a
  real source (decision D1).

▸ F86 — "Payments Received" source of truth.
  CONTEXT: the "Payments Received" figure can come from two stores — invoice_payments (invoice
  settlements) OR the payments_received table — and they may not agree. This blocks VERIFICATION.md A7.4
  (Payments Received = 1,500) and the cash-in leg. FIRST TASK: enumerate BOTH tables (schema + how each
  is written) and build a read-only instrument showing what each yields for the seed, then SURFACE the
  decision: which is canonical for "Payments Received"? Recommend one (note the seed expects 1,500 =
  invoice_payments settlements). Then, per Rule 2, apply the chosen source to EVERY surface that shows
  Payments Received (the page, the dashboard cash-in, /api/reports cash-flow, the accountant portal) —
  fix all or log the rest with numbers — and make A7.4 a green, executed check.

━━━ DELIVER ━━━
For each: the current-state evidence, the decision options + your ruling, the diff, the execution proof
(harness output, fail→pass, Rule-14 control where a value is involved), an updated VERIFICATION.md
row/Appendix note, and exact PowerShell commit commands. HOLD — do not commit. Update OUTSTANDING.md to
move each item from "needs a decision" to done (or record the ruling). Reference docs: CLAUDE.md,
VERIFICATION.md, OUTSTANDING.md (current top section), PARTB_L3_L5_2026-08-21.md, and AUDIT_MASTER.md
(F86/F128/D1 finding bodies — remember the ledger titles can be stale; trust the body + the code).
```

---

## Quick status carried over (2026-08-21)
- Money engine: **150/0 gates, full sweep 140/140 GREEN, 0 open money bugs.** All prior fixes committed+pushed.
- F128 is **probably already resolved** via `generateReport`/F137 — verify before doing work.
- D1: tax rate is owner-supplied + done; the open part is the *scope* decision + whether paid-tax is tracked.
- F86: pick the canonical Payments-Received store, then apply across all surfaces (Rule 2) and green A7.4.
- All three are DECISION-GATED — surface options and get the ruling before writing code.
