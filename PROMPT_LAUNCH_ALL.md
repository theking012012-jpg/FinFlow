# FinFlow — clear every remaining launch item

You are picking up FinFlow at `main` @ `9682467`. That commit is the LR1 / LR2-LR3 / LR4 / LR7 fixes merged. The owner's sweep on it was 576/576 GREEN (×1). Railway auto-deploys `main`.

**Read first, in this order:**
1. `CLAUDE.md`. Its rules are binding.
2. `LAUNCH_STATUS.md`. This is the authoritative checklist; the § numbers below refer to it.
3. `HANDOVER.md`, the 2026-10-20 top section.
4. `AUDIT_MASTER.md`: the LR1–LR21 rows and the LC3c row.

**Goal:** close every open item in `LAUNCH_STATUS.md`.
- Where an item is code, build it.
- Where it needs the owner's dashboards or hands, prepare everything so the owner's part is copy-paste plus a verification command.
- Where it is an owner decision, write the brief and STOP. Do not build ahead of a decision.

## Ground rules (non-negotiable)

- **Never commit, push, or run git write commands.** The owner runs all git in PowerShell. After each finished item, give him the exact commands: `git add <files>` + `git commit -m "..."`. Use one item per commit and stage files explicitly; never use `git add -A`.
- **Every code fix follows the same order:**
  1. Write the harness first.
  2. Run it on the old code and show it fails (RED). The failing run is the evidence; a passing test alone proves nothing.
  3. Fix, then run it GREEN.
  4. Re-run the related harnesses.
  5. Record the counts in the item's `AUDIT_MASTER.md` row.
- **Rule 8:** never change production data. Data scripts are read-only by default. Anything that writes needs an explicit `--apply` flag and is owner-run.
- **Bundled sources:** edit the `finflow-api-wiring-*.js` sources, never `finflow-bundle.js`, then run `node bundle.js`. `index.html` and `app-main.js` ship directly.
- **Never paste, log, or commit a secret.** If you see one, flag it and stop.
- **No guessing:** if something is ambiguous, write the question into the item's row and move to the next item.
- **Scope:** tax estimates only. No filing or VAT/GST engine.

## Workstream 0 — sanity checks (do first)

