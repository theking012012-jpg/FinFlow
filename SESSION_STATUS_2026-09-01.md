# FinFlow — Status & Handover (2026-09-01)

**The single source of truth for where the project stands and what's left.**
Live: https://finflow-production-dab2.up.railway.app/app · Railway **Hobby** tier (always-on) · auto-deploys on `git push` to `main` · Repo: `C:\Users\theki\OneDrive\Desktop\finflow-FINAL7 (4)`

Full verification: **169+ harnesses green** (`node tests\harness\run-verification-sweep.js`). The sweep auto-discovers every `tests/harness/verify-*.js` — no manifest to maintain.

---

## 1. Shipped & live this session

**Fix batch** — D2 invoices Billed/Collected/% now exclude scheduled (future-dated) invoices and reconcile; MRR frequency math (case-insensitive + weekly); Chart-of-Accounts totals by category (no more "undefined"); document-viewer "Balance Due" nets payments; reports/bills card labels match their numbers; invoice **View** on every status; entity region dropdowns populate (40 tz / 54 countries); jsdom flaky-test filter widened.

**Date formatting** — payroll run-date, Bank Rec, and 6 money tables (quotes/bills/sales-receipts/credit-notes/payments-made/vendor-credits) now show "Aug 31 2026" instead of raw ISO.

**Integrations — Track A (A0–A4)** — `INTEGRATIONS_STATUS.md` (environment truth); connections hub (already existed); **"Sync now"** trigger on connected connectors (new); Codat books-import review flow (already existed); Banking page **un-orphaned** + **country-based Link routing** (LatAm→Belvo, else→Plaid, fallback→manual OFX/CSV import).

**Investments** — live prices via **symbol resolution** (name→ticker, e.g. "Microsoft"→MSFT); **dynamic crypto** (CoinGecko search, ~15k coins, not a hardcoded 20); **asset-type routing** (fixes ARB stock-vs-Arbitrum collisions); **entry-time validation** on Add Holding; **live symbol picker** (type-ahead, up to 20 matches, click/keyboard, fills ticker+name); **Current-price autofill** from the live quote; Add-Holding **modal widened + full-width dropdown**; status pill softened to amber **"Updating…"** (was red "Offline · cached prices").

**New harnesses (all green, all discriminating):** `verify-d2-total-billed`, `verify-connector-sync`, `verify-banking-region-routing`, `verify-investment-symbol-resolution`, `verify-holding-symbol-picker`.

---

## 2. To finalize — check before you stop

The last couple of `index.html` changes (Add-Holding **modal widen** + **"Updating…" pill**) may still be uncommitted on disk. Confirm and push:

```
git status
git add public\index.html
git commit -m "Investments: widen Add-Holding modal + soften status pill to Updating"
git push
```

`git status` should then read **working tree clean** (except harmless untracked `sweep*.txt` logs and `PHASE*.md` notes — safe to ignore or `.gitignore`).

---

## 3. What's still to be done

### A. Feature — not started
- **Scenario runway** — the one remaining real build. Meaty (server calc + client screen + harnesses), sized like the integrations track. Can be done in one go or phased across sessions; every phase commits independently so pausing loses nothing.

### B. Owner actions — no code needed
- **Flip connectors to production.** They are all **sandbox** right now, so "Sync now" pulls *fake test data*, not your real accounts (Plaid is linked to "First Platypus Bank" — Plaid's sandbox; Finch is provider "ecca" — sandbox; Stripe/WiPay are test accounts; Codat/Belvo unconfigured). To get real data: on Railway → Variables set production keys (`PLAID_ENV=production` + real `PLAID_CLIENT_ID`/`PLAID_SECRET`, real Finch/Codat keys — full list in `INTEGRATIONS_STATUS.md`), redeploy, **re-link your real accounts** (sandbox link won't carry over), then hit **Sync now**.
- **Delete test data.** "ZZ QA" records scattered across tabs (invoices, bills, quotes, COA, etc.), the "ZZ QA Entity", and the leftover test holdings (three MSFT rows + the "MICROSOFT" one). Owner-only — the assistant can't delete data.

### C. Optional / deferred
- Auto-suggest "switch to Crypto" when a coin *name* is typed in the Add-Holding picker while Asset type = Stock.
- **Commodities / forex / futures** are not on the free Finnhub/CoinGecko tiers — a paid-provider decision if ever needed (Twelve Data / Alpha Vantage / Polygon). Metal **ETFs** (GLD, SLV) already quote live and cover most real portfolios.

---

## 4. Architecture notes (for a fresh session)

- **Bundle:** `node bundle.js` concatenates the **10** `public/finflow-api-wiring-*.js` sources into `public/finflow-bundle.js`. Editing any of those 10 requires `node bundle.js` + committing the regenerated bundle. **Ship-direct (NOT bundled):** `index.html`, `app-main.js`, `server.js` (backend, Railway runs it), `finflow-docview.js`, `finflow-f94.js`.
- **Verify before every commit:** `node bundle.js --check` (bundle in sync) → `node tests\harness\run-verification-sweep.js` (all green). New checks are just `tests/harness/verify-*.js` files — auto-discovered.
- **Market data:** `/api/stock-price?symbol=X[&type=crypto]` (Finnhub stocks / CoinGecko crypto, server-side & keyed) and `/api/symbol-search?q=…[&type=crypto]` (name→ticker). Keys are valid and working; only the bank/payroll *connectors* are sandbox.
- **Discipline that's been holding:** every fix ships with a discriminating harness (goes red on the pre-change code), full sweep must be green before commit, and edits are checked for drift before writing to disk.
