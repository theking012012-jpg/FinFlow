# FinFlow — FX Base-Currency Consolidation (Design)

_World-class roadmap item #1 (the multi-currency credibility gap). Updated 2026-09-14._

## STATUS (2026-09-14)

**SERVER LAYER — ✅ DONE + TESTED.** `computeBooks(entityId=null)` now converts EVERY leg (revenue,
expenses, bills, payments, payroll, credit notes, COGS) from its OWN entity's currency to the account
BASE currency (`users.data.base_currency`, else first entity's currency, else USD). Single-entity views
unchanged; single-currency accounts byte-identical (from===base ⇒ rate 1). `verify-fx-consolidation`
12/0 (RED-proven: converted totals ≠ raw native sum), and no regression (entity-leakage 18/0, e2e 11/0,
f137-tax-reports 20/0). COGS now converts per-item entity currency; payroll already carried entity_id.

**ARCHITECTURE FINDING (important).** The `/api/reports` entity middleware NEVER yields entityId=null
for a multi-entity account — it snaps to the first entity. So computeBooks(null) is reached by SERVER
callers (accountant "all" view, report routes), NOT by the main dashboard. The **main dashboard's
consolidated total is summed CLIENT-SIDE** (`finflow-api-wiring-medium.js` renderConsolPL + the
per-entity loop), which still RAW-SUMS native per-entity results. So the visible-dashboard bug needs the
CLIENT layer too.

**REMAINING (2 small, focused steps — each reuses the now-correct pieces):**
1. **Make the consolidated aggregate reachable over HTTP:** support `?entity_id=all` → entityId=null in
   the entity middleware (owners/all-access only; scoped members stay restricted to granted entities).
   Then `/api/reports?entity_id=all` returns the correctly-converted consolidated. Small + testable.
2. **Point the client consolidated at base currency:** either (a) have renderConsolPL/the loop call
   `/api/reports?entity_id=all` (server does the conversion — single source), OR (b) fetch each entity
   with `?display=<base>` (reuses the PROVEN single-entity conversion) and sum the already-base results.
   (a) is cleaner. Either removes the client-side native raw-sum.

Everything below is the original design; the SERVER LAYER section of it is now implemented.

---


## The problem (one sentence)

When you view **all entities together**, `computeBooks` returns a **raw native sum** across entities —
so a TTD entity + a USD entity produce a "total" that adds unlike currencies. A sharp
user/accountant catches this on day one of a *multi-currency* product.

## What ALREADY exists (do NOT rebuild)

The hard machinery is done — this is the important finding:

- **`fx_rates` table** (`user_id, entity_id, from_currency, to_currency, rate, rate_date`), with CRUD at
  `GET/POST/DELETE /api/fx-rates`. **Populated manually** by the owner today (no feed).
- **Per-leg, recognition-dated conversion** — `computeBooks(userId, entityId, period, display, …)` F34
  Path B: pass `display=CCY` and every leg converts to CCY at **its own recognition-date rate** via
  `pickRate`/`latestFxRates` (carry-forward, missing → null). This is the correct, accounting-grade way
  (not a single blunt spot rate).
- **Coverage honesty** — `fxCoverage` flags `complete=false` when any leg had no rate, so a converted
  total is never silently wrong; uncovered legs return null, not a fabricated number.
- **FX gain/loss** — `fx_transactions` (realised/unrealised) is a separate, working feature.

So conversion is **opt-in** (`?display=CCY`); with no `display`, the aggregate is native identity — which
is fine for a single-entity view but **wrong for the consolidated all-entities view**.

## The gap (what's actually missing)

1. **No account-level base/reporting currency.** There is no canonical currency the consolidated view
   converts *to* by default. (Only `fx_transactions` has a per-row `base_currency`, defaulting 'USD'.)
2. **The consolidated (entityId = null) view defaults to native raw-sum** instead of converting to base.
3. **Rates are manual-entry only** — no feed. If the owner hasn't entered TTD→USD, coverage is
   incomplete and those legs drop to null. Fine mechanically, but poor UX for a multi-currency product.

## The fix (scoped, leverages existing infra)

### A. Base-currency setting (small)
- Add `base_currency` to account settings (users.data JSONB — no migration). Default: the first
  entity's currency, else 'USD'. Editable in Settings.

### B. Consolidated view converts by default (the core change)
- In the KPI/books endpoint, when the request is **consolidated** (entityId = null / "all entities"),
  default `display` to the account `base_currency` when the caller didn't specify one. Single-entity
  views stay native (that entity's own currency) unless a display is explicitly chosen.
- This reuses `computeBooks(display)` exactly as-is — no new conversion code. It flips the default from
  "native raw-sum" to "convert to base" for the one view where mixing currencies is wrong.
- Apply the same default to every consolidated surface that inherits the aggregate: dashboard KPIs,
  reports (P&L/BS/CF), the accountant portal `/books` (its F24 note already flags this), and exports.

### C. Surface coverage prominently (trust)
- On the consolidated view, when `fxCoverage.complete === false`, show a clear banner:
  "Totals shown in USD. N transactions excluded — no <CCY>→USD rate on <date>. Add a rate to include
  them." Turn the existing null-flag into a visible, actionable prompt (the data is already there).

### D. Optional — automatic rate feed (removes the manual burden)
- A daily job populates `fx_rates` for the currency pairs the account actually uses (derive pairs from
  the entities' currencies → base). Use a free FX API (e.g. exchangerate.host / open ECB data). Network
  dependency + a scheduled job (mirror `startAnomalyMonitor`'s guarded-interval pattern). Manual entry
  stays as the fallback/override. This is what makes multi-currency "just work" without upkeep.

## What is NOT needed
- No new conversion engine, no schema migration for rates, no per-leg rework — all done in F34.
- Historical accuracy is already correct (recognition-date rates), so this does not disturb the
  native/aggregate reconciliation that the money-engine gates rely on — keep the no-`display` path
  byte-identical for single-entity/native so the existing sweep stays green.

## Rollout + verification
1. B first behind the base-currency default, single-entity native path unchanged (assert byte-identical
   vs today for a one-entity account → existing gates stay green).
2. A harness: a 2-entity account (TTD + USD) with seeded `fx_rates` → consolidated total equals the
   hand-derived base-currency sum (not the raw native sum), and with a rate MISSING → `fxCoverage`
   incomplete + the excluded-count is correct. RED-prove the raw-sum bug is gone.
3. Then C (banner), then D (feed) as a separate pass.

## Effort / risk
- A + B + C: **medium**, mostly wiring an existing capability into the consolidated default + one
  harness. Low risk if the native single-entity path is left untouched (guard it).
- D (feed): **medium**, its own pass — external API + scheduled job + tests.
- Biggest care point: don't change the single-entity/native default (that's what every money-engine
  gate asserts against); only the consolidated (entityId=null) default flips to base currency.

## If only one thing: do B (+A).
Defaulting the consolidated view to base-currency conversion — reusing the F34 engine that already
exists — closes the credibility gap with the least code and the least risk.
