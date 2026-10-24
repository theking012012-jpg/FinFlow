'use strict';
/**
 * verify-db5-annual-ui.js — D-B on the Pricing page: with "Annual" switched on, "Start free trial" must ask checkout for
 * the YEARLY plan. Before, the page never sent the choice — the customer saw $63 / month billed yearly and was sent to
 * the monthly price.
 * The REAL SPA + real server (clientMoneyKit, trial account). The checkout request is captured with a pass-through spy.
 */
const { run } = require('./clientMoneyKit.js');

run('D-B — the Pricing page sends the monthly / yearly choice to checkout', async ({ w, d, settle, eq }) => {
  const bodies = []; const _f = w.fetch;
  w.fetch = function (u, o) { if (String(u).indexOf('/api/stripe/checkout') >= 0) { try { bodies.push(JSON.parse(o.body)); } catch (_) {} } return _f.apply(this, arguments); };
  try { w.showPage('pricing'); } catch (_) {}
  try { w.initPricing && w.initPricing(); } catch (_) {}
  await settle(6, 40);
  const tg = d.getElementById('billing-toggle'); tg.checked = true;
  try { w.toggleBilling(); } catch (_) {}
  await settle(6, 40);
  d.getElementById('cta-pro').click();
  await new Promise(r => setTimeout(r, 800));
  eq('1  Annual on → checkout asked for Pro billed YEARLY (bug: no interval → the monthly price)', bodies.map(b => [b.plan, b.interval]), [['pro', 'year']], [['pro', undefined]]);
  tg.checked = false; try { w.toggleBilling(); } catch (_) {}
  await settle(4, 40);
  d.getElementById('cta-biz').click();
  await new Promise(r => setTimeout(r, 800));
  eq('2  Annual off → monthly', (bodies[1] || {}).interval, 'month', undefined);
  w.fetch = _f;
});
