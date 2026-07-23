'use strict';
/**
 * drift.js — the NOW() drift tripwire.
 *
 * THE PROBLEM
 *   The node clock is pinned (clock.js). Postgres NOW() is the REAL wall clock and cannot be
 *   pinned without freezing both sides of the double-submit window — `created_at > NOW() -
 *   INTERVAL '5 seconds'` (server.js:745) — which would make every duplicate check match
 *   forever, so B1.1-B1.8 would pass trivially while suppressing exactly the defect Rule 9
 *   exists for. So the drift is accepted and MEASURED instead of eliminated.
 *
 * THE POLICY (owner decision, 2026-07-23): WARN LOUDLY, DO NOT HARD-FAIL.
 *   Under Option B, Part B derives each row's period from its own stored value, so it largely
 *   self-corrects. Part A is unaffected entirely — it seeds explicit dates and never consults
 *   NOW(). A harness that refuses to run is worse than one that reports which checks it could
 *   not evaluate. So on month-boundary drift: print the gap prominently, mark ONLY the affected
 *   Part B checks BLOCKED with the drift named as the reason, and let everything else run.
 */

const clock = require('./clock.js');

// Part B checks whose result depends on a row the APP created being placed in the period the
// pinned clock expects. Everything else in Part B is a delta assertion and is drift-immune.
const DRIFT_SENSITIVE_CHECKS = [
  'B1.3', // Run Payroll — exactly one run (run_date = NOW(), server.js:3822)
  'B1.4', // Approve payroll run — expense counted once
  'B3.1', // Fresh reload → dashboard first → Expenses reads the Jun figure
  'B3.2', // Visit Payroll → return → unchanged
  'B3.3', // Payroll first → dashboard → same figure via both routes
  'B4.2', // Approve → contributes exactly Σ lines
  'B4.3', // Mark Paid → expense UNCHANGED
  'B4.4', // Mark Paid → Cash Flow out increases by Σ lines
];

function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * @param {Date} pgNow  result of SELECT NOW() from the scratch cluster (the REAL clock)
 */
function measureDrift(pgNow) {
  const pinned = new clock.RealDate(clock.PINNED_MS);
  const pinnedLocal = localYmd(pinned);
  const pgLocal = localYmd(pgNow);

  const days = Math.round((pgNow.getTime() - clock.PINNED_MS) / 86400000);
  const sameMonth = pinnedLocal.slice(0, 7) === pgLocal.slice(0, 7);

  return { pinnedLocal, pgLocal, days, sameMonth, crossesMonth: !sameMonth };
}

/**
 * Print the drift. Returns the set of check ids to mark BLOCKED (empty when in the same month).
 */
function reportDrift(drift) {
  const sign = drift.days === 0 ? 'same day' : (drift.days > 0 ? `+${drift.days}d ahead of` : `${drift.days}d behind`);
  console.log('');
  console.log('  ── clock drift ─────────────────────────────────────────────────────────');
  console.log(`     pinned node clock : ${drift.pinnedLocal} (local)`);
  console.log(`     postgres NOW()    : ${drift.pgLocal} (local, REAL clock)`);
  console.log(`     gap               : ${sign} the pin`);

  if (!drift.crossesMonth) {
    console.log('     status            : OK — both dates fall in the same month.');
    console.log('');
    return [];
  }

  console.log('');
  console.log('  ⚠️  ══════════════════════════════════════════════════════════════════════');
  console.log('  ⚠️   MONTH-BOUNDARY DRIFT — some Part B checks cannot be evaluated.');
  console.log('  ⚠️  ══════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`     Postgres NOW() (${drift.pgLocal}) and the pinned clock (${drift.pinnedLocal}) are in`);
  console.log('     DIFFERENT MONTHS. Rows the app creates are stamped by the database clock');
  console.log('     (payroll_runs.run_date = NOW(), server.js:3822 — see F85), so they land in a');
  console.log('     different period than the pinned clock expects.');
  console.log('');
  console.log('     Part A is UNAFFECTED — it seeds explicit dates and never reads NOW().');
  console.log('     These Part B checks are marked BLOCKED, not failed:');
  console.log(`       ${DRIFT_SENSITIVE_CHECKS.join(', ')}`);
  console.log('     Every other check still runs.');
  console.log('');
  console.log('     ── MAINTENANCE: RE-PINNING THE CLOCK ────────────────────────────────');
  console.log('     This goes live soon by construction. Real time passes the pinned clock on');
  console.log('     2026-07-25 and crosses into August six days later, so this warning is');
  console.log('     expected — it is not a symptom of a code change.');
  console.log('');
  console.log('     Re-pinning is NOT a one-line edit. The expected values in VERIFICATION.md');
  console.log('     were hand-computed against the seed dates. Moving the clock without moving');
  console.log('     the seed changes which rows fall in which period, and every expected figure');
  console.log('     silently becomes wrong — a harness that then reports confident bad numbers.');
  console.log('');
  console.log('     To re-pin, move EVERY seed date by the SAME offset, in lockstep:');
  console.log('       1. Choose the offset (whole months keeps the arithmetic simplest).');
  console.log('       2. Shift PINNED_ISO in tests/harness/clock.js.');
  console.log('       3. Shift every date in tests/harness/seedData.js by that same offset —');
  console.log('          invoices, payments, purchases, sales, expenses, payroll runs, bills.');
  console.log('       4. Shift the dates in VERIFICATION.md § THE SEED to match.');
  console.log('       5. Re-derive nothing: if the offset is uniform and whole-month, every');
  console.log('          expected VALUE is unchanged — only the period LABELS move.');
  console.log('       6. Re-run step 2. Row counts and read-backs must still match exactly.');
  console.log('');
  console.log('     Preserve the deliberate relationships or the seed stops discriminating:');
  console.log('       · July has NO rent (phantom-accrual detector)');
  console.log('       · May nets exactly 0, June is a LOSS (sign/zero rendering)');
  console.log('       · P0/S0 stay in the PRIOR year (all-time COGS 1,650 != FY 1,400)');
  console.log('       · R3 stays AFTER the pinned clock is passed but within its month');
  console.log('  ⚠️  ══════════════════════════════════════════════════════════════════════');
  console.log('');
  return DRIFT_SENSITIVE_CHECKS.slice();
}

module.exports = { measureDrift, reportDrift, DRIFT_SENSITIVE_CHECKS, localYmd };
