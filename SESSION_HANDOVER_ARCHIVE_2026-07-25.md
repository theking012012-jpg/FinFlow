# SESSION HANDOVER — FinFlow · F87 period-resolution batch (2026-07-25)

Paste this as the opening briefing for the next session.

---

## Roles & discipline
- **Review/planning/decision layer** = the assistant. **"Claude Code" (VS Code)** writes all code. **SHLLC / "big bro"** relays between them via paste/screenshots.
- Repo is **public**: `github.com/theking012012-jpg/FinFlow`. Read it — but **verify from the local checkout, NOT `raw.githubusercontent`** (it serves stale CDN content), and use `git -c core.autocrlf=true` for real diffs (the sandbox shows phantom CRLF churn = **F43**; don't raise EOL diffs as findings).
- **Never commit or push without big bro's explicit say-so. One Code prompt per turn.** Code HOLDS commits for diff review before anything lands.
- **OneDrive git-lock hazard:** sandbox git writes leave `.git/index.lock` that OneDrive freezes and blocks the next git op — prefer letting Code (VS Code) do git; clear a stuck lock with `cmd /c del /f /q ".git\index.lock"`.
- Binding rules live in `CLAUDE.md` / `REVIEW_RULES.md`. Correctness is defined by `VERIFICATION.md`, not by noticing things.

## ⇢ CURRENT STATUS (updated 2026-07-30) — READ THIS FIRST
- **F87 Phase A (server wiring) + Phase B (client wiring) + AP-D2 are DONE and HELD (nothing committed).** The "NEXT ACTION — send Code the wiring prompt" section below is now HISTORY — the prompt was sent and executed.
- **Code reported all four gates green:** step2 63/0 · step3 32/1 (only A7.4 red — the pre-existing Group-3 `GET /api/invoice-payments` 400, unrelated) · step4 viewer-independent 18/18 · tz-matrix all identical. Residual grep clean on recognition legs.
- **Verified this session (from source, bash was down):** AP-D2 exclusion is genuinely on the balance-sheet AP leg (server.js:3476-3479, mirrors AR); and the **structural residual grep passed independently** — zero live recognition-leg carriers un-routed; only OUT-of-scope hits (token-expiry, recurring `next_run`, label formatters, personal-finance `_pers*`, investments rolling chart) + one dead residual (`calcMTD`, 0 callers → deferred cleanup).
- **THE ONLY THING LEFT TO CLOSE F87 = big bro's INDEPENDENT re-run of the four gates**, confirming: step2 63/0 · step3 32/1 (A7.4 the only red) · step4 GREEN *with the discriminating boundary row landing Jun opex 6527 identical across TZs* · tz-matrix all identical. Paste that → then approve commit(s) + push. **Code HOLDS until big bro's explicit go.** I (review layer) cannot run the DB gates in-sandbox — missing Postgres binary — so this run is big bro's, on his own machine.
- After it lands: big bro's **laptop-timezone live check** (see "After F87 lands"), then the deferred F87-class peripherals + `calcMTD` cleanup.

## Repo state
- `origin/main = 0050102`.
- **Held/uncommitted:** `VERIFICATION.md` (sweep results — step3-gate rewrites its A5 cells on each run, expected), `public/index.html` (client idempotency token, currently inert — server drops it), **plus the F87 batch: `public/finflow-dates.js`, `public/index.html` (script tag), `server.js`, `public/app-main.js`, `public/finflow-api-wiring-dashboard.js`, `public/finflow-bundle.js` (regenerated), `tests/harness/*` — all wired, gate-green per Code, awaiting big bro's independent gate run + commit approval.**
- **New / untracked — reviewed & approved, NOW WIRED, UNCOMMITTED:**
  - `public/finflow-dates.js` — the canonical resolver. Exports `resolvePeriod({period,monthIdx,fyStartMonth,today})→{start,end,elapsedMonths}` (YYYY-MM-DD strings), `inWindow(date,start,end)` (string compare, no Date-to-Date), `resolvedToday(serverNow,tz)`. UMD: server `require` + client `window.FinFlowDates`. 16/16 tests green across 4 TZs (child processes).
  - `tests/harness/finflow-dates.test.js` — the module's tests.
  - `tests/harness/step4-client-gate.js` — client probe. Marker-slices the REAL client engines (`computeRevenue`/`computeExpenseBreakdown`/`arOutstanding`/`_periodWindow` from app-main.js; `buildMonthlyArrays`/`updateKPIs`/`parseDate` from dashboard.js), seeds from VERIFICATION, runs across the TZ sign boundary. Currently RED by design (detects F87: 18 figs move; west POS 5/18 vs east 14/18).

## F87 — where it stands (confirmed)
- **Root:** period windows are built at the viewer's **local midnight** and compared **instant-to-instant** against **date-only values parsed as UTC midnight** → first-of-month rows misfile (CLAUDE.md Rule 10).
- **Cold sweep (2026-07-25):** step1 26/0 ✅ · step2 63/0 ✅ (seed faithful, so failures are real) · **step3 19/12** — Group 1 = INV-6 future-dated (+5,000 on FY revenue/AR/GP/NP = the **D2** gap) and Group 2 = opex Jun −150 / Jul −500 (**F87**, FY opex nets correct) · step4 detects the client F87 · **tz-matrix 10 figures viewer-dependent**.
- **Fix = one structural batch:** server-side period resolution + string-date comparison + D2. Phase 1 = date-only accounting dates (clears the sweep). Phase 2 = genuine timestamps resolved against the **entity** timezone (hooks in `finflow-dates.js`, NOT built — must stay flagged, it's the deeper half of Rule 10).

## NEXT ACTION — send Code the F87 wiring prompt
The wiring prompt is written (in the prior chat — re-relay it). It is built on the **convergent method** because reading passes don't converge (VERIFICATION's thesis):
1. **Enumerate mechanically** (grep every date-comparison/period-window carrier on money paths — not from memory).
2. **Route them all** through `finflow-dates` (server `computeBooks` dual-path + `_bIdx`/`_fyMonths`(~4296) + 2nd report `inWin`(~4437) + `keyOf`(3401,3487) → string slice; `/api/reports` takes intent; **D2 at the RECOGNIZED filter** so all-time AR is covered; re-source `months` from `resolvePeriod().elapsedMonths` ONLY IF identical on every period incl. the no-window string-period path, else leave + log (`months` is RETURNED at server 4367 and DISPLAYED as cf-avg app-main:2137 — NOT dead; `winElapsed` only feeds it). Client: 4 engines + `_periodWindow`/`_fyContext` + banking's per-period filter; client sends intent; `node bundle.js --check`==0).
3. **Prove completeness mechanically** — a post-fix **residual grep returns ZERO** carriers on recognition legs (structural check), plus all four gates green (step2/step3/step4/tz-matrix).
4. **Ungated money surfaces named & verified, not trusted:** banking (A7.19 — no gate covers it), and confirm nothing in personal-finance/investments got dragged in.
- **SCOPE — IN:** business accounting recognition + banking per-period. **OUT (leave alone, say why):** investments rolling chart (`1m/3m/ytd/1y`, app-main ~4217 — legitimately relative-to-now), personal-finance module, all date formatting/labels (`computeMonthFull` app-main:1258)/insert-defaults/recurring `next_run`.
- Code HOLDS the commit; review diffs + residual grep + gate output **from the checkout** before approving commit/push.

## After F87 lands
- **Big bro's laptop-timezone live check** — set the OS to a different TZ, reload, confirm dashboard figures don't move. **Requires a discriminating first-of-month row** (create a scratch one dated the 1st if the live data lacks one, check, then delete) — otherwise a date-only set shows no movement whether fixed or not.

## Other open threads (all recorded in AUDIT_MASTER @ 0050102)
- **C1 double-submit rollout** — payroll pilot DONE (handler `577b280` + unique index live). Rulings made: **Wave 1 hard-unique** (keys confirmed from source) — `holdings`(user,entity,ticker)+blend · `autocat_rules`(user,keyword,match_type)+reject-edit · `team_members`(user,lower(email)) · `chart_of_accounts`(user,entity,code) · `fx_rates`(user,from,to,rate_date) · `budget_targets`(user,entity, upsert-hardening). Each needs a live-data dup pre-check first. **Wave 1b** entities (blocked on F108). **Wave 2** token — every other create route, **blocked on building the token infra** (server `idempotency_key` column + persistence + partial unique index; client already mints it, inert).
- **F108** — entities need a structured **jurisdiction** attribute (country+region code, canonical); enables the (name,jurisdiction) key + jurisdiction-aware accounting; NOT a tax-calc revival; address = metadata; existing entity needs owner-supplied jurisdiction backfill.
- **F109** — investment **close-position → realized gain** feature (avg cost, full+partial, own investment-income line not operating profit, persisted record, tracking-not-tax, dated; cash-flow follow-on).
- **Group 3** — `GET /api/invoice-payments` returns 400 (A7.4); small contained fix, pending.
- **F107** — marked 🔴 CRITICAL but likely over-rated (cross-account *visibility* gap, low live exploitability — zero team_members rows, fail-safe resolver; it's public in the repo). Big bro to decide re-rate to HIGH/MEDIUM.

## Verification harness quick ref
- `node -r ./tests/harness/clock.js tests/harness/step2-gate.js` (seed) · `…step3-gate.js` (server A5, writes VERIFICATION.md) · `node tests/harness/step4-client-gate.js` (client, cross-TZ) · `node tests/harness/tz-matrix.js` (A8). Scratch Postgres 17.10, clock pinned 2026-07-25, TZ America/Port_of_Spain, fiscal year January.
