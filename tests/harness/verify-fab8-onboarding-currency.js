'use strict';
/**
 * FA-B8 (2026-10-27) — onboarding's "Primary currency" offers every currency FinFlow supports (was 5: USD, TTD, GBP, EUR,
 * CAD). Onboarding is shown only to a user with no business yet, so this boots the real page for a brand-new user.
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const CUR = require('../../public/finflow-currency.js');
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
(async () => {
  let boot;
  console.log('\nFA-B8 — onboarding offers every supported currency\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, failMap: {}, apiSeed: async () => {} });   // no business → onboarding shows
    const { window: w, settle } = boot;
    await settle(60, 60);
    const ov = w.document.getElementById('ob-overlay');
    eq('0  setup: onboarding is shown to a user with no business', !!ov && ov.style.display !== 'none', true);
    const sel = w.document.getElementById('ob-currency');
    const vals = sel ? Array.from(sel.options).map(o => o.value) : [];
    const n = Object.keys(CUR.CURRENCIES).length;
    eq('1  onboarding offers every supported currency (' + n + ')', vals.length, n, 5);
    eq('1  …including JPY and KES; USD chosen first', [vals.includes('JPY'), vals.includes('KES'), sel && sel.value], [true, true, 'USD'], [false, false, 'USD']);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
