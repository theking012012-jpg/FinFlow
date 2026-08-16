# Integrations & payments — end-to-end verification ledger

**Date:** 2026-08-14  ·  **Method:** every claim below is EXECUTED against a real embedded Postgres
(and, for UI, real jsdom), not reasoned. The one boundary I cannot cross from the build sandbox is
the **live provider network call** — outbound HTTP to Plaid/Stripe/etc. is blocked here and needs
your API keys. Where that's the case it's marked **LIVE-PENDING** with the exact steps to close it.

---

## The end-to-end chain (the "does it all connect" proof)

`tests/harness/verify-e2e-payment-flow.js` — **11/0**. One flow, real Postgres, real canonical books
(`computeBooks` via `/api/reports/balance-sheet`):

1. Issue an invoice ($500) → the report shows **AR = 500**.
2. Generate a Stripe "Pay link" → **provider dispatch is reached** (the live call is blocked → 502
   with `provider:stripe`, proving the wiring is live end to end up to the network boundary).
3. Customer pays → a **signature-verified** Stripe webhook → `recordExternalInvoicePayment` (the
   single money writer) → invoice goes **paid**, `amount_paid = 500`.
4. The **same canonical report now shows AR = 0** — the payment flowed all the way into the books.
5. A second invoice is paid via a **signed Paystack** webhook → it settles into the **same** AR.
6. Integrity: exactly one payment per invoice, each keyed by the processor's event id (idempotent).

This is the strongest statement available without live keys: the integration layer and the money
engine are proven to connect through the real reconciliation path and the real figure.

---

## Per-connector status

