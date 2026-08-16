# FinFlow — session handover (for the next Claude)

**Written:** 2026-08-14 · **Repo state:** `main` at commit `62137cc`, clean, everything pushed.
**You are picking up a single-founder SaaS build.** The owner (Shaq, Trinidad) plans/approves; you write code.

---

## 0. READ THESE FIRST, IN ORDER
1. **`CLAUDE.md`** — the project's 3 defining failures + 14 non-negotiable rules. It **OVERRIDES your defaults**. Every rule exists because breaking it caused a real production bug. Do not skim.
2. **`AUDIT_MASTER.md`** — the findings ledger (F1…F179). Your work this session is F156–F179 near the top.
3. **`VERIFICATION_INTEGRATIONS.md`** — per-connector status + the exact live-key steps to close each gap.
4. **`VERIFICATION.md`** — the finite list that defines "done" for money figures.

---

## 1. HARD WORKFLOW RULES (do not violate)
- **HOLD before every commit.** NEVER run `git commit`/`git push` yourself. Do the work, then give the owner **exact PowerShell commands** to run. They commit from `C:\Users\theki\OneDrive\Desktop\finflow-FINAL7 (4)`.
- **Scratch Postgres only, never production.** Tests use a real embedded Postgres.
- **Edit wiring sources, NEVER `public/finflow-bundle.js`.** The F13 pre-commit hook regenerates the bundle from the 10 `public/finflow-api-wiring-*.js` files. `index.html` and `accountant-client.html` ship **directly** (not bundle sources).
- **Rule 1 (shadowing):** before editing any client function, find the runtime winner. `grep "window.NAME *=" public/finflow-api-wiring-*.js` — if a wiring file assigns `window.NAME`, that wins over `app-main.js`'s copy (unless it saves `_origNAME`). Editing the shadowed copy = clean diff, zero effect. This has burned people repeatedly.
- **Money changes = one fix per commit.** Never fold two money changes into one commit.
- **Never fabricate.** If you can't reach data, build a read-only instrument and say so. Report evidence (actual diffs/queries/test output), not conclusions.

---

## 2. HOW TO RUN & VERIFY (the harness setup)
- **Sandbox:** there is an ext4 working copy at `~/ff-verify` in the bash VM (the OneDrive mount is slow/cloud-synced). Workflow: edit files in the mount via Read/Write/Edit tools → `cp` the changed file into `~/ff-verify/...` → run the harness there.
- **Run a harness:** `cd ~/ff-verify && node -r ./tests/harness/clock.js tests/harness/verify-XXX.js`
- **Clock is pinned** to `2026-07-25T12:00:00-04:00` (America/Port_of_Spain) via `clock.js`. Network is **blocked** in-sandbox (that's why live provider calls can't run — they 502, which the tests assert as "dispatch reached").
- **Each harness boots its own Postgres (~20s).** The bash tool caps at **~180s per call** — batch ~6–7 harnesses per call. `boot.js` + `HarnessHttp` (`httpClient.js`) are the plumbing.
- **Webhook tests need Stripe keys:** set `process.env.HARNESS_KEEP_STRIPE = '1'` before `bootServer` (boot.js scrubs Stripe env otherwise). Sign synthetic events with the real `stripe` SDK / `crypto.createHmac`.
- **Full suite** = ~141 harnesses. Money core = the 4 `step*-gate` files + all `verify-c1-*`. Reports = `verify-f137*`. Everything is green as of `62137cc`.

---

## 3. WHAT WAS BUILT THIS SESSION (F156–F179)
Started as an execution-verified audit, became a full **integrations + payments + banking layer**. All committed, all execution-verified except live provider round-trips.

**Audit/fixes:** F156/F157 (accountant journal entity, no-entity 400), F110/F83/D2/A9/A8c/FX, F88, RBAC audit, F54 (team data-scope → `scopeId`), F111 (access-visibility), F158 (accountant view/filing grant), F159 (**real bug**: `nextRunDate` used timezone-dependent instant math — Rule 10; fixed across server + 2 client mirrors), onboarding (F165), color (F163).

**Integrations (11 connectors, all owner-only, env-gated, encrypted at rest AES-256-GCM):**
- Data: **Plaid** (F164, banking), **Belvo** (F168, LatAm banking), **Finch** (F166, payroll), **Codat** (F166, accounting), **Wise** (F169/F174, multi-currency).
- Payments: **Stripe Connect** (F167), **Paystack/Flutterwave/dLocal/Mercado Pago** (F169 generic credential connectors + F174 pay-link builders), **WiPay** (F168, Caribbean).
- Catalogue: honest "Connect" (built) vs "Request" (records demand, F170); "755" stat card fixed to "In directory" vs "Live connections" (F167).

**Payments loop (ALL 4 processors reconcile — signed, idempotent, single-writer, balance-capped, forgery-rejecting):**
- Invoice **pay-link** generation (F170) + "Pay link ↗" button on invoices (F172).
- Webhook reconciliation: **Stripe** (F171), **Paystack** HMAC-SHA512 (F172), **Flutterwave** verif-hash (F173), **WiPay** md5 callback (F175). All route through **one** money writer `recordExternalInvoicePayment` → `invoice_payments` + `recalcInvoiceStatus`.
- **End-to-end proof** (F177): `verify-e2e-payment-flow.js` — invoice → AR=500 in real report → pay-link → signed webhook → reconcile → AR=0.

**Banking for any bank incl. local Caribbean (F178):** `POST /api/banking/import` — OFX/QFX + CSV statement import, idempotent (FITID / content hash), "⬆ Import" button. Verified server 16/0 + client 8/0.

