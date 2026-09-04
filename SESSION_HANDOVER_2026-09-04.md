# Session Handover — 2026-09-04 (Reconcile system: Stripe + Bank, money in & out)

## TL;DR
Built the full **reconcile system** — Stripe money-in/out and bank money-out — plus fixed
cross-entity display gaps. Everything money-writing is idempotent and proven not to double-count.
**Full sweep: 188/188 green.** Verified live on production (finflow-production-dab2.up.railway.app),
non-destructively (test writes cleaned up, real books untouched).

## What shipped this session (committed + pushed to main)
| Commit | What |
|--------|------|
| 40b5cea | Stripe live feed (real charges from the connected account) |
| 99f47ad | Add-to-books: import a charge as revenue (idempotent, no double-count) |
| 0965e6f | Reload receipts after import so the dashboard revenue actually moves |
| 597260f | Wave-1 plan: reconcile-to-books as a first-class layer |
| e93a2a1 | Money-out: book Stripe processing **fees** as expense + record **refunds** as contra receipts |
| b7f743e | **Connection scoping** (bind to entity/Personal) + **match-to-invoice** + **payouts** view |
| 8d0620d | **Bank money-out reconcile**: book a debit as expense / match to a bill / ignore |
| 926eac4 | Fix bank-rec UI reading wrong keys (unmatched_bank → unmatchedBanking) |

## Architecture / where data lands (verified live)
- Stripe income → `sales_receipts` (revenue), scoped to the **bound** entity (`_stripeBooksTarget`).
- Stripe fee → separate `expenses` row, category "Payment processing", idem `stripe-fee:<charge>`.
- Refund → **negative** `sales_receipts` (contra), idem `stripe-refund:<charge>`; fee NOT reversed.
- Match-to-invoice → `recordExternalInvoicePayment` (marks invoice paid, NO new revenue), idem `stripe-invpay:<charge>`.
- Bank book-expense → `expenses` (idem `bank-txn:<id>`), stamps the banking row `reconcile_state`.
- Bank match-bill → `payments_made` LINKED to the bill (settles AP, NO new expense — no double-count).
- Personal → `personal_transactions` (entity_id null); a connection bound to Personal is refused (PERSONAL_NOT_SUPPORTED). Personal never appears in business reports.
- Connection binding stored on the `stripe_conn` provider blob: `books:{scope,entity_id}`; endpoint `POST /api/stripe/binding`.

## Key harnesses (all in the 188/188 sweep)
- `verify-stripe-import.js` (71/0) — feed inBooks/matchInvoice/appliedToInvoice, add-to-books, fees, refunds, guard, scoping, match-to-invoice, payouts. RED-proven.
- `verify-bank-money-out.js` (17/0) — book-expense / match-bill (no double-count) / ignore / personal boundary. RED-proven.
- `verify-bankrec-render.js` (6/0) — money-IN reconcile list renders from server shape. RED-proven.
- `verify-stripe-feed-entity-gate.js` (6/0) — feed gated to bound entity (two-sided) + river-clear structural.

## UNCOMMITTED right now (this turn — needs owner to commit in PowerShell)
Two cross-entity display fixes (client only, `public/index.html`; no wiring/bundle change):
1. **Stripe feed entity gating** — `startStripeFeed`/`startStripePayouts` now hide the feed on any
   entity the Stripe account is NOT bound to, showing "This Stripe account books to <X>…" instead.
   (Before: the Saige feed + "✓ in books" showed on every entity's dashboard.)
2. **Money-flow river stale-currency clear** — `switchEntity` now clears `river-wrap` on switch, so the
   previous entity's SVG (currency baked in, e.g. −TT$210 on a CAD entity) can't linger before repaint.
New harness: `tests/harness/verify-stripe-feed-entity-gate.js`.
Commit block is in the chat; files: `public/index.html` + the new harness.

## OUTSTANDING (not built — needs a decision)
1. **Per-entity connections (BIG).** All connectors (Stripe/WiPay/Plaid/Finch/Belvo) are stored at the
   **account level** (`scopeId` = accountId), so every entity shares one set — same Stripe account shows
   "Connected" on all four businesses. Owner wants each business to have its OWN connections. This is a
   real re-architecture: key connection storage on entity_id, per-entity connect/disconnect UI, and a
   decision on which left-nav tabs are truly per-entity vs shared. NOT caused by this session's work.
   The binding work (b7f743e) is step 1 toward it.
2. **Live bank feed.** Bank money-out reconcile acts on rows already in `personal_transactions`
   (source:'banking') from OFX/CSV import (works). Wiring a LIVE provider (Belvo/WiPay) to auto-populate
   debits is the remaining integration.
3. Currency note: "C$" IS the correct CAD symbol (not a bug). All symbols in `CURRENCIES` are correct.

## Deploy / workflow
- Railway auto-deploys on push to main. OneDrive blocks git in the mounted shell → owner commits in
  PowerShell (`del .git\index.lock` first every time).
- Pre-commit hook auto-rebuilds the bundle from staged sources + runs verification-sync (both must pass).
- `index.html` is ship-direct (no bundle). Wiring files (`finflow-api-wiring-*.js`) → `node bundle.js`.
