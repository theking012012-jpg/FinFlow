# Launch-surface closeout — 2026-08-14

Purpose: drive to green (or explicitly document) the app surfaces that `VERIFICATION.md` never
covered — the "Appendix A: UNVERIFIED" surfaces that are not money figures but ship on day one.
Everything here is either **execution-verified** (a harness that boots real Postgres / the real
page) or **explicitly documented as unexecutable in the sandbox**, with the reason. Nothing is
marked "correct" by reasoning alone (Rule 14).

---

## 1. Surfaces now execution-verified

| Surface | Harness | Result | What it proves |
|---|---|---|---|
| Auth: register / login / logout / session / password reset | `verify-auth-flow.js` | **24/0** | Real server + real Postgres session store. Duplicate-email 409, weak-pw 400, wrong-pw 401, no-enumeration on forgot-password, single-use + expiry on reset tokens. |
| CSV export | `verify-export-csv.js` | **7/0** | Real `window.exportAllCSV` in jsdom, Blob captured: correct header + rows, and RFC-style quoting (a comma or quote in a field cannot corrupt a column). Exports are **client-side** — there is no server export endpoint. |
| Recurring invoice/bill scheduler | `verify-recurring-scheduler.js` | **29/0** | Real exported `runRecurringScheduler()` against real Postgres: DUE template fires exactly once and advances `next_run`; NOT-due untouched; `end_date` completes after one fire; re-run is idempotent (no duplicate). Surfaced **F159** (below). |
| Recurrence date is timezone-free | `verify-recurring-nextrun-tz.js` | **3 zones / 0 fail** | Executes the actual shipped source of all three copies (server `nextRunDate` + client `_txNextRun` + client `_billNextRun`) under UTC-4, UTC+9, UTC and asserts they agree with the hand-derived calendar answer. |

New server test hooks (no prod behaviour change): `module.exports.runRecurringScheduler`,
`module.exports.nextRunDate`.

---

## 2. Defect found & root-fixed during this pass

**F159 (HIGH) — recurring scheduler advanced `next_run` with timezone-dependent instant math.**
`nextRunDate` parsed a date-only string to UTC midnight then advanced with local-time `setMonth`,
so west of UTC a 1st-of-month date rolled back a day (`2026-07-01 → 2026-07-31`;
`2026-12-01 → 2026-12-31`, losing the year). Rule 10 to the letter. The helper had **three copies**
(server + two client mirrors that compute the initial `next_run` in the viewer's browser); all three
carried the bug and all three are fixed with integer Y/M/D + UTC-only math (which also clamps
month-overflow: `Jan 31 +1mo → Feb 28`, not a March spill). Full detail + evidence in
`AUDIT_MASTER.md#F159`. **FIX HELD — candidate for its own commit.**

---

## 3. Surfaces that CANNOT be executed in the sandbox (documented, not verified)

These depend on external services or a real device/network and have no offline path. Each degrades
safely today; the note is what the owner must check live before relying on it.

**Stripe billing** (`STRIPE_SECRET_KEY` unset ⇒ `stripe = null`, server.js:33-35). Checkout
(`/api/billing/checkout`), the webhook (`/api/stripe/webhook`), and price lookup
(`STRIPE_PRICE_BUSINESS/PRO`) are all env-gated; checkout returns a clean 500 with the missing-var
name when unconfigured (server.js:456). **Live check needed:** a real test-mode checkout + webhook
round-trip on Railway with keys set.

**AI expense categorization** (`ANTHROPIC_API_KEY`). Returns a clean **502** with an actionable
message when the key is unset (server.js:2148, 3358) — it does not crash or fabricate. **Live check
needed:** categorization quality/latency with a real key.

**Transactional email** (`RESEND_API_KEY`, server.js:21-23). Password-reset and team-invite emails
are sent via Resend; unset ⇒ no send. The reset/invite **flows themselves are verified** (tokens are
created, stored, consumed correctly) — only the email delivery leg is env-gated. **Live check
needed:** an actual reset + invite email arrives and its link resolves.

**Mobile layout & performance.** Not meaningfully testable headless. **Live check needed:** the SPA
on a real phone viewport, and page-load/interaction latency against a production-sized dataset.

---

## 4. Additional findings logged this pass

- **F160 (MEDIUM, security)** — password-reset tokens are stored **in plaintext** at rest
  (`password_resets.data.token`), whereas team-invite tokens are stored **sha256-hashed**
  (`invite_token_hash`). Inconsistent handling of the same class of secret; a DB read or backup
  leak exposes live reset tokens directly. FIX HELD (own commit — a security change).
- **F161 (LOW, test-infra)** — `f123-balance-sheet-cash.js` step 4 is a **structural** assertion
  expecting exactly 1 client fetch of `/api/reports/balance-sheet` in `app-main.js`; the current
  count is 0 (the fetch lives in shadowed/removed code, F128). The assertion's expected count has
  drifted. Not a product defect — a stale structural check to refresh.
- **F162 (LOW, test-infra)** — `boot-failures-gate.js` boots a full jsdom SPA per failure scenario,
  so a full run exceeds the 120s tool cap and cannot complete in one CI slice. Split it, or raise
  the per-slice budget. Not a product defect — a runner-budget issue.

---

## 5. Color scheme + onboarding (done)

- **Color scheme (F163):** one real theme bug fixed (tax-line inputs used a non-existent `--bg`
  token → black inputs in light theme; now `--bg2`, theme-adapting). Residual dead-fallback
  mismatches catalogued for an optional owner sweep. Chart/canvas colors correctly hardcoded.
- **Onboarding (F165):** the fake "Connected ✓" buttons are gone; the wizard now shows once per
  device (localStorage, not sessionStorage). The **bank** button links for real (F164).
- **Real bank linking (F164):** genuine Plaid Link, env-gated (clean 502 until `PLAID_CLIENT_ID`/
  `PLAID_SECRET` set), tokens AES-256-GCM encrypted at rest, transactions sync into the books.
  Verified 21/0 for every path reachable without a Plaid account; the live handshake is UNEXECUTED
  pending free Plaid sandbox keys.
