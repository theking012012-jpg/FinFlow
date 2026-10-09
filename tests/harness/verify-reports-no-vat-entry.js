'use strict';
/**
 * verify-reports-no-vat-entry.js — L56 (CLAUDE.md product facts: tax = ESTIMATES ONLY; FinFlow has NO sales-tax / VAT / GST engine,
 * by design). The Reports page listed "VAT Return — Tax collected and paid" (app-main.js taxReportsData), advertising a capability
 * the product deliberately does not have; clicking it only rendered "VAT / GST is not tracked". Fix: the entry is removed from the
 * Reports list (the not-tracked handler stays for any old deep link — verify-f137-tax-reports.js still exercises it).
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-reports-no-vat-entry.js
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

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L56 — Reports does not advertise a VAT return\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const r = await http.post('/api/entities', { name: 'L56 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      if (r.status >= 300) throw new Error('entity ' + r.status);
    } });
    const { window: w, settle } = ctx;
    await settle(30, 100);
    w.showPage('reports'); await settle(30, 100);
    if (typeof w.renderReports === 'function') { try { await w.renderReports(); } catch (_) {} await settle(10, 100); }
    const txt = ((w.document.getElementById('page-reports') || {}).textContent || '').replace(/\s+/g, ' ');
    A('CONTROL: the tax section still lists Income Tax Estimate', /Income Tax Estimate/.test(txt), txt.slice(0, 200));
    A('no "VAT Return" entry (bug: listed as "Tax collected and paid")', !/VAT Return/.test(txt) && !/Tax collected and paid/.test(txt), 'page lists VAT Return');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (no VAT entry)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
