'use strict';
/**
 * verify-journal-dashboard-parity.js — N20 dashboard parity: the CLIENT P&L mirror now includes the
 * posted-manual-journal leg, so the dashboard KPIs (computeRevenue / computeExpenseBreakdown) and the
 * overview chart (buildMonthlyArrays) agree with the server computeBooks / P&L / GL once a journal is
 * posted. Before this fix the client dropped journals entirely (server top-line revenue 50390 vs
 * dashboard 45390 in prod) — this probe reproduces that gap and proves it is closed.
 *
 *   node tests/harness/verify-journal-dashboard-parity.js
 *
 * HOW IT LOADS THE REAL ENGINE (not a reimplementation): it marker-slices the SHIPPED functions from
 * public/app-main.js (_fyContext, _periodWindow, _jLineType, _journalPnL, computeRevenue,
 * computeExpenseBreakdown) and public/finflow-api-wiring-dashboard.js (buildMonthlyArrays) and runs
 * them in a stubbed window — the SAME technique as step4-client-gate.js.
 *
 * DISCRIMINATING (Rule 4): set FF_SRC_ROOT to a checkout WITHOUT the fix and every journal assertion
 * goes red (computeRevenue == baseline, journalExpense undefined, chart month missing the journal).
 */

const fs = require('fs');
const path = require('path');
const ROOT = process.env.FF_SRC_ROOT || path.resolve(__dirname, '..', '..');

function extractFn(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('not found: ' + header);
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(start, i + 1); } }
  throw new Error('unbalanced: ' + header);
}

// Pin "now" to 2026-07-25 so FY2026 (January start) is the active window and the seeded June
// journals/invoice fall inside it (before today), matching how the server windows the books.
const PINNED = Date.parse('2026-07-25T16:00:00.000Z');
class FixedDate extends Date { constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); } static now() { return PINNED; } }

// ── Seed: one issued invoice (baseline revenue 1000 in June) + four journals ──
function freshJournals() {
  return [
    // Posted INCOME JE: Dr Checking(1010) 300 / Cr Service Revenue(4000) 300  → +300 revenue
    { date: '2026-06-10', status: 'Posted', lines: [{ code: '1010', debit: 300, credit: 0 }, { code: '4000', debit: 0, credit: 300 }] },
    // Posted EXPENSE JE: Dr Rent(5100) 100 / Cr Checking(1010) 100            → +100 opex
    { date: '2026-06-12', status: 'Posted', lines: [{ code: '5100', debit: 100, credit: 0 }, { code: '1010', debit: 0, credit: 100 }] },
    // DRAFT income JE (must be ignored — not in the GL)
    { date: '2026-06-11', status: 'Draft',  lines: [{ code: '1010', debit: 500, credit: 0 }, { code: '4000', debit: 0, credit: 500 }] },
    // Posted but UNTYPEABLE code (server aborts GL posting ⇒ contributes 0 everywhere)
    { date: '2026-06-13', status: 'Posted', lines: [{ code: 'XYZ',  debit: 50,  credit: 0 }, { code: '1010', debit: 0, credit: 50 }] },
  ];
}

