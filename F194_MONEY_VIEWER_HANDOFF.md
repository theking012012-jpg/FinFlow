# F194 — Money In/Out rich document viewer + line items — HANDOFF

**Purpose:** self-contained handoff so the Claude Code account can finish this initiative without the
Cowork session. Owner runs all commits via PowerShell (deliver + HOLD; never commit without approval).
Last updated: 2026-08-27.

The initiative: replace the bare "Invoice Details" modal with a real, printable document for **every**
Money In / Money Out record, and give invoices (then bills/quotes) **real line items** whose total is the
canonical amount.

---

## Rules that bind this work (do not regrow the codebase's defining defects)

- **Rule 1 (runtime winner).** `saveInvoice` is a **wiring override** (`finflow-api-wiring-medium.js`, in
  the bundle) — the `app-main.js` copy is DEAD. `openInvoiceModal` / `viewInvoice` entry points: confirm
  before editing. `finflow-docview.js` and `finflow-lineitems.js` **ship direct**, loaded `<script defer>`
  AFTER the bundle, so their `window.*` overrides win.
- **Rule 2 (one writer for a money figure).** `amount` is derived **server-side** from `line_items`
  (`amount = round(Σ qty×rate, 2)`). The client sum is a display mirror only. Never let the browser's
  amount become a second source. This applies identically to bills and quotes.
- **Bundle.** Edit the wiring SOURCE; the F13 pre-commit hook runs `bundle.js --from-index` and stages
  `finflow-bundle.js` itself. **Never `git add public/finflow-bundle.js`** (re-stages the working-tree copy
  and defeats the guard). `git add` the wiring source; the hook regenerates from the index.
- **Rule 3/4/5/6 (tests).** Real seeded Postgres + real endpoints; discriminating seeds; assert executed
  values; check money against an INDEPENDENT expected value (hand-computed, not read from the code).
- **Rule 8.** No data migration. `line_items` rides in the `data` JSONB (no schema change); existing rows
  are untouched.
- **Done = full sweep green.** `runuser -u ffrunner -- node tests/harness/run-verification-sweep.js`
  (currently 153 harnesses). Re-run ALL after any fix.

---

## DONE — committed / live

### Phase 1 — reusable document viewer  ✅ COMMITTED `d92f990`
- **`public/finflow-docview.js`** (new, ship-direct). `window.buildDocumentHTML(doc, kind)` renders a full
  white printable doc: letterhead (from settings inputs `s-biz-name/s-address/s-email/s-phone/s-tax-id` +
  logo `window._invoiceLogoDataURL`), a `line_items` table when present else a single summary row from
  `doc.amount`, status badge, subtotal/tax/total, "POWERED BY FinFlow". `window.ffOpenDocView(doc, kind)`
  opens an isolated iframe overlay (`#ff-docview`) with Print/PDF + Close. `KIND` map already has labels for
  **invoice, bill, receipt, credit-note, quote, payment, vendor-credit**. Overrides `window.viewInvoice`
  (merges `userInvoices[idx]` over `_realInvoices[idx]` so `issue_date` + `line_items` flow through).
- **`public/index.html`** — `<script src="/finflow-docview.js" defer>` after the bundle.
- **`tests/harness/verify-docview-invoice.js`** — 11/11 (real client/amount, letterhead from live settings,
  no `buildInvoiceHTML` sample-data leak, line-items Σ). Discriminates red without the override.

### Phase 2a — invoice line items (server-derived amount)  ✅ COMMITTED `3066bc7`
- **`server.js`** — `normalizeLineItems(raw)` (generic; validates array/qty≥0/rate≥0/≤200 rows/total>0,
  derives `amount = round(Σ qty×rate,2)`, returns `{error}` on bad shape). Wired into **POST** and **PUT**
  `/api/invoices`: `_effAmount = _li.present ? _li.amount : amount`, and `line_items` stored when present.
- **`public/finflow-lineitems.js`** (new, ship-direct) — optional Qty/Rate/Description editor;
  `window.ffInvLineItems.{get,reset,addRow,recompute}`; auto-fills + locks `#inv-amount` when ≥1 row.
- **`public/index.html`** — Line items table + `+ Add line` in `#invoice-modal`; `<script defer>` tag.
- **`public/app-main.js`** — `openInvoiceModal` calls `window.ffInvLineItems.reset()`.
- **`public/finflow-api-wiring-medium.js`** — `saveInvoice` reads `ffInvLineItems.get()`, posts
  `line_items`, trusts `saved.amount` (server-derived), unshifts into `userInvoices` + `_realInvoices`.
