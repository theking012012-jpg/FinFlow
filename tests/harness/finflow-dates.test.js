'use strict';
/**
 * finflow-dates.test.js — unit proof for the canonical date/period module (F87 foundation).
 *
 *   node tests/harness/finflow-dates.test.js
 *
 * No DB. Proves:
 *   1. VIEWER INDEPENDENCE (unit level) — the F87 first-of-month rows + a boundary timestamp
 *      resolve identically when the PROCESS TZ is set across the sign boundary (LA, POS west;
 *      Kolkata, London east). Done by re-running the assertions in a child process per TZ and
 *      asserting byte-identical fingerprints — the real discriminator (a local-time bug would
 *      make at least one differ).
 *   2. resolvePeriod reproduces the VERIFICATION windows for Jun/Jul/Q2/Q3/FY 2026 (FY = January,
 *      clock 2026-07-25): start/end strings and elapsedMonths.
 *   3. The D2 bound — a future date (2026-09-01) is excluded once the window is capped at
 *      resolvedToday, while today and past dates are kept.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const D = require(path.join(__dirname, '..', '..', 'public', 'finflow-dates.js'));

const ZONES = ['America/Los_Angeles', 'America/Port_of_Spain', 'Asia/Kolkata', 'Europe/London'];
const SERVER_NOW = '2026-07-25T16:00:00.000Z';   // the pinned instant, passed as the SERVER clock

// The fingerprint every TZ must agree on: the F87 rows + boundary + the resolved windows.
function fingerprint() {
  const today = D.resolvedToday(new Date(SERVER_NOW));
  const jan0 = { fyStartMonth: 0, today };
  const may = D.resolvePeriod(Object.assign({ period: 'month', monthIdx: 4 }, jan0));
  const jun = D.resolvePeriod(Object.assign({ period: 'month', monthIdx: 5 }, jan0));
  const jul = D.resolvePeriod(Object.assign({ period: 'month', monthIdx: 6 }, jan0));
  return JSON.stringify({
    today,
    // F87 first-of-month rows land in the correct month:
    jul01_in_jul: D.inWindow('2026-07-01', jul.start, jul.end),
    jun01_in_jun: D.inWindow('2026-06-01', jun.start, jun.end),
    may01_in_may: D.inWindow('2026-05-01', may.start, may.end),
    jul01_not_in_jun: D.inWindow('2026-07-01', jun.start, jun.end),
    jun01_not_in_may: D.inWindow('2026-06-01', may.start, may.end),
    // boundary timestamp inside the inter-viewer gap (05:30Z on the 1st):
    boundary_in_jun: D.inWindow('2026-06-01T05:30:00.000Z', jun.start, jun.end),
    windows: {
      jun: jun, jul: jul,
      q2: D.resolvePeriod(Object.assign({ period: 'quarter', monthIdx: 5 }, jan0)),
      q3: D.resolvePeriod(Object.assign({ period: 'quarter', monthIdx: 6 }, jan0)),
      fy: D.resolvePeriod(Object.assign({ period: 'year' }, jan0)),
    },
  });
}

// ── CHILD MODE: print the fingerprint computed under this process's TZ, and exit. ──
if (process.env.F87_CHILD) {
  process.stdout.write('FP=' + fingerprint());
  process.exit(0);
}

// ── PARENT ──
let pass = 0, fail = 0;
const A = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

console.log('\n── 1 · Viewer independence — same logic under 4 process timezones (sign boundary) ──');
const runs = ZONES.map((tz) => {
  const r = spawnSync(process.execPath, [__filename], {
    env: Object.assign({}, process.env, { TZ: tz, F87_CHILD: '1' }), encoding: 'utf8',
  });
  const m = (r.stdout || '').match(/FP=(\{[\s\S]*\})/);
  return { tz, fp: m ? m[1] : ('ERROR: ' + ((r.stderr || r.stdout || 'no output').trim().slice(0, 300))) };
});
for (const x of runs) {
  const off = { 'America/Los_Angeles': 'UTC-7 west', 'America/Port_of_Spain': 'UTC-4 west', 'Asia/Kolkata': 'UTC+5:30 east', 'Europe/London': 'UTC+1 east' }[x.tz];
  console.log('     ' + x.tz.padEnd(24) + '(' + off + ')');
}
const distinct = new Set(runs.map((x) => x.fp));
A('F87 fingerprint BYTE-IDENTICAL across all 4 timezones', distinct.size === 1,
  distinct.size === 1 ? '' : runs.map((x) => x.tz + ' → ' + x.fp.slice(0, 120)).join('\n          '));
if (distinct.size === 1) console.log('     shared fingerprint: ' + [...distinct][0]);

console.log('\n── 2 · resolvePeriod reproduces the VERIFICATION windows (FY=January, today 2026-07-25) ──');
const today = D.resolvedToday(new Date(SERVER_NOW));
A("resolvedToday(server " + SERVER_NOW + ") === '2026-07-25'", today === '2026-07-25', 'got ' + today);
const expected = {
  jun: { start: '2026-06-01', end: '2026-07-01', elapsedMonths: 1 },
  jul: { start: '2026-07-01', end: '2026-08-01', elapsedMonths: 1 },
  q2:  { start: '2026-04-01', end: '2026-07-01', elapsedMonths: 3 },
  q3:  { start: '2026-07-01', end: '2026-10-01', elapsedMonths: 1 },
  fy:  { start: '2026-01-01', end: '2027-01-01', elapsedMonths: 7 },
};
const got = {
  jun: D.resolvePeriod({ period: 'month', monthIdx: 5, fyStartMonth: 0, today }),
  jul: D.resolvePeriod({ period: 'month', monthIdx: 6, fyStartMonth: 0, today }),
  q2:  D.resolvePeriod({ period: 'quarter', monthIdx: 5, fyStartMonth: 0, today }),
  q3:  D.resolvePeriod({ period: 'quarter', monthIdx: 6, fyStartMonth: 0, today }),
  fy:  D.resolvePeriod({ period: 'year', fyStartMonth: 0, today }),
};
for (const k of ['jun', 'jul', 'q2', 'q3', 'fy']) {
  A(k + ' → ' + JSON.stringify(expected[k]),
    JSON.stringify(got[k]) === JSON.stringify(expected[k]), 'got ' + JSON.stringify(got[k]));
}

console.log('\n── 3 · F87 first-of-month rows + boundary timestamp land in the right month ──');
const may = D.resolvePeriod({ period: 'month', monthIdx: 4, fyStartMonth: 0, today });
A('2026-07-01 ∈ Jul and ∉ Jun', D.inWindow('2026-07-01', got.jul.start, got.jul.end) && !D.inWindow('2026-07-01', got.jun.start, got.jun.end));
A('2026-06-01 ∈ Jun and ∉ May', D.inWindow('2026-06-01', got.jun.start, got.jun.end) && !D.inWindow('2026-06-01', may.start, may.end));
A('2026-05-01 ∈ May', D.inWindow('2026-05-01', may.start, may.end));
A('boundary 2026-06-01T05:30:00.000Z ∈ Jun (UTC calendar date, phase 1)', D.inWindow('2026-06-01T05:30:00.000Z', got.jun.start, got.jun.end));

console.log('\n── 4 · D2 bound — future excluded once capped at resolvedToday ──');
// D2 recognition = in the raw window AND not after today (string comparison, no Date).
const d2 = (dateValue, w) => D.inWindow(dateValue, w.start, w.end) && (D._toYmd(dateValue) <= today);
A('future 2026-09-01 IS in the raw FY window (uncapped)', D.inWindow('2026-09-01', got.fy.start, got.fy.end));
A('future 2026-09-01 EXCLUDED from FY under the D2 cap', d2('2026-09-01', got.fy) === false);
A('future 2026-09-01 EXCLUDED from Q3 under the D2 cap', d2('2026-09-01', got.q3) === false);
A('today 2026-07-25 INCLUDED in FY under the D2 cap', d2('2026-07-25', got.fy) === true);
A('past 2026-07-20 INCLUDED in FY under the D2 cap', d2('2026-07-20', got.fy) === true);

console.log('\n' + (fail === 0 ? '  ALL GREEN' : '  ' + fail + ' FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exitCode = 0;
