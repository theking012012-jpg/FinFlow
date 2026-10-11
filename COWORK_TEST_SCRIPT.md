# FinFlow — full end-to-end test (for Cowork)

You are testing FinFlow, a live accounting app, as a brand-new customer. Work through every part below **in order**,
in the browser, exactly as a user would. Enter the exact values given. After each check, record what the screen
**actually shows** next to what is **expected**.

## Ground rules

1. **Never invent a result.** If a screen, button, or number is not where this script says, write down exactly
   what you see instead (and take a screenshot). "Couldn't find it" is a valid, useful result.
2. **Do not fix anything.** If a number is wrong, record it and carry on. Do not edit data to make a check pass,
   unless a step tells you to.
3. **Never enter real bank, card, or payment credentials.** Only the sandbox test logins given below. If any screen
   asks for real banking details, stop that step, mark it **BLOCKED**, and move on.
4. **Expected values are exact.** Dashboard cards round big numbers (for example $15.4K). A card **passes** if it
   rounds the exact figure correctly. Report pages show the exact figure, and that must match to the cent.
5. **Dates:** these expected values assume you run the test between **11 Oct and 31 Oct 2026**. If today is later,
   note the date at the top of your report. Some "overdue" figures will differ, and that is expected.
6. Use **Year** (or "This fiscal year", Jan–Dec 2026) whenever a page has a period selector, unless told otherwise.
7. If an action fails with an error message, copy the message exactly.
8. On any **FAIL**, take a screenshot and note the page and step number.

## Report format (fill this in as you go)

| # | Step | Expected | Actual (what the screen shows) | PASS / FAIL / BLOCKED | Notes |
|---|------|----------|-------------------------------|------------------------|-------|

At the end, add three lists:
- every FAIL, with its step number;
- every page that showed an error, blank screen, or broken layout;
- anything confusing a real user would trip over (even if it is not "wrong").

---

## Part 0 — Prep (the owner does this, not Cowork)

A new account starts on a **trial**, which allows only **one business**. This test needs two.

1. Cowork does Part 1 (signup + onboarding), then pauses.
2. The owner opens **/admin**, logs in with the admin password, finds the test account under **Users**, and sets
   its plan to **business**.
3. The owner tells Cowork to continue from Part 2.

---

## Part 1 — Signup and onboarding

1.1 Open the FinFlow website. Click sign up / get started.
- Use email `cowork.test+1@<a mailbox you can read>` and password `CoworkTest!2026`.
- Expected: the account is created and you land in the app or in the onboarding steps.

1.2 Try signing up **again with the same email**.
- Expected: refused with a clear message (for example "An account with this email already exists"). No second account.

1.3 Onboarding — enter:

| Field | Value |
|---|---|
| Business name | **Northwind Studio** |
| Industry | Design / creative (any close option) |
| Your name | **Sam Owner** |
| Email | (same as signup) |
| Business address | 100 Main St, Springfield, IL |
| Primary currency | **USD** |
| Country | **United States** |
| Kind of business | any |
| Connect accounts step | **Skip** (do not connect anything here) |

Checks:
- 1.3a Each required field (*) refuses to continue when left empty.
- 1.3b After finishing, the dashboard shows **Northwind Studio**, with every money card at **$0**.
- 1.3c Settings (or Entities) show Northwind Studio as **USD** and **United States**.
- 1.3d Log out, then log back in. You land back in Northwind Studio, and onboarding does not repeat.

**PAUSE here for Part 0, step 2.**

---

## Part 2 — Business A (Northwind Studio, USD): data entry

Make sure **Northwind Studio** is the selected business for this whole part.

### 2.1 Customers and invoices (Invoices page)

Create these. Use the exact issue and due dates; "send" or "issue" each one (not draft) unless told otherwise.

| # | Customer | Amount | Issue date | Due date | Status |
|---|---|---|---|---|---|
| I1 | Acme Corp | 12,000.00 | 2026-03-10 | 2026-04-09 | issued (pending / sent) |
| I2 | Bright Labs | 2,500.00 | 2026-08-05 | 2026-09-04 | issued |
| I3 | Cedar LLC | 9,000.00 | 2026-09-01 | 2026-10-01 | **leave as DRAFT** |
| I4 | Delta Co | 1,200.00 | 2026-10-01 | 2026-10-31 | issued |

