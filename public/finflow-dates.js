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

  // F88 PHASE 2: format a Date to its calendar date IN A GIVEN IANA ZONE. Intl.DateTimeFormat handles
  // DST and offset for real; formatToParts with 2-digit month/day gives a zero-padded 'YYYY-MM-DD'.
  // An unknown zone throws RangeError — resolvedToday catches it and falls back to UTC. Still a pure
  // FORMAT of a genuine instant to a calendar date, never a Date-to-Date comparison (Rule 10).
  var _ymdInZone = function (d, tz) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    var y = '', m = '', day = '';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'year') y = parts[i].value;
      else if (parts[i].type === 'month') m = parts[i].value;
      else if (parts[i].type === 'day') day = parts[i].value;
    }
    return y + '-' + m + '-' + day;
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

  // FA-L3f: a calendar date (a DATE column, a month bucket) as a display label. Built from its 'YYYY-MM-DD' and
  // formatted AT UTC, so every viewer reads the same day / month. new Date('2026-10-01').toLocaleDateString() is UTC
  // midnight shown in the viewer's zone — "Sep 2026" for anyone west of UTC.
  var calendarLabel = function (v, options, locale) {
    var ymd = _toYmd(v);
    if (!ymd) return null;
    var p = ymd.split('-');
    var o = {};
    for (var k in (options || {})) if (Object.prototype.hasOwnProperty.call(options, k)) o[k] = options[k];
    o.timeZone = 'UTC';
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString(locale || 'en-US', o);
  };

  // 1 ── resolvedToday(serverNow, tzOrOffset) → 'YYYY-MM-DD'
  // The resolved "today" from the SERVER clock (the caller must pass server time, never the
  // browser clock). Phase 1 resolves UTC — viewer-independent by construction.
  function resolvedToday(serverNow, tzOrOffset) {
    var d = (serverNow instanceof Date) ? serverNow
          : (serverNow == null ? new Date() : new Date(serverNow));
    if (isNaN(d.getTime())) return null;
    // F88 PHASE 2: resolve `d` against the ENTITY timezone — books have a zone, viewers don't.
    // Absent/empty ⇒ UTC, so every existing single-arg caller is byte-for-byte unchanged (the
    // regression guard: a UTC-zone entity's "today" must not move).
    if (tzOrOffset == null || tzOrOffset === '') return _utcYmd(d);
    // A fixed offset in MINUTES east of UTC (e.g. -240 for UTC-4): shift the instant, read UTC parts.
    if (typeof tzOrOffset === 'number' && isFinite(tzOrOffset)) {
      return _utcYmd(new Date(d.getTime() + tzOrOffset * 60000));
    }
    // An IANA zone name (what entity.timezone stores). Invalid zone ⇒ safe UTC fallback — never throw,
    // this sits on the dashboard hot path; writes are validated at /api/entities anyway.
    try { return _ymdInZone(d, String(tzOrOffset)); }
    catch (_) { return _utcYmd(d); }
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

  // F195: format a CALENDAR date for DISPLAY without ever constructing a Date from a date-only string.
  // The bug this replaces: `new Date('2026-08-16').toLocaleDateString()` parses the date-only value as UTC
  // midnight and renders it in the VIEWER's zone, so west of UTC it rolls back a day (Rule 10, display
  // side). fmtLabel reduces via _toYmd (string slice — no Date, no TZ for a date-only or …Z value) and
  // builds the label from the YMD parts. opts: { month:'short'|'long' (default short), year:bool (default
  // false) }. "Aug 16" by default; "Aug 16 2026" with year; "August 16" with month:'long'.
  var _LBL_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var _LBL_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var fmtLabel = function (v, opts) {
    var ymd = _toYmd(v);
    if (!ymd) return '';
    opts = opts || {};
    var p = ymd.split('-');
    var mon = (opts.month === 'long' ? _LBL_LONG : _LBL_SHORT)[parseInt(p[1], 10) - 1] || '';
    var s = mon + ' ' + parseInt(p[2], 10);
    if (opts.year) s += ' ' + p[0];
    return s;
  };

  // Payroll run `period` → accrual date 'YYYY-MM-01'. F-H1: the client stores period as a DISPLAY
  // string ("July 2026", toLocaleString month:'long'+year), not 'YYYY-MM' — so the old
  // period.slice(0,7)+'-01' produced "July 2-01" (invalid), payroll matched no period and never hit
  // opex/net profit. Handles 'YYYY-MM', 'YYYY-MM-DD', and 'Month YYYY'; falls back to run_date.
  var payrollPeriodYmd = function (period, runDate) {
    var p = period == null ? '' : String(period).trim();
    var m = p.match(/^(\d{4})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-01';
    m = p.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
      var name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      var idx = _LBL_LONG.indexOf(name);
      if (idx >= 0) return m[2] + '-' + (idx + 1 < 10 ? '0' : '') + (idx + 1) + '-01';
    }
    return _toYmd(runDate) || null;
  };

  // M15 (money audit 2026-10-09): the ONE reader of an expense's `deductible` flag, shared by the server
  // (computeBooks tax leg) and every client surface (Expenses page, Tax-Deductible report, expense list label,
  // CSV export). Four readers used to disagree: 'Yes' counted on the server but not the Expenses page, the
  // scanner's boolean true counted only in the report, and a missing flag (CSV / Codat imports) was labelled
  // "100% deductible" while counting 0. Stored vocabulary going forward is 'yes' | 'half' | 'no' (writers
  // normalise with normalizeDeductible); legacy values are read through this map. Anything unknown → 0.
  var deductibleFactor = function (v) {
    if (v === true) return 1;
    if (v === false || v == null) return 0;
    var d = String(v).trim().toLowerCase();
    if (d === 'yes' || d === 'y' || d === 'true' || d === '1' || d === '100' || d === '100%' || d === 'full') return 1;
    if (d === 'half' || d === '50' || d === '50%' || d === '0.5') return 0.5;
    return 0;
  };
  var normalizeDeductible = function (v) { var f = deductibleFactor(v); return f === 1 ? 'yes' : f === 0.5 ? 'half' : 'no'; };

  // M34 (fix pass round 2): ONE rule for "this bill is an operating expense", server and client. A recognised bill
  // (issued: unpaid / due_soon / overdue / partial / paid) is opex at its full amount by issue date — EXCEPT a bill
  // created by a stock purchase on credit (inventory_movement_id): that cost is inventory (Dr 1200 / Cr 2000, posted
  // by the movement) and reaches the P&L once, as COGS when sold. Every bill still counts in accounts payable.
  var RECOGNIZED_BILL_STATUSES = ['unpaid', 'due_soon', 'overdue', 'partial', 'paid'];
  var isInventoryBill = function (b) { return !!(b && b.inventory_movement_id != null && b.inventory_movement_id !== ''); };
  var isOpexBill = function (b) { return !!b && RECOGNIZED_BILL_STATUSES.indexOf(String(b.status || '').toLowerCase()) !== -1 && !isInventoryBill(b); };

  // M60 (personal bank feed): a personal transaction is income or an expense. Bank-feed rows written before M60 (an
  // account with no business, whose bank feed is its personal feed) say the bank's direction instead — credit (money
  // in) / debit (money out) — and every Personal total that reads only 'income' / 'expense' dropped them. ONE reading,
  // used by the Personal page and the accountant portal (whose SQL sum mirrors it: income = 'income' or 'credit').
  var personalTxType = function (t) {
    var v = String((t && t.tx_type) || '').toLowerCase();
    return v === 'credit' || v === 'income' ? 'income' : 'expense';
  };

  // M62: the currency a bank in this country books in — the default for the Personal "Your bank" card (the person can
  // change it: a bank account has its own currency). One table for the server and the card; it covers every country the
  // app offers. Unknown → null (the caller asks, never guesses).
  var BANK_COUNTRY_CURRENCY = {
    CA: 'CAD', US: 'USD', MX: 'MXN', GT: 'GTQ', BZ: 'BZD', SV: 'USD', HN: 'HNL', NI: 'NIO', CR: 'CRC', PA: 'PAB',
    BR: 'BRL', AR: 'ARS', CO: 'COP', CL: 'CLP', PE: 'PEN', VE: 'VES', EC: 'USD', BO: 'BOB', PY: 'PYG', UY: 'UYU',
    GY: 'GYD', SR: 'SRD', TT: 'TTD', JM: 'JMD', BB: 'BBD', BS: 'BSD', DO: 'DOP', HT: 'HTG', GD: 'XCD', LC: 'XCD',
    VC: 'XCD', AG: 'XCD', DM: 'XCD', KN: 'XCD', CU: 'CUP', PR: 'USD', GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR',
    ES: 'EUR', PT: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', SE: 'SEK', NO: 'NOK', DK: 'DKK', FI: 'EUR', PL: 'PLN',
    CH: 'CHF', AT: 'EUR', GR: 'EUR',
  };
  var currencyForCountry = function (iso) { return BANK_COUNTRY_CURRENCY[String(iso || '').toUpperCase()] || null; };

  return {
    personalTxType: personalTxType,
    currencyForCountry: currencyForCountry,
    deductibleFactor: deductibleFactor,
    normalizeDeductible: normalizeDeductible,
    RECOGNIZED_BILL_STATUSES: RECOGNIZED_BILL_STATUSES,
    isInventoryBill: isInventoryBill,
    isOpexBill: isOpexBill,
    resolvedToday: resolvedToday,
    payrollPeriodYmd: payrollPeriodYmd,
    resolvePeriod: resolvePeriod,
    inWindow: inWindow,
    calendarLabel: calendarLabel,
    _toYmd: _toYmd,   // exposed for tests (calendar-date reducer)
    fmtLabel: fmtLabel,   // F195: timezone-safe calendar-date display label
  };
});
