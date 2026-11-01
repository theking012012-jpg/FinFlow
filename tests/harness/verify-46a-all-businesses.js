'use strict';
/**
 * verify-46a-all-businesses — 4.6a (live re-test BLOCKED: "no all-businesses view in the switcher"). The consolidated
 * view existed only as a report on the Businesses page; nothing in the business switcher reached it, while the in-app
 * help said "Switch the entity picker to the consolidated view". Now the switcher has "All businesses — combined" (with
 * two or more businesses) that opens the consolidated report. Real browser, real /app, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-46a-all-businesses.js
 *
 * Bug values: no entry in the switcher; the help text names a control that does not exist.
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('4.6a — All businesses (combined) in the business switcher', async ({ open, A, eq, J }) => {
  const page = await open({ width: 1280, height: 800 });
  const one = await page.evaluate(async () => { toggleBizMenu({ stopPropagation(){} }); await new Promise(r => setTimeout(r, 200));
    const el = document.getElementById('biz-all'); const shown = !!el && el.style.display !== 'none'; closeAllDropdowns(); return shown; });
  eq('one business: no "All businesses" entry (nothing to combine)', one, false);

  await J('POST', '/api/entities', { name: 'Second Co', currency: 'EUR', country: 'IE', timezone: 'Europe/Dublin' });
  await page.reload({ waitUntil: 'load' }); await new Promise(r => setTimeout(r, 2500));
  const two = await page.evaluate(async () => {
    toggleBizMenu({ stopPropagation(){} }); await new Promise(r => setTimeout(r, 200));
    const el = document.getElementById('biz-all');
    const shown = !!el && el.style.display !== 'none', label = el ? el.innerText.trim() : '';
    el && el.querySelector('button').click(); await new Promise(r => setTimeout(r, 1500));
    const card = document.getElementById('consol-card'); const rect = card ? card.getBoundingClientRect() : null;
    return { shown, label, page: document.querySelector('.page.active') && document.querySelector('.page.active').id,
      cardInView: !!rect && rect.top < window.innerHeight && rect.bottom > 0, menuClosed: document.getElementById('biz-menu').style.display === 'none' };
  });
  A('two businesses: the switcher offers "All businesses — combined"', two.shown && /All businesses — combined/.test(two.label), JSON.stringify(two));
  eq('choosing it opens the Businesses page', two.page, 'page-entities');
  A('…scrolled to the consolidated report, menu closed', two.cardInView && two.menuClosed, JSON.stringify(two));
  const help = await page.evaluate(() => document.documentElement.innerHTML.includes('Switch the entity picker to the consolidated view') ? 'old' : 'ok');
  // the help articles are data in a script file; read it as served (what the browser runs)
  const src = await page.evaluate(async () => (await (await fetch('/js/app-14-ff-link-belvo.js')).text()));
  A('the in-app help points to the real control (not "the entity picker")', !/Switch the entity picker/.test(src) && /All businesses — combined/.test(src) && help === 'ok', 'help text still names the entity picker');
}, {});