### 2.2 Payments received (record against the invoice)

| Invoice | Amount | Payment date |
|---|---|---|
| I1 Acme Corp | 12,000.00 | 2026-03-25 |
| I2 Bright Labs | 1,000.00 | 2026-08-20 (a partial payment) |

- 2.2a I1 shows **Paid**. I2 shows **Partial** (or similar), with **1,500.00** still owed.
- 2.2b **Double-click test:** when saving the I2 payment, click Save twice quickly. Exactly **one** 1,000 payment must exist.

### 2.3 Credit note (Credit Notes page)

- Customer **Acme Corp**, amount **300.00**, date **2026-09-15**, status **Open**.

### 2.4 Expenses (Expenses page)

| Description | Category | Amount | Date | Tax-deductible |
|---|---|---|---|---|
| Office rent | Rent | 1,500.00 | 2026-09-01 | Yes |
| Design software | Software | 240.00 | 2026-10-02 | Yes |
| Client lunch | Meals | 180.00 | 2026-10-03 | **No** |

- 2.4a **Edit test:** open "Design software", change the amount to 260.00, and save. The list shows 260.00. Then change
  it **back to 240.00** and save.

### 2.5 Bills (Bills page)

| Vendor | Amount | Issue date | Due date |
|---|---|---|---|
| Paper Supply Co | 650.00 | 2026-09-10 | 2026-10-10 |
| CloudHost | 400.00 | 2026-09-20 | 2026-10-20 |

- Pay **CloudHost** in full: 400.00 on **2026-10-05** (use the bill's Pay button).
- 2.5a CloudHost shows **Paid**. Paper Supply Co shows as **overdue / past due** (its due date has passed), with
  650.00 owed.
- 2.5b **Partial pay test:** open Pay on Paper Supply Co and **cancel** without saving. Nothing changes.

### 2.6 Payroll (Payroll page)

Add two people to the roster:

| Name | Monthly gross | Deduction | Owner? |
|---|---|---|---|
| Jordan Lee | 3,000.00 | "Income tax", 10 **%** | no |
| Sam Owner | 5,000.00 | "Income tax", 20 **%** | **yes, this is the owner** |

- 2.6a Roster net pay shows **2,700.00** for Jordan and **4,000.00** for Sam.
- 2.6b **The roster alone must not create any expense.** Open the Dashboard (Year): Expenses still only include
  2.4 and 2.5 (1,920 + 1,050 = **3,970**, card about $4.0K). No payroll yet.

Now run payroll:
- Create a payroll run for period **September 2026**. Then **Approve** it, then **Mark paid**.
- 2.6c The run shows gross **8,000.00**, withholdings **1,300.00**, net paid **6,700.00**.
- 2.6d **Personal side, the ONLY thing allowed to cross over:** open **Personal**. A single income row appears:
  "Owner salary — Northwind Studio (September 2026)", **4,000.00 USD**, dated **today**. Nothing for Jordan.
  No other business figure appears anywhere on the Personal page.
- 2.6e Back on Payroll, the run offers **Remit** for the 1,300.00 withholdings. Remit them with **today's** date.
  (A date before the pay date must be refused; try one to confirm.)

### 2.7 Inventory (Inventory page)

- Create item **Widget**, SKU **W-1**, unit cost 15.00, starting quantity 0.
- **Stock in #1:** 20 units at 15.00 each, dated **2026-06-01**, paid in **cash**.
- **Stock in #2:** 10 units at 18.00 each, dated **2026-07-01**, bought **on credit** (choose the bill / "on credit"
  option), vendor **Widget Maker**, due **2026-11-30**.
- **Sale:** 25 units, dated **2026-08-15**.

Checks:
- 2.7a Units on hand: **5**.
- 2.7b Bills page: a **Widget Maker** bill for **180.00** appears, marked as stock (it is **not** an expense). It has no
  delete button, and changing its amount is refused.
