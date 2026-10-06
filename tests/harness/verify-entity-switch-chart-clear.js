'use strict';
/**
 * verify-entity-switch-chart-clear.js — the overview (Revenue-vs-Expenses) chart must REPAINT for the
 * NEW entity on a switch, not keep the previous entity's monthly bars (Rule 14, real failure path).
 *
 * BUG: REV[]/EXP[] (written only by window._setMonthlyArrays, built by window._buildMonthlyArrays from
 * the GLOBAL collections receipts/creditNotes/bills/paymentsMade/payrollRuns) are rebuilt by
 * switchEntity's Promise.all reload — but loadEntityData had already PAINTED the chart once (buildCharts)
 * with the PREVIOUS entity's collections, and nothing repaints it afterwards: updateDashboard never calls
 * updateCharts, and _refreshDashboardUI only (re)builds the chart when it is MISSING. So on an empty
 * entity the canvas keeps a stale bar even though the KPIs read $0 and REV[]/EXP[] get corrected to zero.
 *
 * The chart can't render in jsdom, so the observable is updateCharts — the function that refreshes an
 * EXISTING chart from REV[]/EXP[]. We spy the single array-writer (_setMonthlyArrays) to track the live
 * REV/EXP sums, and spy updateCharts to record the array state at each repaint. The defect is exactly
 * "no updateCharts after the reload," so a plain entity switch never repaints → RED. The fix rebuilds the
 * arrays after the reload and calls updateCharts → a repaint with zero arrays → GREEN.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-entity-switch-chart-clear.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]);
        await c.query(
          `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
           VALUES ($1, NULL, $2, NOW(), NOW())`,
          [uid, JSON.stringify({ name: 'Empty TT Co', currency: 'TTD', is_active: 0, sort_order: 1 })]
        );
      },
    });
    const { window, settle } = boot;
    await settle(80, 60);

    // Track the live monthly-array sums via the single writer.
    let curRev = NaN, curExp = NaN;
    const origSet = window._setMonthlyArrays;
    A('window._setMonthlyArrays present (single chart-array writer)', typeof origSet === 'function');
    window._setMonthlyArrays = function (revArr, expArr) {
      try {
        curRev = Array.isArray(revArr) ? revArr.reduce((s, n) => s + (parseFloat(n) || 0), 0) : NaN;
        curExp = Array.isArray(expArr) ? expArr.reduce((s, n) => s + (parseFloat(n) || 0), 0) : NaN;
      } catch (_) {}
      return origSet.apply(this, arguments);
    };
    // Spy the repaint of an existing chart. Record the array state at each call.
    const paints = [];
    const origUpd = window.updateCharts;
    A('updateCharts present (repaints the existing overview chart)', typeof origUpd === 'function');
    window.updateCharts = function () {
      paints.push({ rev: curRev, exp: curExp });
      try { return origUpd.apply(this, arguments); } catch (_) { /* no real canvas in jsdom */ }
    };

    const ents = window.ENTITIES || [];
    const emptyIdx = ents.findIndex((e) => e && e.name === 'Empty TT Co');
    const dataIdx = ents.findIndex((e) => e && e.name !== 'Empty TT Co');
    A('both entities present (data entity + Empty TT Co)', emptyIdx >= 0 && dataIdx >= 0,
      'ENTITIES=' + ents.map((e) => e && e.name).join(','));

    await window.switchEntity(dataIdx); await settle(50, 60);
    A('data entity has bills loaded (the un-cleared global that feeds the stale bar)',
      (window.bills || []).length > 0, 'bills=' + (window.bills || []).length);

    // ── THE SWITCH ── to the empty entity. The chart MUST be repainted post-reload, with zero arrays.
    paints.length = 0;
    await window.switchEntity(emptyIdx); await settle(60, 60);
    A('[DISCRIMINATING] overview chart repainted during the switch (updateCharts ran)',
      paints.length > 0, 'updateCharts calls=' + paints.length);
    const last = paints[paints.length - 1] || { rev: NaN, exp: NaN };
    A('[DISCRIMINATING] the repaint used ZERO arrays on the empty entity (no stale bar)',
      last.rev === 0 && last.exp === 0, 'last repaint rev=' + last.rev + ' exp=' + last.exp);

    // ── REGRESSION ── back to the data entity: repaint happens AND the series returns non-zero.
    paints.length = 0;
    await window.switchEntity(dataIdx); await settle(60, 60);
    const back = paints[paints.length - 1] || { rev: NaN, exp: NaN };
    A('switching back repaints the chart', paints.length > 0, 'calls=' + paints.length);
    A('switching back restores a non-zero series (fix repaints real data, not blanket zero)',
      (back.rev || 0) !== 0 || (back.exp || 0) !== 0, 'rev=' + back.rev + ' exp=' + back.exp);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (entity-switch chart clear)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
