'use strict';
/**
 * verify-f126-display-currency-mrr-scenario — F126: with a display currency chosen, MRR / ARR and the Scenario planner
 * show that currency's converted figures, like the dashboard. Re-measured 2026-11-02: MRR / ARR were already converted
 * (server ?display= on /api/recurring-invoices, the ledger row was stale); the Scenario planner was NOT — it projected
 * from the business's own figures under its own symbol whatever the display currency.
 * Real server + scratch Postgres + the real /app in Chromium (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f126-display-currency-mrr-scenario.js
 *
 * Seed (Rule 4): a TTD business, USD→TTD 6.8. Monthly retainer TT$6,800; this year's invoice TT$68,000 and expense
 * TT$13,600. Display USD → MRR $1,000, ARR $12,000 (already right on HEAD — regression guards); Scenario revenue $10,000.00 and profit
 * $8,000.00 with every slider at 0 (bug: TT$68,000.00 / TT$54,400.00).
 */
const { runBrowser } = require('./browserKit.js');
const N = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
runBrowser('F126 — MRR / ARR and the Scenario planner in the display currency', async ({ open, A, eq, J, http, c, uid }) => {
  const e1 = (await J('GET', '/api/entities'))[0];
  await J('PUT', '/api/entities/' + e1.id, { currency: 'TTD' });
  await c.query(`DELETE FROM fx_rates WHERE user_id = $1`, [uid]);
  await c.query(`INSERT INTO fx_rates (user_id, from_currency, to_currency, rate, rate_date) VALUES ($1,'USD','TTD',6.8,'2026-01-01')`, [uid]);
  await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 68000, status: 'pending', issue_date: '2026-06-10', due_date: '2026-07-10', idempotency_key: 'f126-i1' });
  await J('POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 13600, deductible: 'yes', expense_date: '2026-06-12', idempotency_key: 'f126-e1' });
  await http.post('/api/recurring-invoices', { client: 'Retainer Co', amount: 6800, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' });
  const page = await open({ width: 1280, height: 900 });
  await page.waitForTimeout(1500);
  const native = await page.evaluate(async () => {
    showPage('scenario'); await new Promise(r => setTimeout(r, 1200)); if (window._scenarioBaseReady) await window._scenarioBaseReady;
    for (const id of ['sl-rev-growth', 'sl-headcount', 'sl-churn', 'sl-invest', 'sl-efficiency']) { const el = document.getElementById(id); if (el) el.value = '0'; }
    updateScenario();
    return { rev: document.getElementById('sc-rev').textContent, profit: document.getElementById('sc-profit').textContent };
  });
  eq('control, no display currency: Scenario revenue in the business\'s own TT$ 68,000', N(native.rev).replace(/\s/g, ''), 'TT$68,000');
  const shown = await page.evaluate(async () => {
    _applyDisplayCurrency('USD');
    await new Promise(r => setTimeout(r, 1500));
    if (typeof loadMRRData === 'function') await loadMRRData();
    const mrr = document.getElementById('mrr-val').textContent, arr = document.getElementById('arr-val').textContent;
    showPage('scenario'); await new Promise(r => setTimeout(r, 300));
    if (window._scenarioBaseReady) await window._scenarioBaseReady; await new Promise(r => setTimeout(r, 300));
    for (const id of ['sl-rev-growth', 'sl-headcount', 'sl-churn', 'sl-invest', 'sl-efficiency']) { const el = document.getElementById(id); if (el) el.value = '0'; }
    updateScenario();
    return { mrr, arr, rev: document.getElementById('sc-rev').textContent, profit: document.getElementById('sc-profit').textContent,
             base: window.BASE, salaryLbl: document.getElementById('lbl-salary').textContent, dash: document.getElementById('d-rev').textContent };
  });
  eq('MRR in USD: $1,000 (TT$6,800 ÷ 6.8) — regression guard: already converted before this commit', N(shown.mrr), '$1,000');
  A('ARR in USD: $12,000 (abbreviated or exact) — regression guard', /^\$12(,000(\.00)?|(\.0)?K)$/.test(N(shown.arr)), shown.arr);
  eq('Scenario baseline is server-converted, in USD', [Math.round(shown.base.rev), Math.round(shown.base.rev - shown.base.exp), shown.base.ccy], [10000, 8000, 'USD'], [68000, 54400, undefined]);
  eq('Scenario revenue $10,000.00 at 0% growth (bug: TT$68,000.00)', N(shown.rev).replace(/\.00$/, ''), '$10,000');
  eq('Scenario profit $8,000.00 (bug: TT$54,400.00)', N(shown.profit).replace(/\.00$/, ''), '$8,000');
  A('the slider amounts are labelled in USD too', /^\$/.test(N(shown.salaryLbl)), shown.salaryLbl);
  A('…and agree with the dashboard\'s converted Year revenue', /10,000|10\.0K|10K/.test(N(shown.dash)), shown.dash);
}, {});
