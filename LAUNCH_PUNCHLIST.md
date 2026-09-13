# FinFlow — Launch Punch-List

_Distilled from OUTSTANDING.md (reconciled 2026-09-12), current as of 2026-09-13 after commit `3c59133`._
_All feature/security code from the recent sessions is shipped and green. What's below is what's genuinely left._

---

## 🔴 Owner / ops — must do (no code from me; some are launch blockers)

**Billing — REQUIRED before the new prices are real** (until done, customers get charged the old amounts or can't buy Scale):
- [ ] Update the **Stripe Business price to $249** (still $199 in Stripe today → customers keep getting billed $199).
- [ ] Create a **Stripe price for Scale ($400)** and set **`STRIPE_PRICE_SCALE`** in Railway (until then Scale checkout returns "Checkout unavailable"). `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS` already wired.
- [ ] **Enable Stripe Identity** in the Stripe dashboard (no new key needed) — this lights up the KYC flow that's already built.

**Email — launch blocker for real users:**
- [ ] **Verify the `finflow.app` domain in Resend** (SPF/DKIM) and set `EMAIL_FROM` in Railway. Until then, password-reset and receipt emails to real users are unreliable. (~15 min DNS.)

**Bank / connectors — dark until keyed:**
- [ ] **Provider go-live keys** — Plaid → production, Belvo keys, plus 8 connectors each need live keys + one sandbox transaction. Code is built and verified to the network boundary.

**Infra hardening:**
- [ ] **Cloudflare** in front of the domain (DNS proxied/orange-cloud, TLS **Full (strict)**, managed WAF ruleset). Free tier is enough to launch behind. ~15 min, no code change.
- [ ] **Tested backups + point-in-time restore** — actually run a restore, don't just configure it (Supabase/Railway plan).
- [ ] **Least-privilege DB role** — app connects as a non-superuser that can't `DROP`/`ALTER` schema.
- [ ] **Secrets rotation cadence** — DB URL / Stripe / connector keys on a schedule and on any suspected exposure.

**Housekeeping:**
- [ ] **Move the repo out of OneDrive** — this is what's causing the recurring `.git/index.lock` fight on every commit.
- [ ] **Prod test-data cleanup** — remove the QA Tester + Claude TestCPA links/rows.

---

## 🟡 Code — buildable by me (none launch-blocking; each its own verified pass)

- [ ] **Postgres Row-Level Security** — DB-level tenant isolation so a route that ever forgets `WHERE user_id` still can't leak. Pairs with the isolation harness that just shipped. (Needs per-session user threading through the Supabase pooler — the reason it wasn't rushed.)
- [x] **Owners' MFA — ✅ DONE 2026-09-13** — login gate + Settings 2FA enrollment card (setup/enable/disable), secret AES-GCM at rest in `users.data`. Verified: `verify-owner-mfa` 18/0, `verify-owner-mfa-login-ui` 13/0, `verify-owner-mfa-enroll-ui` 26/0.
- [ ] **Audit-log anomaly alerting** — the audit trail exists; wire alerts on the scary signals (mass export, one accountant touching many clients, impossible-travel logins, access spikes).
- [ ] **Error monitoring (Sentry) + uptime alerting** — build side is quick; needs a DSN from you (ops).
- [ ] **Mobile performance** — the `.min.js` minify build (esbuild/terser → minified siblings, update index.html + SW refs, keep `no-store`, add a Playwright smoke of the built output). Compression + region routing already done; this is the last perf lever. Deliberate babysat pass, non-blocking.
- [x] **Connector-token encryption coverage — ✅ VERIFIED 2026-09-13** — audit across all 13 connectors: every stored credential is encTok'd (AES-256-GCM, `CONNECTOR_ENC_KEY`); Codat/Belvo store no per-user secret. No gaps.
- [ ] **KYC Phase C — per-body registry-portal links (DEFERRED, needs URL verification).** v1 (Google-search verify link + status badge) is the working stopgap; per-body direct links need each portal URL verified (US CPA/cpaverify.org, ACCA, ICAEW, CPA Canada, ICATT, …) — do in a pass with web access, don't hardcode unverified URLs.
- [ ] **`express` 4 → 5** — clears the last remaining `qs` moderate advisory (didn't force it; it's a major bump).
- [ ] **CSP `script-src 'unsafe-inline'` removal (L3)** — 623 inline handlers → `addEventListener`, page by page. Big, low-urgency; rest of the CSP is already tight.

---

## 🟢 The real done-gate

- [ ] **Full VERIFICATION.md re-sweep on real seeded data** before launch sign-off. The doc is explicit that this — not the tracking ledger — establishes correctness.

---

## 🌍 World-class roadmap (product, not launch-blocking)

Ranked by leverage. If only two: **#1 and #3.**

1. **FX base-currency consolidation** — the #1 credibility item. `computeBooks` all-entities aggregate currently raw-sums across currencies (a TTD + a USD entity produce a nonsense "total"). Convert to a base/reporting currency everywhere with transaction-dated FX rates.
2. **Make "the books are provably correct" a marketed asset** — trial balance always ties to zero, immutable audit trail, period locks that truly lock, reversing entries instead of edits. Then say it publicly as a trust wedge.
3. **Finish the accountant-marketplace moat** — KYC (step 1 shipped), reviews with teeth, secure document exchange, e-signature, invisible commission/billing.
4. **Time-to-value: import + bank rec** — frictionless QuickBooks/Xero/CSV import + genuinely good bank-feed auto-matching.
5. **Localized tax & filing** — TT VAT et al., auto-computed and filing-ready — makes "file on my behalf" real.
6. **Architecture ceiling** — push aggregation into SQL (today `computeBooks` pulls all rows and sums in Node) before anyone has ~5 years of data. Cheap now, expensive later.
