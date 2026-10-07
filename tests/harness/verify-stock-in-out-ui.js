#!/usr/bin/env node
'use strict';
/**
 * verify-stock-in-out-ui.js — N110 / N111. From the live Inventory page a user can record a purchase
 * (Stock In) and a sale (Stock Out), and each movement lands on the item that was clicked.
 *
 * Defects (executed through the real SPA in jsdom against the real server + Postgres):
 *   N110a the runtime inventory renderer (finflow-api-wiring-medium.js) listed no Stock In / Stock Out
 *         buttons — they lived only in the dead app-main.js copy — so no purchase / sale (FIFO layer, COGS)
 *         could be recorded from the page.
 *   N110b the stock modals sent inventory_id: item.dbId||idx. Items carry _dbId, so the ARRAY INDEX was
 *         sent: the movement landed on whichever item had id == index.
 *   N111  the Stock Out COGS preview posted {quantity_sold}; the server reads {quantity} → 400 → preview 0.
 *
 * Seed: the VERIFICATION base (Test Widget) + "Nuts" + "Bolts" (no movements). Bolts is clicked: Stock In
 * 10 @ 12, then Stock Out 4.
 *   "+ In" / "− Out" buttons rendered for each saved item            (bug: absent)
 *   purchase movement on Bolts (qty 10, cost 12)                      (bug: on the item whose id == Bolts' index)
 *   sale movement on Bolts (qty 4); preview shows COGS 48 (4 × 12)    (bug: wrong item; preview 0)
 *   Restock 3 (N69) → purchase movement 3 @ 12 on Bolts, units 9          (bug: units PUT, no movement)
 *   node -r ./tests/harness/clock.js tests/harness/verify-stock-in-out-ui.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const s = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(s)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        const eid = (await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [uid])).rows[0].id;
        for (const [sku, name, cost] of [['NUT-1', 'Nuts', 1], ['BOLT-1', 'Bolts', 12]]) {
          await c.query(`INSERT INTO inventory (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { sku, name, units: 0, max_units: 100, cost }]);
        }
      },
    });
    const { window, settle, client: c } = boot;
    for (let i = 0; i < 250 && !(window.inventory || []).some(x => x.name === 'Bolts'); i++) await new Promise(r => setTimeout(r, 100));
    await settle(10, 80);
    const inv = window.inventory || [];
    const idx = inv.findIndex(x => x.name === 'Bolts');
    const bolts = inv[idx] || {};
    const wrongId = (inv[idx] && inv.find(x => x._dbId === idx)) ? idx : null;
    console.log(`  [seed] Bolts index ${idx}, db id ${bolts._dbId}; the buggy code would send inventory_id=${idx}${wrongId != null ? ' (= ' + (inv.find(x => x._dbId === idx) || {}).name + ')' : ''}`);
    A('seed discriminates: Bolts\' index ≠ its database id', idx >= 0 && bolts._dbId !== idx, `idx ${idx} id ${bolts._dbId}`);

    console.log('\n' + '='.repeat(78));
    console.log('  INVENTORY PAGE — Stock In / Stock Out on the clicked item');
    console.log('='.repeat(78));
    if (typeof window.navigateTo === 'function') { try { window.navigateTo('inventory'); } catch (_) {} }
    window.renderInventory();
    await settle(6, 60);
    const html = (window.document.getElementById('inventory-list') || {}).innerHTML || '';
    A('"+ In" and "− Out" buttons are rendered for saved items (bug: absent)', html.includes(`openStockInModal(${idx})`) && html.includes(`openStockOutModal(${idx})`), html.slice(0, 200));

    const mv = async () => (await c.query(`SELECT inventory_id, type, quantity::float q, unit_cost::float uc FROM inventory_movements WHERE inventory_id IN (SELECT id FROM inventory WHERE data->>'name' IN ('Nuts','Bolts')) ORDER BY id`)).rows;
    window.openStockInModal(idx);
    window.document.getElementById('si-qty').value = '10';
    window.document.getElementById('si-cost').value = '12';
    await window.submitStockIn();
    await settle(8, 60);
    const m1 = await mv();
    A('Stock In: one purchase movement on Bolts, qty 10 @ 12 (bug: on another item / refused)', m1.length === 1 && m1[0].inventory_id === bolts._dbId && m1[0].type === 'purchase' && m1[0].q === 10 && m1[0].uc === 12, JSON.stringify(m1));

    window.openStockOutModal(idx);
    window.document.getElementById('so-qty').value = '4';
    await window.submitStockOut();
    await settle(8, 60);
    const m2 = await mv();
    const sale = m2.find(m => m.type === 'sale');
    A('Stock Out: sale movement on Bolts, qty 4 (bug: wrong item)', sale && sale.inventory_id === bolts._dbId && sale.q === 4, JSON.stringify(m2));
    const prev = (window.document.getElementById('so-cogs-preview') || {}).textContent || '';
    const fmt = (typeof window.S === 'function') ? window.S(48) : '48';
    A('Stock Out preview shows FIFO COGS 48 (4 × 12) (bug: 0 — quantity_sold → 400)', prev.replace(/\s+/g, '').includes(String(fmt).replace(/\s+/g, '')), `preview "${prev}" want ${fmt}`);
    // N69: the Restock button records a PURCHASE movement at the item's unit cost (it used to PUT units += qty
    // with no cost layer — and the server now refuses a direct units change).
    window.restockItem(idx);
    window.document.getElementById('restock-qty').value = '3';
    await window.saveRestock();
    await settle(8, 60);
    const m3 = await mv();
    const rs = m3.filter(m => m.type === 'purchase');
    A('Restock 3: a purchase movement 3 @ 12 on Bolts (bug: units overwritten, no movement)', rs.length === 2 && rs[1].inventory_id === bolts._dbId && rs[1].q === 3 && rs[1].uc === 12, JSON.stringify(m3));
    const u = Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id=$1`, [bolts._dbId])).rows[0].u);
    A('  Bolts units = 10 − 4 + 3 = 9', u === 9, 'units ' + u);
    const nuts = inv.find(x => x.name === 'Nuts') || {};
    const nm = (await c.query(`SELECT COUNT(*)::int n FROM inventory_movements WHERE inventory_id=$1`, [nuts._dbId])).rows[0].n;
    A('control: Nuts untouched (no movements)', nm === 0, 'movements on Nuts: ' + nm);
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally { try { if (boot) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (stock in/out UI)` : `  ALL GREEN — ${pass} passed, 0 failed  (stock in/out UI)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
