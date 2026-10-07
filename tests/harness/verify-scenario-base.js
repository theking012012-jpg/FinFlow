'use strict';
/**
 * verify-scenario-base.js — L24 (prior audit F44, still present). The Scenario planner's BASELINE ("Projected
 * revenue / expenses / net profit" before any slider moves) was built from a pre-F32 basis of its own:
 *   revenue  = Σ PAID invoices, all time         (dashboard: issued invoices + receipts + income JEs − credit notes, FY)
 *   expenses = Σ raw expense rows, all time      (dashboard: + bills, payments made, payroll runs, expense JEs − vendor credits, FY)
 * and no COGS — so "Baseline" disagreed with the dashboard's Year figures for the same books (Rule 2).
 *
 * Fix under test: BASE = the dashboard's Year figures — computeRevenue('year'), computeExpenseBreakdown('year').total
 * and the fiscal-year COGS (/api/cogs period=year), so baseline net profit == the dashboard's Year net.
 *
 * Seed: fullLegScenario (Year revenue 745, opex 614 — hand-computed there) + inventory and a prior-year expense:
 *   purchase 10 @ 10 (2025-10-01), sale 2 (2025-11-01, FY2025), sale 4 (2026-06-10) ⇒ FY2026 COGS 40 (all-time 60)
 *   expense 'Office' 50 on 2025-12-15 (prior year — must not count)
 * EXPECTED (Rule 6, by hand): BASE.rev 745 · BASE.exp 614 + 40 = 654 · baseline net 91
 *   bug: rev 0 (the invoice is pending, not paid) · exp 58 (8 + 50, raw, all-time) · net −58
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-scenario-base.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario, EXPECTED } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const num = t => parseFloat(String(t || '').replace(/[^0-9.\-]/g, ''));

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L24 — Scenario planner baseline == the dashboard\'s Year figures\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async (o) => {
      const r = await postFullLegScenario(o);
      const { client: c, userId: uid, http } = o;
      const item = (await c.query(`INSERT INTO inventory (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, r.entityId, { name: 'Widget', sku: 'W', units: 4, max_units: 100, cost: 10 }])).rows[0].id;
      await c.query(`INSERT INTO inventory_movements (user_id,entity_id,inventory_id,type,quantity,unit_cost,moved_at) VALUES
        ($1,$2,$3,'purchase',10,10,'2025-10-01T16:00:00Z'),($1,$2,$3,'sale',2,NULL,'2025-11-01T16:00:00Z'),($1,$2,$3,'sale',4,NULL,'2026-06-10T16:00:00Z')`, [uid, r.entityId, item]);
      const e = await http.post('/api/expenses', { description: 'Old supplies', category: 'Office', amount: 50, expense_date: '2025-12-15' });
      if (e.status >= 300) throw new Error('prior-year expense ' + e.status);
      return r;
    } });
    const { window: w, settle } = ctx;
    await settle(60, 100);
    w.showPage('scenario'); await settle(10, 100);
    if (w._scenarioBaseReady) await w._scenarioBaseReady;   // the FY COGS fetch + repaint (no fixed-time race)
    const B = w.BASE || {};
    A(`BASE.rev = Year revenue ${EXPECTED.revenue} (bug: paid-only invoices 0)`, Math.abs(B.rev - EXPECTED.revenue) < 0.005, JSON.stringify(B));
    A(`BASE.exp = Year opex ${EXPECTED.opex} + FY COGS 40 = 654 (bug: raw all-time expenses 58)`, Math.abs(B.exp - 654) < 0.005, JSON.stringify(B));
    const shown = id => num((w.document.getElementById(id) || {}).textContent);
    A('"Projected revenue" card at baseline = 745', shown('sc-rev') === 745, 'sc-rev=' + (w.document.getElementById('sc-rev') || {}).textContent);
    A('"Projected expenses" card at baseline = 654', shown('sc-exp') === 654, 'sc-exp=' + (w.document.getElementById('sc-exp') || {}).textContent);
    A('"Net profit" card at baseline = 91 (= dashboard Year net 745 − 40 − 614)', shown('sc-profit') === 91, 'sc-profit=' + (w.document.getElementById('sc-profit') || {}).textContent);
    // cross-check against the dashboard's own Year figures in this same session (agreement, after the oracle above)
    const rev = w.computeRevenue('year'), opex = w.computeExpenseBreakdown('year').total;
    A('dashboard Year revenue / opex in this session are 745 / 614 (seed premise)', rev === 745 && opex === 614, 'rev=' + rev + ' opex=' + opex);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { if (ctx) await ctx.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (scenario baseline)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
