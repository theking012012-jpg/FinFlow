# FinFlow — post-deploy live check (for Cowork)

**Run this only after** the branch `claude/laughing-hawking-lkvv38` is merged into `main` and Railway shows the new
deployment as live. It has three parts — **run them in this order**:

- **Part A — confirm the fixes are live.** Observe only. Nothing is created or changed.
- **Part B — rerun the 2026-10-13 live audit** (`LIVE_AUDIT_2026-10-13.md`): the same reconciliations, flow tests,
  payroll run, walls and multi-currency checks, now against the fixed app.
- **Part C — exercise the areas no audit has tested yet.** Creates a few clearly labelled test records.

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

**A1. No boot errors, no $0 cards (13 Oct B1 / LA1 / LA2).** On the Dashboard, hard reload (**Ctrl+Shift+R**) and wait for it
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

## Part B — rerun of the 2026-10-13 live audit

The 13 Oct audit's figures (in brackets below) have moved since — Cowork's November 2026 payroll run (paid 14 Oct),
the audit's own test records — so each check here is a **reconciliation** (surfaces agree with each other) or a
**before/after change**, not a fixed total. Where a figure differs from 13 Oct, say which records explain it.

**B1. P&L reconciles end to end.** Northwind, Year, Reports → Profit & Loss: Revenue − COGS = Gross profit;
Gross profit − Expenses = Net; every month row reconciles the same way. Net profit is **identical** on the Dashboard
card, Reports' NET RESULT, the Money-flow block and the P&L. *(13 Oct: 15,400 − 390 = 15,010 − 3,005 = 12,005.)*

**B2. Receivables reconcile.** Reports → AR by customer: the per-customer amounts add up to Outstanding on the
Dashboard **and** on the Invoices page (all three equal). Overdue = the overdue customers' amounts.
*(13 Oct: Bright 1,500 + Delta 1,200 + Acme −300 = 2,400; overdue 1,200.)*

**B3. Revenue basis (accrual, issue-based).** Revenue (Year) = total of this year's issued invoices (pending, overdue,
partial, paid — **drafts excluded**) − this year's credit notes. Show the two numbers. *(13 Oct: 15,700 − 300 = 15,400.)*

**B4. Expense basis (accrual).** An **unpaid** bill is already in Expenses. A bill tagged **Stock** goes to Inventory,
not Expenses. Check one existing example of each and say which.

**B5. Flow tests — each action writes exactly once.** Note Dashboard Revenue, Expenses and Outstanding first. Click
**Save once** for each:
- Invoice **ZZ-LIVECHECK flow**, **$777.00**, pending, today → listed **once** on Invoices; Revenue **+777.00**;
  Outstanding **+777.00**; it also shows in the Money-flow block, the transactions list and the current month's chart bar.
- Expense **ZZ-LIVECHECK flow**, **$88.00** → listed once; Expenses **+88.00**; it shows in the expense breakdown and
  Money-flow.
- Bill **ZZ-LIVECHECK flow**, **$44.00**, unpaid → listed once on Bills; Expenses **+44.00**; payables **+44.00**.

**B6. Payroll and the owner salary (the old B2, rerun end to end).** Note Dashboard Expenses (Year) and Personal income
(Year). Payroll → run payroll for **December 2026**, approve it, **Mark paid**.
- The mark-paid message says the owner's salary was added to Personal (name and amount).
- Expenses rise by exactly the run's **total gross** (shown on the run).
- Personal: a row **"Owner salary — Northwind Studio (December 2026)"** for Sam's **net** pay (expected **$4,000.00**),
  and Personal income rises by exactly that. Check the API too: `GET /api/personal-transactions` contains it.
- Now **Void** the December run. Expenses return to the figure you noted; the owner-salary row is **gone** from
  Personal and Personal income returns to the figure you noted.
- Leave Cowork's earlier **November 2026** run as it is (paid). Do not void it.

**B7. The personal / business wall.** Personal has its own bank feed and its own investments; **no** personal item
appears on any business page, and **no** business figure appears in Personal except owner-salary rows (B6). Check the
Dashboard, Reports, Banking and Investments of Northwind against Personal.

