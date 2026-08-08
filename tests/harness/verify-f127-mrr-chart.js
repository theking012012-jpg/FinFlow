'use strict';
/**
 * verify-f127-mrr-chart.js — EXECUTE (Rule 14) that the MRR chart now has REAL data, not a permanent
 * flat zero line (window._mrrChartData previously had NO writer). loadMRRData builds a trailing-12-month
 * series by back-dating each active recurring invoice to its start month (created_at).
 *
 * Seed (pinned clock 2026-07-25 → trailing months Aug'25 … Jul'26):
 *   Sub A  100/mo  active  created 2026-02-15  → contributes Feb..Jul (6 months)
 *   Sub B  300/mo  active  created 2026-06-15  → contributes Jun..Jul (2 months)
 * Expected series (Aug'25 → Jul'26): [0,0,0,0,0,0,100,100,100,100,400,400]
 *   first point 0 (before any sub), last point 400 (= current MRR card). Pre-fix: all zeros.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f127-mrr-chart.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`DELETE FROM recurring_invoices WHERE user_id=$1`, [uid]);
        await c.query(`INSERT INTO recurring_invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,'2026-02-15',NOW())`,
          [uid, { client: 'A', amount: 100, frequency: 'monthly', status: 'active' }]);
        await c.query(`INSERT INTO recurring_invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,'2026-06-15',NOW())`,
          [uid, { client: 'B', amount: 300, frequency: 'monthly', status: 'active' }]);
      },
    });
    const { window, settle } = boot;
    await settle(3, 100);

    A('loadMRRData present', typeof window.loadMRRData === 'function');
    if (typeof window.loadMRRData === 'function') { try { await window.loadMRRData(); } catch (e) {} }
    await settle(3, 100);

    const s = window._mrrChartData;
    A('window._mrrChartData is written (has a writer now) with 12 points', Array.isArray(s) && s.length === 12,
      `_mrrChartData = ${JSON.stringify(s)}`);
    A('series is NOT a flat zero line (the F127 bug)', Array.isArray(s) && s.some(v => v > 0), JSON.stringify(s));
    A('first point = 0 (before any subscription started)', Array.isArray(s) && s[0] === 0, `s[0]=${s && s[0]}`);
    A('last point = 400 (current active MRR = 100 + 300)', Array.isArray(s) && s[11] === 400, `s[11]=${s && s[11]}`);
    A('series is a monotonic non-decreasing ramp (active book grew, no churn in seed)',
      Array.isArray(s) && s.every((v, i) => i === 0 || v >= s[i - 1]), JSON.stringify(s));
    A('labels track the same 12 months', Array.isArray(window._mrrChartLabels) && window._mrrChartLabels.length === 12,
      JSON.stringify(window._mrrChartLabels));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F127 MRR chart, executed in jsdom)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