**Housekeeping (F179):** `.gitattributes` (`* text=auto eol=lf`) killed the OneDrive CRLF churn; refreshed 3 stale probes (f123/f128/f130) to green.

---

## 4. HARD-WON GOTCHAS (will save you hours)
- **OneDrive CRLF lag** (now mostly fixed by `.gitattributes`): historically the mount flipped LF↔CRLF and **dropped a real one-line change from a commit twice**. If `git status` shows a file `M` you didn't expect, run `git diff --stat` — equal-thousands +/- = churn (safe); a small mixed diff = **real, do not discard**. NEVER blindly `git checkout` a file. After editing via tools, `grep -c $'\r' file` and `sed -i 's/\r$//'` if needed.
- **Resolver is `/api`-scoped:** `app.use('/api', …)` sets `req.accountId`/`req.accountRole`. Any route OUTSIDE `/api` has neither → `requirePerm` fails closed (403s the owner) and `scopeId` is undefined. Webhook callbacks (Finch/Stripe) MUST live under `/api/...`. (Caught: `/finch/callback` → `/api/finch/callback`.)
- **`wrap` is a `const`** (~server.js:443). The early webhooks registered before it (before `express.json`, for raw body) must use **bare `async (req,res)=>{}` + try/catch**, not `wrap(...)` (temporal-dead-zone ReferenceError). (Caught: WiPay callback.)
- **`invoice_payments` is a TYPED table** (real columns), NOT JSONB. Query `idempotency_key`, not `data->>'idempotency_key'`. Most other tables (invoices, personal_transactions, user_settings…) ARE JSONB (`data->>'field'`).
- **Payment money rule:** creating a pay-link never marks anything paid; only a **signature-verified** webhook does, through the single writer, idempotent on the processor's event id (`idx_invoice_payments_idem_key`), capped to the balance. Sync endpoints are **display-only** — they do NOT auto-write the books (Rules 2 & 12).
- **WiPay hash** = `md5(transaction_id + ORIGINAL_total(2dp) + api_key)`, no separators — reverse-engineered & confirmed against WiPay's own doc example (sandbox key `123`).
- **Rule 5 fragile probes:** `f128`/`f130`/etc. use source-extraction + hand DOM stubs. Don't keep patching them; the real figures are verified by `verify-f137*` (real endpoints). f128 was rewritten to a structural invariant this session.

---

## 5. THE ONE OPEN GAP + NEXT STEPS
**Gap:** every connector's *live provider network call* is UNEXECUTED — the sandbox blocks outbound HTTP; it needs the owner's API keys in Railway. Everything up to that boundary (our code, signature checks, money writes) IS verified. `VERIFICATION_INTEGRATIONS.md` has the exact keys + steps per provider.

**Highest-value next moves (owner-directed):**
1. **Close a live leg.** Owner adds Stripe **test-mode** keys (they already have `STRIPE_SECRET_KEY`; needs `STRIPE_CONNECT_CLIENT_ID`) or Plaid **sandbox** (free) or WiPay (sandbox key `123`) to Railway → then verify a real round-trip against the deployed app (Chrome browser tools) or a live harness.
2. **UI polish:** wire "Sync" buttons for **Codat** and **Wise** (endpoints exist — `/api/codat/sync`, `/api/wise/sync` — but no client button yet); a column-mapping step for messy CSVs; PDF statement import (harder).
3. **Env-gated surfaces still live-unexecuted:** AI categorization (`ANTHROPIC_API_KEY`), transactional email (`RESEND_API_KEY`), mobile/perf — see `AUDIT_2026-08-14_launch-surfaces.md`.
4. **Slow harnesses** (`c2-runtime-dialog-scan`, `boot-failures-gate`) exceed the 180s cap — shard them if you need them in CI (F162).

---

## 6. WHERE THINGS LIVE
- Server: `server.js` (Express + Postgres). Integration routes are grouped (Plaid ~4200, Finch/Codat/Stripe ~4480, Belvo/WiPay ~4650, generic credential connectors, payment-link + webhooks near the top for raw-body ones). Money writer `recordExternalInvoicePayment` sits just above `recalcInvoiceStatus`.
- Client: `public/index.html` (ships directly — connector helpers `ffLinkBank/ffConnectProvider/ffConnectCreds/ffLinkBelvo/ffConnectWiPay/ffInvoicePaymentLink/ffImportStatement`, onboarding, catalogue). Invoice "Pay link" button is in `public/finflow-api-wiring-medium.js` (`renderInvoices`, the runtime winner).
- Tests: `tests/harness/verify-*.js`. New this session: `verify-plaid-linking`, `verify-finch-codat-linking` (covers 6 connectors + syncs), `verify-requests-paylinks`, `verify-webhook-reconcile`, `verify-paystack-webhook`, `verify-flutterwave-webhook`, `verify-wipay-reconcile`, `verify-invoice-paylink-button`, `verify-e2e-payment-flow`, `verify-bank-import`, `verify-bank-import-client`, `verify-auth-flow`, `verify-export-csv`, `verify-recurring-scheduler`, `verify-recurring-nextrun-tz`.
- Deploy: Railway, auto-deploys from `main`.

**Owner's style:** enthusiastic, says "keep going / lets go bro." Wants things *actually verified* ("legit and working") — always give the honest execution-verified vs inspection-only breakdown, and flag what needs their keys. They commit in PowerShell and paste the output back; watch for skipped/mis-ordered commits (the CRLF lag caused a couple).
