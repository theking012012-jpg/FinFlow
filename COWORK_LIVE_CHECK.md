# FinFlow — post-deploy live check (for Cowork)

**Run this only after** the branch `claude/laughing-hawking-lkvv38` is merged into `main` and Railway shows the new
deployment as live. It has two parts:

- **Part A — confirm the fixes are live.** Observe only. Nothing is created or changed.
- **Part B — exercise the areas no audit has tested yet.** Creates a few clearly labelled test records.

App: https://finflow-production-dab2.up.railway.app — use the same test account as the 2026-10-13 live audit
(owner Sam Owner; businesses **Northwind Studio** (USD) and **Island Traders** (TTD)).

## Ground rules

1. **Record what the screen actually shows.** Never infer or round a result. "Couldn't find it" is a valid result —
   say exactly what you saw and take a screenshot.
2. **Do not fix anything**, and do not edit data to make a check pass.
3. **Every record you create** is named or described with the prefix **`ZZ-LIVECHECK`**. Keep a list of each one
   (type, name, amount, id if visible). **Do not delete anything** — cleanup is the owner's (data changes are
   owner-gated).
4. **No outbound effects:** do not send emails or reminders to anyone, do not take or request real payments, do not
   connect a real bank, do not enter real credentials. If a step would do any of these, mark it **SKIPPED** and say why.
5. Keep **DevTools open the whole time** — Console and Network tabs, **Preserve log** ticked in both. Note the time
   (with timezone) of every step.
6. Unless told otherwise: business **Northwind Studio**, period **Year**.
7. A dashboard card **passes** if it rounds the exact figure correctly (e.g. $15,400 → $15.4K). Report pages must
   match to the cent.

## Report format

| # | Check | Expected | Actual (what the screen shows) | PASS / FAIL / SKIPPED / BLOCKED | Notes / screenshot |
|---|---|---|---|---|---|

End with: the list of every `ZZ-LIVECHECK` record you created, every red console error (full text + stack) with the
step it appeared in, and any full page reload you saw (what you clicked).

---

## Part A — confirm the fixes are live (observe only)

**A0. The new code is deployed.** Open **Settings**. There is a field **"Reporting currency — all businesses
combined"**. If it is missing, **stop here** — the deploy has not landed; report that and nothing else.

**A1. No boot errors, no $0 cards (B1 / LA1 / LA2).** On the Dashboard, hard reload (**Ctrl+Shift+R**) and wait for it
to finish loading. Do this **twice**.
- Console: **zero** red errors containing `deferred render hook threw` or `Cannot set properties of null`.
  (Before the fix: 7 on every reload.) Copy any red error that does appear.
- Revenue, Expenses and Net Profit show real figures, **not $0**. Then open **Reports → Profit & Loss** for the same
  period: the three dashboard figures match it.

**A2. Reporting currency (LA21).** In Settings, the dropdown's first option reads **"Your first business's currency
(USD)"** and is selected (nothing chosen yet). In the Network tab, `GET /api/settings` returns
`reporting_currency: null` and `reporting_currency_effective: "USD"`.
- Switch to the **All entities** view (the combined view of both businesses) and note the currency and totals.
- Back in Settings, choose **TTD**. A confirmation appears. The All-entities totals are now shown in **TT$**.
- Choose **"Your first business's currency (USD)"** again → All-entities totals are back in **$**, matching what you
  noted. **Leave it on the default** — the owner picks the real one.

