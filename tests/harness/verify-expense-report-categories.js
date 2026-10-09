'use strict';
/**
 * verify-expense-report-categories.js — L50 (Rule 2: one category definition on every surface). The Expense Report's breakdown
 * listed byCategory — manual expense rows only ("Expense Breakdown — recorded expenses only") — under an Expenses total that
 * includes payroll and bills, while the P&L statement, dashboard bars and Expenses page use the ONE canonical list
 * (_expenseCategoryRows: direct categories + Payroll + Bills & vendors + Journal entries; L14). Live: Rent $2,850 under $11,350.
 * Fix: the Expense Report lists that same canonical list, so its rows sum to its Expenses total.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes, all July: expense 300 (Rent) · bill 600 · payroll run 2026-07 approved 1,000.
 * HAND-COMPUTED: Expenses 1,900 = Payroll 1,000 + Bills & vendors 600 + Rent 300.
 * BUGGY (pre-fix): breakdown rows = Rent 300 only (Σ 300 ≠ 1,900).
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-expense-report-categories.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(m)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const num = t => parseFloat(String(t || '').replace(/[^\d.\-]/g, ''));

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L50 — the Expense Report breaks expenses down with the same categories as the P&L\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b, m) => { const r = await (m === 'PUT' ? http.put(p, b) : http.post(p, b)); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return r.text ? JSON.parse(r.text) : {}; };
      const ent = await J('/api/entities', { name: 'L50 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/expenses', { description: 'Office rent', amount: 300, expense_date: '2026-07-03', category: 'Rent', deductible: 'yes' });
      await J('/api/bills', { vendor: 'Supplier', amount: 600, status: 'unpaid', issue_date: '2026-07-02', due_date: '2026-08-02' });
      await J('/api/payroll', { fname: 'Ada', lname: 'A', gross: 1000 });
      const run = await J('/api/payroll-runs', { period: '2026-07' });
      await J('/api/payroll-runs/' + run.id + '/approve', {}, 'PUT');
    } });
    const { window: w, settle } = ctx;
    await settle(60, 100);
    for (let i = 0; i < 250 && typeof w.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await w.generateReport('Expense Report'); await settle(25, 60);
    const body = w.document.getElementById('rpt-body');
    const txt = (body && body.textContent || '').replace(/\s+/g, ' ');
    const rows = [...(body ? body.querySelectorAll('table tr') : [])].map(tr => { const td = tr.querySelectorAll('td'); return { label: (td[0] || {}).textContent, value: num((td[1] || {}).textContent) }; });
    const sum = Math.round(rows.reduce((s, r) => s + (Number.isFinite(r.value) ? r.value : 0), 0) * 100) / 100;
    const expTile = num((txt.match(/Expenses\s*([-$\d,.]+)/) || [])[1]);
    console.log('  [report] expenses tile=' + expTile + ' rows=' + JSON.stringify(rows));
    A('CONTROL: Expenses tile 1,900 (300 + 600 + 1,000)', near(expTile, 1900), 'tile=' + expTile);
    const v = l => { const f = rows.filter(r => String(r.label || '').trim() === l); return f.length === 1 ? f[0].value : NaN; };
    A('breakdown lists Payroll 1,000 (bug: absent)', near(v('Payroll'), 1000), JSON.stringify(rows));
    A('breakdown lists Bills & vendors 600 (bug: absent)', near(v('Bills & vendors'), 600), JSON.stringify(rows));
    A('breakdown lists Rent 300', near(v('Rent'), 300), JSON.stringify(rows));
    A('breakdown rows sum to the Expenses total 1,900 (bug: 300)', near(sum, 1900) && near(sum, expTile), 'Σ=' + sum);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (expense report categories)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
