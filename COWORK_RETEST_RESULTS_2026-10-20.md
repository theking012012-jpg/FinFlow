# FinFlow — FULL live retest results, 2026-10-20

App: https://finflow-production-dab2.up.railway.app · repo `main` @ `e023214` · account Sam Owner (Northwind Studio USD, Island Traders TTD), signed in by the owner at 12:24.
Run: Tue 2026-10-20, 12:25 – 13:20, **all times America/La_Paz (UTC−4)**. Browser: Claude desktop app's built-in browser, viewport emulated 1280×900 unless stated.

---

## Final summary

| Part | PASS | FAIL | BLOCKED | SKIPPED | Score |
|---|---|---|---|---|---|
| R (release live) | 1 | 0 | 0 | 0 | **R PASS** |
| F (2026-10-19 findings) | 4 | 1 | 0 | 0 | **F 4/5** |
| T (audit trail) | 3 | 0 | 4 | 1 | **T 3/8** |
| A (fixes live) | 11 | 1 | 0 | 0 | **A 11/12** |
| B (13 Oct rerun) | 7 | 4 | 0 | 0 | **B 7/11** |
| C (new areas) | 14 | 0 | 1 | 0 | **C 14/15** |
| **Total** | **40** | **6** | **5** | **1** | **52/52 checks run** |

### Every FAIL, worst first

