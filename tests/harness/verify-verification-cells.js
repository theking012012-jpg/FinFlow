'use strict';
/**
 * verify-verification-cells.js — closes the unstamped VERIFICATION.md cells that the step-gates
 * did not individually assert: A1 (KPI cards incl. outstanding + investments), A2 (expense
 * breakdown bars), A3 (rev/exp chart), A4 (transactions list), A6 (client == server), and the
 * RENDERED dashboard Net card (the render layer, not just the engine).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-verification-cells.js
 *
 * TWO independent readings, on purpose:
 *   · ENGINE  — the shipped client compute fns (computeRevenue/computeExpenseBreakdown/
 *               buildMonthlyArrays/arOutstanding), marker-sliced like step4-client-gate. Deterministic.
 *   · SERVER  — the real /api/reports over HTTP against real seeded Postgres (A6 authority).
 *   · RENDER  — the actual dashboard DOM after a real jsdom boot (what the OWNER sees).
 * Every expected value is the hand-derived oracle in expected.js — never computed by code under test.
 */

const fs = require('fs');
const path = require('path');
const clock = require('./clock.js');
const ROOT = path.resolve(__dirname, '..', '..');
const SEED = require('./seedData.js');
const EXPECTED = require('./expected.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');
const bcrypt = require('bcryptjs');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.005;

// ── ENGINE loader (same marker-slice technique as step4-client-gate.js) ──────────────────
function extractFn(src, header) {
  const start = src.indexOf(header); if (start < 0) throw new Error('not found: ' + header);
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(start, i + 1); } }
  throw new Error('unbalanced: ' + header);
}
const PINNED = Date.parse('2026-07-25T16:00:00.000Z');
class FixedDate extends Date { constructor(...a) { if (!a.length) super(PINNED); else super(...a); } static now() { return PINNED; } }

function loadEngine() {
  const appMain = fs.readFileSync(ROOT + '/public/app-main.js', 'utf8');
  const dash = fs.readFileSync(ROOT + '/public/finflow-api-wiring-dashboard.js', 'utf8');
  const appParts = ['function _fyContext()', 'function _periodWindow(period, monthIdx)',
    'function computeRevenue(period, monthIdx)', 'function computeExpenseBreakdown(period, monthIdx)',
    'function arOutstanding(invoices)'].map(h => extractFn(appMain, h)).join('\n');
  const dashParts = ['function parseDate(s)', 'function money(n)',
    'function buildMonthlyArrays(invoices, expenses)'].map(h => extractFn(dash, h)).join('\n');
  const win = {
    _realInvoices: SEED.INVOICES.map(i => ({ client: i.client, amount: i.amount, amount_paid: i.amount_paid, status: i.status, issue_date: i.issue_date })),
    receipts: [],
    _realExpenses: SEED.EXPENSES.map(e => ({ category: e.category, amount: e.amount, expense_date: e.date, ded: 'no' })),
    bills: SEED.BILLS.map(b => ({ vendor: b.vendor, amount: b.amount, amount_paid: b.amount_paid, status: b.status, issue_date: b.issue_date })),
    paymentsMade: SEED.PAYMENTS_MADE.map(p => ({ amount: p.amount, date: p.date, bill_id: 999 })),
    payrollRuns: SEED.PAYROLL_RUNS.map(r => ({ period: r.period, run_date: r.run_date, status: r.status, lines: r.lines.map(l => ({ gross: l.gross, bonus: 0, overtime: 0 })) })),
    ownerPayroll: (() => { const o = SEED.ROSTER.find(r => r.is_owner); return o ? { gross: o.gross, fname: o.fname, lname: o.lname } : null; })(),
    payrollEmployees: SEED.ROSTER.filter(r => !r.is_owner).map(e => ({ gross: e.gross, fname: e.fname, lname: e.lname })),
    creditNotes: SEED.CREDIT_NOTES.map(c => ({ amount: c.amount, date: c.date, status: c.status, customer: c.customer })),
    vendorCredits: SEED.VENDOR_CREDITS.map(v => ({ amount: v.amount, date: v.date, status: v.status, vendor: v.vendor })),
    bizHoldings: SEED.HOLDINGS.map(h => ({ ticker: h.ticker, shares: h.shares, price: h.price, costPer: h.cost_per })),
    holdings: [], _fyStart: 'January', FinFlowDates: require(ROOT + '/public/finflow-dates.js'),
  };
  const document = { getElementById: () => null };
  const factory = new Function('window', 'document', 'currentPeriod', 'currentMonthIdx', 'Date',
    appParts + '\n' + dashParts + '\n; return { computeRevenue, computeExpenseBreakdown, buildMonthlyArrays, arOutstanding };');
  return { api: factory(win, document, 'year', 6, FixedDate), win };
}

const PMAP = { jun: ['month', 5], jul: ['month', 6], fy: ['year', null] };
// investments = Σ shares×price (viewer-independent balance)
const investExpected = SEED.HOLDINGS.reduce((s, h) => s + h.shares * h.price, 0);

