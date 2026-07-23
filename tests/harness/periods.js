'use strict';
/**
 * periods.js — the period windows the CLIENT sends, reproduced exactly.
 *
 * `/api/reports` does not take a period name. It takes `?start=&end=&elapsedMonths=` as ISO
 * instants, computed client-side by `_periodWindow` (app-main.js:1744):
 *
 *     const start = new Date(fyStartYear, fyStartIdx + idx, 1);
 *     const end   = new Date(fyStartYear, fyStartIdx + idx + 1, 1);
 *     …
 *     qs.set('start', w.start.toISOString());
 *
 * Those are LOCAL midnights serialised to UTC. Under GMT-4, local midnight on 1 June 2026 is
 * `2026-06-01T04:00:00.000Z` — NOT `2026-06-01T00:00:00.000Z`. That four-hour offset is the
 * Rule 10 boundary in its live form: a row stamped between 20:00 and 24:00 UTC on 31 May falls
 * inside the June window under this convention and outside it under a naive UTC one.
 *
 * So the harness constructs the window the SAME way the client does, in the pinned zone,
 * rather than inventing a "cleaner" UTC window. Sending a window the client never sends would
 * measure an endpoint nobody calls — and it would very likely look greener.
 *
 * This reproduces the client's WINDOW CONSTRUCTION. It does not reproduce any accounting
 * logic; every figure still comes from the server (Rule 6 — the code must not grade its own
 * homework).
 */

// VERIFICATION Environment: fiscal year starting January ⇒ fyStartIdx 0.
const FY_START_IDX = 0;
const FY_START_YEAR = 2026;

/** Local midnight on the 1st of (year, monthIndex) — `new Date(y, m, 1)`, exactly as the client. */
const localFirst = (year, monthIdx) => new Date(year, monthIdx, 1);

function monthWindow(monthIdx) {
  const start = localFirst(FY_START_YEAR, FY_START_IDX + monthIdx);
  const end = localFirst(FY_START_YEAR, FY_START_IDX + monthIdx + 1);
  return { start, end, elapsedMonths: 1 };
}

function quarterWindow(monthIdx) {
  const q = Math.floor(monthIdx / 3);
  const start = localFirst(FY_START_YEAR, FY_START_IDX + q * 3);
  const end = localFirst(FY_START_YEAR, FY_START_IDX + q * 3 + 3);
  // curFyIdx for the pinned clock (2026-07-25, FY starts January) is 6 → July.
  const elapsed = Math.min(3, Math.max(0, 6 - q * 3 + 1));
  return { start, end, elapsedMonths: elapsed };
}

function yearWindow() {
  const start = localFirst(FY_START_YEAR, FY_START_IDX);
  const end = localFirst(FY_START_YEAR, FY_START_IDX + 12);
  return { start, end, elapsedMonths: 12 };
}

/** The three windows Part A asserts, plus the two quarters. */
const PERIODS = {
  // May closes the A5 gap: VERIFICATION gives expected values for May, Q2 and Q3, but A5's
  // table only enumerates Jun / Jul / FY. May is the period whose Net Profit is exactly ZERO
  // (600 gross profit − 600 opex), which is the only check that exercises zero-vs-empty
  // rendering — an all-positive seed never reaches it.
  may: { label: 'May 2026', ...monthWindow(4) },
  jun: { label: 'Jun 2026', ...monthWindow(5) },
  jul: { label: 'Jul 2026', ...monthWindow(6) },
  fy: { label: 'FY 2026', ...yearWindow() },
  q2: { label: 'Q2 (Apr–Jun)', ...quarterWindow(5) },
  q3: { label: 'Q3 (Jul–Sep)', ...quarterWindow(6) },
};

/** The exact query string the client builds. */
function toQuery(p, extra = {}) {
  const qs = new URLSearchParams({
    start: p.start.toISOString(),
    end: p.end.toISOString(),
    elapsedMonths: String(p.elapsedMonths),
    fyStart: String(FY_START_IDX),
    ...extra,
  });
  return qs.toString();
}

module.exports = { PERIODS, toQuery, monthWindow, quarterWindow, yearWindow, FY_START_IDX };
