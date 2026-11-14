'use strict';
/**
 * verify-n3-32b-splash-paints-first.js — N3-32 (Lighthouse mobile, 2026-11-14).
 * F151's boot splash exists so that nothing half-loaded is ever shown. But it sat at the END of the /app page (line
 * ~2,400 of 320 KB), so the browser painted the empty dashboard above it first — Lighthouse's first painted element was
 * the dashboard's "⬇ Export PDF" button (688 ms), the splash only at 912 ms. Now it is the first thing in the body.
 *
 * Executed: Chromium on the real server and page, CPU slowed 4× (as Lighthouse's mobile run), a PerformanceObserver
 * recording every largest-contentful-paint candidate from the first frame.
 *   EXPECTED: the FIRST thing painted is inside #ff-splash. BUG VALUE: a dashboard element ("⬇ Export PDF", #exportBtn).
 * F151 is unchanged: once the books load the splash is lifted and the dashboard shows (checked here and by
 * verify-f151-boot-splash).
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('N3-32b — the boot splash is the first thing painted, not a half-built dashboard', async ({ open, eq, A }) => {
  let cdpPage = null;
  const page = await open({ width: 412, height: 823, beforeGoto: async (ctx) => {
    await ctx.addInitScript(() => {
      window.__lcp = [];
      new PerformanceObserver(l => l.getEntries().forEach(e => {
        const el = e.element; const sp = document.getElementById('ff-splash');
        window.__lcp.push({ t: Math.round(e.startTime), inSplash: !!(el && sp && sp.contains(el)), id: el ? (el.id || el.tagName) : null, text: el ? (el.textContent || '').trim().slice(0, 40) : null });
      })).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    ctx.on('page', async p => { try { const s = await ctx.newCDPSession(p); await s.send('Emulation.setCPUThrottlingRate', { rate: 4 }); cdpPage = s; } catch (_) {} });
  } });
  await page.waitForFunction(() => { const s = document.getElementById('ff-splash'); return s && (s._ffHidden || getComputedStyle(s).display === 'none' || getComputedStyle(s).opacity === '0'); }, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const lcp = await page.evaluate(() => window.__lcp);
  console.log('  info  paint candidates: ' + JSON.stringify(lcp));
  A('the first thing painted is the boot splash (bug: a dashboard element, e.g. "⬇ Export PDF")', lcp.length > 0 && lcp[0].inSplash, JSON.stringify(lcp[0]));
  const shown = await page.evaluate(() => { const s = document.getElementById('ff-splash'); return { splashGone: !!s && (s._ffHidden || getComputedStyle(s).display === 'none' || getComputedStyle(s).opacity === '0'), dash: !!document.getElementById('d-chart-title') }; });
  A('…and once the books load the splash is lifted and the dashboard is there (F151 unchanged)', shown.splashGone && shown.dash, JSON.stringify(shown));
}, {});
