'use strict';
/**
 * seedData.js — VERIFICATION.md's dataset, transcribed. Data only, no I/O.
 *
 * Kept separate from the insert logic so the numbers can be read against VERIFICATION.md
 * side by side without wading through SQL. EVERY value here comes from that document. None
 * was chosen here; where the document under-specifies, the choice is marked ⬜ CHOSEN with
 * its rationale, so an invented value can never masquerade as a specified one.
 *
 * DATES ARE EXPLICIT EVERYWHERE — never a database default. Postgres NOW() is the real wall
 * clock and is NOT affected by the pinned node clock (Rule 10; the gap is currently ~2 days
 * and grows). Any row relying on `DEFAULT NOW()` would drift out of its period over time.
 */

// The pinned "today", as a local YYYY-MM-DD. Must match clock.js.
const TODAY_LOCAL = '2026-07-25';

// ── Entity ───────────────────────────────────────────────────────────────────
// VERIFICATION Environment: "Single entity, currency USD".
const ENTITY = { name: 'FinFlow Test Co', currency: 'USD' };

// ── Customers (VERIFICATION § Customers) ─────────────────────────────────────
// Invoices associate to a customer by the `client` TEXT field (server.js:890), not a foreign
// key, so the names here must match the invoices' `client` exactly.
const CUSTOMERS = [
  { key: 'A', company: 'Customer A', fname: 'Customer', lname: 'A', email: 'a@test.local' },
  { key: 'B', company: 'Customer B', fname: 'Customer', lname: 'B', email: 'b@test.local' },
];

// ── Invoices (VERIFICATION § Invoices) ───────────────────────────────────────
// ACCRUAL, ISSUE-BASED. Recognised: pending / overdue / partial / paid. draft excluded.
const INVOICES = [
  { key: 'INV-1', issue_date: '2026-05-10', amount: 1000, status: 'paid',    amount_paid: 1000, client: 'Customer A' },
  { key: 'INV-2', issue_date: '2026-06-15', amount: 2000, status: 'partial', amount_paid: 500,  client: 'Customer A' },
  { key: 'INV-3', issue_date: '2026-06-20', amount: 3000, status: 'pending', amount_paid: 0,    client: 'Customer B' },
  { key: 'INV-4', issue_date: '2026-06-25', amount: 9999, status: 'draft',   amount_paid: 0,    client: 'Customer A' },
  { key: 'INV-5', issue_date: '2026-07-05', amount: 4000, status: 'overdue', amount_paid: 0,    client: 'Customer B' },
];

// ── Payment events (VERIFICATION § Payment events) ───────────────────────────
// Money IN settles AR via invoice_payments (typed table, explicit payment_date).
const INVOICE_PAYMENTS = [
  { invoice: 'INV-1', date: '2026-05-15', amount: 1000 },
  { invoice: 'INV-2', date: '2026-06-20', amount: 500 },
];

// Money OUT. ⚠️ B2's payment MUST carry bill_id — server.js:4111 calls the bill_id-IS-NULL
// predicate "the SOLE double-count guard". Seeding it unlinked would add a phantom 500 to July
// opex and fabricate a decision-1 violation that does not exist. The seed exercises the guard,
// it does not bypass it. (The fact that the UI cannot set this field is F84 — a product defect,
// not something the seed should imitate.)
const PAYMENTS_MADE = [
  { bill: 'B2', date: '2026-07-05', amount: 500, vendor: 'Vendor Two', method: 'Bank Transfer' },
];

// ── Inventory — FIFO (VERIFICATION § Inventory) ──────────────────────────────
// ⬜ CHOSEN: a single SKU. The seed's layer/sale table implies one item (layers are consumed in
// a single FIFO chain); it does not name one.
const INVENTORY_ITEM = { sku: 'TEST-SKU-1', name: 'Test Widget', units: 5, max_units: 100, cost: 200 };

const PURCHASES = [
  { key: 'P0', date: '2025-11-01', qty: 5,  unit_cost: 50 },
  { key: 'P1', date: '2026-04-01', qty: 4,  unit_cost: 100 },
  { key: 'P2', date: '2026-04-15', qty: 10, unit_cost: 200 },
];
// S2/S3 quantities changed 2→1 and 3→4 so that adjacent-period COGS values DIFFER
// (May 400 · Jun 200 · Jul 800). They were both 400 before, which masks a one-month shift
// exactly as equal rent amounts did — and COGS is the leg where F25 already hid once,
// having been fixed for revenue but not here. FY COGS (1,400) and all-time (1,650) are
// unchanged, so A7.8 and every FY row hold.
const SALES = [
  { key: 'S0', date: '2025-12-05', qty: 5, expect_cogs: 250 },
  { key: 'S1', date: '2026-05-20', qty: 4, expect_cogs: 400 },
  { key: 'S2', date: '2026-06-10', qty: 1, expect_cogs: 200 },
  { key: 'S3', date: '2026-07-12', qty: 4, expect_cogs: 800 },
];

