#!/usr/bin/env node
/**
 * F64 — money formatter probe (EXECUTED, not reasoned).
 *
 * Executes the REAL formatter source from public/app-main.js: _fmtMoney, _fmtMoneyAbbr,
 * _fmtMoneyExact and patchSFormatter. Asserts on returned STRINGS, never on source text.
 *
 * Runtime winner (Rule 1): window.S is assigned by patchSFormatter() in app-main.js. The two
 * refs in finflow-api-wiring-medium.js (:1006, :1152) only CALL window.S — no wiring file
 * assigns it — so app-main is the runtime winner and this probe tests the live path.
 *
 * Rule 4 (seeds must discriminate) — every case is chosen so the PRE-FIX behaviour and the
 * POST-FIX behaviour produce DIFFERENT strings. Each assertion states what the bug produced:
 *   1234.56  → pre-fix "$1.2K"        post-fix "$1,234.56" (cents on) / "$1,235" (cents off)
 *   35200000 → tiles must stay        "$35.2M"  (pre-fix also "$35.2M" — see note on case 4)
 * A seed like 500 would be useless here: abbreviated and exact both render "$500".
 *
 * Read-only: no DB, no network, no writes. Reads app-main.js and evaluates a verbatim
 * contiguous span of it.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');

// ── Load the formatters by evaluating the VERBATIM contiguous span that defines them.
// Not a per-function slicer: one unbroken region of real source, so a stripped keyword or a
// mismatched paren cannot silently change what runs (Rule 5 corollary).
const START = SRC.indexOf('function _fmtMoney(value, symbol){');
const END_MARK = 'function patchSFormatter(){';
const endIdx = SRC.indexOf(END_MARK);
if (START < 0 || endIdx < 0) {
  console.error('FAIL  could not locate formatter span in app-main.js — probe is stale, fix the probe.');
  process.exit(1);
}
// Extend to the closing brace of patchSFormatter by brace-counting from its opening brace.
let i = SRC.indexOf('{', endIdx + END_MARK.length - 1), depth = 0, end = -1;
for (let j = i; j < SRC.length; j++) {
  if (SRC[j] === '{') depth++;
  else if (SRC[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
}
const SPAN = SRC.slice(START, end);
for (const fn of ['_fmtMoneyAbbr', '_fmtMoneyExact', 'patchSFormatter']) {
  if (!SPAN.includes('function ' + fn)) {
    console.error('FAIL  span does not contain ' + fn + ' — probe is stale, fix the probe.');
    process.exit(1);
  }
}

// ── Controllable environment. fxConvert DOUBLES, so any figure that was converted twice, or
// not converted at all, is visible in the output string rather than hidden by an identity rate.
let CENTS = false;
const env = {
  window: {},
  document: { getElementById: (id) => (id === 's-cents' ? { checked: CENTS } : null) },
  CURRENCIES: { USD: { symbol: '$' }, EUR: { symbol: '€' } },
  activeCurrency: 'USD',
  fxConvert: (n) => (parseFloat(n) || 0) * 2,
};
const load = new Function('window', 'document', 'CURRENCIES', 'activeCurrency', 'fxConvert',
  SPAN + '\n; return { _fmtMoney, _fmtMoneyAbbr, _fmtMoneyExact, patchSFormatter };');
const F = load(env.window, env.document, env.CURRENCIES, env.activeCurrency, env.fxConvert);

let pass = 0, fail = 0;
const A = (name, got, want, bugWould) => {
  if (got === want) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else { fail++; console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) +
    '\n          want ' + JSON.stringify(want) + (bugWould ? '\n          (bug produces ' + JSON.stringify(bugWould) + ')' : '')); }
};

console.log('\n' + '='.repeat(76));
console.log('  F64 — MONEY FORMATTER PROBE (executed values; fxConvert doubles to expose conversion)');
console.log('='.repeat(76));

// ── 1 · Exact renderer honours #s-cents. Input 617.28 so the doubled figure is 1234.56.
console.log('\n-- 1 - _fmtMoneyExact honours "Show cents" (input 617.28, fx x2 = 1234.56) --');
CENTS = true;
A('cents ON  shows full cents', F._fmtMoneyExact(617.28), '$1,234.56', '$1.2K');
CENTS = false;
A('cents OFF rounds to dollars', F._fmtMoneyExact(617.28), '$1,235', '$1.2K');

// ── 2 · Abbreviated renderer keeps K/M/B for the dashboard tiles.
console.log('\n-- 2 - _fmtMoneyAbbr keeps K/M/B (input 17.6M, fx x2 = 35.2M) --');
A('dashboard Revenue tile stays abbreviated', F._fmtMoneyAbbr(17600000), '$35.2M', '$35,200,000');

// ── 3 · window.S is the EXACT renderer after the patch, and the patch actually wins.
console.log('\n-- 3 - patchSFormatter repoints window.S to the exact renderer --');
env.window.S = function original(n) { return 'ORIGINAL-' + n; };   // stand-in for app-main:1575
F.patchSFormatter();
CENTS = true;
A('window.S is no longer the original', F._fmtMoneyExact === undefined ? 'n/a' :
  (env.window.S(617.28) === 'ORIGINAL-617.28' ? 'STILL ORIGINAL' : 'patched'), 'patched', 'STILL ORIGINAL');
A('window.S renders exact + cents', env.window.S(617.28), '$1,234.56', '$1.2K');
CENTS = false;
A('window.S renders exact, no cents', env.window.S(617.28), '$1,235', '$1.2K');

// ── 4 · The toggle is LIVE: same input, flipped checkbox, different string.
// This is the assertion F64 exists for — pre-fix, both sides returned "$1.2K" and the toggle
// was inert. A test that only checked one checkbox state could not tell the two apart.
console.log('\n-- 4 - "Show cents" changes the rendered string (the inert-toggle regression) --');
CENTS = true;  const on = env.window.S(617.28);
CENTS = false; const off = env.window.S(617.28);
A('toggling #s-cents changes output', on !== off ? 'changed' : 'INERT', 'changed', 'INERT');

// ── 5 · No double-conversion on the FX overlay path (_applyConvertedKPIs).
// There, `v` is ALREADY converted by the server, so the helper must call _fmtMoney directly
// with the target symbol. Routing it through S()/_fmtMoneyAbbr would apply fxConvert a SECOND
// time — with the x2 rate that shows up as 70.4M instead of 35.2M.
console.log('\n-- 5 - _applyConvertedKPIs must NOT re-convert an already-converted figure --');
const setHelperOutput = F._fmtMoney(35200000, env.CURRENCIES.EUR.symbol || '$');
A('already-converted value rendered once, in target ccy', setHelperOutput, '€35.2M', '€70.4M');
A('routing it through the abbr renderer WOULD double-convert (control)',
  F._fmtMoneyAbbr(35200000), '$70.4M', null);

// ── 6 · Sign handling and zero.
console.log('\n-- 6 - negatives and zero --');
CENTS = true;
A('negative keeps sign before symbol', F._fmtMoneyExact(-617.28), '-$1,234.56', '-$1.2K');
A('zero', F._fmtMoneyExact(0), '$0.00', '$0');

console.log('\n' + '-'.repeat(76));
console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed'
                       : '  ' + fail + ' FAILED, ' + pass + ' passed');
console.log('-'.repeat(76) + '\n');
process.exit(fail === 0 ? 0 : 1);
