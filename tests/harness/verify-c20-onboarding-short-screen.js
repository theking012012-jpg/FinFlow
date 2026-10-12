'use strict';
/**
 * C20 (Cowork end-to-end test): on a short screen (700 px tall) every part of the onboarding window can be reached —
 * its top (logo/title) and its Continue button.
 * BUG: the overlay centred the window and could not scroll; a window taller than the screen lost its top and bottom
 * off-screen with no way to reach them.
 * Executed in Chromium (browserKit) on a brand-new account, at 1280×700 and at a 375×640 phone, on every step.
 *   window top ≥ 0 when scrolled to the top                    bug: negative (cut off)
 *   Continue button fully on screen after scrolling to it       bug: below the screen, unreachable
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('C20 — onboarding fits / scrolls on a short screen', async ({ open, A }) => {
  for (const vp of [{ width: 1280, height: 700 }, { width: 375, height: 640 }]) {
    const page = await open(vp);
    const shown = await page.evaluate(() => { const o = document.getElementById('ob-overlay'); return !!o && getComputedStyle(o).display !== 'none'; });
    A(`${vp.width}×${vp.height}: onboarding is shown to a new account`, shown);
    for (let step = 1; step <= 4; step++) {
      if (step > 1) {
        await page.evaluate(n => { for (let i = 1; i <= 4; i++) { const s = document.getElementById('ob-s' + i); if (s) s.classList.toggle('active', i === n); } }, step);
      }
      const m = await page.evaluate(() => {
        const o = document.getElementById('ob-overlay'), modal = o && o.querySelector('.ob-modal'), btn = document.getElementById('ob-next-btn');
        o.scrollTop = 0;
        const top = modal.getBoundingClientRect().top;
        btn.scrollIntoView({ block: 'nearest' });
        const b = btn.getBoundingClientRect();
        return { top: Math.round(top), btnTop: Math.round(b.top), btnBottom: Math.round(b.bottom), vh: window.innerHeight, modalH: Math.round(modal.getBoundingClientRect().height) };
      });
      A(`${vp.width}×${vp.height} step ${step}: window top reachable (top ${m.top}, window ${m.modalH}px)`, m.top >= 0, JSON.stringify(m));
      A(`${vp.width}×${vp.height} step ${step}: Continue reachable on screen`, m.btnTop >= 0 && m.btnBottom <= m.vh, JSON.stringify(m));
    }
  }
}, { entities: [] });
