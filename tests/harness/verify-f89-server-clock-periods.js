'use strict';
/**
 * verify-f89-server-clock-periods — F89. Every client accounting "today" — the current month, the fiscal year,
 * scheduled vs issued, overdue, the forecasts — must come from the SERVER's clock (in the business's zone), not the
 * device's. A viewer whose computer clock is wrong must see the same periods as everyone else.
 *
 * Executed: the real /app in jsdom against the real server + scratch Postgres (Rule 3). The server is pinned to
 * 2026-07-25 (clock.js); the DEVICE clock is set 40 days fast (2026-09-03). Bug values: "today" 2026-09-03, the fiscal
 * month September, an invoice dated 2026-08-10 treated as already issued.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f89-server-clock-periods.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const fs = require('fs'), path = require('path');

(async () => {
  let h;
  console.log('\nF89 — periods follow the server\'s clock, not a wrong device clock\n');
  try {
    h = await bootSpaInJsdom({ deviceClockOffsetMs: 40 * 86400000 });
    await h.idle();
    const w = h.window;
    A('control: the device clock really is wrong (2026-09-03)', new w.Date().toISOString().slice(0, 10) === '2026-09-03', new w.Date().toISOString());
    A('the server\'s clock reached the page (_serverClock)', !!w._serverClock);
    A('the business\'s today is the server\'s day, 2026-07-25 (bug: 2026-09-03)', w._entityToday() === '2026-07-25', w._entityToday());
    const fy = w._fyContext();
    A('the fiscal year\'s current month is July (index 6, January year) (bug: September, 8)', fy.curFyIdx === 6 && fy.fyStartYear === 2026, JSON.stringify(fy));
    A('an invoice dated 2026-08-10 is SCHEDULED, not issued (bug: issued — the device thinks it is September)', w._isScheduled('2026-08-10') === true);
    A('…and one dated 2026-07-20 is issued', w._isScheduled('2026-07-20') === false);
    A('the forecasts / upcoming panel uses the same today (finflow-f94) (bug: 2026-09-03)', typeof w._f94EntityToday === 'function' && w._f94EntityToday() === '2026-07-25', String(w._f94EntityToday && w._f94EntityToday()));
    const m = w.FinFlowDates.resolvePeriod({ period: 'month', today: w._entityToday() });
    A('the month window sent for reports is July 2026', JSON.stringify(m).includes('2026-07-01') && !JSON.stringify(m).includes('2026-09'), JSON.stringify(m));
    // STRUCTURAL (labelled, Rule 5): the accountant-tasks "overdue" colour reads _entityToday — display only; its panel
    // needs a linked accountant to render. A value check would need that whole fixture for one colour.
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'app-26-acc-group.js'), 'utf8');
    A('[STRUCTURAL] accountant-task overdue uses _entityToday, not the device day', /const _today = \(typeof window\._entityToday === 'function'\) \? window\._entityToday\(\)/.test(src));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (h) { try { await h.stop(); } catch (_) {} } }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F89 server clock periods)\n`);
  process.exitCode = fail ? 1 : 0;
})();
