'use strict';
/**
 * verify-no-new-shadowing.js — L27 (prior audit F75; CLAUDE.md failure #1). [STRUCTURAL — labelled: an absence of
 * NEW shadowing cannot be expressed as a value.] When public/app-main.js defines `function NAME` and a wiring file
 * (bundled AFTER app-main) assigns `window.NAME = …`, the wiring copy wins at runtime and an edit to the app-main
 * copy has zero effect — two past "fixes" shipped that way and never rendered. 27 such pairs exist today
 * (20 replacements + 7 wrappers that call the saved original). Nothing stopped a 28th.
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
const REVIEWED = {
  deleteCustomer: 'R', saveCustomer: 'R', saveSettings: 'R', saveInvoice: 'R', renderInvoices: 'R', renderInventory: 'R',
  renderPayroll: 'R', restockItem: 'R', openProductModal: 'R', saveProduct: 'R', openLogTimeModal: 'R',
  openNewProjectModal: 'R', renderTimesheet: 'R', saveJournalEntry: 'R', updateInvoices: 'R', loadPersistedData: 'R',
  persistAll: 'R', renderExpenses: 'R', saveExpense: 'R', saveHolding: 'R',
  closeModal: 'W', renderDocuments: 'W', renderProjects: 'W', renderReports: 'W', saveOwnerPayroll: 'W',
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
    A('current count is 27 (20 replacements + 7 wrappers, reviewed 2026-10-07)', n === 27, 'n=' + n);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (no new shadowing)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
