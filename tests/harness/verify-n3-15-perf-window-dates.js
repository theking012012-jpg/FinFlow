'use strict';
/**
 * verify-n3-15-perf-window-dates.js — N3-15 (found reading N3-5, 2026-11-11). Rule 10 instance.
 * Investments → Performance "1M" window filtered snapshots with `new Date(s.date) >= cutoff`: a date-only string parsed
 * to UTC MIDNIGHT compared with "now minus 1 month" as an INSTANT (carrying the time of day). The window's own first
 * day therefore dropped out — for every viewer west of UTC and at UTC too, whatever the hour.
 *
 * Real SPA (jsdom) + real server; real `snapshots` rows loaded by the page's own loadPortfolioSnapshots(); the caption
 * is buildInvPerfChart's own output (chart drawing stubbed — no layout in jsdom). Clock pinned 2026-07-25T16:00Z.
 * Seed: portfolio 06-24 = 1,000 · 06-25 = 1,200 · 06-26 = 1,250 · 07-20 = 1,500.
 * HAND-COMPUTED (window "1M" = the viewer's today minus one calendar month, compared as DATE STRINGS, inclusive):
 *   Port_of_Spain / UTC (today 07-25 → from 06-25): (1,500 − 1,200) / 1,200 = +25.0 % since 2026-06-25
 *   Asia/Tokyo         (today 07-26 → from 06-26): (1,500 − 1,250) / 1,250 = +20.0 % since 2026-06-26
 * BUG VALUE (Port_of_Spain / UTC): +20.0 % since 2026-06-26 — 06-25 dropped. Tokyo happens to agree on the old code.
 * Run under HARNESS_TZ = (default) · UTC · Asia/Tokyo — the matrix spans the sign boundary (Rule 10 testing corollary).
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const TZ = process.env.HARNESS_TZ || 'America/Port_of_Spain';
const EXPECT = TZ === 'Asia/Tokyo' ? 'Portfolio +20.0% since 2026-06-26' : 'Portfolio +25.0% since 2026-06-25';

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  N3-15 — the Investments 1M window compares dates as dates (viewer ' + TZ + ')\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({
      baseSeed: true,
      seedExtra: async (c, uid) => {
        await c.query(`INSERT INTO holdings (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`, [uid, { ticker: 'AAPL', name: 'Apple', asset_type: 'Stock', shares: 10, cost_per: 100, price: 150 }]);
        for (const [d, v] of [['2026-06-24', 1000], ['2026-06-25', 1200], ['2026-06-26', 1250], ['2026-07-20', 1500]])
          await c.query(`INSERT INTO snapshots (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`, [uid, { kind: 'portfolio', date: d, value: v }]);
      },
    });
    const { window: w } = ctx;
    await w.loadPortfolioSnapshots(); await new Promise(r => setTimeout(r, 300));
    const seeded = (w._portSnapshots || []).filter(s => s.date <= '2026-07-20');
    A('the page loaded the four seeded snapshots', seeded.length === 4, JSON.stringify(w._portSnapshots));
    const cv = w.document.getElementById('invPerfChart');
    Object.defineProperty(cv, 'offsetWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(cv, 'offsetParent', { configurable: true, get: () => w.document.body });
    if (typeof w.Chart === 'undefined') w.Chart = function () { this.destroy = () => {}; };
    cv.getContext = () => ({ createLinearGradient: () => ({ addColorStop() {} }), clearRect() {} });
    w._portSnapshots = seeded; w.buildInvPerfChart('1m');
    const t = w.document.getElementById('inv-perf-return').textContent;
    A('1M caption "' + EXPECT + '" (bug at UTC / west of UTC: "+20.0% since 2026-06-26")', t === EXPECT, JSON.stringify(t));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-15 perf window dates, ' + TZ + ')'));
  process.exit(fail ? 1 : 0);
})();
