# FinFlow — owner action pack (2026-10-21)

Everything in `LAUNCH_STATUS.md` that needs **your** dashboards or hands. Each step: what to click, the exact env var names,
and a check that proves it worked. **No secret values appear in this file — never paste one into a chat, a commit, or a
log.** Railway paths are "service → Variables" unless stated. Do the steps in this order; 1 is the hard blocker.

Shell for every command below: **PowerShell**, in the repo folder. Replace `<domain>` with the live domain.

---

## 1. Rotate the database password (§1.1 — the hard blocker)

Why: the full production `DATABASE_URL` was pasted into a Claude chat on 2026-10-14. Until it changes, anyone with that
transcript can read and change the live books.

1. **Supabase → your project → Project Settings → Database → Database password → Reset database password.** Let it
   generate a long random one. Copy it once, into your password manager — nowhere else.
2. **Supabase → Connect → Session pooler** → copy the connection string (`postgresql://postgres.<ref>:[YOUR-PASSWORD]@…pooler.supabase.com:5432/postgres`).
   Put the new password in place of `[YOUR-PASSWORD]` (URL-encode any `@ : / ? #` in it).
3. **Railway → FinFlow service → Variables → `DATABASE_URL` → edit → paste → Save.**
   - **No trailing newline or space.** Paste, then press `End` and check the cursor sits right after `postgres`.
   - If you also run the release step / `finflow_app` role (§11), rotate those too.
4. Railway redeploys on save. If not: **Deployments → ⋮ → Redeploy**.

