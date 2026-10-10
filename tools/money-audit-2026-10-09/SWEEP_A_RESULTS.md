# Whole-app sweep — Business A (A1–A21) — SCRATCH run, 2026-10-09

Seeded dataset A1–A21 through the REAL routes on a throwaway Postgres (pinned clock 2026-10-09,
`tools/money-audit-2026-10-09/sweep-businessA.js`), read every figure through the real report
endpoints, compared to the "Expected value of every figure" table in the shared sheet. Scratch only;
production untouched. All 21 rows seeded with zero SEED-FAIL/ERR.

## Server-figure cross-check — MATCHES the sheet exactly (independently-derived expected values, Rule 6)

| Page / Report | Figure | Expected | Measured |
|---|---|---|---|
| Dashboard · Year | Rev / Exp / Net | 2,140 / 5,060 / −2,960 | 2,140 / 5,060 / −2,960 ✓ |
| Dashboard · Month (Oct) | Rev / Exp / Net | 1,140 / 2,600 / −1,500 | 1,140 / 2,600 / −1,500 ✓ |
| Dashboard · Month (Sep) | Rev / Exp / Net | 1,000 / 2,460 / −1,460 | 1,000 / 2,460 / −1,460 ✓ |
| Dashboard | Outstanding / Overdue | 2,047 / 1,697 | 2,047 / 1,697 ✓ |
| Dashboard · EUR display | Rev / Exp / Net / Outstanding | €1,926 / €4,554 / −€2,664 / €1,842.30 | identical ✓ |
| Report · P&L (Year) | Rev / COGS / Gross / Opex / Net | 2,140 / 40 / 2,100 / 5,060 / −2,960 | identical ✓ |
| Report · Balance Sheet | Cash / AR / Inventory / Total assets | −1,975 / 2,047 / 60 / 132 | identical ✓ |
| Report · Balance Sheet | AP / Payroll liab / Total liab | 315 / 2,000 / 2,315 | identical ✓ |
| Report · Balance Sheet | Equity | −2,183 | −2,183 ✓ |
| Report · Cash Flow | In | 870 | 870 ✓ |
| Report · AR | Total / Acme / Old Client / Overdue | 2,047 / 1,270 / 777 / 1,697 | identical ✓ |
| Report · Income Tax Estimate | Taxable (today's rule) | 1,610 | 1,610 ✓ |
| COGS (Year) | Total / units | 40 / 8 | 40 / 8 ✓ |
| Inventory | Widget on hand | 12 | 12 ✓ |
| Report · Payroll Summary | Gross / Net / Runs | 4,000 / 3,600 / 2 | 4,000 / 3,600 / 2 ✓ |
| Cash-flow forecast | Starting cash | −1,975 | −1,975 ✓ |

## Defect-caused mismatches (sheet value is CORRECT; the app is wrong) — not sheet corrections

- **M16** (cash-flow omits inventory purchases) — CONFIRMED in this dataset. Cash-Flow report
  Out = **2,745** vs expected **2,845**; Net = **−1,875** vs **−1,975**. Understated by exactly 100 =
  the A18 stock-in (20 @ 5). Balance-sheet cash is correct at −1,975, so it is specifically the
  cash-flow *report* that drops the stock purchase. (Re-confirms frozen M16.)
- **M7** (forecast has no payroll) — CONFIRMED. `starting_cash` correct at −1,975, but the forecast
  JSON contains no payroll item at all (no 2,000 week-1 outflow the sheet expects). (Re-confirms M7.)

## Sheet corrections
None found so far: every expected value checked against a server endpoint was correct.

## Still to read — CLIENT-rendered figures (Phase B, jsdom)
These are read off the browser, not a server endpoint, and are where the client-mirror M-items would
diverge: Sales by Customer report (Acme 1,600 / Beta 300 / unattributed 240), dashboard NATIVE path
(vs the server figures above), Invoices page (Billed/Collected/%), Expenses page (largest / tax
deductible), the 4 expense bars + overview chart bars, cash card In/Out/Net, Sales Receipts / Credit
Notes / Vendors / Payments Made page cards, Budget actual, Reminders, Entities, and the CSV/PDF
exports. Pending.
