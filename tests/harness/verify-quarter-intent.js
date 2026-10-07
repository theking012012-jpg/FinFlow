'use strict';
/**
 * verify-quarter-intent.js — Phase 1.1 / L9: in the Quarter view every dashboard figure must describe the
 * SAME quarter. The native KPI engine (_periodWindow) resolves "quarter" to TODAY's fiscal quarter, but the
 * two requests that send a period intent to the server — _cogsPeriodParams (COGS subtracted from Net
 * profit) and _applyConvertedKPIs (display-currency KPIs) — sent `monthIdx = currentMonthIdx`, i.e. the
 * month last browsed in the Month view. Browse back to June, switch to Quarter, and the server answers
 * for Q2 while the native figures are Q3.
 *
 * Seed: fullLegScenario (June rows) + a June inventory sale (2 units @ 10 → COGS 20) + USD→EUR @ 2.
 * Today is pinned 2026-07-25, so the current quarter is Q3 (Jul–Sep) and holds no rows.
 *   year (native)            : revenue 745 · expenses 614 · COGS 20 · net 111   (hand-computed)
 *   Quarter after browsing to June (native): 0 · 0 · net 0      — BUG: net −20 (Q2 COGS subtracted)
 *   Quarter after browsing to June (EUR)   : revenue €0          — BUG: €1.5K (= Q2 745 × 2)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-quarter-intent.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const money = s => { const t = String(s == null ? '' : s).replace(/[,\s]/g, ''); const m = t.match(/(-?)[^\d-]*(-?\d+(?:\.\d+)?)(K|M)?/); if (!m) return NaN;
  const v = parseFloat(m[2]) * (m[3] === 'K' ? 1e3 : m[3] === 'M' ? 1e6 : 1); return (m[1] === '-' ? -1 : 1) * v; };

async function seed({ http, client, userId }) {
  const ids = await postFullLegScenario({ http, client });
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
  const item = J(await http.post('/api/inventory', { name: 'Widget', units: 5, cost: 10 }));
  J(await http.post('/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 2 }));
  // movements are stamped with the DB's real NOW(); file the opening stock + the sale in June 2026
  await client.query(`UPDATE inventory_movements SET moved_at = CASE WHEN type='purchase' THEN '2026-06-01T12:00:00Z'::timestamptz ELSE '2026-06-12T12:00:00Z'::timestamptz END WHERE user_id = $1`, [userId]);
  await client.query(`INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date, source) VALUES ($1, $2, 'USD', 'EUR', 2, '2025-01-01', 'harness')`, [userId, ids.entityId]);
  return ids;
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L9 — Quarter view: every figure is the SAME quarter (today\'s)\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window, http, settle, text } = ctx;
    const d = window.document;
    await settle(60, 100);
    const rep = JSON.parse((await http.get('/api/reports?period=year&fyStart=0')).text);
    A('server year: revenue 745 · expenses 614 · COGS 20 · net 111', near(rep.revenue, 745) && near(rep.expenses, 614) && near(rep.cogs, 20) && near(rep.netProfit, 111),
      JSON.stringify({ r: rep.revenue, e: rep.expenses, c: rep.cogs, n: rep.netProfit }));
    A('dashboard year: net profit 111 (745 − 20 − 614)', near(money(text('d-profit')), 111), 'd-profit=' + text('d-profit'));

    // browse the Month view back to June, then switch to Quarter
    window.setPeriod(d.getElementById('pMonth'), 'month'); await settle(10, 100);
    for (let i = 0; i < 12 && window.eval('currentMonthIdx') > 5; i++) { window.shiftMonth(-1); await settle(3, 100); }
    await settle(20, 100);
    A('month view browsed to June: revenue 745', near(money(text('d-rev')), 745), 'd-rev=' + text('d-rev'));
    window.setPeriod(d.getElementById('pQ'), 'quarter');
    await settle(40, 100);
    A('quarter (native): revenue 0 — today\'s quarter Q3', near(money(text('d-rev')), 0), 'd-rev=' + text('d-rev'));
    A('quarter (native): expenses 0', near(money(text('d-exp')), 0), 'd-exp=' + text('d-exp'));
    A('quarter (native): net profit 0 — no Q2 COGS subtracted (bug: −20)', near(money(text('d-profit')), 0), 'd-profit=' + text('d-profit') + ' _cogsTotal=' + window._cogsTotal);

    window._applyDisplayCurrency ? window._applyDisplayCurrency('EUR') : window.eval("_applyDisplayCurrency('EUR')");
    await settle(40, 100);
    A('quarter (EUR display): revenue €0 — same quarter as native (bug: €1.5K = Q2×2)', near(money(text('d-rev')), 0), 'd-rev=' + text('d-rev'));
    A('quarter (EUR display): net profit €0', near(money(text('d-profit')), 0), 'd-profit=' + text('d-profit'));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (quarter intent)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
