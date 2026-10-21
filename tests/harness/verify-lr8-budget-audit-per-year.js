'use strict';
/**
 * LR8 (decision 2026-10-21: option A — the audit row keeps the STORED annual figure, which is truthful; the Audit page says
 * it is per year). Live: the user typed $25 / month, the Audit line read "Software · — · 300" with no unit.
 * Seed: Software target typed as 25 / month → stored 300 / year (LR7 model).
 *   1  the budget_targets Audit line for Software shows "300 per year"     bug: "300"
 *   2  an expense's amount on the same page has no "per year" (only budget lines are annual) (control)
 */
const { run } = require('./clientMoneyKit.js');
run('LR8 — the budget audit line says the figure is per year', async ({ w, d, settle, A, http }) => {
  await http.put('/api/budget-targets', { Software: 300 });
  try { w.showPage('audit'); } catch (_) {}
  await settle(20, 60);
  try { await w.loadAuditTrail(); } catch (_) {}
  await settle(20, 60);
  const rows = [...d.querySelectorAll('#audit-trail-body tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
  const sw = rows.find(r => r[1] === 'budget_targets' && r[5] === 'Software');
  A('1  budget line: Software new value "300 per year"', !!sw && sw[7] === '300 per year', JSON.stringify(sw));
  const exp = rows.find(r => r[1] === 'expenses' && r[5] === 'amount');
  A('2  expense amount line has no "per year" (control)', !!exp && !/per year/.test(exp[7]), JSON.stringify(exp));
});
