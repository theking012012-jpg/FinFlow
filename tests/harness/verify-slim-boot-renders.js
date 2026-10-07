'use strict';
/**
 * verify-slim-boot-renders.js — Phase 1.3 / L1 + L21. The production build (SLIM_APP=1) serves public/_gen/index.html,
 * where scripts/lazy-pages.js moves 47 screens into <template>s that are hydrated only when showPage opens them.
 * Render code written for the full page — `document.getElementById(id).textContent = …` — runs at BOOT (loadEntityData,
 * refreshFinancials, syncAllPayrollsToPersonal, ffLoadData …) against screens that are not hydrated yet, so it threw
 * "Cannot set properties of null (setting 'textContent')" and ABORTED ITS CALLER. Measured in real Chromium (SLIM): boot
 * logged 3 errors + 4 warnings incl. "[FinFlow] refreshFinancials failed"; throw sites renderPersonal, renderCustomers,
 * renderInvestments, updateCashflow, updateAI, updateBrandName (the plan's renderInvestments sighting is one of six).
 *
 * Fix under test: the lazy hook hydrates a screen when getElementById asks for an id inside it.
 *
 * Executed here (portable — jsdom, the SLIM document the server really serves, VERIFICATION seed):
 *   - the document IS the slim build (lazy <template>s present) — else this probe proves nothing
 *   - each boot render runs without throwing (pre-fix: all five threw)
 *   - refreshFinancials('all') completes — no "refreshFinancials failed" (pre-fix: failed)
 *   - the boot render's data LANDS: Customers "Total" card == the customers in the database
 *   - laziness kept: a screen no boot render touches (Help) is still un-hydrated
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-slim-boot-renders.js
 */
require('./clock.js');
process.env.SLIM_APP = '1';
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L1/L21 — SLIM build: boot renders reach lazy screens instead of throwing\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({});
    const { window: w, settle, client: c, userId, consoleWarns, consoleErrors } = ctx;
    await settle(80, 100);
    const lz = w.document.querySelectorAll('template[data-lz]').length;
    A('served document is the SLIM build (lazy screens present)', lz > 20, 'lazy templates=' + lz);

    for (const f of ['renderCustomers', 'renderPersonal', 'renderInvestments', 'updateCashflow', 'updateAI']) {
      let err = null; try { w.eval(f + '()'); } catch (e) { err = e.message; }
      A(`boot render ${f}() runs without throwing (pre-fix: null textContent)`, !err, err);
    }
    consoleWarns.length = 0; consoleErrors.length = 0;
    let rfErr = null; try { await w.refreshFinancials('all'); } catch (e) { rfErr = e.message; }
    await settle(20, 100);
    const failed = consoleWarns.concat(consoleErrors).filter(m => /refreshFinancials failed|Cannot set properties of null/.test(m));
    A('refreshFinancials(\'all\') completes (no "refreshFinancials failed")', !rfErr && failed.length === 0, rfErr || JSON.stringify(failed.slice(0, 3)));

    const n = (await c.query(`SELECT COUNT(*)::int n FROM customers WHERE user_id = $1`, [userId])).rows[0].n;
    const shown = (w.document.getElementById('cust-total') || {}).textContent;
    A(`Customers "Total" card == ${n} customers in the database (the boot render's data landed)`, n > 0 && String(shown).trim() === String(n), 'shown=' + shown + ' db=' + n);
    const help = w.document.querySelector('#page-help');
    A('laziness kept: Help (no boot render) is still un-hydrated', !!help && help.hasAttribute('data-lz'), 'page-help data-lz=' + (help && help.getAttribute('data-lz')));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (SLIM boot renders)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
