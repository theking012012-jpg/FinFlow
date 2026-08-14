# FinFlow — Full Verified Audit Prompt

Paste the block below into a fresh Cowork session with this folder connected. It front-loads the
environment quirks and the in-progress harness-seed-debt work so the session doesn't rediscover them.

---

```
Run a full, execution-verified audit of the FinFlow repo (this connected folder), per
VERIFICATION.md and CLAUDE.md Rule 14 — verify by RUNNING harnesses against real
Postgres, not by reading. Read CLAUDE.md fully first. HOLD before any commit; I run
commits myself in PowerShell.

ENVIRONMENT (learned the hard way — don't rediscover):
- The folder is a OneDrive FUSE mount. Bash CANNOT exec binaries, unlink, or run git
  writes there, and the repo's node_modules PG binaries are cloud-only. So: stage a
  LOCAL ext4 copy in the sandbox — tar the source (exclude node_modules/.git/.fuse*)
  into ~/ff-verify, then `npm install` fresh there so embedded-postgres unpacks a
  runnable linux-x64 binary. Copy current source files from the mount into the sandbox
  before each run.
- Harnesses run with: node -r ./tests/harness/clock.js tests/harness/<file>.js
  (a few also need -r /tmp/pg-shim.cjs). Each boots its own Postgres (~15-40s).
- The bash tool caps at ~180s regardless of requested timeout — run in batches of
  ~4-6 files with a per-file `timeout 80`, accumulate results to a file.

DO THIS:
1. Authoritative sweep = the step-gates (they run VERIFICATION.md Part A/B: 108 figures
   + 22 actions): step1-gate, step2-gate, step3-gate, step4-client-gate. Report pass/fail.
   (Baseline last session: 150/0, with 7 Part-B BLOCKED by clock-drift = F110/F111 debt.)
2. Run the 87 verify-*.js regression harnesses in batches. For every non-green, DIAGNOSE
   whether it's a real product defect or harness test-debt — do not just report the count.
3. Known harness test-debt to FIX (F139-style, mechanical): 17 harnesses seed constrained
   tables (invoices, expenses, bills, sales_receipts, credit_notes, vendor_credits,
   journals, chart_of_accounts, customers, inventory, items, quotes, vendors, recurring_*,
   payments_*) with entity_id=NULL, which the F150 constraint chk_<table>_entity_nn now
   rejects → FATAL. Two fix shapes:
     (a) Direct c.query seeds → create an entity (is_active:1) after the users insert and
         re-point the NULL entity_id to it. Verified-green last session: verify-c1-chart-of-accounts,
         verify-c1-inventory-movements, verify-c1-invoice-payments, verify-f101-batch-match,
         verify-f33c-payroll-buckets, verify-f140-accountant-fyear.
     (b) jsdom SPA seeds (bootSpaInJsdom seedExtra(c,uid)) rely on NULL rows being universally
         visible → keep the NULL seed but drop chk_*_entity_nn at seed time (it's NOT VALID;
         product tolerates legacy NULLs; runtime SPA writes still get entity-stamped by the
         server). Verified-green last session: verify-f72-payables. Still to do:
         verify-f119-partial-remaining, verify-f127-mrr-chart, verify-f137-balance-sheet-report,
         verify-f137-cashflow-ar-ap-reports, verify-f137-sales-payroll-reports,
         verify-f137-tax-reports, verify-f84-savepaymentmade-billid, and the intentional-legacy
         ones verify-f26-receipt-entity-scoping, verify-f135-backfill-bills, verify-f92-recalc-audit.
   Re-run every fixed harness to green.
4. Any REAL product defect found: reproduce it fail-then-pass with a discriminating seed
   (Rule 4/14), fix the root, enumerate the class (Rule 13), re-verify. (Precedent this pass:
   credit_notes + vendor_credits token-less dedup pre-checks were scoped to null while their
   INSERT stores req.entityId since F148 → duplicate rows under an active entity. Both fixed.
   Sweep ALL findRecentDuplicate call sites for the same null-vs-req.entityId mismatch.)
5. Deliver: a written AUDIT_<date>.md (gates result, regression results, defects found+fixed
   with harness evidence, remaining test-debt), plus per-change diffs and commit commands.
   HOLD — do not commit. Note that editing the OneDrive files may show whole-file CRLF churn
   in git diff; it normalizes to LF on `git add`, so committed diffs stay small.
```

---

## Quick status carried over (2026-08-13)

- **Already shipped & pushed** (do not redo): F154/F155 investments fixes; F117 client `withSubmitGuard`
  + FX handlers + bank-reconciliation/match idempotency; credit_notes + vendor_credits dedup fix;
  `AUDIT_2026-08-13.md`.
- **Authoritative gate sweep:** 150/0 green (7 Part-B BLOCKED by clock-drift, not failures).
- **Harness seed-debt:** 7 of 17 fixed & verified green last session (listed above); 10 remain
  (7 SPA + 3 legacy). This work was staged in the sandbox only — the repo working tree is clean,
  nothing half-applied landed.
- **Standing test-infra debt (not launch blockers):** F110/F111 clock re-pin (unblocks 7 Part-B
  checks); F83 harnesses hang/exit-0 on error.
