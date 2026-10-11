'use strict';
/**
 * M11 (money audit 2026-10-09): "growth" compares months that have happened.
 * BUG: AI insight and Health Score compared REV[11] (the LAST fiscal month — December, still in the future on
 * 25 July) with REV[0]: the AI said "−100% growth vs January" and Health "Growth" read 0/100 for 11 months a year.
 * Seed (clientMoneyKit): January revenue 1,000 · June (the last complete month on 2026-07-25) 300.
 *   correct: AI "−70% growth, Jun 2026 vs Jan 2026" · Health Growth = 50 + (−0.7 × 50) = 15/100
 *   bug: "-100% growth vs Jan 2026" · 0/100
 */
const { run } = require('./clientMoneyKit.js');

run('M11 — growth uses elapsed fiscal months', async ({ w, ev, all, text, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(30, 60);
  w.updateAI && w.updateAI(); w.updateHealthScore && w.updateHealthScore(); await settle(10, 50);
  const ai = all('ai-insights-list') || '';
  eq('AI Year growth sentence', (ai.match(/(-?\d+)% growth, (\w+ \d{4}) vs (\w+ \d{4})/) || []).slice(1), ['-70', 'Jun 2026', 'Jan 2026'], undefined);
  eq('AI never says −100% growth for a month that has not happened', /-100% growth/.test(ai), false, true);
  eq('Health "Growth" sub-score', text('hs-gr-v'), '15/100', '0/100');
});