- 2.7c Cost of goods sold for the year is **390.00**. FIFO: the first 20 at 15 = 300, plus 5 at 18 = 90.
  (An average-cost answer would be 400, and last-in-first-out would be 405; both are wrong.)
- 2.7d The Widget Maker purchase does **not** increase Expenses.

### 2.8 Business investment (Business investments page)

- Add a holding: ticker **MSFT**, 5 shares, cost per share 300.00. If the app fills in a live price, keep it and
  **write down the price shown** (P_MSFT).
- 2.8a Value shown = 5 × P_MSFT. Cost basis = **1,500.00**.

---

## Part 3 — Business A: bank feed and reconciliation

### 3.1 Statement import (Banking page → ⬆ Import)

Create a text file on the Desktop named `northwind-bank.csv` with exactly this content:

```
Date,Description,Amount
2026-08-21,BRIGHT LABS PAYMENT,1000.00
2026-10-08,BANK FEE,-35.00
2026-10-09,PAPER SUPPLY CO,-650.00
2026-10-09,TRANSFER TO SAVINGS,-500.00
```

- Import it on the **Banking** page of Northwind Studio.
- 3.1a "Imported 4 transactions".
- 3.1b **Import the same file again** → 0 new ("4 already there"). No duplicates in the list.

### 3.2 Bank Rec page

- Match **BRIGHT LABS PAYMENT (1,000)** to the Bright Labs payment of 1,000.
- **BANK FEE (35)** → "Book as expense".
- **PAPER SUPPLY CO (650)** → "Match to bill" → Paper Supply Co.
- **TRANSFER TO SAVINGS (500)** → "Ignore".

Checks:
- 3.2a All four lines are now dealt with; none is left unmatched.
- 3.2b Bills: Paper Supply Co now shows **Paid**.
- 3.2c Expenses list gains one row, "BANK FEE", 35.00. Nothing else is added.

### 3.3 Bank linking (Banking page → 🔗 Link bank)

Northwind is in the United States, so this should open **Plaid**.
- If you see "Automatic bank linking … isn't enabled yet", write down the message exactly and mark it **BLOCKED (not
  configured)**. That is a setup state, not a bug.
- If a Plaid window opens **and it says Sandbox**: pick any test bank and log in with username `user_good`, password
  `pass_good`. Then press **↻ Sync**.
  - 3.3a The linked bank shows as "Linked ✓".
  - 3.3b Synced transactions appear **only** on Northwind's Banking page.
- If the Plaid window is **not** sandbox (it asks for a real bank login), **close it and mark BLOCKED**.

### 3.4 Business A — expected figures (after Parts 2 and 3)

**Dashboard (Year):**

| Card | Exact | Card may show |
|---|---|---|
| Revenue | 15,400.00 | $15.4K |
| Expenses | 11,005.00 | $11.0K |
| Net Profit | 4,005.00 | $4.0K |
| Outstanding | 2,400.00 | $2,400 |

How these are worked out, so you can see where a wrong number comes from:
- **Revenue** = 12,000 + 2,500 + 1,200 − 300 credit note = **15,400**. The draft (9,000) is excluded.
- **Expenses** = expenses 1,920 + bank fee 35 + bills 1,050 + payroll 8,000 = **11,005**. Cost of goods (390) is shown
  separately, and the stock bill (180) is not an expense.
- **Net** = 15,400 − 390 − 11,005 = **4,005**.
- **Outstanding** = (2,500 − 1,000) + 1,200 − 300 credit = **2,400**.

**Reports → Profit & Loss (Year):** Revenue 15,400.00 · Cost of goods sold 390.00 · Gross profit 15,010.00 · Payroll
8,000.00 · Total expenses 11,005.00 · Net profit 4,005.00.
- By month: Mar revenue 12,000 · Aug revenue 2,500 and COGS 390 · Sep revenue −300 and expenses 10,550 (rent 1,500 +
  bills 1,050 + payroll 8,000) · Oct revenue 1,200 and expenses 455 (240 + 180 + 35).