- **`tests/harness/verify-invoice-line-items.js`** — 21/21. Includes **[Rule 6]** revenue delta
  (a line-items invoice's derived total flows into recognized revenue by exactly Σ). Discriminates: server
  flipped to trust the sent amount → 5 red incl. Rule 6 Δrev=0.
- **Verified:** full sweep **153/153 GREEN, 0 RED**. No device drift on the 4 edited files.

**Commit (owner runs; `git add` the wiring source, NOT the bundle):**
```
git add server.js public/finflow-lineitems.js public/index.html public/app-main.js public/finflow-api-wiring-medium.js tests/harness/verify-invoice-line-items.js
git commit -m "feat(invoices): real line items with server-derived amount (F194, Phase 2a)"  (+ body)
git push
```

---

## REMAINING — to do on the code account

### Phase 2b — line items for BILLS and QUOTES  ⬜ NOT STARTED
Reuse `normalizeLineItems()` (already generic — do NOT fork it).
- **Bills:** `POST /api/bills` (server.js ~1175→ the bills POST at ~2504) and its PUT. Derive `amount`
  the same way. Bill status vocabulary is DIFFERENT (`unpaid/due_soon/overdue/partial/paid`) — don't touch
  it. Expense recognition keys on `issue_date` (server.js ~4288, `RECOGNIZED_BILL`), full amount — same as
  invoices, so the derived amount flows to expenses. Add a Rule-6 expense-delta assertion.
- **Quotes:** find the quotes create endpoint + modal (grep `quotes`, `saveQuote`). Quotes are NOT
  recognized revenue (no money-path assertion needed) — pure document. Still derive amount for the total.
- **Client editor:** the current `finflow-lineitems.js` is invoice-specific (`#inv-*` ids,
  `window.ffInvLineItems`). Either (a) generalize it to take an id-prefix and expose per-modal instances,
  or (b) clone to `ffBillLineItems` / `ffQuoteLineItems`. Prefer (a) so there's one editor implementation.
- **Confirm Rule 1** for `saveBill` / `saveQuote` (find the wiring override, not the app-main copy).
- **Harness:** clone `verify-invoice-line-items.js` → bills (with the expense-delta Rule-6 check) and quotes.

### Phase 3 — roll the document View across the remaining Money In/Out lists  ⬜ NOT STARTED
The renderer + overlay already exist (`ffOpenDocView(doc, kind)`, KIND map complete). Each list currently
has **no** View action (only invoices did). For each of **bills, sales-receipts, payments-received,
credit-notes, quotes, vendor-credits, payments-made**:
1. Add a "View" affordance to the row/list (mirror how invoices got theirs).
2. Write a small `xToDoc(record)` mapper (like `invoiceToDoc` in finflow-docview.js) → `{number, party,
   party_address, issue_date, due_date, status, notes, amount, tax, line_items, currency}`.
3. Call `window.ffOpenDocView(doc, '<kind>')` with the matching KIND key.
- Party label per kind is already in KIND (Bill→"From", receipt→"Received From", etc.).
- Wire these as ship-direct overrides (like docview) or in the relevant wiring source; confirm Rule 1.
- Harness: one per doc type, or a combined `verify-docview-alltypes.js` asserting each kind renders real
  data + correct KIND title.

### Phase 4 — clickable Scheduled Documents calendar  ⬜ NOT STARTED
`public/finflow-f94.js`, `renderCal` (~lines 289–292). Today only `.cell.has` cells (with `data-day`) are
interactive. Owner decision (already made): **Both** — clicking a day (a) filters the agenda to that day
AND (b) surfaces a "＋ New on this day" that opens the create modal pre-filled with that date.
- Make every day cell clickable (not just `.has`).
- Click → filter the agenda list to that `data-day`; render a "＋ New on this day" affordance that opens
  the F94 create-schedule modal with the date pre-filled.
- Harness: assert a day-click filters the agenda and the New affordance carries the clicked date.

### F195 — list-row dates shift a day west of UTC (Rule 10, DISPLAY side)  ✅ COMMITTED `a588852`
**Status 2026-08-27:** implemented and verified (new harness 12/12; full sweep **154/154 GREEN**). On the device
disk, NOT yet committed — the code account commits it. Files: `public/finflow-dates.js` (new `fmtLabel`),
`public/finflow-api-wiring-postgres.js`, `public/finflow-api-wiring-medium.js`, `public/finflow-api-wiring-final5.js`,
`public/app-main.js` (3 mappers), `tests/harness/verify-date-label-tz.js` (new). ⚠️ `app-main.js` also carries
the F196 letterhead change — split by hunk so F195 and F196 are separate commits (see below).
**Sighting:** an invoice with `due_date = '2026-08-16'` shows **"Aug 15"** in the Invoices list row but
**"16 Aug 2026"** in the new document view. The document is CORRECT.

**Cause (verified by reading):** the list row date (`inv.due`, app-main.js:2522) is built by the mapper
`finflow-api-wiring-postgres.js:159-160` as `new Date(r.due_date).toLocaleDateString('en-US', …)`.
`new Date('2026-08-16')` parses a date-only string as **UTC midnight**; `.toLocaleDateString()` renders it
in the viewer's local zone (owner GMT-4) → rolls back to Aug 15. The document view avoids it via
`FinFlowDates._toYmd` (slices a date-only string, "no Date, no TZ"). This is the F87/Rule 10 class applied
to DISPLAY formatting rather than period comparison.

**Class (Rule 13) — every date-only field via `new Date(x).toLocaleDateString()` without the `+ ' 00:00'`
local-midnight trick:**
- `finflow-api-wiring-postgres.js:160` (invoice due — runtime winner), `:178` (expense date)
- `finflow-api-wiring-medium.js:85` (invoice due), `:125` (saveInvoice optimistic dueStr), `:280` (expense date)
- `app-main.js:1515` (invoice due), `:1524` (expense date), `:2580` (dead saveInvoice), `:5489` (a `date`)
- `finflow-api-wiring-final5.js:14` (`fmtDate()` generic — audit every caller; fix only the date-only ones)
- **NOT affected:** `app-main.js:5729/5757` (use `+ ' 00:00'` → local midnight, no shift); `:5738`
  `created_at` (genuine timestamp — per Rule 10, resolve to the entity tz, not a display-shift bug).

**Root fix:** one shared label formatter (e.g. `FinFlowDates.fmtLabel(v)` → `_toYmd(v)` then month/day/year
formatting from the STRING parts, exactly like docview's `dlabel`). Replace every date-only
`toLocaleDateString` with it. Do NOT patch surfaces one at a time.

**Test (Rule 10 corollary):** a timezone matrix that spans the SIGN boundary — at least one POSITIVE UTC
offset — because UTC-4 and UTC-8 misfile identically and a western-only matrix goes green on the bug. Seed a
`due_date` and assert the rendered label equals the stored calendar day under both a positive and a negative
offset. This is display-only (no money figure), so it will not show in the money gates — it needs its own
jsdom harness that reads the rendered row text.

Separate commit from F194 (one fix per commit). Not folded into the line-items work.

### F196 — invoice letterhead shows the ACCOUNT business, not the issuing ENTITY  🟠 TIER 1 COMMITTED `9fe1240`; TIER 2 OPEN
**Sighting:** with **Saige Holdings** the active entity, the invoice document letterhead reads **"Acme"**.

**Cause (verified by reading):** the whole letterhead is built from the **account-wide** settings blob.
`/api/settings` (server.js:1918) is `SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key' IS NULL` —
ONE row per account (no entity scoping), holding `business_name/address/email/phone/tax_id`. It's loaded once
at boot (`finflow-api-wiring.js:103 loadSettingsFromDB`) into `s-biz-name` etc. and never reloads on entity
switch. Entities carry only `name, currency, color, timezone, country` (server.js:1077) — no letterhead
contact fields. So every entity's documents show the same account letterhead ("Acme" = the account
`business_name`). This is the CLAUDE.md Rule 10 "UNDER INVESTIGATION" class: **a setting stored PER-USER
applied to PER-ENTITY output** (same shape as timezone/fiscal-year/display-currency).

**Class (Rule 13):** the entire letterhead — name, address, email, phone, tax-id, logo — on EVERY document
the viewer renders (`finflow-docview.js letterhead()`), PLUS `buildInvoiceHTML` (app-main.js:5958, Templates
preview) which also reads `s-biz-name`. Not just the name, and not just invoices.

**Two-tier fix:**
- **Tier 1 (display, name) — ✅ IMPLEMENTED + VERIFIED (154/154 sweep), on disk pending commit.** In
  `finflow-docview.js letterhead()` the active entity name now wins:
  `name: (e && e.name) || val('s-biz-name') || 'Your Business'` (`ENTITIES.find(x=>x.active).name` is
  confirmed = the active entity; the flag is `active`, index.html:6182/6489). Same flip in `buildInvoiceHTML`
  (app-main.js). `verify-docview-invoice.js` updated: sets `s-biz-name='Account Settings Biz Co'`, asserts the
  letterhead shows the ENTITY name and that the settings name does NOT leak — ran **11/11 green**. Ships as its
  own commit once the full sweep confirms.
- **Tier 2 (feature) — ⬜ OWNER DECISION MADE 2026-08-27: FULL PER-ENTITY PROFILE.** Build this on the code
  account. Each entity gets its own letterhead profile; the account settings keep only app prefs.
  - **Data model (JSONB on the entity, no migration):** add `business_name` (defaults to the entity `name`),
    `address`, `email`, `phone`, `tax_id`, `website`, `logo` to the entity's `data`. `POST/PUT /api/entities`
    (server.js:1076) validate + store them (mirror the F88 timezone/country additions — same shape).
  - **One-time move (Rule 8, owner-gated, its OWN commit):** copy the existing account-wide
    `user_settings` business_name/address/email/phone/tax_id/website onto the FIRST/active entity so nothing
    is lost. Enumerate + report the rows first; do not silently backfill.
  - **Settings load/save:** `loadSettingsFromDB` (finflow-api-wiring.js:51) must load the ACTIVE entity's
    profile into the Business Profile fields (name/address/email/phone/tax_id/website/logo) and RE-LOAD on
    entity switch (hook into `switchEntity`, index.html:6471 — same place F193/currency reload lives). Saving
    the Business Profile writes to the active entity (PUT /api/entities), NOT to `/api/settings`. Leave app
    prefs (dark mode, show cents, currency default, fiscal year, notif toggles) on `/api/settings`.
  - **Letterhead consumes it:** `finflow-docview.js letterhead()` reads the active entity's profile fields,
    falling back to the account blob when a field is unset. Then the Tier-1 name flip becomes a special case
    of the full profile.
  - **Test:** two entities with DIFFERENT profiles; assert the document letterhead (name + address + email +
    tax-id) matches the ACTIVE entity and switches with it; assert the settings panel reloads on switch.

Note F195 and F196 share a root theme (a PER-ACCOUNT setting / an instant leaking onto PER-ENTITY output —
the Rule 10 "under investigation" class). Separate commits throughout.

### F192 — bank-linking regional coverage  ⬜ OWNER DECISION PENDING (not a code task yet)
Logged in AUDIT_MASTER.md. Plaid (US/CA/EU) + Belvo (LatAm) leave ~30 countries uncovered (incl. the
Caribbean). Owner must choose **Tier A** (manual/CSV statement import, works everywhere) vs **Tier B**
(add regional aggregators). No code until the owner decides. FLAGSHIP CURRENCY IS NOT TTD — never describe
any one currency/country as the primary/home/flagship market (now a CLAUDE.md rule).

---

## Quick reference

- Full sweep: `node tests/harness/run-verification-sweep.js` (the `runuser -u ffrunner` prefix is
  Linux-only — on the Windows device repo run node directly). Takes ~50 min: each of the 154 harnesses
  boots its OWN embedded Postgres cluster, sequentially.
- ⚠️ **Do NOT pipe the sweep through `tail`/`head`** — a pipeline returns the LAST command's exit code,
  so the runner's `exit 1` on red is swallowed and a RED sweep looks green. Redirect to a file instead.
- ⚠️ **Rebuild the bundle before trusting a sweep.** The jsdom harnesses boot the BUILT
  `public/finflow-bundle.js`. The F13 pre-commit hook regenerates it into the INDEX only, never the
  working tree, so the working copy silently goes stale and harnesses then test code that is in no
  source file. On 2026-08-27 this produced 2 spurious reds (`verify-date-label-tz`,
  `verify-invoice-line-items`) against a 3-day-old bundle. Run `node bundle.js` first.
- One harness: `runuser -u ffrunner -- node -r ./tests/harness/clock.js tests/harness/<name>.js`
- Rebuild bundle locally (for jsdom harnesses that load the built bundle): `node bundle.js`
- Repo (public): github.com/theking012012-jpg/FinFlow
- Device repo: `C:\Users\theki\OneDrive\Desktop\finflow-FINAL7 (4)`
