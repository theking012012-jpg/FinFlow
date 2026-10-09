'use strict';
/**
 * verify-no-fabricated-salary-rows.js — L58. syncAllPayrollsToPersonal (app-main.js, no wiring override) unshifts one
 * "Salary — <Entity> (April)" income row per owner-salary entity into persTransactions — amount = the ROSTER owner net, date
 * hard-coded 'Apr 30' whatever the month, no _dbId (not a stored transaction). It is a leftover of the pre-profile model: the
 * owner's salary now reaches Personal Finance as a real recurring income profile + monthly occurrence ("Owner salary — <Entity>",
 * finflow-api-wiring-medium.js). Income totals are safe — _applyPersFilter rebuilds persTransactions from _allPersTxs before
 * summing — but the transaction LIST (_renderPersTxList, run by setPersTxFilter) reads persTransactions as-is, so between a
 * sync and the next period rebuild it lists a fabricated, mis-dated row (beside the real occurrence when one exists).
 * Fix: the sync no longer injects rows; Personal Finance transactions are only stored transactions.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes: owner Olive (is_owner) gross 4,000 (roster net 4,000); no personal rows.
 * HAND-COMPUTED: after the sync, the Income filter lists no "Salary —" / "(April)" row; persTransactions holds 0 unsaved rows.
 * BUGGY (pre-fix): a "Salary — L58 Co (April)" row for $4,000 dated Apr 30.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-no-fabricated-salary-rows.js
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
    console.log('\n' + '='.repeat(78) + '\n  L58 — the payroll sync injects no fabricated "Salary — … (April)" rows\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L58 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/payroll', { fname: 'Olive', lname: 'Owner', gross: 4000, is_owner: true, emp_type: 'owner', entity_id: ent.id });
    } });
    const { window: w, settle } = ctx;
    await settle(40, 100);
    A('premise: the owner salary is loaded (roster net 4,000)', w.ownerPayroll && Math.abs((w.ownerPayroll.net || 0) - 4000) < 0.005,
      'ownerPayroll=' + JSON.stringify(w.ownerPayroll && { net: w.ownerPayroll.net }));
    w.showPage('personal'); await settle(30, 100);
    A('premise: syncAllPayrollsToPersonal and setPersTxFilter are reachable',
      typeof w.syncAllPayrollsToPersonal === 'function' && typeof w.setPersTxFilter === 'function');
    // A real sequence: any of the sync's 10 call sites (entity load, owner save, employee change …), then the user taps "Income".
    try { w.syncAllPayrollsToPersonal(); } catch (e) { console.log('  [sync threw] ' + e.message); }
    await settle(10, 100);
    w.setPersTxFilter('income'); await settle(10, 100);
    const list = ((w.document.getElementById('pers-transactions') || {}).textContent || '').replace(/\s+/g, ' ');
    console.log('  [income list] ' + list.slice(0, 200));
    A('the Income list shows no fabricated "Salary — … (April)" row (bug: $4,000 dated Apr 30)', !/Salary —/.test(list) && !/\(April\)/.test(list), list.slice(0, 200));
    const unsaved = (w.eval('typeof persTransactions !== "undefined" ? persTransactions : []') || []).filter(t => t && t._dbId == null);
    A('persTransactions holds only stored transactions (0 without a _dbId)', unsaved.length === 0, JSON.stringify(unsaved.slice(0, 3)));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (no fabricated salary rows)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
