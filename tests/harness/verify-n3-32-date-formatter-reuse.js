'use strict';
/**
 * verify-n3-32-date-formatter-reuse.js — N3-32 (Lighthouse mobile, 2026-11-14).
 * The single biggest script cost of a signed-in app load was finflow-dates.js `_ymdInZone`: 350 ms (4× CPU), all of it
 * from `_entityToday()` (the business's "today", read on every render). It built a NEW Intl.DateTimeFormat on every call,
 * and building one costs far more than formatting with it.
 *
 * Executed: Chromium on the real server and bundle, the business in America/New_York, 40 invoices. The test counts every
 * Intl.DateTimeFormat construction made with a timeZone during the app's load (an init script wraps the constructor —
 * not read from the source).
 *   EXPECTED: a handful (one per zone in use) — under 10. BUG VALUE: one per _entityToday() call (hundreds).
 * And the answer must not change: _entityToday() is the business's calendar day (New York), checked at a moment where
 * New York and UTC are on different days.
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('N3-32 — the business-date formatter is built once per timezone, not once per call', async ({ open, eq, A, c }) => {
  await c.query(`UPDATE entities SET data = data || '{"timezone":"America/New_York"}'::jsonb`);
  const page = await open({ width: 412, height: 823, beforeGoto: async ctx => {
    await ctx.addInitScript(() => {
      const Orig = Intl.DateTimeFormat; window.__dtfZoned = 0;
      function Wrapped(locales, opts) { if (opts && opts.timeZone) window.__dtfZoned++; return new Orig(locales, opts); }
      Wrapped.prototype = Orig.prototype; Wrapped.supportedLocalesOf = Orig.supportedLocalesOf.bind(Orig);
      Intl.DateTimeFormat = Wrapped;
    });
  } });
  await page.waitForFunction(() => typeof window._entityToday === 'function' && (window.ENTITIES || []).some(e => e.active), null, { timeout: 30000 });
  await page.waitForTimeout(2500);   // let the dashboard's renders run
  const before = await page.evaluate(() => window.__dtfZoned);
  // 200 more reads of the business's today, as renders make
  const after = await page.evaluate(() => { for (let i = 0; i < 200; i++) window._entityToday(); return window.__dtfZoned; });
  console.log(`  info  zoned formatters built: ${before} during the load, ${after - before} more for 200 further _entityToday() calls`);
  A('the app load builds a handful of zoned date formatters (< 10) — bug: one per _entityToday() call', before < 10, String(before));
  A('200 more _entityToday() calls build none (bug: 200)', after - before === 0, String(after - before));
  // same answer: at 02:30 UTC on 25 Jul it is still 24 Jul in New York
  const ny = await page.evaluate(() => window.FinFlowDates.resolvedToday(new Date('2026-07-25T02:30:00Z'), 'America/New_York'));
  const tk = await page.evaluate(() => window.FinFlowDates.resolvedToday(new Date('2026-07-25T02:30:00Z'), 'Asia/Tokyo'));
  const bad = await page.evaluate(() => window.FinFlowDates.resolvedToday(new Date('2026-07-25T02:30:00Z'), 'Not/AZone'));
  eq('New York day at 02:30 UTC 25 Jul (reused formatter)', ny, '2026-07-24', '2026-07-25');
  eq('Tokyo day at the same instant', tk, '2026-07-25');
  eq('an unknown zone still falls back to UTC', bad, '2026-07-25');
  const tz = await page.evaluate(() => window._activeEntityTz());
  eq('the active business is the New York one the test set', tz, 'America/New_York');
}, {});
