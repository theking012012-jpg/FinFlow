'use strict';
/**
 * verify-lr7-budget-period-toggle.js — LR7 (live retest 2026-10-20): Budget targets modal. Switching Annual → Monthly
 * did not convert the rows shown (Rent showed 60000), and save stored every row × 12 (`period === 'monthly' ? v * 12`,
 * finflow-api-wiring-medium.js _saveBudgetTargets) — Rent 60,000/yr would have been saved as 720,000. The modal is
 * reused, so reopening it after picking Monthly did the same.
 *
 * Seed (Rule 4 — the bug changes every number): Rent 60,000/yr, Software 300/yr.
 *   1. open → Annual view shows 60000                                          (old: 60000)
 *   2. Monthly view shows Rent 5000                                            (old: 60000)
 *   3. save without typing → stored Rent 60000, Software 300                   (old: 720000, 3600)
 *   4. reopen → starts in Annual, shows 60000; label "annual"                  (old: label "monthly")
 *   5. reopen, Monthly, type Software = 25, save → Software 300, Rent 60000     (old: Rent 720000)
 *   6. reopen, Monthly, save immediately → nothing changes                      (old: ×12 again)
 *
 * Real scratch Postgres, real server, real SPA (bundle).
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr7-budget-period-toggle.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR7 — toggling Annual / Monthly never changes a stored budget target\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR7 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('PUT', '/api/budget-targets', { targets: { Rent: 60000, Software: 300 } });   // the shape the modal saves
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const stored = async () => { const r = await (await w.fetch('/api/budget-targets', { credentials: 'include' })).json(); return (r && r.targets && typeof r.targets === 'object') ? r.targets : r; };
    const modal = () => d.getElementById('_budget-targets-modal');
    const amt = cat => { const row = Array.from(d.querySelectorAll('#_budget-target-rows ._bt-row')).find(r => r.querySelector('[data-bt-cat]').value === cat); return row ? row.querySelector('[data-bt-amt]') : null; };
    const shown = cat => { const a = amt(cat); return a ? Number(a.value) : null; };
    const view = p => modal().querySelector(`._bt-period[data-period="${p}"]`).click();
    const save = async () => { await w._saveBudgetTargets(); await settle(20, 25); };
    const open = async () => { await w.openBudgetTargetsModal(); await settle(10, 25); };

    await open();
    eq('1. Annual view shows the stored Rent', shown('Rent'), 60000);
    view('monthly');
    eq('2. Monthly view shows Rent ÷ 12', shown('Rent'), 5000, 60000);
    await save();
    const s3 = await stored();
    eq('3. save without typing → stored figures unchanged', [s3.Rent, s3.Software], [60000, 300], [720000, 3600]);

    await open();
    eq('4. reopening starts in the Annual view', [modal().dataset.period, d.getElementById('_bt-period-label').textContent, shown('Rent')], ['annual', 'annual', 60000], ['monthly', 'monthly', 60000]);

    view('monthly');
    const sw = amt('Software'); sw.value = '25'; sw.dispatchEvent(new w.Event('input', { bubbles: true }));
    await save();
    const s5 = await stored();
    eq('5. typing 25 in the Monthly view stores 300/yr; Rent untouched', [s5.Software, s5.Rent], [300, 60000], [300, 720000]);

    await open(); view('monthly'); await save();
    const s6 = await stored();
    eq('6. reopen, Monthly, save immediately → nothing changes', [s6.Rent, s6.Software], [60000, 300], [720000, 3600]);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
