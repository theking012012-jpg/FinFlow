'use strict';
/**
 * verify-segments.js — executes the SHIPPED segment engine (../../segments.js) against a
 * hand-computed grouping. Rule 4: tagged + untagged rows, both dimensions, a loss segment.
 * Rule 6: expected numbers computed by hand below.
 *
 * Seed (dim=class):
 *   "Retail":  rev 1000+500=1500, exp 300           -> net 1200
 *   "Wholesale": rev 2000,         exp 2500          -> net -500   (a loss segment)
 *   untagged:  rev 400,            exp 100           -> net 300    -> '(unassigned)'
 *   totals: rev 3900, exp 2900, net 1000
 */

const { buildSegments, UNASSIGNED } = require('../../segments.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

const revenueRows = [
  { amount: 1000, class: 'Retail',    location: 'North' },
  { amount: 500,  class: 'Retail',    location: 'South' },
  { amount: 2000, class: 'Wholesale', location: 'North' },
  { amount: 400,  class: '',          location: '' },          // untagged
];
const expenseRows = [
  { amount: 300,  class: 'Retail',    location: 'North' },
  { amount: 2500, class: 'Wholesale', location: 'South' },
  { amount: 100,  class: null,        location: null },        // untagged
];

const byClass = buildSegments({ revenueRows, expenseRows, dim: 'class' });
const seg = (k) => byClass.segments.find(s => s.key === k);

A('dim echoed as class', byClass.dim === 'class');
A('Retail rev 1500 / exp 300 / net 1200', seg('Retail') && seg('Retail').revenue === 1500 && seg('Retail').expense === 300 && seg('Retail').net === 1200, JSON.stringify(seg('Retail')));
A('Wholesale net -500 (loss segment)', seg('Wholesale') && seg('Wholesale').net === -500);
A('untagged -> (unassigned) rev 400 exp 100 net 300', seg(UNASSIGNED) && seg(UNASSIGNED).revenue === 400 && seg(UNASSIGNED).expense === 100 && seg(UNASSIGNED).net === 300);
A('totals rev 3900 / exp 2900 / net 1000', byClass.totals.revenue === 3900 && byClass.totals.expense === 2900 && byClass.totals.net === 1000, JSON.stringify(byClass.totals));
A('segment_count = 2 assigned', byClass.segment_count === 2);
A('(unassigned) sorts last', byClass.segments[byClass.segments.length - 1].key === UNASSIGNED);
A('assigned sorted by net desc (Retail before Wholesale)', byClass.segments[0].key === 'Retail' && byClass.segments[1].key === 'Wholesale');

// Dimension switch: by location regroups the SAME rows differently.
const byLoc = buildSegments({ revenueRows, expenseRows, dim: 'location' });
const locN = byLoc.segments.find(s => s.key === 'North');
// North revenue: 1000 (Retail/North) + 2000 (Wholesale/North) = 3000; expense: 300 (Retail/North) = 300
A('by location: North rev 3000 / exp 300', locN && locN.revenue === 3000 && locN.expense === 300, JSON.stringify(locN));
A('location totals equal class totals (same rows)', byLoc.totals.revenue === 3900 && byLoc.totals.net === 1000);

// Totals invariant: segment totals == raw sums (Rule 2: can't invent/lose a dollar).
const rawRev = revenueRows.reduce((s, r) => s + r.amount, 0);
const rawExp = expenseRows.reduce((s, r) => s + r.amount, 0);
A('segment totals tie to the rows passed in', byClass.totals.revenue === rawRev && byClass.totals.expense === rawExp);

// Bad dim falls back to class; empty input is safe.
A('unknown dim falls back to class', buildSegments({ revenueRows, expenseRows, dim: 'xyz' }).dim === 'class');
const empty = buildSegments({});
A('empty input -> zero totals, no segments', empty.totals.revenue === 0 && empty.segments.length === 0 && empty.segment_count === 0);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
