'use strict';
/**
 * verify-cashflow-forecast.js — executes the SHIPPED forecast engine (../../cashflow-forecast.js)
 * against a hand-computed 13-week projection. Rule 4: positives + near-misses (an overdue inflow
 * that must land in week 1, an event beyond the horizon that must be ignored, a runway breach).
 * Rule 6: every expected number computed by hand below, never read from the engine.
 *
 * UNEXECUTED here: the endpoint sourcing (glBalanceSheet cash, recurring expansion, opex run-rate).
 *
 * Seed (today = 2026-10-05, startingCash = 1000):
 *   wk1: +500 (AR due 10-01, overdue→wk1) -200 (AP due 10-10)   net +300  bal 1300
 *   wk3: +300 (AR due 10-20) -2000 (big outflow 10-25)          net -1700 bal -400  ← first negative
 *   wk4: -100 (recurring bill 10-30)                            net -100  bal -500  ← lowest
 *   wk6: +200 (recurring invoice 11-15)                         net +200  bal -300
 *   (inflow due 2027-02-01 is beyond 13 weeks → ignored)
 *   totals: in 1000, out 2300, net -1300, ending -300, lowest -500@wk4, runway wk3, 11 negative weeks
 */

const { buildForecast, daysBetween, addDaysYmd } = require('../../cashflow-forecast.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

A('daysBetween 11-15 vs 10-05 = 41', daysBetween('2026-11-15', '2026-10-05') === 41, 'got ' + daysBetween('2026-11-15','2026-10-05'));
A('addDaysYmd 10-05 +6 = 10-11', addDaysYmd('2026-10-05', 6) === '2026-10-11');

const today = '2026-10-05';
const inflows = [
  { date: '2026-10-01', amount: 500, kind: 'ar', label: 'INV overdue' },   // overdue → wk1
  { date: '2026-10-20', amount: 300, kind: 'ar', label: 'INV' },           // wk3
  { date: '2026-11-15', amount: 200, kind: 'recurring_in', label: 'Retainer' }, // wk6
  { date: '2027-02-01', amount: 9999, kind: 'ar', label: 'beyond horizon' },    // ignored
];
const outflows = [
  { date: '2026-10-10', amount: 200, kind: 'ap', label: 'Bill' },          // wk1
  { date: '2026-10-25', amount: 2000, kind: 'ap', label: 'Big bill' },     // wk3
  { date: '2026-10-30', amount: 100, kind: 'recurring_out', label: 'SaaS' }, // wk4
];

const { periods, summary } = buildForecast({ startingCash: 1000, cashTracked: true, inflows, outflows, today, weeks: 13 });

A('13 periods', periods.length === 13);
A('week1 inflow 500 / outflow 200 / net 300 / balance 1300',
  periods[0].inflow === 500 && periods[0].outflow === 200 && periods[0].net === 300 && periods[0].balance === 1300,
  JSON.stringify({ in: periods[0].inflow, out: periods[0].outflow, net: periods[0].net, bal: periods[0].balance }));
A('overdue AR landed in week 1 (not dropped)', periods[0].items.some(i => i.label === 'INV overdue'));
A('week3 net -1700 / balance -400', periods[2].net === -1700 && periods[2].balance === -400, 'net=' + periods[2].net + ' bal=' + periods[2].balance);
A('week4 balance -500 (lowest point)', periods[3].balance === -500);

A('total_inflow 1000 (beyond-horizon ignored)', summary.total_inflow === 1000, 'got ' + summary.total_inflow);
A('total_outflow 2300', summary.total_outflow === 2300, 'got ' + summary.total_outflow);
A('net_change -1300', summary.net_change === -1300);
A('starting_cash 1000 + cash_tracked', summary.starting_cash === 1000 && summary.cash_tracked === true);
A('ending_balance -300', summary.ending_balance === -300, 'got ' + summary.ending_balance);
A('lowest_balance -500 at week 4', summary.lowest_balance && summary.lowest_balance.amount === -500 && summary.lowest_balance.week === 4, JSON.stringify(summary.lowest_balance));
A('runway_weeks = 3 (first negative week)', summary.runway_weeks === 3, 'got ' + summary.runway_weeks);
A('negative_weeks = 11', summary.negative_weeks === 11, 'got ' + summary.negative_weeks);

// cashTracked=false: balances null, runway null, but flows still computed.
const noCash = buildForecast({ startingCash: null, cashTracked: false, inflows, outflows, today, weeks: 13 });
A('no-cash: balances null', noCash.periods.every(p => p.balance === null));
A('no-cash: runway null, ending null', noCash.summary.runway_weeks === null && noCash.summary.ending_balance === null);
A('no-cash: flows still computed (net -1300)', noCash.summary.net_change === -1300);

const empty = buildForecast({ startingCash: 0, cashTracked: true, inflows: [], outflows: [], today, weeks: 13 });
A('empty: flat at starting cash', empty.summary.total_inflow === 0 && empty.summary.ending_balance === 0 && empty.summary.runway_weeks === null);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
