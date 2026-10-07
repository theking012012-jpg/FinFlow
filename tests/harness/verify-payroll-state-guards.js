#!/usr/bin/env node
'use strict';
/**
 * verify-payroll-state-guards.js — N58. Payroll runs follow draft → approved → paid (→ voided). The
 * server must refuse out-of-order transitions, and the UI must SHOW the refusal (it used to toast "✓"
 * whatever the server said).
 *
 * Defect: mark-paid had no state guard (a draft could be marked paid, posting a cash-out with no
 * expense accrual; a voided run could be marked paid again), and approve only excluded 'paid' (a voided
 * run could be re-approved). Re-recognised runs had no matching ledger entry, so books and ledger split.
 *
 * Executed through the real UI handlers (approvePayrollRun / markPayrollPaid) in jsdom against the real
 * server + Postgres. Discriminating checks (Rule 4), bug value stated:
 *   mark-paid on a draft      → stays draft, error toast, no cash-out entry   (bug: paid, "✓", entry posted)
 *   approve then mark-paid    → paid                                        (control)
 *   approve on a voided run   → stays voided, error toast                    (bug: approved, "✓")
 *   mark-paid on a voided run → stays voided                                 (bug: paid)
 *   node -r ./tests/harness/clock.js tests/harness/verify-payroll-state-guards.js
 */

require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot;
  try {
    let runA = null, runB = null;
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        const { rows: [e] } = await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [uid]);
        const mkRun = async (period) => {
          const id = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
                                     VALUES ($1,$2,$3,'2026-07-20','draft',3000,0,3000) RETURNING id`, [uid, e.id, period])).rows[0].id;
          await c.query(`INSERT INTO payroll_run_lines (run_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,'Pat Lee',3000,0,0,'[]',3000)`, [id]);
          return id;
        };
        runA = await mkRun('2026-06');
        runB = await mkRun('2026-05');
      },
    });
    const { window, client: c, settle, toast } = boot;
    await settle(60);
    const status = async (id) => (await c.query(`SELECT status FROM payroll_runs WHERE id=$1`, [id])).rows[0].status;
    const cashOut = async (id) => Number((await c.query(`SELECT COUNT(*) n FROM ledger_entries WHERE source_type='payroll_paid' AND source_id=$1 AND reversal_of IS NULL`, [id])).rows[0].n);
    const call = async (fn, id) => { await window[fn](id); await settle(10); return toast(); };

    console.log('\n' + '='.repeat(78));
    console.log('  PAYROLL STATE GUARDS — draft → approved → paid, voided stays voided');
    console.log('='.repeat(78));

    const t1 = await call('markPayrollPaid', runA);
    A('mark-paid on a draft is refused: run stays draft (bug: paid)', (await status(runA)) === 'draft', 'status=' + await status(runA));
    A('UI shows the refusal, not "✓" (bug: "✓ Payroll marked paid")', t1.text && !/✓/.test(t1.text) && /approve/i.test(t1.text), JSON.stringify(t1));
    A('no cash-out ledger entry was posted for the draft (bug: 1)', (await cashOut(runA)) === 0, 'entries=' + await cashOut(runA));

    await call('approvePayrollRun', runA);
    A('control: approve → approved', (await status(runA)) === 'approved', 'status=' + await status(runA));
    const t2 = await call('markPayrollPaid', runA);
    A('control: mark-paid after approve → paid, "✓" shown', (await status(runA)) === 'paid' && /✓/.test(t2.text || ''), `status=${await status(runA)} toast=${JSON.stringify(t2)}`);

    await call('approvePayrollRun', runB);
    const v = await boot.http.put('/api/payroll-runs/' + runB + '/void', {});
    A('run B voided (200)', v.status === 200 && (await status(runB)) === 'voided', 'status=' + await status(runB));
    const t3 = await call('approvePayrollRun', runB);
    A('approve on a voided run is refused: stays voided (bug: approved)', (await status(runB)) === 'voided', 'status=' + await status(runB));
    A('UI shows the refusal (bug: "✓ Payroll approved")', t3.text && !/✓/.test(t3.text), JSON.stringify(t3));
    await call('markPayrollPaid', runB);
    A('mark-paid on a voided run is refused: stays voided (bug: paid)', (await status(runB)) === 'voided', 'status=' + await status(runB));
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    if (boot) await boot.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (payroll state guards)` : `  ALL GREEN — ${pass} passed, 0 failed  (payroll state guards)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
