'use strict';
/**
 * verify-f52b-contrast — F52, the half jsdom cannot measure: text colour contrast (WCAG 2 AA, axe-core color-contrast)
 * in a real browser with real layout. The app in dark and light, and every public page.
 *
 * Executed: Chromium against the real server + scratch Postgres (Rule 3); axe-core is evaluated through the debugger
 * channel (the pages' CSP rightly refuses injected inline script). Bug values (old code): /accountant-login 7 and
 * /accountant-register 11 failures — the shared accountant palette's --text3 #5a5540 (2.3:1) and --gold-dim #8a6f2e
 * (3.7:1). Not measured here: the logged-in accountant dashboard / client pages and admin (they use the same palette
 * tokens, raised in the same change).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f52b-contrast.js
 */
const axe = require('axe-core');
const { runBrowser } = require('./browserKit.js');

runBrowser('F52b — text contrast (WCAG AA) in a real browser', async ({ open, eq, server }) => {
  const page = await open({ width: 1280, height: 900 });
  await page.waitForTimeout(2500);
  const failures = async () => {
    await page.evaluate(axe.source);
    return page.evaluate(async () => {
      const x = await window.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] });
      return x.violations.flatMap(v => v.nodes.map(n => n.target.join(' ') + ' ' + ((n.any[0] && n.any[0].data) ? `${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} ${n.any[0].data.contrastRatio}:1` : '')));
    });
  };
  eq('the app (dark): no text below AA contrast', await failures(), []);
  await page.evaluate(() => { const s = document.getElementById('s-dark'); if (s && typeof toggleTheme === 'function') { s.checked = false; toggleTheme(); } });
  await page.waitForTimeout(800);
  eq('the app (light): no text below AA contrast', await failures(), []);
  for (const p of ['/', '/accountants', '/accountant-login', '/accountant-register', '/privacy', '/terms', '/security', '/conduct', '/reset-password', '/team-accept', '/portal']) {
    await page.goto(server.baseUrl + p); await page.waitForTimeout(1200);
    eq(`${p}: no text below AA contrast${/accountant-(login|register)/.test(p) ? ' (bug: 7 / 11)' : ''}`, await failures(), []);
  }
}, {});
