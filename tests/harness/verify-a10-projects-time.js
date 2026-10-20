'use strict';
/**
 * verify-a10-projects-time.js — VERIFICATION.md A10 · Projects & time (LC1d; owner-supplied values 2026-10-20).
 *
 * Owner's example, seeded exactly (dated this month — the harness clock is 2026-07-25):
 *   Project A, budget 1,000: 2h @ 100 billable + 1.5h @ 100 NON-billable   → 3.5h logged, billable value 200
 *   Project B, budget 2,000: 4h @ 150 billable                            → 4h logged,   billable value 600
 *   Projects page: Billable value 800 · Budget remaining (1,000 − 200) + (2,000 − 600) = 2,200
 * A10.7 (Billable Hours this month = 2 + 4 = 6) is arithmetic on the owner's example, not a separately supplied value.
 * Rule 4: counting the non-billable 1.5h as billable gives A 350 / 950 / 2,050; joining every entry to every project
 * gives 7.5h each; the pre-FIX-1 code gives 0 everywhere.
 *
 * Real scratch Postgres, real server, real routes, real SPA (bundle) — values read from the API AND the rendered page.
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-a10-projects-time.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const num = t => { const m = String(t || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

(async () => {
  let boot;
  console.log('\nA10 — Projects & time (owner-supplied expected values)\n');
  try {
    const ids = {};
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'A10 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      ids.a = (await J('POST', '/api/projects', { name: 'Project A', client: 'Client A', budget: 1000 })).id;
      ids.b = (await J('POST', '/api/projects', { name: 'Project B', client: 'Client B', budget: 2000 })).id;
      await J('POST', '/api/timesheet', { employee: 'Sam', project_id: ids.a, date: '2026-07-10', hours: 2,   billable: 'Yes', rate: 100 });
      await J('POST', '/api/timesheet', { employee: 'Lee', project_id: ids.a, date: '2026-07-11', hours: 1.5, billable: 'No',  rate: 100 });
      await J('POST', '/api/timesheet', { employee: 'Kim', project_id: ids.b, date: '2026-07-12', hours: 4,   billable: 'Yes', rate: 150 });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const rows = await (await w.fetch('/api/projects', { credentials: 'include' })).json();
    const P = id => rows.find(r => r.id === id) || {};
    eq('A10.1 Project A hours logged', P(ids.a).hours, 3.5, 0);
    eq('A10.2 Project A billable value', P(ids.a).billed, 200, 0);
    eq('A10.3 Project B hours logged', P(ids.b).hours, 4, 0);
    eq('A10.4 Project B billable value', P(ids.b).billed, 600, 0);

    w.showPage('projects');
    await settle(40, 50);
    const t = id => (d.getElementById(id) || {}).textContent;
    eq('A10.5 Projects card — Billable value', num(t('proj-revenue')), 800, 0);
    eq('A10.6 Projects card — Budget remaining', num(t('proj-unbilled')), 2200, 3000);
    eq('A10.7 Projects card — Billable Hours (this month)', num(t('proj-hours')), 6, 7.5);
    const rowTxt = name => { const el = Array.from(d.querySelectorAll('#projects-list > div')).find(x => x.textContent.includes(name)); return el ? el.textContent.replace(/\s+/g, ' ') : ''; };
    eq('A10.1/2 on the page — Project A row reads 3.5h and $200 of $1,000', /3\.5h logged/.test(rowTxt('Client A')) && /\$200(\.00)?\s*\/\s*\$1,000/.test(rowTxt('Client A')), true, false);
    eq('A10.3/4 on the page — Project B row reads 4h and $600 of $2,000', /4h logged/.test(rowTxt('Client B')) && /\$600(\.00)?\s*\/\s*\$2,000/.test(rowTxt('Client B')), true, false);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
