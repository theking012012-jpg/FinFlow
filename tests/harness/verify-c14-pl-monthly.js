'use strict';
/**
 * C14 (Cowork end-to-end test 3.4): the Profit & Loss statement has a month-by-month table, and its chart shows every
 * month of the period.
 * BUG: there was no monthly table, and the chart kept only the LAST 6 months, so a year with activity from March
 * showed May onward (March and April missing).
 * Seed: clientMoneyKit (Business A, today 2026-07-25, Year = Jan–Jul: 7 months) + an invoice of 700 issued
 * 2026-01-15, so the month the old chart drops has a figure.
 *   table row "Jan '26" revenue $1,700 (seed 1,000 on 01-10 + 700)  bug: no table
 *   chart labels include Jan '26 (7 months)          bug: Feb–Jul (6)
 *   table total row == the statement's totals, and Σ months == totals (independent sum of the rows)
 */
const { run } = require('./clientMoneyKit.js');

run('C14 — P&L by month: table + every month on the chart', async ({ w, d, ev, settle, eq, A }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(20, 60);
  await w.generateReport('Profit & Loss Statement'); await settle(20, 60);
  const body = d.getElementById('rpt-body');
  const tbl = d.getElementById('pl-monthly');
  const rows = tbl ? Array.from(tbl.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())) : [];
  const jan = rows.find(r => r[0] === "Jan '26");
  eq("monthly table has Jan '26 with revenue $1,700 (seed invoice 1,000 + 700)", jan ? jan[1] : null, '$1,700', null);
  eq('…one row per month Jan–Jul, plus Total', rows.map(r => r[0]), ["Jan '26", "Feb '26", "Mar '26", "Apr '26", "May '26", "Jun '26", "Jul '26", 'Total'], []);
  const labels = body ? Array.from(body.querySelectorAll('svg + div span')).map(s => s.textContent.trim()) : [];
  eq('chart shows every month of the year', labels, ["Jan '26", "Feb '26", "Mar '26", "Apr '26", "May '26", "Jun '26", "Jul '26"], ["Feb '26", "Mar '26", "Apr '26", "May '26", "Jun '26", "Jul '26"]);
  const num = t => Number(String(t).replace(/[^0-9.\-]/g, '')) * (/^[−-]/.test(String(t).trim()) ? -1 : 1);
  const months = rows.filter(r => r[0] !== 'Total'), total = rows.find(r => r[0] === 'Total') || [];
  for (const [i, k] of [[1, 'revenue'], [2, 'cost of goods'], [3, 'expenses'], [4, 'net']]) {
    const sum = Math.round(months.reduce((t, r) => t + Math.abs(num(r[i])) * (/^[−-]|\(-/.test(r[i]) ? -1 : 1), 0) * 100) / 100;
    A(`Σ months ${k} = Total row (${sum} vs ${total[i]})`, months.length > 0 && total.length > 0 && Math.abs(sum - Math.abs(num(total[i])) * (/^[−-]/.test(total[i] || '') ? -1 : 1)) < 0.01);
  }
  eq('Total revenue = statement revenue (1,820 + 700)', total[1], '$2,520');
  A('no "months do not add up" warning', !/do not add up/.test(body ? body.textContent : ''));
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/invoices', { client: 'January Client', amount: 700, status: 'pending', date: '2026-01-15', issue_date: '2026-01-15', due_date: '2026-02-15', idempotency_key: 'c14-jan' });
  if (r.status >= 300) throw new Error('invoice ' + r.status + ' ' + String(r.text).slice(0, 200));
} });
