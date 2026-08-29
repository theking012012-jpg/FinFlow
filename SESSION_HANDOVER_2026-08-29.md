# SESSION HANDOVER — 2026-08-29 (F194 Scheduled-Documents view-first + a live dashboard bug)

## TL;DR
The F94 Scheduled-Documents "view-first" track (B1–B5) is **built, verified, committed, and pushed**.
A mapper bug that broke it in production was found and fixed. One **new, unfixed** correctness bug was
found live and diagnosed (invoice **Total Billed** counts future-dated invoices; it should not) — that is
the top item for the next session. Environment note: the local Linux workspace (`device_bash`) was DOWN
all session; everything went through `device_stage_files` / `device_commit_files`. Owner runs verify +
commit in PowerShell.

## ‼️ NEXT SESSION — DO THIS FIRST (owner directive)
**Before ANY further building or the Total Billed fix: do a FULL live walkthrough of the app in the browser
and check EVERYTHING.** The harnesses pass but STUB their data, so two real production bugs (the `f9792d8`
mapper drop, and Total Billed counting future-dated invoices) sailed past a green sweep this session. Trust
the live app, not the harnesses.
- **App:** https://finflow-production-dab2.up.railway.app/app (owner is logged in; active entity "Saige Holdings LLC").
- **Get a browser connected first.** This session the Claude-in-Chrome extension was NOT connected and the
  desktop built-in browser was intermittent. Confirm a working browser before starting.
- **Walk every page** and, for each, check: does it load without console errors; does the data match reality;
  do the money figures **reconcile** (Billed − Collected = Outstanding; revenue/AR/AP vs the reports); do
  created / edited / deleted rows **persist across a reload**; do entity switches scope correctly; do the
  F88 timezone/holiday and multi-currency surfaces behave. Pages: Dashboard, Invoices (money-in), Expenses /
  Bills (money-out), Scheduled Documents, Payroll, Reports, Banking / connections, Customers / Vendors,
  Settings / entity editor, Personal finance.
- **Known-live going in:** (1) Total Billed counts future-dated invoices (see below); (2) verify the `f9792d8`
  mapper fix actually DEPLOYED — set opening cash + a timezone, hard-reload (Ctrl+Shift+R), confirm they
  persist and the runway/chips hold.
- **Produce the full defect catalogue FIRST**, then fix in priority order. Don't build new features until
  the walkthrough is done.

## Committed this session (all on `main`, pushed)
- `6c25124` Phase 4 — clickable calendar (day-click filter + "+ New on this day"). Harness `verify-f94-dayclick.js` (20/0).
- `b4393c2` **B2** — true F88-resolved post dates. `finflow-f94.js` + `server.js` (`annotateResolvedPostDate` on the 3 recurring GET routes). Harness `verify-f94-resolved-dates.js` (10/0).
- `ba43f6a` **B3+B4** — cash **runway** (opening-cash baseline, dip-day flag, honest fallback) + **missed/late-post** band. `finflow-f94.js` + `server.js` (`normalizeOpeningCash`, entity PUT accepts `opening_cash`). Harnesses `verify-f94-runway.js` (13/0), `verify-f94-missed-posts.js` (7/0).
- `aa2fbc7` **B1+B5** — honest recurring-create labels + agenda time-bucket sections (Overdue/This week/This month/Later). `finflow-f94.js`. Harnesses `verify-f94-create-labeling.js` (6/0), `verify-f94-agenda-sections.js` (8/0).
- `f9792d8` **FIX** — entity mapper (`index.html:6183`, `_loadEntitiesFromDBImpl`) now carries `timezone`, `country`, `opening_cash` onto `ENTITIES`. Without this the runway + F88 chips reverted right after saving, because `saveRegion → reload() → loadEntitiesFromDB()` rebuilt `ENTITIES` dropping those fields.

All F94 harnesses green together: dayclick 20, resolved 10, missed 7, runway 13, labels 6, sections 8, plus the pre-existing `verify-f94-scheduled-page.js` 42.

## ⚠️ TOP PRIORITY — unfixed bug found live: invoice "Total Billed" counts future-dated invoices
**Symptom (owner-confirmed on Railway prod):** a future-dated one-off invoice (Adobe, $10,000, issue Aug 31)
shows on the scheduler correctly, is correctly EXCLUDED from **Outstanding** ($2,000), but is INCLUDED in
**Total Billed** ($41,550). The row can't reconcile: Billed − Collected ($41,550 − $29,550) = $12,000 ≠
Outstanding $2,000, off by exactly the future invoice.

