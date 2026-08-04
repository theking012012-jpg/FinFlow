#!/usr/bin/env node
'use strict';
/**
 * f128-reports-canonical-source.js — the Reports modal reports the CANONICAL figures.
 *
 *   node tests/harness/f128-reports-canonical-source.js
 *
 * WHAT WAS WRONG. `window.generateReport` (finflow-api-wiring-extra.js — the RUNTIME WINNER; the
 * app-main.js:5559 copy is shadowed and dead, F128) recomputed its own money:
 *     revenue  = invoices.filter(i => i.status === 'paid')      ← PRE-F32 paid-only basis
 *     expTotal = Σ expenses                                     ← no bills, no payroll, no contras
 * both unwindowed. So the Reports page disagreed with the dashboard, the server and /books.
 *
 * WHAT THIS PROVES. The modal's figures are now the SAME VALUES the dashboard reads, because they
 * come from the same functions: window.computeRevenue(period) and window.computeExpenseBreakdown
 * (period). The probe runs the REAL generateReport body from the wiring source against the REAL
 * engines from app-main.js, seeded with the VERIFICATION dataset, and compares the rendered figures
 * to `expected.js` — the hand-supplied oracle, NOT the other engine (Rule 6).
 *
 * ⚠️ RULE 4 — THIS SEED DISCRIMINATES HARD, AND THAT IS DELIBERATE.
 *   canonical FY revenue  8,800   ·   paid-only FY revenue  1,000   (only INV-1 is `paid`)
 *   canonical FY opex     9,100   ·   expenses-only FY      1,600
 * Every wrong implementation lands on a different number, so a green run identifies WHICH source
 * was read, not merely that some number appeared.
 *
 * WHAT IS NOT PROVED. The DOM is stubbed and no browser renders it; `fetch` is stubbed to serve the
 * seeded invoice list to the outstanding leg. The money engines and the report body are real source.
 * step 4 separately gates computeRevenue / computeExpenseBreakdown against VERIFICATION across four
 * timezones, so this probe deliberately does not re-assert those — it asserts the DELEGATION.
 *
 * Read-only: reads two source files, no DB, no network, no writes.
 */

const fs = require('fs');
const path = require('path');
require('./clock.js');   // pin the clock so the fiscal window matches the seed (the F110 guard runs here too)

const ROOT = path.resolve(__dirname, '../..');
const APP = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const EXTRA = fs.readFileSync(path.join(ROOT, 'public/finflow-api-wiring-extra.js'), 'utf8');
const EXPECTED = require('./expected.js');
const D = require('./seedData.js');

let pass = 0, fail = 0;
const A = (name, got, want, note) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else {
    fail++;
    console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) +
      '\n          want ' + JSON.stringify(want) + (note ? '\n          (' + note + ')' : ''));
  }
};