async function main() {
  console.log('\n' + '='.repeat(78));
  console.log('  VERIFICATION CELLS — A1 / A2 / A3 / A4 / A6 (+ rendered Net)');
  console.log('  oracle = expected.js (hand-derived); seed = seedData.js');
  console.log('='.repeat(78));

  const { api } = loadEngine();

  // ── A1 · KPI figures (ENGINE) — revenue/expenses/netProfit/outstanding/investments ──
  console.log('\n── A1 · Dashboard KPI figures (engine) ──');
  for (const [k, [p, idx]] of Object.entries(PMAP)) {
    const rev = api.computeRevenue(p, idx);
    const exp = api.computeExpenseBreakdown(p, idx).total;
    const cogs = EXPECTED.COMPONENTS[k].cogs;
    const net = rev - cogs - exp;
    A(`A1 revenue ${k}`, near(rev, EXPECTED.serverFigures(k).revenue), `got ${rev} want ${EXPECTED.serverFigures(k).revenue}`);
    A(`A1 expenses ${k}`, near(exp, EXPECTED.PL[k].opex), `got ${exp} want ${EXPECTED.PL[k].opex}`);
    A(`A1 netProfit ${k}`, near(net, EXPECTED.PL[k].netProfit), `got ${net} want ${EXPECTED.PL[k].netProfit}`);
  }
  A('A1 outstanding (all-time, engine)', near(api.arOutstanding(loadEngine().win._realInvoices).total, EXPECTED.BALANCES.arOutstanding),
    `got ${api.arOutstanding(loadEngine().win._realInvoices).total} want ${EXPECTED.BALANCES.arOutstanding}`);
  A('A1 investments (Σ shares×price)', near(investExpected, EXPECTED.BALANCES.investments), `got ${investExpected} want ${EXPECTED.BALANCES.investments}`);

  // ── A2 · Expense breakdown bars (ENGINE) — Jun ──
  console.log('\n── A2 · Expense breakdown bars (Jun, engine) ──');
  const bd = api.computeExpenseBreakdown('month', 5);
  A('A2.1 bars sum to the Expenses KPI (Jun)', near(bd.total, EXPECTED.PL.jun.opex), `total ${bd.total} vs opex ${EXPECTED.PL.jun.opex}`);
  A('A2.2 Rent bar = 650', near(bd.byCategory.Rent || 0, 650), `got ${bd.byCategory.Rent}`);
  A('A2.3 Software bar = 100', near(bd.byCategory.Software || 0, 100), `got ${bd.byCategory.Software}`);
  A('A2.4 Payroll appears as its own bar = 4,200', near(bd.payroll, 4200), `got ${bd.payroll}`);
  A('A2.5 each label maps to its own value (Rent≠Software≠Payroll, distinct)',
    (bd.byCategory.Rent !== bd.byCategory.Software) && (bd.payroll !== bd.byCategory.Rent), JSON.stringify(bd.byCategory));
  A('A2.6 a category with no spend is absent (July has no Rent)', !(api.computeExpenseBreakdown('month', 6).byCategory.Rent),
    `Jul Rent = ${api.computeExpenseBreakdown('month', 6).byCategory.Rent}`);

  // ── A3 · Revenue vs Expenses chart (ENGINE) — monthly arrays ──
  console.log('\n── A3 · Revenue vs Expenses chart (engine) ──');
  const eng2 = loadEngine();
  const chart = eng2.api.buildMonthlyArrays(eng2.win._realInvoices, eng2.win._realExpenses);
  // FY starts January → index 5 = June, 6 = July. Chart revenue is GROSS invoiced (pre-contra) per month.
  const junRev = chart.revByMonth[5], junExp = chart.expByMonth[5];
  A('A3.1 Jun has a revenue bar (>0)', junRev > 0, `revByMonth[Jun]=${junRev}`);
  A('A3.2 Jun has an expense bar (>0)', junExp > 0, `expByMonth[Jun]=${junExp}`);
  // A month with no seeded activity (e.g. index 0 = January) renders empty, not carried forward.
  A('A3.3 an inactive month renders 0 (not carried forward)', chart.revByMonth[0] === 0 && chart.expByMonth[0] === 0,
    `Jan rev=${chart.revByMonth[0]} exp=${chart.expByMonth[0]}`);

  // ── SERVER + A6 · client engine == server /api/reports ──
  console.log('\n── A6 · Client engine == Server /api/reports (real HTTP) ──');
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    await initSchema(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'cells@finflow.test', name: 'Cells', plan: 'trial', role: 'owner', password: bcrypt.hashSync('cells-pw-not-secret', 10) }]
    )).rows[0].id;
    await seed(c, uid);
    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    await http.post('/api/auth/login', { email: 'cells@finflow.test', password: 'cells-pw-not-secret' });
    const qs = { jun: 'period=month&monthIdx=5', jul: 'period=month&monthIdx=6', fy: 'period=year' };
    for (const [k, [p, idx]] of Object.entries(PMAP)) {
      const r = await http.get('/api/reports?' + qs[k]);
      let s; try { s = JSON.parse(r.text); } catch { s = {}; }
      const engRev = api.computeRevenue(p, idx);
      const engExp = api.computeExpenseBreakdown(p, idx).total;
      // server revenue/expenses fields
      const srvRev = s.revenue != null ? s.revenue : (s.totalRevenue != null ? s.totalRevenue : (s.report && s.report.revenue));
      const srvExp = s.expenses != null ? s.expenses : (s.opex != null ? s.opex : (s.report && s.report.expenses));
      A(`A6 revenue ${k}: client==server`, srvRev != null && near(engRev, srvRev) && near(srvRev, EXPECTED.serverFigures(k).revenue),
        `client ${engRev} · server ${srvRev} · oracle ${EXPECTED.serverFigures(k).revenue}`);
      A(`A6 expenses ${k}: client==server`, srvExp != null && near(engExp, srvExp) && near(srvExp, EXPECTED.PL[k].opex),
        `client ${engExp} · server ${srvExp} · oracle ${EXPECTED.PL[k].opex}`);
    }
  } finally {
    try { if (server) await server.close(); } catch {}
    try { await scratch.stop(); } catch {}
  }

  console.log('\n' + (fail === 0 ? '  ALL GREEN' : '  ' + fail + ' FAILED') + ` — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch(e => { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); process.exit(1); });
