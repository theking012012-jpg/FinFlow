'use strict';
/**
 * verify-n3-4-stock-sale-refresh.js — N3-4 (live re-audit 2026-11-11).
 * After "Record sale" the Inventory value / COGS cards kept their pre-sale figures ($480 / $0) until Refresh, and the
 * buyer the sale creates (FA-B7) never reached the Customers list until a full page reload — the server data was right.
 * Real SPA (jsdom) + real server. Stock is seeded through the real routes (COWORK 2.7: Widget, 20 @ 15 on 06-01, then
 * 10 @ 18 on 07-01); the sale goes through the page's own submitStockOut() (25 units to Echo Retail @ 32, paid now);
 * the cards are read WITHOUT pressing Refresh or navigating.
 * HAND-COMPUTED (FIFO): COGS = 20 × 15 + 5 × 18 = 390 · value left = 5 × 18 = 90 · units 5.
 * BUG VALUE: Customers list without "Echo Retail" (RED on the old code).
 * The live stale value/COGS cards ($480 / $0) did NOT reproduce here — correct on the old code too, with stock entered
 * through the API or the page's own Stock In form — most likely the live read (~2.5 s after the click in a background,
 * timer-throttled pane) came before loadCOGS finished. Those two checks stay as REGRESSION checks, labelled as such.
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = t => parseFloat(String(t || '').replace(/[^0-9.\-]/g, ''));

async function seed({ http }) {
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 200)); return JSON.parse(r.text); };
  const ent = J(await http.post('/api/entities', { name: 'Stock Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
  J(await http.post('/api/entities/' + ent.id + '/activate', {}));
  const it = J(await http.post('/api/inventory', { name: 'Widget', sku: 'W-1', units: 0, cost: 15 }));
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  N3-4 — after a stock sale the cards and the customer list update without Refresh\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, settle, text } = ctx;
    w.showPage('inventory'); await settle(40, 100);
    await settle(20, 100);
    // stock in through the PAGE's own Stock In form, exactly as the live run did (20 @ 15 cash, then 10 @ 18 on a bill)
    const set0 = (id, v) => { const e = w.document.getElementById(id); e.value = v; e.dispatchEvent(new w.Event('change', { bubbles: true })); };
    for (const [q, c, d, f] of [['20', '15', '2026-06-01', 'cash'], ['10', '18', '2026-07-01', 'bill']]) {
      const ix = (w.inventory || []).findIndex(i => i.sku === 'W-1');
      w.openStockInModal(ix); await sleep(200);
      set0('si-qty', q); set0('si-cost', c); set0('si-date', d); set0('si-funding', f);
      if (f === 'bill') { set0('si-vendor', 'Widget Maker'); set0('si-due', '2026-07-31'); }
      await w.submitStockIn(); await settle(30, 100); await sleep(400);
    }
    const before = { value: num(text('inv-value')), units: (w.inventory || []).find(i => i.sku === 'W-1')?.units };
    console.log('  info  before the sale: value card ' + text('inv-value') + ' · units ' + before.units);
    const idx = (w.inventory || []).findIndex(i => i.sku === 'W-1');
    w.openStockOutModal(idx); await sleep(200);
    const set = (id, v) => { const e = w.document.getElementById(id); e.value = v; e.dispatchEvent(new w.Event('change', { bubbles: true })); };
    set('so-kind', 'sale'); set('so-customer', 'Echo Retail'); set('so-price', '32'); set('so-paid', 'now'); set('so-qty', '25'); set('so-date', '2026-07-20');
    await w.submitStockOut();
    await settle(40, 100); await sleep(800);
    const units = (w.inventory || []).find(i => i.sku === 'W-1')?.units;
    A('units on hand 5', Number(units) === 5, 'units=' + units);
    A('[REGRESSION — did NOT discriminate: also 90 on the old code] Inventory value card 90 right after the sale', Math.abs(num(text('inv-value')) - 90) < 0.005, 'inv-value=' + text('inv-value'));
    A('[REGRESSION — did NOT discriminate: also 390 on the old code] COGS card 390 right after the sale', Math.abs(num(text('inv-cogs')) - 390) < 0.005, 'inv-cogs=' + text('inv-cogs'));
    w.showPage('customers'); await settle(30, 100);
    const custText = (w.document.getElementById('page-customers') || {}).textContent || '';
    A('Customers page lists "Echo Retail" without a page reload (bug: missing)', /Echo Retail/.test(custText), 'customers page: ' + custText.replace(/\s+/g, ' ').slice(0, 200));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-4 stock sale refresh)'));
  process.exit(fail ? 1 : 0);
})();
