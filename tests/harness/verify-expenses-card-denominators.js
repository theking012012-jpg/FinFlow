'use strict';
/**
 * verify-expenses-card-denominators.js — L49. The Expenses page cards used two denominators side by side: "Business … N% of
 * total" (÷ total expenses incl. payroll + bills) and "N% of expenses deductible" (÷ RECORDED expense rows only). Live: "100% of
 * expenses deductible" while $2,850 of $11,350 expense was deductible. The "Business" card is in fact the recorded expense rows
 * (the data model has no business/personal split — app-main.js updateExpenses says so). Fix: label it "Recorded expenses" and put
 * BOTH percentages on the same denominator, total expenses.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes, all in July:
 *   expense 300 deductible "yes" · expense 100 deductible "no" · bill 600 (issued 07-02)  ⇒ total 1,000 · recorded 400 · deductible 300
 * HAND-COMPUTED: recorded "40% of total" · deductible "30% of total expenses".
 * BUGGY (pre-fix): deductible "75% of expenses deductible" (300 / 400); card labelled "Business".
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-expenses-card-denominators.js
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
    console.log('\n' + '='.repeat(78) + '\n  L49 — Expenses page percentages share one denominator\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L49 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/expenses', { description: 'Software', amount: 300, expense_date: '2026-07-03', category: 'Software', deductible: 'yes' });
      await J('/api/expenses', { description: 'Gift', amount: 100, expense_date: '2026-07-04', category: 'Other', deductible: 'no' });
      await J('/api/bills', { vendor: 'Landlord', amount: 600, status: 'unpaid', issue_date: '2026-07-02', due_date: '2026-08-02' });
    } });
    const { window: w, settle } = ctx;
    await settle(40, 100);
    w.showPage('expenses'); await settle(30, 100);
    if (typeof w.updateExpenses === 'function') { try { w.updateExpenses(); } catch (_) {} await settle(10, 100); }
    const d = w.document;
    const total = num((d.getElementById('ex-total') || {}).textContent);
    const rec = num((d.getElementById('ex-biz') || {}).textContent), recSub = ((d.getElementById('ex-biz-pct') || {}).textContent || '').trim();
    const ded = num((d.getElementById('ex-ded') || {}).textContent), dedSub = ((d.getElementById('ex-ded-save') || {}).textContent || '').trim();
    const recLabel = (((d.getElementById('ex-biz') || {}).parentElement || {}).querySelector ? d.getElementById('ex-biz').parentElement.querySelector('.mc-label').textContent : '').trim();
    console.log('  [cards] total=' + total + ' | ' + recLabel + '=' + rec + ' (' + recSub + ') | deductible=' + ded + ' (' + dedSub + ')');
    A('CONTROL: total 1,000 · recorded 400 · deductible 300', near(total, 1000) && near(rec, 400) && near(ded, 300), JSON.stringify({ total, rec, ded }));
    A('recorded-expenses card says "40% of total"', /\b40%/.test(recSub), 'sub="' + recSub + '"');
    A('deductible card says "30% of total expenses" (bug: "75% of expenses deductible")', /\b30%/.test(dedSub) && /total/i.test(dedSub), 'sub="' + dedSub + '"');
    A('the 400 card is labelled "Recorded expenses" (bug: "Business")', /recorded/i.test(recLabel), 'label="' + recLabel + '"');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (expenses card denominators)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