- **0a.** The owner's sweep printed `(0.0s)` for every one of 576 harnesses. Find out why in `tests/harness/run-verification-sweep.js`. Either the timer display is broken (fix the display) or harnesses aren't actually executing (that's 🔴: fix it and say so loudly). Prove it either way by deliberately breaking one harness and showing the sweep reports it RED.
- **0b.** Confirm `git status` is clean apart from `COWORK_TEST_REPORT.md` and `cowork-test-shots/`. Find the uncommitted LC3c draft `personal-history.js` if it exists anywhere; otherwise start LC3c fresh from the design in `AUDIT_MASTER.md`.

## Workstream A — code (build, RED→GREEN, in this order)

- **A1. LR11:** Banking "+ Add" is a stub that only shows a toast. Build real manual bank-line entry:
  - It must be per-entity and audited.
  - It must have a duplicate-submit guard (`withSubmitGuard`, Rule 9).
  - It must have personal/business separation (see M56/M60).
  - Check whether any GL posting is needed.
- **A2. LC3c:** a separate personal history, per the owner decision and design in `AUDIT_MASTER.md`. Close the 17 routes the guard `verify-fix3b-audit-route-guard` lists as the known gap. Personal must never land on the business trail. At the end the guard should report a known gap of 0.
- **A3. Minor LR rows:** LR8 and LR12–LR21, excluding the decision rows LR5, LR6, LR9 and LR10.
  - First enumerate each one's class: search the codebase for every other instance of the same bug pattern, not just the reported spot.
  - Then fix them, one commit per row or per class.
  - If a row turns out to need an owner call, move it to Workstream D.
- **A4. `VERIFICATION.md`:** stamp the 19 empty Result cells (A7.5–A7.8, A7.18, A8a, A8b). Each cell needs executed evidence on seeded data, never a narrative. A cell that fails becomes a code item here.
- **A5. Infra code-side (§2):**
  - Confirm the Sentry wiring works when `SENTRY_DSN` is set and is a clean no-op when it is unset; add a harness. If `@sentry/node` isn't in `package.json`, add it and justify the change.
  - Confirm `scripts/restore-drill.sh` actually runs end-to-end against a scratch Postgres.
  - Confirm `ALLOW_INDEXING` behaviour (robots.txt plus the `X-Robots-Tag` header) with a harness.
  - Confirm the `finflow_app` least-privilege role with `SKIP_INIT_DDL=1` boots and serves (`verify-db-app-role`, `verify-migrate-entrypoint`). Fix anything stale.
- **A6. Test-data cleanup tooling (§1.6):**
  - Write `tools/launch/list-test-data.js`, read-only. It lists every ZZ-QA, `AUDIT TEST`, `ZZ-LIVECHECK` and Cowork record with its id, plus the QA Tester and Claude TestCPA accountant links, the Nov 2026 Cowork payroll run, and the FreshBooks integration request.
  - Write a matching `tools/launch/purge-test-data.js` that is dry-run by default and only deletes with `--apply`.
  - The purge must reverse GL entries properly (void/delete paths, not raw deletes) so the books stay balanced.
  - Write a harness that seeds those records, runs the purge, and asserts the books still tie out and no real rows were touched.
- **A7. LC1c tooling (§3.4):** make sure `tools/fix-2026-10-19/fix1-unlinked-time-entries.js` is read-only and works. Prepare, but don't run, the exact-name link script behind `--apply`.

## Workstream B — owner-action pack

Write `OWNER_ACTIONS_2026-10-21.md`. For each item give the click-by-click steps, the exact env var names, and a verification command or check that proves it worked. Never include secret values.

1. **Rotate the DB password (§1.1, the hard blocker).** Steps: Supabase reset → update Railway `DATABASE_URL` (no trailing newline) → redeploy. How to recognise a bad paste: 28P01 + ECIRCUITBREAKER + "Session Store non-fatal" together mean bad credentials. How to verify login works afterwards.
2. **Sweep ×2 more on `9682467` (§0.1).** Include the log-capture command.
3. **Schema confirm (§0.3).** The exact Railway log lines to look for.
4. **Live re-check of LR1/2/3/4/7.** A step list for the deployed app, using a test entity only.
5. **Resend (§1.2):** add the domain, the DNS records (SPF/DKIM), then `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`. Test by sending a reset email to a non-owner address.
6. **Stripe (§1.3, §1.4):**
   - Change Business to $249 and create Scale at $400.
   - Set `STRIPE_PRICE_PRO`/`_BUSINESS`/`_SCALE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_REDIRECT_URI`, and the live webhook endpoint URL.
   - Do one real paid upgrade.
7. **Core env (§1.5):** `SESSION_SECRET`, `APP_URL`, `CONNECTOR_ENC_KEY`, `ANTHROPIC_API_KEY`. Include a one-line generator for a strong secret.
8. **Test data (§1.6):** run `list-test-data.js`, review the output, then either run `purge-test-data.js --apply` or move to a fresh DB. Include the steps for both paths.
9. **Restore drill (§1.7):** the exact command against a non-prod target.
10. **Monitoring (§2.1, §2.2, §2.8):** uptime monitor on `/healthz`, `SENTRY_DSN`, `SECURITY_ALERT_EMAIL`, `LOG_REQUESTS`.
11. **Least-privilege role switch (§2.3):** reference `INFRA_RUNBOOK.md` §4, with the exact Railway changes and a rollback.
12. **Cloudflare (§2.4).**
13. **Connector go-live keys (§3.1):** one table with provider, env vars, redirect URI to register, and whether provider review is needed and roughly how long it takes.
14. **Launch-moment steps (§1.8, §4):** set `ALLOW_INDEXING=1`, then verify with `curl`; the final 3× sweep; the human smoke test script; the live check.
15. **T4 and LR17:** the owner's wrong-password sign-in test, and checking whether the new-device alert email went out.

## Workstream C — docs

As each item closes, update its `LAUNCH_STATUS.md` mark with evidence, add its `AUDIT_MASTER.md` row (RED/GREEN counts), and update the `HANDOVER.md` top section. Docs go in the same commit as the fix where possible.

## Workstream D — decision briefs (write them, then STOP)

Write `DECISIONS_2026-10-21.md` with one short section per decision. Each section gives the options, the trade-offs, your recommendation, and the exact code and data change each option implies. Do not implement any of them.

- **3.1** Day-one connectors.
- **3.2** Expired-trial policy (read-only is built).
- **3.3** Reporting currency.
- **3.4** LC1c old time entries.
- **3.5** LC3d-b retention of a deleted account's security events. Flag it as a legal question.
- **3.6** LC3e-c connecting a service before any business exists.
- **3.7** LC3g-b named admin accounts.
- **LR5** Owner "This is me" flag.
- **LR6** Reports period wording.
- **LR9** Edit/convert quotes.
- **LR10** Edit time entries.
- **2.6** Legal review of terms/privacy/security: list what a lawyer must check for a product holding bank data.

## Finish

Run the full sweep once on your final working tree and report the count.

Then give the owner:
1. A table: item → status (DONE / OWNER / DECISION / BLOCKED + reason) → evidence → commit command.
2. The PowerShell commit commands, in order, one per item.
3. Anything you could not prove, labelled UNEXECUTED with the reason.

Do not claim anything is done without a failing run behind it.
