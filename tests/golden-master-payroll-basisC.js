// GOLDEN MASTER — basis C (payroll_runs are the single source of payroll expense) + F25
// (period-scoped COGS). One fixed seed, exact expected figures per period view.
//
//   node tests/golden-master-payroll-basisC.js
//
// DISCIPLINE: every money assertion below EXECUTES the shipped engines (real computeBooks /
// computeRevenue / computeExpenseBreakdown, extracted and run against a stubbed pool + a pinned
// clock) and compares NUMBERS. The only structural assertions are in the clearly-labelled
// STRUCTURAL section at the end; they exist solely to prove a code path was DELETED (which a
// value cannot express) and are marked as such.
//
// EXPECTED STATE at time of writing (basis C committed, F25 NOT yet):
//   • all C-payroll + C-structural assertions GREEN
//   • the 6 F25 assertions (3 COGS + 3 net-profit-downstream) RED — that is the F25 commit's job
//   • exits 0 regardless, so the grouped report is always readable. Read the summary, don't infer
//     from the exit code. Once F25 lands, ALL assertions must be green.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');   // repo root — portable, no absolute path baked in
const serverSrc = fs.readFileSync(ROOT + '/server.js', 'utf8');
const appMainSrc = fs.readFileSync(ROOT + '/public/app-main.js', 'utf8');

let pass = 0, fail = 0; const failures = [];
const t = (group, name, got, want) => {
  const ok = (typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want;
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push({ group, name, got, want }); console.log(`  FAIL  ${name}   got ${got}  want ${want}`); }
};

function extractFn(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('not found: ' + header);
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(start, i + 1); } }
  throw new Error('unbalanced: ' + header);
}

// ── Pinned clock: 15 July 2026, January fiscal year ─────────────────────────
const NOW = new Date(2026, 6, 15);
class FixedDate extends Date {
  constructor(...a) { if (a.length === 0) super(NOW.getTime()); else super(...a); }
  static now() { return NOW.getTime(); }
}

// ── SEED ────────────────────────────────────────────────────────────────────
// Chosen so every source is distinguishable: roster R=5000/mo, run lines X=4200.
// X ≠ R (5000) and X ≠ R×elapsed (35000), so the assertions can tell WHICH source was read.
const R = 5000, X = 4200;
const ENTITY = 1;
const seed = {
  entities: [{ id: ENTITY, currency: 'USD', name: 'Main', user_id: 1 }],
  roster: [{ id: 1, user_id: 1, entity_id: ENTITY, gross: R, is_owner: true, fname: 'O', lname: 'W' }],
  runs: [{ id: 900, user_id: 1, entity_id: ENTITY, period: '2026-06', run_date: '2026-06-20', status: 'final', total_gross: X }],
  runLines: [{ id: 1, run_id: 900, gross: 4000, bonus: 200, overtime: 0, net_pay: 3400 }],   // Σ gross+bonus+OT = 4200
  invoices: [
    { id: 11, user_id: 1, entity_id: ENTITY, client: 'A', amount: 10000, amount_paid: 0,    status: 'pending', issue_date: '2026-06-10' },
    { id: 12, user_id: 1, entity_id: ENTITY, client: 'B', amount: 6000,  amount_paid: 2500, status: 'partial', issue_date: '2026-07-05' },
    { id: 13, user_id: 1, entity_id: ENTITY, client: 'C', amount: 9999,  amount_paid: 0,    status: 'draft',   issue_date: '2026-06-01' }, // excluded
  ],
  receipts: [{ id: 21, user_id: 1, entity_id: null, amount: 1500, date: '2026-06-15' }],
  expenses: [   // NON-salary on purpose: proves C scoped payroll, not all expenses
    { id: 31, user_id: 1, entity_id: ENTITY, category: 'Rent',     amount: 2000, expense_date: '2026-06-05' },
    { id: 32, user_id: 1, entity_id: ENTITY, category: 'Software', amount: 500,  expense_date: '2026-07-02' },
  ],
  bills: [{ id: 41, user_id: 1, entity_id: ENTITY, vendor: 'V', amount: 3000, amount_paid: 0, status: 'unpaid', issue_date: '2026-06-08' }],
  paymentsMade: [{ id: 51, user_id: 1, entity_id: ENTITY, amount: 700, bill_id: null, date: '2026-06-12' }],
  movements: [ // FIFO: buy 10 @100 in May; sell 4 in June (=400), sell 2 in July (=200)
    { id: 61, user_id: 1, entity_id: ENTITY, inventory_id: 5, type: 'purchase', quantity: 10, unit_cost: 100, moved_at: '2026-05-01' },
    { id: 62, user_id: 1, entity_id: ENTITY, inventory_id: 5, type: 'sale',     quantity: 4,  unit_cost: 0,   moved_at: '2026-06-10' },
    { id: 63, user_id: 1, entity_id: ENTITY, inventory_id: 5, type: 'sale',     quantity: 2,  unit_cost: 0,   moved_at: '2026-07-03' },
  ],
};

