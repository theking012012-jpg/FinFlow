'use strict';
/* F88 step 4 (executed): the client "Scheduled" badge boundary must be the ACTIVE ENTITY's calendar
 * day, not the server's UTC day — matching the per-entity server scheduler (F88 step 3). The pinned
 * instant is 2026-07-25T16:00:00Z (noon UTC-4). At that instant:
 *     UTC / no-tz  → today = 2026-07-25
 *     Asia/Tokyo   → today = 2026-07-26   (UTC+9, already the next day)
 *     America/New_York → today = 2026-07-25 (UTC-4)
 * So ONE doc dated 2026-07-26, with NOTHING changed but the active entity's timezone, must badge
 * "Scheduled" for a New-York entity (still future there) yet NOT for a Tokyo entity (already today
 * there). That flip is the discriminator; a no-tz entity reproduces the old UTC behavior exactly
 * (the regression guard). Drives window._isScheduled directly AND the live renderInvoices renderer. */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

// Mutate the SPA's entity list IN PLACE — index.html binds `const ENTITIES = window.ENTITIES = []`,
// so the lexical ENTITIES and window.ENTITIES are the SAME array; reassigning window.ENTITIES would
// desync them. setActive(tz) leaves one active entity carrying the given timezone (null ⇒ absent).
function makeSetActive(window) {
  return function setActive(tz) {
    const arr = window.ENTITIES;
    arr.length = 0;
    const e = { name: 'E', currency: 'USD', active: true };
    if (tz !== undefined && tz !== null) e.timezone = tz;
    arr.push(e);
  };
}

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  const D = '2026-07-26'; // the boundary date: future in UTC/NY, "today" in Tokyo, at the pinned instant
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(25, 25);
    const doc = window.document;
    const setActive = makeSetActive(window);

    A('window._activeEntityTz is defined', typeof window._activeEntityTz === 'function');
    A('window._isScheduled is defined', typeof window._isScheduled === 'function');

    // ── Regression guard: no active entity, or one with no timezone, ⇒ UTC (byte-identical to before) ──
    window.ENTITIES.length = 0;
    A('no active entity ⇒ _activeEntityTz() is null', window._activeEntityTz() === null);
    A('no-tz path: doc 2026-07-26 is scheduled (UTC today=07-25)', window._isScheduled(D) === true);
    setActive(null); // active entity but timezone absent
    A('absent-tz entity ⇒ _activeEntityTz() null', window._activeEntityTz() === null);
    A('absent-tz: doc 2026-07-26 still scheduled (UTC fallback)', window._isScheduled(D) === true);

    // ── The discriminator: flip ONLY the active entity's timezone, same doc date ──
    setActive('America/New_York');
    A('NY active ⇒ _activeEntityTz() is America/New_York', window._activeEntityTz() === 'America/New_York');
    const schedNY = window._isScheduled(D);
    A('NY entity: doc 2026-07-26 IS scheduled (today there is 07-25)', schedNY === true);

    setActive('Asia/Tokyo');
    A('Tokyo active ⇒ _activeEntityTz() is Asia/Tokyo', window._activeEntityTz() === 'Asia/Tokyo');
    const schedTokyo = window._isScheduled(D);
    A('Tokyo entity: doc 2026-07-26 NOT scheduled (already today there)', schedTokyo === false);

    A('DISCRIMINATOR: same date, badge flips with the active entity timezone', schedNY === true && schedTokyo === false);

    // ── Invalid zone must never throw — safe UTC fallback on the dashboard hot path ──
    setActive('Not/AZone');
    A('invalid tz ⇒ UTC fallback, no throw (doc scheduled)', window._isScheduled(D) === true);

    // ── End-to-end through the live renderer: one doc dated 07-26, badge count flips with entity tz ──
    window.userInvoices = [
      { client: 'BoundaryCo', amount: 1000, status: 'pending', due: '—', color: 'var(--t2)', issue_date: D },
    ];
    A('window.renderInvoices is the runtime renderer', typeof window.renderInvoices === 'function');

    setActive('America/New_York');
    window.renderInvoices();
    let html = (doc.getElementById('invoice-list') || {}).innerHTML || '';
    const nyBadges = (html.match(/>Scheduled</g) || []).length;
    A('renderInvoices badges the doc for the NY entity', nyBadges === 1, `count=${nyBadges}`);

    setActive('Asia/Tokyo');
    window.renderInvoices();
    html = (doc.getElementById('invoice-list') || {}).innerHTML || '';
    const tokyoBadges = (html.match(/>Scheduled</g) || []).length;
    A('renderInvoices does NOT badge the same doc for the Tokyo entity', tokyoBadges === 0, `count=${tokyoBadges}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (client badge boundary is per-entity)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
