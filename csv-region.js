'use strict';
/**
 * csv-region.js — N40. Region-aware parsing of the dates and amounts in an imported CSV / bank statement.
 *
 * FinFlow imports files from ~53 countries. The parsers used `new Date(text)` (US month-first: a DD/MM bank's
 * 03/04/2026 became 4 March → 3 April misfiled; an unparseable date silently became TODAY) and stripped every
 * character but digits/'.'/'-' from amounts ("1.234,56" → 1.23456, "(123.45)" → +123.45).
 *
 * A file is ONE convention, so the day/month order and the decimal mark are detected from the whole COLUMN:
 *   dates   — any first part > 12 ⇒ day-first; any second part > 12 ⇒ month-first; both seen ⇒ the column is
 *             inconsistent (rows rejected); neither ⇒ the business's country convention, reported as ASSUMED.
 *   amounts — a value with both '.' and ',' ⇒ the LAST one is the decimal mark; a lone ',' followed by 1–2
 *             digits at the end ⇒ decimal comma. Parentheses or a trailing '-' ⇒ negative.
 * A date that is present but cannot be read is NOT replaced by today — the row is rejected.
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// Countries whose banks write month-first numeric dates.
const MONTH_FIRST = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'PH', 'FM', 'MH', 'PW', 'CA', 'BZ']);
const NUMERIC = /^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})$/;

const pad = n => String(n).padStart(2, '0');
const monthOf = w => { const k = String(w || '').toLowerCase(); return MONTHS[k.slice(0, 4)] || MONTHS[k.slice(0, 3)] || null; };
function ymd(y, m, d) {
  if (y < 100) y += 2000;
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// 'dmy' | 'mdy' | 'mixed' | null (no disambiguating value) for a column of raw date strings.
function detectDateOrder(values) {
  let dayFirst = false, monthFirst = false;
  for (const v of values || []) {
    const m = NUMERIC.exec(String(v == null ? '' : v).trim().split(/[ T]/)[0]);
    if (!m || m[1].length === 4) continue;           // year-first is unambiguous
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dayFirst = true;
    if (b > 12 && a <= 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) return 'mixed';
  return dayFirst ? 'dmy' : monthFirst ? 'mdy' : null;
}

function defaultOrderFor(country) { return MONTH_FIRST.has(String(country || '').toUpperCase()) ? 'mdy' : 'dmy'; }

// One date → 'YYYY-MM-DD' or null. order: 'dmy' | 'mdy'.
function parseDate(value, order) {
  const t = String(value == null ? '' : value).trim();
  if (!t) return null;
  const head = t.split(/[ T]/)[0];
  let m = NUMERIC.exec(head);
  if (m) {
    if (m[1].length === 4) return ymd(+m[1], +m[2], +m[3]);                 // YYYY-MM-DD / YYYY/MM/DD
    return order === 'mdy' ? ymd(+m[3], +m[1], +m[2]) : ymd(+m[3], +m[2], +m[1]);
  }
  m = /^(\d{1,2})[\s\-]+([A-Za-z]{3,9})\.?[\s\-,]+(\d{2,4})$/.exec(t);      // 10 Jul 2026 / 10-Jul-26
  if (m && monthOf(m[2])) return ymd(+m[3], monthOf(m[2]), +m[1]);
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(t);              // Jul 10, 2026
  if (m && monthOf(m[1])) return ymd(+m[3], monthOf(m[1]), +m[2]);
  return null;
}

// '.' | ',' for a column of raw amount strings.
function detectDecimalMark(values) {
  let comma = 0, dot = 0;
  for (const v of values || []) {
    const s = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) { lc > ld ? comma++ : dot++; continue; }
    if (lc >= 0 && /,\d{1,2}$/.test(s)) comma++;
    else if (ld >= 0 && /\.\d{1,2}$/.test(s)) dot++;
  }
  return comma > dot ? ',' : '.';
}

// One amount → number (NaN when unreadable). mark: the column's decimal mark.
function parseAmount(value, mark = '.') {
  let s = String(value == null ? '' : value).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  if (/^\s*-/.test(s) || /^[^\d]*-/.test(s)) neg = true;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const thousands = mark === ',' ? '.' : ',';
  s = s.split(thousands).join('');
  if (mark === ',') s = s.replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return NaN;
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

module.exports = { detectDateOrder, defaultOrderFor, parseDate, detectDecimalMark, parseAmount };
