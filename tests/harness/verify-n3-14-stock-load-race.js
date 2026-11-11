'use strict';
/**
 * verify-n3-14-stock-load-race.js — N3-14 (live re-audit 2026-11-11).
 * verify-stock-in-out-ui failed intermittently under load — on the OLD code too. Probed: the Stock In succeeded (its
 * movement is in the database), but before the Stock Out the page held units = 0 and refused "Quantity exceeds stock on
 * hand". An inventory list load that started BEFORE the Stock In answered AFTER it and overwrote the newer count with
 * the server's older snapshot. A real user who adds stock as the Inventory page opens, then sells, hits the same refusal.
 *
 * This makes the race DETERMINISTIC instead of load-dependent: the page's own loadInventoryFromDB() is started and its
 * answer (units 0, taken before the Stock In) is HELD; the Stock In (10 @ 12) runs through submitStockIn(); then the held
 * answer is released. Real SPA (jsdom) + real server; the only hook is a delay on delivering that one GET's answer.
 * EXPECTED: units stay 10 (the loader re-reads); a sale of 4 succeeds → units 6, one sale movement.
 * BUG VALUES: units 0 after the release; the sale is refused "Quantity exceeds stock on hand"; no sale movement.
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  N3-14 — an older inventory answer never overwrites a newer stock count\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({
      baseSeed: true,
      seedExtra: async (c, uid) => {
        const eid = (await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [uid])).rows[0].id;
        await c.query(`INSERT INTO inventory (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { sku: 'B-1', name: 'Bolts', units: 0, max_units: 100, cost: 12 }]);
      },
    });
    const { window: w, settle, client: c } = ctx;
    for (let i = 0; i < 250 && !(w.inventory || []).some(x => x.name === 'Bolts'); i++) await sleep(100);
    w.showPage('inventory'); await settle(20, 80);
    const idx = () => (w.inventory || []).findIndex(x => x.name === 'Bolts');
    const units = () => Number(((w.inventory || [])[idx()] || {}).units);

    // hold the answer of the NEXT inventory list GET
    let release; const gate = new Promise(r => { release = r; }); let held = 0;
    const inner = w.fetch;
    w.fetch = function (input, init) {
      const u = String(input && input.url || input), m = String((init && init.method) || 'GET').toUpperCase();
      if (m === 'GET' && /\/api\/inventory(\?|$)/.test(u) && held === 0) { held++; return inner(input, init).then(res => gate.then(() => res)); }
      return inner(input, init);
    };
    // the real user path: opening the Inventory page starts the page's own inventory load
    w.showPage('dashboard'); await settle(4, 40);
    w.showPage('inventory');
    for (let i = 0; i < 50 && held === 0; i++) await sleep(50);
    A('the page\'s inventory load is in flight with its answer held (taken at units 0)', held === 1, 'held=' + held);

    w.openStockInModal(idx()); await sleep(100);
    w.document.getElementById('si-qty').value = '10'; w.document.getElementById('si-cost').value = '12';
    await w.submitStockIn(); await settle(6, 60);
    A('Stock In applied on screen: units 10', units() === 10, 'units=' + units());

    release(); await settle(10, 80); await sleep(600);
    A('after the OLDER answer arrives, units are still 10 (bug: overwritten to 0)', units() === 10, 'units=' + units());

    const notes = []; const on = w.notify; w.notify = (m, e) => { notes.push((e ? 'ERR ' : '') + m); return on && on(m, e); };
    w.openStockOutModal(idx()); await sleep(100);
    w.document.getElementById('so-qty').value = '4'; w.document.getElementById('so-customer').value = 'Counter sale'; w.document.getElementById('so-price').value = '20';
    await w.submitStockOut(); await settle(8, 60);
    const sales = (await c.query(`SELECT COUNT(*)::int n FROM inventory_movements WHERE type='sale' AND inventory_id IN (SELECT id FROM inventory WHERE data->>'name'='Bolts')`)).rows[0].n;
    A('a sale of 4 goes through: one sale movement, units 6 (bug: refused "Quantity exceeds stock on hand")', sales === 1 && units() === 6 && !notes.some(n => /exceeds stock/.test(n)), 'sales=' + sales + ' units=' + units() + ' notes=' + JSON.stringify(notes));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-14 stock load race)'));
  process.exit(fail ? 1 : 0);
})();
