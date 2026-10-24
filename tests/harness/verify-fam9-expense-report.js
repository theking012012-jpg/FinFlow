'use strict';
/**
 * verify-fam9-expense-report.js — FA-M9 (full app audit M9: "Expense Report total $4,701 incl. bills & payroll, the
 * breakdown covers only $3,059; no by-vendor view although the card says 'by category and vendor'"). The breakdown
 * listed recorded-expense categories only; bills, payments made, payroll and vendor credits were in the total but in no
 * row; expenses had no vendor at all.
 * After: an expense can carry a vendor (optional, saved-vendor picker); the report shows the total broken down three
 * ways — by source, by category, by vendor — and EACH adds up to the total (computeExpenseBreakdown's own legs).
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres, NO base seed. Clock 2026-07-25, fiscal year to date.
 *   expenses: Software 100 (vendor AWS, saved through the real route) · Meals 50 (no vendor)
 *   bill: Acme Supplies 400 (issued 10 Jul) · payment made, no bill: AWS 30 · payroll run Jul approved: gross 1,000
 *   vendor credit: AWS −20 (Open)
 *   EXPECTED by hand: total 1,560
 *     by source   — Recorded expenses 150 · Bills 400 · Payments made (no bill) 30 · Payroll 1,000 · Vendor credits −20
 *     by category — Payroll 1,000 · Bills & vendors 410 (400 + 30 − 20) · Software 100 · Meals 50  (the shared D3 rows)
 *     by vendor   — Payroll (employees) 1,000 · Acme Supplies 400 · AWS 110 (100 + 30 − 20) · No vendor 50
 *   bug: rows Software 100 · Meals 50 only (sum 150 ≠ 1,560); no vendor rows; the expense's vendor is dropped
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam9-expense-report.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    let ent = null;
    boot = await bootSpaInJsdom({
      baseSeed: false,
      seedExtra: async (c, uid) => {
        ent = (await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2) RETURNING id`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
        const ins = (t, d) => c.query(`INSERT INTO ${t} (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [uid, ent, d]);
        await ins('expenses', { description: 'Team lunch', category: 'Meals', amount: 50, expense_date: '2026-07-03' });
        await ins('bills', { vendor: 'Acme Supplies', amount: 400, status: 'unpaid', issue_date: '2026-07-10', due_date: '2026-08-09', num: 'BILL-0001' });
        await ins('payments_made', { vendor: 'AWS', amount: 30, date: '2026-07-12', method: 'card' });
        await ins('vendor_credits', { vendor: 'AWS', amount: 20, status: 'Open', date: '2026-07-14' });
        const run = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net, notes) VALUES ($1,$2,'2026-07',NOW(),'approved',1000,200,800,'') RETURNING id`, [uid, ent])).rows[0].id;
        await c.query(`INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,1,'Alice A',1000,0,0,'[]'::jsonb,800)`, [run]);
      },
    });
    const { window, http, settle } = boot;
    for (let i = 0; i < 250 && typeof window.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    // the Software expense goes in through the REAL route, with its vendor
    const ex = await http.post('/api/expenses', { description: 'Cloud hosting', category: 'Software', amount: 100, expense_date: '2026-07-05', vendor: 'AWS', idempotency_key: 'm9-exp' });
    A('premise: expense saved (201)', ex.status === 201, 'status ' + ex.status);
    A('1  the expense keeps its vendor "AWS" (bug: dropped)', ex.json && ex.json.vendor === 'AWS', JSON.stringify(ex.json || {}).slice(0, 160));
    try { if (typeof window.loadExpensesFromDB === 'function') await window.loadExpensesFromDB(); } catch (_) {}
    try { if (typeof window._bootDashboardWiring === 'function') await window._bootDashboardWiring(); } catch (_) {}   // the dashboard loader re-reads every leg
    await settle(14, 80);
    try { window.currentPeriod = 'year'; } catch (_) {}
    await window.generateReport('Expense Report');
    await settle(25, 60);
    const body = window.document.getElementById('rpt-body');
    const txt = (body ? body.textContent : '').replace(/\s+/g, ' ');
    console.log('  [report] ' + txt.slice(0, 600));
    const amt = n => (n < 0 ? '[−-]\\$' : '\\$') + Math.abs(n).toLocaleString('en-US') + '(\\.00)?(?![\\d,])';
    const has = (label, n) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^$−-]{0,40}' + amt(n)).test(txt);
    const section = (title) => { const i = txt.indexOf(title); if (i < 0) return ''; const rest = txt.slice(i + title.length); const j = rest.search(/By (source|category|vendor)/); return j < 0 ? rest : rest.slice(0, j); };
    A('2  Expenses total $1,560', /Expenses[^$]{0,20}\$1,560/.test(txt), '');
    const src = section('By source'), cat = section('By category'), ven = section('By vendor');
    const inSec = (sec, label, n) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^$−-]{0,40}' + amt(n)).test(sec);
    A('3  By source: expenses 150 · bills 400 · payments made 30 · payroll 1,000 · vendor credits −20 (bug: no such section)',
      inSec(src, 'Recorded expenses', 150) && inSec(src, 'Bills', 400) && inSec(src, 'Payments made (no bill)', 30) && inSec(src, 'Payroll', 1000) && inSec(src, 'Vendor credits', -20), src.slice(0, 300));
    A('4  By category (the shared D3 rows) adds up to the total: Payroll 1,000 · Bills & vendors 410 (400 + 30 − 20) · Software 100 · Meals 50 (bug: 150 of 1,560)',
      inSec(cat, 'Payroll', 1000) && inSec(cat, 'Bills & vendors', 410) && inSec(cat, 'Software', 100) && inSec(cat, 'Meals', 50), cat.slice(0, 300));
    A('5  By vendor: Payroll (employees) 1,000 · Acme Supplies 400 · AWS 110 = 100 + 30 − 20 · No vendor 50 (bug: no vendor view)',
      inSec(ven, 'Payroll (employees)', 1000) && inSec(ven, 'Acme Supplies', 400) && inSec(ven, 'AWS', 110) && inSec(ven, 'No vendor', 50), ven.slice(0, 300));
    A('6  no "recorded expenses only" disclaimer is needed any more', !/recorded expenses only/i.test(txt), '');
    void has;
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-M9 expense report)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
