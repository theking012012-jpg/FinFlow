#!/usr/bin/env node
'use strict';
/**
 * f128-reports-canonical-source.js — the Reports modal sources CANONICAL figures.
 *
 * HISTORY. The original F128 caught `window.generateReport` (finflow-api-wiring-extra.js, the
 * runtime winner) RE-COMPUTING its own money client-side from a partial source (paid-only revenue,
 * expenses without bills/payroll) — divergent from the dashboard. It executed the extracted body
 * against stubs and scraped the rendered cards.
 *
 * WHY THIS WAS REWRITTEN (2026-08-14). F137-g rewrote every report to pull its figures from the
 * SERVER report endpoints (`/api/reports/profit-loss`, `/api/reports/balance-sheet`,
 * `/api/reports/cash-flow`) — i.e. the SAME canonical `computeBooks` the dashboard uses — instead of
 * recomputing on the client. That is the fix F128 wanted, made structural: there is now ONE source
 * of truth. So the old execute-and-scrape probe tested behaviour that was deliberately DELETED, and
 * scraped card markup that no longer exists. The FIGURE is now verified end-to-end by
 * `verify-f137g-pl-statement` (P&L), `verify-f137-balance-sheet-report`, and
 * `verify-f137-cashflow-ar-ap-reports` against real seeded data via the real endpoints.
 *
 * This probe now asserts the INVARIANT that keeps F128 fixed: each report modal SOURCES its money
 * from the server report endpoint and does NOT recompute revenue client-side in that branch.
 * STRUCTURAL (Rule 5) — labelled as such; the numeric verification lives in the verify-f137* suite.
 *
 *   node tests/harness/f128-reports-canonical-source.js
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const A = (name, got, want, note) => {
  const ok = got === want;
  ok ? (pass++, console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)))
     : (fail++, console.log('  FAIL  ' + name + '\n          got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want) + (note ? '\n          ' + note : '')));
};

const ROOT = path.resolve(__dirname, '..', '..');
const EXTRA = fs.readFileSync(path.join(ROOT, 'public/finflow-api-wiring-extra.js'), 'utf8');

// Extract the runtime-winner generateReport body (the modal), so the assertions are on the code
// that actually ships (not app-main's shadowed copy — F128/F123).
function span(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('marker not found (probe stale): ' + marker);
  let depth = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced (probe stale): ' + marker);
}

console.log('\n' + '='.repeat(78));
console.log('  F128 — REPORTS SOURCE CANONICAL SERVER FIGURES (structural; figures in verify-f137*)');
console.log('='.repeat(78) + '\n');

const gen = span(EXTRA, 'window.generateReport = async function (name)');

// Each report branch pulls from its server endpoint (canonical computeBooks) …
A('generateReport is the runtime winner (window.* override, no _orig wrapper)',
  /window\.generateReport\s*=\s*async function/.test(EXTRA) && !/_origGenerateReport/.test(EXTRA), true);
A('P&L modal SOURCES the server endpoint /api/reports/profit-loss',
  /\/api\/reports\/profit-loss/.test(gen), true, 'F137-g: server-sourced, not client-recomputed');
A('Balance Sheet modal SOURCES /api/reports/balance-sheet',
  /\/api\/reports\/balance-sheet/.test(gen), true);
A('Cash Flow modal SOURCES /api/reports/cash-flow',
  /\/api\/reports\/cash-flow/.test(gen), true);

// The P&L branch (only) — displays the SERVER fields verbatim and does NOT recompute the P&L money
// client-side (the exact F128 defect). Scope to the P&L branch, since other reports may legitimately
// call the engines for non-P&L purposes.
const plStart = gen.indexOf("name === 'Profit & Loss Statement'");
const plEnd = gen.indexOf("name === 'Tax-Deductible Expenses'", plStart);
const pl = gen.slice(plStart, plEnd > plStart ? plEnd : undefined);
A('P&L reads server totalRevenue', /d\.totalRevenue/.test(pl), true);
A('P&L reads server netProfit',    /d\.netProfit/.test(pl), true);
A('P&L branch does NOT client-recompute revenue (no computeRevenue there)',
  /computeRevenue\s*\(/.test(pl), false, 'if true, the P&L is recomputing money instead of reading the server — F128 regressed');

console.log('\n' + '-'.repeat(78));
console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (reports server-sourced; numbers in verify-f137*)'
                       : '  ' + fail + ' FAILED, ' + pass + ' passed');
console.log('-'.repeat(78) + '\n');
process.exit(fail === 0 ? 0 : 1);
