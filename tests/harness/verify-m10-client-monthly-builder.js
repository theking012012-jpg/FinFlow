'use strict';
/**
 * M10 / M38 / M39 (money audit 2026-10-09) — the browser's PROVISIONAL monthly arrays (the instant first paint, and
 * what stays on screen if the server-books request fails) mirror the server.
 * BUG: buildMonthlyArrays parsed a payroll run's period with String(period).slice(0,7) — the UI's "July 2026" became
 * 2001-07-20, so every UI-created run was dropped; it also counted future-dated rows (M38) and dated expense rows by
 * expense_date only (M39).
 * /api/reports is FAILED here (jsdomBoot failMap), so the arrays on screen are the browser's own.
 * Seed: clientMoneyKit + a future-dated (2026-09-01) expense of 4,444.
 *   July operating profit from the arrays = 520 − (500 + 400 + 2,000) = −2,380 vs June 300 ⇒ AI "down 893%"
 *   bug: payroll dropped ⇒ −380 vs 300 ⇒ "down 227%"
 */
const { run } = require('./clientMoneyKit.js');

run('M10/M38/M39 — provisional monthly arrays mirror the server', async ({ w, ev, all, settle, eq }) => {
  ev(`setPeriod(document.getElementById('pMonth'),'month')`); await settle(40, 60);
  w.updateAI && w.updateAI(); await settle(5, 40);
  const ai = all('ai-insights-list') || '';
  eq('AI July "vs last month" from the browser-built arrays', (ai.match(/(up|down) (\d+)% vs last month/) || []).slice(1), ['down', '893'], ['down', '227']);
}, { failMap: { '/api/reports': 500 }, extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/expenses', { description: 'Prepaid', category: 'Other', amount: 4444, expense_date: '2026-09-01', idempotency_key: 'm10-fut' });
  if (r.status >= 300) throw new Error('future expense ' + r.status);
} });
