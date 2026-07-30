'use strict';
/**
 * periods.js — the period INTENT the client sends, reproduced exactly.
 *
 * F87 CONTRACT (post-wiring): `/api/reports` no longer takes a resolved window. It takes INTENT —
 * `?period=year|month|quarter&monthIdx=<0-11>&fyStart=<0-11>` — and resolves the calendar window
 * SERVER-SIDE via finflow-dates. That is the fix: the viewer's local midnight never crosses the
 * wire, so no figure can depend on where the reader sits (Rule 10).
 *
 * Before the wiring, this file built `?start=&end=` from `new Date(y,m,1).toISOString()` — LOCAL
 * midnights serialised to UTC (under GMT-4, 1 June was `2026-06-01T04:00:00.000Z`). That was the
 * Rule 10 boundary in its live form, and it is exactly what the intent contract removes.
 *
 * The PERIODS objects still carry Date-valued `.start`/`.end`/`.elapsedMonths` for the harness's
 * own logging (tz-probe records the window it asked for); `toQuery` ignores them and emits intent.
 * This reproduces the client's REQUEST. It does not reproduce any accounting logic; every figure
 * still comes from the server (Rule 6 — the code must not grade its own homework).
 */

// VERIFICATION Environment: fiscal year starting January ⇒ fyStartIdx 0.
const FY_START_IDX = 0;
const FY_START_YEAR = 2026;

/** Local midnight on the 1st of (year, monthIndex) — `new Date(y, m, 1)`, exactly as the client. */
const localFirst = (year, monthIdx) => new Date(year, monthIdx, 1);

function monthWindow(monthIdx) {
  const start = localFirst(FY_START_YEAR, FY_START_IDX + monthIdx);
  const end = localFirst(FY_START_YEAR, FY_START_IDX + monthIdx + 1);
  return { start, end, elapsedMonths: 1, period: 'month', monthIdx };
}

function quarterWindow(monthIdx) {
  const q = Math.floor(monthIdx / 3);
  const start = localFirst(FY_START_YEAR, FY_START_IDX + q * 3);
  const end = localFirst(FY_START_YEAR, FY_START_IDX + q * 3 + 3);
  // curFyIdx for the pinned clock (2026-07-25, FY starts January) is 6 → July.
  const elapsed = Math.min(3, Math.max(0, 6 - q * 3 + 1));
  return { start, end, elapsedMonths: elapsed, period: 'quarter', monthIdx };
}

function yearWindow() {
  const start = localFirst(FY_START_YEAR, FY_START_IDX);
  const end = localFirst(FY_START_YEAR, FY_START_IDX + 12);
  return { start, end, elapsedMonths: 12, period: 'year', monthIdx: null };
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
  // F87 intent contract: period + monthIdx + fyStart. No start/end — the server resolves the
  // calendar window itself, so nothing timezone-dependent crosses the wire.
  const params = { fyStart: String(FY_START_IDX), period: p.period, ...extra };
  if (p.period !== 'year' && p.monthIdx != null) params.monthIdx = String(p.monthIdx);
  return new URLSearchParams(params).toString();
}

module.exports = { PERIODS, toQuery, monthWindow, quarterWindow, yearWindow, FY_START_IDX };