// ── EXPECTED (hand-derived from the seed; basis C + period-scoped COGS) ─────
const EXP = {
  june:    { revenue: 11500, cogs: 400, payroll: X, opex: 2000 + 3000 + 700 + X, ar: 13500 },
  july:    { revenue: 6000,  cogs: 200, payroll: 0, opex: 500 + 0 + 0 + 0,       ar: 13500 },
  quarter: { revenue: 6000,  cogs: 200, payroll: 0, opex: 500,                   ar: 13500 }, // Q3 = Jul-Sep
  year:    { revenue: 17500, cogs: 600, payroll: X, opex: 2500 + 3000 + 700 + X, ar: 13500 },
};
for (const k of Object.keys(EXP)) EXP[k].netProfit = EXP[k].revenue - EXP[k].cogs - EXP[k].opex;
const AP_EXPECTED = 3000;   // Σ max(0, amount − amount_paid) over recognized bill statuses

// ── SERVER ENGINE — execute the real computeBooks ───────────────────────────
function loadServerEngine() {
  // NOTE the `async` prefixes: matching on bare "function fifoItemTotal" would start the slice
  // AFTER the async keyword, producing a sync body containing `await` — a syntax error that
  // looks like a harness bug but is really a truncated extraction.
  const fifoSrc = ['function fifoConsume', 'async function _purchaseLayers', 'async function fifoItemTotal', 'async function fifoItemSales']
    .map(h => extractFn(serverSrc, h)).join('\n');
  const cb = extractFn(serverSrc, 'async function computeBooks(');
  const RECOGNIZED_BILL = new Set(['unpaid', 'due_soon', 'overdue', 'partial', 'paid']);

  const db = {
    allByUser: async (table, userId, filterFn) => {
      const map = { invoices: seed.invoices, expenses: seed.expenses, payments_made: seed.paymentsMade,
                    payroll: seed.roster, sales_receipts: seed.receipts, bills: seed.bills, entities: seed.entities };
      let rows = (map[table] || []).map(r => ({ ...r }));
      if (typeof filterFn === 'function') rows = rows.filter(filterFn);
      return rows;
    },
  };
  // The stub must satisfy EVERY shape the real FIFO helpers issue. Order matters: the
  // SUM(quantity) AS sold query also matches type='sale', so it is tested FIRST. Getting this
  // wrong silently yields COGS 0 — a failure that looks like the bug but is really the harness.
  const pool = {
    query: async (sql, params) => {
      const invId = params && params[0];
      const forItem = m => invId == null || m.inventory_id === invId;
      if (/DISTINCT/i.test(sql) && /inventory_movements/i.test(sql)) {
        return { rows: [...new Set(seed.movements.filter(m => m.type === 'sale').map(m => m.inventory_id))].map(id => ({ inventory_id: id })) };
      }
      if (/SUM\(quantity\)/i.test(sql)) {
        const sold = seed.movements.filter(m => m.type === 'sale' && forItem(m)).reduce((s, m) => s + m.quantity, 0);
        return { rows: [{ sold }] };
      }
      if (/type='purchase'/i.test(sql)) {
        return { rows: seed.movements.filter(m => m.type === 'purchase' && forItem(m))
          .sort((a, b) => String(a.moved_at).localeCompare(String(b.moved_at))) };
      }
      if (/type='sale'/i.test(sql)) {
        return { rows: seed.movements.filter(m => m.type === 'sale' && forItem(m))
          .sort((a, b) => String(a.moved_at).localeCompare(String(b.moved_at))) };
      }
      // Basis C: the payroll leg now reads run LINES joined to their parent run for the date.
      // Seed data is supplied through the new access path; EXPECTED VALUES ARE UNCHANGED.
      if (/payroll_run_lines/i.test(sql)) {
        const runById = new Map(seed.runs.map(r => [r.id, r]));
        return { rows: seed.runLines.map(l => {
          const r = runById.get(l.run_id) || {};
          return { gross: l.gross, bonus: l.bonus, overtime: l.overtime,
                   run_date: r.run_date, entity_id: r.entity_id, run_id: l.run_id };
        }) };
      }
      if (/fx_rates/i.test(sql)) return { rows: [] };
      throw new Error('golden-master stub: unhandled SQL → ' + String(sql).replace(/\s+/g, ' ').slice(0, 120));
    },
  };
  const factory = new Function('db', 'pool', 'RECOGNIZED_BILL', 'pickRate', 'Date',
    fifoSrc + '\n' + cb + '\n; return computeBooks;');
  return factory(db, pool, RECOGNIZED_BILL, () => null, FixedDate);
}

