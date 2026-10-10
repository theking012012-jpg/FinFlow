'use strict';
/**
 * clock-oct.js — pinned clock for the WHOLE-APP SWEEP (dataset A1–A21), which is October-relative.
 * Same machinery as clock.js (pin node Date + TZ + offline guard + fail-latch) but pinned to
 * 2026-10-09 (inside the dataset's "enter on any day 9–31 Oct 2026" window) and WITHOUT clock.js's
 * PIN↔seedData guard — this sweep seeds its own rows through the real routes, it does not use seedData.
 * Postgres NOW() is the real container clock (~2026-10-09), same month, so NOW()-dated rows (payroll
 * run_date, inventory moved_at) also land in October — consistent with the dataset.
 */
const RealDate = Date;
const TZ = process.env.HARNESS_TZ || 'America/Port_of_Spain';
process.env.TZ = TZ;
const PINNED_ISO = process.env.SWEEP_PIN_ISO || '2026-10-09T16:00:00.000Z'; // noon UTC-4, 9 Oct
const PINNED_MS = RealDate.parse(PINNED_ISO);
if (!Number.isFinite(PINNED_MS)) throw new Error('[clock-oct] bad pin ' + PINNED_ISO);

class PinnedDate extends RealDate {
  constructor(...a) { if (a.length === 0) { super(PINNED_MS); return; } super(...a); }
  static now() { return PINNED_MS; }
}
global.Date = PinnedDate;

// offline guard (determinism + frozen price feed); app catches its own fetch errors so record loudly.
const blocked = [];
global.__FF_HARNESS_BLOCKED_REQUESTS__ = blocked;
const isLoopback = (host) => { if (!host) return false; const h = String(host).replace(/^\[|\]$/g, '').toLowerCase(); return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h); };
const realFetch = global.fetch;
if (typeof realFetch === 'function') {
  global.fetch = function (input) {
    const url = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input);
    let host = null; try { host = new URL(url, 'http://127.0.0.1/').hostname; } catch {}
    if (!isLoopback(host)) { blocked.push(url); return Promise.reject(new Error('[clock-oct/offline] blocked ' + url)); }
    return realFetch.apply(this, arguments);
  };
}
module.exports = { TZ, PINNED_ISO, PINNED_MS, RealDate };
