'use strict';
/* F88 step 5 — BYTE-IDENTICAL REGRESSION GUARD for UTC / no-timezone entities.
 *
 * The whole F88 promise is additive: entities that carry a timezone resolve "today" in their own zone
 * (steps 2-4), but every entity that DOESN'T — the default, and every legacy row created before F88 —
 * must behave EXACTLY as it did in phase 1 (UTC), down to the byte. Every pre-F88 caller invoked
 * resolvedToday with a SINGLE argument; that contract must never move.
 *
 * This is a pure require() tripwire (no Postgres, no jsdom) so it runs in milliseconds and stays green
 * for free — its job is to go RED the instant a future step (step 6 country/holiday shifting) leaks
 * into the no-timezone path. The ground truth is FinFlowDates._toYmd(instant), which for a Date returns
 * the UTC calendar date — precisely what phase-1 resolvedToday returned.
 *
 *   node tests/harness/verify-f88-utc-parity.js
 */
const FinFlowDates = require('../../public/finflow-dates.js');

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    const { resolvedToday, _toYmd } = FinFlowDates;

    // A broad instant matrix, deliberately including UTC day EDGES (23:59:59Z belongs to one UTC day,
    // 00:00:00Z to the next) — the times most likely to shift if a zone leaks into the no-tz path.
    const INSTANTS = [
      '2026-07-25T16:00:00.000Z', // the pinned instant
      '2026-07-25T00:00:00.000Z', // UTC midnight (start of day)
      '2026-07-25T23:59:59.000Z', // one second before the next UTC day
      '2026-01-01T00:00:00.000Z', // year boundary
      '2026-12-31T23:59:59.000Z', // year boundary, other edge
      '2026-03-08T07:30:00.000Z', // US DST spring-forward morning (must NOT matter with no tz)
      '2026-02-28T23:59:00.000Z', // month/leap-adjacent edge
      '2024-02-29T12:00:00.000Z', // leap day itself
    ];

    for (const iso of INSTANTS) {
      const now = new Date(iso);
      const utc = _toYmd(now); // === phase-1 resolvedToday(now)
      // Every shape a pre-F88 or no-timezone caller can produce must equal the UTC calendar date.
      A(`single-arg legacy caller unchanged @ ${iso} ⇒ ${utc}`, resolvedToday(now) === utc, `got ${resolvedToday(now)}`);
      A(`null tz ⇒ UTC @ ${iso}`, resolvedToday(now, null) === utc, `got ${resolvedToday(now, null)}`);
      A(`empty-string tz ⇒ UTC @ ${iso}`, resolvedToday(now, '') === utc, `got ${resolvedToday(now, '')}`);
      A(`undefined tz ⇒ UTC @ ${iso}`, resolvedToday(now, undefined) === utc, `got ${resolvedToday(now, undefined)}`);
      // A zero numeric offset is UTC too — the offset branch's identity element.
      A(`0-minute offset ⇒ UTC @ ${iso}`, resolvedToday(now, 0) === utc, `got ${resolvedToday(now, 0)}`);
      // Passing the instant as epoch-ms (another legacy shape) must also resolve UTC with no tz.
      A(`epoch-ms serverNow, no tz ⇒ UTC @ ${iso}`, resolvedToday(now.getTime()) === utc, `got ${resolvedToday(now.getTime())}`);
    }

    // Explicit proof the guard has teeth: a real east-of-UTC zone DOES move a day-edge instant, so a
    // green no-tz block above is a genuine invariant, not a no-op. At 23:59:59Z on 07-25, Asia/Tokyo
    // (UTC+9) is already 07-26 — different from the UTC 07-25. If this ever equals UTC, the tz path is
    // dead and the parity assertions above would be meaningless.
    const edge = new Date('2026-07-25T23:59:59.000Z');
    A('sanity: Asia/Tokyo DOES shift the day-edge (guard is meaningful)',
      resolvedToday(edge, 'Asia/Tokyo') === '2026-07-26' && _toYmd(edge) === '2026-07-25',
      `tokyo=${resolvedToday(edge, 'Asia/Tokyo')} utc=${_toYmd(edge)}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (UTC/no-tz entities byte-identical to phase 1)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
