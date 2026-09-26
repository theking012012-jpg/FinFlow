# FinFlow — Launch Checklist (owner/ops)

The CODE is launch-complete (roadmap #2 GL incl. consolidated multi-currency, marketplace, bank-rec,
tax estimator, connectors, security hardening — all harness-verified). What remains is OPS: setting live
credentials/DNS and the final verification sweep. Every item below is something only the owner can do
(keys, DNS, dashboards). Env vars are set in Railway → project → Variables unless noted.

>> ⚠️ **REVERT-BEFORE-LAUNCH — search indexing is OFF.** The app ships with indexing BLOCKED
>> (`X-Robots-Tag: noindex, nofollow` + a `Disallow: /` robots.txt) so nothing gets indexed while
>> testing. **At launch, set `ALLOW_INDEXING=1` in Railway → Variables and redeploy** to let search
>> engines in. Verify afterwards: `curl -sI https://<yourdomain>/ | grep -i x-robots-tag` should be
>> EMPTY, and `curl -s https://<yourdomain>/robots.txt` should show `Allow: /`. (Boot logs print
>> `[SEO] Indexing BLOCKED …` until you flip it.)

## 1. CRITICAL — billing + email are WRONG until these are done
- [ ] **Stripe Business price = $249/mo.** Update the existing Business Price in the Stripe dashboard (or
      customers keep getting charged the old $199). `STRIPE_PRICE_BUSINESS` already points at the Business price.
- [ ] **Create the Scale price ($400/mo) + set `STRIPE_PRICE_SCALE`.** Until set, Scale checkout returns
      "Checkout unavailable". (`STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS` already wired.)
- [ ] **Stripe core envs present:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (webhook signing secret from
      the Stripe dashboard endpoint), `STRIPE_CONNECT_CLIENT_ID` + `STRIPE_CONNECT_REDIRECT_URI` (invoice pay-links).
- [ ] **Resend email domain verified.** Verify `finflow.app` in Resend (add SPF + DKIM DNS records), set
      `RESEND_API_KEY`, and `EMAIL_FROM=noreply@finflow.app` (+ `ADMIN_EMAIL`). Until done, password-reset /
      receipt / invite email to real users is unreliable.
- [ ] **`SESSION_SECRET`** set to a long random value (session signing).
- [ ] **`APP_URL`** = the public https URL (used in Stripe redirects, pay-links, emails).

## 2. Providers — each integration is DARK (clean 502) until its keys are set; add one sandbox txn to confirm
- [ ] **Plaid (US/CA/UK+EU bank feed):** `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production` (+ optional
      `PLAID_COUNTRY_CODES`). Flip from sandbox → production.
- [ ] **Belvo (LatAm bank feed):** `BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`, `BELVO_ENV=production`.
- [ ] **Stripe Identity (accountant KYC):** enable Identity in the Stripe dashboard (no new key — reuses
      `STRIPE_SECRET_KEY`).
- [ ] **OAuth accounting/commerce connectors** (each: client id + secret; dark until set):
      QuickBooks `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET` (`QBO_ENV`), Xero `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET`,
      Zoho `ZOHO_CLIENT_ID`/`ZOHO_CLIENT_SECRET`, Square `SQUARE_APP_ID`/`SQUARE_APP_SECRET` (`SQUARE_ENV`),
      PayPal `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` (`PAYPAL_ENV`), Coinbase `COINBASE_CLIENT_ID`/
      `COINBASE_CLIENT_SECRET`, Shopify `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`.
- [ ] **Finch (payroll/HR):** `FINCH_CLIENT_ID`, `FINCH_CLIENT_SECRET`, `FINCH_ENV`, `FINCH_REDIRECT_URI`.
- [ ] **Codat (accounting importer):** `CODAT_API_KEY`.
- [ ] **Market data (optional, investments):** `FINNHUB_API_KEY`, `COINGECKO_API_KEY`.
- [ ] WiPay / WooCommerce need no env keys — they use per-user merchant credentials entered in-app.

## 3. Security / ops — recommended before real users
- [ ] **`CONNECTOR_ENC_KEY`** set (AES-256-GCM key that encrypts all stored connector tokens at rest).
- [ ] **Uptime monitor** pointed at `GET /healthz` (returns 200 healthy / 503 degraded; DB-reachability).
- [ ] **Security alert email:** set `SECURITY_ALERT_EMAIL` to receive the audit-anomaly digest (brute-force,
      cross-client access, mass-export). Optional `AUDIT_ANOMALY_SCAN_MIN` (default 60).
- [ ] **Sentry** error monitoring — set a DSN (the one remaining monitoring gap; uptime is covered by /healthz).
- [ ] **`CRON_SECRET`** set if driving the scheduler externally.
- [ ] `ANTHROPIC_API_KEY` set (AI assistant / receipt scan).
- [ ] Optional tuning: `PRO_INVOICE_CEILING` (default 500/mo fair-use), per-user `base_currency` for consolidation.

## 4. THE DONE-GATE — do last, right before flipping public
- [ ] **3× full harness sweep** green: `node tests/harness/run-verification-sweep.js` (run three times; expect
      the full suite GREEN, 0 RED each run).
- [ ] **VERIFICATION.md re-sweep on real seeded data** — the doc is explicit that this, not the ledger,
      establishes correctness for sign-off.
- [ ] Prod test-data cleanup (remove QA Tester / Claude TestCPA sample links + rows).
- [ ] Smoke: sign up → create entity → invoice + expense → record payment → view P&L / balance sheet /
      consolidated → connect one bank (sandbox) → accountant invite. Confirm email actually arrives.

Once section 4 is green, FinFlow is live.
