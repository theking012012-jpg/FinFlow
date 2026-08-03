#!/usr/bin/env node
'use strict';
/**
 * f120-chart-axis-currency.js — the overview / cash chart Y-axis currency symbol (F120).
 *
 *   node tests/harness/f120-chart-axis-currency.js
 *
 * WHAT THIS PROVES. It EXECUTES the real `buildCharts` and `buildCashChart` from
 * public/app-main.js, captures the tick callback that is actually registered on the Chart.js
 * options object, and CALLS it. The assertion is on the returned STRING (Rule 5), not on a
 * grep of the source — a fix applied to a shadowed copy, or a callback that never reached the
 * options object, fails here.
 *
 * RULE 1 (runtime winner). `buildCharts` / `buildCashChart` are defined once, in app-main.js.
 * No wiring source assigns `window.buildCharts` or `window.buildCashChart` — confirmed by
 *   grep -rn "window.buildCharts *=\|window.buildCashChart *=" public/ --exclude=finflow-bundle.js
 * which returns nothing. So the app-main copies ARE the runtime path and this probe tests it.
 *
 * RULE 14 (failure path executed). Section 3 rebuilds the SAME source span with the tick
 * callbacks textually reverted to the pre-fix `_fmtMoney(v,'$')` form and RUNS it. The old code
 * is executed and shown to return '$' under a EUR display currency — the defect is measured,
 * not described.
 *
 * RULE 4 (discriminating input). 1234 renders '1.2K' — abbreviation is preserved by the fix, so
 * a run that accidentally swapped in the exact formatter would change the string too. EUR/TTD are
 * used because their symbols ('€', 'TT$') differ from '$' in both length and content, so a
 * fallback-to-'$' and a genuine lookup can never produce the same output.
 *
 * WHAT IS *NOT* PROVED. Chart.js itself is not loaded (no network, and it is not a dependency):
 * `Chart` is replaced by a recorder that captures the config object. That stubs the CHART
 * LIBRARY, never the money path — `_fmtMoney`, `CURRENCIES` and `activeCurrency` are the real
 * ones, read verbatim from app-main.js. The final confirmation that the pixels on screen carry
 * the right glyph is VISUAL and remains outstanding (F120's own "Done when").
 *
 * Read-only: reads two source files, no DB, no network, no writes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');

let pass = 0, fail = 0;
const A = (name, got, want, bugWould) => {
  if (got === want) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else {
    fail++;
    console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) +
      '\n          want ' + JSON.stringify(want) +
      (bugWould ? '\n          (the pre-fix code produces ' + JSON.stringify(bugWould) + ')' : ''));
  }
};

// ── Verbatim contiguous spans, closed by brace counting (Rule 5 corollary: per-function text
// slicing has failed four times here — this takes whole unbroken regions of real source).
function span(openLine) {
  const at = SRC.indexOf(openLine);
  if (at < 0) throw new Error(`[f120] span not found: ${openLine} — probe is stale, fix the probe.`);
  let depth = 0;
  for (let j = SRC.indexOf('{', at + openLine.length - 1); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(at, j + 1); }
  }
  throw new Error(`[f120] unbalanced braces for ${openLine}`);
}

const SPAN_FMT    = span('function _fmtMoney(value, symbol){');
const SPAN_ABBR   = span('function _fmtMoneyAbbr(n){');
const SPAN_DEF    = span('function chartDefaults(){');
const SPAN_BUILD  = span('function buildCharts(){');
const SPAN_CASH   = span('function buildCashChart(){');

/**
 * Evaluate the spans with a recording Chart constructor and return the captured tick callbacks.
 * `mutate` lets section 3 hand back the PRE-FIX source; identity for the live run.
 */
function loadCharts(mutate) {
  const body = [SPAN_FMT, SPAN_ABBR, SPAN_DEF, mutate(SPAN_BUILD), mutate(SPAN_CASH)].join('\n');
  const captured = [];
  const gradient = { addColorStop() {} };
  const ctx2d = { createLinearGradient: () => gradient };
  const canvas = { offsetWidth: 400, offsetParent: {}, getContext: () => ctx2d };
  function Chart(_ctx, cfg) { captured.push(cfg); this.destroy = () => {}; this.update = () => {}; }
  Chart.instances = {};
  const env = {
    window: {},
    document: { getElementById: () => canvas },
    CURRENCIES: { USD: { symbol: '$' }, EUR: { symbol: '€' }, TTD: { symbol: 'TT$' } },
    fxConvert: (n) => (parseFloat(n) || 0) * 2,   // DOUBLES — a converting axis is visible in the string
    Chart,
    charts: {},
    darkMode: true,
    MONTHS: ['Jan'], REV: [1000], EXP: [500], PROFIT: [500],
  };
  const api = new Function(
    'window', 'document', 'CURRENCIES', 'fxConvert', 'Chart', 'charts', 'darkMode',
    'MONTHS', 'REV', 'EXP', 'PROFIT',
    'var activeCurrency = "USD";\n' + body +
    '\n; return { buildCharts, buildCashChart, _fmtMoney, _fmtMoneyAbbr,' +
    '            setCurrency: c => { activeCurrency = c; } };'
  )(env.window, env.document, env.CURRENCIES, env.fxConvert, env.Chart, env.charts, env.darkMode,
    env.MONTHS, env.REV, env.EXP, env.PROFIT);

  api.buildCharts();
  api.buildCashChart();
  if (captured.length !== 2) throw new Error(`[f120] expected 2 Chart constructions, got ${captured.length}`);
  const tick = cfg => cfg?.options?.scales?.y?.ticks?.callback;
  const overview = tick(captured[0]), cash = tick(captured[1]);
  if (typeof overview !== 'function' || typeof cash !== 'function') {
    throw new Error('[f120] a Y-axis tick callback is missing from the captured chart config');
  }
  return { overview, cash, setCurrency: api.setCurrency, _fmtMoneyAbbr: api._fmtMoneyAbbr };
}

