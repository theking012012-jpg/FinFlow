'use strict';
/**
 * verify-dd1-saas-engine.js — D-D part 1: the SaaS metrics engine (saas-metrics.js), executed on a hand-computed seed.
 * Before: the MRR page showed "—" for new / churned / expansion (no history kept) and had no churn, retention, CAC, LTV
 * or cohorts at all.
 * Seed — monthly recurring revenue by customer (H = hand-computed, Rule 6):
 *            Apr   May   Jun   Jul
 *   A        100   100   100   100        steady
 *   B        200   200   300   300        expands in Jun (+100)
 *   C          —   100   100   100        a YEARLY 1,200 from 1 May → 100 a month (bug "count when invoiced": 1,200 in May, 0 after)
 *   D        150   150     —     —        churns in Jun
 *   E          —     —    50    50        new in Jun
 *   F         80    40    40     —        contracts in May (−40), churns in Jul
 *   MRR      530   590   590   550
 * June (vs May): new 50 (E) · expansion 100 (B) · churned 150 (D) · customers at start 5 → customer churn 20.00%
 *   revenue churn (150 + 0) / 590 = 25.42% · NRR (590 + 100 − 0 − 150) / 590 = 91.53% · GRR (590 − 150) / 590 = 74.58%
 *   ARPA 590 / 5 = 118.00 · acquisition spend 500 → CAC 500.00 · gross margin 0.80 → payback 500 / (118 × 0.8) = 5.30 months
 * July: churned 40 (F) · revenue churn 40/590 = 6.78% · NRR = GRR = 550/590 = 93.22% · ARPA 550/4 = 137.50
 *   LTV = ARPA × GM ÷ avg revenue churn (May 40/530 = 0.0754717, Jun 150/590 = 0.2542373, Jul 40/590 = 0.0677966; avg 0.1325019)
 *       = 137.5 × 0.8 / 0.1325019 = 830.18      (bugs: no margin 1,037.72 · customer churn 20% → 550.00)
 * June LTV: only 2 months of movement → flagged "needs 3 months", never a number.
 * Cohorts: Apr (A,B,D,F) customers 100 / 100 / 75 / 50 % · MRR 530 → 490 (92.45%) → 440 (83.02%) → 400 (75.47%)
 */
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => a != null && Math.abs(Number(a) - Number(b)) < 0.006;
let S = null;
try { S = require(path.join(__dirname, '..', '..', 'saas-metrics.js')); } catch (_) {}

