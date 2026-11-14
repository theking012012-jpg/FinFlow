'use strict';
/**
 * verify-n3-28b-wizard-stays-until-saved.js — N3-28, second cause (2026-11-13).
 * Finishing onboarding saves twice: POST /api/entities (the business), then PUT /api/settings (industry, address …).
 * Two older "this account already has a business, so it is past onboarding" rules — loadEntitiesFromDB
 * (app-21-mob-nav-active.js) and _ffDecideOnboarding (app-15-steps.js) — REMOVED the wizard as soon as they saw the business
 * from the first save, while the second was still in flight. Under load (the owner's classifier, live-retest NEW-1 25/48)
 * the app was then usable with Settings on its blank defaults (Industry "Technology"); a Save there writes it back.
 *
 * Deterministic: Chromium on the real server; PUT /api/settings is DELAYED 3 s; once the business POST has answered, both
 * legacy rules are triggered (a boot entity load landing late does exactly this).
 * EXPECTED: the wizard is still on screen while the settings save is in flight; once it is gone, Settings → Industry reads
 * "Media & Creative". BUG VALUE: wizard gone ("gone") while the save is in flight; Industry "Technology".
 */
const { runBrowser } = require('./browserKit.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

runBrowser('N3-28b — the onboarding wizard stays until both of its saves are done', async ({ open, eq }) => {
  const page = await open({ width: 1280, height: 900, beforeGoto: async ctx => {
    await ctx.route(/\/api\/settings(\?|$)/, async route => {
      if (route.request().method() === 'PUT') await wait(3000);
      return route.continue();
    });
  } });
  await page.waitForFunction(() => { const o = document.getElementById('ob-overlay'); return o && getComputedStyle(o).display !== 'none' && getComputedStyle(o).opacity === '1'; }, null, { timeout: 20000 });
  const entCreated = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/entities$/.test(r.url()) && r.status() === 201, { timeout: 20000 });
  await page.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('ob-biz-name', 'Northwind QA'); set('ob-industry', 'Media & Creative'); set('ob-user-name', 'Sam QA'); set('ob-email', 'qa@finflow.test');
    set('ob-address', '100 Main St'); set('ob-currency', 'USD'); set('ob-country', 'US');
    window.skipOnboarding();
  });
  await entCreated;
  // the business exists; the settings save is still in flight (delayed 3 s). A late boot load / auth re-check lands now:
  await page.evaluate(async () => { await window.loadEntitiesFromDB(true); await window._ffDecideOnboarding(); });
  const during = await page.evaluate(() => { const o = document.getElementById('ob-overlay'); return o ? 'on screen' : 'gone'; });
  eq('while the settings save is in flight, the wizard is still on screen', during, 'on screen', 'gone');
  await page.waitForFunction(() => !document.getElementById('ob-overlay'), null, { timeout: 20000 });
  const ind = await page.evaluate(() => { showPage('settings'); return document.getElementById('s-industry').value; });
  eq('once it is gone, Settings → Industry is what was entered', ind, 'Media & Creative', 'Technology');
}, { entities: [] });