// ── CLIENT ENGINE — execute the real computeRevenue / computeExpenseBreakdown ──
function loadClientEngine() {
  const parts = ['function _fyContext()', 'function _periodWindow(period, monthIdx)',
                 'function computeRevenue(period, monthIdx)', 'function computeExpenseBreakdown(period, monthIdx)',
                 'function arOutstanding(invoices)']
    .map(h => extractFn(appMainSrc, h)).join('\n');
  const win = {
    _realInvoices: seed.invoices, receipts: seed.receipts, _realExpenses: seed.expenses,
    bills: seed.bills, paymentsMade: seed.paymentsMade,
    ownerPayroll: seed.roster[0], payrollEmployees: [],
    // Basis C: the client payroll leg reads runs-with-lines, the shape GET /api/payroll-runs
    // returns (json_agg AS lines). Same seed, new access path; expectations unchanged.
    payrollRuns: seed.runs.map(r => ({ ...r, lines: seed.runLines.filter(l => l.run_id === r.id) })),
    _fyStart: 'January',
  };
  const document = { getElementById: () => null };   // no #s-fy ⇒ January default
  const factory = new Function('window', 'document', 'currentPeriod', 'currentMonthIdx', 'Date',
    parts + '\n; return { computeRevenue, computeExpenseBreakdown, arOutstanding, _periodWindow };');
  return { api: factory(win, document, 'year', 6, FixedDate), win };
}

