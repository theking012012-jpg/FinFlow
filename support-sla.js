'use strict';
// ── Support reply targets (A0 / D-H, owner decision 2026-10-23) ──────────────────────────────────────────────────────
// A ticket's reply-by time = its creation + the plan's reply target in BUSINESS hours: Monday–Friday, 09:00–17:00 in the
// support timezone (SUPPORT_TZ, default UTC). Walked minute by minute in that zone's wall clock, so daylight-saving
// changes and weekends are handled by the same rule. Pure.
const OPEN = 9, CLOSE = 17;
function _local(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { wd: p.weekday, h: Number(p.hour), m: Number(p.minute) };
}
const _open = (ms, tz) => { const l = _local(ms, tz); return l.wd !== 'Sat' && l.wd !== 'Sun' && l.h >= OPEN && l.h < CLOSE; };
// startMs + `hours` business hours → the instant (ms) the reply is due.
function replyBy(startMs, hours, tz) {
  let left = Math.round(Number(hours) * 60);
  let t = Math.floor(startMs / 60000) * 60000;
  const cap = t + 30 * 86400000;              // never walk more than 30 days
  while (left > 0 && t < cap) { if (_open(t, tz)) left--; t += 60000; }
  return t;
}
// "Monday 27 July, 17:00 (UTC)" — how the customer is told.
function describe(ms, tz) {
  const z = tz || 'UTC';
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: z, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ms));
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  return d + ', ' + h + ' (' + z + ')';
}
module.exports = { replyBy, describe, OPEN, CLOSE };