**B8. Each business in its own currency.** Switch to **Island Traders (TTD)**: money shows **TT$** everywhere, and its
books reconcile (Revenue − Expenses = Net, Year). *(13 Oct: TT$8,000 − TT$1,250 = TT$6,750.)* Switch back.

**B9. Tax is estimates only.** Personal and Reports carry the "no tax calculation / estimate" disclaimer; there is no
VAT / GST return.

**B10. The 13 Oct findings, re-checked.** For each, PASS / FAIL with what you saw:
- 13 Oct B1 `$0` cards → A1. · 13 Oct B2 owner salary → B6 above. · M1 customers → A5. · M2 inventory value → A6.
- M3 credit notes → A7; and the credit note is recognised in its **own** month (a negative month is expected — by design).
- Minor labels → A8. · Full page reloads: none from sidebar navigation or period buttons; a business switch shows the
  "Loading your workspace…" screen without a document reload (by design).

**B11. Console for Part B.** Count of red console errors across B1–B10 (expected **0**), each copied in full.

---

## Part C — areas no audit has exercised yet

For each area: note the figures **before**, do the action, then the figures **after**. The expected result is
always stated as a **change**, so it holds whatever the account already contains. Use today's date unless told
otherwise.

**C1. Quotes.** Note Dashboard Revenue (Year). Create a quote **ZZ-LIVECHECK quote**, 1 line, **$100.00**.
- Revenue is **unchanged** (a quote is not income).
- If the app offers **Convert to invoice**, do it: one new invoice of **$100.00**, and Revenue rises by exactly
  **$100.00**. The quote shows as converted.

**C2. Sales receipts.** Note Revenue. Create a sales receipt **ZZ-LIVECHECK receipt**, **$50.00**, paid today.
Revenue rises by exactly **$50.00**. Outstanding (Invoices page) is **unchanged** — a sales receipt is paid on the spot.

**C3. Payments received.** On the invoice from B5 (or create **ZZ-LIVECHECK invoice**, $100.00, pending), record a
payment of **$40.00**. Note Outstanding before and after: it drops by exactly **$40.00**. Payments Received lists the
$40.00. The invoice shows partial, with **$60.00** remaining.

