# Session handover — 2026-08-05

**You are a fresh Claude Code session on a different account. You have no memory of prior work.
Read this, then read `CLAUDE.md`, then the relevant `AUDIT_MASTER.md` entries and `WORK_PLAN.md`
BEFORE touching anything. The ledger is the memory — not this file alone.**

---

## Where the repo stands (all committed AND pushed to `origin/main`)

Working tree is clean except recurring OneDrive EOL noise (CRLF flips on already-committed files —
content-identical to HEAD; ignore them, they don't go with a push). `origin/main` = `e58c96a`.

Shipped, verified, live this cycle:
- **F117** — invoice double-submit. Durable partial-unique idempotency index + 23505 recover +
  token-aware 5s-precheck bypass (server) and a per-intent client token + in-flight lock. Verified
  by harness (12/12 + 7/7 control), a jsdom client test (8/8), an independent re-run on a separate
  Postgres, AND a live production same-token replay (two POSTs → one row). The one pre-existing
  production duplicate (saige ids 8 & 9) was cleaned by the owner in Supabase. **DONE.**
- **F134** — fresh login/register 401'd every `/api` read until a manual refresh: session set but
  never `save()`d before responding, so the async Postgres store wasn't durable when the client's
  immediate GETs arrived. Fix: a shared `saveSession(req)` awaited before the response on all three
  session-establishing routes (login, register, team-accept). Verified fail-then-pass (deterministic,
  via a delayed store-set + a header-early client). Team-accept is verified-by-reading, not executed.
  **DONE.**
- **F133** — invoices created/edited with `status='paid'` never got `amount_paid`, so they badged
  "paid" but counted $0 in Collected and full in Outstanding (regression from F56). Fix: POST sets
  `amount_paid = amount` when status is paid; PUT does so guarded (only when no `invoice_payments`).
  Owner ran the oracle himself → `ALL GREEN, 8 passed`. **DONE.**

Logged, still OPEN:
- **F132** 🟠 (launch-blocker) — the expired-trial paywall is escapable: Upgrade removes the gate and
  navigation re-renders empty cached arrays → the F130 "$0 broken app" returns. **Needs an OWNER
  DECISION before any fix: read-only past expiry vs hard-lock vs grace period.** Do not build it
  until the owner rules.
- **F135** 🟡 — bills created with `status='paid'` never get `amount_paid` (symmetric AP mirror of
  F133); no boot-backfill for bills. Its own future oracle/commit.

---

## YOUR TASK: F84 — read-only first, HOLD before any code

**This is a money path. `CLAUDE.md` Rules 1, 4, 6, 13, 14 all apply. Do NOT write code until the
owner approves the proposal and the oracle numbers.**

**Root (already established, confirm it yourself):** a bill paid via the *Payments-Made form*
double-counts. The **server already handles `bill_id` correctly** — `POST /api/payments-made` links
it and calls `recalcBillStatus` (server.js ~2352), and `computeBooks`/reports exclude bill-linked
payments from expense via the `p.bill_id == null` filter (server.js:3445, mirrored ~4310). The gap
is **client-only**: `savePaymentMade` (`public/finflow-api-wiring-pages.js:828`) omits `bill_id` and
the Make Payment modal has no bill field — while the Bills-page "Pay" path (`markBillPaid`, pages.js
~741) *does* send it. Instance-fixed there, class-missed on the Payments-Made form. F84 is UI +
request-shape, **no server compute change**.

1. **Investigate read-only.** Confirm the above from source. Confirm runtime winners (Rule 1 — the
   client wiring files are concatenated into `finflow-bundle.js`, which loads AFTER `app-main.js`, so
   a `window.NAME=` in a later-loading wiring file wins; never edit `public/finflow-bundle.js`
   directly — the F13 pre-commit hook regenerates it from the wiring sources). Enumerate the class
   (Rule 13): the partial-pay-from-Bills path and any edit path.
2. **Propose, then HOLD.** Add a bill selector to the Make Payment modal so `savePaymentMade` sends
   `bill_id`. Oracle (Rules 4/6/14 — owner confirms the numbers): seed a bill issued/expensed at
   **$1,300**, record a **$500** payment against it *with `bill_id` set* → expected **opex $1,300**
   (unchanged — the bill was expensed at issue) and **AP outstanding $800**; the discriminating
   negative is today's unlinked path → **opex $1,800** (the double-count). Seed values distinct so a
   green test names its source.
3. **Verify by execution (Rule 14)** once approved — build a fail-then-pass harness test on real
   scratch Postgres (see `tests/harness/verify-c1-invoice-pilot.js` / `verify-f133-paid-on-create.js`
   as templates). Run it against current code (must FAIL) then the fix (must PASS).
4. **One money fix per commit. Do NOT commit or push.** Paste the enumeration, the proposed diff, and
   the oracle plan for the owner's review, then HOLD. The owner approves each step and does ALL pushes
   (main auto-deploys to Railway — nothing ships on your say-so).

---

## After F84 — SEPARATE sessions, do NOT bundle (they share no root; all are money changes)

- **C1 idempotency rollout** — the ~31 `findRecentDuplicate` routes each need the durable
  idempotency token + the F131 token-aware precheck bypass, **one verified commit per route**.
  Natural-key Wave-1 (holdings, autocat_rules, team_members, chart_of_accounts, fx_rates,
  budget_targets) is gated on `tests/harness/c1-dup-precheck.js` returning CLEAN first (Rule 8). This
  is a multi-session marathon, not one sitting.
- **F58 phase-2** — credit notes reduce AR, vendor credits reduce AP, netted per-customer, floored
  at 0. Its own oracle. (Netting ruled per-customer already.)
- **F132 owner decision** still pending before that fix can start.

---

## Environment / git notes (this machine)

- Repo: `C:\Users\theki\OneDrive\Desktop\finflow-FINAL7 (4)`. If this is a fresh checkout, run
  `npm install` before running any harness test.
- **Clear `.git/*.lock` before git ops** — OneDrive freezes it (`Remove-Item ".git\*.lock" -Force`).
  Be the sole git actor; don't let VS Code's Source Control auto-fetch in parallel.
- If `git commit` complains about identity: `git config user.email "theking012012@gmail.com"` and
  `git config user.name "theking012012-jpg"` (matches existing history).
- Run a harness test locally with: `node -r ./tests/harness/clock.js tests/harness/verify-<name>.js`
  — it boots a throwaway embedded Postgres (does NOT touch Supabase/production) and prints a
  pass/fail tally. The owner confirmed this works on this machine.
- **Never test against production. Never push without explicit owner approval.**
