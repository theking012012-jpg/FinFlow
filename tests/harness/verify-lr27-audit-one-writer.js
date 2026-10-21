'use strict';
/**
 * verify-lr27-audit-one-writer.js — LR27: the Audit page has ONE renderer.
 *  A second renderer (index.html renderAudit, called on every Audit page open) drew into #audit-list — which does not
 *  exist — so it returned on its first line: fully dead, never fetched, never painted (MEASURED on the old code; a race
 *  for the KPI cards was suspected and is WITHDRAWN). Its card-writing code was a trap for a future "fix" (CLAUDE.md
 *  failure 1), as was the overwritten app-main exportAuditCSV copy. Both deleted. A deletion is shown structurally.
 *
 * Real scratch Postgres, real server, real SPA (bundle). 3 expense events + 1 vendor event; the table filter is set to
 * Vendors, then the page is opened the way the nav does it (showPage).
 *   [GUARD] GET /api/audit-log on opening: 1; "Events loaded" = the filtered table's events (old: the same — measured)
 *   [STRUCTURAL] renderAudit / app-main exportAuditCSV no longer defined           (old: both defined)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr27-audit-one-writer.js
 */
require('./clock.js');
const fs = require('fs'), path = require('path');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR27 — one Audit renderer, one writer of its cards\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR27 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      for (const [i, amt] of [[1, 11], [2, 22], [3, 33]].entries()) await J('POST', '/api/expenses', { description: 'E' + i, amount: amt[1], category: 'Office', expense_date: '2026-07-2' + i });
      await J('POST', '/api/vendors', { name: 'Paper Co' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const sel = d.getElementById('audit-filter-table');
    const vOpt = Array.from(sel.options).find(o => o.value.split(',').includes('vendors'));
    sel.value = vOpt.value;
    let gets = 0; const of = w.fetch; w.fetch = function (u, o) { if (/\/api\/audit-log/.test(String(u))) gets++; return of.apply(this, arguments); };
    w.showPage('audit');
    await settle(60, 60);
    w.fetch = of;
    const shown = Array.from(d.querySelectorAll('#audit-trail-body tr')).filter(r => r.children.length > 1);
    const tables = [...new Set(shown.map(r => r.children[1].textContent.trim()))];
    eq('[GUARD] the filtered table shows vendor events only', tables, ['vendors'], undefined);
    eq('[GUARD] opening the Audit page fetches the trail once', gets, 1, undefined);
    eq('[GUARD] "Events loaded" = the events the filtered table holds', d.getElementById('audit-event-count').textContent.trim(), String(new Set(shown.map(r => r.children[2].textContent + r.children[3].textContent)).size), undefined);

    const idx = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
    const am = fs.readFileSync(path.join(__dirname, '../../public/app-main.js'), 'utf8');
    eq('[STRUCTURAL] the second renderer and the dead export copy are gone', [/window\.renderAudit\s*=/.test(idx), /window\.exportAuditCSV\s*=/.test(am)], [false, false], [true, true]);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
