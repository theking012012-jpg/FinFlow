# FinFlow — session handover (for the next Claude)

**Written:** 2026-08-14 · **Repo state:** `main` at commit `62137cc`, clean, everything pushed.
**You are picking up a single-founder SaaS build.** The owner (Shaq, Trinidad) plans/approves; you write code.

---

## ⚡ UPDATE 2026-10-23 night — PRODUCTION IS LIVE ON `main` (read this first)

**Railway has been up since the morning of 2026-10-23** (owner) and auto-deploys `main`. Everything pushed on 2026-10-23
is therefore expected to be live (the "Railway down / production on `9682467`" notes below are out of date) — the owner
confirms in the Railway dashboard which commit is deployed and whether "wait for CI" is on.

**CI was red on every push** — not the app: the dependency-audit gate (`npm audit --omit=dev --audit-level=high`) failed on a
new HIGH advisory, body-parser 1.20.8 (GHSA-27r3-jxmh-p828). Fixed in `a96eea4` (1.20.9, lockfile only). The owner has
seen these CI e-mails "from time to time" before → **owner request: a full re-check of the entire app once the current fixes
are finished** (the 3× full sweep + a live walk-through), not just the targeted harnesses.
**Latest (2026-10-27):** owner 3× sweep on `542ebd7` = 671/674 ×3; frozen list SW1–SW3 (AUDIT_MASTER, top of RECHECK_2026-10-24.md). Next session starts there, then FA-M7 onward.

**Live behaviour that started with today's deploys (by design, verified):** the hourly billing job (lands due downgrades;
retention warnings / deletion only for plans that END from now on — no existing account has `billing.access_ended_at`;
30-day yearly renewal e-mails; freezes closed SaaS months); accountants are asked to accept the Conduct Policy at sign-in
(14-day grace); plan gates by plans.js (Pro now has Banking + scanner); team seats enforced; AI caps no longer env-tunable.

