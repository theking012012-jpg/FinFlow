# FinFlow — session handover (2026-08-16)

**Repo:** `main`, GitHub `theking012012-jpg/FinFlow`, auto-deploys to Railway.
**LIVE APP = `https://finflow-production-dab2.up.railway.app`** (dab2, NOT dab1 — dab1 is dead/404, see F182).
Read `CLAUDE.md` + `AUDIT_MASTER.md` top (F156–F185) + `VERIFICATION_INTEGRATIONS.md` first.

## FIRST THING in the new session — check for an uncommitted ledger tick
The final ledger commit (ticking F183 / F185 / F181-test-debt to ✅ FIXED in `AUDIT_MASTER.md`) may not have been pushed. In PowerShell:
```
cd "C:\Users\theki\OneDrive\Desktop\finflow-FINAL7 (4)"
git status
git --no-pager log --oneline -5
```
If `AUDIT_MASTER.md` shows modified, commit it:
```
git add AUDIT_MASTER.md
git commit -m "docs: tick F183 (fe16d5d), F185 (0788eb3), F181 test-debt (2994dca) to FIXED"
git push
```
Last CONFIRMED pushed commit was `2994dca` (test-debt).

## Workflow (unchanged, do not violate)
- **HOLD before every commit.** Never `git commit`/`git push` yourself — give the owner exact PowerShell to run from the repo folder. Owner commits in PowerShell and pastes output back.
- Edit **wiring sources** (`public/finflow-api-wiring-*.js`) + `index.html`/`server.js`, **never `public/finflow-bundle.js`** (F13 pre-commit hook rebuilds it from the git index).
- Commit tips: clear stale lock first (`Remove-Item .git\index.lock -Force -EA SilentlyContinue`); kill the pager (`git config core.pager cat`); repo is on a **OneDrive mount** — this session edited files via `device_bash` + Python (pure LF, no CRLF). `.git/index.lock` gets left stale by the cloud bridge.

## What shipped today (all committed + LIVE-verified on the deployed app)
Closed the TWO highest-value live legs end-to-end (real money round-trips into the canonical books):
- **Stripe** ✅ — connect → pay-link → card 4242 → signed webhook → Outstanding $4,000→$2,000 (ford paid).
- **WiPay** ✅ — connect → pay-link → card 4111 → md5 callback → Outstanding $2,150→$2,000.

Bugs found live + fixed (stub tests missed all of these — that's the point of live legs):
- **F180** `52107d0` — Stripe OAuth `scope: read_only`→`read_write` (Stripe rejects read-only; pay-links need write).
- **F181** `62642a6` — invoice Pay-link button passed `.id` (undefined) → `._dbId`.
- **F182** `b176497` — `app-url.js` LIVE_FALLBACK `dab1`(dead)→`dab2`(live).
- **F184** `5241510` + `2397714` — connector cards never showed "Connected" (`loadStates()` stubbed `{}`); added `hydrateStates()` on load + instant flip on ALL connect callbacks.
- **F183** `fe16d5d` — added `public/pay-received.html`; repointed all 6 providers' pay redirects (was site root/marketing).
- **F185** `0788eb3` — pay-link **processor chooser** (when >1 connected) + card **Disconnect** now actually disconnects.
- **test-debt** `2994dca` — `verify-invoice-paylink-button` now EXECUTES the onclick + seeds `_dbId` (ran 8/0 + a negative control proving it catches the `.id` bug).

## Railway env currently set (dab2 service)
`APP_URL=https://finflow-production-dab2.up.railway.app` · `STRIPE_SECRET_KEY`(sk_test) · `STRIPE_CONNECT_CLIENT_ID`(ca_) · `STRIPE_WEBHOOK_SECRET`(whsec_) · `WIPAY_ENV=sandbox`. WiPay account/key are entered IN-APP (encrypted), not env.

## Gotchas worth knowing
- **All Stripe creds must come from ONE Stripe sandbox** (secret key + client id + webhook secret) or you get "authorization code does not belong to you". We used the "Saige Holdings LLC sandbox".
- Stripe webhook = scope **"Connected accounts"** + event `checkout.session.completed` (charge is on the connected account via `Stripe-Account` header). OAuth toggle = "OAuth for Stripe Dashboard accounts"; redirect URI `…/api/stripe/callback`; webhook `…/api/stripe/webhook`.
- Force one processor directly (bypass chooser): `ffInvoicePaymentLink(id,'wipay')`. Chooser entry point: `ffInvoicePayLinkChoose(id)`.
- Claude-in-Chrome browser control connected only intermittently this session — do live legs MANUALLY (owner clicks, Claude verifies numbers / Railway logs). Worked flawlessly for both legs.

## Remaining (needs owner sandbox keys — cannot be done without them)
9 connectors still 🔶 LIVE-PENDING. Next natural legs = **Paystack** / **Flutterwave** (Africa payments, cheap like WiPay). Then dLocal, Mercado Pago, Wise (LatAm/global payments), Plaid, Finch, Codat, Belvo (banking/payroll/accounting — free sandbox keys each).

**The play to close a payment leg (same every time):**
1. Owner connects the provider IN-APP (API connections → provider → Connect → enter secret key; Flutterwave also needs `secret_hash`).
2. Register the provider's webhook in their dashboard → `/api/paystack/webhook` or `/api/flutterwave/webhook` on dab2.
3. Pay-link on an unpaid invoice → chooser → pick the provider → pay with its test card.
4. Verify Outstanding drops by the amount + invoice flips to paid (dashboard, or `/api/reports/balance-sheet`).

**Open findings:** none outstanding beyond the LIVE-PENDING legs — F180–F185 all FIXED, test-debt resolved.

## How to start the next session cheaply
Open a fresh Cowork session on this same folder and say:
> "Read CLAUDE.md, SESSION_HANDOVER_2026-08-16.md, and AUDIT_MASTER.md top. Confirm state, then let's close the Paystack (or Flutterwave) live leg — I have the sandbox key."
