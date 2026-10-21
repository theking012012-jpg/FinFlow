'use strict';
/**
 * verify-lr15-cogs-this-month.js — LR15: the Inventory "COGS this month" card is this calendar month's COGS.
 *  It printed window._cogsTotal — the dashboard period's COGS, the fiscal year by default — under "this month"
 *  (live: "$390" in October for COGS the P&L books in August). Rule 2: the card now has its own this-month figure;
 *  _cogsTotal (which the dashboard Net subtracts) is untouched.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Clock 2026-07-25, fiscal year from January. FIFO layer of
 * 10 @ $50 bought 1 May; 3 sold 10 June, 2 sold 20 July (Rule 4 — the months give different numbers):
 *   card "COGS this month"  = $100 (July: 2 × 50)              (bug: $250 — the fiscal-year figure, measured)
 *   dashboard _cogsTotal    = 250  (fiscal year, unchanged)   [GUARD — the Net still subtracts the period's COGS]
 *   switch to a second business with no stock → the card reads $0 for it, never the first business's $100 [GUARD]
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr15-cogs-this-month.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR15 — Inventory "COGS this month" is this month\n');
  try {
    let otherId;
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const o = await J('POST', '/api/entities', { name: 'Empty LR15', currency: 'USD', timezone: 'UTC', country: 'US' });
      otherId = o.id;
      const e = await J('POST', '/api/entities', { name: 'Stock LR15', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      const item = await J('POST', '/api/inventory', { name: 'Widget', qty: 0, cost: 50 });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 50, date: '2026-05-01', idempotency_key: 'lr15-buy' });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 3, date: '2026-06-10', idempotency_key: 'lr15-jun' });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 2, date: '2026-07-20', idempotency_key: 'lr15-jul' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('inventory');
    await settle(40, 50);
    if (typeof w.renderInventory === 'function') w.renderInventory();
    await settle(40, 50);
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    eq('"COGS this month" = July only', t('inv-cogs'), '$100', '$250');
    eq('[GUARD] the dashboard period COGS (fiscal year) is unchanged', parseFloat(w._cogsTotal), 250, undefined);

    const idx = (w.ENTITIES || []).findIndex(x => String(x._dbId) === String(otherId));
    await w.switchEntity(idx);
    await settle(60, 60);
    w.showPage('inventory'); await settle(20, 30);
    if (typeof w.renderInventory === 'function') w.renderInventory();
    await settle(40, 50);
    eq('[GUARD] another business: its own month ($0), never the first business\'s $100', t('inv-cogs'), '$0', undefined);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
