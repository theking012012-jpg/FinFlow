'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// finflow-dates.js — CANONICAL calendar-date / period resolver (F87 foundation, phase 1).
//
// SINGLE SOURCE OF TRUTH for period windows and date-in-window tests, shared by the SERVER
// (via `require`) and the CLIENT (via the bundle — `window.FinFlowDates`). The logic lives in
// ONE place so the two engines cannot drift — that drift IS F87 / Rule 10.
//
// THE RULE (Rule 10): an accounting date is a CALENDAR date, not an instant. Comparing Date
// instants forces a timezone and makes the answer depend on WHO IS ASKING. This module compares
// 'YYYY-MM-DD' STRINGS only — there is NO Date-to-Date comparison on any recognition path.
// `new Date()` appears solely to FORMAT a genuine timestamp to its UTC calendar date (via getUTC*,
// which is timezone-independent), never to compare.
//
// PHASE 1 (this file): windows and "today" resolve on the SERVER clock in UTC. Every
// entity-timezone decision is a clearly-marked PHASE 2 HOOK — books have a timezone, viewers
// don't; phase 2 resolves genuine timestamps and "today" against the ENTITY zone.
//
// NOT WIRED YET into computeBooks / the report routes / the client engines. Foundation only.
// ─────────────────────────────────────────────────────────────────────────────

(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // server: require()
  if (typeof window !== 'undefined') window.FinFlowDates = api;                 // client: bundle global
})(function () {
  'use strict';

  var _pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };

  // Absolute-month arithmetic — pure integers, no Date, no TZ. abs = year*12 + month0.
  var _absOf = function (year, month0) { return year * 12 + month0; };
  var _ymdFromAbs = function (abs) {
    return Math.floor(abs / 12) + '-' + _pad2((abs % 12) + 1) + '-01';
  };

  // Format a Date to its UTC calendar date. getUTC* is timezone-independent; used ONLY to format,
  // NEVER to compare. PHASE 2 HOOK: resolve to the entity timezone here instead of UTC.
  var _utcYmd = function (d) {
    return d.getUTCFullYear() + '-' + _pad2(d.getUTCMonth() + 1) + '-' + _pad2(d.getUTCDate());
  };

  var _MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  // Month name / number → 0-11 index. Accepts 0-11, '0'..'11', or an English month name; default January.
  var _monthIndex = function (m) {
    if (m == null) return 0;
    if (typeof m === 'number' && m >= 0 && m <= 11) return m | 0;
    var s = String(m).trim().toLowerCase();
    if (/^\d+$/.test(s)) { var n = parseInt(s, 10); return (n >= 0 && n <= 11) ? n : 0; }
    var i = _MONTHS.indexOf(s);
    return i >= 0 ? i : 0;
  };

  // Reduce any accepted date value to its calendar 'YYYY-MM-DD' — the string-comparison currency.
  var _toYmd = function (v) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : _utcYmd(v);
    if (typeof v === 'number') { var dn = new Date(v); return isNaN(dn.getTime()) ? null : _utcYmd(dn); }
    var s = String(v);
    // Pure date-only string → the date IS the calendar date. Slice directly: no Date, no TZ.
    var m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (m) return m[1];
    // ISO timestamp in UTC (…Z) → the leading date is the UTC calendar date. Slice: no Date.
    m = s.match(/^(\d{4}-\d{2}-\d{2})T[\d:.]+Z$/);
    if (m) return m[1];
    // Any other timestamp (offset-bearing ISO / non-ISO) → format to UTC calendar date.
    // PHASE 2 HOOK: resolve to the entity timezone here instead of UTC.
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : _utcYmd(d);
  };

  // 1 ── resolvedToday(serverNow, tzOrOffset) → 'YYYY-MM-DD'
  // The resolved "today" from the SERVER clock (the caller must pass server time, never the
  // browser clock). Phase 1 resolves UTC — viewer-independent by construction.
  function resolvedToday(serverNow, tzOrOffset) {
    var d = (serverNow instanceof Date) ? serverNow
          : (serverNow == null ? new Date() : new Date(serverNow));
    if (isNaN(d.getTime())) return null;
    // PHASE 2 HOOK: resolve `d` against the entity timezone (tzOrOffset) — books have a zone,
    // viewers don't. Until then, tzOrOffset is intentionally unused and today is the UTC date.
    void tzOrOffset;
    return _utcYmd(d);
  }

  // 2 ── resolvePeriod({ period, monthIdx, fyStartMonth, today }) → { start, end, elapsedMonths }
  // start/end are 'YYYY-MM-DD' strings, half-open [start, end). Reproduces app-main _periodWindow /
  // _fyContext EXACTLY, but computed from the server-resolved `today` string and pure integer
  // month arithmetic — no Date, no TZ.
  function resolvePeriod(opts) {
    var o = opts || {};
    var period = o.period || 'year';
    var fyStartIdx = _monthIndex(o.fyStartMonth);
    var today = _toYmd(o.today) || _utcYmd(new Date());
    var ty = parseInt(today.slice(0, 4), 10);
    var tm0 = parseInt(today.slice(5, 7), 10) - 1;
    // Fiscal-year context from `today` (mirrors _fyContext): the FY containing today, and how many
    // of its months have started as of today.
    var fyStartYear = (tm0 >= fyStartIdx) ? ty : ty - 1;
    var monthsInFY = Math.min(12, Math.max(1, (ty - fyStartYear) * 12 + (tm0 - fyStartIdx) + 1));
    var curFyIdx = Math.min(11, Math.max(0, monthsInFY - 1));
    var base = _absOf(fyStartYear, fyStartIdx);   // absolute month of the fiscal-year start

    if (period === 'month') {
      var idx = (o.monthIdx == null) ? curFyIdx : o.monthIdx;
      var mStart = _ymdFromAbs(base + idx);
      var mEnd = _ymdFromAbs(base + idx + 1);
      return { start: mStart, end: mEnd, elapsedMonths: (mStart <= today) ? 1 : 0 };
    }
    if (period === 'quarter') {
      var anchor = (o.monthIdx == null) ? curFyIdx : o.monthIdx;
      var q = Math.floor(anchor / 3);
      var qStart = _ymdFromAbs(base + q * 3);
      var qEnd = _ymdFromAbs(base + q * 3 + 3);
      var elapsed = Math.min(3, Math.max(0, curFyIdx - q * 3 + 1));
      return { start: qStart, end: qEnd, elapsedMonths: elapsed };
    }
    // year — the whole fiscal year; elapsedMonths = fiscal months started as of today (min 1, cap 12)
    return { start: _ymdFromAbs(base), end: _ymdFromAbs(base + 12), elapsedMonths: monthsInFY };
  }

  // 3 ── inWindow(dateValue, start, end) → boolean. Half-open [start, end), STRING comparison on the
  // 'YYYY-MM-DD' slice. No Date comparison anywhere — that is the whole point (Rule 10).
  function inWindow(dateValue, start, end) {
    var d = _toYmd(dateValue);
    if (d == null || start == null || end == null) return false;
    return d >= start && d < end;
  }

  return {
    resolvedToday: resolvedToday,
    resolvePeriod: resolvePeriod,
    inWindow: inWindow,
    _toYmd: _toYmd,   // exposed for tests (calendar-date reducer)
  };
});
