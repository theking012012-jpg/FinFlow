'use strict';
/**
 * verify-compact-money-rounding.js — L53. The ONE compact money formatter (_fmtMoney, app-main.js — every abbreviating formatter
 * delegates to it: S / S2 / SP / dashboard KPI tiles) rounded with (a/1e3).toFixed(1). Binary floating point stores 11.35 as
 * 11.3499…, so ties round DOWN inconsistently: live Expenses $11,350 showed "$11.3K" while Revenue $50,390 showed "$50.4K".
 * It also never rolled over: $999,950 showed "$1000.0K". Fix: round to tenths on an exact scale (a / 100 for K — integer halves
 * are exact in binary), half away from zero, and roll over to the next unit when the rounded value reaches 1,000.
 * Executed against the real formatter in the booted app (Rule 5).
 *
 * HAND-COMPUTED: 11,350 → $11.4K · 2,050 → $2.1K · 50,390 → $50.4K · 999,950 → $1.0M · 1,234,567 → $1.2M · −11,350 → -$11.4K ·
 * 999 → $999 · 12,340,000 → $12.3M.
 * BUGGY (pre-fix): $11.3K · $2.0K (2.05 → "2.0") · $1000.0K.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-compact-money-rounding.js
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
    console.log('\n' + '='.repeat(78) + '\n  L53 — compact money format rounds ties consistently and rolls over at 1,000\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const r = await http.post('/api/entities', { name: 'L53 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      if (r.status >= 300) throw new Error('entity ' + r.status);
    } });
    const { window: w, settle } = ctx;
    await settle(20, 100);
    A('premise: the shared formatter is loaded', typeof w._fmtMoney === 'function');
    const cases = [[11350, '$11.4K', '$11.3K'], [2050, '$2.1K', '$2.0K'], [50390, '$50.4K'], [999950, '$1.0M', '$1000.0K'],
      [1234567, '$1.2M'], [-11350, '-$11.4K', '-$11.3K'], [999, '$999'], [12340000, '$12.3M']];
    for (const [n, want, bug] of cases) {
      const got = w._fmtMoney(n, '$');
      A(`_fmtMoney(${n}) = ${want}` + (bug ? ` (bug: ${bug})` : ''), got === want, 'got ' + got);
    }
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (compact money rounding)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