// ── Manual expenses (VERIFICATION § Manual expenses) ─────────────────────────
// July deliberately has NO rent — a phantom accrual shows immediately.
// Rent DIFFERS month to month (600 / 650) so a one-month shift changes the number. Equal
// adjacent amounts mask it perfectly: May's rent leaves for April while June's arrives, and
// the total still reads correct (Rule 4). Software is 100 rather than 150 so the FY manual
// total stays 1,600 and May's opex stays 600 — which keeps May's net profit at EXACTLY ZERO,
// the only check that exercises zero-vs-empty rendering.
const EXPENSES = [
  { date: '2026-05-01', category: 'Rent',      amount: 600, description: 'Rent May' },
  { date: '2026-06-01', category: 'Rent',      amount: 650, description: 'Rent June' },
  { date: '2026-06-10', category: 'Software',  amount: 100, description: 'Software June' },
  { date: '2026-07-03', category: 'Marketing', amount: 250, description: 'Marketing July' },
];

// ── Payroll (VERIFICATION § Payroll) ─────────────────────────────────────────
// Roster: 2 employees, 5,000/month TOTAL. Under basis C the roster is a template and must
// contribute ZERO. Split 3,000 + 2,000 — ⬜ CHOSEN: the document gives only the total. Chosen
// so that neither employee's salary equals any run total (4,200 / 3,300 / 1,100) or any other
// seeded figure, per Rule 4's corollary: a value must identify its own source.
const ROSTER = [
  { fname: 'Emp', lname: 'One', gross: 3000, is_owner: true,  role: 'Owner' },
  { fname: 'Emp', lname: 'Two', gross: 2000, is_owner: false, role: 'Staff' },
];

// ⬜ CHOSEN (two points, both under-specified by VERIFICATION):
//   1. Per-line split — the document gives Σ lines only. One line per run, gross = Σ. Neutral
//      for every Part A figure, which reads Σ(gross+bonus+overtime) regardless of line count.
//   2. total_gross header — set EQUAL to Σ lines. Rule 12 notes header and lines are stored
//      independently and a divergence is a FINDING; VERIFICATION specifies no divergence test,
//      so the neutral choice is agreement. If they ever disagree in a run, that is real.
const PAYROLL_RUNS = [
  { key: 'R1', period: '2026-06', run_date: '2026-06-30', status: 'approved', lines: [{ gross: 4200 }] },
  { key: 'R2', period: '2026-07', run_date: '2026-07-15', status: 'draft',    lines: [{ gross: 3300 }] },
  { key: 'R3', period: '2026-07', run_date: '2026-07-20', status: 'paid',     lines: [{ gross: 1100 }] },
];

// ── Bills / AP (VERIFICATION § Bills / AP) ───────────────────────────────────
const BILLS = [
  { key: 'B1', issue_date: '2026-06-05', amount: 800, status: 'unpaid', amount_paid: 0,   vendor: 'Vendor One' },
  { key: 'B2', issue_date: '2026-07-01', amount: 500, status: 'paid',   amount_paid: 500, vendor: 'Vendor Two' },
];

// ── Investments / holdings (VERIFICATION § Investments) ──────────────────────
// Prices are supplied here and NEVER fetched — the network is blocked, and the live path goes
// to CoinGecko/Finnhub (server.js:4676, 4697).
//
// Seeded as BUSINESS holdings (entity_id set). Not a free choice: the dashboard Investments KPI
// reads `window.bizHoldings` (finflow-api-wiring-dashboard.js:228), and GET /api/holdings scopes
// business = "entity_id === active entity", personal = "entity_id IS NULL" (server.js:1377-1381).
// Seeding these as personal would leave the KPI reading 0 and report a FAIL that is ours, not
// the product's.
const HOLDINGS = [
  { ticker: 'TESTCO',   name: 'Test Co',   asset_type: 'Stock',  shares: 100, price: 50,  cost_per: 50 },
  { ticker: 'TESTCOIN', name: 'Test Coin', asset_type: 'Crypto', shares: 10,  price: 100, cost_per: 100 },
];

// ── Expected totals, for the gate's arithmetic self-check ────────────────────
// Transcribed from VERIFICATION § EXPECTED VALUES. These are NOT asserted against the app here
// (that is step 3) — the step-2 gate only proves the SEED matches the document.
const EXPECTED = {
  invoiceCount: 5,
  invoiceTotal: 1000 + 2000 + 3000 + 9999 + 4000,
  arOutstanding: 8500,          // Σ max(0, amount − amount_paid) over recognised (draft excluded)
  customerBalances: { A: 1500, B: 7000 },
  expenseCount: 4,
  expenseTotal: 1600,
  billCount: 2,
  apOutstanding: 800,
  payrollRunCount: 3,
  payrollLineTotal: 4200 + 3300 + 1100,
  movementCount: PURCHASES.length + SALES.length,
  holdingsValue: 6000,
  rosterMonthly: 5000,
  invoicePaymentTotal: 1500,
  paymentsMadeTotal: 500,
};

module.exports = {
  TODAY_LOCAL, ENTITY, CUSTOMERS, INVOICES, INVOICE_PAYMENTS, PAYMENTS_MADE,
  INVENTORY_ITEM, PURCHASES, SALES, EXPENSES, ROSTER, PAYROLL_RUNS, BILLS, HOLDINGS,
  EXPECTED,
};