**Owner steps now (all listed in AUDIT_MASTER rows):** (1) schema — `initDB()` creates the new tables at boot unless
`SKIP_INIT_DDL` is set; if it is, run the migrations in `scripts/migrations/2026-10-23-*.sql` and `2026-10-24-*.sql`; (2) `link-stripe-subscriptions.js`
(FA-S1, dry run first); (3) the invoice-numbering tools (B1b); (4) yearly Stripe prices → `STRIPE_PRICE_PRO_ANNUAL` /
`_BUSINESS_ANNUAL` / `_SCALE_ANNUAL`; (5) `DATABASE_CA_CERT` (FA-DB1); (6) `SUPPORT_TZ` (support hours' timezone; default UTC);
(7) the domain + Resend (D-J, pending the domain purchase); (8) **referral pay now goes out by itself (FA-L3d)** — the
server books it hourly and sends Stripe Connect transfers FROM FinFlow's own Stripe balance: keep USD available there,
or payouts fail (they retry hourly and show in Admin → Earnings → Referral payouts with Stripe's reason). Check one
real transfer in Stripe test mode first, and cross-border accounts (FA-L3h). An outside cron calling
`/run-monthly-payouts` is no longer needed. (9) **ledger backfill (G10)** — per business, `POST /api/gl/backfill?dry=1`
then without `dry`, so the ledger becomes the source of the reports (until then they use computeBooks). (10) migrations
`2026-10-24-*.sql` if `SKIP_INIT_DDL` is set (referral payouts, auto-email log, credit applications, report deadlines). (11) automatic customer emails (FA-B1)
are OFF per business until you turn them on (Templates → Automatic emails); they need Resend set up. (12) **balance-sheet
check (G9)** — after the backfill, a business whose ledger holds an entry no document backs (or whose payroll liabilities
disagree with its payroll runs) shows the balance sheet from computeBooks ("cash not tracked") instead of the ledger; the
server log names the entry (`[GL 5b] … untraced(…)` / `payrollLiabilities(…)`). That is the check working — send the
line over before changing any row (Rule 8). (13) **applying credits (FA-M6b)** — Credit notes / Vendor credits →
Apply… settles part of one of that customer's invoices (that vendor's bills). Credits issued before this keep reducing
the customer's total as before; nothing old is changed. (14) **document numbers (FA-M6c)** — new credit notes, vendor credits, sales
receipts, quotes, journals and payments run CN-0001, CN-0002 … per business (skipping any number already used). Existing
documents keep the numbers they have — some old ones share a number (they came from the clock); nothing is renumbered. (15) **concern reports (D-E)** — Admin → Reports shows each report's "acknowledge by" date (2 business days,
what the client is promised) and OVERDUE; use **Acknowledge** (emails the client) and **Tell accountant** (asks for their
response, without naming the client). Set SUPPORT_EMAIL so the accountant's reply reaches you (it is the reply-to). (16) **refunded accountant bills (FA-L3i)** — a refund or lost dispute now
takes the bill out of the accountant's earned and FinFlow's commission automatically; run
`2026-10-24-earning-refunds.sql` if `SKIP_INIT_DDL` is set. Refunds made before this deploy are not back-applied (Rule 8). (17) **test-data lister (SW2)** — `list-test-data.js` now also lists the customers / vendors that test invoices and bills saved, and shows a **KEPT** section: a marked contact that a real document uses. KEPT rows are never purged — fix those by hand in the app (rename the contact) after reading the documents it names. (18) **one chart of accounts (FA-M7)** — the journal picker (yours and your accountant's) now lists the business's real chart and each line lands in the account picked; journals made before keep their accounts (now shown by their real names, e.g. "Salaries & Wages", marked "older journal account"). Run `node tools/launch/list-chart-accounts.js` (read-only) before or after deploy: it lists own accounts whose typed "opening balance" no longer shows (post an opening-balance journal if you want it), own accounts sharing a built-in code, and duplicate codes. If it lists duplicates, the boot log warns `idx_chart_of_accounts_code NOT created` — the app still refuses new duplicates; decide which to keep (Rule 8). If `SKIP_INIT_DDL` is set, run `scripts/migrations/2026-10-27-chart-account-codes.sql`. (19) **contacts on every document (FA-B4)** — from this deploy, quotes, sales receipts, credit notes, payments made, vendor credits and recurring invoices / bills save their customer / vendor like invoices and bills do, so the Customers and Vendors pages will gain names that used to be typed only ("Walk-in" from a receipt, for example). Documents made before are not changed (Rule 8). A customer can now be just a company, without an email.

## ⚡ UPDATE 2026-10-21

**Launch pass (`PROMPT_LAUNCH_ALL.md`) on top of `11b775f`. Committed by the owner and pushed to `main`: `060846f` (LR27) ·
`d795df8` (A5 drill) · `35e1c5a` (A5 Sentry) · `dc9895d` (A7) · `6e10c34` (A6 tools) · `80b0671` (app fixes LR11 / LC3c / LR24 /
LR12 / LR26 / LR13 / LR15 / LR20 / LR21 + the server side of A6) · `cd39c3e` (docs). One combined app commit: server.js,
index.html and app-main.js each carry several fixes, so they could not be split by file. **NOT deployed yet** — Railway
paused all builds (Railway incident, 2026-10-21); production still runs `9682467`. When builds resume: confirm a deploy of
`main`, then the §3 log lines in `OWNER_ACTIONS_2026-10-21.md` and the owner's 3× full sweep.** Owner steps:
`OWNER_ACTIONS_2026-10-21.md`. Decisions: `DECISIONS_2026-10-21.md`. Evidence: `AUDIT_MASTER.md` rows (each RED on HEAD →
GREEN, counts in the row).

| Item | What changed | RED → GREEN |
|---|---|---|
| LR27 / 0a | Sweep "(0.0s)" = display only (clock.js pinned the runner's Date.now; harnesses DID run — a deliberately broken real harness went RED). hrtime timing. | 6/1 → 7/0 |
| LR11 | Banking "+ Add" → real manual bank line (per business, audited, idempotency key + index, no GL until matched). | 11/5 → 16/0 |
| LC3c | Separate `personal_history` (no business column, append-only, erased with the account, exported, Personal page card). Guard known gap **17 → 0**. | 20/6 → 26/0 · UI 3/1 → 4/0 · guard 2/6 → 8/0 |
| LR24 (new) | Recurring-personal PUT/DELETE used the ACCOUNT, not the person — a team member deleted the owner's private row. | 5/1 → 6/0 |
| LR12 | Audit page "By" column (one shared SQL for both audit reads). | 6/0 → 6/0 |
| LR26 (new) | Audit / security / admin / personal records used the proxy's IP (`req.ip`) — now the visitor's (`_clientIp`). New-device alerts were unreliable. | 5/0 → 5/0 |
| LR13 | Documents cards read a never-set `window._docsCache`; sizes in bytes shown/summed as KB; `.txt` accepted. | 5/0 → 5/0 |
| LR15 | Inventory "COGS this month" was the selected period's COGS — card now names its period (figure was right). | 2/2 → 4/0 |
| LR20 | Sales receipt captions ("Via Stripe" → "Card & Stripe · all time", etc.). | 3/1 → 4/0 |
| LR21 | Settings Industry list = onboarding's 11; a stored value is never blank. ×5 settings fetch NOT reproduced — needs a live trace. | 2/1 → 3/0 |
| A5 | `@sentry/node` added (DSN alone did nothing); restore drill refuses DEST = SRC; ALLOW_INDEXING verified both ways. | Sentry 2/5 → 7/0 · drill 3/4 → 7/0 |
| A6 | `tools/launch/list-test-data.js` + `purge-test-data.js` (reversals via shared `ledger-reverse.js`; books tie to the cent). | 12/3 → 15/0 |
| A7 | LC1c lister verified read-only; exact-name link script prepared behind `--apply --expect`. | 7/6 → 13/0 |

Related re-runs: LR11 + LC3c set **77/77 GREEN**; GL / audit / security set 75 / 76 run before it was stopped — the one
FAIL (`verify-fix3-audit-coverage`, stale column index after LR12) fixed → 15/0. **No agent full sweep** (owner's, 3×).

**Second round 2026-10-21 (UNCOMMITTED — owner commits):** LR14 3/0 → 3/0 · LR16 5/0 → 5/0 · LR18 2/2 → 4/0 · LR19 3/2 → 5/0
(small related set 32/32) · `VERIFICATION.md` every Result cell stamped with today's runs (A7.22 / A7.23 new harness 3/0) ·
Terms / Privacy / Security rewritten (LR29 — fill the placeholders) · owner pack §7 corrected (set CONNECTOR_ENC_KEY first;
do not rotate SESSION_SECRET once banks are linked) · LR28 landing testimonials (owner / legal). Production build chain
(`npm run gen`) exit 0. **Open in code:** LR21 ×5 settings fetch (needs a live trace).
**Third round 2026-10-21 (owner: "go with your recommendations", UNCOMMITTED):** LR6 3/0 · LR8 2/0 · LR9 7/0 · LR10 6/0 ·
LR22 2/0 · LR23 7/0 · LR25 3/0 · LR1b 9/0 · D3.3 4/0 · D3.6 5/0 (each RED first) · LR13 formatter regex follow-up 6/0.
Decisions left: 3.4 (data step), 3.5 (legal), 2.6 (lawyer). **Full sweep: the owner's, at the end.** **Decisions waiting:** 3.1–3.7, LR1-follow-up, LR5, LR6, LR8, LR9, LR10, LR22, LR23, LR25, 2.6.
**Fourth round 2026-10-22 (UNCOMMITTED; owner's 3× sweep on `f59a845` = 601/605 · 599/605 · 601/605):** the 4 reds that
recurred in every run were harness expectations left stale by the round-3 decisions, plus one escaping false positive. No app
figure was wrong (LR30): escaping sweep 3/0 · LR18 4/0 · f129 7/0 · f154 14/0 · native-money 10/0. The 2 run-2 TIMEOUTs
were NOT flaky: a real intermittent client loop (renderInventory ↔ loadCOGS; an error reply also zeroed COGS), latent since
C7 (LR31). `verify-lr31-cogs-reload-loop` RED 3/3 → GREEN 6/0; bankrec-render and f106-client-controls 3/3 runs GREEN each.
Related set (COGS / inventory / bank rec / escaping / currency labels) **30/30 GREEN**, sequential. `npm run gen` exit 0, no
tracked build file changed. **Next: owner's 3× full sweep on the commit with these fixes.**
**2026-10-22 gap investigation (read only, UNCOMMITTED):** `PLAN_GAP_FIXES_2026-10-22.md` — V1 payroll paid before its period is accrual-correct but shown as Payroll Liabilities −6,700 (recommend Prepaid payroll + confirm + month picker); V2 Plaid balances never stored; G1–G12 logged in AUDIT_MASTER. Owner bar (plan §7): better than the industry standard in what and how. **Owner's 3× sweep 2026-10-22: 606/606 GREEN ×3** (code of `5b2879c`). **Batch 1 (V1) DONE 2026-10-22, uncommitted:** prepaid payroll posts to 1250 and releases to 2200 on the period start (one rule for mark-paid / remit / backfill); a future month needs a confirmed "Pay in advance"; month picker. `verify-v1-payroll-prepaid` 28/0, `-ui` 9/0, related set GREEN (see AUDIT_MASTER V1). New: G13 (same class on AP/AR, owner decision), G14 (existing early-paid run self-corrects on its period start, owner decision). **Owed:** a VERIFICATION.md row for the Prepaid Payroll line (with expected.js); the owner's 3× sweep. V1 committed (`3d0fc03`). **Batch 2 (G3) DONE 2026-10-22, uncommitted:** one edit rule for invoices and bills — amount never below paid, paid invoice never back to draft, status follows payments, legacy paid figures kept; `verify-g3-doc-edit-guard` 13/29 → 29/0; related set 103/103. G3 committed (`3893475`). **Batch 3 (G4) DONE 2026-10-23, uncommitted:** one scorer for both bank-rec pickers — ranked, says why, preselects only a clear winner, never a guess or a tie; money-in payments marked Suggested. `verify-g4-bankrec-suggestions` 9/14 → 14/0; related 40/40. G4 committed (`ffc4ce7`). **Batch 4 (B7b + G2) DONE 2026-10-23:** reconciliations saved per business (server-recomputed difference, cleared lines locked, Plaid flags not overwrites, undo newest-first, audited) + Reports → Bank Reconciliation; `verify-b7-reconciliation-saved` 15/16 → 18/0 (isolation check proven discriminating); related 68/68. **Deploy note:** run the migration `2026-10-23-bank-reconciliations.sql` (owner migrate step). B7b+G2 committed (`86a8fbf`). **Batch 5 (V2) DONE 2026-10-23:** bank balances per account (current / available / as of), per-currency totals, one bank-vs-books comparison; `verify-v2-bank-balance` 8/10 → 10/0; related 46/46. New G15 (per-account books, owner decision). V2 committed (`0d32320`). **Batch 6 (B1b) DONE 2026-10-23:** invoice numbers per business from every writer (form / recurring / CSV / Codat), never reused, DB-guarded (guarded migration), shown everywhere (the document's fabricated number removed); owner tools list-invoice-numbers.js + number-existing-invoices.js. Related 114/114. **Deploy:** migration → lister → numbering tool (dry run first). B1b committed (`037a9a4`). **Batch 7 DONE 2026-10-23:** edit invoices and bills in place (line items, number kept, server refusals shown, History beside the document — never printed); line clearing on edit; Audit-page filters for V1/B7b records. `verify-b7e-edit-invoice-bill` 8/9 → 11/0; related 110/110. Batch 7 committed (`abf652f`). **Batch 8 DONE 2026-10-23:** payment terms per business; blank due = issue + terms; live due-date note; template prints the real terms; "No due date" instead of TBD; tax-rate field removed (D6). `verify-b8-payment-terms` 7/9 → 9/0; related 87/87. New G16 (recurring invoices ignore terms — owner decision). **Batch 9 DONE 2026-10-23:** every invoice / bill saves and links its contact once per business (one name key, also used by reminders); forms pick saved contacts; "Save all" with a look-alike preview; unique display name per business. `verify-b9-contacts` 2/18 → 20/0. Committed (`411c6af`). Also: P&L false "Unreconciled difference" while loading (`367982d`); books cash read only when Banking is open (`7a4ffab`). Full app audit folded in: FA-* rows in AUDIT_MASTER, order in PLAN §9 — EVERYTHING before launch. **A0 2026-10-23:** every landing claim checked → `LANDING_CLAIMS_A0.md` (7 owner decisions; page unchanged until approved). **A1 DONE 2026-10-23:** FA-M2 overdue per customer (`fcab114`), FA-M3 documents show paid + balance due (`ddd416d`), FA-M4 invoice Paid column (`34e8dbd`), G17 payment document number. Next: batch 12 (Trial Balance + GL Detail in Reports), then A2 (FA-M7 charts of accounts, FA-M6 create-time statuses).
**Tooling note:** the bundle has TWO more sources than `finflow-api-wiring-*.js` — `finflow-api.js` and
`finflow-api-wiring.js`. A Rule-1 grep must include them (`public/finflow-api*.js`).

---

## UPDATE 2026-10-20

**Read `CLAUDE.md` first.** Then `LAUNCH_STATUS.md` (what stands between today and launch) and the LC rows in
`AUDIT_MASTER.md` (evidence for each fix).

### Where things are

- `main` = branch `claude/laughing-hawking-lkvv38` @ the 2026-10-20 docs commit (fast-forward from `14709a6`, owner
  instruction 2026-10-20 "push to main and have Railway redeploy"). Railway auto-deploys `main`.
- The last owner sweep is **557/557 ×3 on `14709a6`**. The 15 commits after it have NOT had the owner's 3× sweep —
  that is the first thing to do (`LAUNCH_STATUS.md` 0.1). Command and capture tip: the 2026-10-11 section below.
- Uncommitted on the agent's working copy only: `personal-history.js` (LC3c draft, not deployed, not wired in).
- 2026-10-20 later: `2fd2396` (owner) adds `COWORK_RETEST_RESULTS_2026-10-20.md`; the docs commit after it records the
  results (AUDIT_MASTER LR rows, LAUNCH_STATUS 0.4 / 1.6 / 2.7 / 4.4, this section). No code changed.

### Done since 2026-10-19 (Cowork live check → `COWORK_FIX_HANDOFF.md` on branch `audit/live-2026-10-19`)

| Row | What was wrong | Fix (commit) |
|---|---|---|
| LC1 / FIX-1 | Time logged to a project never counted on it (free-text name, no id). | `project_id` on entries; project hours / billed derived from linked entries (`c0957a3`). |
| LC1b | Projects page called billable time "Billed" / "Revenue"; nothing is invoiced from time. | Labels name what the figures are (`3419b94`). |
| LC1d | No `VERIFICATION.md` check for any project / time figure. | A10, 7 checks, owner values (`d628344`). |
| LC2 / FIX-2 | "Full year total" caption on figures that are year-to-date (D2: nothing after today). | Relabelled "Year to date" — owner decision; numbers unchanged (`33ade9b`). |
| LC2b | Non-January fiscal year: period labels kept January months after a reload. | Labels rebuilt when the fiscal months change (`2a8785a`). |
| LC3 / FIX-3 | Quotes, projects, time, budget left no audit row. | Audited + filter options (`5505e9e`). |
| LC3b | The class: 152 mutating routes wrote no audit row. | 32 money / access routes audited + structural guard (`cb1c809`); then LC3d–g below. |
| LC3g (+ -c) | Admin actions: thin, editable log; 7 actions unlogged; customers never saw admin changes. | Append-only `admin_log` with who / where / before → after; customer's own trail shows "FinFlow support" (`170ab65`, `b09dccc`). |
| LC3d | Sign-in / 2FA / password events mostly unrecorded; failed sign-ins stored with no account. | Full security log + Settings view + e-mail alerts (`70fc8f8`). |
| LC3f | Client side of the accountant relationship unrecorded; accountant account events unrecorded. | Both sides on the client's trail (`1b41b86`). |
| LC3e | Connecting / disconnecting outside services left no record. | Recorded at the one connection write path; never a credential; personal never on the business trail (`ad228ab`). |
| LC4 / FIX-4 | Record Payment overpay warning always visible. | `.hidden` rule (`6ceaec0`). |
| LC5 / FIX-5 | Pages slid sideways at 769–1,056 px; titles squeezed to 0 px. | Top bar wraps (`4bd7a47`). |

Every fix: its harness written first, RED on the old code, GREEN on the fix, related harnesses re-run (counts in each
AUDIT_MASTER row). Labelled UNEXECUTED where a provider is needed: the OAuth callbacks (LC3e), the Stripe payout-account
link (LC3f), the payment-link audit (LC3b).

### Live retest 2026-10-20 (Cowork) — what it found

Full retest of this release on production (`main` @ `e023214`): `COWORK_RETEST_2026-10-20.md` R / F / T + all of
`COWORK_LIVE_CHECK.md` A / B / C. **52 checks: 40 PASS · 6 FAIL · 5 BLOCKED · 1 SKIPPED.** Report:
`COWORK_RETEST_RESULTS_2026-10-20.md`. Findings: `AUDIT_MASTER.md` LR1–LR21 (none fixed yet; class enumeration still to do).

- **Confirmed live:** LC1 / LC1b (time links to its project), LC3 creates, LC3e, LC4, LC5, the wall (T7), LA21, LA23,
  LA4 / LA14, LA5, LA6, LA8–LA10, LA13, LA15 (one bare "$" left — LR4), LA16, LA17, and **LA2: 0 boot errors on two
  reloads** (console caveat in the LR section).
- **🔴 LR1** — Run Payroll "December 2026" → HTTP 500 (17:02:56 and 17:03:26 UTC). A voided Dec 2026 run exists; cause
  not confirmed. Blocks the owner-salary re-check.
- **🔴 LR7** — Budget targets: "Monthly" does not convert existing rows and save stores every row × 12 (silent ×12 on
  a money target).
- **🟠 LR2 / LR3** — Dashboard Money-flow block stale after an expense (until reload) and stuck "Loading…" after a
  business switch. **🟠 LR11** — Banking "+ Add" is a toast-only stub.
- **🔒 Owner decisions:** LR5 (owner card has no "This is me" flag — A4), LR6 (Reports period wording — F2), LR9 / LR10
  (no edit for quotes / time entries).
- Minor: LR4, LR8, LR12–LR21.
- Not run: T4 failed-sign-in (owner step), C14 (no accountant login), T6 skipped (would e-mail the accountant).

### Outstanding

**Agent (next — proposed order, owner to confirm):** LR1 (needs the Railway log first) → LR7 → LR2 / LR3 → LR11 →
LC3c — the separate personal history (owner decision 2026-10-20). Design and full scope in the
`AUDIT_MASTER.md` LC3c row; the guard still lists its 17 routes as the one known gap.

**Owner:**
1. Full sweep ×3 on `main` (`LAUNCH_STATUS.md` 0.1). The post-deploy check (0.4) was run by Cowork on 2026-10-20 —
   see the section above. Still yours from it: the Railway log lines for LR1's two 500s; T4's wrong-password sign-in
   (private window) then Settings → Recent security activity; LR17 (did the 12:24 new-device alert e-mail go out?);
   decisions LR5 / LR6 / LR9 / LR10; cleanup of the 21 `ZZ-LIVECHECK` records (1.6).
2. Confirm in the Railway log that the 2026-10-20 schema changes applied (0.3).
3. Rotate the database password (1.1 — still open, the hard blocker).
4. Configure Resend (1.2) — the new security alerts e-mail only once it is set.
5. Decisions: LC1c old time entries (3.4) · LC3d-b retention of a deleted account's security events (3.5, legal) ·
   LC3e-c a business service connected before any business exists (3.6) · LC3g-b named admin accounts, only if needed (3.7).
6. LA2's live confirmation: observed 2026-10-20 (A1 — 0 "deferred render hook threw" on two reloads; see the LR
   section's console caveat). LA7 and LA11 are closed (`AUDIT_MASTER.md`); the older sections
   below still call them open — they predate that.

---

## UPDATE 2026-10-11 (kept for history)

**Read `CLAUDE.md` first.** Its rules are binding. This file says where the work stands and what to do next.

### Where things are

- Branch: `claude/money-math-audit-bazpjo`. `main` = the branch as of `15f207f` (the money audit, M1–M61), deployed on
  Railway (auto-deploys `main`). Everything after `15f207f` is on the branch only, until the owner merges it.
- Production data was wiped on 2026-10-11 (clean slate; 71 tables rebuilt at boot).
- The owner runs ALL full sweeps in PowerShell (`node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js`).
  **2026-10-16: after the 555/555 sweep on `ed6090b`, LA21 (reporting currency in Settings), LA23a/b (payroll 'TT' default + clean-up
  migration) and LA22 (decision only) landed — the owner's next sweep should be ~557 harnesses (new: verify-la21, verify-la23).**
  The agent runs only targeted harnesses. (Capture tip — scrollback drops runs: `1..3 | ForEach-Object { node -r ./tests/harness/clock.js
  tests/harness/run-verification-sweep.js *> "$env:TEMP\sweep-$_.log" }` then `Select-String -Path "$env:TEMP\sweep-*.log" -Pattern "SWEEP COMPLETE|^\s+FAIL"`.)
  Last full sweep by the owner: **557/557 GREEN ×3** (2026-10-19, on `14709a6`, all three summaries captured via the
  log-file command — includes verify-la21 + verify-la23). Before that: **555/555 GREEN** (2026-10-15, on `ed6090b`,
  branch `claude/laughing-hawking-lkvv38`; run 3× by the owner, two summaries captured (scrollback), both 555/555, identical — incl. the Playwright layout harnesses C20/C21/C25
  and the real-Chromium LA2 boot-race harness). Previous: 512/512 GREEN ×3 on `15f207f`.
- The owner has given standing permission (2026-10-11) to commit and push each fix once verified, on this branch.
  Never merge to `main`; the owner does that.

### Live audit 2026-10-13 (current work — `LIVE_AUDIT_2026-10-13.md`; rows LA1–LA7 in `AUDIT_MASTER.md`)

Branch `claude/laughing-hawking-lkvv38` (from `main` at `98d5d69`). B1 → LA1 ✅ `ee83114` · B2 → LA3 ✅ `23a4716`
(confirm the live cause with `tools/live-audit-2026-10-13/b2-owner-salary-probe.js`) · M1 → LA4 ✅ `06a7559` ·
M2 → LA5 ✅ `58aa2e8` · M3 → LA6 ✅ `98f4cec` · minor → LA8 ✅ `9cc150a`, LA9 ✅ `a99215f`, LA13 ✅ `f0a7491`, LA11/LA12
not defects (evidence in the rows) · C19 Vendors → LA14 ✅ `2391779`.
Second pass (owner decisions 2026-10-14): LA10 ✅ `b551af9` ("Payroll by person"), LA16 ✅ `cfb01ad` (one product
list), LA15 ✅ `1cdc309` / `2ed98f8` / `f51e6cc` (literal "$" → each business's / accountant's own currency; currency
table + country map now in `public/finflow-currency.js`), LA17 ✅ `f51e6cc` (accountant sign-up pricing was never
saved), LA18 ✅ `cce19e7` (e2e lifecycle harness stale since C6), LA12 kept netted (owner decision).
Open: LA2 (boot null errors — diagnostic logging only, needs the next live check), LA7 (dead app-main updateInvoices
with the pre-F56 formula), LA11 (needs the owner's exact click that reloads the page). Every ✅ was executed RED on
the old code and GREEN on the fix here; full sweeps are the owner's (PowerShell).
Harness substrate: `pgScratch.js` now runs as root in a Linux container via an unprivileged uid (`d91045b`), so the
agent executes DB harnesses RED/GREEN itself. Test data the auditor left in the live account (AUDIT TEST ZZ invoice,
AUDIT TEST EXP expense, AUDIT TEST VENDOR bill, a voided Oct payroll run) is the owner's to remove (Rule 8).

### Money audit (done)

`MONEY_AUDIT_2026-10-09.md` §1–§9: 62 findings (M1–M62). All fixed and verified RED → GREEN, except M47 (cleared: not a
defect). Cowork's live end-to-end test confirmed every Northwind money figure to the cent.

### Cowork end-to-end test (2026-10-11) — the current work list

Script: `COWORK_TEST_SCRIPT.md`. Cowork's report (on the owner's machine): `COWORK_TEST_REPORT.md` + `cowork-test-shots`.
Result on live `main`: 81 PASS / 19 FAIL / 5 BLOCKED. The FAILs are browser-side (state kept in memory across a business
switch), workflow and layout defects. They were outside the money audit's scope, which tested server figures and opened
pages fresh.

Status (C = Cowork item; each fix is one commit with its harness, RED on the old code and GREEN on the fix):

### Group 1 — wrong figures / business or Personal leaking

| # | Cowork | Problem | Status |
|---|---|---|---|
| C1 | 4.1a, 4.5d | After a business switch, pages kept the previous business's data (payroll owner card, inventory) | **Fixed** `b661b57` |
| C2 | 5.4c | Choosing a TTD business flipped Personal to TTD | **Fixed** `ed2e528` |
| C3 | 4.4a | Island Traders' amounts show "$" instead of "TT$" after a reload | **Fixed** `739f364` |
| C4 | 3.4 | Income-tax rate (20 %) not saved; estimate and accountant Tax Summary blank | **Partly fixed** `7fbd4e8`: the rate is now saved with taxable ≤ 0 (the proven cause). The report reopening at 0 % with taxable > 0 did NOT reproduce — re-test in the next Cowork run |
| C5 | 4.6 | FX page "No rates yet"; consolidated P&L shows the TTD business as $0 and total "—" | **Owner decision needed** — the app has no rate feed; every rate is typed in on the FX page. Gold standard (QuickBooks / Xero) fetches daily rates automatically. Needs: a provider covering ~50 currencies incl. TTD (e.g. open.er-api.com free tier, or a paid feed), and the date rule (each transaction at its own date's rate — the app already converts per transaction). Until then: enter the USD↔TTD rate on the FX page. Also: the consolidated view should show an unconvertible business as "—" with "add a rate", not $0 |
| C6 | 6.4, 6.5a | New accountant link sees every business by default; accountant's personal view has no income/spending totals, PAYPAL REFUND missing | **Fixed** `f849833` (PAYPAL REFUND was past the 25-row list; the list now says "latest 25 of N") |
| C7 | (confusing list) | Inventory value card $75 vs Balance Sheet $90 (card = units × item cost field; BS = FIFO layers) | **Fixed** `0982e0b` |
| C8 | 3.2a | Bank Rec "3 unmatched" after all four lines handled; debits shown as +$ with no date | **Fixed** `4c97f62` |

### Group 2 — workflows

| # | Cowork | Problem | Status |
|---|---|---|---|
| C9 | 2.4a | Edit expense opens with the date blank; amount-only edit refused "Enter a valid date" | **Fixed** `812e728` |
| C10 | 7.4 | Transaction lock can't be turned off | **Fixed** `cb7c85b` |
| C11 | 6.3 | Accountant invite can't reach an existing client (only a referral sign-up link) | open |
| C12 | 1.3a | Onboarding lets Country* be empty | **Fixed** `064c2a8` |
| C13 | 1.3c | Entities shows 0 businesses until a reload; country not shown anywhere | **Fixed** `2086cd5` — onboarding now reloads the businesses (force), entity cards show the country. verify-c13-entities-after-onboarding |
| C14 | 3.4 | P&L has no monthly table; Year chart starts in May (March missing) | **Fixed** `9f7d2a3` — monthly table (total row = statement totals) + every month on the chart. verify-c14-pl-monthly |
| C15 | 8.1 | No real P&L export (CSV "Nothing to export", PDF = print dialog) | **Fixed** `286beab` — report window CSV + PDF buttons (top-bar Export too); P&L exports statement + by-month. verify-c15-pl-export |
| C16 | 2.5a | Overdue bill row says "unpaid" | **Fixed** `315e42f` |
| C17 | (confusing) | Match-bill dropdown defaults to the wrong bill | **Fixed** `2c4f7a2` |
| C18 | (confusing) | False "exceeds remaining balance" when amount == balance | **Not reproduced** — the only such warning (Record Payment, index.html `_rpCheckOverpay`) allows 0.005 tolerance and passes an exact balance. Need the invoice, its payments and the amount typed to reproduce |
| C19 | (confusing) | Vendors / Customers / Items pages stay at 0 with data | open |

### Group 3 — layout and wording

C20 onboarding window cut off at ~700 px tall · C21 inventory + In / − Out hidden at ~656 px · C22 business switcher
shows "undefined" (**fixed** `037cb8a`) · C23 `/accountant-register` shows the home page (form is at `/join`) · C24 connection screens show
server setting names (e.g. PAYPAL_CLIENT_ID) and "Available" for unconfigured providers; Finch raw "customer_id: 1"
error · C25 phone-width squeezing (Invoices header, Personal title) · C26 "Start free trial" opens Sign-in · C27 plan
badge flips Pro/Business (**fixed** `037cb8a`) · C28 two contradicting commission tables · C29 audit "Payroll" filter empty · C30 native
browser pop-ups (accountant sign-up step 2, Shopify connect).

**Group 3 status:** C23 **fixed** `b48df1f`. C24 **fixed** `cbaf83f` + `a0956b7` (setting names — the follow-up caught checkout and Stripe payments linking; the "Available" label for unconfigured providers is still open — needs a per-provider configured flag). C22 and C27 **fixed** `037cb8a`. C20 **fixed** `afb6e35` — the onboarding window scrolls on a short screen (step 1 is 825 px; at 700 px its top and Continue were off-screen). C21 **fixed** `c217236` — inventory row actions were display:none at ≤ 768 px; they now get their own line (and the phantom "COGS" header column is gone). **Layout harnesses need Playwright** (new `tests/harness/browserKit.js`, real Chromium — jsdom cannot measure layout): install once with `npm i --no-save playwright` then `npx playwright install chromium`. Without it they print NOT RUN and count as RED, never as passed. C25 **fixed** `ca73d34` — headers wrap, titles never run under the topbar (was also broken at 900 px), customer/holding rows fit; root cause shared with C21 (narrow-screen CSS declared before its base rules never applied). C29 **fixed** `ca2a628` — every audit filter now names the tables/actions really recorded (Payroll asked for `payroll`; runs are `payroll_runs`); a structural check fails if a new recorded kind has no option. C29b **fixed** `328f77a` — found on the way: adding/editing/removing an employee on the roster was never audited; now it is. C26 **fixed** `80604c9` — the live sign-in screen (finflow-api.js) now opens on Create account for `?signup=1` and sends `?ref=` so referred signups link to the accountant (that was silently broken too; F10 regrown on the live screen). **Owner decision:** `?plan=` on the pricing links — the old, covered screen sent a new pro/business signup straight to Stripe checkout; the live screen starts the free trial (current behaviour, kept). The rest are open.

Script errors to correct in `COWORK_TEST_SCRIPT.md` before the next run: 2.6b (1,920 + 1,050 = 2,970, not 3,970); 2.1 I3
assumes a Draft status the UI doesn't offer; 4.6a assumes an all-businesses view the app doesn't have.

### How each fix is verified (do the same)

1. Write the harness first; it must FAIL on the old code with the value Cowork saw (state it in the harness).
2. Fix; harness GREEN; re-run every related harness (list them in the commit message).
3. Browser-side items need a jsdom harness that does what a user does (`clientMoneyKit.js`), e.g. switch business
   through the sidebar (`switchBusiness`), not only the lower-level call.
4. index.html changed → `node scripts/externalize-app.js && node scripts/lazy-pages.js` and stage `public/_gen`.
   The pre-commit hook rebuilds `public/finflow-bundle.js` from the index — never edit the bundle.
5. Commit (one fix per commit), push, update this table.

---

## UPDATE 2026-09-30

Big session on **in-app help + support + the accountant marketplace**. All test-backed. The **owner now
runs the verification sweep himself in PowerShell** (`node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js`,
he runs it 3× to catch flakiness) — do NOT run the full sweep in the cloud container unless asked; write
harnesses and run the individual new ones, then hand him the commit.

**Shipped this session (all synced to the owner's machine; he commits/pushes in PowerShell):**
- **Help Center rebuild** (`public/index.html` `page-help`): searchable article library (25 articles / 11 categories),
  category cards, **⌘/Ctrl-K command palette** (search help + jump to any page), **live getting-started checklist**
  (`GET /api/help/progress`, reads real data), and **guided spotlight tours** for the core workflows.
- **Ask FinFlow** (`POST /api/help/ask`): grounded AI help — cost-capped (aiCap 'shared'), tenant-scoped, 24h-cached
  for single-shot, **multi-turn threaded** (accepts `history[]`, bypasses cache), **degrades gracefully with no
  ANTHROPIC_API_KEY** (returns deep links instead of erroring). One-click **escalation** posts the transcript to
  `/api/support` (category `ai-escalation`).
- **In-app support** (`/api/support`): serves BOTH clients and accountants; admin **Support Inbox** in `public/admin.html`
  (`GET/POST /api/admin/support`) to filter/resolve/reply.
- **Client↔accountant chat** deepened (`accountant-routes.js`): **offline email notify** (`_notifyOfflineMessage`,
  only when the recipient's SSE stream is closed, 5-min debounce) + **file attachments** (`/my-accountant/attach`,
  `/clients/attach`, `/chat-attachment/:id`; ≤5MB inline base64; att_* columns on `accountant_messages`).
- **Marketplace engagement layer** (`accountant-routes.js` + both HTMLs):
  - **Proposals** — `accountant_proposals` table; accountant sends scope+fee, client accepts/declines; accepted = engagement of record (authorizes existing `bill-client`).
  - **Client tasks / document requests** — `accountant_tasks` table; accountant assigns to-dos w/ due dates, client ticks done; overdue flagged.
  - **Dashboard rollup** — `GET /api/accountants/rollup`: cross-client "needs attention" (pending proposals, open/overdue tasks, unread messages, deadlines) on `accountant-dashboard.html`.

**New tables:** `support_requests`, `accountant_proposals`, `accountant_tasks`; new cols `accountant_messages.att_{name,mime,size,data}`.

**New harnesses (all green here):** `verify-help-endpoints` (24), `verify-help-center-ui` (34, static+jsdom),
`verify-support-request` (15), `verify-help-center` (23), `verify-admin-support` (17), `verify-chat-attachments` (18),
`verify-chat-ai-wiring` (21), `verify-accountant-proposals` (21), `verify-accountant-tasks` (18),
`verify-accountant-rollup` (13), `verify-proposals-ui` (23, static). Two pre-existing stale harnesses were fixed
(`verify-ar-by-customer` overdue now nets credit notes → 7,300; `verify-onboarding-provision` fill() supplies the
now-required Industry/Business-address). Hardened `jsdomBoot.js` against a pre-existing jsdom teardown flake
(server.js's prod `uncaughtException`→exit(1) was tripping on post-close rAF noise in SPA harnesses).

**Cleanup at end of session:** the old `window.ffHelp` getting-started overlay was retired (orphaned once
the sidebar was repointed to the new Help Center); its dead code was removed from `index.html` and its
now-superseded harness `verify-help-panel.js` was **deleted** (`git rm`). Final owner-run 3× sweep in
PowerShell is **301/301 green** on every run after that deletion (was 301/302 with the lone stale
`verify-help-panel` red).

**Coverage closure (2026-10-04):** a doc-vs-app audit found the owner's later work — live FX refresh, admin CSV exports, operating-costs/`platform_settings`, `flagged_transactions` resolve — had NO harnesses. Closed with two: `verify-fx-live-rates` (14/14 — `pickRate` direct/inverse/cross-via-USD + date carry-forward/backward; `refreshLiveFxRates` USD-base upsert, idempotent-per-day, **manual-wins**, network stubbed) and `verify-admin-platform` (16/16 — audited CSV export +`admin_log`, operating-costs round-trip via `platform_settings`, flagged-transactions lifecycle accountant-flag→admin-list→resolve). Added `pickRate`/`_pickDirectRate`/`refreshLiveFxRates` as test-surface exports in server.js. **Sweep is now 307 harnesses.**

**Launch wiring (features degrade gracefully, but set these on Railway or they silently no-op):**
`RESEND_API_KEY` + `EMAIL_FROM` (offline chat nudges, support/admin/proposal/task emails), `ADMIN_EMAIL`
(support notifications), `ANTHROPIC_API_KEY` (Ask FinFlow — falls back to deep links without it).

**Scope reminder (owner correction):** tax = **estimates only**, no filing / VAT / GST engine. See CLAUDE.md Product facts.

---

## ⚡ UPDATE 2026-09-27 (read after the 09-30 update)

Repo is well past `62137cc`; `main` is clean and pushed. The current authoritative status is the
live scorecard in **`AUDIT_DEEPDIVE_2026-09-26.md`**, and the full detail of the latest session is in
**`SESSION_HANDOVER_2026-09-27.md`** — read those two first.

Since 09-14, an "everything → A+" pass shipped (all test-backed, all pushed):
- **Data lifecycle → A+:** account deletion now purges the ledger; `GET /api/auth/export` (GDPR). (`verify-account-deletion-purge` 11/0, `verify-account-export` 9/0)
- **Payments → A:** Stripe webhook dunning + dispute alert + idempotent refund reversal. (`verify-webhook-dunning-refund` 13/0)
- **Accessibility → A:** 0 axe violations across 10 pages (was 64). (`tests/harness/a11y-audit.js`)
- **Security → A / Ops → A-:** `Permissions-Policy` + CI npm-audit gate; least-privilege DB role + `SKIP_INIT_DDL` boot gate + `scripts/migrate.js` + `scripts/restore-drill.sh` (all tested). New env vars in `.env.example`.
- **Perf → A-:** composite `(user_id,created_at)` index + opt-in keyset pagination (`db.pageByUser`).

**Update (session 2, `ff42ebe`):** Perf → **A** (server-aggregated AR report [verified live] + top-clients
endpoints + incremental invoice-table render + keyset pagination). Security stays **A** (Permissions-Policy,
CI npm audit, CSP report-only backstop). Final grades: **Data lifecycle A+ · Ledger/Accessibility/Payments/
Security/Perf A · Ops A− (A+ on running the Railway role/migrate/drill).**

**The two remaining A+ bumps were MEASURED and deliberately NOT done — do not attempt blind:**
- Security `unsafe-inline` drop needs refactoring **502 inline `on*` handlers** to event-delegation (25 inline
  scripts are hashable; 1,105 inline styles stay as `style-src 'unsafe-inline'`). Multi-day render-layer rewrite.
- Wire-level invoice pagination needs re-sourcing **all** money features off the full invoice array
  (`_realInvoices`/`userInvoices` across 6 files) — an app-wide rewrite.
Both are large rewrites whose risk outweighs the gain on an app that already escapes output via `esc()` and
loads bounded per-entity data. **Recommendation: ship.** See `AUDIT_DEEPDIVE_2026-09-26.md` (FINAL STATE) and
`SESSION_HANDOVER_2026-09-27.md` (Continued session 2).

---

## ⚡ UPDATE 2026-08-24 (read this before the 2026-08-14 body below)

Things have moved since this handover was written — several "open gaps" are now closed:

- **Live-verified since 08-14:** **Stripe**, **Plaid**, **WiPay** live handshakes done **2026-08-16**
  (see `VERIFICATION_INTEGRATIONS.md`). Section 5 item 1 below is DONE.
- **Transactional email (Resend) — WIRED + LIVE (2026-08-24).** `verify-email-resend.js` 10/0 + a real
  reset email delivered from production. Section 5 item 3's email entry is DONE.
- **Forgot-password on the live login** (`finflow-api.js` `showAuthGate` — the runtime winner; static login
  is dead-shadowed): shipped, `verify-forgot-password-ui.js` 10/0. **SW bumped v2→v3.**
- **Mobile card-stack** + **Chart.js self-hosted** (`public/vendor/chart.umd.js`, off cdnjs) shipped (`965171c`).
- **F128/D1/F86** owner decisions ruled + re-verified 2026-08-23 (see `OUTSTANDING.md` §C).

**The one remaining launch item for email:** Resend is on the **sandbox sender** (`onboarding@resend.dev`,
delivers only to the owner's own inbox). Real users need a **verified domain** in Resend + `EMAIL_FROM=
noreply@<domain>`. See `OUTSTANDING.md` § H. Everything else in the email path is done.

Repo has advanced well past `62137cc` (many commits since). The current authoritative "what's left" list is
**`OUTSTANDING.md`** (updated 2026-08-24), not this snapshot.

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
