'use strict';
/**
 * verify-la1-dashboard-counter-spa.js — LA1 (live audit 2026-10-13 B1) in the REAL app: the dashboard's
 * Outstanding / Investments cards must keep the canonical writer's value even when the count-up animation
 * started while the card still read "$0".
 *
 * Boots the real SPA in jsdom against a real scratch Postgres (clientMoneyKit seed). The unit-level race is
 * verify-la1-counter-race.js (no DB); this one proves the FIXED counter is the runtime winner in the app
 * (Rule 1 — app-main.js used to declare its own copy) and that the real writer's value survives.
 *
 * HAND-COMPUTED (clientMoneyKit): Outstanding = 1,000 (Jan, unpaid) + 350 (600 − 250 paid) + 0 (300 paid in full)
 *   − 80 open credit note = 1,270. Draft 9,999 excluded. Bug gives "$0" (the snapshot the animation replays).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la1-dashboard-counter-spa.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA1 — dashboard cards keep the real value when the counter animation started on "$0" (real SPA)', async ({ w, d, settle, A, eq }) => {
  eq('runtime winner: window.animateCounter is finflow-counter.js (no app-main copy shadows it)',
    !!(w.FinFlowCounter && w.animateCounter === w.FinFlowCounter.animateCounter && w.animateCounters === w.FinFlowCounter.animateCounters), true, false);

  const out = d.getElementById('d-outstanding');
  eq('Outstanding after boot (hand-computed)', out && out.textContent.trim(), '$1,270');

  // Reproduce the live race: the card reads "$0" (pre-data paint) when the animation starts; the real
  // writer (the app's own updateDashboard → updateKPIs) repaints a moment later, inside the animation window.
  out.textContent = '$0';
  w.animateCounters(d.getElementById('page-dashboard'));
  await new Promise(r => setTimeout(r, 40));
  w.updateDashboard();
  await settle(20, 75);   // well past the 700 ms animation
  eq('Outstanding after a mid-animation repaint', out.textContent.trim(), '$1,270', '$0');
});