function loadEngine(journals) {
  const appMain = fs.readFileSync(ROOT + '/public/app-main.js', 'utf8');
  const dash = fs.readFileSync(ROOT + '/public/finflow-api-wiring-dashboard.js', 'utf8');
  // Pre-fix sources lack _jLineType/_journalPnL — tolerate their absence so the probe still RUNS
  // (and then fails the value assertions) rather than throwing an extraction error.
  const optional = h => { try { return extractFn(appMain, h); } catch (_) { return ''; } };
  const appParts = [
    extractFn(appMain, 'function _fyContext()'),
    extractFn(appMain, 'function _periodWindow(period, monthIdx)'),
    optional('function _jLineType(code)'),
    optional('function _journalPnL(w)'),
    extractFn(appMain, 'function computeRevenue(period, monthIdx)'),
    extractFn(appMain, 'function computeExpenseBreakdown(period, monthIdx)'),
  ].join('\n');
  const dashParts = extractFn(dash, 'function buildMonthlyArrays(invoices, expenses)');
  const win = {
    _realInvoices: [{ client: 'Acme', amount: 1000, status: 'paid', issue_date: '2026-06-15' }],
    receipts: [], _realExpenses: [], bills: [], paymentsMade: [], payrollRuns: [],
    ownerPayroll: null, payrollEmployees: [], creditNotes: [], vendorCredits: [],
    _journals: journals,
    FinFlowDates: require(ROOT + '/public/finflow-dates.js'),
  };
  const document = { getElementById: () => null };
  const factory = new Function('window', 'document', 'currentPeriod', 'currentMonthIdx', 'Date',
    appParts + '\n' + dashParts +
    '\n; if (typeof _jLineType === "function") window._jLineType = _jLineType;' +
    '\n  if (typeof _journalPnL === "function") window._journalPnL = _journalPnL;' +
    '\n return { computeRevenue, computeExpenseBreakdown, buildMonthlyArrays };');
  return { api: factory(win, document, 'year', 6, FixedDate), win };
}

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;

console.log('\n' + '='.repeat(78) + '\n  N20 — client dashboard P&L mirror includes posted journals (SRC=' + ROOT + ')\n' + '='.repeat(78) + '\n');

// ── 1 · KPI mirrors (year) ──
{
  const { api } = loadEngine(freshJournals());
  const rev = api.computeRevenue('year');
  A('computeRevenue includes posted income JE (1000 inv + 300 JE = 1300)', near(rev, 1300), 'rev=' + rev);
  const bd = api.computeExpenseBreakdown('year');
  A('computeExpenseBreakdown.total includes posted expense JE (0 + 100 = 100)', near(bd.total, 100), 'total=' + bd.total);
  A('computeExpenseBreakdown.journalExpense == 100', near(bd.journalExpense, 100), 'journalExpense=' + bd.journalExpense);
  A('draft income JE (500) is EXCLUDED from revenue', near(rev, 1300), 'rev=' + rev);
  A('untypeable posted JE contributes 0 (not counted)', near(rev, 1300) && near(bd.journalExpense, 100), 'rev=' + rev + ' jexp=' + bd.journalExpense);
}

// ── 2 · Overview chart (buildMonthlyArrays) — June bucket (index 5, Jan FY) ──
{
  const { api, win } = loadEngine(freshJournals());
  const chart = api.buildMonthlyArrays(win._realInvoices, win._realExpenses);
  A('chart revByMonth[Jun] = invoice 1000 + income JE 300 = 1300', near(chart.revByMonth[5], 1300), 'jun=' + chart.revByMonth[5] + ' full=' + JSON.stringify(chart.revByMonth));
  A('chart expByMonth[Jun] = expense JE 100', near(chart.expByMonth[5], 100), 'jun=' + chart.expByMonth[5] + ' full=' + JSON.stringify(chart.expByMonth));
  const revSum = chart.revByMonth.reduce((s, x) => s + x, 0), expSum = chart.expByMonth.reduce((s, x) => s + x, 0);
  A('chart revenue total ties to computeRevenue (1300)', near(revSum, 1300), 'sum=' + revSum);
  A('chart expense total ties to computeExpenseBreakdown (100)', near(expSum, 100), 'sum=' + expSum);
}

// ── 3 · Reversal gate: flipping the income JE Posted→Draft drops it from the P&L ──
{
  const js = freshJournals();
  js[0].status = 'Draft';   // reverse the +300 income JE
  const { api } = loadEngine(js);
  const rev = api.computeRevenue('year');
  A('Posted→Draft income JE reverses out (revenue back to 1000)', near(rev, 1000), 'rev=' + rev);
}

console.log('\n' + '-'.repeat(78));
console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N20 client dashboard parity)'));
console.log('-'.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
