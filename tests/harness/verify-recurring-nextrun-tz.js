#!/usr/bin/env node
'use strict';
/**
 * verify-recurring-nextrun-tz.js — F159. The recurrence-date helper is a calendar-date computation
 * and must be TIMEZONE-FREE (Rule 10). It exists in THREE copies (Rule 2 multi-writer): the server
 * (server.js nextRunDate) and two client mirrors that pre-compute the initial next_run in the
 * viewer's browser (public/app-main.js _txNextRun, public/finflow-api-wiring-pages.js _billNextRun).
 * The old copies did `new Date('YYYY-MM-DD')` (UTC midnight) then advanced with LOCAL setMonth, so
 * west of UTC a 1st-of-month date rolled back a day (2026-07-01 → 07-31; 2026-12-01 → 12-31).
 *
 * This harness EXECUTES the actual shipped source of all three copies under three timezones that
 * span the sign boundary (UTC-4, UTC+9, UTC — Rule 10 testing corollary) and asserts they all agree
 * with the hand-derived calendar answer. It self-spawns one child per timezone (TZ must be set
 * before the process starts).
 *
 *   node tests/harness/verify-recurring-nextrun-tz.js
 *
 * No database — pure functions. Safe to run anywhere.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const ZONES = ['America/Port_of_Spain' /* UTC-4 */, 'Asia/Tokyo' /* UTC+9 */, 'UTC'];

// Hand-derived expected values (owner-checkable calendar math, NOT derived from the code — Rule 6).
const CASES = [
  ['2026-07-01', 'Monthly',   '2026-08-01'],  // the reported failure (was 2026-07-31 west of UTC)
  ['2026-12-01', 'Monthly',   '2027-01-01'],  // was 2026-12-31 — also lost the year rollover
  ['2026-02-01', 'Monthly',   '2026-03-01'],  // was 2026-03-04
  ['2026-03-31', 'Monthly',   '2026-04-30'],  // month-end clamp (30-day target month)
  ['2026-01-31', 'Monthly',   '2026-02-28'],  // clamp to short month (2026 not a leap year)
  ['2026-07-10', 'Monthly',   '2026-08-10'],  // mid-month (survived the bug — regression guard)
  ['2026-06-15', 'Yearly',    '2027-06-15'],
  ['2026-12-01', 'Quarterly', '2027-03-01'],  // quarter crossing a year boundary
  ['2026-07-01', 'Weekly',    '2026-07-08'],
];

function extractFn(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const i = src.indexOf('function ' + name);
  if (i < 0) throw new Error('not found: ' + name + ' in ' + file);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced braces extracting ' + name);
}

// ── child mode: run the assertions in one fixed timezone ──
if (process.env.__NRUN_TZ_CHILD) {
  const todayLocal = () => '2026-07-25', todayStr = () => '2026-07-25';   // fallbacks (never hit; we pass dates)
  const serverSrc = extractFn(path.join(ROOT, 'server.js'), 'nextRunDate');
  const txSrc = extractFn(path.join(ROOT, 'public', 'app-main.js'), '_txNextRun');
  const billSrc = extractFn(path.join(ROOT, 'public', 'finflow-api-wiring-pages.js'), '_billNextRun');
  for (const [nm, s] of [['nextRunDate', serverSrc], ['_txNextRun', txSrc], ['_billNextRun', billSrc]]) {
    if (!/Date\.UTC/.test(s)) { console.log('EXTRACT-SANITY-FAIL ' + nm + ' has no Date.UTC (wrong/old copy?)'); process.exit(2); }
  }
  const nextRunDate = eval('(' + serverSrc.replace(/^function nextRunDate/, 'function') + ')');
  const _txNextRun  = eval('(' + txSrc.replace(/^function _txNextRun/, 'function') + ')');
  const _billNextRun = eval('(' + billSrc.replace(/^function _billNextRun/, 'function') + ')');
  let bad = 0;
  for (const [inp, freq, want] of CASES) {
    const s = nextRunDate(inp, freq), t = _txNextRun(inp, freq), b = _billNextRun(inp, freq);
    const ok = s === want && t === want && b === want;
    if (!ok) { bad++; console.log(`    FAIL [${process.env.TZ}] ${inp} ${freq}: server=${s} tx=${t} bill=${b} (want ${want})`); }
  }
  process.exit(bad ? 1 : 0);
}

// ── parent mode: one child per timezone ──
let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('  F159 · recurrence date is timezone-free across server + both client mirrors');
console.log('='.repeat(78) + '\n');
for (const tz of ZONES) {
  try {
    execFileSync(process.execPath, [__filename], {
      env: Object.assign({}, process.env, { TZ: tz, __NRUN_TZ_CHILD: '1' }),
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    pass++; console.log(`  PASS  TZ=${tz} — all ${CASES.length} cases agree (server == _txNextRun == _billNextRun)`);
  } catch (e) {
    fail++; console.log(`  FAIL  TZ=${tz} — see mismatch(es) above (exit ${e.status})`);
  }
}
console.log('\n' + '-'.repeat(78));
console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' timezones passed, 0 failed  (F159 recurrence TZ-invariance)'
                       : '  ' + fail + ' timezone(s) FAILED, ' + pass + ' passed');
console.log('-'.repeat(78) + '\n');
process.exit(fail === 0 ? 0 : 1);
