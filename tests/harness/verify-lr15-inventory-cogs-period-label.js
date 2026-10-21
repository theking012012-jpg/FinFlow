'use strict';
/**
 * LR15 (live retest A6): the Inventory card said "COGS THIS MONTH $390" while the P&L booked that $390 in August (Oct
 * COGS $0). Read: the card's figure is window._cogsTotal — all three of its writers (app-main _loadPeriodCOGS,
 * dashboard wiring, index.html loadCOGS) fetch /api/cogs for the SELECTED DASHBOARD PERIOD, the same figure the
 * Dashboard's Net subtracts. So the number is that period's COGS and the LABEL was wrong ("this month" on a year
 * figure) — the LC2 / FIX-2 shape. Fix: the card names the period it shows (getPeriodData().label).
 *
 * clientMoneyKit seed (hand-computed): COGS June 20 (4 @ 5), July 10 (2 @ 5), year 30; clock pinned 2026-07-25.
 *   1  Year view  → card 30, label names the year ("Year to date"), never "this month"     bug: "COGS this month" + 30
 *   2  Month view → card 10, label names the month                                  (value control)
 */
const { run } = require('./clientMoneyKit.js');

run('LR15 — the Inventory COGS card names the period its figure covers', async ({ w, d, ev, settle, eq, A }) => {
  const card = () => { const v = d.getElementById('inv-cogs'); const box = v && v.closest('.mc'); const l = box && box.querySelector('.mc-label'); return { label: l ? l.textContent.trim() : null, value: v ? v.textContent.trim() : null }; };
  ev(`setPeriod(document.getElementById('pY'), 'year')`); await settle(30, 60);
  if (typeof w._loadPeriodCOGS === 'function') { try { await w._loadPeriodCOGS(); } catch (_) {} }
  try { w.showPage('inventory'); } catch (_) {}
  await settle(30, 60); try { w.renderInventory(); } catch (_) {} await settle(10, 40);
  const y = card();
  eq('1  Year view: COGS card value is the year\'s 30', y.value, '$30');
  A('1  Year view: label names the year, not "this month"', /Year to date/.test(y.label || '') && !/this month/i.test(y.label || ''), JSON.stringify(y.label));

  ev(`setPeriod(document.getElementById('pMonth'), 'month')`); await settle(30, 60);
  if (typeof w._loadPeriodCOGS === 'function') { try { await w._loadPeriodCOGS(); } catch (_) {} }
  try { w.renderInventory(); } catch (_) {} await settle(10, 40);
  const m = card();
  eq('2  Month view: COGS card value is July\'s 10', m.value, '$10');
  A('2  Month view: label names the month (Jul 2026)', /\bJul\b/.test(m.label || ''), JSON.stringify(m.label));
});