**Root cause (code-confirmed):** the invoice-page KPI renderer computes
`totalBilled = invs.reduce(…)` and `collected = invs.reduce(…)` over **all** `invs`
(`window._realInvoices`), while `outstanding = window._arOutstanding(invs).total` filters out future-dated
rows (the D2 rule: `_dy > today → skip`, `app-main.js` `arOutstanding` ~L2076). So Total Billed disagrees
with (a) its own Outstanding and (b) the **server**, which excludes future-dated from EVERY figure (D2
upper bound, `server.js:6312`, "never recognise a row dated after today"). This is a Rule-6 client/server
divergence.

**Location:** source `public/finflow-api-wiring-postgres.js` (the invoice KPI renderer; appears in the built
bundle at `finflow-bundle.js:5905–5925`, `set('inv-billed', …)`). **This is a BUNDLE source** → the fix
requires `node bundle.js` to regenerate `public/finflow-bundle.js`, and both files get committed.

**Fix (client-only, ~4 lines):** filter `invs` to the recognized non-future set ONCE and compute all three
from it, matching `arOutstanding` + the server:
```js
const _t = window.FinFlowDates.resolvedToday(new Date());
const _recog = invs.filter(i => { const d = window.FinFlowDates._toYmd(i.issue_date||i.created_at||i.date); return d != null && d <= _t; });
const totalBilled = _recog.reduce((a,i)=>a+(parseFloat(i.amount)||0),0);
const collected   = _recog.reduce((a,i)=>a+(parseFloat(i.amount_paid)||0),0);
// outstanding stays _arOutstanding(invs).total (already D2-correct)
```
The future invoice then stays only on the scheduler + invoice list (blue "Scheduled" badge) and drops into
Total Billed automatically on its issue date. Confirm whether the second `totalBilled` at `app-main.js:2492`
(uses `userInvoices`, which the display-mapper may strip `issue_date` from) feeds any live surface; the
bundle/postgres renderer is the one on the Invoices page in the screenshot.

**Harness to add:** seed a paid, an unpaid (past), and a future-dated invoice → assert
Billed − Collected == Outstanding and the future one is excluded from Billed until its date. Note the harness
blind-spot below — prefer exercising the real renderer/data path, not a hand-stubbed KPI.

## Harness blind-spot (the lesson from the mapper bug)
The f94 harnesses stub `window.ENTITIES` / `window._realInvoices` directly, so they never exercised the real
entity mapper or the real invoice-load wiring — which is how the `f9792d8` mapper bug passed a green sweep.
**Recommended:** add a harness that loads the real `loadEntitiesFromDB` mapper (stub `/api/entities`,
assert `timezone`/`country`/`opening_cash` carry through) so "field dropped in a mapper" bugs can't slip past.

## Other open threads (lower priority)
- **Entity-settings relocation (B5 tail):** move the region + opening-cash editor out of the schedule tab
  into a permanent entity-settings home. Cross-surface (touches app nav + `index.html`) — its own task.
- **Track A — integrations surfacing** (see `PLAN_INTEGRATIONS_AND_F94_VIEW_2026-08-28.md`): owner answered
  **A-1 = sandbox / not sure** on keys, which alone explains why connected data is empty. Start at A0 (confirm
  prod vs sandbox keys) before building A1 (un-orphan `page-banking-biz` + connections status hub), A2 (Sync
  now), A3 (Codat import). Connectors are link→sync→materialise; connecting only stores the token.
- **F194 tail (original handoff):** F196 logo-upload UI; the reverted design commit (`b7b5a60`→`eb42a90`)
  redo-vs-leave decision.

## Working conventions confirmed this session
- `finflow-f94.js` ships DIRECT (not bundled). `server.js` is backend (not bundled). `index.html` is NOT a
  bundle source. The 10 `finflow-api-wiring*.js` files ARE bundled by `bundle.js` → any edit needs
  `node bundle.js` + commit `public/finflow-bundle.js`.
- Commit only on a **green sweep** (gated runbook). `verify-f136-paymentsmade.js` is a known FLAKY boot-race
  test (exit-0-MASKED); it clears on a re-run — don't let it block a legit commit.
- Sweep is `node tests/harness/run-verification-sweep.js`; single harness is
  `node -r ./tests/harness/clock.js tests/harness/<name>.js`.
