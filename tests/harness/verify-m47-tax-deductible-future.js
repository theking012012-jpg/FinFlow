'use strict';
/**
 * M47 (money audit 2026-10-09, CODE-READ claim): "the Tax-Deductible report has no D2 bound (future-dated expenses
 * count)". CLEARED BY EXECUTION 2026-10-10: the report filters through _periodWindow, whose inWin carries the D2 bound
 * (y <= today) — this harness passes on the pre-fix code too. Kept as a regression guard.
 * EXECUTED here: a future-dated deductible expense must not appear in the report for 2026-07-25.
 * Seed: clientMoneyKit (rent 500, deductible yes, 2026-07-01) + a deductible expense 777 dated 2026-09-01 (future).
 *   correct: Total Deductible $500 · the claim's bug value: $1,277
 */
const { run } = require('./clientMoneyKit.js');

run('M47 — Tax-Deductible report excludes future-dated expenses', async ({ w, ev, all, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(20, 60);
  w.showPage('reports'); await settle(10, 60);
  await w.generateReport('Tax-Deductible Expenses'); await settle(20, 60);
  const body = (all('rpt-body') || '');
  const m = [...body.matchAll(/Total Deductible\s*(\$[0-9]{1,3}(?:,[0-9]{3})*)/g)];
  eq('Total Deductible (Year, as of 2026-07-25)', m.length ? m[m.length - 1][1] : null, '$500', '$1,277');
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/expenses', { description: 'Prepaid conference', category: 'Travel', amount: 777, deductible: 'yes', expense_date: '2026-09-01', idempotency_key: 'm47-fut' });
  if (r.status >= 300) throw new Error('future expense ' + r.status);
} });
