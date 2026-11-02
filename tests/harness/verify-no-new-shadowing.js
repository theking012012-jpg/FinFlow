'use strict';
/**
 * verify-no-new-shadowing.js — L27 (prior audit F75; CLAUDE.md failure #1). [STRUCTURAL — labelled: an absence of
 * NEW shadowing cannot be expressed as a value.] When public/app-main.js defines `function NAME` and a wiring file
 * (bundled AFTER app-main) assigns `window.NAME = …`, the wiring copy wins at runtime and an edit to the app-main
 * copy has zero effect — two past "fixes" shipped that way and never rendered. 26 such pairs exist today
 * (19 replacements + 7 wrappers that call the saved original). Nothing stopped a new one.
 *
 * This harness recomputes the set of shadowed NAMES from source and fails on any name NOT on the reviewed list
 * below. Removing a shadow is always fine (shrink the list). Adding one requires adding it here, in review, with
 * its kind decided by reading it (R/W below are that reading — the kind is documentation, not computed: chained
 * overrides like saveExpense/renderExpenses defeat a text heuristic) — which is the point.
 *
 * Self-test (Rule 14): an injected `window.computeRevenue = function(){}` in a synthetic wiring file must be caught.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-no-new-shadowing.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  [STRUCTURAL] ' + n)) : (fail++, console.log('  FAIL  [STRUCTURAL] ' + n + (d ? '\n          ' + d : ''))); };

// Reviewed 2026-10-07 (L27). R = replacement (app-main copy is DEAD), W = wrapper (calls the saved original).
// 2026-10-14 LA7: updateInvoices removed — its dead app-main copy (pre-F56 Outstanding formula) was deleted.
// 2026-11-02 F75: all 19 replacement (R) copies DELETED from app-main — every one was installed synchronously and
// unconditionally by the bundle, and nothing referenced them at load time (checked with acorn). Only the 7 wrappers
// remain; a NEW shadow of either kind still fails this check.
// 2026-11-02 F75-b: renderProjects removed — its wrapper called the app-main copy only before the boot load answered,
// measured 0 runs (verify-f75-wrappers-live); the dead copy is deleted and the wiring copy is the one renderer. 6 wrappers.
const REVIEWED = {
  closeModal: 'W', renderDocuments: 'W', renderReports: 'W', saveOwnerPayroll: 'W',
  updateDashboard: 'W', showPage: 'W',
};

const pub = path.resolve(__dirname, '..', '..', 'public');
function appMainDefs(src) {
  const s = new Set();
  for (const m of src.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) s.add(m[1]);
  return s;
}
function shadows(defs, wiringFiles) {
  const out = {};
  for (const [file, src] of wiringFiles) {
    for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
      if (!defs.has(m[1])) continue;
      (out[m[1]] = out[m[1]] || new Set()).add(file);
    }
  }
  return out;
}
const unknownOf = found => Object.keys(found).filter(n => !(n in REVIEWED));

(async () => {
  try {
    console.log('\n' + '='.repeat(78) + '\n  L27 — no NEW dead-code shadowing of app-main functions (structural)\n' + '='.repeat(78) + '\n');
    const appMain = fs.readFileSync(path.join(pub, 'app-main.js'), 'utf8');
    const defs = appMainDefs(appMain);
    const wiring = fs.readdirSync(pub).filter(f => /^finflow-api-wiring.*\.js$/.test(f)).map(f => [f, fs.readFileSync(path.join(pub, f), 'utf8')]);
    A('read app-main definitions and the wiring sources', defs.size > 200 && wiring.length >= 8, 'defs=' + defs.size + ' wiring=' + wiring.length);
    const found = shadows(defs, wiring);
    const n = Object.keys(found).length;
    console.log('  current shadowed set: ' + n + ' — ' + Object.keys(found).sort().join(' '));
    const unknown = unknownOf(found);
    A('every shadowed app-main function is on the reviewed list (a new one must be reviewed)', unknown.length === 0,
      'NEW, unreviewed: ' + unknown.map(u => u + ' ← ' + [...found[u]].join(',')).join('; ') + '  — the app-main copy of each is now DEAD (Rule 1)');
    const gone = Object.keys(REVIEWED).filter(k => !(k in found));
    if (gone.length) console.log('  note: no longer shadowed (shrink REVIEWED): ' + gone.join(' '));

    // Rule 14 self-test: the detector must catch an injected shadow.
    const inj = shadows(defs, wiring.concat([['finflow-api-wiring-INJECTED.js', 'window.computeRevenue = function(){ /* replacement */ };']]));
    A('self-test: an injected `window.computeRevenue = function(){}` is reported as NEW', defs.has('computeRevenue') && unknownOf(inj).includes('computeRevenue'),
      'defs has computeRevenue=' + defs.has('computeRevenue') + ' unknown=' + unknownOf(inj).join(','));
    const inj2 = shadows(defs, wiring.concat([['finflow-api-wiring-INJECTED.js', 'window.updateCashflow = () => 0;']]));
    A('self-test: an injected `window.updateCashflow = …` is reported as NEW', unknownOf(inj2).includes('updateCashflow'), unknownOf(inj2).join(','));
    A('current count is 6 — the wrappers only (F75 deleted the 19 dead replacement copies, F75-b renderProjects; was 26)', n === 6 && Object.values(REVIEWED).every(v => v === 'W'), 'n=' + n);
    const stillR = Object.keys(found).filter(k => REVIEWED[k] !== 'W');
    A('no app-main function is a dead replacement copy any more (every remaining shadow is a wrapper)', stillR.length === 0, stillR.join(', '));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (no new shadowing)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
