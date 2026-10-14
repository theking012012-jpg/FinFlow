'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// finflow-counter.js — the stat-card count-up animation (LA1, live audit 2026-10-13 B1).
//
// THE DEFECT: the animation read a card's text ONCE, at its start, and then wrote that value on
// every frame for ~700 ms — including a final write of the snapshot. A card that still showed the
// pre-data "$0" when the animation started (boot paints from empty stores; Investments and
// Outstanding are exact amounts such as "$2,700", which the counter matches) had its REAL value,
// painted by the canonical writer moments later, overwritten with "$0" by the last frame. Random,
// because it depends on whether the data lands inside the animation window; the caption under the
// card is not animated, which is how the dashboard showed "$0 · +81%".
//
// THE RULE: an animation is decoration and is never the writer of a value. Each frame first checks
// that the card still shows what the animation last wrote; if anything else has written since, that
// writer owns the card and the animation stops. A zero target is not animated at all.
//
// Lives in its own file (loaded before app-main.js) so it can be executed directly by a test
// (tests/harness/verify-la1-counter-race.js) — the same split as finflow-dates.js.
// ─────────────────────────────────────────────────────────────────────────────

(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.FinFlowCounter = api;
    window.animateCounter = api.animateCounter;
    window.animateCounters = api.animateCounters;
  }
})(function () {
  'use strict';

  function _raf(cb) {
    var w = (typeof window !== 'undefined') ? window : null;
    if (w && typeof w.requestAnimationFrame === 'function') return w.requestAnimationFrame(cb);
    return setTimeout(function () { cb(Date.now()); }, 16);
  }
  function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function animateCounter(el, target, prefix, suffix, duration) {
    if (!el) return;
    prefix = prefix || ''; suffix = suffix || ''; duration = duration || 600;
    if (!target) return;   // nothing to count up to — and a 0 snapshot must never be replayed over a later value
    var start = _now();
    var isFloat = String(target).indexOf('.') !== -1;
    var fmt = function (v) { return prefix + (isFloat ? v.toFixed(1) : Math.round(v).toLocaleString()) + suffix; };
    var expected = el.textContent;   // what the card shows now; any other text later means another writer painted
    function tick(now) {
      if (el.textContent !== expected) return;   // a newer value was written — it owns the card; stop
      var progress = Math.min((now - start) / duration, 1);
      var ease = 1 - Math.pow(1 - progress, 3);   // ease-out cubic
      var txt = progress < 1 ? fmt(target * ease) : fmt(target);
      el.textContent = txt;
      expected = el.textContent;
      if (progress < 1) _raf(tick);
    }
    _raf(tick);
  }

  function animateCounters(page) {
    if (!page || !page.querySelectorAll) return;
    page.querySelectorAll('.mc-val').forEach(function (el) {
      var text = el.textContent.trim();
      // Match $1,234 or 52% or 9.5h etc
      var mDollar = text.match(/^\$?([\d,]+)$/);
      var mPct = text.match(/^(\d+)%$/);
      var mHours = text.match(/^([\d.]+)h$/);
      var mGB = text.match(/^([\d.]+)\s*GB$/);
      if (mDollar) animateCounter(el, parseInt(mDollar[1].replace(/,/g, ''), 10), text.charAt(0) === '$' ? '$' : '', '', 700);
      else if (mPct) animateCounter(el, parseInt(mPct[1], 10), '', '%', 600);
      else if (mHours) animateCounter(el, parseFloat(mHours[1]), '', 'h', 500);
      else if (mGB) animateCounter(el, parseFloat(mGB[1]), '', '  GB', 500);
    });
  }

  return { animateCounter: animateCounter, animateCounters: animateCounters };
});
