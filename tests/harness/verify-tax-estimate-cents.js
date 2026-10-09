'use strict';
/**
 * verify-tax-estimate-cents.js — L43. Tax estimate figures were rounded to whole currency units before display: the worksheet's
 * "Per Quarter" = Math.round(total / 4) and GET /api/tax-filing's estimatedTax = Math.round(taxable × rate), quarterly =
 * Math.round(estimatedTax / 4). Live (cents shown): "Per quarter $2,971.00" for an $11,885 estimate (exact 2,971.25), and
 * 4 × quarterly ≠ annual. Fix: keep cents (round to 0.01) everywhere the estimate is computed.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes: one invoice 10,003 issued 07-01 (revenue 10,003, no deductibles);
 * default 25% income-tax line.
 * HAND-COMPUTED: estimated tax 2,500.75 · per quarter 625.19 (2,500.75 / 4 = 625.1875).
 * BUGGY (pre-fix): server estimatedTax 2,501 · quarterly 625 · worksheet "Per Quarter" $625.00.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-tax-estimate-cents.js
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
    console.log('\n' + '='.repeat(78) + '\n  L43 — the tax estimate keeps cents (no whole-unit rounding)\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L43 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/invoices', { client: 'Acme', amount: 10003, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01' });
    } });
    const { window: w, settle, http } = ctx;
    await settle(40, 100);
    const tf = (await http.get('/api/tax-filing')).json || {};
    A('CONTROL: server taxable income 10,003 at a 25% rate', near(tf.taxableIncome, 10003) && near(tf.rate, 0.25), JSON.stringify({ taxable: tf.taxableIncome, rate: tf.rate }));
    A('server estimatedTax 2,500.75 (bug: 2,501)', near(tf.estimatedTax, 2500.75), 'estimatedTax=' + tf.estimatedTax);
    A('server quarterly 625.19 (bug: 625)', near(tf.quarterly, 625.19), 'quarterly=' + tf.quarterly);
    for (let i = 0; i < 250 && typeof w.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    // The worksheet renders through _fmtMoneyNative, which honours Settings → "Show cents" (whole units when off). Live had
    // cents ON ("$2,971.00"); match it, else a correct 625.19 legitimately displays as "$625" (the first owner-run of this
    // harness failed on exactly that). Pre-fix with cents on: Math.round(2500.75 / 4) = 625 → "$625.00" — still RED.
    const _cents = w.document.getElementById('s-cents');
    A('premise: the Show-cents toggle exists and is on (as on live)', !!_cents && ((_cents.checked = true), _cents.checked === true));
    await w.generateReport('Income Tax Estimate'); await settle(25, 60);
    const q = num((w.document.getElementById('tl-quarter') || {}).textContent);
    console.log('  [worksheet] per quarter=' + (w.document.getElementById('tl-quarter') || {}).textContent);
    A('worksheet "Per Quarter" $625.19 (bug: $625.00)', near(q, 625.19), 'tl-quarter=' + q);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (tax estimate keeps cents)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