**Reports → Balance Sheet:** Cash 1,695.00 · Accounts receivable 2,400.00 · Inventory 90.00 · Total assets 4,185.00 ·
Accounts payable 180.00 · Payroll liabilities 0.00 · Total liabilities 180.00 · Equity 4,005.00. Assets must equal
liabilities + equity.
- Cash, worked out: received 13,000. Paid out: expenses 1,955 + CloudHost 400 + Paper Supply 650 + net wages 6,700 +
  withholdings 1,300 + stock 300 = 11,305. Cash = 13,000 − 11,305 = **1,695**.

**Overdue (AR / invoices page / aged receivables):** total overdue **1,200.00**. Bright Labs owes 1,500 past due, and
Acme's unapplied 300 credit nets against the total, as aged-receivables reports do. Count of overdue invoices: **1**.

**Reports → Income Tax Estimate:** set the "Income tax" line to **20 %** of taxable income.
- Taxable income **4,220.00** = net 4,005 + non-deductible lunch 180 + bank fee 35. (A fee booked from the bank feed
  is recorded as not deductible.)
- Estimated tax **844.00**; quarterly **211.00**.

**Checkpoints during Part 2** (if you check earlier):
- After payroll is marked paid, before remitting: Balance Sheet payroll liabilities **1,300.00** and cash **3,980.00**.
- After remitting: payroll liabilities **0.00**, cash **2,680.00**.

---

## Part 4 — Business B (Island Traders, TTD) and the business-to-business wall

### 4.1 Create the second business (Entities page)

- Name **Island Traders**, currency **TTD**, country **Trinidad and Tobago**.
- Switch to **Island Traders**.
- 4.1a Every money card shows **0**, and nothing from Northwind (no invoices, bills, payroll, stock, bank lines or MSFT).

### 4.2 Data

- Invoice **Harbour Ltd**, **8,000.00**, issue **2026-09-12**, due **2026-10-31**.
- Expense **Fuel**, category Travel, **1,250.00**, date **2026-09-15**, deductible Yes.

### 4.3 Bank linking for a country without an aggregator

- Banking page → 🔗 Link bank.
- 4.3a Expected: a plain message that automatic linking isn't available for TT, pointing you to "⬆ Import". No Plaid
  window, and no Belvo window.

### 4.4 Island Traders — expected (Year, in TT$)

| Card | Exact |
|---|---|
| Revenue | 8,000.00 |
| Expenses | 1,250.00 |
| Net Profit | 6,750.00 |
| Outstanding | 8,000.00 |

- 4.4a Amounts show in **TT$** (not $), with no conversion inside Island Traders' own view.

### 4.5 Wall checks between the businesses

- 4.5a Switch back to Northwind. Every figure in 3.4 is unchanged. Nothing from Island Traders appears (Harbour, Fuel).
- 4.5b Island Traders' Banking and Bank Rec pages are empty. Northwind's bank lines never appear there.
- 4.5c Island Traders' Business investments page does **not** show MSFT.
- 4.5d Payroll in Island Traders is empty.

### 4.6 All-businesses (consolidated) view, if the app has one

- Open the FX page and write down the **USD ↔ TTD rate** shown (R = TTD per 1 USD).
- In the all-businesses view: revenue ≈ 15,400 + 8,000 ÷ R (in USD). Net ≈ 4,005 + 6,750 ÷ R. Within $1 of rounding.
- 4.6a The Banking page in the all-businesses view shows **no** bank lines, and "Link bank" asks you to choose a business first.

---

## Part 5 — Personal

Open **Personal** (sidebar). Set the period to **Year**, and the personal currency to **USD**.

### 5.1 Personal transactions

| Type | Description | Category | Amount | Date |
|---|---|---|---|---|
| Income | Freelance design | Freelance | 1,800.00 | 2026-09-20 |
| Expense | Groceries | Groceries | 320.00 | 2026-10-04 |
| Expense | Gym | Health | 60.00 | 2026-10-01 |

- Recurring: **Netflix**, 15.99, monthly, starting **2026-11-01**. It must **not** count yet (it starts in the future).

### 5.2 "Your bank" card (Personal page)

- 5.2a The card exists, titled "Your bank", described as separate from every business.
- Set **Bank country = United States**. Reload the page; it is still United States.
- Create `my-bank.csv` on the Desktop:

```
Date,Description,Amount
2026-10-05,COFFEE HOUSE,-14.50
2026-10-07,PAYPAL REFUND,45.00
```

