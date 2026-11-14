'use strict';
/**
 * verify-n3-28-settings-after-onboarding.js — N3-28 (owner's PowerShell classifier, 2026-11-13).
 * verify-live-retest-2026-10-30's NEW-1 check failed on the owner's machine 1/8 alone and 25/48 under load. Probed here:
 * the SERVER already held Industry "Media & Creative", yet Settings showed "Technology" (the select's first option) for
 * 2.4 s to over 4 s after onboarding — the form waited for a settings re-read queued behind the business reload, and an
 * older boot answer could still land on top. A Save in that window writes "Technology" back over what was just entered.
 *
 * Deterministic here: Chromium (browserKit, real server); every GET /api/settings answer is DELAYED 3 s (a slow network),
 * the wizard is completed through the app's own skipOnboarding(), and Settings is opened at once.
 * EXPECTED: Settings → Industry reads "Media & Creative" immediately, and still does after the delayed answers land.
 * BUG VALUE: "Technology" until the delayed re-read arrives.
 */
const { runBrowser } = require('./browserKit.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

runBrowser('N3-28 — Settings shows the profile just saved at onboarding, at once', async ({ open, eq }) => {
  const page = await open({ width: 1280, height: 900, beforeGoto: async ctx => {
    await ctx.route(/\/api\/settings(\?|$)/, async route => {
      if (route.request().method() === 'GET') await wait(3000);
      return route.continue();
    });
  } });
  await page.waitForFunction(() => { const o = document.getElementById('ob-overlay'); return o && getComputedStyle(o).display !== 'none' && getComputedStyle(o).opacity === '1'; }, null, { timeout: 20000 });
  await page.evaluate(async () => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('ob-biz-name', 'Northwind QA'); set('ob-industry', 'Media & Creative'); set('ob-user-name', 'Sam QA'); set('ob-email', 'qa@finflow.test');
    set('ob-address', '100 Main St'); set('ob-currency', 'USD'); set('ob-country', 'US');
    window.skipOnboarding();             // not awaited: the user does not wait for the background re-read
  });
  // the moment the wizard has saved (its settings PUT answered), open Settings
  // (the wizard is REMOVED only after both saves; an opacity check also matched it before it had faded in)
  await page.waitForFunction(() => !document.getElementById('ob-overlay'), null, { timeout: 20000 });
  const now = await page.evaluate(() => { showPage('settings'); return document.getElementById('s-industry').value; });
  eq('Settings → Industry right after onboarding (no wait for the re-read)', now, 'Media & Creative', 'Technology');
  const name = await page.evaluate(() => document.getElementById('s-biz-name').value);
  eq('…and the business name', name, 'Northwind QA', '');
  await wait(7000);   // every delayed settings answer (boot + re-read) has landed by now
  const later = await page.evaluate(() => document.getElementById('s-industry').value);
  eq('after the delayed answers land, still "Media & Creative" (an older answer never paints over it)', later, 'Media & Creative', 'Technology');
}, { entities: [] });
