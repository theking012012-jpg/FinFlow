'use strict';
/**
 * verify-owner-net-single-writer.js — L57 (completes L45; Rule 2 multi-writer, Rule 12 the roster produces no figure).
 * L45 moved the Payroll page's "Your net pay" card (#pr-owner-net) and the payroll-link card (#link-net-display) onto the owner's
 * line of the latest recognised run (window.renderPayroll, finflow-api-wiring-medium.js). But a SECOND live writer remained:
 * syncAllPayrollsToPersonal (app-main.js — no wiring override, called from 10 sites: entity load, owner save, employee add/remove …)
 * rewrites both elements with the ROSTER owner net (Σ ownerPayrollByEntity net). Whichever runs last wins, so after any of those
 * actions the card shows the roster template again. The L45 harness seeded no owner, so it never exercised this.
 * Fix: renderPayroll is the single writer of the Payroll page owner cards; the sync no longer touches them.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes: owner Olive (is_owner) gross 5,000 with a fixed 1,000 deduction (roster net
 * 4,000) · employee Ada 2,000 · run 2026-07 approved (owner line net 4,000) · THEN the owner's salary is raised to 6,250 via
 * PUT /api/payroll/:id (roster net 5,250 — no run yet at the new salary).
 * HAND-COMPUTED: "Your net pay" $4,000 (the run line) · link card $4,000, before AND after the sync runs.
 * BUGGY (pre-fix): after syncAllPayrollsToPersonal both show $5,250 (the roster).
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-owner-net-single-writer.js
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
    console.log('\n' + '='.repeat(78) + '\n  L57 — the owner\'s net-pay card has one writer (the run line), not the roster sync\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b, m) => { const r = await (m === 'PUT' ? http.put(p, b) : http.post(p, b)); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return r.text ? JSON.parse(r.text) : {}; };
      const ent = await J('/api/entities', { name: 'L57 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      const owner = await J('/api/payroll', { fname: 'Olive', lname: 'Owner', gross: 5000, is_owner: true, emp_type: 'owner', entity_id: ent.id,
        deductions: [{ label: 'Tax', value: 1000, type: 'fixed' }] });
      await J('/api/payroll', { fname: 'Ada', lname: 'A', gross: 2000, entity_id: ent.id });
      const run = await J('/api/payroll-runs', { period: '2026-07' });
      await J('/api/payroll-runs/' + run.id + '/approve', {}, 'PUT');
      await J('/api/payroll/' + owner.id, { gross: 6250, deductions: [{ label: 'Tax', value: 1000, type: 'fixed' }] }, 'PUT');
    } });
    const { window: w, settle, http } = ctx;
    await settle(40, 100);

    // Premise (Rule 4): the run line and the roster really are different numbers.
    const runs = (await http.get('/api/payroll-runs')).json || [];
    const lines = ((runs[0] || {}).lines || []).filter(Boolean);
    const oLine = lines.find(l => /Olive/.test(l.employee_name || ''));
    A('premise: owner run line net 4,000', oLine && near(oLine.net_pay, 4000), JSON.stringify(lines.map(l => [l.employee_name, l.net_pay])));
    const op = w.ownerPayroll || {};
    A('premise: roster owner net 5,250 (the raise after the run)', near(op.net, 5250), 'ownerPayroll.net=' + op.net);

    w.showPage('payroll'); await settle(60, 100);
    if (typeof w.renderPayroll === 'function') { try { w.renderPayroll(); } catch (_) {} await settle(10, 100); }
    const d = w.document;
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    console.log('  [after renderPayroll] pr-owner-net=' + t('pr-owner-net') + ' | link-net-display=' + t('link-net-display'));
    A('CONTROL: after renderPayroll "Your net pay" = the run line $4,000', near(num(t('pr-owner-net')), 4000), 'pr-owner-net=' + t('pr-owner-net'));

    // Any of the 10 real call sites (entity load, owner save, employee add/remove …) runs the sync; call it as they do.
    A('premise: syncAllPayrollsToPersonal is reachable', typeof w.syncAllPayrollsToPersonal === 'function');
    try { w.syncAllPayrollsToPersonal(); } catch (e) { console.log('  [sync threw] ' + e.message); }
    await settle(10, 100);
    console.log('  [after sync]          pr-owner-net=' + t('pr-owner-net') + ' | link-net-display=' + t('link-net-display'));
    A('after the sync "Your net pay" is still $4,000 (bug: $5,250 roster)', near(num(t('pr-owner-net')), 4000), 'pr-owner-net=' + t('pr-owner-net'));
    A('after the sync the link card is still $4,000 (bug: $5,250/mo roster)', near(num(t('link-net-display')), 4000), 'link-net-display=' + t('link-net-display'));
    // Scope: the page's FIGURE cards (.mc-val). The roster LIST legitimately prints each person's configured salary
    // (Olive's $5,250 net) — that is the template itself, not a figure computed from it. (The first owner-run of this
    // harness asserted over the whole page and failed on exactly that list row — a harness defect, corrected here.)
    const cards = [...d.querySelectorAll('#page-payroll .mc-val')].map(el => el.textContent.trim());
    A('no Payroll figure card shows the roster net 5,250 (bug: "Your net pay" after the sync)', cards.length > 0 && !cards.some(t => /5,250/.test(t)), JSON.stringify(cards));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (owner net single writer)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