- Personal card → ⬆ Import → `my-bank.csv`.
- 5.2b "Imported 2 transactions". Both appear in your **personal** transactions: COFFEE HOUSE as spending 14.50, and
  PAYPAL REFUND as income 45.00. The card says "2 bank transactions in your personal feed".
- 5.2c **Wall:** neither line appears on Northwind's or Island Traders' Banking pages.
- 5.2d **Re-import the same file** → 0 new.
- 5.2e **Link bank** (still United States): this goes to **Plaid** in the **personal** scope. Same rules as 3.3:
  sandbox only (`user_good` / `pass_good`), otherwise BLOCKED. If you link, the bank appears under "Your bank" only.
  After **Sync**, the lines appear in Personal only, never in a business.
- 5.2f Change Bank country to **Mexico** → Link bank → it should route to **Belvo** (a Belvo window, or a message that
  Latin-America linking isn't enabled yet). Do not link. Set the country **back to United States**.
- 5.2g Change Bank country to **Trinidad and Tobago** → Link bank → a message that automatic linking isn't
  available, use Import. Set it back to United States.

### 5.3 Assets, liabilities, investments, goals

- Assets & liabilities: asset **Savings account** 10,000.00 · asset **Car** 8,000.00 · liability **Car loan** 5,500.00.
- Investments (personal, sidebar): **AAPL**, 10 shares, cost per share 150.00. Write down the price shown (P_AAPL).
- Goals: **Emergency fund**, target 15,000.00, current 10,000.00, monthly 500.00.

### 5.4 Personal — expected (Year)

| Figure | Expected |
|---|---|
| Income (year) | **5,845.00** = 1,800 + 4,000 owner salary + 45 refund (card ≈ $5.8K) |
| Spending (year) | **394.50** = 320 + 60 + 14.50 |
| Net worth | **12,500 + 10 × P_AAPL** (= 10,000 + 8,000 − 5,500 + portfolio) |
| Portfolio | **10 × P_AAPL**; cost basis 1,500.00 |
| Emergency fund | **66.7 %** (10,000 of 15,000) |

- 5.4a Spending by category: Groceries 320 · Health 60 · plus the coffee 14.50 in its category.
- 5.4b Switch personal currency to **TTD** → every figure converts (the net worth too, not just the labels). Switch
  back to **USD** → the original numbers return exactly.
- 5.4c Switch the **business** selector between Northwind and Island Traders, then come back to Personal. **Every
  personal number is identical**: Personal never depends on which business is selected.

### 5.5 The personal / business wall (most important checks)

- 5.5a Personal shows **no** business figure except the single owner-salary row (4,000). No payroll roster, no
  "monthly salary" card, no business revenue, no business bank lines, and no MSFT.
- 5.5b No business page (Dashboard, Banking, Bank Rec, Expenses, Reports, Business investments) in either business
  shows: Groceries, Gym, Freelance design, COFFEE HOUSE, PAYPAL REFUND, AAPL, Savings account, Car, Car loan, or the
  Emergency fund.
- 5.5c (Voiding the payroll run is tested at the very end, in Part 9, because it changes the figures.)

---

## Part 6 — Accountant portal (two people)

6.1 In a **separate private / incognito window**, register an accountant at **/accountant-register**:
`cowork.acct+1@<mailbox>`, password `CoworkAcct!2026`.

6.2 The owner approves the accountant in **/admin** → Accountants → Verify (Part 0 style). Cowork waits.

6.3 The accountant logs in at **/accountant-login** and **invites** the client (the Part 1 email).

6.4 Back as the business owner, approve the accountant connection. Give access to **Northwind Studio: view**, and
**Personal: none**.
- 6.4a The accountant sees Northwind's figures: revenue 15,400.00, COGS 390.00, operating expenses 11,005.00, net
  profit 4,005.00, outstanding 2,400.00, taxable income 4,220.00.
- 6.4b The accountant does **not** see Island Traders, and does **not** see any personal data.

6.5 Owner changes Personal access to **view**.
- 6.5a The accountant now sees personal: income **5,845.00**, expense **394.50**, net worth **12,500 + 10 × P_AAPL**,
  and the list shows PAYPAL REFUND as income (not as spending).
- 6.5b Owner sets Personal back to **none** → it disappears from the accountant's view again.

---

## Part 7 — Safety rules the app must enforce

- 7.1 Try to **delete invoice I1** (paid). Expected: refused, because it has payments linked.
- 7.2 Try to **delete the Paper Supply Co bill** (paid through the bank match). Expected: refused, or a clear warning
  that it is matched to a bank line. It must not silently delete.
- 7.3 Try to change the **amount** of the "BANK FEE" expense (booked from the bank). Expected: refused (it is matched
  to a bank line).
- 7.4 **Transaction Locking:** lock Northwind through **2026-09-30**. Then try to add an expense dated **2026-09-15**
  → refused. Add one dated 2026-10-06 for 1.00 → allowed. **Delete that 1.00 expense and remove the lock.**
- 7.5 Double-submit: click **Save** twice quickly on a new expense (Test double, 2.00, today). Exactly **one** row is
  created. **Delete it afterwards.**
- 7.6 After 7.4–7.5 are cleaned up, re-check the Dashboard (Year): every figure in 3.4 is unchanged.

---

## Part 8 — Every page opens (smoke test)

For **Northwind Studio**, open every sidebar page once, wait 3 seconds, and record PASS if it renders with no error
banner, blank panel or "undefined"/"NaN" text. Otherwise FAIL, with a screenshot.

Dashboard · Banking · Bank Rec · Scheduled Documents · Review · Reminders · Classes · API · Invoices · Customers ·
Quotes · Payments Received · Sales Receipts · Recurring Invoices · Credit Notes · Expenses · Bills · Vendors ·
Payments Made · Recurring Bills · Vendor Credits · Payroll · Inventory · Items · Projects · Timesheet · Reports (open
each report type) · Budget · MRR / SaaS · Business investments · Manual Journals · Chart of Accounts · Transaction
Locking · Documents · Templates · Audit trail · Team & roles · API connections · Entities · FX · Settings · Help ·
Personal · Investments.

Also:
- 8.1 Export the Profit & Loss as **PDF** and **CSV**. The numbers in both match 3.4.
- 8.2 The **Audit trail** lists the actions you took (invoices created, payments, payroll run paid, etc.).
- 8.3 **API connections:** every provider shows an honest state (connected / not connected / not set up yet). No fake
  "connected" and no crash. Clicking connect on an unconfigured provider shows a clear message.
- 8.4 Repeat the smoke test quickly on a **phone-sized window** (about 390 px wide) for Dashboard, Invoices, Expenses,
  Personal. Record anything cut off or unusable.

---

## Part 9 — Void the payroll run (do this LAST)

Northwind → Payroll → the September 2026 run → **Void**. Confirm the prompt.

| Figure | Expected after the void |
|---|---|
| Dashboard Expenses (Year) | **3,005.00** (11,005 − 8,000 payroll), card ≈ $3.0K |
| Dashboard Net Profit (Year) | **12,005.00** (card ≈ $12.0K) |
| Revenue / COGS / Outstanding | unchanged: 15,400.00 / 390.00 / 2,400.00 |
| Balance Sheet cash | **9,695.00** (1,695 + net wages 6,700 + withholdings 1,300 reversed) |
| Balance Sheet payroll liabilities | 0.00 · equity **12,005.00** · total assets **12,185.00** |
| Income Tax Estimate | taxable **12,220.00**, tax at 20 % **2,444.00** |
| Personal income (Year) | **1,845.00**: the 4,000 owner-salary row is **gone** |

- 9a The Personal page no longer shows the owner-salary row, and nothing else on Personal changes (spending 394.50;
  net worth unchanged).
- 9b Do **not** create a new September run afterwards. Note in your report whether the app lets you, and what happens.

---

## Final summary

End your report with:
1. Totals: number of PASS / FAIL / BLOCKED.
2. The FAIL list (step # + one line each).
3. The error-page list.
4. The confusing-for-users list.
5. The values you wrote down: P_MSFT, P_AAPL, R (USD↔TTD), and the date you ran the test.
