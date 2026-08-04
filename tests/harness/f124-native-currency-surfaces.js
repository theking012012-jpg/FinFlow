#!/usr/bin/env node
'use strict';
/**
 * f124-native-currency-surfaces.js — display-currency consistency on the three F124 surfaces.
 *
 *   node tests/harness/f124-native-currency-surfaces.js
 *
 * THE RULE BEING TESTED. A money figure's SYMBOL must name the currency the VALUE is actually in.
 * Two ways to break it, both live before this fix:
 *   · a hardcoded '$' — wrong for any entity whose currency is not USD;
 *   · `activeCurrency` stamped on a figure nobody converted — the F34/F59/F70 defect.
 * So the probe runs every surface with the entity on TTD and the display currency on EUR, where
 * '$', 'TT$' and '€' are three DIFFERENT strings (Rule 4): a hardcoded symbol, a correct native
 * symbol and a display symbol can never be confused for one another.
 *
 * WHAT IS EXECUTED, NOT GREPPED. Real `renderScenarioChart` / `renderMRRChart` / `updateScenario`
 * from public/index.html and real `_applyConvertedChart` / `updateCharts` / `buildCashChart` from
 * public/app-main.js, run against a recording `Chart` and a stub DOM. The chart LIBRARY is stubbed;
 * every money function is real source. Assertions are on returned strings and on the dataset arrays
 * the real code wrote (Rule 5).
 *
 * ⚠️ SECTION 3 IS THE ONE THAT MATTERS MOST. It executes `_applyConvertedChart`, which — proven
 * separately, and by execution — had NEVER RUN in the shipped app: it guarded on `window.charts`,
 * and `charts` is `let charts = {}` (app-main.js:1598), a top-level `let`, which binds in the
 * script scope and never appears on the global object. Section 3 asserts the overlay actually
 * writes the converted series now, and section 3c is the Rule-14 control: restore the
 * `window.charts` read and the overlay silently does nothing again.
 *
 * Read-only: reads two source files, no DB, no network, no writes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const APP = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const IDX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
const A = (name, got, want, bugWould) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else {
    fail++;
    console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) +
      '\n          want ' + JSON.stringify(want) +
      (bugWould ? '\n          (' + bugWould + ')' : ''));
  }
};

/** Verbatim contiguous span, closed by brace counting (Rule 5 corollary). */
function spanFrom(src, openLine, label) {
  const at = src.indexOf(openLine);
  if (at < 0) throw new Error(`[f124] span not found in ${label}: ${openLine} — probe is stale, fix the probe.`);
  let depth = 0;
  for (let j = src.indexOf('{', at + openLine.length - 1); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  throw new Error(`[f124] unbalanced braces for ${openLine} in ${label}`);
}
const app = l => spanFrom(APP, l, 'app-main.js');
const idx = l => spanFrom(IDX, l, 'index.html');

// ── Shared stub environment ────────────────────────────────────────────────────────────────
const CURRENCIES = { USD: { symbol: '$' }, EUR: { symbol: '€' }, TTD: { symbol: 'TT$' } };

function makeDom(store) {
  const gradient = { addColorStop() {} };
  const ctx2d = { createLinearGradient: () => gradient };
  return {
    getElementById: (id) => {
      if (id === 's-cents') return { checked: false };
      if (!store[id]) store[id] = { id, textContent: '', innerHTML: '', value: store.__values?.[id] ?? '0',
                                    offsetWidth: 400, offsetParent: {}, getContext: () => ctx2d,
                                    style: { setProperty() {} } };
      return store[id];
    },
    documentElement: { classList: { contains: () => false } },
  };
}
function makeChart(captured) {
  function Chart(_c, cfg) { captured.push(cfg); this.data = cfg.data; this.options = cfg.options;
                            this.destroy = () => {}; this.update = () => {}; }
  Chart.instances = {};
  Chart.getChart = () => null;
  return Chart;
}
const tickOf = cfg => cfg?.options?.scales?.y?.ticks?.callback;
const symbolOf = s => String(s).replace(/[-\d.,]/g, '').replace(/[KMB]$/, '');

console.log('\n' + '='.repeat(78));
console.log('  F124 — NATIVE vs DISPLAY CURRENCY ON THREE SURFACES (executed)');
console.log('='.repeat(78));
console.log('  entity currency TTD (TT$)   ·   display currency EUR (€)   ·   legacy literal $');

// ══════════════════════════════════════════════════════════════════════════════════════════
// 1 · app-main.js — the renderers themselves
// ══════════════════════════════════════════════════════════════════════════════════════════
function loadApp(mutate) {
  mutate = mutate || (s => s);
  const store = {};
  const captured = [];
  const body = [
    app('function _fmtMoney(value, symbol){'),
    app('function _fmtMoneyAbbr(n){'),
    app('function _nativeSymbol(){'),
    app('function _fmtMoneyNative(n){'),
    app('function _activeEntityCurrency(){'),
    app('function chartDefaults(){'),
    app('function _cashSeries(profit){'),
    mutate(app('function _applyConvertedChart(monthly){')),
    app('function buildCharts(){'),
    app('function buildCashChart(){'),
    app('function updateCharts(d=getPeriodData()){'),
  ].join('\n');
  const api = new Function(
    'window', 'document', 'CURRENCIES', 'fxConvert', 'Chart', 'charts', 'darkMode',
    'MONTHS', 'REV', 'EXP', 'PROFIT', 'ENTITIES', 'S', 'currentPeriod', 'currentMonthIdx',
    'var activeCurrency = "TTD";\n' + body +
    '\n; return { buildCharts, buildCashChart, updateCharts, _applyConvertedChart,' +
    '            _fmtMoney, _fmtMoneyAbbr, _fmtMoneyNative, _nativeSymbol, _cashSeries,' +
    '            setCurrency: c => { activeCurrency = c; } };'
  )(
    { }, makeDom(store), CURRENCIES, n => (parseFloat(n) || 0), makeChart(captured), {}, true,
    ['Jan', 'Feb'], [1000, 2000], [400, 3000], [600, -1000],
    [{ active: true, currency: 'TTD' }], v => 'S(' + v + ')', 'year', 1
  );
  return { api, captured, store };
}

console.log('\n-- 1 - the renderers: native symbol tracks the ENTITY, not activeCurrency --');
{
  const { api } = loadApp();
  A('native symbol with no display currency', api._nativeSymbol(), 'TT$');
  api.setCurrency('EUR');                                    // display currency armed
  A('native symbol is UNCHANGED by a display currency', api._nativeSymbol(), 'TT$',
    'if this returned "€" the helper would be mislabelling unconverted money');
  A('_fmtMoneyNative uses it',   api._fmtMoneyNative(1234), 'TT$1.2K', 'hardcoded "$" gives "$1.2K"');
  A('_fmtMoneyAbbr still follows activeCurrency (converted surfaces)', api._fmtMoneyAbbr(1234), '€1.2K');
  A('the two genuinely DIFFER (the choice is discriminating)',
    symbolOf(api._fmtMoneyNative(1234)) !== symbolOf(api._fmtMoneyAbbr(1234)), true);
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// 2 · index.html — MRR page and Scenario planner: axis symbol == card symbol
// ══════════════════════════════════════════════════════════════════════════════════════════
function loadIdx(mutate) {
  mutate = mutate || (s => s);
  const store = { __values: { 'sl-rev-growth': '10', 'sl-headcount': '2', 'sl-salary': '60',
                              'sl-churn': '5', 'sl-invest': '20', 'sl-efficiency': '5' } };
  const captured = [];
  const { api: appApi } = loadApp();
  appApi.setCurrency('EUR');                                  // display currency armed everywhere
  const win = {
    _fmtMoney: appApi._fmtMoney,
    _fmtMoneyNative: appApi._fmtMoneyNative,
    _nativeSymbol: appApi._nativeSymbol,
    BASE: { rev: 120000, exp: 90000, cash: 50000, burn: 3000 },
    _mrrChartData: [1000, 2000, 3000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  const body = [
    mutate(idx('function renderMRRChart(){')),
    mutate(idx('window.updateScenario = function(){')) + ';',
    mutate(idx('function renderScenarioChart(projRev, projExp){')),
  ].join('\n');
  // The two chart-instance holders are `let`s that live just outside the extracted spans
  // (index.html:4276, :6307). Declared here so the spans run verbatim rather than being edited.
  // `BASE` is referenced BARE inside updateScenario but declared as `window.BASE` (index.html:6266);
  // in a browser those are the same binding, in this sandbox they are not, so it is passed in —
  // bound to the SAME object as win.BASE so the two can't diverge mid-test.
  const api = new Function('window', 'document', 'Chart', 'BASE',
    'var mrrChartInst = null, scenarioChartInst = null;\n' + body +
    '\n; return { renderMRRChart, updateScenario: window.updateScenario, renderScenarioChart };'
  )(win, makeDom(store), makeChart(captured), win.BASE);
  return { api, captured, store, win, native: appApi._nativeSymbol(), display: '€' };
}

console.log('\n-- 2a - MRR page: chart axis carries the NATIVE symbol (series is unconverted) --');
{
  const { api, captured, native } = loadIdx();
  api.renderMRRChart();
  A('MRR axis symbol', symbolOf(tickOf(captured[0])(1234)), native, 'was "$" — wrong for a TTD entity');
}

console.log('\n-- 2b - Scenario planner: every card AND the axis agree, on ONE symbol --');
{
  const { api, captured, store, native } = loadIdx();
  api.updateScenario();                                        // also calls renderScenarioChart
  const axis = symbolOf(tickOf(captured[0])(1234));
  const cards = ['sc-rev', 'sc-exp', 'sc-profit', 'sc-r-rev', 'sc-r-profit', 'lbl-salary', 'lbl-invest']
    .map(id => symbolOf(store[id].textContent));
  A('every scenario card renders the native symbol', [...new Set(cards)], [native],
    'the local `const S = v => _fmtMoney(v,"$")` shadow gave "$" on all of them');
  A('axis symbol == card symbol', axis, cards[0]);
  A('and it is NOT the display symbol (values are unconverted)', axis === '€', false);
}

console.log('\n-- 2c - FAILURE PATH, EXECUTED: the pre-fix sources rebuilt and run --');
{
  const PRE = { 'window._fmtMoneyNative(v)': "window._fmtMoney(v, '$')",
                'window._fmtMoneyNative(salary)': "window._fmtMoney(salary,'$')",
                'window._fmtMoneyNative(invest)': "window._fmtMoney(invest,'$')" };
  let reverted = 0;
  const { api, captured, store } = loadIdx(s => {
    let out = s;
    for (const [now, before] of Object.entries(PRE)) {
      if (out.includes(now)) { reverted++; out = out.split(now).join(before); }
    }
    return out;
  });
  A('pre-fix forms were restored (control is real)', reverted >= 3, true, `reverted ${reverted}`);
  api.updateScenario();
  A('PRE-FIX scenario cards show a hardcoded $ on a TTD entity', symbolOf(store['sc-rev'].textContent), '$');
  A('PRE-FIX axis shows a hardcoded $',  symbolOf(tickOf(captured[0])(1234)), '$');
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// 3 · The cash chart series — the overlay that had never run
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n-- 3a - _applyConvertedChart writes the CONVERTED series into both charts --');
{
  const { api, captured } = loadApp();
  api.buildCharts(); api.buildCashChart();
  const overview = captured[0], cash = captured[1];
  A('native cash actual series (built from PROFIT)', cash.data.datasets[0].data.slice(0, 2), [600, -1000]);

  api.setCurrency('EUR');
  api._applyConvertedChart({ complete: true, labels: ['Jan', 'Feb'], revByMonth: [500, 1000], expByMonth: [200, 1500] });

  A('overview revenue series is now the SERVER-converted one', overview.data.datasets[0].data, [500, 1000],
    'before this fix the overlay guarded on window.charts and silently did nothing');
  A('overview expense series too', overview.data.datasets[1].data, [200, 1500]);
  // profit = rev - exp = [300, -500]. The SECOND month is a LOSS on purpose (Rule 4): a clamped
  // Math.max(0,…) — correct for the bars, fatal here — would render 0 and be invisible otherwise.
  A('cash series is converted rev − exp, sign PRESERVED', cash.data.datasets[0].data.slice(0, 2), [300, -500],
    'a clamped copy of the bars\' safe() would give [300,0] and erase the loss');
  A('cash forecast series was rebuilt from the converted profit',
    cash.data.datasets[1].data.slice(0, 2), [null, null]);
}

console.log('\n-- 3b - updateCharts restores the NATIVE series (the way back) --');
{
  const { api, captured } = loadApp();
  api.buildCharts(); api.buildCashChart();
  const cash = captured[1];
  api.setCurrency('EUR');
  api._applyConvertedChart({ complete: true, labels: ['Jan', 'Feb'], revByMonth: [500, 1000], expByMonth: [200, 1500] });
  A('cash series is converted', cash.data.datasets[0].data.slice(0, 2), [300, -500]);
  api.setCurrency('TTD');
  api.updateCharts({});
  A('…and updateCharts puts the native PROFIT back', cash.data.datasets[0].data.slice(0, 2), [600, -1000],
    'without this the chart would keep EUR figures under the TT$ symbol — the same mislabelling, reversed');
}

console.log('\n-- 3c - RULE 14 CONTROL: restore the window.charts read and the overlay goes silent --');
{
  let reverted = 0;
  const { api, captured } = loadApp(s => {
    if (!s.includes('const chart = charts && charts.overview;')) {
      throw new Error('[f124] fixed guard not found in _applyConvertedChart — probe is stale, fix the probe.');
    }
    reverted++;
    return s.replace('const chart = charts && charts.overview;', 'const chart = window.charts && window.charts.overview;')
            .replace('const cash = charts && charts.cash;',       'const cash = window.charts && window.charts.cash;');
  });
  A('the dead guard was restored (control is real)', reverted, 1);
  api.buildCharts(); api.buildCashChart();
  const overview = captured[0], cash = captured[1];
  api.setCurrency('EUR');
  api._applyConvertedChart({ complete: true, labels: ['Jan', 'Feb'], revByMonth: [500, 1000], expByMonth: [200, 1500] });
  A('WITH window.charts: overview series NOT converted (overlay is a no-op)',
    overview.data.datasets[0].data, [1000, 2000]);
  A('WITH window.charts: cash series NOT converted', cash.data.datasets[0].data.slice(0, 2), [600, -1000]);
  console.log('        ^ this is what shipped: F34 Path B surface 1 has never rendered (F125).');
}

console.log('\n' + '-'.repeat(78));
console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed'
                       : '  ' + fail + ' FAILED, ' + pass + ' passed');
console.log('  NOTE  symbols are asserted as STRINGS; the rendered glyph is a VISUAL check (owner).');
console.log('-'.repeat(78) + '\n');
process.exit(fail === 0 ? 0 : 1);
