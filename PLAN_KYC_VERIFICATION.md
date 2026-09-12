# FinFlow — Accountant KYC / Registry Verification (spec, owner decision required)

**Status:** ✅ DECIDED — **Stripe Identity** (reuses existing Stripe wiring, ~US$1.50/verification).
**Phase B BUILT 2026-09-12** (`verify-accountant-kyc` 14/0). Sequenced after the shipped "mandatory proof" gate.
**Remaining:** (ops) enable Stripe Identity in the Stripe dashboard — no new key, uses `STRIPE_SECRET_KEY`;
(code) Phase C structured registry-portal workflow (one-click "verify member" links per body + record outcome).
**Date:** 2026-09-10

---

## 1. Where we are now (shipped)

- **Mandatory proof at registration** (`POST /api/accountants/register`, accountant-routes.js):
  an applicant must supply **≥1 of** {valid credential document, professional membership/registration
  number} or the submission is rejected 400. A verification *method* alone (a radio choice) is no
  longer accepted as proof.
- **Admin review surface** (admin.html + admin-routes.js): the detail modal renders the declared
  `verification_data` (prof body + membership number, employer, institution), `credentials`,
  `memberships`, and lists uploaded credential documents with working download links
  (`/api/admin/accountants/:id/documents/:docId/download`). Admin approve/reject/suspend records
  `confirmed_credentials`; `status` gates listing (`pending` → `verified`).

This is **human-verified proof**. KYC adds **automated / third-party** verification on top.

## 2. What KYC/registry adds — two distinct checks

1. **Identity (IDV):** prove the person is who they claim (government ID + liveness/selfie).
2. **Professional standing (registry):** prove the person actually holds the credential /
   membership they claim, against the issuing body.

These are separate problems with separate vendors. Identity has mature API vendors; professional
registries mostly do **not** expose per-body verification APIs.

## 3. Provider options

**Identity (IDV) — mature APIs, hosted flows, webhooks:**
| Provider | Notes | Rough cost |
|---|---|---|
| **Stripe Identity** | **Lowest friction — Stripe is already integrated** (keys, webhook infra, dashboard). Hosted IDV session, webhook result. | ~US$1.50 / verification |
| Persona | Very flexible flows, good for KYB too | tiered, ~$1–2 |
| Onfido / Veriff / Sumsub | Full KYC/AML suites, global doc coverage | tiered, higher |

**Professional registry — no universal API:**
- Bodies (ACCA, ICAEW, AICPA/CPA, ICATT, etc.) generally offer only **public "verify a member"
  web portals**, not APIs. Realistic options: (a) admin manually checks the portal using the captured
  membership number (cheap, already possible today); (b) a background-check vendor that offers
  professional-license verification as a service (higher cost, US-centric); (c) per-body scraping
  (fragile, ToS risk — not recommended).

## 4. Recommended phased approach

- **Phase A — DONE:** mandatory proof + admin manual review.
- **Phase B — Identity via Stripe Identity** (recommended first build): hosted IDV session created at
  or after registration; async webhook writes the result; admin sees `verified/failed` alongside the
  proof before approving. Reuses existing Stripe wiring.
- **Phase C — Structured registry workflow:** capture membership number as a first-class field (done),
  give admin a one-click "open the body's verify portal with this number" link per professional body,
  and record the manual verification outcome. Defer any true per-body API.

## 5. Data model (Rule 8 — additive, no migration)

Reuse `accountants.verification_data` JSONB; add status columns:
- `kyc_status` VARCHAR — `not_started | pending | verified | failed`
- `kyc_provider` VARCHAR — e.g. `stripe_identity`
- `kyc_ref` VARCHAR — provider session/verification id
- `kyc_checked_at` TIMESTAMPTZ
Store **only** provider refs + status. **Never** store raw ID images/PII in FinFlow — rely on the
provider's vault (compliance + breach surface).

## 6. Integration surface (Phase B)

- `POST /api/accountants/kyc/session` → create a hosted IDV session, return the client URL.
- `POST /api/webhooks/identity` → provider webhook; verify signature; update `kyc_*`; append admin_log.
- Admin surface: show `kyc_status` + provider result next to existing proof; approval can require
  `kyc_status = verified` (owner toggle).
- Keys (Railway env): provider secret key + webhook signing secret + return URL. Degrade honestly to
  "KYC not configured" until set (same pattern as the OAuth connectors).

## 7. Open decisions for the owner (blocking a build)

1. **IDV provider** — recommend **Stripe Identity** (already integrated). Confirm or pick another.
2. **Mandatory or optional?** Is IDV required to be listed, or optional for a "verified" badge?
3. **Budget** — per-verification cost is a real recurring expense; confirm the ceiling.
4. **Registry depth** — manual admin verify (Phase C) only, or invest in a license-verification vendor?
5. **Priority bodies/regions** — which professional bodies matter first?
6. **Timing** — build Phase B pre-launch, or launch on mandatory-proof + manual review and add KYC after?

## 8. Testing (when built)

RED-proven harnesses for: session creation, webhook signature rejection, each `kyc_status` transition,
and the approval-gate (approve blocked while `kyc_status != verified` when the owner toggle is on).
No stubbed money/PII paths; provider calls mocked at the HTTP boundary only.
