# FinFlow — Master Audit

**Rewritten:** 22 July 2026 · full site-wide re-audit against the code at `f27166d`
**Supersedes:** every prior status in `AUDIT_MASTER_ARCHIVE_2026-07-22.md` (the previous 134 KB document, kept for its fix narratives — do **not** trust its statuses).
**Method:** every row below was re-verified by reading the shipped code, not by trusting a prior row. Where a root cause is uncertain, it says so.
**Provenance:** see [Audit pass log](#audit-pass-log) at the foot of this file — what was read, what was *not* covered, and the reproducible greps behind every count.

---

## ⛔ STANDING RULE — TICK-OFF DISCIPLINE (mandatory, from now on)

> **Every fix that is completed and verified MUST be ticked off in this file in the very next prompt/commit — not later, not batched.**
>
> A fix is not done until its row carries all four of:
> 1. **✅ status**
> 2. **commit hash**
> 3. **what changed** (mechanism, not a restatement of the problem)
> 4. **how it was verified** (the actual check that was run)
>
> **No exceptions. Any work reported as complete without its row ticked is treated as NOT DONE.**
>
> Corollary, learned the hard way from F37 and F50: if a fix covers *part* of a class, the row says **PARTIAL** and lists what is left. "✅ FIXED" on a partial sweep is how this document became untrustworthy.

---

## 🚨 LAUNCH BLOCKERS

One week to launch. This list is deliberately short and deliberately not padded. Each item is here because a paying user hits it in normal use, or because it puts a wrong number on screen.

| # | Blocker | Why it blocks | Est. |
|---|---|---|---|
| ~~**B1**~~ | ✅ **DONE** `e1a8f3e` — **F55** Dashboard KPIs never repainted after a save or delete | harness 16/16; owner live-check outstanding | ~~15 min~~ |
| **B2** | **F64** — every money figure ≥ $1,000 renders abbreviated to 1 decimal (`$1.2K`), including itemized invoice/expense/bill rows; sub-$1K rounds to whole dollars; the "Show cents" setting does nothing | An accounting product that will not show you the exact amount of an invoice is not an accounting product. | 2–3 h |
| **B3** | ✅ **F56 DONE** `0756960` (5 AR surfaces unified) · **F57 still open** — Cash Flow page uses a different basis from the Dashboard | Two adjacent screens show different numbers for the same thing. | ~2 h left |
| **B11** | **F71** — payroll accrues with no effective dating: today's roster is applied retroactively to every past month | Owner-surfaced. Adding an employee today silently changes last January's expenses. **Needs an owner ruling on the basis before coding.** | 0.5 d |
| **B4** | **F58** — credit notes and vendor credits are never applied as contra | Revenue and AP are **overstated** by the full value of every credit note issued. Wrong money, silently. | 4–6 h |
| ~~**B5**~~ | ✅ **DONE** `57ca8b2` — **F60** rolling-vs-fiscal axis mismatch + fabricated Rent, **F61** period-blind bars (+ a stale-row bug found in the same code) | harness 13/13; owner live-check outstanding | ~~1–2 h~~ |
| ~~**B6**~~ | ✅ **DONE** `f36ca7b` — **F62** 9 server GETs fabricated empty results on failure, **F67** client turned failed fetches into empty arrays | harness 42/42; class **C7 closed**; owner live-check outstanding | ~~2–3 h~~ |
| ~~**B7**~~ | ✅ **DONE** `c9d2d16` — **F59** silent FX failure left native money under a foreign label, **+ F70** (found during the fix) 2 of 3 currency controls stamped the *previous* symbol on converted figures | harness 20/20; owner live-check outstanding | ~~30 min~~ |
| ~~**B8**~~ | ✅ **DONE** `532390b` — dedupe guards on the money-bearing create routes. ⚠️ **The audit's list was wrong twice** — see the C1 row | harness 34/34; owner live-check outstanding | ~~2 h~~ |
| **B9** | **F54** — team-member data scope is incoherent: reads and creates are actor-scoped, updates/deletes on 9 tables are account-scoped | An invited member logs in to an **empty app**, and everything they create is invisible to the owner. **Alternative that also unblocks: disable team invites for launch** (hide the invite UI, 403 the route). | 1 d, or 30 min to disable |
| **B10** | **F51 + F65** — honesty pass: 5 placeholder surfaces presented as live features, a "750+ integrations" marketplace banner, and 8 buttons that report a completed action with no backend | Refund/chargeback and trust risk. This is a labelling and button-removal pass, not engineering. | 3–4 h |

**Total blocker estimate: ~3 working days** (or ~2 if team invites are disabled rather than fixed).

### Explicitly NOT blockers — ship after launch
F25, F26 (legacy backfill), F30, F32 residual, F33-companion, F39, F40, F41, F44, F45, F47, F52, F61, F63, F66, F68, F69, class C2 (native dialogs), class C3 (timezone — see caveat below), class C6 (silent catch), PL#5, PL#8, PL#10-recurring.

> **Timezone caveat.** Class C3 is *not* a blocker but it is the one non-blocker most likely to produce a support ticket in week one: 15 server-side record-date defaults stamp **UTC**, so a user at a negative UTC offset recording an expense after ~20:00 local gets **tomorrow's** date, which lands the row in the wrong month at month-end. If there is spare time after the blockers, do the 15 server sites first.

---

## Phase 1 — Reconciliation: what changed in this pass

The previous document was stale in both directions. Summary of every correction:

### Rows that claimed OPEN but had shipped → corrected to FIXED
| Row | Old claim | Verified reality |
|---|---|---|
| **F33** | "CRITICAL OPEN" | **Core FIXED.** One canonical `_periodWindow` (`app-main.js:1693`) feeds both client engines and the server via `?start&end&elapsedMonths` (`server.js:3205-3212`). Commits `d39aed4`, `146019c`. One companion still open — now split out as **F33-C**. |
| **F34** | "Step 1 in progress / A + B pending" | **Path B COMPLETE in code.** Server core `063c98c`/`71a5f24`; all 4 client surfaces present and verified: KPIs (`app-main.js:4383`), chart (`4434`), breakdown (`4451`), transactions (`4465`), investments (`4425`). Native = identity by construction. **New defect on the failure path → F59.** |
| **F48** | "pending approval" | **FIXED.** `98ec1a6` (scope/ownership/overpayment guards) + `d60ecea` (AR = `Σ max(0, amount − amount_paid)`, `server.js:4110-4114`). Verified in code. |
| **F50** | "reopened" | **RE-FIXED** `c16ee28`. Memo un-latch + `_ffEnsureCompleteBoot` + PWA refresh net, all present in `index.html:3630-3740`. |
| **F53** | (already ticked) | **Confirmed closed.** Single `_fmtMoney` (`app-main.js:548`); grep confirms **zero** surviving K-only formatters. But it exposes **F64**. |
| **PL#3** | "partial" | **FIXED** `64eb95c` — `ENTITY_LIMITS` + 402 at `server.js:811-815`. |
| **PL#4** | "open" | **FIXED** `7be0a1d` — page reads `/api/audit-log` (`index.html:4366`). |
| **PL#11** | "open" | **FIXED** `7be0a1d` — `calcAndRenderTax` deleted; no fabrication remains in the client. |
| **F46** | (already ticked) | **Confirmed** — allowlist at `server.js:3094-3095`. |
| **F4** | (already ticked) | **Confirmed** — error handler is at `server.js:4618`, after the last route (`4608`). |

### Rows that claimed FIXED but are not → REOPENED
| Row | Old claim | Verified reality |
|---|---|---|
| **F37** | "✅ FIXED — live-verified" | **REOPENED as PARTIAL.** The sweep touched **`app-main.js` only** (8 sites). **35 UTC record-date sites remain**: 15 server-side, 20 in 9 other client files. Full instance list under class **C3**. This is the exact failure mode the standing rule now forbids. |
| **F26** | "partial" (accurate) | Confirmed still partial — `computeBooks` still reads `sales_receipts` **user-scoped, not entity-scoped** (`server.js:3919`), and legacy rows are still unbackfilled. |
| **F31** | "✅ FIXED" | **Correct for the 3 report routes it covered**, but the class was never swept — **9 more routes still fabricate empty/zero on failure** (→ **F62**). Row narrowed, class opened. |

### Rows confirmed still open, unchanged
F25, F30, F32 (residual `/api/cashflow` reconciliation + Store A row), F33-C, F39 (fixed for invoices), F40, F41, F44, F45, F47, F51, F52, PL#5, PL#8, PL#10, PL#12–15.

### Claims from the old doc that this audit **downgraded or withdrew**
- **"46 appendChild sites — render append vs clear-before-paint."** **Withdrawn as a class.** All 49 `appendChild` sites were read. Every repeat-render site clears first (`c.innerHTML=''` at `index.html:2346`, `catalog.innerHTML=''` at `2377`) or is a run-once injection guarded by `if(!modal)` / an IIFE. **No duplicate-append defect exists.** Two `<select>` option-fill IIFEs (`index.html:5387`) run once at load and are fine.
- **"53 confirm()/alert() sites across 8 files."** Undercount. Actual: **68 sites across 12 files** (40 `confirm`, 28 `alert`). Full list under **C2**.
- **"14 timezone sites."** That was the **server-only** count. Actual total: **35 defect sites** (+ 6 benign formatters correctly left UTC).
- **"58 client save/add handlers, 9 guarded."** Verified in spirit. Precise: **88 client POST call sites** in the main app across 11 files; **9** carry a disable-on-submit guard.
- **"F33 companion: Investments $35.1M is a display bug."** Confirmed correct and closed by F53.

---

## Phase 2 — Class register

A class is only a class if it has a full instance list. Each has one.

### C1 — Duplicate-submit — server side ✅ **CLOSED for money** (`532390b`, 2026-07-22); client-side guards still open

> **⚠️ TWO CORRECTIONS to this row's original list — recorded because both would have produced a fix that looked right and did nothing.**
>
> **1. The tables split two ways, and the existing matcher only works on one.** `findRecentDuplicate` compares `data->>'field'`, so on a **typed** table it compares against NULL and **can never match**. `invoice_payments`, `payroll_runs`, `inventory_movements`, `fx_transactions` are typed. Adding the JSONB matcher to them — the obvious reading of the original row — would have been a **silent no-op** that passed review. New sibling `findRecentDuplicateTyped` (`server.js:778`) matches real columns.
>
> **2. Two routes on the list were already safe.** `fx-transactions` has had an inline typed guard all along (`server.js:4445`); `snapshots/capture` upserts by `period_key` (`server.js:1231`) so it is idempotent by construction. **The real gap was 5 routes, not 7.**
>
> **Bug caught pre-ship:** `inventory_movements` has **no `created_at` column** — it uses `moved_at`. A hardcoded timestamp column would have thrown **42703 on every movement insert**. `tsCol` is now a parameter, and the harness asserts every guarded column *and* timestamp column against the schema parsed out of `database.js`, so this cannot recur.

**Guards added (5):**
| Route | Model | Match key | Consequence of the duplicate |
|---|---|---|---|
| `POST /api/banking` | JSONB | description + amount | duplicate bank transaction |
| `POST /api/invoice-payments` | typed | invoice_id + amount + payment_date | the overpayment check only caught dupes that pushed **past** the balance — two rapid **partial** payments both fit inside it and both booked |
| `POST /api/payroll-runs` | typed | period | duplicate run **and** duplicate `payroll_run_lines` → doubled gross/net |
| `POST /api/inventory-movements` | typed (`moved_at`) | inventory_id + type + quantity | **worst of the set** — a double-clicked sale consumed FIFO layers twice and permanently corrupted COGS. Guard runs **before** `calculateFIFOCOGS` so a duplicate never touches the ledger |
| `POST /api/inventory/:id/restock` | marker | `last_restock_qty` + `last_restock_at` | not an INSERT (it is `units += qty`), so neither matcher applies; guarded with a marker on the row — `inventory` is JSONB, no migration |

**Verified:** 34/34 — every call site checked column-by-column against the parsed schema; reverse check confirms no JSONB matcher points at a typed table; generated SQL asserted for scoping, window, contiguous parameter numbering, and null-handling that does not shift parameter indices.
**Still to confirm live (owner):** double-click *Record Payment* with a partial amount → one payment row, not two. Double-click a sale movement → COGS unchanged by the second click.

**Still OPEN — the client half.** 88 POST call sites in the main app, **9** with a disable-on-submit guard (`index.html:4836`, `4897`, `6331`, `7348`; `app-main.js:494`, `638`, `677`, `725`, `2635`). Server dedupe is now the backstop for money, so this is post-launch: add one `withSubmitGuard(btn, fn)` helper rather than 88 hand-edits.

<details><summary>Original C1 row</summary>

### C1 — Duplicate-submit ✅ mostly closed, 12 gaps
**Server (Layer 3, `findRecentDuplicate`, `server.js:743`):** **27 create routes guarded** — entities, invoices, expenses, customers, inventory, items, payroll, personal_transactions, personal_accounts, goals, projects, holdings, journals, chart_of_accounts, quotes, vendors, bills, recurring_bills, recurring_personal_transactions, recurring_invoices, sales_receipts, payments_received, credit_notes, payments_made, vendor_credits, timesheet, team_members. `fx_rates` has its own typed-column guard (`server.js:4379`).

**Unguarded create routes — 12** (`⚠️` = writes money):
| # | Route | server.js | Risk |
|---|---|---|---|
| 1 | `POST /api/banking` ⚠️ | 3088 | duplicate bank transaction |
| 2 | `POST /api/invoice-payments` ⚠️ | 3603 | invoice settled twice → wrong AR (overpayment guard only catches a *full* re-pay, not two partials) |
| 3 | `POST /api/payroll-runs` ⚠️ | 3726 | payroll run duplicated |
| 4 | `POST /api/inventory-movements` ⚠️ | 4213 | duplicate sale movement → **corrupt FIFO COGS** |
| 5 | `POST /api/fx-transactions` ⚠️ | 4422 | duplicate FX position |
| 6 | `POST /api/inventory/:id/restock` ⚠️ | 991 | double-click adds quantity twice |
| 7 | `POST /api/snapshots/capture` ⚠️ | 1204 | duplicate snapshot skews MoM delta |
| 8 | `POST /api/documents` | 1642 | duplicate doc |
| 9 | `POST /api/templates` | 1675 | duplicate template |
| 10 | `POST /api/autocat-rules` | 1704 | duplicate rule → double-categorization |
| 11 | `POST /api/accountant-messages` | 2822 | duplicate message |
| 12 | `POST /api/bank-reconciliation/match` | 3668 | duplicate match row |

`POST /api/connections` (3492) is an upsert — idempotent by construction, not a gap.

**Client:** 88 POST call sites in the main app; **9 disable-on-submit guards** — `index.html:4836`, `4897`, `6331`, `7348`; `app-main.js:494`, `638`, `677`, `725`, `2635`.

**Course of action:** (a) **blocker** — add `findRecentDuplicate` to routes 1–7 (money); (b) post-launch — routes 8–12; (c) post-launch — a single `withSubmitGuard(btn, fn)` helper applied across the 88 client sites, rather than 88 hand-edits.
**Done when:** a scripted double-POST (same body, <1 s apart) against each of the 12 routes returns the *same* row id twice, not two rows.
</details>

---

### C2 — Native `confirm()` / `alert()` — 68 sites, 12 files
Blocking browser dialogs. Not wrong, but they break the visual language, cannot be styled, are dismissed by browser "prevent additional dialogs", and on the installed PWA look like a system fault.

**`confirm()` — 40 sites**
- `finflow-api-wiring-pages.js` (10): 120, 201, 290, 381, 463, 559, 722, 805, 894, 976
- `finflow-api-wiring-final5.js` (5): 99, 184, 264, 344, 424
- `finflow-api-wiring-stubs.js` (5): 182, 310, 451, 564, 670
- `index.html` (5): 6243, 6382, 7406, 7422, 7439
- `finflow-api-wiring-medium.js` (4): 187, 314, 501, 984
- `app-main.js` (4): 3015, 3758, 4337, 5190
- `finflow-api-wiring-extra.js` (2): 217, 469
- `accountant-dashboard.html` (2): 817, 848
- `finflow-api-wiring-final.js` (1): 253 · `finflow-api-wiring.js` (1): 267 · `admin.html` (1): 1198

**`alert()` — 28 sites**
- `accountant-register.html` (11): 828, 832, 836, 843, 865, 867, 871, 881, 974, 1017, 1025
- `finflow-api-wiring-final5.js` (10): 88, 95, 173, 180, 253, 260, 333, 340, 413, 420
- `index.html` (5): 7359, 7373, 7384, 7391, 7394
- `app-main.js` (1): 2649 · `finflow-api-wiring-stubs.js` (1): 57

**Course of action:** a promise-based `_confirm()` already exists at `index.html:4853` with a comment saying other sites "can migrate to it later" — do that migration; route every `alert()` to the existing `notify(msg, true)`. Mechanical, one file at a time, regenerate the bundle after each wiring source.
**Done when:** `grep -rn "[^a-zA-Z_.]confirm(\|[^a-zA-Z_.]alert(" public/ --exclude=finflow-bundle.js` returns only the `_confirm` definition.

---

### C3 — Timezone: UTC record dates — 35 defect sites 🔴 F37 REOPENED
`new Date().toISOString().slice(0,10)` yields the **UTC** calendar date. This account runs at a negative UTC offset (verified during the F37 work: `todayLocal()` returned 07-19 while UTC read 07-20). Any record created after ~20:00 local is stamped **tomorrow** — which moves it into the wrong month at a month boundary and therefore into the wrong P&L period.

**Server — 15 sites** (record-date defaults):
`server.js`: 902, 1126, 1209, 1564, 2139, 2178, 2218, 2261, 2322, 2362, 3003, 3102, 3621, 4378 · `accountant-routes.js`: 619

**Client — 20 sites** (default-date inputs, none using the existing `todayLocal()`):
- `finflow-api-wiring-final5.js` (10): 60, 72, 144, 157, 224, 236, 304, 316, 384, 396
- `index.html` (3): 4430, 4571, 4833
- `finflow-api-wiring-medium.js` (2): 285, 703
- `finflow-api-wiring-extra.js`: 26 · `finflow-api-wiring-final.js`: 108 · `finflow-api-wiring-pages.js`: 19 · `finflow-api-wiring-postgres.js`: 60 · `accountant-client.html`: 1202

**Correctly UTC — leave alone (6):** `app-main.js:3203`, `finflow-api-wiring-pages.js:643`, `finflow-api-wiring-medium.js:708`, `server.js:2998` (recurrence-interval formatters), `server.js:3271` (FX rate-as-of lookup), `app-main.js` audit-CSV filename.

**Course of action:** client — export the existing `todayLocal()` (`app-main.js:21`) onto `window` and replace all 20. Server — the server **cannot** know the user's local date; it must **stop defaulting dates at all** and either require the client to send one or store `NULL` (this is already the deliberate pattern for `issue_date`, `server.js:859-862`). Do **not** substitute a server-side timezone guess.
**Done when:** a record created at 21:00 local on the last day of a month appears in that month on the dashboard, the Expenses page and `/api/reports`.

---

### C4 — Money formatters ✅ CLOSED (K→M→B), but see F64
Single `_fmtMoney(value, symbol)` at `app-main.js:548` handles K/M/B, sign, zero and caller-supplied symbol. All five formatters delegate: `window.S` (570), `SP` (2790), `SPfrom` (2801), `S2` (3885), `S2b` (`index.html:6513`), plus 12 direct `window._fmtMoney` call sites in `index.html`. **Grep confirms zero surviving K-only or 2-decimal-M sites.** Class closed. The *behaviour* of that single formatter is now **F64** (blocker).

---

### C5 — Free-text inputs with no validation — 17 sites
| Field | Sites | server.js |
|---|---|---|
| **currency** (no allow-list — any 40-char string becomes an entity's currency, then silently fails every FX lookup) | 8 | 802 (`POST /api/entities`), 822 (`PUT`), 1119 (`POST /api/personal-transactions`), 2057 + 2071 (`recurring-personal-transactions` POST/PUT), 4375 ×2 (`fx-rates` from+to), 4423 (`fx-transactions.foreign_currency`) |
| **ticker** (POST uppercases + caps at 20 but validates no charset; **PUT does neither**) | 2 | 1354, 1362 |
| **email** (validated at 4 sites: 408, 2419, 2470, `accountant-routes.js:201`; **unvalidated** where customers/vendors carry one) | 4 | 946 (`POST /api/customers`), 954 (`PUT /api/customers` — writes raw `b[f]`, no type or length check), 1941 (`POST /api/vendors` — `name`/`contact`/`category` inserted **uncapped**), 1953 (`PUT /api/vendors`) |
| **entity/holding name, category** (capped but unvalidated) | 3 | 802, 973, 1013 |

**Course of action:** one `CURRENCY_CODES` allow-list in `tier-config.js`, applied at all 8 currency sites (400 on miss); `/^[A-Z0-9.\-]{1,20}$/` on ticker at both sites; reuse the existing email regex on the 4 customer/vendor sites; cap `POST /api/vendors` strings the way its own PUT already does.
**Done when:** `POST /api/entities {currency:"NOTACURRENCY"}` → 400, and `PUT /api/customers/:id {email:{}}` → 400.

---

### C6 — Silent `catch(e){}` — 45 sites, classified
Read all 45. **Not** a uniform defect.

**Intentional and correct (33)** — chart teardown (`app-main.js:4583`, `4586`, `4442`), optional-render guards (`3663`, `5887`, `finflow-api.js:115`), `sessionStorage` in private mode (`index.html:71`, `finflow-api.js:68`), rollback-after-error (`server.js:2664`), boot-order tolerance (`app-main.js:1453`), etc.

**Genuine bugs — 6, all "a real failure looks like success or emptiness":**
| Site | Effect |
|---|---|
| `app-main.js:4428` (`_applyConvertedKPIs`) | FX conversion failure → native money under a foreign label → **F59** |
| `finflow-api-wiring-medium.js` `loadExpensesFromDB` catch ("Ignore — not logged in yet") | a 500 is indistinguishable from logged-out; page shows empty |
| `finflow-api-wiring-dashboard.js:485` | boot-time entity fetch failure swallowed |
| `finflow-api-wiring-postgres.js:328-329` | vendor/bill reload failures swallowed |
| `finflow-api-wiring-medium.js:59` | entity-activate failure swallowed → user thinks they switched entity, they didn't |
| `index.html:6321` (`catch(err){ }`) | expense fetch failure swallowed |

**Ambiguous — 6:** `admin-routes.js:584,598`; `accountant-client.html:1181,1401`; `accountant-dashboard.html:1109,1205`. Health-check-shaped; low risk; leave with a comment.

**Course of action:** the 6 bugs each get an explicit failure state (the codebase already has the right pattern — `_dashSetState('error')` in `finflow-api-wiring-dashboard.js:378`). Add a one-line comment to the 33 intentional ones so the next audit doesn't re-flag them.
**Done when:** killing the DB and reloading produces visible "Unable to load · Retry" on every money surface, and **no** `$0`.

---

### C7 — Fail-soft fabrication on server GETs ✅ **CLOSED** (`f36ca7b`, 2026-07-22) — was 9 sites 🔴
All 9 now return 500 + a route-specific message (see **F62**). Verified by a whole-file scan: the only surviving bare-empty response is `server.js:2819` ("no accountant linked"), a legitimate result. **Regression guard:** `grep -n "res.json(\[\])\|res.json({})" server.js` must return exactly that one line.

<details><summary>Original instance list</summary>

| Route | server.js | Returns on error | Money? |
|---|---|---|---|
| `GET /api/holdings` | 1339 | `[]` — comment literally says *"fail-soft: empty list keeps the frontend happy"* | ⚠️ zeroes Investments + Net Worth |
| `GET /api/personal-transactions` | 1115 | `[]` | ⚠️ zeroes personal income/expense |
| `GET /api/vendor-credits` | 2308 | `[]` | ⚠️ |
| `GET /api/goals` | 1243 | `[]` | — |
| `GET /api/projects` | 1281 | `[]` | — |
| `GET /api/recurring-bills` | 2012 | `[]` | — |
| `GET /api/recurring-personal-transactions` | 2053 | `[]` | — |
| `GET /api/scenario` | 3456 | `{}` | — |
| `GET /api/connections` | 3489 | `{}` | — |

**Course of action:** replace each with the F31 pattern already in `/api/cashflow` (`server.js:3185-3188`) — `console.error` + `res.status(500).json({error:…})`. A genuinely empty account already returns real `[]` from the success path; only a thrown error reaches the catch.
**Done when:** renaming a table produces 500 + a visible error state, not silent zeros. → tracked as **F62**.
</details>

---

## Findings — OPEN

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

### F54 🟠 HIGH — Team-member data scope is incoherent (reads actor-scoped, writes account-scoped) — **NEW**
**Status:** OPEN, verified in code. Reachable — the invite/accept flow is live and writes `member_user_id` (`server.js:2637-2642`).

**What's wrong.** The account resolver works: an active membership sets `req.accountId` to the owner's id (`server.js:611-645`), and `scopeId(req)` returns it (`711`). But only **86** call sites use `scopeId(req)`; **34 data routes read `req.session.userId` directly**, and every create writes `user_id: req.session.userId`. The split is by table, not by verb:

- **Fully actor-scoped** (member sees + creates in their own empty account): invoices `849/857/863`, expenses `896`, customers `939/943`, inventory `967`, items `1008`, payroll `1102`, journals `1550`, chart_of_accounts `1591`, holdings `1335`, goals, projects, personal_transactions, personal_accounts, snapshots, documents, templates, autocat_rules, audit_log `1629`, timesheet `2351`, banking `3086`.
- **Read actor-scoped but UPDATE/DELETE account-scoped** — quotes `1912/1927`, vendors `1947/1963`, bills `1986/2002`, recurring_bills `2027/2041`, recurring_personal_transactions `2067/2085`, recurring_invoices `2105/2120`, sales_receipts `2154/2159`, payments_received `2193/2199`, credit_notes `2235/2241`, payments_made `2274/2297`, vendor_credits `2339/2345`.

**Consequences.** (1) An invited member logs in to a **completely empty app**. (2) Everything they create lands under their own `user_id` and the owner never sees it. (3) On those 11 tables they can still `PUT`/`DELETE` the **owner's** rows by id, even though the list showed them nothing.

**Course of action.** Pick one and apply it uniformly:
- **Fix (1 day):** replace `req.session.userId` with `scopeId(req)` in every *data* route (reads, creates, `ownedBy()` calls) and keep `req.session.userId` **only** for actor identity — `logAudit`, session writes, `/api/me`, auth routes. `ownedBy(table, id, userId)` (`server.js:713`) gains a `scopeId` caller everywhere.
- **Defer (30 min, recommended for this launch):** hide the team-invite UI and return 403 from `POST /api/team/invite` and `/api/team/accept`. Ship without the team feature; do the sweep after launch.

**Done when:** owner invites a member → member logs in → sees the owner's invoices/expenses → creates an expense → **the owner sees it** → member deletes it → gone for both. And an actor-identity audit row still records the *member's* id, not the owner's.

---

### F55 ✅ **FIXED** (`e1a8f3e`, 2026-07-22) — was 🟠 HIGH — Dashboard Revenue / Expenses / Net Profit never repaint after a mutation
**Status:** ✅ **FIXED & harness-verified.** Owner live-check outstanding (see "Still to confirm live" below).

**What changed.** `refreshFinancials` (`finflow-api-wiring-postgres.js:204-217`) now runs `_refreshDashboardUI()` and `updateDashboard()` as **two sequential steps** instead of `if/else if`. This makes the mutation path identical to the boot path, which already did exactly this (`finflow-api-wiring-dashboard.js:398-400`) — so the fix adopts an existing correct pattern rather than inventing one. The `updateDashboard()` call is wrapped so a KPI render error cannot abort the personal-finance and budget refreshes below it; the error is `console.error`'d, never swallowed (class **C6**).
Also corrected the false comment at `finflow-api-wiring-dashboard.js:459` that claimed *"refreshFinancials calls updateDashboard right after this"* — it did not, and that comment is why the defect survived earlier passes. It now states the requirement on callers.

**How it was verified.** Extracted-block harness, **16/16 green**, run against **both** `finflow-api-wiring-postgres.js` **and** the regenerated `finflow-bundle.js`: both globals run · `updateDashboard` runs **last** · no `else if` survives (structural guard against regression) · a throw in `updateDashboard` does not propagate and **is** logged · missing globals don't throw · `updateDashboard`-only still runs · boot path unchanged · `_refreshDashboardUI` still does not write the canonical trio (guards against a re-introduced F7 double-writer). `node --check` clean; bundle regenerated + drift-checked.
*Harness note:* the last assertion initially failed on the function's own **doc comment**, which names those element ids to warn callers — the check now strips comments and asserts on executable code only. Worth knowing: a raw text grep for those ids in that function reports a false positive.

**Still to confirm live (owner, ~2 min):** with the dashboard open, add an invoice → `d-rev` and `d-profit` move with **no** reload and **no** period switch. Repeat for expense add, invoice delete, bill add.

**Original finding (for the record):**

**What's wrong.** `refreshFinancials` (`finflow-api-wiring-postgres.js:115`) ends with:
```
if (typeof window._refreshDashboardUI === 'function') { window._refreshDashboardUI(); }
else if (typeof window.updateDashboard === 'function') { window.updateDashboard(); }   // :208
```
`_refreshDashboardUI` is defined unconditionally at `finflow-api-wiring-dashboard.js:415`, so the `else` branch is **dead code**. And `_refreshDashboardUI` deliberately does **not** write `d-rev`/`d-exp`/`d-profit` — a comment at `finflow-api-wiring-dashboard.js:462-464` says *"those cards are now owned solely by app-main updateDashboard, which refreshFinancials calls right after this."* **It does not.**

`updateDashboard()` is invoked from exactly two places in the tree: `finflow-api-wiring-dashboard.js:400` (boot / entity switch) and the dead `postgres.js:208`. Plus `_safeRender(updateDashboard)` inside `loadEntityData` and `refreshAllPeriodData` (period switch).

**Effect.** Save an invoice → the invoice list updates, the chart updates, Outstanding updates — **Revenue, Expenses and Net Profit do not**, until you switch period or reload. Same for every delete and every expense.

**Course of action.** Change the `else if` to an unconditional sequenced call — `_refreshDashboardUI()` **then** `window.updateDashboard()` — and delete the misleading comment at `finflow-api-wiring-dashboard.js:462`. One-line change in `postgres.js`; regenerate the bundle.
**Done when:** with the dashboard open, adding an invoice moves `d-rev` and `d-profit` without any reload or period switch. Same for expense add, invoice delete, bill add.

---

### F56 ✅ **FIXED** (`0756960`, 2026-07-22) — was 🟠 HIGH — Outstanding / AR disagreed across five surfaces
**Status:** ✅ **FIXED & harness-verified.** Surfaced by the owner: *Outstanding **$1.4K**, subtitle **"All invoices paid"**.*

**Two defects.** The subtitle only checked whether anything was **overdue** and printed "All invoices paid" whenever nothing was — so a card with real money outstanding was captioned as settled. And `d-outstanding` had **two writers** with **different formulas** (app-main's year-only block + the wiring's `updateKPIs`) — the F7 defect class, regrown.

**What changed.** One canonical `arOutstanding()` (`app-main.js`, exported as `window._arOutstanding`) mirroring the server's `computeBooks` AR leg exactly: `Σ max(0, amount − amount_paid)` over recognized statuses, returning counts too. Applied to **all five** drifted surfaces — dashboard card, invoice stats panel, Invoices page, Payments Received page, customer-detail modal. app-main no longer writes the card at all; the wiring owns it, matching the ownership split already documented there. Subtitle is three-way: *N overdue* / *N unpaid* / *All invoices paid*, amounts suppressed under a display currency.

**Also fixed while here.** `refreshFinancials`' invoice mapper **dropped `amount_paid`** (which `loadEntityData` carries), so after *any* refresh `userInvoices` lost it — and `markInvoicePaid`, which settles `amount − amount_paid`, would try to pay the full amount again on a partially-paid invoice and be rejected **400** by the server's overpayment guard.

**How it was verified.** 30/30. The client helper is compared **case-by-case against a transcription of the server's own AR leg** — fully unpaid, fully paid, partially paid, overdue partial, draft, void, over-credited, legacy status-paid-without-`amount_paid`, mixed book — so the two are checked against *each other*, not against my assumption of the server. Plus: the old formula asserted to genuinely differ, "All invoices paid" unreachable with a non-zero count, app-main writing neither value nor subtitle, every surface calling the one helper, both mappers carrying `amount_paid`.

**Still to confirm live (owner):** record a $400 payment against a $1,000 invoice → dashboard, Invoices page and `/api/reports` all read **$600**, subtitle reads "1 unpaid invoice".

**Original finding (for the record):**

**What's wrong.** Three different formulas write "Outstanding":

| Surface | Formula | Site |
|---|---|---|
| Dashboard card `d-outstanding` (native path) | `Σ amount` over `status !== 'paid'` | `finflow-api-wiring-dashboard.js:188` (and `app-main.js:1975`, year-only) |
| Invoices page `inv-out` | `Σ amount` over `status !== 'paid'` | `finflow-api-wiring-dashboard.js:310`, `postgres.js:129` |
| `/api/reports` + `/books` | `Σ max(0, amount − amount_paid)` over **all recognized** statuses | `server.js:4110-4114` |

Two divergences: (a) a **partially paid** invoice contributes its *full* amount on the client and its *remaining* balance on the server — the exact case F48's AR work was built for; (b) an invoice in a **non-recognized** status (anything outside `pending|overdue|partial|paid`) is counted by the client and excluded by the server.

Secondary: `app-main.js:1973` only writes `d-outstanding` when `currentPeriod==='year'` — but `updateKPIs` overwrites it unconditionally with an all-time figure moments later, so the card ignores the period selector entirely (consistent with the server, which also treats AR as an all-time snapshot — so this half is *correct*, just accidentally).

**Course of action.** Delete both client formulas. Have `updateKPIs` and `updateInvoiceStats` read `outstanding` from the `/api/reports` response the dashboard already fetches, exactly as `_applyConvertedKPIs` does at `app-main.js:4412`. One source, one number.
**Done when:** record a $400 payment against a $1,000 invoice → dashboard Outstanding, Invoices-page Outstanding and `/api/reports.outstanding` all read **$600**.

---

### F57 🟠 HIGH — Cash Flow page uses a different basis from the Dashboard — **NEW**
**Status:** OPEN, verified.

**What's wrong.** `updateCashflow` (`app-main.js:2017`) writes `cf-in`/`cf-out`/`cf-net` from `getPeriodData()` → the `REV[]`/`EXP[]`/`PROFIT[]` monthly buckets. Those buckets **exclude payroll and COGS** by construction (`server.js:4152` comment: *"NO payroll/COGS (the chart never included them)"*; `finflow-api-wiring-dashboard.js:46-108`). Meanwhile `updateDashboard` writes `d-exp` from `computeExpenseBreakdown().total`, which **includes** payroll, and `d-profit` subtracts COGS (`app-main.js:1937-1944`).

So for any business with payroll or inventory, **Dashboard Net Profit ≠ Cash Flow Net**, on the same screen-pair, same period.

Compounding, inside the same function:
- `cf-fixed` + `cf-variable` are computed from `computeExpenseBreakdown().byCategory`, which contains **only raw expense rows** — no bills, no payroll — so `cf-fixed + cf-variable ≠ cf-out` (`app-main.js:2029-2038`).
- `computeExpenseBreakdown()` is called there with **no period argument**, so it silently defaults to `currentPeriod` while `d.exp` is period-scoped by the caller — two windows in one card.
- Income-sources percentages divide `_topClients` (built from **paid-only** invoices, `app-main.js:1451-1457`) by `d.rev` (accrual) → percentages that don't sum sensibly (→ **F69**).

**Course of action.** Rewire `updateCashflow` onto `computeRevenue(period)` / `computeExpenseBreakdown(period)` — the same canonical pair `updateDashboard` uses — and derive fixed/variable from the **full** breakdown (`realExpenses + issuedBills + paymentsMade + payroll`), not `byCategory` alone. If the intent is genuinely *cash* basis rather than accrual, then say so on the card and source it from `POST /api/reports/cash-flow` — but do not leave two accrual numbers disagreeing.
**Done when:** Dashboard Net Profit == Cash Flow Net at month, quarter and year, on an account with payroll and inventory; and `cf-fixed + cf-variable == cf-out`.

---

### F58 🟠 HIGH — Credit notes and vendor credits are never applied as contra — **NEW severity** (was PL#10, 🟡)
**Status:** OPEN, verified.

**What's wrong.** `computeBooks` (`server.js:3915-3922`) loads exactly six collections: invoices, expenses, payments_made, payroll, sales_receipts, bills. **`credit_notes` and `vendor_credits` are read by neither engine.** They are pure CRUD — `server.js:2205-2241` and `2302-2345`, plus client render functions — and never touch a total.

**Effect.** Issue a $2,000 credit note against a customer and **revenue stays $2,000 too high, forever**, on the dashboard, on `/api/reports`, on `/books`, in the accountant portal, and in the AI's answers. Same for vendor credits against AP. Under the issue-based accrual basis the audit committed to (F32 decision note, 18 Jul), a credit note is contra-revenue at its issue date — its absence is a straightforward overstatement.

**Course of action.** Add both as negative legs in **both** engines, symmetrically with the existing bill leg:
- server `computeBooks`: load `credit_notes` + `vendor_credits`; subtract at `date`/`issue_date` inside `inPeriod`, through `sumFX` so FX conversion and coverage flagging come free; add a status allow-list mirroring `RECOGNIZED_BILL` (a `Void` credit note must not reduce revenue).
- client `computeRevenue` (`app-main.js:1717`) and `computeExpenseBreakdown` (`1612`): same subtraction on `window.creditNotes` / `window.vendorCredits`, same `_periodWindow`.
- also subtract from the monthly buckets (`server.js:4147`, `finflow-api-wiring-dashboard.js:64`) so the chart matches.

Linking a credit note to a specific source invoice (proper contra-AR) is a **larger** change — do the aggregate revenue reduction now, the per-invoice link after launch.
**Done when:** a $2,000 credit note dated in the period drops revenue by exactly $2,000 on the dashboard, `/api/reports`, `/books` and the overview chart; a `Void` credit note changes nothing.

---

### F59 ✅ **FIXED** (`c9d2d16`, 2026-07-22) — was 🟠 HIGH — FX display-currency overlay failed silently → native money under a foreign label
**Status:** ✅ **FIXED & harness-verified.** Owner live-check outstanding.

**What changed.** `if(!r.ok) return;` now `throw`s, and the bare `catch(e){}` is a real handler: it blanks all five cards (`d-rev`, `d-exp`, `d-profit`, `d-outstanding`, `d-invest`) to `—` with the hint *"Could not convert to XXX…"* and logs via `console.error` (class **C6** — logged, never swallowed). The `set`/`dash` helpers moved above the `try` so the catch can reach them. The stale-response guard is preserved: a late failure from a currency the user has already switched away from does **not** clobber the newer paint.
**Native flash removed:** `updateDashboard` (`app-main.js:1948-1957`) no longer paints native amounts into the trio when a display currency is armed — `S()` stamps the *display* symbol, so a native value renders under a foreign sign for the whole fetch. It shows `…` and lets the overlay fill. `updateKPIs` (`finflow-api-wiring-dashboard.js:196-211`), which runs *after* the overlay is kicked off, no longer writes `d-outstanding`/`d-invest` under a display currency; the overlay owns them. The invest change-line falls back to a currency-agnostic P/L **percentage**. **Native path byte-identical.**

**How it was verified.** Extracted-function harness, **20/20 green** — the real `_applyConvertedKPIs` run against a stubbed DOM and `fetch`: HTTP 500 · network throw · malformed JSON · success · no-rate-for-pair · **stale-response race**. Plus structural gates on the two flash fixes. F55 harness re-run, still 16/16. `node --check` clean; bundle regenerated + drift-checked.

**Still to confirm live (owner, ~2 min):** set a non-native display currency, block `/api/reports` in DevTools → all five cards must read `—` with a tooltip, **never** a native number under the foreign symbol.

> **⚠️ Landmine documented, deliberately NOT fixed.** `patchSFormatter` calls `fxConvert(n)` with **one** argument (`app-main.js:571`) while `fxConvert` takes **three** (`index.html:5221`) — so it hits its own `!rates[from]` guard and returns the amount unchanged. **`S()` has never converted; it only swaps the symbol.** That is *required* for correctness: the server returns already-converted figures, so a working client-side `fxConvert` would **double-convert every number on the dashboard**. Do not "fix" the arity.

**Original finding (for the record):**

**What's wrong.** `_applyConvertedKPIs` (`app-main.js:4383`) is fire-and-forget from `updateDashboard` (`app-main.js:1948`). On failure it bails without touching the DOM:
```
if(!r.ok) return;                       // app-main.js:4394 — silent
...
}catch(e){}                             // app-main.js:4428 — silent
```
The currency pill has already been relabelled by `updateCurrency` (`app-main.js:4378`), so the user sees **USD figures labelled TTD**. That is the original F34 defect verbatim.

Two adjacent, smaller instances of the same shape:
- `_applyConvertedChart` (`app-main.js:4434`) returns early when `monthly.complete===false`, leaving the **native** chart under the converted label. The comment argues the KPIs already show "—", but the chart still displays native numbers in a foreign currency.
- Ordering: `updateKPIs()` (native) runs *synchronously after* `_applyConvertedKPIs` is kicked off, so `d-outstanding` and `d-invest` visibly flip native → converted on every repaint.

**Course of action.** On any non-native display currency, set the five cards to `'…'` **before** the fetch and to `'—' + title="Could not convert to XXX — retry"` on failure or throw, reusing the existing `dash()` helper at `app-main.js:4400`. Make `updateDashboard` `await` the overlay (or gate the native `updateKPIs` writes behind `!window._displayCurrency`) so there is no native→converted flip. Apply the same `—` treatment to the chart when `monthly.complete===false`.
**Done when:** with a display currency set and `/api/reports` blocked in DevTools, every business figure shows `—` with a hint — never a native number under a foreign symbol.

---

### F60 ✅ **FIXED** (`57ca8b2`, 2026-07-22) — was 🟠 HIGH — Dashboard expense bars: wrong month index + fabricated Rent
**Status:** ✅ **FIXED & harness-verified.**

**What changed.** **(a)** The `EXP_SAL/RENT/SW/MKT` fill in `_refreshDashboardUI` now builds its month list from the `#s-fy` fiscal start, exactly as `buildMonthlyArrays` does, instead of a rolling last-12-months window — so the arrays share the fiscal axis with `REV[]`/`EXP[]`/`MONTH_FULL[]`/`currentMonthIdx`. **(b)** `getPeriodData` sums rent over the period (`sum(EXP_RENT,qs,e)` / `sum(EXP_RENT,0,12)`) instead of `EXP_RENT[0]*3` / `*12`.

**Blast radius checked before editing — this is why the fix is "correct in place" rather than "delete".** `d.sal/d.rent/d.sw/d.mkt` are also read by `buildRiver` (`app-main.js:5720-5779`) and the AI insights (`:4231`, `:4237` — "Payroll cost this quarter"). Removing them, the tidier-looking fix, would have broken both. Correcting the arrays fixes those consumers too: the AI payroll insight and the river diagram were reading the wrong months.

**Deliberately NOT done here.** The larger re-architecture — feed the bars from `computeExpenseBreakdown().byCategory` and retire the `EXP_*` arrays entirely — needs `buildRiver` and the AI insight migrated in the same pass. Tracked as a post-launch refinement, not left implicit.

**How it was verified.** 13/13 harness. The two axes are *proven to genuinely differ* (so the defect was real, not theoretical); the fill block is asserted to construct months identically to `buildMonthlyArrays`; the rent fix is exercised **behaviourally on the real `getPeriodData`** with one-month, in-quarter, out-of-quarter and varying-rent datasets (year: 1 month stays 1 month, not ×12; varying rent reports the true total).

**Still to confirm live (owner, ~2 min):** record rent in one month only → Year view shows that one month's rent, not 12×. Check the Salaries bar matches the month you're actually viewing.

**Original finding (for the record):**

**Two defects in one place.**

**(a) Axis mismatch.** `_refreshDashboardUI` fills `EXP_SAL/EXP_RENT/EXP_SW/EXP_MKT` on a **rolling-last-12-months** index (`finflow-api-wiring-dashboard.js:428-433` — `new Date(_n.getFullYear(), _n.getMonth() - _i, 1)`), while `REV[]`, `EXP[]`, `MONTH_FULL[]`, `currentMonthIdx` and `getPeriodData()` are all **fiscal-year** indexed (`buildMonthlyArrays`, `finflow-api-wiring-dashboard.js:50-59`). With today = July 2026 and a January fiscal start, rolling index 0 = **Aug 2025** but fiscal index 0 = **Jan 2026** — the arrays are read **5 months out of alignment**. `getPeriodData()` then slices them with fiscal indices (`app-main.js:1571`, `1583`, `1592`).

**(b) Fabricated Rent.** `getPeriodData()` does not sum rent — it extrapolates it:
```
quarter: rent: EXP_RENT[0]*3      // app-main.js:1583
year:    rent: EXP_RENT[0]*12     // app-main.js:1592
```
`EXP_RENT[0]` is one month's rent (and, per (a), the *wrong* month's). Multiplying it is an invented number — the same fabrication class as F3/F7/F31.

**Mitigating but not exonerating:** the patched `window.updateDashboard` calls `updateExpenseBars(window._realExpenses)` **last** (`finflow-api-wiring-dashboard.js:392`), which overwrites all four rows with all-time top-4 category totals — so the fabricated value is usually painted over within the same tick. It is still computed, still rendered first, and is what shows if that wiring hasn't booted. And the overwrite introduces **F61**.

**Course of action.** Delete the `EXP_SAL/RENT/SW/MKT` arrays and the `d.sal/rent/sw/mkt` fields from `getPeriodData()` entirely — they are a pre-API vestige with no correct consumer. Feed the four bars from one period-scoped source: `computeExpenseBreakdown(period).byCategory`, top 4 by amount. That fixes (a), (b) and F61 together.
**Done when:** with rent recorded in only one month, the year view shows that **one** month's rent — not 12×; and switching Month/Quarter/Year changes the bars.

---

### F61 ✅ **FIXED** (`57ca8b2`, 2026-07-22) — was 🟡 MEDIUM — Dashboard expense breakdown ignored the period selector
**Status:** ✅ **FIXED & harness-verified.**

**What changed.** `updateExpenseBars` (`finflow-api-wiring-dashboard.js:241`) now filters its rows through the canonical `_periodWindow(currentPeriod)` before aggregating, so the bars agree with the Expenses KPI above them. `currentPeriod`/`currentMonthIdx` are top-level `let`s in `app-main.js` — shared global lexical scope across classic scripts — so the code uses `typeof` guards, not `window.*` lookups, which would be `undefined`.

**Bonus defect fixed in the same place.** The paint loop only wrote as many rows as there were categories (`sorted.slice(0,4).forEach`), so a period with fewer than 4 categories left the surplus rows displaying the **previous period's amounts and labels** — stale money presented as current. All four rows are now cleared to `—` before painting.

**How it was verified.** Real `updateExpenseBars` run against real rows: month view excludes an out-of-period expense and still shows in-period ones; year view includes everything; a 2-category period blanks the other two bars to `—` rather than leaving `STALE`.

**Original finding (for the record):**

`updateExpenseBars(expenses)` (`finflow-api-wiring-dashboard.js:230`) sums **all-time** categories with no date filter, and runs **last** in the patched `updateDashboard`, so it wins. Selecting Month or Quarter changes every other card but not the expense breakdown. Same defect shape as F45 (budget actuals) and F44 (scenario base).
**Done when:** switching to Month changes the four bars to that month's categories only.

---

### F62 ✅ **FIXED** (`f36ca7b`, 2026-07-22) — was 🟠 HIGH — 9 server GETs fabricated empty/zero on a query error (class **C7**; F31's unswept remainder)
**Status:** ✅ **FIXED & harness-verified.** Class **C7 CLOSED.**

**What changed.** All 9 routes now return **500** with a route-specific message instead of `[]`/`{}`, keeping their existing `console.error` diagnostics (user id + pg error code): personal-transactions, goals, projects, holdings, recurring-bills, recurring-personal-transactions, vendor-credits, scenario, connections.
**Fresh-install safety was checked before changing them** — `db.allByUser` already self-heals a known-but-missing table via `_ensureTable` and returns a genuinely empty `[]` (`database.js:681`), so a first-boot missing table never reaches these catches. Only real failures do. Asserted in the harness, not assumed.
The only bare empty response left in `server.js` is the documented "no accountant linked" case at `:2819` — a legitimate result, not a failure path.

**How it was verified.** 27 route-level assertions (each of the 9 × returns 500 / no fabricated empty / still logs) + a whole-file scan proving the single legitimate exception + the `42P01` self-heal guard. Part of the **42/42** green F62/F67 harness.

**Still to confirm live (owner, ~3 min):** rename the `holdings` table in the DB → the Investments card must show an error state with a Retry, **not** `$0`. Rename it back.

**Original finding (for the record):**

The `/api/holdings` case is the sharpest: `server.js:1336-1340` catches, logs, and returns `[]` with the comment *"fail-soft: empty list keeps the frontend happy."* A transient DB error therefore renders **Investments $0** and **Net Worth minus the whole portfolio** — indistinguishable from a real empty portfolio. F31 established that this is unacceptable on money surfaces and fixed it on three report routes; the class was never swept.

**Course of action:** apply the F31 pattern (`server.js:3185-3188`) to all 9. Prioritise the three that carry money: holdings, personal-transactions, vendor-credits.
**Done when:** with `holdings` renamed in the DB, the Investments card shows an error state with a Retry, not `$0`.

---

### F63 🟡 MEDIUM — `bootDashboardWiring` re-wraps `window.updateDashboard` on every call — **NEW**
**Status:** OPEN, verified.

`bootDashboardWiring` (`finflow-api-wiring-dashboard.js:355`) does `const _origUpdateDashboard = window.updateDashboard; window.updateDashboard = function(d){ _orig(d); updateKPIs(...); updateExpenseBars(...); updateTransactions(...); updateInvoiceStats(...); }` with **no idempotency guard**. `loadEntityData` calls it on every entity load (`app-main.js:1453`). Each entity switch therefore adds a wrapper layer: after N switches, one `updateDashboard()` runs the four renderers **N times**, each re-parsing and re-writing the same DOM. Grows without bound for the session.

**Course of action:** guard with a module-scoped `let _patched = false;` around the wrap (the file already uses this pattern for `_booted` at `finflow-api-wiring-dashboard.js:472`).
**Done when:** after 10 entity switches, one `updateDashboard()` produces exactly one `updateKPIs` invocation.

---

### F64 🟠 HIGH — Money is abbreviated everywhere, including itemized rows; "Show cents" is dead — **NEW**
**Status:** OPEN, verified. *Pre-existing behaviour, not an F53 regression* — `patchSFormatter` abbreviated before `96ef6c3` too (verified against `96ef6c3^`). F53 unified the thresholds; it did not change where abbreviation applies.

**What's wrong.** `patchSFormatter` (`app-main.js:567`) replaces `window.S` at init (`app-main.js:1217`) with `_fmtMoney`, which abbreviates **every** value ≥ $1,000 to one decimal and rounds everything below $1,000 to whole dollars (`app-main.js:553-558`). `S()` is the app's universal money renderer — it is used for KPI cards *and* for every table row:

- Invoice list rows: `S(inv.amount)` — `finflow-api-wiring-medium.js:208`, and again in the reminder button's `data-amount` (`212`)
- Every `money()` helper delegates to `S`: `finflow-api-wiring-dashboard.js:22`, `-extra.js:24`, `-medium.js:1020` & `1163`, `-postgres.js:259`

So a $1,234.56 invoice renders **`$1.2K`** in the invoice table. A $12,500 bill renders `$12.5K`. A $47.80 expense renders `$48`. The exact amount is **not displayed anywhere in the product**.

Separately, the **"Show cents"** setting (`index.html:3109`) is persisted (`show_cents`, `app-main.js:4495`) and restored into the checkbox (`finflow-api-wiring.js:73`), but the only code that reads it is the *pre-patch* `S()` at `app-main.js:1517` — which is overwritten at init. The toggle does nothing. A cosmetic lie in Settings.

**Course of action.** Split the concern — abbreviation is a *dashboard-card and chart-axis* affordance, not a money-rendering rule:
1. Add `_fmtMoneyExact(value, symbol)` — full `toLocaleString` with 2 decimals, honouring `#s-cents`.
2. Point `window.S` at the **exact** formatter (it is the general-purpose renderer).
3. Keep `_fmtMoney` (abbreviated) and use it explicitly at the ~12 KPI-card and chart-tick sites that want it — they already call `window._fmtMoney` directly in `index.html`, so this is mostly already the shape.
4. Wire `#s-cents` into `_fmtMoneyExact` so the setting becomes true.

Do **not** try to make one formatter serve both — that is what produced the drift F53 fixed.
**Done when:** an invoice for $1,234.56 shows `$1,234.56` in the invoice table with cents on and `$1,235` with cents off; the dashboard Revenue card still shows `$35.2M`; and toggling Show cents visibly changes the tables.

---

### F65 🟡 MEDIUM — 8 controls report a completed action with no backend — **NEW** (honesty)
**Status:** OPEN, verified. Ships as part of the **B10** honesty pass.

| Control | Site | Claims |
|---|---|---|
| "Rebalance ↗" (Investments) | `index.html:1919` | "Rebalance plan generated ✦" |
| "Send email" (Client Portal) | `index.html:6369` | "Email sent to {client} ✦" |
| "Contact sales" (Pricing) | `index.html:2718` | "Opening enterprise enquiry form… ✦" |
| "Send test" (Notifications) | `app-main.js:5628` | "Test email sent to your address ✦" |
| "Browse all 750+ ↗" | `app-main.js:6127` | "Opening full marketplace…" — under a banner claiming **"750+ apps & services"** that do not exist |
| "Build an app +" | `app-main.js:6128` | — |
| Advisor card click / "Contact" | `app-main.js:6071` | "Connecting you with {name}…" (`ADVISORS = []`) |
| `submitAdvisorApp()` | `app-main.js:6087` | "Application submitted — we'll review within 2 business days ✦" — **no network call at all** |
| "Edit" (Items table, app-main fallback) | `app-main.js:4764` | toasts the item name and does nothing (superseded by `finflow-api-wiring-medium.js:861` at runtime — verify, then delete the dead fallback) |

Honest by comparison: "Export as PDF coming soon ✦" (`app-main.js:5116`) — that one is fine.

**Course of action.** Remove the button, or replace the toast with an honest "Not available yet". Delete the "750+ apps & services" banner outright — it is a factual claim about capability. Keep no control that reports success it did not achieve.
**Done when:** no click in the product produces a success message for work that did not happen.

---

### F66 🟢 LOW — `PUT /api/customers/:id` and `POST /api/vendors` write unvalidated strings to JSONB — **NEW**
**Status:** OPEN, verified. Part of class **C5**.

`PUT /api/customers/:id` (`server.js:954`) copies `['fname','lname','company','industry','email','phone','status','notes']` straight from the body — no trim, no length cap, no type check — so an object, array or 500 KB string lands in JSONB. Its sibling `POST` does cap. `POST /api/vendors` (`server.js:1941`) inserts `name`, `contact`, `category` raw, while its own `PUT` (`1953`) caps all three. Blast radius is bounded by `express.json({limit:'500kb'})`, so this is durability/consistency, not a DoS.

**Course of action:** mirror the caps the sibling routes already use; add `String(...)` coercion; run the email regex on `email`.
**Done when:** `PUT /api/customers/:id {email:{"a":1}}` → 400, and a 400 KB `notes` is rejected or truncated at 500.

---

### F67 ✅ **FIXED** (`f36ca7b`, 2026-07-22) — was 🟡 MEDIUM — Client turned failed entity fetches into empty arrays
**Status:** ✅ **FIXED & harness-verified.**

**What changed.** `loadEntityData`'s `res.ok ? json : []` across all five entity fetches is replaced by a `_pick(res, label)` helper that distinguishes the two cases the old ternary conflated: **401/403 is genuinely nothing** (logged out / no access) and still yields `[]`; **anything else throws**. The catch escalates `console.warn` → `console.error` and paints the shared dashboard error state (`_dashSetState('error')`, now exported from the dashboard wiring rather than duplicated), gated on `window._ffAuthed` so no error state appears pre-login.

**Follow-up (`6b8ecf2`) — self-review caught a defect in the first cut.** The comment claimed only invoices/expenses were fatal; the code made **all five** fetches fatal, so a 500 on customers/inventory/payroll killed the whole dashboard where it previously rendered invoices and expenses fine — a resilience regression, worse than the bug. `_pick` now takes an explicit `fatal` flag: **invoices + expenses fatal** (they drive every money figure; a partial set renders as smaller, wrong totals with no sign anything is missing), **customers + inventory + payroll degrade to `[]`** with a warning. *Same false-comment pattern that let F55 survive three audits — worth noting as a recurring failure mode, not a one-off.*

**How it was verified.** `_pick` extracted and exercised against ok / null-body / 401 / 403 / 400 / 500 / 502; money collections asserted to **throw**, the three list surfaces asserted to **degrade without throwing**, plus a wiring check that the flags are passed the right way round at all five call sites; catch-block assertions for the error paint, log escalation and auth gate; regression guard that the old ternary is gone. **47/47** green.

**Still to confirm live (owner, ~1 min):** block `/api/invoices` in DevTools and switch entity → dashboard shows the error state with a Retry, not `$0`.

**Original finding (for the record):**

`loadEntityData` (`app-main.js:1330-1335`): `const invoices = invRes.ok ? (await invRes.json() || []) : [];` — repeated for expenses, customers, inventory, payroll. A 500 becomes `[]`, which flows into `_realInvoices`/`_realExpenses`, into `buildMonthlyArrays`, into `computeRevenue`, and paints a **$0 dashboard with no error state**. The client-side mirror of C7/F62. The correct pattern already exists in the same tree (`apiGetStatus` + `_dashSetState('error')`, `finflow-api-wiring-dashboard.js:340-380`).

**Course of action:** treat a non-ok response as a throw, and surface `_dashSetState('error')` when `window._ffAuthed` — never substitute `[]`.
**Done when:** blocking `/api/invoices` in DevTools shows the dashboard error state with a Retry, not `$0`.

---

### F68 🟢 LOW — Installed PWA has no service worker — **NEW**
`public/manifest.json` declares `display:standalone` and `start_url:/app`, but there is **no service worker anywhere** (grep: no `serviceWorker`, no `sw.js`, no registration). Every PWA cold-launch is a full network load of `app-main.js` + a 304 KB deferred bundle — which is precisely the window F50's boot race lived in. Icons also declare `purpose:"any"` only, so Android renders an unmasked icon.
**Course of action:** post-launch — a minimal cache-first SW for the app shell (`/app`, `/app-main.js`, `/finflow-bundle.js`, icons), network-first for `/api`. Add a `purpose:"maskable"` icon entry.
**Done when:** a second PWA launch paints the shell from cache and the F50 race window closes structurally rather than by re-fire.

---

### F70 ✅ **FIXED** (`c9d2d16`, 2026-07-22) — was 🟠 HIGH — 2 of 3 currency controls showed converted money under the *previous* currency's symbol — **NEW, found while fixing F59**
**Status:** ✅ **FIXED & harness-verified.** Owner live-check outstanding.

**What was wrong.** The patched `S()` stamps `CURRENCIES[activeCurrency].symbol` on every figure (`app-main.js:573`), but `activeCurrency` was assigned by only **one** of the three currency controls:
| Control | Path | Before |
|---|---|---|
| Header pill | `setCurrency()` → sets `activeCurrency`, then `_applyDisplayCurrency()` | ✅ correct |
| Settings dropdown `#s-currency` | `updateCurrency()` → `_applyDisplayCurrency()` only | ❌ **wrong symbol** |
| Mobile drawer `#smc-currency` | `onchange` → `updateCurrency()` (`index.html:1210`) | ❌ **wrong symbol** |

So switching currency from Settings or the mobile drawer set `_displayCurrency`, fetched genuinely **server-converted** figures, and then rendered them with the **old** currency's symbol — e.g. TTD amounts under a `$`. Mislabelled money, which is precisely what F34 exists to prevent.

**Course of action taken.** Assign `activeCurrency = code` inside **`_applyDisplayCurrency`** (`app-main.js:4362`) — the single funnel all three controls route through — rather than in one caller. Idempotent for `setCurrency`, which already sets it first.

**How it was verified.** Harness runs the real `_applyDisplayCurrency`: non-native switch updates `activeCurrency` + symbol + arms the overlay · selecting the native currency disarms the overlay **and** restores the symbol · idempotent on the header-pill path · exactly one repaint per switch.

**Still to confirm live (owner, ~1 min):** change currency from **Settings** (not the header pill) → the figures and the symbol must both change together.

---

### F71 ✅ **FIXED via basis C** (`8bb47a7`, 2026-07-22) — was 🟠 HIGH — Payroll accrued with no effective dating; roster×time was also double-counted against manual salary rows
**Status:** ✅ **FIXED & golden-master-verified.** Owner ruled **basis C** (payroll_runs = single source of truth) over the three options originally listed — a stronger fix than the effective-dating option (1) below, because it removes the retroactivity, the double-count **and** a cash/accrual mismatch in one move.

**What was wrong (as surfaced by the owner: "why does June show expenses when nothing is logged for that month?").** `computeExpenseBreakdown` (client) and `computeBooks` (server) added `monthlyPayroll × elapsedMonths` — the **current** roster × time, with no start date on the employee record. Three defects: (1) **retroactive** — hiring someone today changed last January's expenses; (2) **double-count** — a salary logged as a manual expense row landed in `expensesTotal` **and** was counted again in the payroll leg, identically on both engines so every reconciliation check passed while the number was wrong; (3) **cash/accrual mismatch** against the F32 revenue basis.

**What changed (basis C).** Payroll expense leg, both engines = **Σ `payroll_run_lines` whose parent `run_date` ∈ period**, via `sumFX` (so it converts like every other leg). A payroll *run* is the event that creates the expense, exactly as an issued invoice creates revenue (F32). The synthetic `monthlyPayroll × elapsedMonths` accrual is **deleted** from both engines. The **roster is demoted to a template** — `rosterMonthlyCost` is reported for the Payroll page but feeds **no** total. **"Salaries" removed** from the manual expense dropdown (Contractors / Professional Fees added — non-payroll comp keeps a home as general expense) so the double-count cannot be re-entered by hand. No effective-dating needed: a run line is already dated.

**Empty-state UX.** Payroll expense is now a legitimate **$0** until a run exists. Rather than a bare $0, the Payroll page shows *"No payroll runs recorded — payroll expense currently shows $0, that is correct not a missing number. Set up a run from your roster to record it,"* with the roster surfaced as the template. `parts.payrollRunCount` distinguishes "no runs → real 0" from "a run totalling 0".

**History was clean — no migration.** The read-only inventory (`scripts/payroll-basis-inventory.js`, run against live Supabase) reported **0 manual salary rows, 0 payroll_runs, 0 overlap**. The double-count was architectural, never realised in data, so there is nothing to backfill or reclassify. Backfilling past months as runs is a separate owner-directed step; nothing was auto-created.

**How it was verified.** Golden master (`tests/golden-master-payroll-basisC.js`) — **executes both engines** against one fixed seed with roster R=5000 and a June run of X=4200 (X ≠ R, X ≠ R×elapsed, so the assertion proves *which source was read*). All 16 payroll assertions + 3 structural (accrual deleted both engines; Salaries gone) green; revenue/AR/AP and all 12 cross-engine checks stayed green; full regression suite green. (The 6 red F25 assertions in the same file are the separate period-scoped-COGS commit's target, not C.)

**Spawned:** **F73** (client leg reads a LIMIT-50 endpoint — theoretical undercount at >50 lifetime runs; deferred to the client-recompute rework).

**Superseded options (for the record — C was chosen over all three):**
1. *Effective-date the roster record* (`start_date`, JSONB, no migration) — fixes retroactivity but leaves the double-count and the cash/accrual mismatch.
2. *Proxy with `created_at`* — wrong the other way.
3. *Label it* — not a fix.

---

### F73 🟢 LOW — Client payroll leg reads a LIMIT-50 endpoint; >50 lifetime runs undercounts until the server figure lands — **NEW (found while implementing basis C)**
**Status:** OPEN, verified. Do **not** fix in isolation — belongs with the client-recompute rework (same class as **F7**, **F56**).

**What's wrong.** Under basis C (`532390b`… see the payroll commit), the payroll expense leg = Σ `payroll_run_lines` whose parent `run_date` ∈ period, on **both** engines. The **server** leg (`computeBooks`) issues a **direct, unlimited** JOIN, so `/api/reports` / `/books` are authoritative and correct at any run count. The **client** leg reads `window.payrollRuns`, populated from `GET /api/payroll-runs` — which is capped: `... ORDER BY pr.created_at DESC LIMIT 50` (`server.js:3778`). So a user with **>50 lifetime payroll runs** gets a client dashboard that **undercounts** payroll (misses the oldest runs) until the async `/api/reports` fetch overwrites the cards with the server's figure.

**Why it's Low, not Med.** (a) It self-heals on every dashboard paint — the server figure lands within the same interaction and is correct; the window is a brief undercount, not a persisted wrong number. (b) It requires >50 runs to trigger at all — a business runs payroll ~12–24×/year, so this is a ~2–4-year horizon, and **zero** runs exist in the data today. (c) It is the exact class the client-recompute rework exists to kill: two engines computing the same figure, the client one working off a truncated dataset — **F7** (duplicate KPI formulas) and **F56** (divergent AR) are the same shape.

**Course of action (with the client-recompute rework, not now).** Either raise/remove the `LIMIT` on the run-history endpoint, or give the dashboard a dedicated unlimited (or server-computed) payroll figure so the client never recomputes off a truncated list. The single-source-of-truth direction the audit already favours (client reads server totals rather than recomputing) closes this by construction.
**Done when:** a user with 60 runs shows the same payroll figure on the dashboard's first paint as `/api/reports` returns — no undercount-then-correct flicker.

---

### F74 ✅ **FIXED** (`85c8384`, 2026-07-22) — was 🟠 — No edit/delete control on non-owner employee rows
**Status:** ✅ **FIXED & harness-verified.** Owner-surfaced alongside PL#9.

**What was wrong.** The runtime `renderPayroll` override (`finflow-api-wiring-medium.js:582`) rendered a literal `<span></span>` for every non-owner row — no edit, no delete — so an employee (e.g. "Maria Garcia") could not be modified or removed. **Not intentional gating**: a rendering gap. The `openEditEmployee` handler already existed (`app-main.js`) but was unreachable because the override never emitted a button calling it; a client `deleteEmployee` did not exist at all, though the server route (`DELETE /api/payroll/:id`, `payroll:write`) did.

**What changed.** Non-owner rows now render edit (`openEditEmployee`) + delete (`deleteEmployee`) controls; the owner row keeps its single pencil and gets no delete. New `window.deleteEmployee(id)` confirms, calls the pre-existing server route, updates the in-memory array (keeping the `let payrollEmployees` binding in sync with `window.`), repaints, and throws (not fake success) on a non-ok response.

**Verified:** 12/12 executing the real override against a stubbed DOM. Same root cause as PL#9 (→ **F75**): both were defects on a shadowed function whose maintained copy lived in the dead app-main version.
**Live check (owner):** the Maria row shows edit + delete; delete prompts, removes the row, and the employee is gone after reload.

---

### F75 🟠 HIGH — Root cause: fixes applied to shadowed (dead) functions — **NEW (systemic; root cause of the PL#9 recurrence)**
**Status:** OPEN (class). **Enumeration complete** (read-only, 2026-07-22); reconciliation not started — awaiting owner prioritisation.

**The pattern.** `app-main.js` defines a function, then a wiring source does `window.NAME = function(){…}`, and the bundle loads **after** app-main, so the override wins at runtime. When the override is a **replacement** (does not call the original), the app-main copy is **dead code** — and a fix applied to it renders **nothing**, while passing review because the source *looks* patched. This is distinct from a **wrapper** override (saves and calls the original), where app-main edits DO take effect.

**Confirmed instances (this defect has already wasted real fixes):**
- **`renderPayroll`** — `2a70564` (gross colour) **and** `3bdae44` (the non-owner edit pencil) **both** landed on the dead app-main copy; the runtime override had neither until `85c8384` today. **Two** wasted fixes on one function. This is the confirmed root of the PL#9/F74 "recurrence."
- **`renderItems` / `filterItemsBySearch`** — `614d29c` added XSS escaping to the dead app-main copy. **No live vulnerability** — verified the runtime override independently escapes (`esc(i.name)`, `medium.js:859`) — but the app-main effort was wasted.

**Blast radius (enumerated).** **28** functions are defined in app-main **and** overridden by a wiring `window.NAME=`. **23 are REPLACEMENT** (app-main copy is dead); **5 are wrappers** (app-main edits live — e.g. `updateDashboard`, which is why the verified F56/F59 fixes there worked). **4** are shadowed by **≥2** wiring files (intra-bundle order decides the winner). Of the 23 replacements, **6** have had their dead copy edited by a targeted commit: `renderPayroll` (✅ resolved), `renderItems`/`filterItemsBySearch` (no live harm), and **3 unverified suspects** — `restockItem` (`4286f7f`, a security commit), `loadPersistedData` (`3bdae44`), `saveProduct` (`469fd1a`). Full machine-generated list in the session report.

**Course of action (owner to prioritise — do NOT batch-reconcile blindly).** (1) Verify the 3 suspects — does the runtime override carry the fix the dead copy got? (2) For each confirmed-dead pair, either delete the app-main copy (forcing all edits onto the real one) or make the override a thin wrapper that delegates. (3) Add the **guard** below so a future fix to a shadowed copy fails loudly.
**Done when:** no function has a silently-dead second definition, and CI fails if one is introduced.
### F72 🟡 MEDIUM — AP / payables overstated for partially-paid bills — **NEW (found while fixing F56)**
**Status:** OPEN, verified. The exact mirror of F56 on the payables side.

`finflow-api-wiring-pages.js:517` (Vendors page) and `finflow-api-wiring-stubs.js:337` (Bills page) both compute payables as `Σ amount` over `status !== 'paid'` — the same formula F56 just removed from the AR side. A bill with `amount_paid` set still reports its **full** face value as owed. F38 Step 3 added `recalcBillStatus` and `bills.amount_paid`, so the data to do this correctly already exists.

**Not folded into the F56 commit deliberately:** bills use a different status vocabulary (`unpaid`/`due_soon`/`overdue`/`partial`/`paid`) than invoices, so the invoice-shaped `arOutstanding` helper does not apply — it needs its own `apPayables()` sibling rather than a bodge.
**Course of action:** add `apPayables(bills)` = `Σ max(0, amount − amount_paid)` over the bill status allowlist; use it at both sites and anywhere `computeBooks` reports AP.
**Done when:** a $1,000 bill with $400 paid reports **$600** payable on the Vendors page, the Bills page and `/api/reports`.

---

### F69 🟢 LOW — Income-sources percentages mix bases — **NEW**
`_topClients` is built from **paid-only** invoices (`app-main.js:1451-1457`) but the bar percentages divide by `d.rev`, which is **accrual** (`app-main.js:2047`). On an account with unpaid invoices the bars sum to well under 100% with no explanation. Fold into the F57 rewire: build `_topClients` from the same recognized-invoice set `computeRevenue` uses.

---

### F33-C 🟡 MEDIUM — Overview chart's expense series excludes payroll and COGS
**Status:** OPEN (split out of F33, whose core is fixed). Now *deliberate* and documented (`server.js:4152`, `finflow-api-wiring-dashboard.js:46`) but still unlabelled on screen: the chart's "Expenses" line and the "Expenses" KPI directly above it are different quantities. Root of the originally-observed "$1,000 chart vs $8,000 KPI" discrepancy.
**Course of action:** either add payroll and COGS to the monthly buckets on **both** sides (`server.js:4147-4151` and `finflow-api-wiring-dashboard.js:64-105`), or relabel the series "Direct expenses" with a tooltip note. Adding them is the more honest option and makes `Σ(buckets) == KPI` at every period, which is also the cleanest verification.
**Done when:** `Σ expByMonth` over the period window equals the Expenses KPI exactly.

---

### F25 ✅ **COGS period-scoped** (`c2bcdb1`, 2026-07-22) — was 🟡 MEDIUM — "Year" fiscal-window consistency
**Status:** ✅ **COGS FIXED & golden-master-verified.** The fiscal-window half was already closed by the F33 unit; this closes the COGS residual the owner surfaced ("why does June's Net subtract COGS from every sale I've ever made?").

**What was wrong.** COGS was an **all-time** FIFO total at every period — on the server (`computeBooks`) and on the client (`window._cogsTotal`, fetched once from `/api/cogs` with no window). So Gross Profit and Net at Month/Quarter subtracted every sale's cost ever recorded. A comment lumped "COGS and AR are all-time snapshots" together, which is how the wrong one hid behind the right one — AR *is* correctly all-time (balance-sheet), COGS is not (P&L).

**What changed.**
- **`computeBooks`** (server): both COGS branches now walk `fifoItemSales` (per-sale `{date, cogs, uncovered, quantity}`) and count only sales whose movement date ∈ period. FIFO layer consumption is still evaluated over **all** sales in date order (a June sale's cost depends on May's purchases), so each sale's cost is correct; only the summed subset is period-scoped. Σ over the year still equals the old all-time total, so **Year is unchanged**.
- **`GET /api/cogs`** (server): accepts the same `?start&end&elapsedMonths` window as `/api/reports` (identical validation), period-scoping its per-item FIFO the same way. **No params ⇒ all-time**, so the COGS page and any un-migrated caller are byte-for-byte unchanged.
- **Client**: COGS is now handled exactly like its siblings `computeRevenue` / `computeExpenseBreakdown` — period-aware, not frozen at all-time. `_loadPeriodCOGS()` refetches the period figure on every period/month switch and repaints (paint-then-correct, like the FX overlay); the COGS page (`loadCOGS`) uses the same window so opening it on a Month view no longer clobbers `_cogsTotal` back to all-time. **This is not the SSOT rework** — net is still computed client-side; only the one frozen COGS input is brought in line with the already-period-aware rev/exp inputs. On failure it keeps the prior value (never fabricates $0 — F62 class).
- **`fifoItemSales`** gained a `quantity` field (additive; existing callers read only date/cogs/uncovered).

**AR deliberately untouched** — it is correctly all-time (balance-sheet). Labelling it "as of today" is a separate cosmetic task, not part of this commit.

**How it was verified.** Golden master (`tests/golden-master-payroll-basisC.js`) — the 6 previously-red F25 assertions (3 COGS + 3 net-profit) now green (June COGS=400, July=200, Quarter=200, Year=600, computed against a FIFO seed), **plus** 5 new endpoint assertions proving `/api/cogs` per-period **equals** `computeBooks` COGS at every window and that no-window ⇒ all-time. Everything basis-C turned green stayed green; full regression suite green (F55/F56/F59/F60/F62/B8).

**Verify live (owner):** on an inventory business, switch dashboard to Month → Net Profit subtracts only that month's COGS, not the all-time figure; open the COGS page on Month view → it shows that month; switch to Year → COGS matches the old all-time number.

---

### F26 🟡 MEDIUM — `sales_receipts` / `payments_received` entity scoping
**Status:** PARTIAL, unchanged. Inserts carry `entity_id` since sweep `e1319ef`, but **`computeBooks` still reads receipts user-scoped, not entity-scoped** (`server.js:3919`: `db.allByUser('sales_receipts', userId)` with no `ent` filter, comment `// user-scoped (no entity_id) — F26`). For a multi-entity user every entity's P&L includes **every** entity's cash sales.
**Course of action:** (1) backfill legacy rows' `entity_id`; (2) then change `3919` to pass `ent` and drop `2131`/`2170`'s `null` entity in `findRecentDuplicate`. Order matters — scoping before backfill would hide existing rows.
**Done when:** with two entities each holding a receipt, each entity's revenue includes only its own.

---

### F30 🟢 LOW — Permissions matrix is display-only
**Status:** OPEN, honestly labelled. `/api/permissions` persists per-account edits to `user_settings` (`server.js:3138`) but enforcement uses the fixed code matrix in `rbac.js`. The grid is relabelled read-only "role defaults" (`index.html:1511`), so it is not a lie — but the route still accepts and stores writes nothing reads.
**Course of action:** post-launch — either enforce the stored matrix in `requirePerm`, or delete `POST /api/permissions` so nothing pretends to save.

---

### F32-residual 🟡 MEDIUM — cash-flow basis + one legacy row
**Status:** Revenue side FIXED and verified (issue-based accrual on both engines). Residual: `POST /api/reports/cash-flow` still sums paid invoices + receipts + `payments_received` and does **not** read `invoice_payments` (Store B) — so since F35 routed payments to Store B, **new payments do not appear in the cash-flow statement at all**. Plus the Store A → Store B migration decision (option 1, recommended) is still un-executed, and the Store A $1,000 row is unresolved.
**Course of action:** point the cash-flow inflow leg at `invoice_payments` + `sales_receipts`, keeping `payments_received` as a legacy leg until migrated. Migration stays gated on owner approval (it rewrites historical money rows) and must be dry-runnable.
**Done when:** a payment recorded today appears in the cash-flow statement's inflow for today's month.

---

### F39 ✅ FIXED (invoices) / **F41** 🟢 OPEN (bills)
`end_date` on recurring **invoices** is complete end-to-end — server accepts it (`server.js:2093`), the scheduler stops on it, and the UI has `#ri-end` (`index.html:6860`, wired in `pages.js:366` and `stubs.js:647`). Commit `e1319ef`.
**F41 — recurring BILLS remain dormant:** `runRecurringScheduler` and `POST /api/recurring-bills` honour `end_date`, but **no `rb-end` input exists anywhere** (verified by grep). A user can never set one, so recurring bills generate forever. Exact parallel to the invoice half.
**Course of action:** copy the `ri-end` field + wiring to the recurring-bill modal (`index.html:6391`) and both save paths.

---

### F40 🟢 LOW — `/api/cashflow` dates paid inflow on `due_date`
`server.js:3175` buckets a paid invoice by `(due_date||'').slice(0,7)` — the month it was **due**, not the month cash arrived. The route is **orphan dead code** (no fetch caller anywhere outside the audit docs), so it is currently harmless.
**Course of action:** delete the route, or repoint it at `invoice_payments.payment_date` before anything starts calling it. Do not leave it dead-but-wrong.

---

### F44 🟢 LOW — Scenario planner BASE uses the pre-F32 basis
`_syncScenarioBase` (`finflow-api-wiring-medium.js:1004-1011`) computes `annualRev` from **paid-only** invoices — the recognition basis F32 replaced everywhere else — and `annualExp` from **all-time** expenses with no window, no bills, no payments_made, no payroll. Every scenario projection starts from a number that appears nowhere else in the app.
**Course of action:** `window.BASE = { rev: computeRevenue('year'), exp: computeExpenseBreakdown('year').total, burn: exp/12 }`.

---

### F45 🟢 LOW — Budget "actuals" are lifetime, not periodic
`finflow-api-wiring-medium.js:1142-1146` sums `catActuals` over **every** expense row with no date filter, then compares against a periodic budget target. Variance becomes meaningless as the account ages — actuals only grow.
**Course of action:** filter through `_periodWindow(currentPeriod)` before aggregating; label the card with the window.

---

### F47 🟢 LOW — Cash-flow route dates a paid invoice by `created_at`
`server.js:3313` keys paid-invoice inflow on `created_at || due_date || date`, so the same invoice is now dated three different ways across the app (`issue_date` for accrual, `due_date` in `/api/cashflow`, `created_at` here). Correct in isolation — `/api/reports/cash-flow` is the cash-basis statement — but it will be re-flagged forever unless documented. Fold into the F32-residual rework: cash basis should key on the **payment** date, not any invoice date.

---

### F51 🟡 MEDIUM — Placeholder surfaces presented as live features (blocker **B10**)
**Verified live-confirmed placeholders:**
| Surface | Evidence |
|---|---|
| **Banking** | static "Bank Sync — Coming Soon" card, `index.html:1987` |
| **Client Portal** | "Coming Soon" card injected at `index.html:6001`; `/api/portal` does not exist; dead `PORTALS=[]` / `createPortal()` / `portal.finflow.io` links still in the tree at `index.html:6352-6390` (inert — `renderPortal` bails on a missing `#portal-list`) |
| **Find Advisor** | "Coming Soon" card, `app-main.js:6053`, behind a **`NEW`-badged** nav item; `ADVISORS=[]`; `submitAdvisorApp()` fakes an application |
| **Tax Filing** | "Coming Soon" card, `app-main.js:6104`. ⚠️ `GET /api/tax-filing` still **serves** a flat-25%, paid-only estimate (`server.js:3412-3421`) — currently unrendered in the main app, but live and fabricated if any surface picks it up |
| **API Connections** | ~98 KB static catalog; `loadStates(){ return {}; }` / `saveStates(s){}` are **empty stubs** (`index.html:2335-2336`) so every "Connect" toggle is in-memory and lost on refresh, while `/api/connections` exists and is never used |
| **Templates** | empty, no persistence (PL#13) |

**Course of action:** remove the `NEW` badge from Find Advisor; delete the dead portal/advisor code so it cannot resurrect; either wire the Connections toggles to the existing `/api/connections` route or remove the toggles; either delete `GET /api/tax-filing` or replace its flat 25% with the real `/api/reports` net × a user-set rate, with `ytdPaid` shown "Not tracked".
**Done when:** every nav item either works or says it doesn't, and no control in a placeholder page produces a success message.

---

### F52 🟢 LOW — Form accessibility
3 form fields with no `id`/`name`, 7 inputs with no associated `<label>` (owner-observed via DevTools Issues). Breaks autofill and screen-reader labelling.
**Course of action:** enumerate via the DevTools "Violating node" links, add `id`/`name` + `<label for=…>`.

---

### PL#5 🟡 MEDIUM — Quotes never convert to invoices
**Status:** OPEN, verified — grep finds **no** conversion function anywhere in the tree. Quotes can be created, listed and marked "accepted" (`pages.js:81`, `stubs.js:94`) and then the trail ends. The Quote → Invoice → Payment lifecycle is broken at the first hop.
**Course of action:** one `POST /api/quotes/:id/convert` that creates an invoice from the quote's fields, stamps `quote.status='converted'` and `invoice.quote_id`, and returns the new invoice; one button on the quote row. Guard against double-conversion via the status.

---

### PL#8 🟢 LOW — Items and Inventory are two parallel systems
No `reorder_point` on items; reorder logic lives only in Inventory, hardcoded to 10% of max. Post-launch.

---

### PL#10 🟡 — split
**Contra half → F58 (blocker).** **Recurring half → FIXED:** `runRecurringScheduler` (`server.js:2951`) runs at boot + hourly (`4114-4115`) and materialises all three recurring types. The old "recurring items are inert" claim is stale.

---

## Findings — CLOSED (verified this pass)

Compact. Full fix narratives live in `AUDIT_MASTER_ARCHIVE_2026-07-22.md`.

| # | Was | Verified at | Note |
|---|---|---|---|
| F1 | 🔴 cross-tenant accountant read | `accountant-routes.js` — `accountant_clients.status='active'` gates all 8 branches | ✅ |
| F2 | 🔴 partial-PUT JSONB corruption | explicit `patch` objects on every PUT | ✅ |
| F3 | 🟠 unrealised FX never computed | `computeUnrealised` at read time, null when no rate | ✅ |
| F4 | 🟠 error handler before 42 routes | `server.js:4618`, after last route `4608` | ✅ verified |
| F5 | 🟠 RBAC resolver inert | resolver `server.js:611`; `member_user_id` written `2637` | ✅ resolver works — **but see F54**, routes don't all use it |
| F6 | 🟠 COGS mis-costing | FIFO everywhere (`fifoItemTotal`/`fifoItemSales`) | ✅ |
| F7 | 🟠 duplicate KPI formulas | `d-rev/d-exp/d-profit` written only by `updateDashboard` | ✅ — **but see F55/F56/F57**, the class regrew on other cards |
| F8 | 🟠 stale payroll brackets | engine removed | ✅ by removal |
| F9 | 🟠 `/books` unscoped, unpaid-as-income | `computeBooks` shared | ✅ |
| F10 | 🟠 dead accountant invite funnel | `/register?ref=` → 302 | ✅ live-verified |
| F11 | 🟠 referral cron paid nobody | `setSubscriptionStatus` `server.js:95` | ✅ code; ⏳ Stripe-gated live check |
| F12 | 🟡 admin phantom fields | ✅ |  |
| F13 | 🟡 unenforced bundle sync | `bundle.js --check` + pre-commit hook | ✅ |
| F14 | 🟡 report routes ignore entity | ✅ |  |
| F15 | 🟡 lexical month sort | ✅ |  |
| F16 | 🟡 mock accountant verification | ✅ + Step F doc upload |
| F17 | 🟡 100% earnings ledger | `tier-config.js` | ✅ code; ⏳ Stripe-gated |
| F18 | 🟡 4/5 uncapped AI sites | `ai-cap.js` on all | ✅ code; ⏳ 2 follow-ups (prompt-cache is a no-op; Haiku-vs-Sonnet undecided) |
| F19 | 🟢 DB TLS + fabricated team emails | ✅ |  |
| F20 | 🟢 dead db helpers | ✅ |  |
| F21 | 🟡 broadcast sent nothing | ✅ code; ⏳ Resend-gated |
| F22 | 🟠 CSRF | `sameSite:'lax'` + 415 content-type gate + 403 Origin gate, `server.js:279`, `316-341` | ✅ live-verified |
| F23 | 🟢 banking field-name split | `tx_type`/`tx_date` + legacy fallback | ✅ |
| F24 | 🟡 consolidated P&L hardcoded COGS | ✅ |  |
| F27 | 🟢 dead Client Books modal | ✅ removed |
| F28 | 🟠 unverified credentials beside "✓ Verified" | ✅ |  |
| F29 | 🟠 stale APP_URL fallbacks | `app-url.js` | ✅ — ⚠️ **custom-domain swap needs BOTH** `APP_URL` env **and** `LIVE_FALLBACK`, plus 3 static files hardcoding `dab1` |
| F31 | 🟠 fabricated $0 on report failure | 3 report routes | ✅ **narrowed** — class unswept → **F62** |
| F33 | 🔴 period-window unit | `d39aed4`,`146019c` | ✅ core — companion → **F33-C** |
| F34 | 🟠 currency toggle relabels only | Path B, `063c98c`→`5639f06` | ✅ code complete — failure path → **F59** |
| F35 | 🔴 Record Payment broken | Step 5 `9937966` | ✅ live-verified |
| F36 | 🟡 no invoice issue date | `85a9d2f` | ✅ live-verified |
| F37 | 🟡 UTC date generation | sweep `e1319ef` | 🔁 **REOPENED — PARTIAL**, see **C3** |
| F38 | 🟠 asymmetric expense accrual | Steps 1–5 | ✅ |
| F42 | 🟢 banking MTD always $0 | within `e1319ef` | ✅ |
| F43 | 🟢 EOL non-determinism | — | 🟢 OPEN, held for decision: add `.gitattributes` with `* text=auto eol=lf` |
| F46 | 🟢 banking tx_type fallthrough | `64eb95c`, `server.js:3094` | ✅ verified |
| F48 | 🔴 Store B ownership/AR | `98ec1a6` + `d60ecea`, `server.js:4110` | ✅ verified |
| F49 | — `reload.js` in prod | — | ✅ **not a FinFlow bug** (extension-injected); CSP tidied `64eb95c` |
| F50 | 🟠 cold-boot $0 race | `c16ee28` | ✅ re-fixed, verified in `index.html:3630-3740` |
| F53 | 🟡 K-only formatters | `96ef6c3` + `640dffe` | ✅ verified — behaviour → **F64** |
| PL#3 | 🟠 entity paywall | `64eb95c`, `server.js:811` | ✅ verified |
| PL#4 | 🟠 wrong audit table | `7be0a1d`, `index.html:4366` | ✅ verified |
| PL#6 | 🟡 FX Settle dead | `e1319ef` | ⚠️ **structurally present, never exercised end-to-end** — settle a real FX transaction and confirm `realised_gain_loss` before calling it done |
| PL#7 | 🟡 fabricated team members | → F19 | ✅ |
| PL#9 | 🟢 invisible payroll gross | ✅ **`85c8384`** | ✅ **NOW GENUINELY FIXED on the runtime path.** `2a70564` had patched the SHADOWED app-main `renderPayroll` (dead code); the runtime winner is the `finflow-api-wiring-medium.js` override, whose gross span had no color token. Fixed there with `color:var(--t1)` (themed, legible light+dark). Root cause of the "recurrence" → **F75**. |
| PL#11 | 🟠 fabricated tax figures | `7be0a1d` | ✅ verified |

---

## Environment-gated — built, cannot be verified without keys

Not defects; they cannot be closed from the code alone. Each needs one live run.

- **Stripe** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs): F11, F17, F21 payout mechanics — PaymentIntent creation, `application_fee_amount` + `on_behalf_of` netting, webhook signature + real event delivery, `sub.metadata.userId` presence, balance-transaction fee reconciliation, end-to-end subscription → cron payout → cancellation.
- **Resend** (`RESEND_API_KEY`, `EMAIL_FROM`): F21 broadcast actually delivers and `{sent,failed,total}` match the dashboard; without a key the route must return `logged:true, sent:0` and the admin must see the honest "logged only" toast.
- **Anthropic** (`ANTHROPIC_API_KEY`, set on Railway): F18 — a real call succeeds, usage increments, a capped user gets `402 AI_CAP_REACHED` with **no** upstream call. Two known follow-ups: prompt caching on `/api/ai` is a **no-op** (blocks below the cacheable minimum, breakpoint after the variable `history`), and the Haiku-vs-Sonnet cost decision is unmade — Sonnet remains default, bounded by caps.
  ⚠️ `POST /api/ai` returns *"Add ANTHROPIC_API_KEY to .env to enable"* when the key **is** set but uncredited — misleading, not a secret leak (regex-checked: no `sk-ant-` value in the response). Fix the message.
- **Boot migrations** (silent failure = landmine): confirm on the live Postgres that `accountant_documents`, `accountants.confirmed_credentials`, `ai_usage.scan_count`, `accountant_ai_usage` and the `accountant_earnings` columns all applied. A missed `ai_usage.scan_count` **fails closed** and disables all AI (503) — safe but total.

---

## Confirmed non-issues (re-checked this pass — do not re-open)

SQL injection (allow-listed identifiers, parameterized values, `ILIKE … ESCAPE`); Stripe webhook signature (`constructEvent` + secret, `server.js:124`); admin auth (`timingSafeEqual` + 5/15 min limit); password reset (32-byte token, 1 h expiry, single-use); bundle sync (byte-exact, drift-checked); landing-page `$469K` hero (marketing mockup); `reload.js` (browser-extension injected — F49); **`appendChild` render-append class (withdrawn — all 49 sites verified clear-first or run-once)**; entity-id ownership check on the explicit `?entity_id=` override (`server.js:650`).

---

## Methodology notes carried forward

1. **Reconciliation proves agreement, not correctness.** The F7/F9/F14/F15/F24 cluster proved every view returned the same number without ever asking whether the number was right — that produced F32 and F33. This pass repeated the mistake's inverse test: F56/F57 exist because *nobody re-checked* whether the surfaces still agree after F35/F38/F48 changed the basis underneath them.
2. **Verify across the surface, not at one point.** F33 was "verified" on the Year period only. F37 was "verified" on one file. Both were wrong.
3. **A partial sweep must be logged as PARTIAL.** See the standing rule.
4. **Where the root cause is uncertain, say so.** Two items in this audit are explicitly *not* root-caused: **PL#6** (FX settle is structurally present but never exercised — the failure mode, if any, is unknown) and **PL#9** (fixed by an external commit, never verified). Both are marked ⚠️ rather than ✅.

---

## Recommended order

1. **B1** (F55) — 15 minutes, largest perceived-quality gain per minute in the whole list.
2. **B7** (F59) + **B6** (F62/F67) — the silent-failure family. Cheap, and they stop wrong money from being *invisible*.
3. **B3** (F56/F57) + **B5** (F60/F61) — the reconciliation family. Do them together; they touch the same three functions.
4. **B4** (F58) — credit-note contra. Largest correctness win.
5. **B2** (F64) — money formatting. Isolated, mechanical, but touches every screen — do it when nothing else is in flight.
6. **B8** (C1 money-7) — server dedupe. Copy-paste of an established pattern.
7. **B9** (F54) — decide fix-or-disable **early**; the disable path is 30 minutes and should be chosen now if the week is tight.
8. **B10** (F51/F65) — honesty pass. Do it last so it covers anything the earlier fixes turn into a placeholder.

After every one of these: **tick the row in this file in the same commit.**

---

## Audit pass log

Provenance for every pass. **Append a new entry per pass — never edit an old one.** The point is that a future session can tell what was actually checked from what was inherited.

---

### Pass 3 — 22 July 2026 · full site-wide re-audit + document rewrite

**Base commit:** `f27166d` · **Working tree:** clean apart from untracked prior audit files · **Mode:** read-only (no source file modified; verified via `git status --short`)
**Trigger:** owner reported the document was stale and untrustworthy — rows contradicting shipped code — with one week to launch.

#### Scope actually covered

| Area | Depth |
|---|---|
| `server.js` (4,643 lines) | **Exhaustive** for middleware, auth, scoping, all 62 `app.post` routes, `computeBooks`, `/api/reports`, cash-flow, error handling |
| `public/app-main.js` (6,153) | **Exhaustive** for money engines, boot, dashboard, formatters, FX overlay, placeholder injection |
| `public/index.html` (7,486) | **Targeted** — money surfaces, page injection, portal/connections/tax, boot scripts, script-load order |
| All 10 wiring sources | **Exhaustive** for `-dashboard.js`, `-postgres.js`, `-medium.js`; targeted for the rest |
| `rbac.js`, `tier-config.js`, `bundle.js`, `app-url.js`, `manifest.json` | **Full read** |
| `database.js` (715) | **Partial** — helper surface and `allByUser` semantics only |
| `accountant-routes.js` (1,622), `accountant-*.html` | **Spot-check** — email validation, `computeBooks` callers, dialog/date classes |
| `admin-routes.js` (624), `admin.html` (1,331) | **Spot-check** — dialog class + fail-soft catches only |

#### Explicitly NOT covered — do not treat these as audited

1. **Nothing was executed.** This pass was 100 % code-read. No live instance, no browser, no clicks, no DB. Every runtime claim (e.g. F55 "doesn't repaint", F60 "off by 5 months") is derived from reading the call graph and is stated as such — each carries a "Done when" that requires an actual run to close.
2. **The accountant portal** (`accountant-routes.js`, `accountant-client.html`, `accountant-dashboard.html` — ~4,400 lines) was **not** exhaustively audited. F1/F9/F16/F17/F27/F28 statuses there are inherited from prior passes, spot-confirmed only.
3. **The admin panel** (`admin-routes.js`, `admin.html`) — same caveat. F12/F21 inherited.
4. **`database.js` schema/`initDB`** was not enumerated; the boot-migration list under "Environment-gated" is inherited, not re-verified.
5. **No dependency/CVE audit** (`npm audit` not run). **No load or performance testing.** **No mobile-device testing** — F68 is a code observation, not a measured one.
6. **Stripe / Resend / Anthropic** paths are unverifiable without keys — see the Environment-gated section.

#### Outcome

| | Count |
|---|---|
| Existing rows reconciled against code | **68** (F1–F53 + PL#1–#15) |
| Corrected OPEN → FIXED | **10** (F33, F34, F48, F50, F53, F46, F4, PL#3, PL#4, PL#11) |
| Reopened FIXED → PARTIAL/narrowed | **2** (F37 → PARTIAL, 35 sites remain; F31 → narrowed, class → F62) |
| New findings | **16** (F54–F69) |
| Classes withdrawn as non-defects | **1** (appendChild render-append) |
| Class counts corrected | **3** (dialogs 53→68; timezone 14→35; client handlers 58→88 POST sites) |
| Severity upgraded | **1** (PL#10 contra half → F58, 🟡 → 🟠) |
| Launch blockers identified | **10** (B1–B10, ~3 working days) |

#### Reproducible checks behind the counts

Re-run these to re-verify any class without re-reading the tree. All exclude the generated `finflow-bundle.js`.

```bash
grep -rn "[^a-zA-Z_.]confirm(\|[^a-zA-Z_.]alert(" public/ --include=*.js --include=*.html | grep -v finflow-bundle.js | wc -l   # C2 → prints 69 = 68 real sites + 1 comment (index.html:4853)
```
```bash
grep -rn "toISOString()\.slice(0, *10)" . --include=*.js --include=*.html | grep -v node_modules | grep -v finflow-bundle.js | wc -l   # C3 → 40 hits (35 defects + 5 benign)
```
```bash
grep -c "findRecentDuplicate(" server.js   # C1 → 28 (1 definition + 27 guarded routes); 62 app.post total
```
```bash
grep -rn "res.json(\[\])\|res.json({})" server.js   # C7 → prints 10; 9 are the fail-soft class, server.js:2808 is a legitimate "no accountant linked" empty result
```
```bash
grep -c "scopeId(req)" server.js; grep -n "db.allByUser('[a-z_]*', req.session.userId" server.js | wc -l   # F54 → 86 vs 34
```
```bash
grep -rn "toFixed(1) *+ *'K'" public/ --include=*.js --include=*.html | grep -v finflow-bundle.js   # C4 → 1 hit, inside _fmtMoney only
```

#### Key judgement calls (so they can be argued with, not silently inherited)

- **F58 raised from Medium to High.** A credit note that never reduces revenue is not a missing feature, it is a wrong number on the P&L. Prior passes filed it as a feature gap.
- **The appendChild class was withdrawn, not deferred.** All 49 sites were read individually; the class does not exist. If a future pass re-raises it, read `index.html:2346` and `2377` first.
- **F64 is called pre-existing, not an F53 regression.** Verified against `96ef6c3^` — `patchSFormatter` abbreviated before the F53 consolidation. F53 unified thresholds; it did not change *where* abbreviation applies.
- **F54 offers a 30-minute alternative (disable team invites) alongside the 1-day fix.** With one week to launch, shipping without the team feature is a legitimate answer; shipping it broken is not.
- **The timezone class was left off the blocker list** despite being 35 sites, because it produces wrong dates at edges rather than wrong totals in normal use. That is a judgement call, flagged in the blocker section as the most likely week-one support ticket.

---

### Pass 2 — 20–21 July 2026 · live health pass + P1 sweep
Live end-to-end pass on `dab2` (47 nav pages, 29 data endpoints, authenticated as owner id 1) → F49–F52. Followed by fixes `64eb95c` (F46, PL#3, F49/CSP), `7be0a1d` (PL#11, PL#4), `d60ecea` (F48 AR follow-up), `c16ee28` (F50 re-fix). Detail retained in `AUDIT_MASTER_ARCHIVE_2026-07-22.md`.

### Pass 1 — 9 July 2026 · two audits merged
`AUDIT_CODE.md` (20 runtime-verified findings) + `CODE_AUDIT_2026-07-09.md` (chat audit), deduplicated into F1–F23. One chat Critical ("stale served bundle") withdrawn as a false positive after a byte-exact re-minify; residual risk retained as F13. Detail in the archive.
