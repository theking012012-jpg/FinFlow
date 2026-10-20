'use strict';
/**
 * verify-lr2-lr3-money-flow-refresh.js — LR2 / LR3 (live retest 2026-10-20): the Dashboard "Money flow" block went stale.
 *   LR2: after a new expense it kept the old net profit across Dashboard visits while the cards, Reports and
 *        /api/reports had the new one — only a full reload fixed it.
 *   LR3: after switching business it stayed "Loading…" until a reload.
 * Shared root (read): buildRiver does not paint while the Dashboard is hidden (0 width), and the only repaint on coming
 * back — the river's ResizeObserver — fired only when the width DIFFERED from the last visible width. Hiding reported 0
 * without resetting it, so returning at the same width repainted nothing.
 *
 * Real Chromium, production build, real server + scratch Postgres. Seed (Rule 4 — every bug value differs):
 *   Northwind (USD): invoice 1,000 + expense 200 → net 800;  + an $88 expense saved from the Expenses page → 712
 *   Island (TTD):    invoice 500 + expense 100   → net 400
 *   1. Dashboard caption shows net 800                                         (old: 800 — baseline)
 *   2. $88 expense while on Expenses, back to Dashboard → caption net 712       (old: 800)
 *   3. switch to Island from the Entities page, back to Dashboard → net 400,
 *      and no "Loading…" left in the river                                      (old: "Loading…")
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lr2-lr3-money-flow-refresh.js
 */
process.env.SLIM_APP = '1';
const { runBrowser } = require('./browserKit.js');

runBrowser('LR2 / LR3 — the Money-flow river repaints after a change made off the Dashboard', async ({ open, eq }) => {
  const page = await open({ width: 1280, height: 900 });
  await page.waitForTimeout(2500);
  const river = () => page.evaluate(() => ({
    sub: (document.getElementById('river-sub') || {}).textContent || '',
    loading: /Loading…/.test((document.getElementById('river-wrap') || {}).textContent || ''),
  }));
  const netOf = s => { const m = String(s).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)[^\d]*net profit/); return m ? Number(m[1]) : null; };

  await page.evaluate(() => showPage('dashboard'));
  await page.waitForTimeout(2500);
  eq('1. Northwind river caption: net 800', netOf((await river()).sub), 800);

  // LR2: the expense is saved while the Dashboard is hidden, the way the Expenses page saves it; the app refreshes.
  await page.evaluate(() => showPage('expenses'));
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    await fetch('/api/expenses', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'LR2 expense', category: 'Software', amount: 88, expense_date: '2026-07-20', idempotency_key: 'lr2-e88' }) });
    if (typeof refreshFinancials === 'function') { try { await refreshFinancials(); } catch (_) {} }
    if (typeof updateDashboard === 'function') { try { updateDashboard(); } catch (_) {} }
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => showPage('dashboard'));
  await page.waitForTimeout(2500);
  eq('2. after an $88 expense saved off the Dashboard, the river shows net 712', netOf((await river()).sub), 712, 800);

  // LR3: switch business from another page, then come back.
  await page.evaluate(() => showPage('entities'));
  await page.waitForTimeout(400);
  await page.evaluate(async () => { const i = ENTITIES.findIndex(e => /Island/.test(e.name)); await switchEntity(i); });
  await page.waitForTimeout(4000);
  await page.evaluate(() => showPage('dashboard'));
  await page.waitForTimeout(3000);
  const r3 = await river();
  eq('3. after switching to Island, the river shows its own net 400 — not "Loading…"', [r3.loading, netOf(r3.sub)], [false, 400], [true, null]);
}, {
  entities: [{ name: 'Island LR', currency: 'TTD', country: 'TT', timezone: 'America/Port_of_Spain' }, { name: 'Northwind LR', currency: 'USD', country: 'US', timezone: 'UTC' }],
  seed: async ({ J }) => {
    const ents = await J('GET', '/api/entities');
    const id = re => (ents.find(e => re.test(e.name)) || {}).id;
    await J('POST', '/api/entities/' + id(/Island/) + '/activate', {});
    await J('POST', '/api/invoices', { client: 'Island client', amount: 500, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-30', idempotency_key: 'lr3-i' });
    await J('POST', '/api/expenses', { description: 'Island cost', category: 'Rent', amount: 100, expense_date: '2026-07-02', idempotency_key: 'lr3-e' });
    await J('POST', '/api/entities/' + id(/Northwind/) + '/activate', {});
    await J('POST', '/api/invoices', { client: 'Northwind client', amount: 1000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-30', idempotency_key: 'lr2-i' });
    await J('POST', '/api/expenses', { description: 'Northwind cost', category: 'Rent', amount: 200, expense_date: '2026-07-02', idempotency_key: 'lr2-e' });
  },
});
