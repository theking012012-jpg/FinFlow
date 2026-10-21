# FinFlow — decisions waiting on the owner (2026-10-21)

> **Owner answer 2026-10-21: "go with your recommendations."** Built and verified the same day (each RED → GREEN; rows in
> `AUDIT_MASTER.md`): **LR6 A · LR8 A · LR9 A · LR10 A · LR22 A · LR23 A · LR25 A · LR1 follow-up B · 3.3 B · 3.6 A**.
> Taken with no code: **LR5 A · 3.1 B** (connectors stay dark until keyed) **· 3.2 A** (read-only, already built) **· 3.7 A**.
> **Still open:** **3.4** (a data step — run the prepared LC1c link script, owner-run, Rule 8), **3.5** (legal answer —
> retention), **2.6** (lawyer review of the rewritten pages).

One section per decision. Each: the options, the trade-offs, a recommendation, and **exactly** what code and data each
option changes. **Nothing here is implemented** — reply with the option letter per item (e.g. "3.2 A, LR9 B") and it
is built RED → GREEN as its own commit. Data changes are always a separate, owner-run step (Rule 8).

---

## 3.1 Which integrations are live on day one

| Option | Day-one set | Trade-off |
|---|---|---|
| **A** | Stripe (billing) + statement import (any bank, OFX/QFX/CSV) only | Zero provider reviews blocking launch; no live bank feeds. |
| **B** | A + Plaid (US/CA/UK/EU banks) | Live feeds for the biggest markets; Plaid production review (days–2 weeks) + it asks for the legal pages (2.6). |
| **C** | B + Belvo (LatAm) + QuickBooks / Xero import | Broadest; three more reviews, each weeks; more support surface at launch. |

**Recommend B**, the rest labelled "coming soon". Code per option: **none** — every connector is already dark until
keyed (clean "not set up"). Optional small code change for A/B: hide the un-keyed connectors' cards instead of showing
"not set up" — one list in the Connections page render, harnessed. Data: none. Keys: `OWNER_ACTIONS_2026-10-21.md` §13.

---

## 3.2 Expired trial policy (read-only is built and verified — F132, `f130-trial-expired-paywall`)

| Option | Behaviour | Trade-off |
|---|---|---|
| **A — read-only (current)** | Can sign in, see and export everything; every write refused with an upgrade prompt. | Kindest; nobody's books are held hostage; no conversion pressure beyond the prompt. |
| **B — grace period then read-only** | N days (e.g. 7) of full access after expiry, banner counting down, then A. | Smoother for late payers; one new date rule (`trial_ends_at + N`) in the paywall check. |
| **C — hard lock** | Only the billing page until paid; export still allowed. | Strongest pressure; risks "you locked my books" complaints — accounting data is legally the customer's. |

**Recommend A** (already built and verified — zero new code). B = one condition in the trial check
(`server.js` paywall middleware) + the banner + a harness at day N−1 / N / N+1. C = route allow-list change + harness.
Data: none for any option.

---

## 3.3 Reporting currency for "All entities"

LA21 added the Settings field; until chosen, "All entities" consolidates in the **oldest business's** currency.

| Option | Behaviour | Trade-off |
|---|---|---|
| **A — keep the default** | Oldest business's currency until the person picks one. | No prompt; surprising if the oldest business is a small side entity. |
| **B — ask once** | First time "All entities" is opened with ≥2 currencies, a one-question picker; saved to the same setting. | Explicit; one extra click once. |
| **C — USD always unless set** | Code default `USD`. | Predictable for USD users; wrong-feeling for everyone else (USD is the code default, not a home market). |

**Recommend B.** Code: a modal on the "All entities" view when `reporting_currency` is unset and the businesses' currencies
differ; harness for set / unset / single-currency (no prompt). Data: none (each account keeps whatever it has set).
**Your own account:** pick it now in Settings either way.

---

## 3.4 LC1c — old time entries with no project

Entries logged before FIX-1 count on no project. Tool (read-only, A7 of this pack):
`node tools/fix-2026-10-19/fix1-unlinked-time-entries.js` against production lists each unlinked entry and whether its
free-text project name matches exactly ONE project in the same business.

| Option | Data change | Trade-off |
|---|---|---|
| **A — link exact-name matches** | `node tools/fix-2026-10-19/fix1-link-exact-matches.js --apply` sets `project_id` only where the name matches exactly one project of the same business; everything else untouched. Its own commit + run (Rule 8). | Old hours appear on their projects; ambiguous / no-match entries stay unlinked (listed). |
| **B — leave them** | none | Old hours count on no project; the Projects page under-reports history. |

**Recommend A** after reviewing the dry-run list. Code: none further (the link script is prepared behind `--apply`).

---

## 3.5 LC3d-b — how long a deleted account's security events are kept ⚖ LEGAL QUESTION

