# FinFlow — Full Fix-Pass Analysis (consolidated 2026-10-10)

Single source for the fix pass. Every defect found across the security/money audit, the money-math
audit (M1–M47), the A1–A21 whole-app sweep, and the live-prod checks, each with a **status**, the
**file:line** evidence, and a **fix direction**. Backing detail: `MONEY_AUDIT_2026-10-09.md` (M-items)
and `tools/money-audit-2026-10-09/SWEEP_A_RESULTS.md` (sweep).

Follow CLAUDE.md for every fix: one fix per commit, root fix not symptom, enumerate the class (Rule 13),
RED→GREEN on real Postgres (Rules 3/4), execute the failure path (Rule 14), re-run the full sweep after.

## Status legend
- **FIXED** — committed on `claude/keen-goodall-gr7s2j` and independently re-run green by Cowork (execution).
- **EXECUTED** — confirmed by running real code vs real Postgres; measured == predicted bug value.
- **CODE-READ** — established by reading the cited lines; not yet executed (must not be cited as verified).
- **OBSERVED (live)** — seen in the live prod UI this session; needs a harness to pin down.
- **CLEARED** — execution showed it is not a defect.

---

## 0. CORRECTION (2026-10-10): do NOT merge `claude/keen-goodall-gr7s2j`

The earlier version of this section said 23 verified fixes were "blocked" on that branch and should be merged
to `main` first. **That is wrong, verified against git:**
- The branch is an OLD line (head `e29660d`, 2026-10-06): 152 commits not on `main`, and 50 `main` commits not
  on it.
- Sampled 59 of its `server.js` fix commits: the first added line of **all 59** is already on `main`. The one
  apparent miss (`1a8cac5`, N64) is on `main` in its later, improved form (`scopeTodayYmd`, L36b). The N-markers
  match too (N45b 5/5, N57b 10/10, N99 3/3, N92 1/1; N20 11 on `main` vs 6 on the branch).
- The conflict markers in `e29660d` were already resolved on `claude/fervent-meitner-irgqhm` (`99fb6ac`).

So those fixes are **already live on `main`**. Merging the old branch would re-introduce stale code over 50 newer
`main` commits. The fix pass starts at section 1. (The fix table below is kept as a record of what the old
branch contained.)

### What that old branch contained (already on `main`)
| Area | Fix |
|---|---|
| billing | cancelled subscription becomes read-only, not unlimited (`549629f`) |
| stripe | failed webhook processing retried, not silently lost (`43ef846`) |
| stripe | partial refunds reverse only the new delta; currency-aware minor units (`f48113c`) |
| paylinks | charge in the issuing business's currency, correct minor units (`02d0230`) |
| stripe | convert every Stripe amount by its currency's exponent (`be8fe61`) |
| paylinks | charge the outstanding balance; verify WiPay against it (`40ab578`) |
| rbac | team members act on the account owner's books (locks, payments, recalcs) (`639af28`) |
| admin | suspend/delete actually remove access, incl. open sessions (`eea6b56`) |
| gl | editing a posted money record keeps the ledger in step (`fea0125`) |
| payroll | enforce draft → approved → paid; voided stays voided (`a71920f`) |
| payroll | run header + lines commit in one transaction (`eb875a9`) |
| gl | ledger entry, reversal, resync each commit as one transaction (`9484416`) |
| recurring | generated invoices/bills issued on their scheduled date (`b3393ad`) |
| recurring | each schedule step generates exactly one document (`31017dc`) |
| oauth | client secret only goes to the provider's own token hosts — Zoho leak (`d594bcb`) |
| oauth | callbacks only complete a flow this session started — state check (`a47e97e`) |
| woocommerce | user-supplied store URL can only reach public https hosts — SSRF (`8282078`) |
| belvo | a bank link can only be attached by the account that created it (`3b0ca37`) |
| admin | failed admin logins logged by the server, not callers (`03d19e7`) |
| integrations | a tenant sees only its own account's integration requests (`708c545`) |
| stripe-connect | request read_only not read_write (`1d905b6`, later reverted `0a535bb` — re-decide) |

---

## 1. Money-math defects (M1–M47) — the fix-pass backlog

Severity: **S1** silently loses/misstates money or a control reports success doing nothing · **S2** a
shown figure is wrong in ordinary use · **S3** wrong under specific conditions · **S4** labels/latent/design.
Full evidence + measured tables in `MONEY_AUDIT_2026-10-09.md`.