console.log('\n' + '='.repeat(78) + '\n  D-D part 1 — SaaS metrics engine on a hand-computed seed\n' + '='.repeat(78) + '\n');
A('0  the engine exists (saas-metrics.js)', !!S, 'missing');
if (S) {
  const L = [];
  const mo = (c, amt, months) => months.forEach(m => L.push({ customer: c, amount: amt, start: m + '-01', end: S.ymAdd(m, 1) + '-01' }));
  mo('A', 100, ['2026-04', '2026-05', '2026-06', '2026-07']);
  mo('B', 200, ['2026-04', '2026-05']); mo('B', 300, ['2026-06', '2026-07']);
  L.push({ customer: 'C', amount: 1200, start: '2026-05-01', end: '2027-05-01' });
  mo('D', 150, ['2026-04', '2026-05']);
  mo('E', 50, ['2026-06', '2026-07']);
  mo('F', 80, ['2026-04']); mo('F', 40, ['2026-05', '2026-06']);
  const s = S.mrrSeries(L, '2026-04', '2026-07');
  const tot = m => Object.values(s[m]).reduce((a, b) => a + b, 0);
  A('1  MRR by month 530 / 590 / 590 / 550 (the yearly 1,200 spread as 100 a month; bug: 1,690 in May)', [tot('2026-04'), tot('2026-05'), tot('2026-06'), tot('2026-07')].join() === '530,590,590,550', JSON.stringify(s));

  const jun = S.metricsFor(s, '2026-06', { grossMargin: 0.8, acquisitionSpend: 500 });
  A('2  June movement: new 50 (E) · expansion 100 (B) · contraction 0 · churned 150 (D)', near(jun.newMrr, 50) && near(jun.expansion, 100) && near(jun.contraction, 0) && near(jun.churnedMrr, 150) && jun.newCustomers.join() === 'E' && jun.churnedCustomers.join() === 'D', JSON.stringify(jun));
  A('3  June: customer churn 20.00% · revenue churn 25.42% · NRR 91.53% · GRR 74.58%', near(jun.customerChurnRate, 20) && near(jun.revenueChurnRate, 25.42) && near(jun.nrr, 91.53) && near(jun.grr, 74.58), JSON.stringify([jun.customerChurnRate, jun.revenueChurnRate, jun.nrr, jun.grr]));
  A('4  June: ARPA 118.00 · CAC 500.00 · payback 5.30 months', near(jun.arpa, 118) && near(jun.cac, 500) && near(jun.paybackMonths, 5.30), JSON.stringify([jun.arpa, jun.cac, jun.paybackMonths]));
  A('5  June: lifetime value NOT shown — only 2 months of movement, flagged (never a misleading number)', jun.ltv == null && jun.flags.some(f => /3 months/.test(f)), JSON.stringify(jun.flags));
  A('5b every figure carries its working (formula + inputs)', ['mrr', 'arpa', 'customerChurnRate', 'revenueChurnRate', 'nrr', 'grr', 'cac', 'paybackMonths'].every(k => jun.working[k] && jun.working[k].formula && jun.working[k].inputs), Object.keys(jun.working).join());

  const jul = S.metricsFor(s, '2026-07', { grossMargin: 0.8, acquisitionSpend: 0 });
  A('6  July: churned 40 (F) · revenue churn 6.78% · NRR = GRR = 93.22% · ARPA 137.50', near(jul.churnedMrr, 40) && near(jul.revenueChurnRate, 6.78) && near(jul.nrr, 93.22) && near(jul.grr, 93.22) && near(jul.arpa, 137.5), JSON.stringify([jul.churnedMrr, jul.revenueChurnRate, jul.nrr, jul.grr, jul.arpa]));
  A('7  July: LTV 830.18 (bugs: no margin 1,037.72 · customer churn 550.00)', near(jul.ltv, 830.18), JSON.stringify([jul.ltv, jul.working.ltv, jul.flags]));
  A('7b no new customers in July → CAC not worked out, and says so', jul.cac == null && jul.flags.some(f => /No new customers/.test(f)), JSON.stringify(jul.flags));

  const may = S.metricsFor(s, '2026-05', { grossMargin: 0.8 });
  A('8  May: new 100 (C) · contraction 40 (F) · NRR = GRR = 92.45%', near(may.newMrr, 100) && near(may.contraction, 40) && near(may.nrr, 92.45) && near(may.grr, 92.45), JSON.stringify([may.newMrr, may.contraction, may.nrr, may.grr]));
  // the only month with a contraction — revenue churn must include it (bug "churned only": 0.00%)
  A('8b May: revenue churn (0 churned + 40 contraction) / 530 = 7.55% (bug, churned only: 0.00%)', near(may.revenueChurnRate, 7.55), JSON.stringify(may.revenueChurnRate));

  const co = S.cohorts(s);
  const apr = co.find(g => g.start === '2026-04') || { months: [] };
  A('9  cohort April (A, B, D, F): customers 100 / 100 / 75 / 50 %', apr.size === 4 && apr.months.map(r => r.customerPct).join() === '100,100,75,50', JSON.stringify(apr.months.map(r => r.customerPct)));
  A('9b …revenue 100 / 92.45 / 83.02 / 75.47 % of its starting 530', apr.months.map(r => r.mrrPct).join() === '100,92.45,83.02,75.47', JSON.stringify(apr.months.map(r => r.mrrPct)));
  A('9c cohorts May (C) and June (E), one customer each, still 100%', co.filter(g => g.start === '2026-05' || g.start === '2026-06').every(g => g.size === 1 && g.months.every(r => r.customerPct === 100)), JSON.stringify(co.map(g => [g.start, g.size])));

  // a customer who leaves and comes back is a reactivation, not "new"
  const L2 = [{ customer: 'R', amount: 10, start: '2026-01-01', end: '2026-02-01' }, { customer: 'R', amount: 10, start: '2026-03-01', end: '2026-04-01' }];
  const s2 = S.mrrSeries(L2, '2026-01', '2026-03');
  const mar = S.metricsFor(s2, '2026-03', {});
  A('10 a customer who comes back counts as a reactivation, not a new customer', near(mar.reactivation, 10) && near(mar.newMrr, 0), JSON.stringify(mar));
}
console.log('\n' + '-'.repeat(78));
console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-D engine)'));
console.log('-'.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
