'use strict';
/**
 * verify-g5-low-stock.js — G5 + the reorder half of FA-B7. "Low stock" had four definitions: the Items page stored it
 * as a STATUS on stocked products below 10 units (so "Active" dropped them) and counted stock < 10; the Inventory page
 * counted `low || units < 5`; the server flagged units < 10% of max_units; and the Edit form labelled that same
 * max_units field "Reorder level (max units)" — so a reorder level of 100 set the item's capacity instead.
 * After: ONE rule (FinFlowDates.isLowStock) — an item is low when its units fall to its reorder level; an item with no
 * reorder level keeps the original rule (below 10% of capacity). The server's low_stock flag, the Inventory page, the
 * Items page and the AI read it; an item's status stays Active / Inactive; the Edit form has a real reorder-level field.
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres, NO base seed. Stock created through the real routes.
 *   Widget 50 units, capacity 100, no reorder level → not low (50 ≥ 10)
 *   Gizmo   5 units, capacity 100, no reorder level → LOW (5 < 10)
 *   Bolt   30 units, capacity 200, reorder level 40 → LOW (30 ≤ 40)       (bug: not low — the level is ignored)
 *   Nut     8 units, capacity 200, reorder level 5  → not low (8 > 5)    (bug: LOW — 8 < 10% of 200, the level ignored)
 *   Pin     9 units, capacity 50,  no reorder level → not low (9 ≥ 5)    (bug: Items page "Low Stock", < 10)
 *   EXPECTED: low = Gizmo, Bolt → Inventory card 2 · Items card 2 · Items "Active" 5 (bug: Items low 3, Active 2)
 *   node -r ./tests/harness/clock.js tests/harness/verify-g5-low-stock.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({
      baseSeed: false,
      seedExtra: async (c, uid) => {
        await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }]);
      },
    });
    const { window, http, settle } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.renderItems !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    const mk = async (name, sku, units, max, reorder) => {
      const r = await http.post('/api/inventory', { name, sku, units, cost: 2, max_units: max });
      const id = (r.json || {}).id;
      if (reorder != null && id) await http.put('/api/inventory/' + id, { reorder_level: reorder });
      return id;
    };
    await mk('Widget', 'W-1', 50, 100, null);
    await mk('Gizmo', 'G-1', 5, 100, null);
    await mk('Bolt', 'B-1', 30, 200, 40);
    await mk('Nut', 'N-1', 8, 200, 5);
    await mk('Pin', 'P-1', 9, 50, null);
    const inv = (await http.get('/api/inventory')).json || [];
    const lowOnServer = inv.filter(r => Number(r.low_stock) === 1).map(r => r.name).sort();
    A('1  the server flags exactly Gizmo and Bolt low (bug: Gizmo and Nut — the reorder level is ignored)', JSON.stringify(lowOnServer) === JSON.stringify(['Bolt', 'Gizmo']), JSON.stringify(lowOnServer));
    try { if (typeof window.loadEntityData === 'function') await window.loadEntityData((window.ENTITIES || []).findIndex(e => e.active)); } catch (_) {}
    await settle(14, 80);
    try { window.showPage('inventory'); } catch (_) {}
    await settle(10, 60);
    try { window.renderInventory(); } catch (_) {}
    const invLow = ((d.getElementById('inv-lowstock') || {}).textContent || '').trim();
    const flagged = [...d.querySelectorAll('#inventory-list .inv-item-row')].filter(r => /⚠/.test(r.textContent)).map(r => (r.children[1] || {}).textContent).sort();
    A('2  Inventory: 2 low-stock alerts, and they are Gizmo and Bolt (bug: Gizmo and Nut)', invLow === '2' && JSON.stringify(flagged) === JSON.stringify(['Bolt', 'Gizmo']), invLow + ' ' + JSON.stringify(flagged));
    try { window.showPage('items'); } catch (_) {}
    await settle(10, 60);
    try { window.renderItems('all'); } catch (_) {}
    await settle(4, 40);
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    A('3  Items "Low Stock" 2 — the same rule (bug: 3, stock < 10)', t('items-lowstock') === '2', t('items-lowstock'));
    A('4  Items "Active" 5 — low stock is not a status (bug: 2)', t('items-active') === '5', t('items-active'));
    const html = require('./appScripts.js').pageSource('index.html');
    A('[STRUCTURAL] the inventory Edit form has its own reorder-level field; "(max units)" is gone', /id="edit-inv-reorder"/.test(html) && !/Reorder level \(max units\)/.test(html), '');
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (G5 low stock)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
