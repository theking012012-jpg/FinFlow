'use strict';
/**
 * verify-la13-dashboard-cogs-caption.js — LA13 (live audit 2026-10-13, minor): the dashboard's Revenue, Expenses and
 * Net Profit cards do not visibly reconcile, because Net = Revenue − COGS − Expenses and COGS is on no card
 * (live: Rev 15,400 − Exp 3,005 ≠ Net 12,005; the gap is COGS 390). The math was right; a caption under Net Profit
 * now names the COGS it is after, from the server books (the same /api/reports figure that paints the cards).
 *
 * Real SPA, real scratch Postgres, clientMoneyKit seed (clock 2026-07-25). Hand-computed, Year: COGS = 4 @ 5 (Jun)
 * + 2 @ 5 (Jul) = 30. Month (July): 2 @ 5 = 10 — the caption follows the period.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la13-dashboard-cogs-caption.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA13 — Net Profit names the cost of goods sold it is net of', async ({ w, d, all, settle, eq, http }) => {
  w.setPeriod(d.getElementById('pY'), 'year');
  await settle(40, 50);
  eq('Year: caption under Net Profit', all('d-profit-cogs'), 'after $30 cost of goods sold', null);
  w.setPeriod(d.getElementById('pMonth'), 'month');
  await settle(40, 50);
  eq('July: caption follows the period', all('d-profit-cogs'), 'after $10 cost of goods sold', null);

  // Failure path (Rule 14 / F59): under a display currency the cards are server-converted; the COGS caption is a native
  // amount, so it must hide rather than show "$" figures beside "€" cards.
  w.setPeriod(d.getElementById('pY'), 'year');
  await settle(20, 50);
  const ent = (w.ENTITIES || []).find(e => e.active);
  const fx = await http.request('POST', '/api/fx-rates', { from_currency: 'USD', to_currency: 'EUR', rate: 0.9, rate_date: '2026-01-01', entity_id: ent && ent._dbId });
  eq('FX rate seeded through the route', fx.status < 300, true);
  let sel = d.getElementById('s-currency');
  if (![...sel.options].some(o => o.value === 'EUR')) { const o = d.createElement('option'); o.value = 'EUR'; sel.appendChild(o); }
  sel.value = 'EUR';
  await w.updateCurrency();
  for (let i = 0; i < 60 && !/€/.test(all('d-rev') || ''); i++) await settle(3, 60);
  eq('display currency EUR: cards converted', /€/.test(all('d-rev') || ''), true);
  const ce = d.getElementById('d-profit-cogs');
  eq('display currency EUR: native COGS caption hidden', [ce.style.display, ce.textContent], ['none', ''], ['', 'after $30 cost of goods sold']);
});
