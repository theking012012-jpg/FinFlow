'use strict';
/**
 * verify-resolvedtoday-tz.js (F88 step 2, Rule 10 + Rule 14) — resolvedToday() must resolve a genuine
 * server instant into the ENTITY's calendar date, so a US book and a Trinidad book get their OWN
 * "today" at the day edge, while a no-tz call stays byte-for-byte the UTC phase-1 answer.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-resolvedtoday-tz.js
 *
 * Pure unit test of public/finflow-dates.js (no server / no Postgres). Discriminates (Rule 14): each
 * zoned case is an instant that lands on a DIFFERENT calendar day than UTC — a stub that ignored the
 * zone (the phase-1 behaviour) would return the UTC date and fail. The parity block proves the
 * regression guard: absent/empty tz === the old UTC output, so existing single-arg callers can't move.
 */
const FD = require('../../public/finflow-dates.js');

let pass = 0, fail = 0;
const A = (n, got, want) => {
  const ok = got === want;
  ok ? (pass++, console.log(`  PASS  ${n}  → ${got}`))
     : (fail++, console.log(`  FAIL  ${n}\n          got ${got}  want ${want}`));
};

// ── 1 · the canonical day-edge: 02:00 UTC on Jul 26 is still Jul 25 west of UTC ──
const edge = new Date('2026-07-26T02:00:00Z');
A('UTC (no tz) reads the UTC date',            FD.resolvedToday(edge),                        '2026-07-26');
A('America/Port_of_Spain (UTC-4) → prev day',  FD.resolvedToday(edge, 'America/Port_of_Spain'), '2026-07-25');
A('America/New_York (EDT, UTC-4) → prev day',  FD.resolvedToday(edge, 'America/New_York'),      '2026-07-25');
A('America/Toronto (EDT, UTC-4) → prev day',   FD.resolvedToday(edge, 'America/Toronto'),       '2026-07-25');
A('Asia/Kolkata (UTC+5:30) → same UTC day',    FD.resolvedToday(edge, 'Asia/Kolkata'),          '2026-07-26');
A('Australia/Sydney (UTC+10) → next day',      FD.resolvedToday(edge, 'Australia/Sydney'),      '2026-07-26');

// ── 2 · the scope's named example: 23:30 in Port-of-Spain is still "yesterday" in UTC ──
const late = new Date('2026-07-25T23:30:00-04:00'); // = 2026-07-26T03:30Z
A('23:30 PoS local stays Jul 25 for the entity', FD.resolvedToday(late, 'America/Port_of_Spain'), '2026-07-25');
A('...but that same instant is Jul 26 in UTC',   FD.resolvedToday(late),                          '2026-07-26');

// ── 3 · DST is real, not a fixed offset: New York in January is EST (UTC-5) ──
const ny = new Date('2026-01-01T04:30:00Z');
A('NY winter (EST, UTC-5) crosses the year end', FD.resolvedToday(ny, 'America/New_York'), '2025-12-31');
A('...UTC keeps the new year',                   FD.resolvedToday(ny),                     '2026-01-01');

// ── 4 · fixed offset-in-minutes branch (east of UTC positive) ──
A('offset -240 (UTC-4) matches PoS',    FD.resolvedToday(edge, -240), '2026-07-25');
A('offset +330 (UTC+5:30) matches IST', FD.resolvedToday(edge, 330),  '2026-07-26');

// ── 5 · invalid zone never throws → safe UTC fallback ──
A('junk zone falls back to UTC (no throw)', FD.resolvedToday(edge, 'Pluto/Central'), '2026-07-26');

// ── 6 · REGRESSION GUARD: absent/empty tz is byte-identical to the old UTC output ──
const samples = ['2026-07-26T02:00:00Z', '2026-02-28T23:59:00Z', '2026-12-31T12:00:00Z', '2027-03-01T00:00:00Z'];
let parityOk = true, parityDetail = '';
for (const s of samples) {
  const d = new Date(s);
  const utc = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  if (FD.resolvedToday(d) !== utc || FD.resolvedToday(d, '') !== utc || FD.resolvedToday(d, null) !== utc) {
    parityOk = false; parityDetail += `\n          ${s}: got ${FD.resolvedToday(d)} / '' ${FD.resolvedToday(d, '')} / null ${FD.resolvedToday(d, null)} want ${utc}`;
  }
}
parityOk ? (pass++, console.log('  PASS  no-tz / \'\' / null all == UTC (phase-1 parity, 4 instants)'))
         : (fail++, console.log('  FAIL  phase-1 parity broken' + parityDetail));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F88 resolvedToday phase 2)`);
process.exit(fail ? 1 : 0);
