'use strict';
/**
 * verify-payroll-cards-from-runs.js — L45 (Rule 12: payroll_runs LINES are the single source of payroll figures; the roster
 * is a template and must produce no figure). Live: the Payroll page headline "Monthly payroll $7,250" was Σ roster gross
 * (window.renderPayroll, finflow-api-wiring-medium.js) while the only recognised run was $7,000; "Deductions" and "Your net
 * pay" were roster figures too; and the Run History rows showed each run's HEADER total_gross / total_net, which basis C
 * does not read (Rule 12: header vs lines can disagree — the lines are the figure).
 * Fix: the headline cards are the latest RECOGNISED (approved | paid) run's lines — gross, deductions (gross − net), the
 * owner's own line net — labelled with that run's period and status; Run History shows Σ lines.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes: employees Ada 2,000 and Ben 1,500; run 2026-07 approved (lines 3,500);
 * then Cy 999 joins the roster (roster 4,499 — no run yet). The run HEADER is then set to 9,999 by SQL to discriminate a
 * header read from a lines read (Rule 4: three different numbers for three different sources).
 * HAND-COMPUTED: "Last payroll run" $3,500 (labelled 2026-07 / approved) · Deductions $0 · Run History gross $3,500.
 * BUGGY (pre-fix): headline $4,499 (roster) · Run History gross $9,999 (header).
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-payroll-cards-from-runs.js
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
    console.log('\n' + '='.repeat(78) + '\n  L45 — Payroll page figures come from run lines, never the roster or the run header\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client: c }) => {
      const J = async (p, b, m) => { const r = await (m === 'PUT' ? http.put(p, b) : http.post(p, b)); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return r.text ? JSON.parse(r.text) : {}; };
      const ent = await J('/api/entities', { name: 'L45 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/payroll', { fname: 'Ada', lname: 'A', gross: 2000 });
      await J('/api/payroll', { fname: 'Ben', lname: 'B', gross: 1500 });
      const run = await J('/api/payroll-runs', { period: '2026-07' });
      await J('/api/payroll-runs/' + run.id + '/approve', {}, 'PUT');
      await J('/api/payroll', { fname: 'Cy', lname: 'C', gross: 999 });
      await c.query(`UPDATE payroll_runs SET total_gross = 9999, total_net = 9999 WHERE id = $1`, [run.id]);
    } });
    const { window: w, settle } = ctx;
    await settle(40, 100);
    w.showPage('payroll'); await settle(60, 100);
    if (typeof w.renderPayroll === 'function') { try { w.renderPayroll(); } catch (_) {} await settle(10, 100); }
    const d = w.document;
    const total = num((d.getElementById('pr-total') || {}).textContent);
    const sub = ((d.getElementById('pr-headcount') || {}).textContent || '').trim();
    const ded = num((d.getElementById('pr-tax') || {}).textContent);
    console.log('  [cards] pr-total=' + (d.getElementById('pr-total') || {}).textContent + ' | sub=' + sub + ' | pr-tax=' + (d.getElementById('pr-tax') || {}).textContent);
    A('headline = the latest recognised run\'s lines: $3,500 (bug: $4,499 roster)', near(total, 3500), 'pr-total=' + total);
    A('headline is labelled with that run (2026-07 / July, approved)', /2026-07|July/i.test(sub) && /approved/i.test(sub), 'sub=' + sub);
    A('Deductions from the same run: $0', near(ded, 0), 'pr-tax=' + ded);
    const hist = ((d.getElementById('payroll-runs-list') || {}).textContent || '').replace(/\s+/g, ' ');
    console.log('  [run history] ' + hist.slice(0, 200));
    const g = (hist.match(/Gross:\s*\$?\s*([\d,]+(?:\.\d+)?)/) || [])[1];
    A('Run History gross = Σ lines $3,500 (bug: $9,999 header)', g != null && near(num(g), 3500), 'gross=' + g);
    A('the roster total 4,499 appears nowhere on the Payroll page (bug: headline)', !/4,499/.test((d.getElementById('page-payroll') || {}).textContent || ''),
      'roster total visible on the page');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (payroll cards from run lines)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