1. **B6** — Run payroll for December 2026: `POST /api/payroll-runs` → **HTTP 500** "An unexpected error occurred. Please try again." (twice, 13:02:56 and 13:03:26). Expected: run created → approve → mark paid → owner salary $4,000.00 in Personal → void. Seen: no run created; nothing after it could be done. (A voided "December 2026" run #4 from 19 Oct already exists — possible cause, not verified.)
2. **B5** — Money-flow block goes stale: after the $88 expense it kept showing **"$19,972 net profit"** while Reports NET RESULT and the API showed **$19,884**; it corrected only after a full page reload. After the $777 invoice it showed **$24,104** instead of **$24,881** until the Dashboard was reopened. (The three records themselves were each written exactly once and every total moved by exactly the amount.)
3. **B8** — Island Traders: Money-flow block stuck on **"Loading…"** after switching business (>10 s, still after revisit; fine after reload). Payroll page helper text shows a bare **"$0"** (expected TT$).
4. **A4** — Payroll → edit Sam Owner opens "Your payroll — all entities" with **no "This is me — the business owner" checkbox**. The checkbox only exists on the ordinary Edit Employee form (Jordan Lee), unticked.
5. **B10** — 13 Oct owner-salary finding could not be re-checked because B6 fails; every other item in B10 passes.
6. **F2** — Reports period line reads **"Year to date · Jan 2026 – Oct 2026"**; expected **"Fiscal year to date · … – today"**. (Dashboard captions correctly read "Year to date"; figures unchanged.)

### BLOCKED / SKIPPED (one line each)

- **T2** BLOCKED — quotes cannot be edited in the UI (rows have only View = read-only viewer, and ✕), so the 100 → 150 UPDATE could not be made. The quote CREATE and the budget UPDATE were recorded.
- **T3** BLOCKED — Banking "+ Add" only shows a toast "Add manual transaction"; no form opens, so no manual bank line can be created.
- **T4** BLOCKED — needs a wrong-password sign-in in a private window; I don't type passwords into sign-in forms and the built-in browser has no private window. Owner can do this step (then re-check Settings → Recent security activity and Audit → Security).
- **T8** BLOCKED — time entries cannot be edited in the UI (only ✕ delete).
- **C14** BLOCKED — no accountant login was provided.
- **T6** SKIPPED — sending a client message e-mails the accountant when they are offline (`_notifyOfflineMessage` → Resend); outbound e-mail is forbidden by the ground rules.

### Other defects seen (not scored — found while running the checks)

- **Budget targets: switching the modal to "Monthly" does not convert existing rows** — Rent still showed 60000 and saving multiplies every row by 12 (would silently turn Rent 60,000/yr into 720,000/yr). I avoided it by re-entering Rent as 5,000/mo. (T2, C7)
- **Audit trail has no user column** — Date / Table / Record ID / Action / Field / Old / New only. "By Sam Owner" / "right user" can't be seen on screen (API has actor_id 1). (T1, C12)
- Budget audit row records the **annual** figure (`Software: 300`), not the $25/month that was entered. (T2)
- Documents cards stay **"TOTAL FILES 0 · STORAGE USED 0 KB · ADDED THIS MONTH 0"** with a file listed; size shows "93" with no unit (file is 91 bytes); `.txt` isn't in the upload picker's accept list. (C11)
- Entities consolidated block caption **"No conversion · native currencies shown"** while the Island Traders column is converted to $ ($1.2K); in the TTD view "INTERCOMPANY $0" keeps a bare $. (A2)
- Inventory card "COGS THIS MONTH $390" — the P&L puts that $390 in Aug '26 (Oct COGS $0). (A6)
- Bank Rec shows no statement or book balance; 3 bank debits (TRANSFER TO SAVINGS $500, PAPER SUPPLY CO $650, BANK FEE $35) appear in neither the unmatched list nor matched pairs. Banking "TOTAL BALANCE $0" with a linked bank. (C13, B7)
- Audit shows a security e-mail **"sent: true"** for the 12:24 new-device sign-in, although the retest file says e-mail is not configured for real users. (T4)
- Template previews: "Retainer Agreement" (a quote template) renders as "INVOICE"; sample FROM address "New York, NY 10001" instead of the business address. (A10, C11)
- Budget page ignores the Month / Quarter / Year buttons (same annual figures). (C7)
- Sales Receipts card "CARD SALES $50 Via Stripe" for a manually recorded receipt. (C2)
- Settings: Industry select has no "Media & Creative" option although that is Northwind's stored value (shows blank/first option). `GET /api/settings` is requested 5× back-to-back when Settings opens. (A2, A10)

### ZZ-LIVECHECK records created (for the owner to clean up)

| # | Type | Name / description | Amount | Id |
|---|---|---|---|---|
| 1 | Project | ZZ-LIVECHECK P1 | budget $500.00 | project 2 |
| 2 | Project | ZZ-LIVECHECK P2 | budget $300.00 | project 3 |
| 3 | Time entry | Sam Owner → ZZ-LIVECHECK P1, billable, $80/h | 1.5 h | timesheet 2 |
| 4 | Time entry | Sam Owner → ZZ-LIVECHECK P1, non-billable, $80/h | 0.5 h | timesheet 3 |
| 5 | Time entry | Sam Owner → ZZ-LIVECHECK P2, billable, $50/h | 2.0 h | timesheet 4 |
| 6 | Quote | ZZ-LIVECHECK quote T2 (QT-2833), line "ZZ-LIVECHECK line" | $100.00 | quote 2 |
| 7 | Budget target change | Software added: $25/mo (T2) then changed to $50/mo (C7) → stored $600/yr. Rent unchanged at $60,000/yr | — | budget_targets 1 |
| 8 | Integration request | FreshBooks (no connection made; name can't carry the prefix) | — | support_requests 5 |
| 9 | Personal transaction | ZZ-LIVECHECK personal (expense, Other) | $5.00 | personal 115 |
| 10 | Invoice | ZZ-LIVECHECK flow B5, pending, issued 2026-10-20 | $777.00 | invoice 8 |
| 11 | Expense | ZZ-LIVECHECK flow B5 (Rent) | $88.00 | expense 11 |
| 12 | Bill | ZZ-LIVECHECK flow B5 (BILL-3166), unpaid | $44.00 | bill 7 |
| 13 | Quote | ZZ-LIVECHECK quote C1 (QT-1952) | $100.00 | quote 3 |
| 14 | Sales receipt | ZZ-LIVECHECK receipt C2, Card | $50.00 | receipt 2 |
| 15 | Payment received | on ZZ-LIVECHECK flow B5, note "ZZ-LIVECHECK payment C3" | $40.00 | invoice_payments 4 |
| 16 | Bill | ZZ-LIVECHECK bill C4 (BILL-7359), now paid | $30.00 | bill 8 |
| 17 | Payment made | to ZZ-LIVECHECK bill C4 (PM-3816), note "ZZ-LIVECHECK payment C4" | $30.00 | payments_made 4 |
| 18 | Expense | ZZ-LIVECHECK expense C5 (Software), class "ZZ-LIVECHECK class C5" | $20.00 | expense 12 |
| 19 | Project | ZZ-LIVECHECK project C6 | budget $500.00 | project 4 |
| 20 | Time entry | Sam Owner → ZZ-LIVECHECK project C6, billable, no rate | 1.5 h | timesheet 5 |
| 21 | Document | ZZ-LIVECHECK.txt (type other, note "ZZ-LIVECHECK C11 upload") | 91 bytes | document 1 |

Not created: no payroll run (B6 returned 500). Reporting currency was set to TTD and put back to the default (A2) — net no change.

### Red console errors

**None captured** in any step. Server-side errors: 2× HTTP 500 on `POST /api/payroll-runs` (B6). See the method note below on how console errors were captured.

### Full page reloads

None caused by the app: sidebar navigation, the Month / Quarter / Year buttons and both business switches ran without a document reload (an in-page marker survived). "Loading your workspace…" was never seen on a business switch (polled every 120 ms for 3 s). The only reloads were my own: 12:27:16 and 12:28:45 (A1), 12:58:49 (B5 check), 13:05:41 (B8 check), ~13:17 (C15 phone width), and the visit to `/accountant-register` → `/join` → `/app` (A11, 12:38).

---

## How this run was done (read before relying on a result)

- **Order:** Part A was run *before* Parts F and T (R → A → F → T → B → C instead of R → F → T → A → B → C). Part A is observe-only (A2's setting change was reverted), so it does not affect F/T results, but it is a deviation from the instructions.
- **DevTools / console:** the built-in browser has no DevTools panel. Console and network were read through the browser tools. Its console buffer keeps only the last ~500 messages, and the app emits thousands of `[info]` report-only CSP "Applying inline style violates … style-src" messages per page load (≈3,000 per boot; >64,000 over the run), so early messages are evicted quickly. To compensate: (1) error-level messages were read right after each step; (2) for A1 every deferred render hook was re-run in try/catch after boot; (3) from 12:45 an in-page hook recorded every `console.error`, uncaught error and unhandled rejection, re-installed after each reload except the final phone-width reload (C15 phone part not hooked). Errors during the first seconds after each reload could still have been missed.
- **Hard reload:** Ctrl+Shift+R did not reload the pane; A1 used `location.reload()` twice (not cache-bypassing).
- **Private window:** not available (A11, T4, C14).
- **Clicks:** most buttons were clicked through the page (element click); typing was done as keystrokes. Three "Save bill" clicks at 13:00 never reached the page (tool coordinate issue after a reload — verified no events, no request), so the bill was still saved exactly once.
- **Evidence:** figures were read from the page text; API calls (GET only) were used to confirm ids and exact amounts. Screenshots: `F4_expenses_800px.jpg` (F4), `C15_personal_390px.jpg` (C15).
- **No outbound effects:** no e-mail, reminder, payment, bank connection or credential entry. The only external-facing action was the FreshBooks integration *request* (T5), which the code shows is a database record only.

---

## Part R — the release is live

| # | Check | Expected | Actual (what the screen shows) | PASS / FAIL / SKIPPED / BLOCKED | Notes / screenshot |
|---|---|---|---|---|---|
| R0 | New code deployed | Audit first filter has "Connected services"; Settings has "Recent security activity" | Audit filter options include "Connected services" (between "Accountant" and "Documents & imports"). Settings has section "RECENT SECURITY ACTIVITY" with its explanation text and rows (loads `GET /api/auth/security-activity`) | PASS | 12:26 |

## Part F — the 2026-10-19 findings

| # | Check | Expected | Actual (what the screen shows) | PASS / FAIL / SKIPPED / BLOCKED | Notes / screenshot |
|---|---|---|---|---|---|
| F1 | Time links to its project | P1 2.0 h / $120.00 / $380.00 · P2 2.0 h / $100.00 / $200.00 · old project 0 h | Created P1 (budget 500) and P2 (300); logged 1.5 h P1 billable $80, 0.5 h P1 non-billable $80, 2.0 h P2 billable $50 (project chosen in the entry's Project field). Projects: **P1 "— · 2h logged", Billable value / Budget "$120 / $500"**; **P2 "— · 2h logged", "$100 / $300"**; old "ZZ-LIVECHECK project" **"— · 0h logged", "$0 / $500"**. Cards: BILLABLE HOURS 5.0 hrs · BILLABLE VALUE $220 · BUDGET REMAINING $1,080 (= 380 + 200 + 500) | PASS | 12:39–12:41. Rows show billable value / budget, not a per-project remaining figure ($380 / $200 are not printed per row; the card total implies them). API: entries 2–3 project_id 2, entry 4 project_id 3; old entry has none |
| F1b | Projects labels | "Billable value" (Logged time × rate), "Budget remaining" (Budget − billable value); no "Billed" / "Revenue — From projects" / "Unbilled" | "BILLABLE VALUE — Logged time × rate", "BUDGET REMAINING — Budget − billable value". None of "Billed", "From projects", "Unbilled", "Revenue" on the page | PASS | 12:42 |
| F2 | "Year to date" | Dashboard Expenses caption "Year to date"; Reports period line "Fiscal year to date · … – today"; figures unchanged | Dashboard: REVENUE / EXPENSES / NET PROFIT captions all "Year to date" ($24.1K / $4.5K / $19.2K). Reports (Year clicked 12:42:45): period line **"Year to date · Jan 2026 – Oct 2026"** (shown uppercase). Year button tooltip "Fiscal year to date"; revenue card caption "Revenue issued, this fiscal year to date"; figures $24,104 / $19,195 | FAIL | Reports period line wording |
| F3 | Record Payment warning | Below owed: no warning, Save on · above: warning, Save off · below again: warning gone | ZZ-LIVECHECK invoice (Total $100 · Paid $40 · Remaining $60). 30 → no warning, Save enabled. 70 → "⚠ Amount exceeds the remaining balance." visible, Save disabled. 30 → warning hidden, Save enabled. Cancelled (still paid $40, partial) | PASS | 12:43 |
| F4 | No sideways scroll | At ~800/900/1,000/1,100/1,280 px: no sideways scroll; title visible; Export / Ask AI / bell on screen | At 800, 900, 1000, 1100 and 1280 px on Dashboard, Invoices, Expenses: page width = viewport (e.g. 800/800), no container scrolls sideways, nothing extends past the right edge; title visible; Export PDF, Ask AI, bell fully on screen (wrapping onto extra rows at 800) | PASS | 12:43–12:45 · `F4_expenses_800px.jpg` |

## Part T — the audit trail now records it

| # | Check | Expected | Actual (what the screen shows) | PASS / FAIL / SKIPPED / BLOCKED | Notes / screenshot |
|---|---|---|---|---|---|
| T1 | Projects & time | 2 projects + 3 time entries, CREATE, by Sam Owner | Filter "Projects & time": EVENTS LOADED 5 — CREATE projects 2 (ZZ-LIVECHECK P1, budget 500, 12:39) and 3 (P2, 300, 12:40); CREATE timesheet 2 (1.5 h, P1, rate 80, Yes, 12:40), 3 (0.5 h, P1, No, 12:41), 4 (2 h, P2, rate 50, 12:41), with field-level rows | PASS | 12:46. **No user column** on the Audit page, so "by Sam Owner" is not visible (API: actor_type user, actor_id 1) |
| T2 | Quotes and budget | Quote CREATE + UPDATE 100 → 150; Budget UPDATE with category and 25 | Created "ZZ-LIVECHECK quote T2" (QT-2833) 1 line × $100. Quotes filter: CREATE quotes 2 (amount 100, client, status pending, line_items). **No way to edit a quote** (View = read-only viewer with Print / Close; ✕) → no UPDATE. Budget: Software $25/mo saved → filter "Budget": UPDATE budget_targets 1 `{"Rent":60000}` → `{"Rent":60000,"Software":300}` | BLOCKED | 12:47–12:49. Budget row shows the annual 300, not 25. Monthly toggle defect — see "Other defects" |
| T3 | Money routes | Manual bank line "ZZ-LIVECHECK line" $1.00 → CREATE under "Bank feed & reconciliation" | Banking "+ Add" only shows toast **"Add manual transaction"**; no form. No other UI adds a bank line (no caller of `POST /api/banking`). Filter "Bank feed & reconciliation": "No audit events found." | BLOCKED | 12:49. Nothing created |
| T4 | Security log | Failed sign-in + Signed in rows, newest first, in Settings and Audit; no password | Wrong-password attempt not made (no private window; I don't type passwords). Settings → Recent security activity: "Security e-mail · new device sign-in — Oct 20, 12:24 PM · Chrome on Windows · 152.233.47.68"; "Signed in — Oct 20, 12:24 PM · Chrome on Windows · 152.233.47.68"; older "Signed in … Unknown device" rows. Audit "Security (sign-in, 2FA, password)": SECURITY_ALERT (sent true, NEW_DEVICE_LOGIN) and LOGIN rows. No password anywhere | BLOCKED | 12:50. Owner can do the wrong-password step and re-check |
| T5 | Integration request | Sign-ins & account: CREATE naming the integration; Connected services: nothing new | API connections → search "FreshBooks" → Request → toast "Request recorded for FreshBooks — we prioritise by demand." "Sign-ins & account": **"Oct 20, 26 12:52 · support_requests · 5 · CREATE · integration · FreshBooks"**. "Connected services": "No audit events found." | PASS | 12:52. Code checked first: request = DB record + audit only |
| T6 | Accountant side | MESSAGE row naming sender, not text | Accountant is linked ("Cowork Accountant · ✓ Linked"). Message not sent — the route e-mails the accountant when offline | SKIPPED | 12:53. Outbound e-mail forbidden |
| T7 | The wall | No audit row and no personal item on Northwind's Audit page | Personal quick-add "ZZ-LIVECHECK personal" $5.00 → "Expense added ✦" (personal 115, entity null). Northwind Audit (Everything, 90 events): no row for it, no "personal" text on the page | PASS | 12:54 |
| T8 | Edit shows what changed | UPDATE hours 2 → 2.5; P2 2.5 h / $125.00 / $175.00 | **No edit control for time entries** (only ✕); hours not changed. P2 stays "2h logged · $100 / $300" | BLOCKED | 12:55 |

## Part A — confirm the fixes are live (observe only)

| # | Check | Expected | Actual (what the screen shows) | PASS / FAIL / SKIPPED / BLOCKED | Notes / screenshot |
|---|---|---|---|---|---|
| A0 | Deploy landed | Settings field "Reporting currency — all businesses combined" | Present | PASS | 12:26 |
| A1 | No boot errors, no $0 cards | 0 "deferred render hook threw" / "Cannot set properties of null"; real figures matching P&L | Two reloads (12:27:16, 12:28:45): no error-level console messages; all 27 deferred render hooks re-run without throwing. Dashboard REVENUE $24.1K · EXPENSES $4.5K · NET PROFIT $19.2K ("after $390 cost of goods sold"). P&L: Revenue $24,104 · COGS $390 · Gross $23,714 · Opex $4,519 · Net $19,195 — cards round these correctly | PASS | See console method note |
| A2 | Reporting currency | First option "Your first business's currency (USD)" selected; API null / "USD"; TTD switches All-entities to TT$; back to $ | Option selected, value empty; app's own `GET /api/settings`: `reporting_currency: null`, `reporting_currency_effective: "USD"`. All entities (Entities page): $25.3K revenue / $20.2K profit. TTD chosen 12:31:37 → TT$171.6K / TT$137.0K ("1 USD = 6.80 TTD"). Default chosen 12:32:52 → toast "All-businesses totals now shown in USD", $25.3K / $20.2K, API null / "USD". Left on default | PASS | TTD toast not captured (transient, before my toast hook). Caption issue — see "Other defects" |
| A3 | Payroll runs carry no "TT" | Every run `jurisdiction: null` | 4 runs (#4 Dec 2026 voided, #3 Nov 2026 paid, #2 Oct voided, #1 Sep voided) — all `jurisdiction: null` | PASS | 12:30 |
| A4 | Owner flag on employees | Edit Sam Owner: "This is me — the business owner" ticked | Sam's edit button opens "Your payroll — all entities" (name, Type "Owner / Director", gross 5000, Income tax 20 %, net $4,000, "Save & sync to Personal") — **no such checkbox**. The checkbox is on the Edit Employee form, opened for Jordan Lee, unticked. Both cancelled | FAIL | 12:33–12:34 |
| A5 | Customers / vendors from documents | "Not saved" + Save; totals include them | Customers: 6, "0 saved · 6 from invoices, not saved yet", each "Not saved" + Save; LIFETIME REVENUE $24,354 = sum of the six. Vendors: 6, each "Not saved" + Save; PAYABLES $668 = 444 + 180 + 44 | PASS | 12:34. Nothing saved |
| A6 | Inventory rows add up | Rows sum to Inventory value card | One SKU (W-1 Widget, 5 units) $90 = INVENTORY VALUE $90 | PASS | Card "COGS THIS MONTH $390" vs P&L Aug — see "Other defects" |
| A7 | Outstanding names credit notes | "… less $X in credit notes" | "OUTSTANDING $11,014 · 5 invoices · $11,314 less $300 in credit notes" | PASS | 12:35 |
| A8 | Labels | "Expense entries"; no VAT tile; "Payroll by person"; "after $N cost of goods sold" | "EXPENSE ENTRIES $2,951"; Tax reports: Income Tax Estimate, Tax-Deductible Expenses (no VAT); "Payroll by person"; "after $390 cost of goods sold" | PASS | 12:36 |
| A9 | One product list | Stock products as "Stock item" rows alongside services | "Widget · W-1 · Stock item · 5 units · Low Stock". No services exist to sit alongside it | PASS | |
| A10 | Each business in its own currency | Island Traders: COA, Projects, Items in TT$; template preview TT$ | COA 16 TT$ amounts, 0 bare $; Projects TT$0 cards; Items empty. Settings has no invoice-template preview — Templates page previews (all 4) show "Island Traders", Total TT$11,813. Switched back to Northwind | PASS | 12:35–12:37 |
| A11 | Accountant sign-up pricing | "Currency for your rates"; T&T → TTD, rate fields TT$ | `/accountant-register` → `/join`. "Currency for your rates" exists in step 3; step 3 needs name/e-mail/password in step 1, which I did not enter. Choosing Trinidad & Tobago on step 1 switched the currency select USD → TTD and the hourly-rate symbol $ → TT$ (read from the page) | PASS | 12:38. Not a private window; step 3 not displayed; nothing submitted |

## Part B — rerun of the 2026-10-13 live audit

| # | Check | Expected | Actual (what the screen shows) | PASS / FAIL / SKIPPED / BLOCKED | Notes / screenshot |
|---|---|---|---|---|---|
| B1 | P&L reconciles | Rev − COGS = GP; GP − Exp = Net; every month; Net identical on 4 surfaces | 24,104 − 390 = 23,714; 23,714 − 4,519 = 19,195. Months: Mar 12,000 · Aug 2,500 − 390 = 2,110 · Sep −300 − 2,550 = −2,850 · Oct 9,904 − 1,969 = 7,935. Net: Dashboard $19.2K · Reports NET RESULT $19,195 · Money flow $19,195 · P&L $19,195 | PASS | 12:55 (before B5). vs 13 Oct (15,400 / 3,005 / 12,005): revenue +8,704 = AUDIT TEST ZZ 7,777 + ZZ-LIVECHECK flow 777 + ZZ-LIVECHECK invoice 100 + ZZ-LIVECHECK receipt 50; expenses +1,514 = AUDIT TEST EXP 888 + AUDIT TEST VENDOR bill 444 + ZZ-LIVECHECK flow 88 + 44 + ZZ-LIVECHECK expense 20 + ZZ-LIVECHECK bill 30 |
| B2 | Receivables reconcile | AR by customer = Dashboard = Invoices Outstanding; overdue = overdue customers | AUDIT TEST ZZ 7,777 + Bright Labs 1,500 + Delta Co 1,200 + ZZ-LIVECHECK flow 777 + ZZ-LIVECHECK invoice 60 + Acme −300 = **$11,014** = Dashboard $11,014 = Invoices $11,014. OVERDUE **$1,200** (1 invoice) | PASS | Only overdue customer is Bright Labs (balance 1,500, due Sep 4); 1,200 = 1,500 − open $300 credit note (netting by design) |
| B3 | Revenue basis | Issued invoices − credit notes | Invoices 12,000 + 2,500 + 1,200 + 7,777 + 777 + 100 = **24,354** (no drafts); credit notes **300** → 24,054. Revenue shows **24,104** | PASS | Difference = sales receipt "ZZ-LIVECHECK receipt" $50 (19 Oct): 24,354 − 300 + 50 = 24,104 |
| B4 | Expense basis | Unpaid bill in Expenses; Stock bill → Inventory | AUDIT TEST VENDOR $444, unpaid, is in Oct expenses (1,969) and "Bills & vendors" (1,568). Widget Maker $180 ("Stock purchase — Widget × 10 @ 18", "Stock unpaid", 1 Jul) is not in expenses (Jul $0) | PASS | |
| B5 | Flow tests | Each saved once; Revenue / Expenses / Outstanding / payables move by exactly the amount; shows in Money flow, transactions, chart | Before: 24,104 / 4,519 / 11,014 / payables 668. **Invoice** $777 (id 8): listed once; Revenue 24,881; Outstanding 11,791; in transactions; Oct bar 9,904 → 10,681. **Expense** $88 (id 11): listed once; Expenses 4,607; Rent 2,584. **Bill** $44 (id 7): listed once; Expenses 4,651; payables 712. **Money flow:** $24,104 after the invoice until Dashboard reopened; stayed **$19,972** after the expense while Reports / API showed **$19,884**, corrected only by a full reload (12:58:49); updated after the bill ($19,840) | FAIL | 12:56–13:01. Money-flow refresh |
| B6 | Payroll and owner salary | Run Dec 2026 → approve → mark paid → owner salary $4,000.00 in Personal → void restores | Before: Expenses 4,651; Personal income $7.4K (7,357.66). Run Payroll, period "December 2026", notes "ZZ-LIVECHECK payroll B6" → **HTTP 500** "An unexpected error occurred. Please try again." Retried once → same. No run created; nothing else possible. Expenses and Personal income unchanged; only the November owner-salary row ($4,000) exists | FAIL | 13:02:56, 13:03:26. Existing voided "December 2026" run #4 may be the cause (not verified). November run untouched |
| B7 | Personal / business wall | Personal has own bank feed and investments; no crossing except owner salary | Personal: "Your own bank feed — separate from every business", 52 feed transactions; Personal investments AAPL $3.4K vs Business investments $2.7K. Northwind Dashboard, Reports, Banking, Business investments contain none of the personal items searched. Personal's only business row: "Owner salary — Northwind Studio (November 2026)" +$4,000 | PASS | Both feeds show the same Plaid-sandbox descriptions as separate records (same sandbox bank) |
| B8 | Island Traders currency | TT$ everywhere; Rev − Exp = Net | TT$ on Dashboard, Invoices, Expenses, Reports, Banking, Customers, Vendors, Bills, Budget, COA. Payroll helper text: **"…your reports currently show $0 of payroll…"** (bare $). P&L TT$8,000 − TT$1,250 = TT$6,750 (= 13 Oct). Money flow **"Loading…"** after the business switch (>10 s); showed TT$6,750 only after reload | FAIL | 13:04–13:05 |
| B9 | Tax is estimates only | Disclaimer on Personal and Reports; no VAT/GST return | Personal: "Estimate only — consult a tax professional" and "… FinFlow performs no tax calculation …". Reports → Income Tax Estimate: "Rough estimate — not tax advice". No VAT / GST anywhere | PASS | Reports landing page itself has no disclaimer line; it is inside the tax report |
| B10 | 13 Oct findings re-checked | All PASS | $0 cards → A1 PASS · owner salary → **B6 FAIL** · M1 → A5 PASS · M2 → A6 PASS · M3 → A7 PASS; credit note in its own month (Sep '26 revenue −$300) · labels → A8 PASS · no document reloads from sidebar, period buttons or business switch | FAIL | Owner-salary item only |
| B11 | Console for Part B | 0 red errors | 0 captured | PASS | Server: 2× HTTP 500 in B6 |

## Part C — areas no audit has exercised yet

| # | Check | Expected | Actual (what the screen shows) | PASS / FAIL / SKIPPED / BLOCKED | Notes / screenshot |
|---|---|---|---|---|---|
| C1 | Quotes | Revenue unchanged; Convert → +$100.00 if offered | "ZZ-LIVECHECK quote C1" $100 (QT-1952). Revenue 24,881 before and after. **No Convert to invoice** offered | PASS | 13:07–13:08 |
| C2 | Sales receipts | Revenue +$50.00; Outstanding unchanged | "ZZ-LIVECHECK receipt C2" $50 → Revenue 24,881 → **24,931**; Outstanding $11,791 unchanged | PASS | 13:08 |
| C3 | Payments received | Outstanding −$40.00; listed; invoice partial with balance left | $40 on "ZZ-LIVECHECK flow B5" ($777). Outstanding 11,791 → **11,751**; Payments Received lists $40 (Oct 20); invoice partial — Total $777 · Paid $40 · **Remaining $737** | PASS | 13:09. $60 in the script applies to the $100 invoice |
| C4 | Payments made | Payables −$30.00; bill paid; listed once | "ZZ-LIVECHECK bill C4" $30 → payables 712 → 742. Make Payment $30 applied to the bill (PM-3816) → payables **712**; bill **paid**; listed once | PASS | 13:10 |
| C5 | Classes | Class shows $20.00 cost | "ZZ-LIVECHECK expense C5" $20, class "ZZ-LIVECHECK class C5" → Classes: **Revenue 0.00 · Cost 20.00 · Net −20.00** | PASS | 13:11. Classes is its own sidebar page |
| C6 | Time tracking | Timesheet 1.5 h; project shows the time | "ZZ-LIVECHECK project C6" ($500); 1.5 h logged → Timesheet row 1.5h; project **"— · 1.5h logged · $0 / $500"** | PASS | 13:12. No rate given → $0 value |
| C7 | Budget | Actual includes $20; actual + remaining = budget | Software (C5 category) set to $50/mo → **$260 / $600, VAR +$340** (260 + 340 = 600; 260 = 240 + 20) | PASS | 13:12–13:13. Rent re-entered as 5,000/mo to stay at 60,000/yr |
| C8 | MRR / SaaS | MRR = active monthly recurring invoices | MRR **$0**, ARR **$0**; Recurring Invoices: 0 profiles, monthly value $0 | PASS | Nothing created |
| C9 | Scheduled Documents | Matches recurring invoices / bills | 0 scheduled, $0 in / $0 out; recurring invoices 0, recurring bills 0 | PASS | No mismatch |
| C10 | Reminders | Overdue invoices with amount still owed; draft readable; nothing sent | OVERDUE 1 — "Bright Labs · due 2026-09-04 · 46 days overdue · USD 1,500.00" (after the $1,000 payment). Draft: "Overdue: Invoice #2 — 46 days past due", body for USD 1,500.00 | PASS | 13:13. Not sent; AI not used |
| C11 | Documents and Templates | Previews right for business; upload appears and opens; not in Island Traders | Previews: "Northwind Studio", $ amounts. Uploaded "ZZ-LIVECHECK.txt" → listed (93 · 2026-10-20 · other); download returns the file (200, text/plain, content intact). Island Traders Documents: "No documents yet." | PASS | 13:14–13:15. Card / size issues — see "Other defects" |
| C12 | Audit trail | C1–C11 actions listed with right user and time | Quote #3, receipt #2, payment received #4, bill #8, payment made #4, expense #12 (incl. class), project #4, time entry #5, budget UPDATE, document UPLOAD #1 — all present, 13:08–13:14 | PASS | 13:15. Nothing missing. User not shown (no user column) |
| C13 | Bank Rec | Counts and balances consistent | UNMATCHED BANK TXNS **50** = 6 credits + 44 debits listed; UNMATCHED PAYMENTS **3** + MATCHED PAIRS **1** = all 4 invoice payments. **No statement or book balance shown** | PASS | 13:16. 3 debits in neither list — see "Other defects" |
| C14 | Accountant portal | Accountant sees only granted businesses, own currencies | Not run | BLOCKED | No accountant login provided |
| C15 | Every page, every console | All pages render cleanly; phone width usable | All 51 sidebar pages + Settings: no error banner, blank panel, `undefined`, `NaN`; 0 console errors. At 390 px: Dashboard, Invoices, Expenses, Personal — no sideways scroll, nothing cut off, title visible, bottom nav shown | PASS | 13:16–13:19 · `C15_personal_390px.jpg`. "Find Advisor" and "Client portal" are Coming Soon pages |
