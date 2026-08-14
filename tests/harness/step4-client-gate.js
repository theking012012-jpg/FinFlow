'use strict';
/**
 * step4-client-gate.js — the CLIENT money-engine probe (VERIFICATION's outstanding client harness).
 * The client-side mirror of step3-gate + tz-matrix: it verifies the client figures AND their
 * viewer-independence across timezones.
 *
 *   node tests/harness/step4-client-gate.js
 *
 * HOW IT LOADS THE REAL ENGINE (not a reimplementation): it marker-slices the SHIPPED functions
 * from public/app-main.js (computeRevenue, computeExpenseBreakdown, arOutstanding, _periodWindow,
 * _fyContext) and public/finflow-api-wiring-dashboard.js (buildMonthlyArrays, updateKPIs, parseDate,
 * money) and executes them in a stubbed window/document — the SAME technique the golden-master uses.
 * These app-main copies are the runtime winners (window.computeExpenseBreakdown = computeExpenseBreakdown,
 * app-main.js:1709; no wiring override). We call the source functions on purpose — that is how a client
 * ENGINE probe differs from the jsdom-boot DOM-reader (jsdom-spike), which never calls functions.
 *
 * SEED = the shared VERIFICATION dataset (seedData.js), so expected == expected.js (the same values
 * step3-gate asserts against the server).
 *
 * VIEWER INDEPENDENCE: the whole thing runs in a child process per timezone spanning the sign
 * boundary (LA, POS west; Kolkata, London east) — same technique as finflow-dates.test.js — and the
 * parent asserts every client figure is identical across viewers. The clock INSTANT is pinned
 * (2026-07-25T16:00Z) for all viewers; only the process TZ differs, so any difference is F87.
 *
 * EXPECTATION: F87 has landed, so both checks now PASS. The probe still earns its place by being
 * able to FAIL — check 1 goes red if viewer-independence regresses (F87), check 2 goes red per viewer
 * if a client figure drifts from VERIFICATION. A probe that can't fail on the bug proves nothing (Rule 4).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SEED = require('./seedData.js');
const EXPECTED = require('./expected.js');

const ZONES = [
  { tz: 'America/Los_Angeles', label: 'UTC-7 west' },
  { tz: 'America/Port_of_Spain', label: 'UTC-4 west (owner)' },
  { tz: 'Asia/Kolkata', label: 'UTC+5:30 east' },
  { tz: 'Europe/London', label: 'UTC+1 east' },
];
const PERIODS = { may: ['month', 4], jun: ['month', 5], jul: ['month', 6], q2: ['quarter', 5], q3: ['quarter', 6], fy: ['year', null] };

// ── marker-slice a function from source by brace balance (golden-master technique) ──
function extractFn(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('not found: ' + header);
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(start, i + 1); } }
  throw new Error('unbalanced: ' + header);
}

// Pinned instant, TZ-independent. Local getMonth/getFullYear etc. still honour the process TZ —
// which is the whole point (that is where F87 lives). Only now()/new Date() are pinned.
const PINNED = Date.parse('2026-07-25T16:00:00.000Z');
class FixedDate extends Date {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return PINNED; }
}

function loadClientEngine() {
  const appMain = fs.readFileSync(ROOT + '/public/app-main.js', 'utf8');
  const dash = fs.readFileSync(ROOT + '/public/finflow-api-wiring-dashboard.js', 'utf8');
  const appParts = ['function _fyContext()', 'function _periodWindow(period, monthIdx)',
    'function computeRevenue(period, monthIdx)', 'function computeExpenseBreakdown(period, monthIdx)',
    'function arOutstanding(invoices)'].map(h => extractFn(appMain, h)).join('\n');
  const dashParts = ['function parseDate(s)', 'function money(n)',
    'function buildMonthlyArrays(invoices, expenses)', 'function updateKPIs(invoices, expenses, period)']
    .map(h => extractFn(dash, h)).join('\n');

  // Seed the client globals from the shared VERIFICATION dataset, in the shapes the loaders set.
  const win = {
    _realInvoices: SEED.INVOICES.map(i => ({ client: i.client, amount: i.amount, amount_paid: i.amount_paid, status: i.status, issue_date: i.issue_date })),
    receipts: [],                                   // VERIFICATION seed has no cash sales receipts
    _realExpenses: SEED.EXPENSES.map(e => ({ category: e.category, amount: e.amount, expense_date: e.date, ded: 'no' })),
    bills: SEED.BILLS.map(b => ({ vendor: b.vendor, amount: b.amount, amount_paid: b.amount_paid, status: b.status, issue_date: b.issue_date })),
    // B2's payment is LINKED (bill_id set) → it is a settlement, excluded from expense (the sole
    // double-count guard). Seeding it unlinked would fabricate a phantom 500 in July opex.
    paymentsMade: SEED.PAYMENTS_MADE.map(p => ({ amount: p.amount, date: p.date, bill_id: 999 })),
    payrollRuns: SEED.PAYROLL_RUNS.map(r => ({ period: r.period, run_date: r.run_date, status: r.status, lines: r.lines.map(l => ({ gross: l.gross, bonus: 0, overtime: 0 })) })),
    ownerPayroll: (() => { const o = SEED.ROSTER.find(r => r.is_owner); return o ? { gross: o.gross, fname: o.fname, lname: o.lname } : null; })(),
    payrollEmployees: SEED.ROSTER.filter(r => !r.is_owner).map(e => ({ gross: e.gross, fname: e.fname, lname: e.lname })),
    // F58 contra legs. Status kept CAPITALIZED exactly as the API stores it (server.js:2307),
    // so the client's case-insensitive compare is genuinely exercised — seeding lowercase here
    // would let a `status === 'open'` bug pass this gate and fail in production.
    creditNotes: SEED.CREDIT_NOTES.map(c => ({ amount: c.amount, date: c.date, status: c.status, customer: c.customer })),
    vendorCredits: SEED.VENDOR_CREDITS.map(v => ({ amount: v.amount, date: v.date, status: v.status, vendor: v.vendor })),
    bizHoldings: SEED.HOLDINGS.map(h => ({ ticker: h.ticker, shares: h.shares, price: h.price, costPer: h.cost_per })),
    holdings: [],
    _fyStart: 'January',
    // F87: the client engines resolve periods through window.FinFlowDates (the same module the
    // server requires). The extracted function bodies reference it; provide the real one here.
    FinFlowDates: require(ROOT + '/public/finflow-dates.js'),
  };
  const document = { getElementById: () => null };   // no #s-fy ⇒ January default
  const factory = new Function('window', 'document', 'currentPeriod', 'currentMonthIdx', 'Date',
    appParts + '\n' + dashParts + '\n; window._arOutstanding = arOutstanding; ' +
    'return { computeRevenue, computeExpenseBreakdown, arOutstanding, _periodWindow, buildMonthlyArrays, updateKPIs };');
  return { api: factory(win, document, 'year', 6, FixedDate), win };
}

// Compute every client figure — the fingerprint each viewer must agree on.
function fingerprint() {
  const { api, win } = loadClientEngine();
  const cogs = {};   // viewer-independent (all-time snapshot); from expected.js so netProfit is comparable
  for (const k of Object.keys(PERIODS)) cogs[k] = EXPECTED.COMPONENTS[k].cogs;
  const fig = {};
  for (const [k, [p, idx]] of Object.entries(PERIODS)) {
    const revenue = api.computeRevenue(p, idx);
    const opex = api.computeExpenseBreakdown(p, idx).total;
    fig[k] = { revenue, opex, netProfit: revenue - cogs[k] - opex };
  }
  const chart = api.buildMonthlyArrays(win._realInvoices, win._realExpenses);
  const kpi = {};
  for (const p of ['year', 'month', 'quarter']) {
    const r = api.updateKPIs(win._realInvoices, win._realExpenses, p);
    kpi[p] = { rev: r.rev, exp: r.exp };
  }
  return { fig, outstanding: api.arOutstanding(win._realInvoices).total, chart: { rev: chart.revByMonth, exp: chart.expByMonth }, kpi };
}

// ── CHILD: print this viewer's fingerprint ──
if (process.env.S4_CHILD) {
  try { process.stdout.write('FP=' + JSON.stringify(fingerprint())); }
  catch (e) { process.stdout.write('ERR=' + (e && e.stack ? e.stack : String(e))); }
  process.exit(0);
}

// ── PARENT ──
// F83: this gate already exits non-zero on a check FAIL (H2). --strict additionally makes the
// "a viewer produced no fingerprint" harness-error path non-zero instead of silently exit-0.
const STRICT = process.argv.includes('--strict') || process.env.STRICT === '1';
let pass = 0, fail = 0;
const A = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); } };
const flat = (obj, pre, out) => { out = out || {}; pre = pre || ''; for (const k of Object.keys(obj)) { const v = obj[k]; const key = pre ? pre + '.' + k : k; if (v && typeof v === 'object') flat(v, key, out); else out[key] = v; } return out; };

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log('  STEP 4 — CLIENT MONEY-ENGINE PROBE (real computeRevenue / computeExpenseBreakdown /');
console.log('  buildMonthlyArrays / updateKPIs, seeded from VERIFICATION, across the TZ sign boundary)');
console.log('════════════════════════════════════════════════════════════════════════════');

// Run one viewer per timezone in its own process.
const runs = ZONES.map((z) => {
  const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: z.tz, S4_CHILD: '1' }), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const m = (r.stdout || '').match(/FP=(\{[\s\S]*\})/);
  return { z, fp: m ? JSON.parse(m[1]) : null, raw: (r.stdout || '') + (r.stderr || '') };
});
for (const x of runs) console.log('  · ' + x.z.tz.padEnd(24) + '(' + x.z.label + ')' + (x.fp ? '' : '   ← NO FINGERPRINT'));
if (runs.some((x) => !x.fp)) {
  console.log('\n  A viewer produced no fingerprint (harness/extraction error) — raw tail:');
  for (const x of runs) if (!x.fp) console.log('    [' + x.z.tz + '] ' + x.raw.trim().slice(0, 600));
  console.log('\n  ' + fail + ' FAILED — cannot proceed without all four viewers.\n');
  process.exit(STRICT ? 1 : 0);   // F83: a missing-fingerprint harness error is non-zero under --strict
}

// ── 1 · VIEWER INDEPENDENCE (the F87 detector) — every figure identical across viewers ──
console.log('\n── 1 · Viewer independence — every client figure identical across the 4 timezones ──');
const flats = runs.map((x) => ({ tz: x.z.tz, f: flat(x.fp) }));
const keys = Object.keys(flats[0].f);
const viewerDependent = [];
for (const key of keys) {
  const vals = flats.map((x) => x.f[key]);
  const allSame = vals.every((v) => v === vals[0]);
  if (!allSame) viewerDependent.push({ key, vals });
}
A('all client figures are viewer-INDEPENDENT (identical across LA/POS/Kolkata/London)',
  viewerDependent.length === 0,
  viewerDependent.length === 0 ? '' : viewerDependent.length + ' figure(s) MOVE between viewers (F87) — listed below');
if (viewerDependent.length) {
  console.log('\n  ── VIEWER-DEPENDENT FIGURES (F87) — value per viewer [LA, POS, Kolkata, London] ──');
  for (const d of viewerDependent) {
    const nums = d.vals.map((v) => Number(v));
    const spread = (nums.every((n) => !isNaN(n))) ? '  (Δ max ' + (Math.max(...nums) - Math.min(...nums)) + ')' : '';
    console.log('     ' + d.key.padEnd(18) + '[' + d.vals.join(', ') + ']' + spread);
  }
}

// ── 2 · vs VERIFICATION expected (per viewer) — ONE ASSERTION PER VIEWER ──
// H2: this comparison used to compute vp/vf and only console.log() them — A() was never called,
// so a viewer at 5/18 still counted as green. Each viewer now routes through A(): a drift in any
// client figure fails the gate, naming the viewer and listing every miss.
console.log('\n── 2 · Client figures vs VERIFICATION expected (per viewer) ──');
for (const x of flats) {
  let vp = 0, vf = 0; const misses = [];
  for (const k of Object.keys(PERIODS)) {
    // F58: compare against serverFigures().revenue — the NET reported figure — NOT
    // COMPONENTS.revenue, which is now GROSS invoiced revenue before the credit-note contra.
    // Using COMPONENTS here was a FALSE PASS: with credit notes unseeded the client returned
    // gross 5,000 and the expectation also read gross 5,000, so the two agreed while both were
    // wrong (Rule 6 — agreement is not correctness).
    const checks = [['revenue', EXPECTED.serverFigures(k).revenue], ['opex', EXPECTED.PL[k].opex], ['netProfit', EXPECTED.PL[k].netProfit]];
    for (const [field, want] of checks) {
      const got = x.f['fig.' + k + '.' + field];
      if (Math.abs(got - want) < 0.005) vp++; else { vf++; misses.push(k + '.' + field + ' got ' + got + ' want ' + want); }
    }
  }
  const viewer = x.tz.split('/')[1];
  const total = vp + vf;
  A(viewer.padEnd(16) + vp + '/' + total + ' VERIFICATION figures match',
    vf === 0,
    vf ? vf + ' miss: ' + misses.join(' · ') : '');
}
console.log('     (FY revenue ' + EXPECTED.serverFigures('fy').revenue + ' & Q3 ' + EXPECTED.serverFigures('q3').revenue
  + ' EXCLUDE future-dated INV-6 — D2 client-side; FY is also NET of the F58 credit-note contra. Viewer-INDEPENDENT.)');

// H2b: signal failure through the exit code so CI/the caller can see a red run.
// H5: the old "(a FAIL on check 1 is EXPECTED…)" footnote was true only while the probe was red by
// design; F87 has landed, so a FAIL is now a real regression, not the expected state. Removed.
console.log('\n' + (fail === 0 ? '  ALL GREEN' : '  ' + fail + ' FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exitCode = fail === 0 ? 0 : 1;
