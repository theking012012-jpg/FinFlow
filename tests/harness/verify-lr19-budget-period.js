'use strict';
/**
 * verify-lr19-budget-period.js — LR19: the Budget page follows Month / Quarter / Year.
 *  It always showed the year: targets (stored annual) against computeExpenseBreakdown('year'), whatever button was
 *  pressed, and a period switch never reloaded it. Now the selected period's share of each annual target (÷ 12 · ÷ 4 ·
 *  as stored) against that period's actuals — the shared breakdown, same window as every other period surface.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Clock 2026-07-25, fiscal year from January. The month view is
 * stepped back to JUNE so Month, Quarter (Jul–Sep) and Year all give different numbers (Rule 4).
 *   targets (annual): Software 1,200 · Travel 2,400 · "Fun<i>x</i>" 120        → 3,720
 *   spend: Software 300 (5 Mar), Travel 500 (15 May), Travel 80 (20 Jun), Software 50 (10 Jul), Travel 100 (2 Jul)
 *   Month (June) → budget 310 (3,720 ÷ 12), spent 80            (bug: 3,720 / 1,030 — measured)
 *   Quarter      → budget 930 (3,720 ÷ 4),  spent 150           (bug: 3,720 / 1,030)
 *   Year         → budget 3,720,            spent 1,030         [GUARD — unchanged]
 *   a category named "Fun<i>x</i>" draws no element (LR25 class)  (bug: 1)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr19-budget-period.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR19 — Budget page follows the period buttons\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR19 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('PUT', '/api/budget-targets', { Software: 1200, Travel: 2400, 'Fun<i>x</i>': 120 });
      const x = (description, amount, category, expense_date) => J('POST', '/api/expenses', { description, amount, category, expense_date });
      await x('Licence', 300, 'Software', '2026-03-05');
      await x('Flights', 500, 'Travel', '2026-05-15');
      await x('Hotel', 80, 'Travel', '2026-06-20');
      await x('Plugin', 50, 'Software', '2026-07-10');
      await x('Taxi', 100, 'Travel', '2026-07-02');
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('budget');
    await settle(40, 50);
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    const read = () => [t('budget-total'), t('budget-spent')];
    const press = async (btn, p) => { w.setPeriod(d.getElementById(btn), p); await settle(40, 50); };

    await press('pMonth', 'month');
    w.shiftMonth(-1); await settle(40, 50);   // the month navigator's ‹ — June
    eq('Month (June): a twelfth of the annual targets against June', read(), ['$310', '$80'], ['$3,720', '$1,030']);
    await press('pQ', 'quarter');
    eq('Quarter: a quarter of the targets against Jul–Sep', read(), ['$930', '$150'], ['$3,720', '$1,030']);
    await press('pY', 'year');
    eq('[GUARD] Year: the annual targets against the fiscal year', read(), ['$3,720', '$1,030'], undefined);
    eq('a category name with markup draws no element', d.querySelectorAll('#budget-rows i').length, 0, 1);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
