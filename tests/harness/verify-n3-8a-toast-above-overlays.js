'use strict';
/**
 * verify-n3-8a-toast-above-overlays.js — N3-8a (live re-audit 2026-11-11, script 1.3a).
 * Onboarding refused an empty required field "with no message". The message IS raised (obNext → notify('Business name is
 * required', true)) — but the toast (.notif, z-index 2000) is painted UNDER the onboarding overlay (.ob-overlay, also
 * z-index 2000, later in the DOM), so nobody sees it. Same class: every overlay at z ≥ 2000 (command palette 3000, bank
 * link / docview / scheduled-docs / feature-info modals 3000–99999) hides any toast raised while it is open.
 * Executed in Chromium (browserKit) on a brand-new account at 1280×800 and a 390×844 phone: Continue with the business
 * name empty, then the element actually painted at the toast's centre is read (document.elementFromPoint).
 * EXPECTED: the toast says "Business name is required" and is the topmost element at its centre.
 * BUG VALUE: the topmost element there is the onboarding overlay (#ob-overlay or a child of it).
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('N3-8a — a toast is painted above every overlay (onboarding: "Business name is required" is visible)', async ({ open, A }) => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await open(vp);
    const shown = await page.evaluate(() => { const o = document.getElementById('ob-overlay'); return !!o && getComputedStyle(o).display !== 'none'; });
    A(`${vp.width}×${vp.height}: onboarding is shown to a new account`, shown);
    await page.fill('#ob-biz-name', '');
    await page.click('#ob-next-btn');
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const n = document.getElementById('notif'), r = n.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: (document.getElementById('notif-text') || {}).textContent, cls: n.className, w: Math.round(r.width), h: Math.round(r.height),
               topIsToast: !!top && n.contains(top), topIs: top ? (top.id || top.className || top.tagName) : null, inOverlay: !!top && !!top.closest && !!top.closest('#ob-overlay') };
    });
    A(`${vp.width}×${vp.height}: the toast says "Business name is required" (error)`, m.text === 'Business name is required' && /error/.test(m.cls) && m.w > 0, JSON.stringify(m));
    A(`${vp.width}×${vp.height}: the toast is the topmost element at its centre (bug: the onboarding overlay)`, m.topIsToast && !m.inOverlay, JSON.stringify(m));
  }
}, { entities: [] });
