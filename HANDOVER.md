# FinFlow — handover (kept current after every commit)

**Read `CLAUDE.md` first.** Its rules are binding. This file says where the work stands and what to do next.

## Where things are

- Branch: `claude/money-math-audit-bazpjo`. `main` = the branch as of `15f207f` (the money audit, M1–M61), deployed on
  Railway (auto-deploys `main`). Everything after `15f207f` is on the branch only, until the owner merges it.
- Production data was wiped on 2026-10-11 (clean slate; 71 tables rebuilt at boot).
- The owner runs ALL full sweeps in PowerShell (`node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js`).
  The agent runs only targeted harnesses. Last full sweep by the owner: 512/512 GREEN, three times (on `15f207f`).
- The owner has given standing permission (2026-10-11) to commit and push each fix once verified, on this branch.
  Never merge to `main`; the owner does that.

## Money audit (done)

`MONEY_AUDIT_2026-10-09.md` §1–§9: 62 findings (M1–M62). All fixed and verified RED → GREEN, except M47 (cleared: not a
defect). Cowork's live end-to-end test confirmed every Northwind money figure to the cent.

## Cowork end-to-end test (2026-10-11) — the current work list

Script: `COWORK_TEST_SCRIPT.md`. Cowork's report (on the owner's machine): `COWORK_TEST_REPORT.md` + `cowork-test-shots`.
Result on live `main`: 81 PASS / 19 FAIL / 5 BLOCKED. The FAILs are browser-side (state kept in memory across a business
switch), workflow and layout defects. They were outside the money audit's scope, which tested server figures and opened
pages fresh.

Status (C = Cowork item; each fix is one commit with its harness, RED on the old code and GREEN on the fix):

### Group 1 — wrong figures / business or Personal leaking

| # | Cowork | Problem | Status |
|---|---|---|---|
| C1 | 4.1a, 4.5d | After a business switch, pages kept the previous business's data (payroll owner card, inventory) | **Fixed** `b661b57` |
| C2 | 5.4c | Choosing a TTD business flipped Personal to TTD | **Fixed** `ed2e528` |
| C3 | 4.4a | Island Traders' amounts show "$" instead of "TT$" after a reload | open |
| C4 | 3.4 | Income-tax rate (20 %) not saved; estimate and accountant Tax Summary blank | open |
| C5 | 4.6 | FX page "No rates yet"; consolidated P&L shows the TTD business as $0 and total "—" | open |
| C6 | 6.4, 6.5a | New accountant link sees every business by default; accountant's personal view has no income/spending totals, PAYPAL REFUND missing | open |
| C7 | (confusing list) | Inventory value card $75 vs Balance Sheet $90 (card = units × item cost field; BS = FIFO layers) | open |
| C8 | 3.2a | Bank Rec "3 unmatched" after all four lines handled; debits shown as +$ with no date | open |

### Group 2 — workflows

| # | Cowork | Problem | Status |
|---|---|---|---|
| C9 | 2.4a | Edit expense opens with the date blank; amount-only edit refused "Enter a valid date" | open |
| C10 | 7.4 | Transaction lock can't be turned off | open |
| C11 | 6.3 | Accountant invite can't reach an existing client (only a referral sign-up link) | open |
| C12 | 1.3a | Onboarding lets Country* be empty | open |
| C13 | 1.3c | Entities shows 0 businesses until a reload; country not shown anywhere | open |
| C14 | 3.4 | P&L has no monthly table; Year chart starts in May (March missing) | open |
| C15 | 8.1 | No real P&L export (CSV "Nothing to export", PDF = print dialog) | open |
| C16 | 2.5a | Overdue bill row says "unpaid" | open |
| C17 | (confusing) | Match-bill dropdown defaults to the wrong bill | open |
| C18 | (confusing) | False "exceeds remaining balance" when amount == balance | open |
| C19 | (confusing) | Vendors / Customers / Items pages stay at 0 with data | open |

### Group 3 — layout and wording

C20 onboarding window cut off at ~700 px tall · C21 inventory + In / − Out hidden at ~656 px · C22 business switcher
shows "undefined" · C23 `/accountant-register` shows the home page (form is at `/join`) · C24 connection screens show
server setting names (e.g. PAYPAL_CLIENT_ID) and "Available" for unconfigured providers; Finch raw "customer_id: 1"
error · C25 phone-width squeezing (Invoices header, Personal title) · C26 "Start free trial" opens Sign-in · C27 plan
badge flips Pro/Business · C28 two contradicting commission tables · C29 audit "Payroll" filter empty · C30 native
browser pop-ups (accountant sign-up step 2, Shopify connect).

Script errors to correct in `COWORK_TEST_SCRIPT.md` before the next run: 2.6b (1,920 + 1,050 = 2,970, not 3,970); 2.1 I3
assumes a Draft status the UI doesn't offer; 4.6a assumes an all-businesses view the app doesn't have.

## How each fix is verified (do the same)

1. Write the harness first; it must FAIL on the old code with the value Cowork saw (state it in the harness).
2. Fix; harness GREEN; re-run every related harness (list them in the commit message).
3. Browser-side items need a jsdom harness that does what a user does (`clientMoneyKit.js`), e.g. switch business
   through the sidebar (`switchBusiness`), not only the lower-level call.
4. index.html changed → `node scripts/externalize-app.js && node scripts/lazy-pages.js` and stage `public/_gen`.
   The pre-commit hook rebuilds `public/finflow-bundle.js` from the index — never edit the bundle.
5. Commit (one fix per commit), push, update this table.
