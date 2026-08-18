# Session handover — 2026-08-18

## Shipped & committed this session
- **Plaid live leg CLOSED** (F164). Live sandbox handshake on **dab2**: Link → **48** txns synced into the canonical books → idempotent re-sync (`added:0`). Ledger ticked. Commit **`dfd2fc3`**. Evidence in `AUDIT_MASTER.md#F164` + `VERIFICATION_INTEGRATIONS.md` ("LIVE-VERIFIED — Plaid").
- **Codat → FinFlow MIGRATION importer BUILT + VERIFIED** (F187, commit **`03c5633`**). Full-ledger, full-history, **owner-gated preview→import**, single-writer, idempotent on a deterministic Codat key, AR/AP tie-out. Harness `tests/harness/verify-codat-import.js` = **28/0 green (owner-run)**. Routes: `POST /api/codat/import-preview` + `POST /api/codat/import` (`books:write`). Client: `window.ffCodatMigrate` + "⇩ Import books" button on the connected Codat card (`public/index.html`).
- **`_codatAuth` hardening** — accept a pre-encoded `Basic …` Authorization header verbatim (no double-encode); raw-key fallback kept. Committed with this handover (verify `git log`).

## Non-issue resolved (no action)
- Console `wss://…dab2…/ws/ws` 404 = the **Live Server browser extension** injecting `reload.js` (DevTools → Content scripts → "Live Server Web Extension"). NOT a FinFlow bug — app opens/serves no WebSocket. Silence it by restricting that extension to localhost.

## BLOCKED — resume here
1. **Live Codat verification (F187 last mile).** BLOCKED: Codat signup is **sales-gated** — the "get started" form returns "Thanks for contacting us! We will get in touch shortly." No instant sandbox key. **WHEN access arrives:**
   - Codat Portal → **Developers → API keys** → copy the **Authorization header** value (`Basic …`).
   - Railway (**dab2**): add `CODAT_API_KEY` = that value → redeploy.
   - App console (logged in): `fetch('/api/codat/status',{credentials:'include'}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d)))` → expect `configured:true`.
   - **API connections → Codat → Connect** → hosted Codat Link → choose **Codat Sandbox** (no credentials).
   - Codat card → **⇩ Import books** → preview modal → **Import**.
   - Verify with EVIDENCE (not toast): `/api/codat/status` connected; preview counts; import `total_added`; actual rows + AR/AP movement in the books. Codat fetches data async — if a preview dataset shows an error or 0, wait ~30s and retry.
   - `_codatAuth` already accepts the pre-encoded header, so pasting the portal's Authorization header "just works."
2. **Cloud self-verification setup (optional infra, owner offered to do).** To let Claude run harnesses itself inside the cloud container: `git clone` the repo + fresh `npm install` (fetches the **Linux** embedded-postgres binary — the on-disk win32 `node_modules` can't run in the Linux container). Needs git auth (PAT / `gh`). Then `node -r ./tests/harness/clock.js tests/harness/verify-*.js` runs in-session before any commit.

## Vendor note — Codat cost (owner asked)
Free tier for dev/sandbox; **paid + sales-quoted at scale** (no public pricing), and some platforms (e.g. Xero) charge developers per connected org on top. The importer core is **provider-agnostic** (Codat = just the fetch adapter → mappers → single-writer). Can later swap to Merge.dev/Rutter, go direct to QuickBooks/Xero APIs, or add a **$0 file-upload import** reusing the same engine (mirrors the existing OFX/CSV bank importer).

## Connector scoreboard
- **LIVE:** Stripe, WiPay, Plaid.
- **🔶 pending keys:** Belvo (LatAm banking), Finch (payroll), Codat (accounting — built, live pending sales-gated key), Paystack, Flutterwave, Mercado Pago, dLocal, Wise.

## Workflow reminders (unchanged)
HOLD before every commit — owner commits in PowerShell. Edit wiring sources (`index.html`, `server.js`, `finflow-api-wiring-*.js`), **never** `finflow-bundle.js` (F13 hook regenerates it). Live app = **finflow-production-dab2** (dab1 dead). `.fuse_hidden*` + working-tree `finflow-bundle.js` drift = OneDrive noise, leave unstaged.
