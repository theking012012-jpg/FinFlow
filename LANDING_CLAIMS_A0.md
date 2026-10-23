# A0 — Landing page claims (`public/landing.html` on `main`, checked 2026-10-23)

Ledger: **FA-L** (and LR28). Every claim on the page, checked against the code on `main` (read only — nothing on the
page has been changed). Production still runs `9682467`; the page there is the same text.

The copy is the owner's decision. Each row gives the evidence and a proposed truthful version. Approve per row or as a
set ("apply A0 as proposed"), and the page is changed in one commit with a harness that fails if a removed claim
comes back.

Status key: ❌ false / fabricated · ⚠️ unprovable or misleading · ✅ true (kept).

## 1. Fabricated social proof — remove (legal exposure: FTC fake-reviews rule, UK DMCC Act 2024)

| Line | Claim | Evidence | Proposed |
|---|---|---|---|
| 278–285 | "Trusted by teams at" TechCorp, Globex LLC, Initech Group, NovaTech, Pinnacle Co, Summit Inc | Invented names; no customers before launch | **Remove the strip.** Replace with a factual row: "Multi-currency · ~50 currencies · Separate books per business · Bank sync via Plaid · Powered by Claude" |
| 411–427 | Testimonials: Sarah Chen (CFO, TechNova), Marcus Reid (FinScale Group), Priya Nair (Orbit Labs), all ★★★★★ | Invented people, invented quotes | **Remove the section.** Add real quotes only from real, consenting customers after they exist |
| 527 | "Join hundreds of businesses already running smarter with FinFlow." | Pre-launch | "Start running your books with FinFlow today." |
| 365 | "9.4 — Overall rating vs competitors" | No source; no rating exists | **Remove** |
| 366 | "37% — Cheaper than QuickBooks Advanced" | No source; compares Business $249 with an unstated QBO price | **Remove** (or state both prices with a dated source) |
| 367 | "14s — Avg time to scan & log a receipt" | Never measured; logging needs the user's "+ Add to expenses" click (`index.html` M4 note) | **Remove** |
| 368 | "750+ App integrations available" | The app has ~17 live connections | **Remove**, or "17 connections" once the count is checked at publish time |
| 426 | Testimonial "in my books in 14 seconds" | Same as 367 | (removed with the section) |

## 2. Claims the app contradicts — rewrite

| Line | Claim | Evidence | Proposed |
|---|---|---|---|
| 233 | "the **only** accounting platform with a real AI that knows your books" | QuickBooks (Intuit Assist) and Xero (JAX) both ship AI over the user's books | "An accounting platform with an AI assistant that reads your own books — ask about your numbers in plain English." |
| 293 | "your expenses feed your **tax filing**" | No filing, by design (product fact: estimates only) | "your expenses feed your tax **estimate**" |
| 293 | "your payroll feeds your personal finance" | True, and only the owner's salary crosses (the wall) | "your salary from a paid payroll run lands in your personal finances — and nothing else crosses" |
| 298 | "Transactions auto-categorise and flow into your P&L in real time. No CSV imports. No manual reconciliation." | Bank lines are matched / booked by the user; CSV import exists and is needed; reconciliation is a feature (B7b) | "Bank lines arrive automatically, with suggested categories and matches; you confirm, and reconcile against your statement in a few clicks. CSV import when you need it." |
| 298 | "Connect 12,000+ banks via Plaid" | Plaid's own figure; coverage differs by country (product fact) | "Connect your bank via Plaid where it is available (US, Canada, UK and Europe)" — owner to confirm the region list |
| 304 | Scanner "extracts vendor, amount, date and **tax status** … then **logs it automatically**" | Extracts vendor, amount, date, `tax_deductible` (`server.js:/api/ai/scan`); saving needs the user's click | "…extracts vendor, amount, date and whether it looks tax-deductible — you check it and add it in one click." |
| 316 | MRR "with new, churned, and expansion revenue. Track churn, LTV:CAC and ARR" | New / Churned / Expansion show "—" (no cohort history kept, `index.html:6468`); LTV:CAC does not exist anywhere | "MRR and active subscriptions from your Stripe data, without a separate BI tool." (or build churn / expansion / LTV:CAC first — owner) |
| 322 | "Owner, Admin, Accountant and Viewer tiers … **7-year** audit trail" | Roles: owner + admin / accountant / viewer ✅. Audit trail is append-only (DB trigger `audit_trail_no_mutate`) with no deletion — but no stated retention policy | "Owner, Admin, Accountant and Viewer roles. An audit trail that cannot be edited or deleted." (a "7-year" figure needs a written retention policy — owner) |
| 328–329 | "flags when you're drifting" / "**AI** variance alerts" | Budget vs actual is computed; no alert and no AI on variance found | "See budget vs actual for every category as you go." Tag: "Budget vs actual" |
| 342–355 | AI demo chat with invented numbers ($469K ARR, 14-month runway, March $28,400…) | Illustrative | Keep, labelled "Example conversation" |
| 246–269 | Hero dashboard mock ($469K, 50.7% margin, "app.finflow.io") | Illustrative; the domain in the server is `finflow.app` (`server.js:1347`), the page uses `finflow.io` (meta tags, mailto, mock URL bar) | Label "Example data". **Owner: which domain is real — finflow.io or finflow.app?** Every mailto (`hello@finflow.io`) must reach a real inbox |

