'use strict';
/**
 * verify-reports-parity.js — Phase 1.1 / L12–L13: every generated report on the Reports page shows the
 * same money as the dashboard / server for the fiscal year (Rule 2: exports + reports are surfaces).
 *
 * Seed: fullLegScenario (FY2026, June) + PRIOR-fiscal-year rows that every FY2026 figure must exclude:
 *   a PAID payroll run for period 2025-12 (gross 111 + bonus 777 = 888) and a 100%-deductible expense
 *   dated 2025-11-20 (amount 10). Hand-computed FY2026 values (today pinned 2026-07-25):
 *     P&L           revenue 745 · expenses 614 · net 131; expense lines Payroll 550 · Bills & vendors 44 ·
 *                   Journal entries 12 · Office 8 (L14 — bug: "Bills & other" 56)
 *     Balance Sheet AR 635 · AP 22 · equity 131 (2025 rows: the 2025 run + expense hit equity → see below)
 *     Cash Flow     in 110 · out 292 (FY2026 window; journal cash legs incl. — L6)
 *     AR 635 · AP 22 · Sales by Customer 745
 *     Payroll Summary  total gross 550 = approved 300 + paid 250 (draft 199 + prior-FY 888 excluded)
 *                      BUG (all runs, all time): 199 + 250 + 300 + 888 = 1637
 *     1099 / W-2       FY2026 recognised runs = 550 (approved 300 + paid 250)   BUG: 1637
 *     Tax-Deductible   FY2026: Office 8 × 'half' = 4                   BUG ('yes' only, all time): 10
 *     Expense Report  FY2026 recorded expense rows: Office 8 (the 2025 Software 10 excluded)
 *     Income Tax Estimate taxable = revenue 745 − deductible 4 = 741 (control — already canonical)
 *     Cash Flow BUG (all time): out 292 + 888 (2025 paid run) + 10 (2025 expense) = 1190
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-reports-parity.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const money = s => { const m = String(s == null ? '' : s).replace(/[,\s]/g, '').match(/(-?)[^\d-]*(-?\d+(?:\.\d+)?)/); return m ? (m[1] === '-' ? -1 : 1) * parseFloat(m[2]) : NaN; };

async function seed({ http, client }) {
  const ids = await postFullLegScenario({ http, client });
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
  const emps = J(await http.get('/api/payroll'));
  const emp = (Array.isArray(emps) ? emps : []).find(x => x.fname === 'Ann');
  const prior = J(await http.post('/api/payroll-runs', { period: '2025-12', bonus_overrides: { [emp.id]: 777 } }));
  await client.query(`UPDATE payroll_runs SET run_date='2025-12-28' WHERE id=$1`, [prior.id]);
  J(await http.put('/api/payroll-runs/' + prior.id + '/approve', {}));
  J(await http.put('/api/payroll-runs/' + prior.id + '/mark-paid', {}));
  // L7: mark-paid stamps paid_date = today (2026-07-25, pinned); this run was PAID in the prior year — date it so.
  await client.query(`UPDATE payroll_runs SET paid_date='2025-12-28' WHERE id=$1`, [prior.id]);
  J(await http.post('/api/expenses', { description: 'Prior-year software', category: 'Software', amount: 10, expense_date: '2025-11-20', deductible: 'yes' }));
  return ids;
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L12/L13 — generated reports match the books (FY2026)\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window, settle } = ctx;
    await settle(60, 100);
    window.showPage('reports'); await settle(15, 100);
    // Leaf text nodes joined with ' | ' so adjacent tiles ("$131" + "17.6% net margin") never fuse into one number.
    const gen = async name => { await window.generateReport(name); await settle(20, 100);
      const b = window.document.getElementById('rpt-body'); if (!b) return '';
      const out = [], walk = n => { if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out.push(t); } else n.childNodes.forEach(walk); };
      walk(b); return out.join(' | '); };
    // First money token after `label` (the value sits in the next text node).
    const after = (txt, label) => { const i = txt.indexOf(label + ' | '); if (i < 0) return NaN;
      const m = txt.slice(i + label.length + 3).match(/^[^|]*?(-?)[$€£]?\s*(-?[\d,]+(?:\.\d+)?)(K|M)?/); if (!m) return NaN;
      return (m[1] === '-' ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')) * (m[3] === 'K' ? 1e3 : m[3] === 'M' ? 1e6 : 1); };

    const pl = await gen('Profit & Loss Statement');
    A('P&L: revenue 745 · expenses 614 · net 131', near(after(pl, 'Total Revenue'), 745) && near(after(pl, 'Total Operating Expenses'), 614) && near(after(pl, 'Net Profit'), 131), pl.slice(0, 300));
    // L14: the P&L's operating-expense lines use the ONE category list (D3), not a "Bills & other" remainder.
    A('P&L lines: "Bills & vendors" 44 + "Journal entries" 12 (bug: one "Bills & other" 56)',
      near(after(pl, 'Bills & vendors'), 44) && near(after(pl, 'Journal entries'), 12) && !/Bills & other/.test(pl), pl.slice(pl.indexOf('Operating Expenses'), pl.indexOf('Operating Expenses') + 260));
    const cf = await gen('Cash Flow Statement');
    A('Cash Flow: in 110 · out 292', near(after(cf, 'Total Inflow'), 110) && near(after(cf, 'Total Outflow'), 292), cf.slice(0, 200));
    const ar = await gen('Accounts Receivable');
    A('AR report: 635', near(after(ar, 'Total Receivable'), 635), ar.slice(0, 160));
    const ap = await gen('Accounts Payable');
    A('AP report: 22', near(after(ap, 'Total Payable'), 22), ap.slice(0, 160));
    const sc = await gen('Sales by Customer');
    A('Sales by Customer: 745', near(after(sc, 'Total Revenue'), 745), sc.slice(0, 200));
    const ps = await gen('Payroll Summary');
    A('Payroll Summary: total gross 550 = FY2026 approved + paid (bug: 1637, all runs all time)', near(after(ps, 'Total Gross'), 550), ps.slice(0, 260));
    const w2 = await gen('1099 / W-2 Summary');
    A('1099/W-2: FY2026 recognised wages = 550 (bug: 1637)', near(after(w2, 'Total Wages'), 550), w2.slice(0, 260));
    const td = await gen('Tax-Deductible Expenses');
    A('Tax-Deductible: FY2026 total 4 (Office 8 × half; bug: 10 = prior-year yes-only)', near(after(td, 'Total Deductible'), 4), td.slice(0, 260));
    const er = await gen('Expense Report');
    A('Expense Report: FY2026 recorded expenses = Office 8 only (prior-year Software 10 excluded)', /Office/.test(er) && !/Software/.test(er), er.slice(0, 300));
    const it = await gen('Income Tax Estimate');
    A('Income Tax Estimate: taxable 741 = 745 − 4 (control)', near(after(it, 'Taxable Income'), 741), it.slice(0, 260));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (reports parity)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