**How to recognise a bad paste** (old password, a stray newline, an un-encoded symbol) — these three in the Railway log
**together** mean bad credentials, not an outage:
- `28P01` (`password authentication failed for user …`)
- `ECIRCUITBREAKER` (Supabase's pooler refusing after repeated auth failures — it clears ~1 min after the cause is fixed)
- `[Session Store] non-fatal: …` (sessions can't be stored, so every sign-in silently fails)

Fix the variable and redeploy; do not retry sign-in in a loop (it keeps the circuit breaker open).

**Verify:**
```powershell
curl.exe -s https://<domain>/healthz
```
expect `{"status":"ok","db":"up",…}` (a `503 … "db":"down"` means the URL is still wrong). Then sign in once in a
private window and open the Dashboard. Finally confirm the old string is dead: in a local shell, set `DATABASE_URL` to the
**old** value and run `node -e "new (require('pg').Client)({connectionString:process.env.DATABASE_URL}).connect().then(()=>console.log('STILL WORKS — not rotated'),e=>console.log('refused:',e.code))"`
→ must print `refused: 28P01`. Then clear that variable from the shell.

---

## 2. Full sweep ×2 more on `main` (§0.1)

The sweep's per-harness timer printed `(0.0s)` for every harness. That was a display bug only (fixed in this pack's
commit 0a — `clock.js` pinned `Date.now()` inside the runner too); the harnesses did run. After pulling the fixes below,
the times are real.

Run and capture all three runs to files (scrollback drops lines):
```powershell
1..2 | ForEach-Object { node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js *> "$env:TEMP\sweep-$_.log" }
Select-String -Path "$env:TEMP\sweep-*.log" -Pattern "SWEEP COMPLETE|^\s+FAIL"
```
Expect: `SWEEP COMPLETE — N/N GREEN, 0 RED` in each file, and no `FAIL` lines. Send me the `SWEEP COMPLETE` lines (and any
`FAIL` lines with the 18 lines after them).

---

## 3. Confirm the schema changes applied (§0.3)

**Railway → service → Deployments → latest → View logs.** Search for each line below; all must appear on the first boot
after the deploy, and none of the "must NOT appear" lines.

Must appear:
- `[DB] PostgreSQL schema ready`
- `[migrate] applied 2026-10-20-admin-log-hardening.sql` (only on the first boot after that commit)
- `[migrate] applied 2026-10-20-audit-trail-user-agent.sql` (same)
- after this pack's commits: `[migrate] applied 2026-10-21-personal-transactions-idem-key.sql` and
  `[migrate] applied 2026-10-21-personal-history.sql`

Must NOT appear: `[audit] recordAudit failed`, `[personal-history] not recorded`, `[migrate] FAILED`.

If you can't find the `[migrate] applied` lines (they print once, on the first boot), check the table instead —
Supabase → SQL editor (read-only):
```sql
SELECT name, applied_at FROM schema_migrations WHERE name LIKE '2026-10-2%' ORDER BY name;
```

---

## 4. Live re-check of LR1 / LR2 / LR3 / LR4 / LR7 (test entity only)

Use a **test** business (create "ZZ-LIVECHECK LR" if needed). Never a real customer's books.

| # | Steps | Pass when |
|---|---|---|
| LR1 | Payroll → Run payroll → pick a period that already has a **voided** run → Run. Then pick a fresh period → Run. | First: a clear message naming the voided run (HTTP 409, not 500). Second: run created. Railway log has no `[Unhandled Error]` at that minute. |
| LR2 | Dashboard → note "Money flow" net profit → Expenses → add a $1 expense "ZZ-LIVECHECK LR2" → back to Dashboard (no reload). | Money flow net profit dropped by exactly $1, matching Reports → NET RESULT. |
| LR3 | Switch business to a second (test) business → Dashboard. | Money flow renders within ~3 s; never stuck "Loading…". |
| LR4 | On a **non-USD** test business with no payroll run: Payroll page helper text. | Reads "…show nothing for payroll" — no bare "$". |
| LR7 | Budget → Set targets → type Rent 1,200 (Annual) → switch to Monthly → shows 100 → Save → reopen. | Reopens in Annual with 1,200 (not 14,400). |

Record each as PASS/FAIL in `COWORK_LIVE_CHECK.md` or send me the results. Delete the ZZ-LIVECHECK records afterwards (or
leave them for the §8 purge — the tool lists them).

---

## 5. Resend — real e-mail (§1.2)

1. **resend.com → Domains → Add domain** → your domain (or a sending subdomain such as `mail.<domain>`).
2. Resend shows DNS records. At your DNS host (Cloudflare once §12 is done) add **exactly** what it shows:
   - **SPF**: a `TXT` record on the `send` subdomain (value starts `v=spf1 include:amazonses.com …`) + its `MX` record.
   - **DKIM**: the `TXT` record named `resend._domainkey` (long `p=…` value).
   - Optional but recommended: **DMARC** `TXT` on `_dmarc` → `v=DMARC1; p=none;` to start.
   In Cloudflare these must be **DNS only (grey cloud)**.
3. Back in Resend → **Verify DNS records**. Wait for **Verified** on every record.
4. **Resend → API Keys → Create** → permission **Sending access**, restricted to that domain. Copy once.
5. Railway variables:
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = `FinFlow <noreply@<your verified domain>>`
   - `ADMIN_EMAIL` = the address that should receive admin notices
6. Save → redeploy.

**Verify (must be a NON-owner address):** sign out → "Forgot password" → enter a test account whose e-mail is **not**
the Resend account owner's (e.g. a second mailbox you control). The e-mail must arrive. Then **Resend → Logs** → that
send shows **Delivered**.

Caution (LR23, open): the app records an e-mail as "sent" when Resend *accepted the call*, even if Resend refused it.
Until LR23 is fixed, the Resend log is the only proof of delivery.

---

## 6. Stripe — prices + live mode (§1.3, §1.4)

**Prices** (Stripe → Product catalog, **live** mode toggle on):
1. Open the **Business** product → **Add another price** → $249.00 / month, recurring → Save. (Prices can't be edited;
   archive the old $199 price after the new one is set in Railway.)
2. **Create product** "Scale" → $400.00 / month, recurring.
3. Copy each live price id (`price_…`).

**Railway variables** (all live-mode values):
| Variable | Where it comes from |
|---|---|
| `STRIPE_PRICE_PRO` | Pro product → its monthly price id |
| `STRIPE_PRICE_BUSINESS` | Business → the NEW $249 price id |
| `STRIPE_PRICE_SCALE` | Scale → the $400 price id |
| `STRIPE_SECRET_KEY` | Developers → API keys → Secret key (`sk_live_…`) — or a restricted key |
| `STRIPE_WEBHOOK_SECRET` | from the endpoint below (`whsec_…`) |
| `STRIPE_CONNECT_CLIENT_ID` | Settings → Connect → Onboarding options → OAuth → live client id (`ca_…`) |
| `STRIPE_CONNECT_REDIRECT_URI` | `https://<domain>/api/stripe/callback` (also register it under Connect → OAuth → Redirects) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | only if you add a separate Connect webhook endpoint (optional) |

**Webhook endpoint:** Developers → Webhooks → **Add endpoint** → URL `https://<domain>/api/stripe/webhook` →
events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `payment_intent.succeeded`,
`charge.refunded`, `charge.dispute.created`, `account.updated`, `identity.verification_session.verified`,
`identity.verification_session.processing`, `identity.verification_session.requires_input`,
`identity.verification_session.canceled` → Add → reveal the **Signing secret** → `STRIPE_WEBHOOK_SECRET`.

Save → redeploy.

**Verify:**
```powershell
curl.exe -s -o NUL -w "%{http_code}" -X POST https://<domain>/api/stripe/webhook -H "Content-Type: application/json" -d "{}"
```
→ `400` (signature refused = the secret is loaded). Then **one real paid upgrade**: a trial account → Upgrade → Business →
Stripe Checkout with a real card → back in FinFlow the plan shows **Business** (paid), and Stripe → Webhooks → the
endpoint shows `checkout.session.completed` **200**. Refund it from Stripe afterwards if it was your own card. This
closes F132's last half.

---

## 7. Core settings (§1.5)

| Variable | Value |
|---|---|
| `CONNECTOR_ENC_KEY` | 64 hex chars (generator below). **Set this FIRST, once, and never change it** — it encrypts stored bank / connector tokens. Back it up in your password manager. |
| `SESSION_SECRET` | 64+ random characters. **If it is already set in Railway, leave it.** Read the warning below before ever changing it. |
| `APP_URL` | `https://<domain>` — no trailing slash. Used in every e-mail link and OAuth redirect. |

> ⚠ **Do not change `SESSION_SECRET` if any bank or service is already linked.** Tokens stored while
> `CONNECTOR_ENC_KEY` was NOT set were encrypted with a key derived from `SESSION_SECRET` (`server.js` ~7521–7533). Change
> `SESSION_SECRET` and those tokens can no longer be read — every such bank / connector must be unlinked and linked
> again. Safe order: (1) add `CONNECTOR_ENC_KEY` now (new links use it; old ones still open via `SESSION_SECRET`);
> (2) only rotate `SESSION_SECRET` if you must, and then re-link the old connections. If nothing has been linked on
> production yet (or you start on a fresh database, §8 Path B), rotating is free — it just signs everyone out once.
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys (AI assistant + receipt scan) |
| `ALLOWED_ORIGIN` | `https://<domain>` |
| `NODE_ENV` | `production` |

One-line generator (prints to your screen only — paste straight into Railway, don't save it anywhere else):
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
(Run once for `CONNECTOR_ENC_KEY`; and for `SESSION_SECRET` only if it is not set yet — see the warning above.)

**Verify:** `curl.exe -s https://<domain>/healthz` → `ok`; sign in; Settings → "Ask AI" one question → it answers;
a password-reset e-mail's link starts with `https://<domain>/`.

---

## 8. Production test data (§1.6) — choose ONE path

The tools (this pack, A6) are read-only by default. **Rule 8: you run the write step, not Claude.**

**Step 1 — list (read-only, safe):**
```powershell
$env:DATABASE_URL = "<production URL from your password manager>"
node tools/launch/list-test-data.js > "$env:TEMP\test-data.txt"
notepad "$env:TEMP\test-data.txt"
Remove-Item Env:DATABASE_URL
```
It lists every ZZ-QA / `AUDIT TEST` / `ZZ-LIVECHECK` / Cowork record with its id, the QA Tester and Claude TestCPA
accountant links, the Nov 2026 Cowork payroll run, and the FreshBooks integration request — and the ACCOUNT each sits on.
**Read it. If any line is a real record, stop and tell me.**

**Path A — clean this database:**
```powershell
$env:DATABASE_URL = "<production URL>"
node tools/launch/purge-test-data.js                 # dry run: prints exactly what it would void / delete, changes nothing
node tools/launch/purge-test-data.js --apply         # only after the dry run matches the list you reviewed
node tools/launch/list-test-data.js                  # must now print "0 test records"
Remove-Item Env:DATABASE_URL
```
The purge voids / reverses through the same paths the app uses (paid payroll run voided, payments removed before their
invoices) so the books stay balanced; it refuses to run if the dry-run list changed since you reviewed it (it prints a
fingerprint — pass it with `--expect <fingerprint>`).

**Path B — launch customers on a fresh database:** create a new Supabase project → copy its session-pooler URL → set
Railway `DATABASE_URL` to it (as in §1) → redeploy (boot builds the schema) → `curl.exe -s https://<domain>/healthz` →
`ok` → sign up your own owner account again. Keep the old project paused (not deleted) for 30 days.

---

## 9. Restore drill (§1.7)

Needs `pg_dump` / `pg_restore` / `psql` (PostgreSQL 17 client tools — install "Command Line Tools" only from the
PostgreSQL Windows installer, or run it in the Railway shell). **Never point DEST at production**: the drill runs
`pg_restore --clean`, which DROPS objects in DEST. The script refuses a DEST containing `prod`, and (A5, this pack) a DEST
that is the same host + database as SRC.

```powershell
$env:SRC  = "<production URL — used only by pg_dump (read)>"
$env:DEST = "<a SCRATCH database: a new empty Supabase project, or a local postgres>"
bash scripts/restore-drill.sh
Remove-Item Env:SRC, Env:DEST
```
Pass when it ends with `RESTORE DRILL PASSED` and lists non-zero row counts for the core tables. Then point a local
checkout at DEST (`$env:DATABASE_URL=…; npm start`), sign in, open an invoice and a report. Write down how long it took
(RTO) and the backup age (RPO) in `LAUNCH_STATUS.md` §1.7.

---

## 10. Monitoring (§2.1, §2.2, §2.8)

1. **Uptime:** UptimeRobot (free) or Better Stack → new HTTP monitor → `https://<domain>/healthz` → every 1–5 min →
   alert on non-200 **and** on keyword missing `"status":"ok"` → your phone / e-mail. Verify: the monitor shows Up.
2. **Sentry:** sentry.io → new project → Node.js → copy the DSN → Railway `SENTRY_DSN`. Optional:
   `SENTRY_TRACES_SAMPLE_RATE=0.1`. This needs the `@sentry/node` dependency that this pack adds (A5) — without it the
   DSN does nothing (boot logs `[Sentry] Package not installed`). Verify: Railway log on boot shows
   `[Sentry] Initialized`; then in **Railway → service → ⋯ → Shell** run
   `node -e "const S=require('@sentry/node');S.init({dsn:process.env.SENTRY_DSN});S.captureException(new Error('FinFlow Sentry test'));S.flush(5000).then(()=>console.log('sent'))"`
   → prints `sent`, and the "FinFlow Sentry test" issue appears in Sentry within a minute.
3. **`SECURITY_ALERT_EMAIL`** = the address for the audit-anomaly digest (needs §5). **`LOG_REQUESTS=1`** for one JSON
   line per request in the Railway log (turn off if log volume is a problem).

---

## 11. Least-privilege DB role (§2.3) — `INFRA_RUNBOOK.md` §4

Do it on a Supabase **branch / staging copy first**.
1. Create the role with `psql` (the script takes the password as a psql variable, so it never lands in the file):
   ```powershell
   $env:OWNER_DATABASE_URL = "<current owner URL>"
   $pw = node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   psql $env:OWNER_DATABASE_URL -v app_pw="$pw" -f scripts/db-app-role.sql
   ```
   Store `$pw` in your password manager, then `Remove-Variable pw`. Check:
   `psql $env:OWNER_DATABASE_URL -c "SELECT rolname, rolsuper FROM pg_roles WHERE rolname='finflow_app'"` → `rolsuper = f`.
2. Railway → add variable `OWNER_DATABASE_URL` (the current owner URL) → service **Settings → Deploy → Pre-deploy
   command**: `DATABASE_URL=$OWNER_DATABASE_URL node scripts/migrate.js` (`migrate.js` reads `DATABASE_URL`; this hands
   it the owner URL for the release step only).
3. Variables: `DATABASE_URL` → the same pooler host, user `finflow_app.<project-ref>`, the new password;
   `SKIP_INIT_DDL=1`.
4. Redeploy. Logs must show `[migrate] OK — schema ready` (pre-deploy) and the web process booting with no
   `permission denied`.

**Rollback (instant):** set `DATABASE_URL` back to the owner URL and delete `SKIP_INIT_DDL` → redeploy.

---

## 12. Cloudflare (§2.4) — `INFRA_RUNBOOK.md` §2

Add site (Free) → check the Railway CNAME is imported and **Proxied** → change nameservers at the registrar →
SSL/TLS **Full (strict)** → WAF **Managed Ruleset on** → Always Use HTTPS + Automatic HTTPS Rewrites. Resend's DNS records
(§5) stay **DNS only**.

**Verify:** `curl.exe -sI https://<domain>/ | Select-String "cf-ray|server"` → shows `cf-ray` and `server: cloudflare`.
Then sign in from your phone on mobile data and check Settings → Recent security activity shows **your phone's** IP, not a
Cloudflare one — **this currently fails for a different reason: LR26** (the security log stores the proxy's address, not
yours). Until LR26 is fixed, new-device alerts are unreliable.

---

## 13. Connector go-live keys (§3.1)

Decide which go live first (`DECISIONS_2026-10-21.md` 3.1). For each: create the production app at the provider,
register the redirect URI exactly, put the keys in Railway, redeploy. A connector with no keys shows a clean "not set up".

| Provider | Railway env vars | Redirect URI to register | Provider review? (typical) |
|---|---|---|---|
| Plaid | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production`, `PLAID_COUNTRY_CODES` (e.g. `US,CA,GB`) | none (Link token flow); add `https://<domain>` under allowed redirect URIs only if OAuth banks are enabled | **Yes** — production access application + security questionnaire; days to ~2 weeks. Asks for the terms / privacy pages (§2.6). |
| Belvo (LatAm) | `BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`, `BELVO_ENV=production` | none | **Yes** — production onboarding; ~1–3 weeks |
| QuickBooks | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENV=production`, `QBO_REDIRECT_URI` | `https://<domain>/api/quickbooks/callback` | **Yes** — Intuit app assessment; ~1–4 weeks |
| Xero | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI` | `https://<domain>/api/xero/callback` | Up to 25 connections uncertified; certification (App Partner) for more — weeks |
| Zoho Books | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI` | `https://<domain>/api/zohobooks/callback` | No formal review |
| Square | `SQUARE_APP_ID`, `SQUARE_APP_SECRET`, `SQUARE_ENV=production`, `SQUARE_REDIRECT_URI` | `https://<domain>/api/square/callback` | No review for OAuth apps; App Marketplace listing optional |
| PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=live`, `PAYPAL_REDIRECT_URI` | `https://<domain>/api/paypal/callback` | "Log in with PayPal" live app approval — days |
| Coinbase | `COINBASE_CLIENT_ID`, `COINBASE_CLIENT_SECRET`, `COINBASE_REDIRECT_URI` | `https://<domain>/api/coinbase/callback` | OAuth app review — days to weeks |
| Shopify | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_REDIRECT_URI` | `https://<domain>/api/shopify/callback` | Public app → App Store review (~1–2 weeks); a custom/unlisted app avoids it |
| Finch (payroll) | `FINCH_CLIENT_ID`, `FINCH_CLIENT_SECRET`, `FINCH_ENV`, `FINCH_PRODUCTS`, `FINCH_REDIRECT_URI` | `https://<domain>/api/finch/callback` | Yes — production access agreement |
| Codat | `CODAT_API_KEY` | none | Commercial agreement |
| Stripe Connect | see §6 | `https://<domain>/api/stripe/callback` | Connect platform profile |
| Market data (optional) | `FINNHUB_API_KEY`, `COINGECKO_API_KEY` | — | No |
| WiPay / WooCommerce | none server-side (per-user credentials in the app) | — | — |

Review times are typical, not promises — check each provider's current docs. Each `*_REDIRECT_URI` is optional when it
equals `APP_URL + /api/<key>/callback` (the default), but setting it explicitly avoids a mismatch.

---

## 14. The launch moment (§1.8, §4)

In this order, on the exact commit going live:
1. **Final sweep ×3** (the §2 command with `1..3`) — all three `N/N GREEN`.
2. **Human smoke test** on production, with a new account (not yours):
   sign up → create a business → add an invoice + an expense → record a payment on the invoice → P&L, Balance sheet,
   "All entities" all agree → connect one sandbox bank (or import a statement) → invite an accountant → **confirm every
   e-mail arrived** (sign-up, invite) and Resend → Logs shows them Delivered.
3. **`ALLOW_INDEXING=1`** in Railway → redeploy. Verify:
   ```powershell
   curl.exe -sI https://<domain>/ | Select-String -Pattern "x-robots-tag"      # must print NOTHING
   curl.exe -s https://<domain>/robots.txt                                       # must show "Allow: /"
   ```
4. **Live check** — `COWORK_LIVE_CHECK.md` A + B + C on production: no open FAIL (§4.4).

---

## 15. T4 + LR17 (your two hand checks)

**T4 — wrong-password sign-in:** private window → sign in with your e-mail and a deliberately wrong password once →
then sign in correctly → Settings → Recent security activity. Pass: a **"Failed sign-in"** line with device + IP at that
minute, above the "Signed in" line.

**LR17 — did the 2026-10-20 12:24 new-device alert actually send?** Resend → **Logs** → filter 2026-10-20, around
12:24 (your local time) → look for subject "New device signed in to your FinFlow account". Pass = **Delivered**; a
"refused / sandbox" status or no row means it never went out (that is LR23 — the app records "sent: true" when Resend
refused). Tell me which.
