'use strict';
/**
 * M55 (personal/business wall, 2026-10-10): the Personal page shows NO business payroll ROSTER, in any shape, and
 * cannot write the roster. The ONLY business→personal crossing is the owner's salary from a PAID payroll run (M14).
 * BUG: the Personal page had a "Monthly salary" card that read AND WROTE the business's owner payroll row
 * (POST/PUT /api/payroll — personal → business), an "Income from payroll" banner with a per-business breakdown of the
 * roster's monthly net, and an income caption listing "<business>: <roster net>".
 * Seed: clientMoneyKit + the owner on Business A's roster at 4,000/month, 10% tax (net 3,600), NO paid run.
 *   correct: no salary card, no payroll banner, caption carries no business name or roster figure,
 *            yearly income $1.0K (the side gig only)
 *   bug:     card shown, banner shown ("Business A …/mo"), caption "Business A: $3.6K net"
 */
const { run } = require('./clientMoneyKit.js');

run('M55 — Personal page shows and writes no payroll roster', async ({ w, d, ev, text, settle, eq }) => {
  try { w.showPage('personal'); } catch (_) {}
  await settle(20, 60);
  await w.loadPersonalFinance(); await settle(30, 60);
  ev(`setPersPeriod('year')`); await settle(10, 40);
  const shown = id => { const el = d.getElementById(id); return !!el && el.style.display !== 'none' && !el.closest('.hidden'); };
  eq('no "Monthly salary" card on the Personal page', shown('pers-salary-card'), false, true);
  eq('no "Income from payroll" roster banner', shown('pers-payroll-banner'), false, true);
  const cap = text('pers-income-src') || '';
  eq('income caption carries no business name or roster figure', /Business A|3\.6K|3,600/.test(cap), false, true);
  eq('yearly income is personal rows only (side gig 1,000)', text('pers-income'), '$1.0K');
  // STRUCTURAL (labelled): no page code can write the business roster from Personal.
  eq('[STRUCTURAL] no personal-page roster writer', ev(`typeof savePersonalSalary`), 'undefined', 'function');
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/payroll', { fname: 'Olive', lname: 'Owner', gross: 4000, is_owner: true, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
  if (r.status >= 300) throw new Error('owner roster ' + r.status + ' ' + r.text);
} });