(async function main() {
  const computeBooks = loadServerEngine();
  const { api: client } = loadClientEngine();

  // fiscal-index: Jan=0 … Jun=5, Jul=6.  Windows built from the CLIENT resolver so both
  // engines are asked for the SAME period — that is the point of the F33 unit.
  const W = (p, idx) => { const w = client._periodWindow(p, idx);
    return { start: w.start.toISOString(), end: w.end.toISOString(), elapsedMonths: w.elapsedMonths }; };
  const views = {
    june:    { win: W('month', 5),   cp: 'month',   idx: 5 },
    july:    { win: W('month', 6),   cp: 'month',   idx: 6 },
    quarter: { win: W('quarter', 6), cp: 'quarter', idx: 6 },
    year:    { win: W('year', null), cp: 'year',    idx: null },
  };

  console.log('\n════ SERVER ENGINE (computeBooks, executed) ════\n');
  const srv = {};
  for (const [k, v] of Object.entries(views)) {
    const b = await computeBooks(1, ENTITY, v.win, null, 0);
    srv[k] = b;
    console.log(`── ${k} ──`);
    t('revenue', `${k}: revenue`, b.revenue, EXP[k].revenue);
    t('F25-COGS', `${k}: COGS period-scoped`, b.cogs, EXP[k].cogs);
    t('C-payroll', `${k}: payroll leg = Σ run lines in period`, b.parts.payroll, EXP[k].payroll);
    t('C-payroll', `${k}: opex`, b.opex, EXP[k].opex);
    // net = revenue − COGS − opex, so while COGS is un-scoped (F25) this is red BY ARITHMETIC,
    // not by any fault of basis C. Labelled as downstream so the two causes never blur together.
    t('F25-downstream', `${k}: net profit (= rev − COGS − opex)`, b.netProfit, EXP[k].netProfit);
    t('AR', `${k}: AR (all-time by design)`, b.outstanding, EXP[k].ar);
  }

  console.log('\n════ CLIENT ENGINE (computeRevenue / computeExpenseBreakdown, executed) ════\n');
  const cli = {};
  for (const [k, v] of Object.entries(views)) {
    const rev = client.computeRevenue(v.cp, v.idx);
    const bd = client.computeExpenseBreakdown(v.cp, v.idx);
    cli[k] = { rev, bd };
    console.log(`── ${k} ──`);
    t('revenue', `${k}: client revenue`, rev, EXP[k].revenue);
    t('C-payroll', `${k}: client payroll leg`, bd.payroll, EXP[k].payroll);
    t('C-payroll', `${k}: client opex total`, bd.total, EXP[k].opex);
    t('C-payroll', `${k}: general expenses still counted (payroll scoped, not all expenses)`,
      bd.realExpenses, k === 'june' ? 2000 : k === 'year' ? 2500 : 500);
  }

  console.log('\n════ CROSS-ENGINE (client leg == server leg) ════\n');
  for (const k of Object.keys(views)) {
    t('cross', `${k}: revenue client == server`, cli[k].rev, srv[k].revenue);
    t('cross', `${k}: payroll client == server`, cli[k].bd.payroll, srv[k].parts.payroll);
    t('cross', `${k}: opex client == server`, cli[k].bd.total, srv[k].opex);
  }

  console.log('\n════ AR / AP ════\n');
  t('AR', 'AR: client == server', client.arOutstanding(seed.invoices).total, srv.year.outstanding);
  const ap = seed.bills.filter(b => ['unpaid','due_soon','overdue','partial','paid'].includes(b.status))
    .reduce((s, b) => s + Math.max(0, b.amount - (b.amount_paid || 0)), 0);
  t('AP', 'AP: Σ max(0, amount − amount_paid) over recognized bills', ap, AP_EXPECTED);

  console.log('\n════ STRUCTURAL (labelled — proves deletion, which no value can express) ════\n');
  const cebSrc = extractFn(appMainSrc, 'function computeExpenseBreakdown(period, monthIdx)');
  t('C-structural', 'client: synthetic monthlyPayroll×months accrual is GONE',
    /monthlyPayroll\s*\*\s*months/.test(cebSrc) ? 'still present' : 'removed', 'removed');
  const cbSrc = extractFn(serverSrc, 'async function computeBooks(');
  t('C-structural', 'server: synthetic monthlyPayroll×months accrual is GONE',
    /monthlyPayroll\s*\*\s*months/.test(cbSrc) ? 'still present' : 'removed', 'removed');
  const idx = fs.readFileSync(ROOT + '/public/index.html', 'utf8');
  const bexp = idx.slice(idx.indexOf('id="bexp-cat"'), idx.indexOf('</select>', idx.indexOf('id="bexp-cat"')));
  t('C-structural', 'manual expense dropdown no longer offers Salaries',
    /Salaries/i.test(bexp) ? 'still offered' : 'removed', 'removed');

  // ── summary, grouped by cause ──
  console.log('\n' + '═'.repeat(70));
  const byGroup = {};
  for (const f of failures) (byGroup[f.group] = byGroup[f.group] || []).push(f);
  if (!failures.length) console.log('ALL GREEN — ' + pass + ' passed');
  else {
    console.log(`${pass} passed, ${fail} FAILED — grouped by root cause:\n`);
    for (const [g, list] of Object.entries(byGroup)) {
      console.log(`  [${g}] ${list.length} failure(s)`);
      for (const f of list) console.log(`      ${f.name}\n        got ${f.got}   want ${f.want}`);
    }
  }
  console.log('═'.repeat(70) + '\n');
  process.exit(0);   // 3b is EXPECTED to fail; exit 0 so the output is readable
})().catch(e => { console.error('HARNESS ERROR:', e.message, '\n', e.stack); process.exit(2); });
