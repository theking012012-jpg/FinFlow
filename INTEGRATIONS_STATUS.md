# INTEGRATIONS_STATUS — environment truth (Track A / A0)

**Captured 2026-08-30** against production (`finflow-production-dab2.up.railway.app`) by querying each
connector's own status route while signed in. This is the A0 gate: it records what is actually
configured on the server *right now* so the rest of Track A is built against reality, not assumption.

**Headline (answers decision A-1): SANDBOX / TEST mode.** Four connectors are live-configured
(Plaid, Finch, Stripe, WiPay); the rest are key-pending. There *is* real sandbox data to surface —
so A1 (hub) and A2 (sync) are worth having on now; they degrade honestly for the unconfigured ones.

## Per-connector state (live)

| Connector | Configured | Env | Connected | Detail (live) | Owning surface | `/sync` (live result) |
|-----------|-----------|-----|-----------|---------------|----------------|-----------------------|
| **Plaid** | yes | **sandbox** | yes | 1 item — "First Platypus Bank", linked 2026-08-16 | Banking / Bank Rec (`personal_transactions` `source:banking`) | ✅ `added: 6` transactions |
| **Finch** | yes | **sandbox** (provider `ecca`) | yes | 0 employees | Payroll (display-only) | ⚠️ 502 — "No finch accountant setup… reauthenticate" (sandbox re-auth limitation, surfaced honestly) |
| **Stripe** | yes | connected | yes | account `acct_1U4ul2…` | Payments / Banking (display) | ✅ balance `available` $1,941.70 |
| **WiPay** | yes | connected | yes | account `1234567890`, country TT | Payments | n/a — callback/webhook based, no `/sync` |
| **Codat** | no | — | no | not configured | Books (owner-gated import) | n/a — 502 `CODAT_NOT_CONFIGURED` |
| **Belvo** | no | — | no | not configured | Banking (LatAm) | n/a — 502 `BELVO_NOT_CONFIGURED` |
| **Wise** | no | — | no | not connected | Payments | n/a |

Notes:
- `/api/connections` returns `{}` (the generic registry is empty; per-connector status routes are the source of truth).
- `/api/plaid/status` is 404 — the real route is `/api/plaid/items` (used by the hub already).

## What this means for Track A

- **A1 — hub:** already built and reachable (`page-connections`, nav "API connections"). It hydrates
  real per-connector state from the status routes above, shows a live-connection count, splits
  "Available now" vs "Coming soon", and wires real connect/disconnect. **Done.**
- **A2 — Sync now:** *was* the gap — the pull pipeline (`/sync`) existed but nothing invoked it. Now a
  "Sync now" button on each connected aggregator card calls its `/sync` route, reports the count the
  server returns, and refreshes the owning surface. Display/feed only — never writes to the books.
- **A3 — Codat books-import:** already built (`ffCodatMigrate`): preview (`/api/codat/import-preview`)
  → review table (per-dataset new / duplicate / locked / skipped, mixed-currency warning) → owner
  confirms → `/api/codat/import`. Idempotent; nothing writes without the explicit confirm. **Done.**
  (Currently shows the honest "not set up / connect first" states because Codat is key-pending.)

## To make it fully live (owner action — outside code)

To move from sandbox to real data, set production keys on the Railway server env:
- **Plaid**: switch `PLAID_ENV` to `development`/`production` + prod `PLAID_CLIENT_ID` / `PLAID_SECRET`.
- **Finch**: production Finch keys (and complete provider auth so the directory/`/sync` succeeds).
- **Codat / Belvo / Wise**: add `CODAT_API_KEY` / Belvo / Wise keys to light those up.
- **Stripe / WiPay**: already connected — confirm they're the intended (live vs test) accounts.

## Still-open decisions (from the plan)
- **A-2** — sync cadence: shipped as a **manual "Sync now" button** (lean; matches single-writer ethos).
  An hourly auto-sync job remains a later, separate opt-in.
- **A-3** — Finch: kept **display-only** (lean); no owner-gated payroll-books import built. Codat remains
  the one books-import path.
- **A4 (F192)** — entity-country → Plaid/Belvo/manual routing + CSV/OFX fallback: still blocked on the
  pre-existing owner decision; not built here.
