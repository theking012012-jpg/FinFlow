'use strict';
/**
 * verify-lr30-cogs-summary-period.js — LR30: the COGS Summary (Inventory page) names its period and follows it.
 *  Its three cards are the dashboard period's figures (loadCOGS asks /api/cogs for that window), but the card said only
 *  "FIFO cost of goods sold · All items", and a period switch left the cards on the old period.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Clock 2026-07-25, fiscal year from January. FIFO 10 @ $50 bought
 * 1 May; 3 sold 10 June, 2 sold 20 July (Rule 4: the year and the month differ).
 *   Year:  "$250" · "FIFO cost of goods sold · Fiscal year to date · 1 Jan – 25 Jul 2026"   (old caption: no period)
 *   press Month (July) on the Inventory page → "$100" · "… · Jul 2026"                      (old: stays $250 — measured)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr30-cogs-summary-period.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR30 — COGS Summary names its period and follows the period buttons\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR30 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      const item = await J('POST', '/api/inventory', { name: 'Widget', qty: 0, cost: 50 });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 50, date: '2026-05-01', idempotency_key: 'lr30-buy' });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 3, date: '2026-06-10', idempotency_key: 'lr30-jun' });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 2, date: '2026-07-20', idempotency_key: 'lr30-jul' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('inventory');
    await settle(40, 50);
    await w.loadCOGS(); await settle(20, 30);
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    const sub = () => ((d.querySelector('#cogs-total') || {}).closest ? d.querySelector('#cogs-total').closest('.card').querySelector('.card-sub').textContent.trim() : '');
    eq('Year: total and the period it covers', [t('cogs-total'), sub()], ['$250', 'FIFO cost of goods sold · Fiscal year to date · 1 Jan – 25 Jul 2026'], ['$250', 'FIFO cost of goods sold']);
    w.setPeriod(d.getElementById('pMonth'), 'month');
    await settle(60, 60);
    eq('Month pressed on the Inventory page: the summary follows', [t('cogs-total'), sub()], ['$100', 'FIFO cost of goods sold · Jul 2026'], ['$250', 'FIFO cost of goods sold']);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
