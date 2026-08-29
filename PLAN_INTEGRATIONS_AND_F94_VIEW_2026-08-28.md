# PLAN — Linked-API data surfacing + F94 Scheduled Documents (view-first)

**Prepared 2026-08-28.** Sequel to `PHASE4_CALENDAR_HANDOFF.md` (Phase 4 committed `6c25124`).
Two independent tracks. **Track A** (integrations) and **Track B** (F94 view-first) do not depend on
each other — connected-integration data is never F94 content (see A-finding-4). Owner runs verify +
commit in PowerShell; each phase is one-file-where-possible + one harness + full sweep + one commit,
matching the Phase 3/4 rhythm.

---

## TRACK A — make connected integrations actually surface data

### The finding (why "none of the connected data shows up" is current-by-design, not a bug)
Connecting an integration only completes **step 1 of 3**. The app deliberately separates:

1. **Link** — store the OAuth token. `/api/plaid/exchange` (server.js:4808) saves the item and pulls
   **zero** transactions. Same shape for every connector.
2. **Sync** — a *separate* call pulls rows. `/api/plaid/sync` (4851) loops transactions into
   `personal_transactions` with `source:'banking'`. `/api/{finch,codat,belvo,stripe,wise}/sync` mirror this.
3. **Materialise** — for accounting/payroll, a *further owner-gated* import writes into the books.
   Finch/Codat sync is **DISPLAY-ONLY by explicit design** (server.js:4896: "They do NOT auto-write
   payroll_runs / journals / invoices — letting an external source silently author a money figure is the
   multi-writer defect this codebase exists to prevent"). Codat → books happens only via
   `/api/codat/import` (5262); Finch has no books-import at all.

Compounding reasons nothing shows:
- **Env-gated, sandbox-default.** `plaidConfigured()/finchConfigured()/codatConfigured()/belvoConfigured()`
  all require `process.env.*` keys and default to `sandbox` (4706, 4947, 5377). No prod keys ⇒ clean 502
  or sandbox (empty/canned) data. **This is the first thing to confirm — see Decision A-1.**
- **Orphaned display surface.** The linked-banks page `page-banking-biz` (index.html:2929) has **no
  `showPage` reaching it** (OUTSTANDING F192) — synced bank rows have nowhere navigable to render.
- **Store ownership.** Each connector lands on ITS surface only: bank feed → `personal_transactions
  source:'banking'` (bank-rec), Codat → invoices/bills *after import*, Finch → display-only. Never the
  dashboard or F94 automatically.
- **8 connectors still key-pending.** Belvo, Finch, Codat, Paystack, Flutterwave, dLocal, Mercado Pago,
  Wise each need live keys + one sandbox transaction (OUTSTANDING line 133). Plaid/Stripe/WiPay are
  live-verified.

### Principle for Track A
Keep the single-writer discipline. Integrations may **display** freely; writing into the books stays
**explicit and owner-gated**. We are closing the visibility + trigger gap, not loosening the write rule.

### Phases

**A0 — Environment truth (no code; owner + diagnosis). GATES EVERYTHING.**
Confirm per connector: are prod keys set on the server, or sandbox only? Deliverable: a short
`INTEGRATIONS_STATUS.md` table — connector · configured? · env · live-verified? · owning surface.
Nothing below is worth building if the answer is "sandbox only and no intent to add keys yet."

**A1 — Un-orphan + status surface (highest leverage, lowest risk).**
Wire a reachable page (fix `showPage` → `page-banking-biz`, or a new "Connections" hub) that renders,
per connector, the REAL state from the existing status routes (`/api/connections`, `/api/plaid/items`,
`/api/{finch,codat,belvo}/status`): connected? · provider · last sync · row count. No new server code.
- File: `public/finflow-api-wiring-*.js` (client) + a nav entry. Harness: `verify-connections-hub.js`
  (jsdom: stub status routes → assert each connector's real state renders, and a not-configured one
  shows the honest 502 state, never a fake "connected"). Discriminating: today the page is unreachable.

**A2 — "Sync now" trigger + render the result.**
Per connector, a Sync button calling the existing `/sync` route, then load + render the pulled rows on
the owning surface (bank feed → banking/reconciliation list). Surfaces the pipeline that already exists
but nothing invokes. Decision A-2: manual button only, or an hourly auto-sync job (lean: manual first —
explicit, matches single-writer ethos; auto-sync is a later, separate opt-in).
- Harness: `verify-connector-sync-render.js` (stub `/sync` → assert rows land + render + idempotent
  re-sync adds nothing — Plaid sync already dedupes on `plaid_txn_id`, server.js:4866).

**A3 — Codat books-import (owner-gated review flow).**
Wire `/api/codat/import-preview` (5248) → a review table → `/api/codat/import` (5262) that maps to
invoices/bills via `_codatMappers` (5141). Preview-before-write; never silent. Finch stays display-only
unless Decision A-3 says otherwise.
- Harness: extend `verify-codat-import.js`; assert preview lists, import writes link-exact, re-import is
  idempotent, and nothing writes without the explicit import call.

**A4 — F192 region routing + manual CSV/OFX fallback. ⛔ BLOCKED on owner decision (pre-existing).**
Route by entity `country` → Plaid / Belvo / manual import; coming-soon card only when
`!plaidConfigured && !belvoConfigured`. Full scope already written in OUTSTANDING F192 / AUDIT_MASTER.
Do last; it's the largest and already has an owner-decision gate.

---

## TRACK B — F94 Scheduled Documents: view-first

### Decision (locked this session)
**View-primary with a thin, honest action layer.** The page's excellence is *comprehension of what's
about to hit the books*; it is not the place to author documents. Rationale: the highest-value unmet jobs
are all view-excellence (below), the app already owns create/edit for these docs elsewhere, and the
recurring-only create modal is easier to retire than to complete. Ships direct via `public/finflow-f94.js`
(no `node bundle.js`).

### Phases

**B1 — Identity cleanup: stop the page pretending to be a console.**
The "+ New" / "+ New on this day" modal only creates *recurring* schedules yet the page displays one-offs
too — the mismatch the owner hit. View-first resolution: the day-click primary action becomes **"View this
day"** (filter only, already built in Phase 4); creation is demoted to a single secondary affordance that
**deep-links to the real create surface pre-dated** (recurring templates / Invoices / Bills), rather than an
in-page modal that can only do half. Decision B-1: (a) deep-link out [recommended, true view-first], or
(b) keep the recurring quick-add as the one explicit exception because recurring templates lack another
quick entry point — but relabel so it never implies one-off. Either way: no one-off create is built here.
- File: `finflow-f94.js`. Harness: `verify-f94-create-affordance.js` — assert the day-click no longer
  auto-opens a create modal, and the create affordance routes/links as B-1 decides. Discriminating vs
  Phase 4's modal-open behaviour.

**B2 — Truthful post dates (F88-resolved). HAS A SERVER DEPENDENCY.**
Today the calendar/agenda place items on the raw `next_run`. The real post date is
`businessDayShift(next_run, country)` — weekend/holiday "Modified Following" — but that function lives
**server-side only** (server.js:3945; needs `date-holidays`). Rule 10 / single-source forbids
re-implementing the shift in the client. So B2 = **server exposes the resolved date**: add
`resolved_post_date` (and a `shifted` bool) to the recurring rows the client already loads (or a tiny
`/api/scheduled/resolved` endpoint). Then F94 places items on the resolved day and shows "posts Sep 1 ·
shifted from Aug 30 (holiday)".
- Files: `server.js` (expose) + `finflow-f94.js` (consume). Harness: `verify-f94-resolved-dates.js` —
  seed a next_run on a weekend/holiday for a known country, assert the item renders on the shifted business
  day with the "shifted from" note; a weekday item is unshifted. Reuse `businessDayShift` as oracle.

**B3 — Runway, not just net. THE big data-trust decision.**
The forecast starts at 0 ("net effect of scheduled runs") — honest but answers the wrong question. Overlay
projected **cash balance** using a real starting figure so the page answers "will I have enough, and when
do I dip". Decision B-3: which baseline cash figure (the dashboard cash card? a chosen account?), and how
to caveat that un-scheduled real movement isn't modelled. Build strictly behind this decision — a wrong or
un-caveated baseline is worse than the current honest zero.
- Files: `finflow-f94.js` (+ maybe a cash read). Harness: `verify-f94-runway.js` — baseline + scheduled
  items → assert the balance line and the first below-zero day flag; zero baseline reproduces today's
  behaviour (regression guard).

**B4 — Missed / late-post band (trust).**
A recurring row whose resolved date has passed but which shows no materialised doc = the scheduler didn't
fire / a post failed. Detectable from data already in hand (`lastPostedFor`, finflow-f94.js:126 + an
overdue active next_run). Surface a "didn't post as expected" band so the radar catches *failures*, not
just the future.
- File: `finflow-f94.js`. Harness: `verify-f94-missed-posts.js` — a past active next_run with no linked
  materialised doc → appears in the band; one that did post → does not.

**B5 — Density + retire the region-editor squatter.**
At scale, group the agenda "This week / This month / Later". Move the F191 timezone/country editor out of
the Scheduled-Documents entity bar (it landed here only because there was no entity-settings home — it is
not scheduled-docs info) into a proper entity-settings surface.
- Files: `finflow-f94.js` (+ wherever entity settings live). Harness: `verify-f94-density.js` +
  regression that the region-save PUT still works from its new home (guard `verify-f94-scheduled-page.js`
  region assertions don't break — they may need to move).

### Recommended Track-B order
B2 → B4 → B1 → B3 → B5. B2 and B4 are decision-free, pure view-excellence, highest trust value. B1 needs
Decision B-1 and a small nav change. B3 is gated on Decision B-3 (baseline cash). B5 is cleanup + touches
another surface, so last.

---

## Open decisions to collect (gates)
- **A-1** — Prod keys on the server, or sandbox only? (Gates all of Track A.)
- **A-2** — Sync trigger: manual button [lean] vs hourly auto-job.
- **A-3** — Finch: keep display-only [lean, matches single-writer], or add an owner-gated payroll import.
- **B-1** — Create affordance: deep-link out [lean] vs keep relabelled recurring quick-add.
- **B-3** — Runway baseline cash figure + caveat wording. (Gates B3.)

## Verification & commit discipline (unchanged from Phase 3/4)
Every phase: new `verify-*.js` harness that is **discriminating** (goes red on the pre-change code) →
`node -r ./tests/harness/clock.js tests/harness/<harness>.js` green → full sweep
`node tests/harness/run-verification-sweep.js > sweep_pN.txt 2>&1` green → `git add` the touched files +
harness → one scoped commit → push → eyeball. `finflow-f94.js` ships direct (no bundle regen); any
`server.js` change (B2, Track A) is a bundle **source** — confirm whether `node bundle.js` is required for
that file before committing.

## Suggested first action
Track B, **B2 (resolved post dates)** — decision-free, highest-trust, and it makes the calendar *true*
before we build runway on top of it. Needs the small server-side `resolved_post_date` exposure first.
In parallel, answer **A-1** so Track A can start with A0/A1.