## 3. Pricing table — must match what the code sells

| Line | Claim | Evidence (code) | Proposed |
|---|---|---|---|
| 440–447, 586–607 | Monthly / **Annual "Save 20%"** toggle ($63 / $199 / $320) | Checkout uses ONE price per plan (`STRIPE_PRICE_PRO / _BUSINESS / _SCALE`, `server.js:1087`) — an annual price cannot be bought | Remove the toggle, or add `STRIPE_PRICE_*_ANNUAL` and wire Checkout (owner: offer annual?) |
| 458 / 478 | "Up to 3 team members" (Pro) / "Up to 15" (Business) | No member limit is enforced anywhere (`/api/team/invite` has no count) | Enforce the limits at the invite (one server check), or drop the numbers — owner |
| 462 | Pro "50 AI queries / month" | Code cap: **500** shared + 15 scans (`ai-cap.js:19`) | State the code's numbers, or change the cap — owner (they must agree) |
| 466 / 483 | Business "**Unlimited** Claude AI queries" | Code cap: **2,000** shared + 50 scans (`ai-cap.js:20`) | "2,000 AI questions + 50 receipt scans a month" |
| 498 | Scale "5,000 AI queries / month" | ✅ 5,000 shared (+100 scans) | Add "+ 100 receipt scans" |
| 457 / 477 / 495 | 1 / 5 / 10 entities | ✅ `ENTITY_LIMITS = { trial: 1, pro: 1, business: 5, scale: 10 }` (`server.js:1828`) | Keep |
| 467 | Pro excludes "RBAC & audit trail" | The audit trail is written for every plan | "— Team roles" only (owner: gate roles by plan?) |
| 485 | "AI-generated board reports" | No board-report feature; only a free-form AI chat | Remove, or "Ask the AI for a board summary" |
| 486 / 499–500 / 511 | Priority email support, onboarding assistance, dedicated account manager | Service promises — owner's to make | Owner |
| 504–516 | **Enterprise**: unlimited entities & users, white-label, custom AI prompts, SSO / SAML, 99.9% SLA, on-premise, custom API | No `enterprise` plan exists in code (`admin-routes.js:440`: trial / pro / business / scale); none of these features are built | Replace the card with "Need more than 10 businesses? Talk to us." (mailto) — no feature list |
| 235 / 438 / 532 | 30-day free trial, no credit card | ✅ `trial_ends = now + 30 days` at sign-up (`server.js:1150`); no card collected | Keep |

## 4. Comparison table (L7) — lines 375–403

Competitor prices (QuickBooks $275, Xero $25–$90, FreshBooks $60) and ✗ marks are unsourced and go stale; "Design
quality ★" ratings are opinion presented as fact. **Proposed:** remove the competitor columns; keep a "What you get"
list of FinFlow's own verified features. If a comparison stays, each cell needs a dated, linked source (the owner
confirms them at publish time). Footer links "vs QuickBooks / vs Xero / vs FreshBooks / **vs Wave**" all point at
`#compare` (Wave is not even in the table) — remove with the table.

## 5. Other

- Footer "Integrations" → `#compare` (no integrations section) — point at a real list or remove.
- Footer "© 2026 FinFlow Inc." — owner to confirm the legal entity name (also used in Terms / Privacy).
- `/accountant-register` (`accountant-register.html:724`): accountants "agree to the … **Professional Conduct
  Policy**", linked to `/terms.html#6` (L8). Terms has no element ids at all, and **no conduct policy exists anywhere**
  — section 6 is "Free trial and subscriptions". Re-anchoring would point at the wrong text. Owner / lawyer: write the
  policy (then the link gets its anchor), or drop the phrase until it exists.

## Decisions needed from the owner (everything else is ready to apply)

1. Apply sections 1, 2 and 4 as proposed? (removals and truthful rewrites)
2. Domain: finflow.io or finflow.app — and does hello@ reach an inbox?
3. Annual billing: offer it (needs annual Stripe prices) or remove the toggle?
4. Team member limits: enforce 3 / 15, or drop the numbers?
5. AI quotas: the page's numbers or the code's (50 vs 500 on Pro; "Unlimited" vs 2,000 on Business)?
6. Enterprise card: replace with "talk to us"?
7. Support promises (priority / onboarding / account manager), "7-year" retention, legal entity name.
