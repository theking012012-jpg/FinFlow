# SESSION HANDOVER — FinFlow (2026-07-30)

Paste this as the opening briefing for the next session. Supersedes SESSION_HANDOVER_2026-07-25.md (F87 has landed; that file is stale).

## Roles & discipline

- Review/planning/decision layer = the assistant. "Claude Code" (VS Code) writes all code. SHLLC / "big bro" relays between them via paste/screenshots.
- Repo is public: `github.com/theking012012-jpg/FinFlow`. Read it — but verify from the local checkout, **not** raw.githubusercontent (stale CDN content), and use `git -c core.autocrlf=true` for real diffs (F43 phantom CRLF churn; don't raise EOL diffs as findings).
- **Never commit or push without big bro's explicit say-so.** One Code prompt per turn. Code HOLDS commits for diff review before anything lands.
- OneDrive git-lock hazard: sandbox git writes leave `.git/index.lock` that OneDrive freezes. Prefer letting Code (VS Code) do git; clear a stuck lock with `cmd /c del /f /q ".git\index.lock"`.
- Binding rules live in CLAUDE.md / REVIEW_RULES.md. Correctness is defined by VERIFICATION.md, not by noticing things.
- **Evidence rule (learned this session):** a pasted narrative of tool output — however detailed, however much it looks like a terminal log — is not verification. Verify from the checkout, from uploaded files, or from a run you can see. Reports get checked, not trusted.

## ⇢ CURRENT STATUS — READ THIS FIRST

**F87 is SHIPPED.** `origin/main` moved `0050102 → 4454111`, two commits:

| SHA | What |
|---|---|
| `34de981` | `fix(F87)` — server-side intent resolution, string-compare calendar dates, AP-D2 · 11 files, +720/−293 |
| `4454111` | `feat(C1)` — client idempotency token at action intent (inert) · index.html only, +16/−2 |

Auto-deploys to Railway on push, so F87 is in production.

**Independently verified before and after the push** (from the checkout, not from report): AP-D2 genuine on the balance-sheet AP leg (`server.js:3476/3479`, mirrors AR); VERIFICATION.md *expected* columns unchanged, only Result cells flipped FAIL→PASS (no oracle circularity); `calcMTD` confirmed zero call sites; resolver genuinely UTC/string-based (`resolvedToday` → `_utcYmd`, `_toYmd` slices date-only strings without constructing a Date); `finflow-dates.js` loads at index.html:3558, immediately before app-main.js:3559 (required — app-main calls `_fyContext()` at load); bundle in sync; index.html split landed exactly right (F87 commit got only hunks @@ -25 and @@ -3551; C1 commit got only @@ -4653 and @@ -4669); neither commit carries `.claude/settings.local.json` or the scratch files.

**Gates at time of commit:** step2 63/0 · step3 32/1 (A7.4 the only red, pre-existing Group 3) · step4 viewer-independent 18/18 all four viewers · tz-matrix all identical with the discriminating boundary row landing **Jun opex 6527** (5,750 + the 777 row at `2026-06-01T05:30:00Z`, inside the LA/POS gap — so this is a real pass, not a weak-seed false green).

## ⚠ NEXT ACTION — hardening batch (in priority order)

These are all defects in the *tests and tooling that proved the last batch*. Fix before the next money-path change.

### H1 — pre-commit bundle guard commits unreviewed code (NEW, highest)

`bundle.js` `build()` reads the **working tree** (`fs.readFileSync`, line 31), but `.githooks/pre-commit` stages the result. A partially-staged or merely dirty wiring source therefore produces a committed bundle containing code that is in **no committed source**. `index.html:6792` loads *only* `finflow-bundle.js` — the ten wiring sources are never loaded by the browser — so that unreviewed code is what deploys to Railway.

Nearly bit us: the index.html split on 2026-07-30 was a partial stage. index.html isn't a bundle source, so it was a miss. A wiring source would have shipped the unstaged half.

**Fix:** add `--from-index` to bundle.js reading each source via `git show :public/<file>`; if the result differs from the staged bundle, write it to the **index only** (`git hash-object -w` + `git update-index --cacheinfo`), leaving the working tree untouched. Hook calls that mode. Default and `--check` unchanged for manual use. Prove with a test that fails against the current hook and passes against the fixed one (stage one of two edits to a wiring source, commit, confirm the committed bundle lacks the unstaged edit). This is a committed defect on main — own commit + AUDIT_MASTER entry.

Leave the verification-sync guard alone; it correctly blocks rather than guessing.

### H2 — step4-client-gate cannot fail

- `A()` (line ~134) is the assert; it increments pass/fail.
- The per-viewer 18/18 comparison (lines ~181-190) computes `vp`/`vf` and only `console.log`s them — `A()` is never called. A viewer at 5/18 still prints **"ALL GREEN — 1 passed, 0 failed"**.
- Line ~196 is `process.exitCode = 0` unconditionally — the gate never fails the build even if check 1 goes red.

Net: the entire gate is one assertion and it can't signal failure. Today's numbers are real, so this wasn't a false green — but as a regression guard it's far weaker than "step4 GREEN" implies. Route check 2 through `A()`, one assertion per viewer; set `process.exitCode = fail === 0 ? 0 : 1`.

### H3 — A7.22b can pass trivially

`step3-gate.js`: `_futBill = await http.post('/api/bills', ...)` is never status-checked. If that POST 400s, no bill is inserted and the AP-unchanged assertion passes whether or not D2 works. Assert the bill was created (2xx + non-null id) before the AP check.

### H4 — ratify the A7.1 oracle change

The gate's *own* AR computation gained a D2 filter in this batch (`step3-gate.js`, cites seedData.js:154 defining AR as recognised / non-draft / non-future). Defensible — the client's `arOutstanding` now applies D2 too, so the gate mirrors the client. But it is a test-side change that turned a red green. Confirm seedData.js:154 actually says that, then ratify consciously or revert.

### H5 — stale footnote

step4 still prints "(For THIS run a FAIL on check 1 is EXPECTED and correct…)" unconditionally, even when green. Contradicts the result.

## After the hardening batch

**Laptop-timezone live check.** Set the OS to a different TZ, reload, confirm dashboard figures don't move. **Requires a discriminating first-of-month row** — create a scratch one dated the 1st if live data lacks one, check, then delete. A date-only dataset shows no movement whether fixed or not, so without that row the check proves nothing.

## Other open threads (recorded in AUDIT_MASTER)

- **A7.4 / Group 3** — `GET /api/invoice-payments` returns 400 (`server.js:3708` requires `invoice_id`; gate calls with none). Small contained fix, pending. The only red in step3.
- **Peripheral F87-class instances** — same bug, non-recognition surfaces, each its own commit: `inThisMonth` → credit-notes / vendor-credits "this month" sums (wiring-pages.js:38/432/945); recurring-bills YTD `_rbMonthly*` (wiring-pages.js:863); docs-this-month count (wiring-medium.js:1090).
- **calcMTD cleanup** — dead (wiring-dashboard.js, zero call sites, confirmed by grep). Deferred deletion.
- **F87 Phase 2** — entity-timezone resolution for genuine timestamps. Hooks exist in `finflow-dates.js` (`resolvedToday(serverNow, tzOrOffset)`, `tzOrOffset` intentionally unused); **not built**. The deeper half of Rule 10 — keep it flagged.
- **Banking A7.19** — routed through `resolvedToday().slice(0,7)`, but ungated (no seeded bank rows). Verified by residual-grep-clean + logic identical to the proven server pattern, **not** by an executed cross-TZ probe. Labelled UNEXECUTED per Rule 14; a banking-seed probe is the executable close.
- **C1 double-submit rollout** — payroll pilot DONE (`577b280` + unique index live). Client token now committed but **inert** (server has no `idempotency_key` column, drops it). Wave 1 hard-unique keys ruled: holdings(user,entity,ticker)+blend · autocat_rules(user,keyword,match_type)+reject-edit · team_members(user,lower(email)) · chart_of_accounts(user,entity,code) · fx_rates(user,from,to,rate_date) · budget_targets(user,entity, upsert-hardening). Each needs a live-data dup pre-check first. Wave 1b entities blocked on F108. Wave 2 token blocked on server infra (column + persistence + partial unique index).
- **F108** — entities need a structured jurisdiction attribute (country + region code, canonical); enables the (name, jurisdiction) key + jurisdiction-aware accounting. **Not** a tax-calc revival; address = metadata; existing entity needs owner-supplied backfill.
- **F109** — investment close-position → realized gain (avg cost, full + partial, its own investment-income line not operating profit, persisted record, tracking-not-tax, dated; cash-flow follow-on).
- **F107** — marked 🔴 CRITICAL but likely over-rated (cross-account visibility gap, low live exploitability — zero team_members rows, fail-safe resolver, and it's public in the repo anyway). Big bro to decide re-rate to HIGH/MEDIUM.
- **Untracked docs** in the working tree, left alone per Rule 8: `AUDIT_2026-07-13.md`, `AUDIT_CODE.md`, `AUDIT_MASTER_ARCHIVE_2026-07-22.md`, `CODE_AUDIT_2026-07-09.md`, plus the old `SESSION_HANDOVER_2026-07-25.md` (now superseded by this file). Commit as docs, delete, or gitignore — owner's call.

## Verification harness quick ref

```
node -r ./tests/harness/clock.js tests/harness/step2-gate.js    # seed
node -r ./tests/harness/clock.js tests/harness/step3-gate.js    # server A5, writes VERIFICATION.md
node tests/harness/step4-client-gate.js                          # client, cross-TZ
node tests/harness/tz-matrix.js                                  # A8
```

Scratch Postgres 17.10 (production is Supabase 17.6.1 — same major), clock pinned 2026-07-25, TZ America/Port_of_Spain, fiscal year January.

**Clock drift note:** the harness pins node to 2026-07-25 while Postgres `NOW()` uses the real clock. The gate reports the gap and passes while both fall in the same month — so this becomes unreliable after 2026-07-31. D2 depends on "today", so re-pin or re-baseline before running in August.

**To capture gate output for review:** PowerShell's `>` writes UTF-16; convert or upload the files directly rather than pasting scrollback. `git grep` needs `-F -e` for fixed strings (basic-regex escaping of `\(` fails).