| # | Sev | Status | Finding | Fix direction |
|---|---|---|---|---|
| M1 | S1 | EXECUTED | Deleting a **paid invoice** drops revenue & AR but keeps the cash (orphan payment) | Refuse delete when a payment exists; void-by-credit-note is the path. Class = every parent doc w/ child settlements (⇒ M2) |
| M2 | S1 | EXECUTED | Deleting a **paid bill** drops expense though cash left | Same fix as M1 for bills/payments_made |
| M3 | S1 | EXECUTED | Accountant-portal journals say "posted" but never reach the books | Portal must set status + call postJournalToLedger; form must send a code, not free-text |
| M4 | S1 | **EXECUTED** | Receipt scanner "+ Add to expenses" saves nothing (fake success). A `POST /api/expenses` route now EXISTS (server.js:2192) but addScannedExpense never calls it | Make addScannedExpense POST the scanned receipt; remove the dead `window.EXPENSES` push |
| M5 | S1 | EXECUTED | CSV-imported Paid/Partial invoices & bills count as fully outstanding | Import must write amount_paid / payment rows; restore the boot backfill or map an "amount paid" column |
| M6 | S1 | EXECUTED | Income-tax estimate deducts only flagged expense rows, not payroll/COGS/bills (**owner decision, see tax note**) | Base taxable on net profit (revenue − all ordinary costs), apply per-expense deductible factor. **M6 = owner's call, answered in the sweep doc comment** |
| M7 | S1 | EXECUTED (scratch+live) | 13-week cash forecast contains **no payroll** | Add approved-unpaid runs + roster run-rate to `/api/cashflow-forecast` |
| M8 | S1 | EXECUTED | Inventory write-off ("adjustment") never expensed; ledger keeps phantom stock | Post a GL loss on adjustment; FIFO must account write-offs |
| M9 | S2 | EXECUTED (scratch+live) | Payments Received shows **every entity's** payments (mixed currencies) | Scope `/api/invoice-payments` to the active entity; refetch on entity switch |
| M10 | S2 | EXECUTED | Overview chart & monthly arrays drop payroll for UI-created runs (period-string parse bug) | buildMonthlyArrays must bucket by `payrollPeriodYmd`, not `String(period).slice(0,7)` |
| M11 | S2 | EXECUTED | "Growth" compares against the last fiscal month (future) → AI −100%, Health growth 0 | Compare against the latest month with data, or the prior elapsed month |
| M12 | S2 | EXECUTED | Personal recurring scaled to the whole nominal period (Year = ×12 in October) | Scale by elapsed months, not nominal; a raise must not retro-apply to all 12 |
| M13 | S2 | EXECUTED | Personal asset/liability values have no currency; shown as USD × rate | Store/display per-entry currency; stop treating raw value as USD |
| M14 | S2 | EXECUTED | Owner salary in Personal comes from the roster template, not payroll runs (Rule 12) | Source personal salary income from runs, not the roster profile |
| M15 | S2 | EXECUTED (server) | Four "deductible" vocabularies disagree (`yes`/`Yes`/`true`/`undefined`) across surfaces | One deductible resolver shared by server + client + report + label |
| M16 | S2 | EXECUTED (scratch) | Cash-flow report omits inventory purchases (and FX) that balance-sheet cash includes | Add inventory-purchase + FX-settlement cash legs to `/api/reports/cash-flow` |
| M17 | S2 | EXECUTED | Deleting an expense booked from a bank line strands the bank line forever | On delete, clear reconcile_state / add an un-reconcile route |
| M18 | S2 | CODE-READ | Stripe: a Pay-now-paid invoice can be "added to books" again (double revenue); Pay-now refunds never reverse | Guard import-charge against the Pay-now key; refund webhook must handle both schemes (needs Stripe sandbox) |
| M19 | S3 | CODE-READ | Codat-imported journals typed by the first char of an opaque account id | Map Codat account refs to real COA codes before posting (needs Codat sandbox) |
| M20 | S2 | EXECUTED | Client AI insights' payroll from salary-category rows + roster (Rule 12) | Read payroll from run lines, not `d.sal`/roster |
| M21 | S3 | EXECUTED | Re-dating a posted journal changes the list, not the GL | PUT on a posted journal must re-post (or refuse the date change) |
| M22 | S3 | EXECUTED | GL backfill `reset` re-dates paid-payroll cash-out to run_date (SELECT omits paid_date) | Select `paid_date` in the backfill step-7 query |
| M23 | S3 | EXECUTED | Entities "Consolidated" plain-sums per-entity, so legacy NULL-entity rows count once per entity | Use server `computeBooks(null)` consolidated, not a client sum |
| M24 | S3 | EXECUTED | Two server "overdue" definitions disagree (status-filtered vs arithmetic) | One overdue definition (`computeBooks.arSummary`) everywhere |
| M25 | S3 | EXECUTED | Status-literal `'overdue'` remains in 3 places (AI grounding, portal AI, Bills badge) | Replace literal checks with the arithmetic overdue set |
| M26 | S3 | CODE-READ | Portal Personal tab: all-time raw sum, includes business bank-feed rows, mixed currencies, 200-row cap | Filter entity_id IS NULL + windowed engine + FX-normalize |
| M27 | S3 | EXECUTED | Invoices page: two writers of "% collected"; "Billed" all-time under a period label | One collected writer; label Billed as the period it covers |
| M28 | S3 | EXECUTED | AI quarter insight hard-codes Q4; "top client this month" is all-time; cash-card % mismatched bases | Compute quarter from fiscal calendar; period-scope top client; align bases |
| M29 | S3 | EXECUTED | Dashboard profit "vs last period" compares net-with-COGS to prior-without-COGS | Include COGS in both periods |
| M30 | S3 | EXECUTED | Health receivables = status-'paid' face ÷ all invoices (drafts, partials ignored) | Use amount_paid / recognised AR, exclude drafts/future |
| M31 | S3 | EXECUTED | Recurring Bills "YTD" = monthly × month-number (fabricated); Recurring Invoices "YTD" all-time | Sum actually-generated docs in the fiscal YTD window |
| M32 | S3 | CODE-READ | COGS dated by the UTC instant of the click, not the business date (Rule 10) | Resolve moved_at to the entity's date; add a date field to stock-out |
| M33 | S3 | EXECUTED | Bank CSV import collapses two genuine identical same-day transactions into one | Add a sequence/row index to the dedupe key |
| M34 | S3 | CODE-READ | Inventory purchase credits Cash with no bill link → recording the bill too double-counts | Offer AP option + link stock-in to a bill |
| M35 | S3 | EXECUTED | Fake in-memory "Salary — X (April)" rows (hard-coded 'Apr 30') injected into the personal list | Remove the fabricated unshift in syncAllPayrollsToPersonal |
| M36 | S3 | CODE-READ | Business Investments card shows USD-priced holdings under a non-USD entity symbol, unconverted | Convert holdings to the entity's display currency |
| M37 | S3 | EXECUTED | River (Sankey) is a third profit number: no COGS, payroll missing | Build the river from computeBooks, not REV/EXP arrays |
| M38 | S4 | CODE-READ | Monthly buckets include future-dated rows while KPIs exclude them (D2 mismatch) | Apply D2 to monthly buckets |
| M39 | S4 | CODE-READ (latent) | chart bucket uses `expense_date` only; KPIs fall back to date/created_at | Share the date-resolution helper |
| M40 | S4 | CODE-READ (latent) | Backfill has no date fallback; a legacy dateless row aborts a `reset` mid-way | Add a date fallback before postLedgerEntry |
| M41 | S4 | CODE-READ | Payroll cash-out booked at gross; withholdings never a liability (design) | Owner decision: book net + withholding liability |
| M42 | S4 | CODE-READ | Run Payroll modal asks a run date the server ignores (run_date = NOW()) | Honor the submitted run date |
| M43 | S4 | CODE-READ | Forecast AR/AP not net of credit/vendor-credits; opex run-rate skips orphan payments | Net credits; include orphan payments |
| M44 | S4 | CODE-READ | API v1 summary uses Jan fiscal year; entity keys hide NULL-entity rows the summary counts | Use accountFyStartIdx; reconcile entity scoping |
| M45 | S4 | EXECUTED | P&L report tile "Expenses — incl. payroll + COGS" shows opex (excludes COGS) | Fix the label or include COGS in the value |
| M46 | S4 | CODE-READ | Cash card "avg monthly net" divides by nominal months (12/3), not elapsed | Divide by elapsed months |
| M47 | S4 | CODE-READ | Tax-Deductible report has no D2 bound (future-dated expenses count) | Apply D2 to the report window |

