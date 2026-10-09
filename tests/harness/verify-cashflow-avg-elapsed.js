'use strict';
/**
 * verify-cashflow-avg-elapsed.js — L48. Cash Flow page "Avg monthly" divided the fiscal-year cash net by getPeriodData().months,
 * which is 12 for the year view regardless of the date (live 8 Oct: $1,740 / 12 = $145 with only 10 fiscal months started; the
 * two future months are always 0). Fix: divide by the period's ELAPSED months (_periodWindow → resolvePeriod.elapsedMonths:
 * fiscal months started as of the entity's today, min 1, cap 12), keep cents, and say how many months it covers.
 *
 * Seed (UTC entity, January fiscal year, pinned 2026-07-25 ⇒ 7 fiscal months started), real routes:
 *   sales receipt 700 (06-10, cash in) · expense 140 (07-05, cash out)   ⇒ FY cash net 560
 * HAND-COMPUTED: Avg monthly = 560 / 7 = 80.00 · label mentions 7 months.   BUGGY: 560 / 12 = 46.67 (shown as $47).
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-cashflow-avg-elapsed.js
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
    console.log('\n' + '='.repeat(78) + '\n  L48 — Cash Flow "Avg monthly" divides by the months that have started\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L48 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/sales-receipts', { customer: 'Walk-in', amount: 700, date: '2026-06-10' });
      await J('/api/expenses', { description: 'Courier', amount: 140, expense_date: '2026-07-05', category: 'Office', deductible: 'yes' });
    } });
    const { window: w, settle } = ctx;
    await settle(40, 100);
    if (typeof w._loadCashMonthly === 'function') { try { await w._loadCashMonthly(); } catch (_) {} }
    w.showPage('cashflow'); await settle(30, 100);
    if (typeof w.updateCashflow === 'function') { try { w.updateCashflow(); } catch (_) {} await settle(10, 100); }
    const d = w.document;
    const net = num((d.getElementById('cf-net') || {}).textContent);
    const avg = num((d.getElementById('cf-avg') || {}).textContent);
    const lbl = ((d.getElementById('cf-avg-lbl') || {}).textContent || '').trim();
    console.log('  [cards] net=' + (d.getElementById('cf-net') || {}).textContent + ' avg=' + (d.getElementById('cf-avg') || {}).textContent + ' label=' + lbl);
    A('CONTROL: fiscal-year cash net $560 (700 in − 140 out)', near(net, 560), 'cf-net=' + net);
    A('Avg monthly = 560 / 7 started months = $80.00 (bug: 560 / 12 ≈ $47)', near(avg, 80), 'cf-avg=' + avg);
    A('the label says how many months the average covers (7)', /\b7\b/.test(lbl), 'cf-avg-lbl="' + lbl + '"');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (avg monthly over elapsed months)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