function spanFrom(src, openLine, label) {
  const at = src.indexOf(openLine);
  if (at < 0) throw new Error(`[f128] span not found in ${label}: ${openLine} — probe is stale, fix the probe.`);
  let depth = 0;
  for (let j = src.indexOf('{', at + openLine.length - 1); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  throw new Error(`[f128] unbalanced braces for ${openLine} in ${label}`);
}

// ── Seed the client stores exactly as the app's loaders would ──────────────────────────────
// Straight from tests/harness/seedData.js, so this probe and the gates read ONE dataset.
function seedWindow() {
  return {
    _realInvoices: D.INVOICES.map(i => ({ id: i.key, amount: i.amount, status: i.status,
                                          issue_date: i.issue_date, amount_paid: i.amount_paid || 0 })),
    _realExpenses: D.EXPENSES.map(x => ({ amount: x.amount, category: x.category, expense_date: x.date })),
    bills:         D.BILLS.map(b => ({ amount: b.amount, status: b.status, issue_date: b.issue_date })),
    payrollRuns:   D.PAYROLL_RUNS.map(r => ({ run_date: r.run_date, status: r.status, lines: r.lines })),
    creditNotes:   (D.CREDIT_NOTES  || []).map(c => ({ amount: c.amount, status: c.status, date: c.date })),
    vendorCredits: (D.VENDOR_CREDITS || []).map(v => ({ amount: v.amount, status: v.status, date: v.date })),
    // ⚠️ SEED FIDELITY — `bill_id` is load-bearing and the field is `bill`, not `bill_ref`.
    // VERIFICATION.md: "the B2 payment MUST carry bill_id pointing at B2 … seeding it unlinked
    // would make it an orphan disbursement, add a second 500 to July opex, and manufacture a
    // double-count that does not exist." The first cut of this probe read `p.bill_ref`, which does
    // not exist, so every payment became an orphan and FY opex read 9,600 against the correct
    // 9,100 — the exact self-inflicted failure that warning describes, reproduced in a test.
    paymentsMade:  (D.PAYMENTS_MADE || []).map(p => ({ amount: p.amount, date: p.date, bill_id: p.bill ? 1 : null })),
    receipts: [], payrollEmployees: [], ownerPayroll: null,
  };
}

/** The real client engines from app-main.js, with the fiscal calendar pinned to the seed. */
function loadEngines(win) {
  const body = [
    spanFrom(APP, 'function _fyContext()', 'app-main.js'),
    spanFrom(APP, 'function _periodWindow(period, monthIdx)', 'app-main.js'),
    spanFrom(APP, 'function computeExpenseBreakdown(period, monthIdx)', 'app-main.js'),
    spanFrom(APP, 'function computeRevenue(period, monthIdx)', 'app-main.js'),
  ].join('\n');
  const document = { getElementById: () => null };   // no #s-fy ⇒ January fiscal year, as seeded
  // The canonical date resolver the engines call (F87 phase 1). Same module the server requires,
  // so the probe cannot drift from the window computeBooks uses.
  win.FinFlowDates = require(path.join(ROOT, 'public/finflow-dates.js'));
  return new Function('window', 'document', 'currentPeriod', 'currentMonthIdx',
    body + '\n; return { computeRevenue, computeExpenseBreakdown };')(win, document, 'year', 6);
}

/**
 * Execute the REAL generateReport body. `mutate` hands back the PRE-FIX source for the control.
 * Returns the money strings the modal actually wrote into #rpt-body.
 */
async function runReport(win, mutate) {
  mutate = mutate || (s => s);
  const els = {};
  const document = {
    getElementById: (id) => els[id] || (els[id] = { id, textContent: '', innerHTML: '', classList: { add() {}, remove() {} } }),
    createElement: () => ({ id: '', className: '', innerHTML: '', classList: { add() {}, remove() {} } }),
    body: { appendChild() {} },
  };
  // `fetch` serves only the invoice list the outstanding leg asks for. Any other path is a probe
  // bug and must throw rather than resolve to something plausible.
  const fetchStub = async (p) => {
    if (String(p).startsWith('/api/invoices')) {
      return { ok: true, json: async () => win._realInvoices };
    }
    throw new Error('[f128] unexpected fetch in the report path: ' + p);
  };
  const src = mutate(spanFrom(EXTRA, 'window.generateReport = async function (name)', 'wiring-extra.js'));
  const run = new Function('window', 'document', 'fetch', 'currentPeriod', 'S', 'e', 'money', 'api',
    'var out = null;\n' + src.replace(/^window\.generateReport\s*=\s*/, 'var _gen = ') +
    ';\n return _gen;'
  )(win, document, fetchStub, 'year',
    n => '$' + (parseFloat(n) || 0),                       // S(): stand-in, symbol irrelevant here
    s => String(s == null ? '' : s),                       // e(): escape
    n => '$' + (parseFloat(n) || 0),                       // module-level money() fallback
    async (m, p) => { const r = await fetchStub(p); return r.json(); }
  );
  await run('Profit & Loss Statement');
  return els['rpt-body'] ? els['rpt-body'].innerHTML : '';
}

/**
 * Execute the REAL window.renderReports body (the Reports PAGE, not the modal) and return the
 * three metric-card values it wrote. `querySelectorAll` is stubbed to hand back the same node
 * lists the page has, so the assertions are on what the real code assigned to real card slots.
 */
async function runRenderReports(win, mutate) {
  mutate = mutate || (s => s);
  const mk = () => ({ textContent: '', innerHTML: '', className: '' });
  const mcs = [mk(), mk(), mk()];
  const chgs = [mk(), mk(), mk()];
  const document = {
    querySelectorAll: (sel) => (sel.indexOf('.mc-val') >= 0 ? mcs : chgs),
    getElementById: () => null,
  };
  const src = mutate(spanFrom(EXTRA, 'window.renderReports = async function ()', 'wiring-extra.js'));
  const fn = new Function('window', 'document', 'currentPeriod', 'money', 'apiGetStatus',
    '_origRenderReports', '_reportsSetState',
    src.replace(/^window\.renderReports\s*=\s*/, 'var _r = ') + ';\n return _r;'
  )(
    win, document, 'year',
    n => '$' + (parseFloat(n) || 0),
    async (p) => {                                        // the two real fetches this body makes
      if (String(p).startsWith('/api/invoices')) return win._realInvoices;
      if (String(p).startsWith('/api/expenses')) return win._realExpenses;
      throw new Error('[f128] unexpected fetch in renderReports: ' + p);
    },
    null, () => {}
  );
  await fn();
  const num = s => parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
  return { count: mcs[0].textContent, revenue: num(mcs[1].textContent), profit: num(mcs[2].textContent),
           caption: chgs[1].textContent };
}

/**
 * Pull the four card figures out of the rendered HTML, in order.
 * Uses the CAPTURE GROUP, not the whole match — the first cut stripped non-digits from the entire
 * matched string, so `font-size:16px` leaked in and every figure came back as -16. A parser that
 * silently returns a plausible-looking number is worse than one that throws, so this one asserts
 * its own arity.
 */
function figuresFrom(html) {
  const re = /font-size:16px;font-weight:600;[^"]*">([^<]+)</g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(parseFloat(m[1].replace(/[^0-9.\-]/g, '')));
  if (out.length !== 4) throw new Error(`[f128] expected 4 card figures, parsed ${out.length} — probe is stale, fix the probe.`);
  return out;
}

(async () => {
  console.log('\n' + '='.repeat(78));
  console.log('  F128 — REPORTS MODAL SOURCES THE CANONICAL ENGINES (executed)');
  console.log('='.repeat(78));

  const win = seedWindow();
  const eng = loadEngines(win);
  win.computeRevenue = eng.computeRevenue;
  win.computeExpenseBreakdown = eng.computeExpenseBreakdown;
  win._arOutstanding = null;                        // exercise the documented fallback path
  win._cogsTotal = EXPECTED.serverFigures('fy').cogs;   // period-scoped COGS, as _loadPeriodCOGS sets it
  win._fmtMoneyNative = null;

  // ── 0 · the oracle, and the numbers the bugs would produce ──
  console.log('\n-- 0 - canonical figures vs what each wrong source would give --');
  const canonRev = eng.computeRevenue('year');
  const canonExp = eng.computeExpenseBreakdown('year').total;
  A('canonical FY revenue == expected.js', canonRev, EXPECTED.serverFigures('fy').revenue,
    'this is the engine step 4 already gates; asserted here only to anchor the comparison');
  const paidOnly = win._realInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const expOnly  = win._realExpenses.reduce((s, x) => s + x.amount, 0);
  console.log(`     canonical revenue ${canonRev}   ·  PAID-ONLY would give ${paidOnly}`);
  console.log(`     canonical opex    ${canonExp}   ·  EXPENSES-ONLY would give ${expOnly}`);
  A('the bug values genuinely DIFFER from the canonical ones (Rule 4)',
    paidOnly !== canonRev && expOnly !== canonExp, true);

  // ── 1 · the fixed report renders the canonical figures ──
  console.log('\n-- 1 - the report modal reports what the dashboard reports --');
  const html = await runReport(win);
  const [rev, exp, profit] = figuresFrom(html);
  A('report revenue == computeRevenue(period)',            rev,    canonRev, `paid-only would give ${paidOnly}`);
  A('report expenses == computeExpenseBreakdown().total',  exp,    canonExp, `expenses-only would give ${expOnly}`);
  const canonCogs = EXPECTED.serverFigures('fy').cogs;
  A('report net profit == revenue − COGS − expenses (the dashboard composition)',
    profit, Math.round((canonRev - canonCogs - canonExp) * 100) / 100,
    'omitting COGS gives ' + Math.round((canonRev - canonExp) * 100) / 100 + ' — the dashboard says ' + EXPECTED.serverFigures('fy').netProfit);
  A('…and that IS the canonical net profit', profit, EXPECTED.serverFigures('fy').netProfit);
  A('the period is STATED on the card, not left implicit', /issued, this fiscal year/.test(html), true);
  A('expenses card says it includes bills and payroll',    /incl\. bills &amp; payroll/.test(html), true);

  // ── 2 · FAILURE PATH, EXECUTED — the pre-fix body, rebuilt and run ──
  console.log('\n-- 2 - failure path: the PRE-FIX paid-only recompute, executed --');
  const PRE_REV = 'const revenue  = window.computeRevenue(period);';
  const PRE_EXP = 'const expTotal = breakdown.total;';
  let reverted = 0;
  const oldHtml = await runReport(win, s => {
    if (!s.includes(PRE_REV) || !s.includes(PRE_EXP)) {
      throw new Error('[f128] delegation lines not found — probe is stale, fix the probe.');
    }
    reverted++;
    return s
      .replace(PRE_REV, 'const revenue  = (await api("GET","/api/invoices")).filter(i => (i.status||"").toLowerCase() === "paid").reduce((s2,i) => s2 + (i.amount||0), 0);')
      .replace(PRE_EXP, 'const expTotal = (window._realExpenses||[]).reduce((s2,x) => s2 + (x.amount||0), 0);');
  });
  const [oldRev, oldExp] = figuresFrom(oldHtml);
  A('pre-fix body was restored (control is real)', reverted, 1);
  A('PRE-FIX revenue is the paid-only figure',  oldRev, paidOnly, `canonical is ${canonRev}`);
  A('PRE-FIX expenses omit bills and payroll',  oldExp, expOnly,  `canonical is ${canonExp}`);
  A('…so the fix genuinely moved both figures', oldRev !== rev && oldExp !== exp, true);

  // ══════════════════════════════════════════════════════════════════════════════════════
  // 2b · THE REPORTS PAGE ITSELF — window.renderReports, the surface BEHIND the modal.
  // Same defect, written separately, so fixing only the modal would have left the page
  // contradicting the modal launched from it. Rule 1: this override is a WRAPPER (it calls
  // _origRenderReports first, then overwrites the cards), so these are the runtime values.
  // ══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n-- 2b - the Reports PAGE cards report the canonical figures too --');
  {
    const cards = await runRenderReports(win);
    A('page revenue card == computeRevenue(period)', cards.revenue, canonRev, `paid-only would give ${paidOnly}`);
    A('page net-profit card == revenue − COGS − expenses', cards.profit,
      Math.round((canonRev - canonCogs - canonExp) * 100) / 100);
    A('page card == MODAL card (page and modal cannot disagree)', cards.revenue, rev);
    A('the caption no longer says "Paid revenue"', /Paid revenue/.test(cards.caption), false,
      'a stale caption on a corrected figure is its own defect');
    A('…it names the basis and the period', cards.caption, 'Revenue issued, this fiscal year');

    console.log('\n-- 2c - failure path: the PRE-FIX page recompute, executed --');
    const oldCards = await runRenderReports(win, s => {
      const PRE = 'const revenue  = window.computeRevenue(period);';
      if (!s.includes(PRE)) throw new Error('[f128] page delegation line not found — probe is stale, fix the probe.');
      return s
        .replace(PRE, 'const revenue  = invoices.filter(i => (i.status||"").toLowerCase() === "paid").reduce((s2,i) => s2 + (i.amount||0), 0);')
        .replace('const expTotal = window.computeExpenseBreakdown(period).total;',
                 'const expTotal = expenses.reduce((s2,x) => s2 + (x.amount||0), 0);')
        .replace('const profit   = revenue - cogs - expTotal;', 'const profit   = revenue - expTotal;');
    });
    A('PRE-FIX page revenue is the paid-only figure', oldCards.revenue, paidOnly, `canonical is ${canonRev}`);
    A('PRE-FIX page profit omits bills, payroll and COGS', oldCards.profit,
      Math.round((paidOnly - expOnly) * 100) / 100);
    A('…so the page fix moved the figures too', oldCards.revenue !== cards.revenue, true);
  }

  // ── 3 · STRUCTURAL (Rule 5, labelled) — the runtime winner is the one that was fixed ──
  console.log('\n-- 3 - STRUCTURAL: Rule 1 — the fixed copy is the runtime winner --');
  A('STRUCTURAL: wiring-extra assigns window.generateReport (replacement, no _orig)',
    /window\.generateReport\s*=\s*async function/.test(EXTRA) && !/_origGenerateReport/.test(EXTRA), true);
  A('STRUCTURAL: wiring-extra wraps renderReports (_orig saved AND called ⇒ wrapper, not replacement)',
    /_origRenderReports\s*=/.test(EXTRA) && /if \(_origRenderReports\) _origRenderReports\(\)/.test(EXTRA), true);
  for (const [label, open] of [['generateReport', 'window.generateReport = async function (name)'],
                               ['renderReports',  'window.renderReports = async function ()']]) {
    A(`STRUCTURAL: no paid-only revenue filter survives in ${label}`,
      /status\s*\|\|\s*''\)\.toLowerCase\(\)\s*===\s*'paid'|status\?\.toLowerCase\(\)\s*===\s*'paid'/
        .test(spanFrom(EXTRA, open, 'wiring-extra.js')), false);
  }

  console.log('\n' + '-'.repeat(78));
  console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed'
                         : '  ' + fail + ' FAILED, ' + pass + ' passed');
  console.log('-'.repeat(78) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error('\n[f128] PROBE ERROR — ' + (err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