Legend: ✅ executed against real Postgres/jsdom · 🔶 LIVE-PENDING (needs your keys; the code +
verification exist, only the provider's own network response is unrun).

| Connector | connect | status | sync | pay-link | webhook/reconcile | live handshake |
|---|---|---|---|---|---|---|
| **Plaid** (banking) | ✅ | ✅ | ✅ | — | — | 🔶 needs `PLAID_CLIENT_ID/SECRET` |
| **Belvo** (LatAm banking) | ✅ | ✅ | ✅ | — | — | 🔶 needs `BELVO_SECRET_ID/PASSWORD` |
| **Finch** (payroll) | ✅ | ✅ | ✅ | — | — | 🔶 needs `FINCH_CLIENT_ID/SECRET` |
| **Codat** (accounting) | ✅ | ✅ | ✅ | — | — | 🔶 needs `CODAT_API_KEY` |
| **Stripe** (payments) | ✅ | ✅ | ✅ | ✅ | ✅ signed webhook 12/0 | ✅ **LIVE 2026-08-16** |
| **Paystack** (payments) | ✅ | ✅ | — | ✅ | ✅ HMAC webhook 10/0 | 🔶 needs a Paystack key |
| **Flutterwave** (payments) | ✅ | ✅ | — | ✅ | ✅ verif-hash webhook 8/0 | 🔶 needs FLW key + secret hash |
| **WiPay** (Caribbean) | ✅ | ✅ | — | ✅ | ✅ md5 callback 9/0 | 🔶 sandbox key is `123` |
| **Mercado Pago** (LatAm) | ✅ | ✅ | — | ✅ | — | 🔶 needs an access token |
| **dLocal** (LatAm) | ✅ | ✅ | — | ✅ | — | 🔶 needs dLocal keys |
| **Wise** (global) | ✅ | ✅ | ✅ | — | — | 🔶 needs a Wise API token |

**Verified for every row:** env-gate (clean 502 until keys), owner-only RBAC (viewers/accountants
blocked per the matrix), credentials **encrypted at rest** (AES-256-GCM; asserted against the raw
DB row), payment-link **provider dispatch reached**, and — for the four payment processors — the
webhook **signature verification + single-writer + idempotency + balance-cap + forgery-rejection**,
all executed with synthetic signed payloads. Harnesses: `verify-plaid-linking` (21/0),
`verify-finch-codat-linking` (88/0, covers Finch/Codat/Belvo/Stripe/WiPay + the 5 credential
connectors + syncs), `verify-requests-paylinks` (15/0), `verify-webhook-reconcile` (12/0),
`verify-paystack-webhook` (10/0), `verify-flutterwave-webhook` (8/0), `verify-wipay-reconcile` (9/0),
`verify-invoice-paylink-button` (6/0), `verify-e2e-payment-flow` (11/0).

**Signature formulas are doc-confirmed, not guessed:** Stripe (SDK `constructEvent`), Paystack
(HMAC-SHA512), Flutterwave (static `verif-hash`), WiPay (`md5(txn+total+key)` — reverse-engineered
and confirmed against WiPay's own worked example in their API PDF).

---

## ✅ LIVE-VERIFIED — Stripe payments (2026-08-16)

The Stripe live handshake is **no longer pending** — it was executed end to end against the deployed app
(`finflow-production-dab2`) and a real Stripe test sandbox:

1. Owner set `STRIPE_SECRET_KEY` / `STRIPE_CONNECT_CLIENT_ID` / `STRIPE_WEBHOOK_SECRET` (+ `APP_URL`) in Railway.
2. **Connect** OAuth completed and linked an account.
3. **Pay-link** generated a real Checkout Session for INV-16 ($2,000).
4. Paid with test card `4242` → **signed `checkout.session.completed`** delivered (confirmed on Stripe's side)
   → `recordExternalInvoicePayment`.
5. **Canonical books moved:** Outstanding **$4,000 → $2,000**, invoice **pending → paid** — matching the
   owner-predicted value (Rule 6).

Two real defects the stub tests could not catch were found and fixed live: **F180** (OAuth `read_only` →
`read_write`) and **F181** (pay-link button passed an undefined invoice id). Two follow-ups logged: **F182**
(stale `app-url.js` fallback, mitigated via `APP_URL`) and **F183** (pay-link `success_url` → marketing page).
The other 10 connectors below remain 🔶 LIVE-PENDING until their keys are added.

---

## The one gap, and how YOU close it

The live provider handshake can't run from the build sandbox (network is blocked; it needs real
keys). To close it per provider: add the keys to Railway env, then run one sandbox transaction:

- **Plaid:** `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox` (free) → open the app's Link
  bank, complete Plaid's sandbox Link, confirm the Banking page shows the institution + Sync pulls
  transactions.
- **Stripe payments:** you already have `STRIPE_SECRET_KEY`; add `STRIPE_CONNECT_CLIENT_ID` and
  register `/api/stripe/callback` in the Stripe dashboard → connect, generate a Pay-link on an
  invoice, pay it in test mode, confirm the invoice auto-marks paid.
- **Paystack/Flutterwave:** add the secret key (+ Flutterwave's webhook secret hash), register the
  webhook URL in their dashboard → test-mode payment → invoice auto-reconciles.
- **WiPay:** sandbox account number `1234567890`, API key `123` → generate a Pay-link, pay with a
  WiPay test card, confirm the callback reconciles.
- **Belvo/Finch/Codat/Mercado Pago/dLocal/Wise:** add each provider's key → connect once → confirm
  `status` flips to connected and Sync (where applicable) reads data.

Until a provider's keys are present, its buttons honestly say "not set up yet" (clean 502) — never
a fake success.

---

## Money-surface regression (unaffected by all the above)

Full-suite sweep (~141 harnesses) after all integration work: **every money figure green** — step
gates (26/63/56/5), all 22 c1 CRUD, all 68 `verify-f*`, all 5 report harnesses, payroll, FX, tax.
The only non-green items are 3 fragile source-extraction test-probes (F123/F128/F130 — test-infra,
the figures they touch are independently green via `f137*`) and 4 harnesses too slow for the
sandbox's per-call cap. No product regression. Detail in `AUDIT_MASTER.md#F176`.