**A3. Payroll runs carry no "TT" (LA23).** In the Network tab, open the response of `GET /api/payroll-runs` (open the
Payroll page if it hasn't loaded). **Every** run has `jurisdiction: null` — none says `"TT"`.

**A4. Owner flag on employees (LA3).** Payroll → edit **Sam Owner** (do not save). The form has a
**"This is me — the business owner"** checkbox, ticked. Close without saving.

**A5. Customers and vendors come from your documents (LA4, LA14).** Customers page: names that appear only on invoices
are listed with a **"Not saved"** marker and a Save button, and the totals include them. Vendors page: the same for
names that appear only on bills. (Do not click Save.)

**A6. Inventory rows add up (LA5).** Inventory page: the value shown on each product row adds up to the Inventory
value card.

**A7. Invoices "Outstanding" names credit notes (LA6).** Invoices page, Outstanding card: if any credit note is open,
the caption reads **"… less $X in credit notes"**.

**A8. Labels (LA8, LA9, LA10, LA13).**
- Expenses page: the card is labelled **"Expense entries"**.
- Reports → Tax reports: there is **no VAT** tile.
- Reports: a report named **"Payroll by person"** (not "1099 / W-2 Summary").
- Dashboard, under Net Profit: a caption **"after $N cost of goods sold"** when the period has any cost of goods sold.

**A9. One product list (LA16).** Items page: stocked products appear as **"Stock item"** rows alongside services.

**A10. Each business in its own currency (LA15).** Switch to **Island Traders (TTD)**. On Chart of Accounts, Projects
and Items, money shows **TT$**, never a bare `$`. Settings → invoice template preview: the sample total is in **TT$**.
Switch back to Northwind Studio.

**A11. Accountant sign-up pricing (LA17, LA15c).** In a **private window**, open `/accountant-register`. The pricing
section has **"Currency for your rates"**; picking Trinidad & Tobago as the country switches it to TTD and the rate
fields show **TT$**. **Do not submit the form.**

---

## Part B — areas no audit has exercised yet

For each area: note the figures **before**, do the action, then the figures **after**. The expected result is
always stated as a **change**, so it holds whatever the account already contains. Use today's date unless told
otherwise.

**B1. Quotes.** Note Dashboard Revenue (Year). Create a quote **ZZ-LIVECHECK quote**, 1 line, **$100.00**.
- Revenue is **unchanged** (a quote is not income).
- If the app offers **Convert to invoice**, do it: one new invoice of **$100.00**, and Revenue rises by exactly
  **$100.00**. The quote shows as converted.

**B2. Sales receipts.** Note Revenue. Create a sales receipt **ZZ-LIVECHECK receipt**, **$50.00**, paid today.
Revenue rises by exactly **$50.00**. Outstanding (Invoices page) is **unchanged** — a sales receipt is paid on the spot.

**B3. Payments received.** On the invoice from B1 (or create **ZZ-LIVECHECK invoice**, $100.00, pending), record a
payment of **$40.00**. Note Outstanding before and after: it drops by exactly **$40.00**. Payments Received lists the
$40.00. The invoice shows partial, with **$60.00** remaining.

**B4. Payments made.** Create a bill **ZZ-LIVECHECK bill**, **$30.00**, unpaid. Note Accounts payable / bills
outstanding. Record a payment of **$30.00** against it from Payments Made (or the bill's Pay button). Payables drop by
exactly **$30.00**; the bill shows paid; it is listed once in Payments Made.

**B5. Classes.** Create an expense **ZZ-LIVECHECK expense**, **$20.00**, and tag it with a class (create one named
**ZZ-LIVECHECK class** if needed). Reports → Classes / segments: that class shows **$20.00** of cost.

**B6. Time tracking.** Projects: create **ZZ-LIVECHECK project** (budget $500). Timesheet: log **1.5 hours** to it.
The timesheet shows 1.5 h; the project shows the logged time. Record whatever billed / budget figures appear.

**B7. Budget.** Budget page: set a monthly budget for the expense category you used in B5. The "actual" for that
category includes the **$20.00** from B5, and actual + remaining = budget.

**B8. MRR / SaaS.** Record MRR and ARR as shown. Then compare with Recurring Invoices: MRR = sum of the **active
monthly** recurring invoices (annual ones ÷ 12, if any). Write down both numbers. **Do not create a recurring
invoice.**

**B9. Scheduled Documents.** The list shows the upcoming recurring invoices and bills, with dates and amounts matching
the Recurring Invoices / Recurring Bills pages. Note any mismatch.

**B10. Reminders.** Open Reminders. Overdue invoices are listed, with the amount still owed (after any payments).
Open one draft to read it. **Do not send anything.**

**B11. Documents and Templates.** Templates: preview each template — business name and currency are right for the
active business. Documents: if upload is offered, upload a small harmless file named **ZZ-LIVECHECK.txt**; it appears
in the list and opens. Switch to Island Traders: it does **not** appear there (documents belong to one business).

**B12. Audit trail.** The Audit trail lists the actions from B1–B11 (quote, receipt, payment, bill, expense, class,
project, time entry, budget, document), each with the right user and a sensible time. Note any action that is
missing.

**B13. Bank Rec.** Open Bank Rec. Record the matched and unmatched counts and the statement vs book balance shown.
Nothing is created here — just note whether the page's figures are consistent with each other.

**B14. Accountant portal (only if an accountant login is available).** Log in as the existing test accountant in a
private window. The accountant sees **only** the businesses granted to them, in each business's own currency, and the
"All entities" view states any currency it cannot include. If no accountant login is available, mark **BLOCKED**.

**B15. Every page, every console.** Open each sidebar page once on Northwind Studio (Dashboard through Settings, plus
Personal and Investments). For each: PASS if it renders with no error banner, blank panel, `undefined` or `NaN`, and
no red console error. Then repeat Dashboard, Invoices, Expenses and Personal in a **phone-sized window (~390 px wide)**
and note anything cut off or unusable.

---

## Final summary (put this at the top of your report)

- Part A: how many PASS / FAIL out of 12 (A0–A11).
- Part B: how many PASS / FAIL / SKIPPED / BLOCKED out of 15.
- Every FAIL in one line each, worst first.
- The `ZZ-LIVECHECK` records you created (for the owner to clean up).
- Every red console error, and any full page reload, with the step.