---

## 2. Independent validation — the A1–A21 whole-app sweep

Seeded dataset A1–A21 through the **real routes** on throwaway Postgres (pinned to Oct 2026) and read
every figure through the **real report endpoints**. Full table in `SWEEP_A_RESULTS.md`.

- **20+ server figures match the owner's hand-computed sheet exactly** — the whole P&L, the full balance
  sheet (cash −1,975 / AR 2,047 / inventory 60 / AP 315 / payroll-liab 2,000 / equity −2,183), dashboard
  revenue/expenses/net across Year/Oct/Sep, outstanding 2,047, overdue 1,697, tax 1,610, COGS 40,
  payroll 4,000/3,600, AR-by-customer, and the EUR display row to the cent. **The core money engine is
  correct.**
- **Client native dashboard matches the server** (jsdom): $2.1K/$5.1K/−$2.9K/$2,047 — no mirror
  divergence on the headline for this dataset.
- **2 mismatches, both pre-existing defects (sheet value correct):** M16 (cash-flow drops the 100
  inventory purchase) and M7 (forecast has no payroll).
- **No expected value on the sheet needed correcting.**

### Live prod checks (read-only, real account)
- Prod deployed build is healthy and consistent: the dashboard == `/api/reports` exactly.
- **M7 reproduces live** (forecast JSON contains no payroll).
- **M9 reproduces live** (`/api/invoice-payments` returned other entities' payments, cross-tenant).

---

## 3. New findings this session (M48–M50)

| # | Sev | Status | Finding | Evidence | Fix direction |
|---|---|---|---|---|---|
| M48 | S3 | OBSERVED (live) | The **Bills** page "Pay" button marks a bill **paid in full** with no amount prompt — no partial-payment path (the invoice side's "Record Payment" DOES take an amount). A 400 bill went straight to `status:'paid'` on one click | live prod, Bills page Pay action | Give bill "Pay" the same amount/date modal as invoice Record Payment; support partial bill payments |
| M49 | S3 | OBSERVED (live) | The **Add expense** modal has **no date field** — every expense is stamped to "today", so a back-/forward-dated expense files to the wrong period (Rule 10 class, UI side; the API supports expense_date) | live prod, Add expense modal | Add a date field to the expense form; default today but editable |
| M50 | S4 | EXECUTED | Deleting a business removes its invoices and bills but leaves its **ledger entries** behind (measured: 2 GL entries remain for the deleted entity). The accountant portal's all-entities P&L is correct after the delete (10,999 → 1,000). Effect on consolidated GL views (balance-sheet gate) NOT measured | probe3 (scratch), `DELETE /api/entities/:id` server.js:1817 — documents go with the entity row, ledger_entries do not | Reverse or remove the entity's ledger entries with it, or refuse delete while it holds documents |

Minor (not numbered): the invoice quick-form offers only Pending/Paid/Overdue — **no Draft status**, so a
draft invoice can't be created from that form (drafts are excluded from every figure, so low impact).

---

## 4. What is NOT yet executed (updated 2026-10-10)

- **Executed 2026-10-10:** M11, M12, M13, M14, M20, M25, M27, M28, M29, M30, M31, M35, M37, M45
  (`tools/money-audit-2026-10-09/client-items.js`, real app in jsdom on scratch Postgres). All 14 measured
  the exact predicted bug value; details in MONEY_AUDIT_2026-10-09.md section 5.
- **Read-only production instrument BUILT and executed on scratch:**
  `tools/money-audit-2026-10-09/prod-readonly-counts.js` (M5, M1, M2, M17, M21, M22, M23, M40, M50, M9).
  For the owner to run.
- **Still CODE-READ:**
  - M18 (Stripe) and M19 (Codat), which need provider sandboxes.
  - The S3/S4 items M26, M32, M34, M36 and M38–M47.
- The live A1–A21 seed was **not completed**: exact prod reproduction is blocked by M48/M49 and the
  no-draft form. Business A test entity left on prod; delete when done.

## 5. Recommended order for the fix pass

1. ~~Merge `claude/keen-goodall-gr7s2j`~~ — not needed: its fixes are already on `main` (section 0).
2. **S1 money-loss:** M1, M2, M3, M4, M5, M7, M8 (then M6 once the owner confirms the taxable-income rule).
3. **S2 wrong-figure:** M9, M10, M15, M16, M17 (+ M11–M14, M18, M20 after they're executed to confirm).
4. **S3/S4:** the remainder, grouped by the shared root (the client "second-implementation" mirrors in
   MONEY_AUDIT §0 — fixing the native dashboard to read `/api/reports` kills M10/M23/M29/M37 at once).
5. **New:** M48, M49.
6. **After all fixes:** re-run the full harness sweep + the A1–A21 scratch sweep; every row must match.
