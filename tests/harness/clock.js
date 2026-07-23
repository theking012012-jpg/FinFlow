'use strict';
/**
 * clock.js — pinned clock + offline guard for the VERIFICATION harness.
 *
 * MUST be loaded before anything else:  node -r ./tests/harness/clock.js <script>
 * (Loading it late is useless — module-scope `new Date()` calls would already
 * have read the real clock.)
 *
 * WHY THIS EXISTS
 *   computeBooks resolves its 'month' / 'quarter' windows from `const now = new Date()`
 *   (server.js:4041), and the client resolves _periodWindow the same way. An unpinned
 *   clock means the same seed produces different figures tomorrow. Rule 10 (UTC vs local)
 *   makes this sharper still: a record's period membership depends on which side of a
 *   month boundary the wall clock sits.
 *
 * WHAT IS PINNED
 *   Instant : 2026-07-25T12:00:00-04:00  (VERIFICATION.md Environment, as corrected for F82)
 *   Zone    : America/Port_of_Spain — UTC-4 all year, NO DST. Chosen over a bare "GMT-4"
 *             because a DST-observing zone would silently become UTC-5 for part of the year
 *             and reintroduce exactly the drift this file removes.
 *
 * NOTE ON SCOPE: this pins the NODE clock only. Postgres `NOW()` is server-side and is NOT
 * affected — that asymmetry is Rule 10 itself, and the seed must therefore write every
 * date explicitly rather than relying on a database default.
 */

// ── 1 · Timezone ─────────────────────────────────────────────────────────────
// Default is the owner's zone. HARNESS_TZ overrides it so the SAME seed can be read as a
// different VIEWER — the timezone-independence probe (tz-matrix.js) varies only this.
const TZ = process.env.HARNESS_TZ || 'America/Port_of_Spain';
process.env.TZ = TZ;

// ── 2 · Pinned instant ───────────────────────────────────────────────────────
const RealDate = Date;
const PINNED_ISO = '2026-07-25T16:00:00.000Z';   // === 2026-07-25T12:00:00-04:00
const PINNED_MS = RealDate.parse(PINNED_ISO);
if (!Number.isFinite(PINNED_MS)) {
  throw new Error(`[clock] pinned instant "${PINNED_ISO}" did not parse — refusing to run on a real clock.`);
}

// Assert the timezone actually took. process.env.TZ is honoured at runtime by modern Node,
// but it is platform-sensitive; if it silently fails we would compute every local-date
// boundary against the host zone and report confidently wrong period totals. Fail loudly.
// Assert the zone took, by OFFSET rather than by name.
//
// Comparing `Intl.DateTimeFormat().resolvedOptions().timeZone` to TZ is wrong: IANA zone names
// have aliases, and ICU canonicalises them. Asking for "Asia/Kolkata" resolves to
// "Asia/Calcutta" — the same zone under its older name. A string comparison rejects a
// correctly-applied timezone, which is exactly the false failure this assertion must not
// produce. The offset at the pinned instant is the fact that actually matters.
function offsetForZone(tz, atMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new RealDate(atMs)).map((x) => [x.type, x.value]));
  const asUtc = RealDate.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return -(asUtc - atMs) / 60000;          // minutes WEST of UTC, matching getTimezoneOffset()
}

const offsetMin = new RealDate(PINNED_MS).getTimezoneOffset();
const wantOffset = offsetForZone(TZ, PINNED_MS);
if (offsetMin !== wantOffset) {
  throw new Error(
    `[clock] TZ did not take. Asked for "${TZ}" (offset ${wantOffset} min west at the pinned `
    + `instant) but the process resolved ${offsetMin}. Every local-date boundary would be `
    + `computed in the wrong zone. Set TZ=${TZ} in the environment before node starts.`
  );
}

class PinnedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) { super(PINNED_MS); return; }
    super(...args);
  }
  static now() { return PINNED_MS; }
}
global.Date = PinnedDate;

// ── 3 · Offline guard ────────────────────────────────────────────────────────
// VERIFICATION requires the investment price feed frozen. It also requires determinism:
// a run that reaches the network can differ between two runs of the same seed. So every
// non-loopback request is blocked.
//
// LOUDNESS: the app catches its own fetch failures (server.js:4676 wraps the CoinGecko call
// in try/catch and degrades to `{price:null}`), so a thrown error alone would be SWALLOWED
// and the run would look clean. Every blocked attempt is therefore RECORDED here, and the
// run report prints the list. A blocked request must never be invisible.
const blocked = [];
global.__FF_HARNESS_BLOCKED_REQUESTS__ = blocked;

const isLoopback = (host) => {
  if (!host) return false;
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
};

const record = (target, via) => {
  blocked.push({ target, via, at: new RealDate().toISOString() });
};

const realFetch = global.fetch;
if (typeof realFetch === 'function') {
  global.fetch = function (input, init) {
    const url = typeof input === 'string' ? input
      : (input && typeof input.url === 'string') ? input.url
      : String(input);
    let host = null;
    try { host = new URL(url, 'http://127.0.0.1/').hostname; } catch { /* unparseable → block */ }
    if (!isLoopback(host)) {
      record(url, 'fetch');
      return Promise.reject(new Error(
        `[clock/offline] BLOCKED outbound fetch → ${url}\n`
        + `  The harness runs offline so results are deterministic and the price feed stays frozen.\n`
        + `  This attempt has been recorded and will appear in the run report.`
      ));
    }
    return realFetch.apply(this, arguments);
  };
}

// http/https too — the price feeds use fetch, but jsdom's resource loader and any
// library that predates fetch would go through these.
for (const mod of ['http', 'https']) {
  const m = require(mod);
  const realRequest = m.request;
  m.request = function (...args) {
    const opts = typeof args[0] === 'string' || args[0] instanceof URL
      ? { host: (() => { try { return new URL(String(args[0])).hostname; } catch { return null; } })() }
      : (args[0] || {});
    const host = opts.hostname || opts.host || null;
    if (!isLoopback(host)) {
      const target = typeof args[0] === 'string' ? args[0] : `${mod}://${host}`;
      record(target, `${mod}.request`);
      throw new Error(
        `[clock/offline] BLOCKED outbound ${mod} request → ${target}\n`
        + `  Recorded; see the run report.`
      );
    }
    return realRequest.apply(this, args);
  };
}

module.exports = {
  TZ,
  OFFSET_MIN: offsetMin,          // minutes WEST of UTC at the pinned instant (240 = UTC-4)
  PINNED_ISO,
  PINNED_MS,
  RealDate,
  blockedRequests: blocked,
};