console.log('\n' + '='.repeat(78));
console.log('  F120 — CHART Y-AXIS CURRENCY SYMBOL (executed tick callbacks)');
console.log('='.repeat(78));

const live = loadCharts(s => s);

// ── 1 · Native path: the axis carries the entity's own symbol, unchanged behaviour for USD ──
console.log('\n-- 1 - native (activeCurrency = entity currency) --');
live.setCurrency('USD');
A('overview axis, USD', live.overview(1234), '$1.2K');
A('cash axis, USD',     live.cash(1234),     '$1.2K');

// ── 2 · Display currency armed: the axis MUST follow it. This is the F120 defect. ──
console.log('\n-- 2 - display currency armed (the F120 defect) --');
live.setCurrency('EUR');
A('overview axis follows activeCurrency', live.overview(1234), '€1.2K', '$1.2K');
A('cash axis follows activeCurrency',     live.cash(1234),     '€1.2K', '$1.2K');
live.setCurrency('TTD');
A('overview axis, multi-char symbol', live.overview(1234), 'TT$1.2K', '$1.2K');
A('cash axis, multi-char symbol',     live.cash(1234),     'TT$1.2K', '$1.2K');

// ── 3 · F120's "Done when": axis and KPI tiles render the SAME symbol ──
// The tiles go through _fmtMoneyAbbr (app-main.js:2153-2155). Compared symbol-to-symbol, not
// value-to-value: fxConvert DOUBLES in this probe, so the tile figure is deliberately different —
// which is also the check that the axis is NOT converting (see section 5).
console.log('\n-- 3 - axis symbol == KPI tile symbol (F120 "Done when") --');
const symbolOf = s => s.replace(/[-\d.,]/g, '').replace(/[KMB]$/, '');
for (const ccy of ['USD', 'EUR', 'TTD']) {
  live.setCurrency(ccy);
  A(`${ccy}: axis symbol == tile symbol`, symbolOf(live.overview(1234)), symbolOf(live._fmtMoneyAbbr(1234)));
}

// ── 4 · FAILURE PATH, EXECUTED (Rule 14) — the pre-fix callback, run, not described ──
console.log('\n-- 4 - failure path: the PRE-FIX source is rebuilt and EXECUTED --');
const PRE_FIX = "callback:v=>_fmtMoney(v,'$')";
const POST_FIX = "callback:v=>_fmtMoney(v, CURRENCIES[activeCurrency]?.symbol||'$')";
let reverted = 0;
const old = loadCharts(s => {
  if (!s.includes(POST_FIX)) throw new Error('[f120] fixed callback form not found — probe is stale, fix the probe.');
  reverted++;
  return s.split(POST_FIX).join(PRE_FIX);
});
A('both spans were reverted (control is real)', reverted, 2);
old.setCurrency('EUR');
A('PRE-FIX overview axis mislabels EUR figures as $', old.overview(1234), '$1.2K');
A('PRE-FIX cash axis mislabels EUR figures as $',     old.cash(1234),     '$1.2K');
A('and the fix genuinely changes it', live.overview(1234) !== old.overview(1234), true);

// ── 5 · The axis must NOT convert. Under a display currency the overview datasets have already
// been replaced with the SERVER-converted buckets (_applyConvertedChart, app-main.js:4778), so a
// converting formatter would convert twice. fxConvert doubles here, so a double-conversion is
// visible as 2.5K instead of 1.2K — the f64 probe's section-5 trap, on the axis.
console.log('\n-- 5 - the axis must not re-convert an already-converted figure --');
live.setCurrency('EUR');
A('overview axis renders the value once', live.overview(1234), '€1.2K', '€2.5K');
A('control: _fmtMoneyAbbr WOULD convert it a second time', live._fmtMoneyAbbr(1234), '€2.5K');

console.log('\n' + '-'.repeat(78));
console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed'
                       : '  ' + fail + ' FAILED, ' + pass + ' passed');
console.log('  NOTE  final confirmation that the rendered glyph is correct is VISUAL (owner).');
console.log('-'.repeat(78) + '\n');
process.exit(fail === 0 ? 0 : 1);