**C4. Payments made.** Create a bill **ZZ-LIVECHECK bill**, **$30.00**, unpaid. Note Accounts payable / bills
outstanding. Record a payment of **$30.00** against it from Payments Made (or the bill's Pay button). Payables drop by
exactly **$30.00**; the bill shows paid; it is listed once in Payments Made.

**C5. Classes.** Create an expense **ZZ-LIVECHECK expense**, **$20.00**, and tag it with a class (create one named
**ZZ-LIVECHECK class** if needed). Reports → Classes / segments: that class shows **$20.00** of cost.

**C6. Time tracking.** Projects: create **ZZ-LIVECHECK project** (budget $500). Timesheet: log **1.5 hours** to it.
The timesheet shows 1.5 h; the project shows the logged time. Record whatever billed / budget figures appear.

**C7. Budget.** Budget page: set a monthly budget for the expense category you used in C5. The "actual" for that
category includes the **$20.00** from C5, and actual + remaining = budget.

**C8. MRR / SaaS.** Record MRR and ARR as shown. Then compare with Recurring Invoices: MRR = sum of the **active
monthly** recurring invoices (annual ones ÷ 12, if any). Write down both numbers. **Do not create a recurring
invoice.**

**C9. Scheduled Documents.** The list shows the upcoming recurring invoices and bills, with dates and amounts matching
the Recurring Invoices / Recurring Bills pages. Note any mismatch.

**C10. Reminders.** Open Reminders. Overdue invoices are listed, with the amount still owed (after any payments).
Open one draft to read it. **Do not send anything.**

**C11. Documents and Templates.** Templates: preview each template — business name and currency are right for the
active business. Documents: if upload is offered, upload a small harmless file named **ZZ-LIVECHECK.txt**; it appears
in the list and opens. Switch to Island Traders: it does **not** appear there (documents belong to one business).

**C12. Audit trail.** The Audit trail lists the actions from C1–C11 (quote, receipt, payment, bill, expense, class,
project, time entry, budget, document), each with the right user and a sensible time. Note any action that is
missing.

**C13. Bank Rec.** Open Bank Rec. Record the matched and unmatched counts and the statement vs book balance shown.
Nothing is created here — just note whether the page's figures are consistent with each other.

**C14. Accountant portal (only if an accountant login is available).** Log in as the existing test accountant in a
private window. The accountant sees **only** the businesses granted to them, in each business's own currency, and the
"All entities" view states any currency it cannot include. If no accountant login is available, mark **BLOCKED**.

**C15. Every page, every console.** Open each sidebar page once on Northwind Studio (Dashboard through Settings, plus
Personal and Investments). For each: PASS if it renders with no error banner, blank panel, `undefined` or `NaN`, and
no red console error. Then repeat Dashboard, Invoices, Expenses and Personal in a **phone-sized window (~390 px wide)**
and note anything cut off or unusable.


**C16. Bank-linking widgets under the strict security policy (FA-P1).** The app runs under a Content-Security-Policy
with no inline code; the browser refuses anything the policy does not allow and reports each refusal to the server.
Plaid (bank linking) and Belvo (Latin America bank linking) open the provider's own window, loaded from the provider's
servers — **no automated test can reach them**, so this live check is the only verification they have.
Do **not** link a bank or type any credentials (ground rule 4): opening each widget and closing it is the whole check —
loading it is what the policy has to allow.

1. **Baseline (needs the platform admin login — if you do not have it, mark steps 1 and 4 BLOCKED and do the rest).**
   In a separate private window, sign in at `/admin`, then open `/api/admin/csp-report`. Record `total`, `unique` and
   every row (`directive`, `blocked`, `source`, `count`). The list lives in the server's memory: it is **emptied by
   every deploy or restart** and collects refusals from **every** user's browser since then. So do steps 1–4 in one
   sitting, and if Railway redeploys in between, start again from step 1.
2. **Plaid.** In the app (Northwind Studio, DevTools Console open, Preserve log on): Connections → the **Plaid** card →
   Connect. Wait until the Plaid window is fully shown, then close it with its own ✕ / Exit. Record what appeared.
3. **Belvo.** Connections → the **Belvo** card → Connect. Wait until the Belvo widget is fully shown, then close it.
   Record what appeared.
4. **After.** Reload `/api/admin/csp-report` and compare it with the baseline.

- **PASS:** each widget opens; the Console shows **no** `Refused to …` / `Content Security Policy` line during steps 2–3;
  and the report has **no new row** whose `source` is a FinFlow page or file (`/`, `/app`, `/js/…`, `/finflow-bundle.js`,
  `/ff-csp.js`, …) or whose `blocked` is a `plaid.com` / `belvo.io` / `belvo.com` address.
- **FAIL:** a widget does not open while the Console shows a refusal, or any such new row appears. Copy the full
  Console line(s) and the new row(s) — the `directive` names the part of the policy to fix (`script-src`,
  `frame-src`, `connect-src`, …).
- **BLOCKED:** a widget does not open and the app says linking is not set up (e.g. "Bank linking is unavailable right
  now", "Latin America bank linking isn't set up yet", or "…isn't enabled yet — use ⬆ Import"). That is missing
  provider keys on the server, not the policy — record the exact message.
- Rows that were already in the baseline, or whose `source` is a browser extension (`chrome-extension://…`,
  `moz-extension://…`), are not FinFlow's — list them under Notes, they do not fail the check.
---

## Final summary (put this at the top of your report)

- Part A: how many PASS / FAIL out of 12 (A0–A11).
- Part B: how many PASS / FAIL out of 11 (B1–B11) — and every figure that differs from 13 Oct, with what explains it.
- Part C: how many PASS / FAIL / SKIPPED / BLOCKED out of 16 (C1–C16).
- Every FAIL in one line each, worst first.
- The `ZZ-LIVECHECK` records you created (for the owner to clean up).
- Every red console error, and any full page reload, with the step.