Today `audit_trail` outlives a deleted account (N18 — the business's legal record), and since LC3d it holds sign-in IPs
and device names. (Personal history — LC3c — is erased with the account.)

| Option | Behaviour | Trade-off |
|---|---|---|
| **A — keep all (current)** | Security events kept with the books' audit trail indefinitely. | Simplest; IP + device are personal data under GDPR / similar laws — "indefinitely" is hard to justify. |
| **B — keep, but strip personal fields after N** | At deletion (or N days after), null `ip_address` / `user_agent` on that account's SECURITY actions; keep the event and time. | Keeps the legal record, drops the personal data. Needs an exception to the append-only trigger for exactly those columns, or a pseudonymised copy. |
| **C — delete security events after N** | Delete that account's SECURITY rows N days after deletion. | Cleanest privacy; loses evidence for disputes inside N. |

**Recommend B with N = 90 days**, *subject to a lawyer's answer* for the jurisdictions you sell into. Code for B: a
scheduled job + a narrowly-scoped trigger exception (UPDATE allowed only for those two columns on SECURITY actions of a
deleted user), harnessed; the privacy page states the retention. Data: applies to accounts deleted after it ships.
**Question for the lawyer:** "Accounting SaaS; after account deletion we keep the audit trail of financial changes. How
long may/must we keep sign-in IP addresses and device names tied to that deleted account?"

---

## 3.6 LC3e-c — a business service connected before any business exists

An account with no business can connect e.g. QuickBooks; the connection is stored with no business and is recorded
nowhere (the business trail needs a business; LC3c personal history is for personal things only — a QuickBooks
connection isn't personal).

| Option | Behaviour | Trade-off |
|---|---|---|
| **A — require a business first** | Business connectors refuse with "Create your business first". Personal bank linking unaffected. | Simple, nothing unattributed; one extra onboarding step. |
| **B — record account-level** | An account-level entry ("no business yet") on the audit trail, moved under the first business when created. | No friction; a new "account-level" concept on the Audit page. |

**Recommend A.** Code: one guard in the connect-url / callback routes for business connectors when the account has no
business (the `_bankScopeRefused` shape), harnessed. Data: list (read-only) any existing no-business connections; you
decide whether to disconnect them.

---

## 3.7 LC3g-b — named admin accounts

One shared admin login today; `admin_log` tells sessions apart, not people.

| Option | Trade-off |
|---|---|
| **A — keep one admin (you only)** | Fine while nobody else has admin. No code. |
| **B — named admin users** | Each admin a real user with `role: admin`, own password + 2FA; `admin_log` records the person. Needed the day anyone else gets admin. |

**Recommend A now, B before anyone else gets admin.** Code for B: admin role on `users`, admin sign-in through the normal
auth (2FA required), retire `ADMIN_PASSWORD` / `ADMIN_TOTP_SECRET`, harness. Data: create your named admin user.

---

## LR5 — the owner card has no "This is me" flag (A4)

Payroll → the owner's card opens `openOwnerModal()` (no checkbox); LA3 put "This is me — the business owner" on Add / Edit
employee.

| Option | Change |
|---|---|
| **A — the expectation was wrong** | The owner card IS the owner (it exists only for the flagged person). No code; update A4 in the live-check script. |
| **B — show the flag on the owner card too** | Add the checkbox to `openOwnerModal` (unticking it demotes the person to an employee). Code + harness. |

**Recommend A** — a checkbox whose only effect is to stop being the owner is confusing there; demotion stays on Edit employee.

---

## LR6 — Reports period wording

Reports reads "Year to date · Jan 2026 – Oct 2026"; the Year button's tooltip says "Fiscal year to date".

| Option | Change |
|---|---|
| **A** | Keep "Year to date" (the LC2 decision); change the tooltip to match. |
| **B** | "Fiscal year to date · Jan 2026 – today" everywhere (Dashboard, Reports, tooltip). |

**Recommend A** — it matches the decision already shipped and the Dashboard. Code: one tooltip string (+ the label
harness). For a non-January fiscal year the range already shows the fiscal months, so "fiscal" adds nothing.

---

## LR8 — Budget audit row records the annual figure

| Option | Change |
|---|---|
| **A** | Keep (truthful: the stored figure is annual); the Audit line says "per year". |
| **B** | Also record what was typed: "25 / month → 300 / year". |

**Recommend A** — one label on the Audit page render for `budget_targets` rows, harnessed.

---

## LR9 — quotes cannot be edited or converted

`PUT /api/quotes/:id` exists, no UI calls it; no "Convert to invoice".

| Option | Change |
|---|---|
| **A — build Edit + Convert** | Edit = the existing quote form prefilled → `PUT /api/quotes/:id` (audited). Convert = creates a draft invoice from the quote's lines via the normal invoice POST (idempotency token = `quote-<id>`, so a double click makes one invoice), marks the quote "converted" with the invoice id. |
| **B — Edit only** | Edit as A; no convert. |
| **C — drop the expectation** | Quotes are write-once; delete and re-create. |

**Recommend A** — convert-to-invoice is the main reason quotes exist. Code: client form + one server convert route,
RED → GREEN harness (edit persists; convert makes exactly one invoice with the quote's total; converted quote can't
convert twice). Data: none.

---

## LR10 — time entries cannot be edited

| Option | Change |
|---|---|
| **A — build Edit** | Prefilled form → existing `PUT /api/timesheet/:id` (audited, keeps the FIX-1 project link rules). |
| **C — drop** | Delete and re-log. |

**Recommend A.** Small: client form + harness (hours change moves the project's derived hours).

---

## LR22 — remaining literal "$" (business investments empty state, Stripe "Today: $0")

| Option | Change |
|---|---|
| **A** | Label them "USD" (holdings are USD-priced, M36; Stripe reports its own currency). |
| **B** | Convert to the business's currency. |

**Recommend A** — they ARE USD figures; converting would invent an FX step. Code: two strings + LR4-style harness.

---

## LR23 — no e-mail send checks Resend's answer (root of LR17)

21 `emails.send` call sites; resend 3.5.0 returns `{ error }` instead of throwing, so a refused e-mail is recorded as sent.

| Option | Change |
|---|---|
| **A — one send helper** | `sendEmail()` reads `{ data, error }`, throws / returns failure; all 21 sites route through it; a structural guard fails if any file calls `emails.send` directly; the security log records `sent:false, reason`. |
| **B — leave** | The Resend dashboard stays the only truth. |

**Recommend A** (it is a correctness fix, not a policy choice — it needs your go only because it touches every e-mail).
Code: as described; harness with a stubbed Resend client returning `{ error }` (the SDK boundary, not a money path).

---

## LR25 — Banking "+ Add Account" is a toast-only stub (found with LR11, Rule 13)

`openAddAccountModal` (`app-main.js`) only shows "Connect or add a bank account". The Bank Accounts list is fed only by
linked banks.

| Option | Change | Trade-off |
|---|---|---|
| **A — point it at Link / Import** | The button opens a chooser: "Link a bank" (existing) or "Import a statement" (existing). | No new data model; honest. |
| **B — manual bank accounts** | New per-business `bank_accounts` rows (name, last 4, currency, opening balance). An opening balance is a GL question: it needs a journal (Dr Cash / Cr Opening balance equity) — a money path. | Real feature; needs the GL decision first. |
| **C — remove the button** | | Simplest. |

**Recommend A** now; B only with a decision on opening balances.

---

## LR1 follow-up — may a period whose run was VOIDED get a new run?

Today: one run per period (DB unique index); a voided run blocks the period (LR1 now says so clearly, 409).

| Option | Change |
|---|---|
| **A — keep** | Re-running a voided period = un-void (not built) or pick another label. |
| **B — allow** | Make the unique index partial (`WHERE status <> 'void'`) — a migration + harness; the voided run stays in history. |

**Recommend B** — voiding then re-running a period is the normal correction workflow. Schema change only; no data change.

---

## 2.6 Legal review — what a lawyer must check (product holding bank data)

Pages: `public/terms.html`, `public/privacy.html`, `public/security.html`. Ask the lawyer to confirm or fix:

1. **Who is the data controller / processor** for customers' books (FinFlow processes on the customer's behalf) and for
   the account holder's own data; a **DPA** offered to business customers.
2. **Bank data (Plaid / Belvo):** that the privacy page names the aggregators, what they collect, the end-user consent
   language Plaid requires, and how a user revokes access (unlink).
3. **Sub-processors list:** Railway (hosting), Supabase (database), Stripe (billing / Connect), Resend (e-mail),
   Anthropic (AI assistant + receipt scan — what data is sent, and that it isn't used for training), Sentry (error data),
   Cloudflare, each connector provider.
4. **Retention:** books and audit trail kept after deletion (N18) vs personal data erased (LC3c); security-event
   retention (3.5); backups' retention window.
5. **International transfers** (EU/UK users; ~53 countries supported): transfer mechanism (SCCs) and the hosting region.
6. **Breach notification** commitment and timeline; a security contact (security.txt).
7. **Tax estimates disclaimer:** FinFlow estimates income tax only; it does not file returns and has no VAT/GST engine —
   the terms must say it is not tax or accounting advice.
8. **Accountant marketplace:** FinFlow's role between client and accountant, liability for the accountant's advice,
   commission disclosure, and the client's control of accountant access.
9. **Payments:** Stripe Connect payouts / invoice payment links — FinFlow is not a money transmitter; who bears disputes.
10. **Subscription terms:** trial, expired-trial behaviour (3.2), refunds, price changes, cancellation, data export on exit.
11. **Acceptable use, limitation of liability, governing law / venue** — and that they're enforceable where you sell.
12. **Security page claims:** every statement (encryption at rest, 2FA, backups, least-privilege DB role) is true today —
    §2.3 / §1.7 are not done yet, so don't claim them until they are.
