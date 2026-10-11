'use strict';
/**
 * Money audit 2026-10-09 — the NATIVE dashboard reads the server books (root fix for M10 / M29 / M37 / M38 / M39).
 * BUG: the native path recomputed the books in the browser: the monthly arrays dropped every UI-created payroll
 * run ("July 2026" parsed as 2001-07-20 — M10), counted future-dated rows (M38) and expense rows by expense_date
 * only (M39); the July profit delta compared net-with-COGS to a June without COGS (M29); and the river drew a
 * third profit figure with no COGS or payroll (M37).
 * Seed + hand-computed values: clientMoneyKit.js (Year net −1,110 · July −2,390 · June 280 incl. COGS 20).
 *   M37 river (Year): "-$1,110 net profit"            bug: "$920 net profit" (1,820 − 900: no payroll, no COGS)
 *   M29 July profit delta: "↓ 954% vs prior period"  bug: "↓ 897%" (June prior without COGS = 300)
 *   M10 the monthly series the AI reads includes payroll: July vs June "down 893%"  bug: "down 227%"
 * A future-dated (2026-09-01) invoice of 5,000 is added: it must not enter any 2026-07-25 figure (M38).
 */
const { run } = require('./clientMoneyKit.js');

run('Dashboard reads the server books (M10/M29/M37/M38/M39)', async ({ w, ev, all, text, settle, http, eq, A }) => {
  // M38 server half: Σ monthly == Year revenue even with a scheduled (future-dated) invoice.
  const rep = JSON.parse((await http.get('/api/reports?period=year&fyStart=0')).text);
  const sumRev = Math.round(rep.monthly.revByMonth.reduce((s, v) => s + v, 0) * 100) / 100;
  eq('M38 server: Σ monthly revenue == Year revenue (future invoice excluded from both)', [sumRev, rep.revenue], [1820, 1820], [6820, 1820]);
  eq('M10 server: July expense bucket includes the July payroll run', rep.monthly.expByMonth[6], 2900, 900);

  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(40, 60);
  ev(`(function(){ const wr=document.getElementById('river-wrap'); if(!wr) return; Object.defineProperty(wr,'offsetWidth',{configurable:true,get:()=>560}); Object.defineProperty(wr,'clientWidth',{configurable:true,get:()=>560}); Object.defineProperty(wr,'offsetParent',{configurable:true,get:()=>document.body}); buildRiver(getPeriodData()); })()`);
  await settle(10, 60);
  const river = (all('river-sub') || '').replace(/ ·.*$/, '');
  eq('M37 river net profit (Year) = dashboard net', river, '-$1,110 net profit', '$920 net profit');
  eq('dashboard Year net (control)', text('d-profit'), '-$1.1K');

  ev(`setPeriod(document.getElementById('pMonth'),'month')`); await settle(40, 60);
  ev(`window.updateDashboard && window.updateDashboard()`); await settle(30, 60);
  eq('M29 July profit "vs prior period" (−2,390 vs June 280, both net of COGS)', text('d-profit-chg'), '↓ 954% vs prior period', '↓ 897% vs prior period');
  // M10: the monthly EXPENSE series the AI reads carries the July payroll run. July operating profit from the
  // series = 520 − (500 + 400 + 2,000) = −2,380 vs June 300 ⇒ pct −893%. Bug (payroll dropped): 520 − 900 = −380 ⇒ −227%.
  w.updateAI && w.updateAI(); await settle(5, 40);
  const ai = all('ai-insights-list') || '';
  eq('M10 AI July "vs last month" uses the series with payroll', (ai.match(/(up|down) (\d+)% vs last month/) || []).slice(1), ['down', '893'], ['down', '227']);
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/invoices', { client: 'Future Co', amount: 5000, status: 'pending', issue_date: '2026-09-01', due_date: '2026-09-30', idempotency_key: 'fut' });
  if (r.status >= 300) throw new Error('future invoice ' + r.status);
} });
