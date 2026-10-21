'use strict';
/**
 * verify-lc2b-fy-label-refresh.js — LC2b (found by FIX-2's Rule-4 seed, 2026-10-20).
 *
 * For a business whose fiscal year starts in APRIL, the header / AI / chart period label kept the JANUARY months after
 * a page load ("Year to date · Jan 2026 – Jul 2026"; wording since LR6, 2026-10-21: "Fiscal year to date · 1 Apr – 25 Jul 2026"), while the year window and the month buckets were right. MONTH_FULL
 * is rebuilt from the fiscal-year setting in loadEntityData's finally block, but nothing re-painted the period labels
 * after that rebuild — so the text painted before the setting arrived stayed. (Pre-existing: the old label read
 * "Full Year · Jan 2026 – Dec 2026" for an April business.) A January seed cannot show this (Rule 4): the fiscal and
 * calendar months coincide.
 *
 * Real SPA (bundle) + real scratch Postgres; clock 2026-07-25, fiscal year April → FY Apr 2026 – Mar 2027, year to date
 * Apr 2026 – Jul 2026 (hand-derived). Labels read from the rendered page.
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lc2b-fy-label-refresh.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLC2b — period labels follow a non-January fiscal year after load\n');
  try {
    // Rule 4: with a January fiscal year the fiscal month index equals the calendar one, so a label built from the
    // calendar month would pass above. An APRIL fiscal year: today (25 Jul 2026) is fiscal month 4 of FY Apr 2026 –
    // Mar 2027, so the year to date is Apr 2026 – Jul 2026 (bug using the calendar index 6: … – Oct 2026).
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'April Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('PUT', '/api/settings', { fiscal_year: 'April' });
    } });
    await boot.settle(80, 75);
    try { boot.window.showPage('dashboard'); } catch (_) {}
    await boot.settle(20, 50);
    eq('April fiscal year: header label', (boot.window.document.getElementById('period-label') || {}).textContent, 'Fiscal year to date · 1 Apr – 25 Jul 2026', 'Fiscal year to date · 1 Jan – 25 Jul 2026');
    eq('April fiscal year: the year window label', boot.window._periodWindow('year').label, 'Fiscal year to date · 1 Apr – 25 Jul 2026', 'Fiscal Year · Apr 2026 – Mar 2027');
    eq('April fiscal year: AI period label', (boot.window.document.getElementById('ai-period-label') || {}).textContent, 'Fiscal year to date · 1 Apr – 25 Jul 2026', 'Fiscal year to date · 1 Jan – 25 Jul 2026');
    eq('April fiscal year: dashboard chart title', (boot.window.document.getElementById('d-chart-title') || {}).textContent, 'Revenue vs Expenses — Fiscal year to date · 1 Apr – 25 Jul 2026', 'Revenue vs Expenses — Fiscal year to date · 1 Jan – 25 Jul 2026');
    eq('April fiscal year: month order (unchanged — already right)', boot.window.eval('MONTHS').slice(0, 2), ['Apr', 'May']);
    // LR6: a fiscal year that crosses the calendar year names both years (today moved to 15 Feb 2027 for this one check).
    const _lbl = boot.window.eval("(function(){ var _o = _entityToday; _entityToday = function(){ return '2027-02-15'; }; try { return _ffYtdLabel(); } finally { _entityToday = _o; } })()");
    eq('LR6: April fiscal year seen on 15 Feb 2027 names both years', _lbl, 'Fiscal year to date · 1 Apr 2026 – 15 Feb 2027', 'Fiscal year to date · 1 Apr – 15 Feb 2027');
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
