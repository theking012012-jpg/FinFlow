'use strict';
/**
 * verify-n3-5-portfolio-baseline.js — N3-5 (live re-audit 2026-11-11).
 * Personal Investments → Performance read "Portfolio +149900.0% since 2026-11-10". Cause: the caption divides by the
 * FIRST portfolio snapshot and uses `pts[0] || 1` — the first snapshot was captured (11-10) before any holding existed,
 * value 0, so the baseline became 1: (1,500 − 1) / 1 = +149,900 %. N3-13 (market price) does not fix it — with 3,485 it
 * would read +348,410 %. A zero (empty-portfolio) snapshot must never be the baseline.
 *
 * Real SPA (jsdom) + real server: portfolio snapshots are rows in the real `snapshots` table, loaded through the page's
 * own loadPortfolioSnapshots() (GET /api/snapshots?kind=portfolio). Chart drawing is not exercised (no layout/canvas in
 * jsdom) — the canvas is given a width and Chart is a no-op stand-in; the caption TEXT is the page's own output.
 * Seed: portfolio snapshots 2026-07-01 = 0 (before any holding), 2026-07-10 = 1,500, 2026-07-20 = 1,650; one holding.
 * HAND-COMPUTED: baseline = first NON-ZERO point 1,500 (07-10) → (1,650 − 1,500) / 1,500 = +10.0 % since 2026-07-10.
 * BUG VALUE: +164,900.0 % since 2026-07-01 ((1,650 − 1) / 1). With only {0, 1,500}: no figure (history still building),
 * bug +149,900.0 %.
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  N3-5 — a zero (empty-portfolio) snapshot is never the performance baseline\n' + '='.repeat(78) + '\n');
    let UID;
    ctx = await bootSpaInJsdom({
      baseSeed: true,
      seedExtra: async (c, uid) => {
        UID = uid;
        await c.query(`INSERT INTO holdings (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`, [uid, { ticker: 'AAPL', name: 'Apple', asset_type: 'Stock', shares: 10, cost_per: 150, price: 165 }]);
        for (const [d, v] of [['2026-07-01', 0], ['2026-07-10', 1500], ['2026-07-20', 1650]])
          await c.query(`INSERT INTO snapshots (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`, [uid, { kind: 'portfolio', date: d, value: v }]);
      },
    });
    const { window: w, client: c } = ctx;
    await w.loadPortfolioSnapshots(); await new Promise(r => setTimeout(r, 300));
    const all = (w._portSnapshots || []).slice();
    A('the page loaded the real snapshots (0 / 1,500 / 1,650)', all.some(s => s.date === '2026-07-01' && s.value === 0) && all.some(s => s.date === '2026-07-20' && s.value === 1650), JSON.stringify(all));
    // The caption is written by the page's own buildInvPerfChart. jsdom has no layout, so the canvas is given a width and
    // Chart is a no-op stand-in — chart DRAWING is not exercised; the caption TEXT is the real code's output.
    const cv = w.document.getElementById('invPerfChart');
    Object.defineProperty(cv, 'offsetWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(cv, 'offsetParent', { configurable: true, get: () => w.document.body });
    if (typeof w.Chart === 'undefined') w.Chart = function () { this.destroy = () => {}; };
    cv.getContext = () => ({ createLinearGradient: () => ({ addColorStop() {} }), clearRect() {} });
    const caption = snaps => { w._portSnapshots = snaps; w.document.getElementById('inv-perf-return').textContent = ''; w.buildInvPerfChart('1m'); return w.document.getElementById('inv-perf-return').textContent; };
    const t1 = caption(all.filter(s => s.date <= '2026-07-20'));
    A('caption "Portfolio +10.0% since 2026-07-10" — baseline = first NON-ZERO point (bug: +164900.0% since 2026-07-01)', t1 === 'Portfolio +10.0% since 2026-07-10', JSON.stringify(t1));
    const t2 = caption(all.filter(s => s.date <= '2026-07-10'));
    A('only {0, 1,500}: "builds over time" message, no % (bug: +149900.0%)', !/%/.test(t2) && /builds over time/.test(t2), JSON.stringify(t2));
    void c; void UID;
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-5 portfolio baseline)'));
  process.exit(fail ? 1 : 0);
})();
