'use strict';
/**
 * verify-fix1-timesheet-projects.js — FIX-1 (Cowork live check 2026-10-19, COWORK_FIX_HANDOFF.md).
 *
 * Live: project "ZZ-LIVECHECK project" (budget $500), 1.5h logged against it → Timesheet showed 1.5h, but the project
 * row read "0h logged / $0 billed". A time entry carried the project only as free text (`project`), no `project_id`;
 * projects.hours / projects.billed were stored at 0 on create and nothing ever wrote them.
 * Fix: a time entry links to a real project (`project_id`, validated: same account, same business); a project's hours
 * and billed are DERIVED from its linked entries on read (one writer — no stored copy to drift).
 *   hours  = Σ hours of linked entries (billable or not)
 *   billed = Σ hours × rate of linked BILLABLE entries
 *
 * Real scratch Postgres, real server, real routes, real SPA (bundle). Rule 4 seed — every wrong reading gives a different
 * number (hand-computed):
 *   Northwind (USD)  Alpha (budget 1,000): Sam 2h @100 billable · Lee 1.5h @100 NON-billable          → 3.5h · 200
 *                    Beta  (budget 2,000): Sam 2h @150 billable (same employee + hours as Sam/Alpha,
 *                                          posted right after — the 5s dedupe trap) · Lee 2h @150 billable → 4h · 600
 *                    free text "Alpha", no link: Kim 0.25h @80 billable   → counted nowhere (backfill is owner-gated)
 *   Other Co (USD)   its own "Alpha": Pat 5h @50 billable                  → never on Northwind
 *   bug (live)            Alpha 0h · 0       Beta 0h · 0
 *   all entries → every project      7.5h · 800 each (+ Kim / Pat if joined by name)
 *   non-billable counted in billed   Alpha billed 350
 *   dedupe drops Sam/Beta            Beta 2h · 300
 * Then Lee's Beta entry is moved to Alpha (PUT)  → Alpha 5.5h · 500, Beta 2h · 300.
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-fix1-timesheet-projects.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const r2 = n => Math.round((+n || 0) * 100) / 100;

(async () => {
  let boot;
  console.log('\nFIX-1 — time entries link to projects; project hours / billed come from the linked entries\n');
  try {
    let ids = {};
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); return { status: r.status, json: r.json, text: r.text }; };
      const ok = async (m, p, b) => { const r = await J(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const other = await ok('POST', '/api/entities', { name: 'Other Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await ok('POST', '/api/entities/' + other.id + '/activate', {});
      const oAlpha = await ok('POST', '/api/projects', { name: 'Alpha', client: 'Elsewhere', budget: 300 });
      await ok('POST', '/api/timesheet', { employee: 'Pat', project: 'Alpha', project_id: oAlpha.id, date: '2026-10-05', hours: 5, billable: 'Yes', rate: 50 });

      const nw = await ok('POST', '/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' });
      await ok('POST', '/api/entities/' + nw.id + '/activate', {});
      const alpha = await ok('POST', '/api/projects', { name: 'Alpha', client: 'Acme', budget: 1000 });
      const beta  = await ok('POST', '/api/projects', { name: 'Beta',  client: 'Bright', budget: 2000 });
      ids = { alpha: alpha.id, beta: beta.id, oAlpha: oAlpha.id };
      const ts = b => J('POST', '/api/timesheet', Object.assign({ date: '2026-10-06' }, b));
      await ts({ employee: 'Sam', project_id: alpha.id, hours: 2,   billable: 'Yes', rate: 100 });
      const samBeta = await ts({ employee: 'Sam', project_id: beta.id, hours: 2, billable: 'Yes', rate: 150 });
      await ts({ employee: 'Lee', project_id: alpha.id, hours: 1.5, billable: 'No',  rate: 100 });
      const leeBeta = await ts({ employee: 'Lee', project_id: beta.id, hours: 2,   billable: 'Yes', rate: 150 });
      await ts({ employee: 'Kim', project: 'Alpha', hours: 0.25, billable: 'Yes', rate: 80 });
      ids.leeBeta = leeBeta.json && leeBeta.json.id;
      eq('Sam → Beta right after Sam → Alpha (same employee + hours) is a NEW entry, not a duplicate', samBeta.status, 201, 200);

      const proj = async () => { const rows = (await J('GET', '/api/projects')).json || [];
        const f = id => { const p = rows.find(x => x.id === id) || {}; return [r2(p.hours), r2(p.billed)]; };
        return { alpha: f(ids.alpha), beta: f(ids.beta), names: rows.map(x => x.name).sort() }; };
      let p = await proj();
      eq('Northwind lists only its own projects', p.names, ['Alpha', 'Beta']);
      eq('Alpha: 2h + 1.5h = 3.5h; billed 2 × 100 = 200 (non-billable excluded)', p.alpha, [3.5, 200], [0, 0]);
      eq('Beta: 2h + 2h = 4h; billed 4 × 150 = 600', p.beta, [4, 600], [0, 0]);

      const tsRows = (await J('GET', '/api/timesheet')).json || [];
      const sam = tsRows.find(t => t.employee === 'Sam' && t.project_id === ids.alpha);
      eq('a linked entry stores project_id and the project name as its label', sam ? [sam.project_id, sam.project] : null, [ids.alpha, 'Alpha'], null);

      // A project of ANOTHER business (or a made-up id) cannot be linked.
      const cross = await J('POST', '/api/timesheet', { employee: 'Sam', project_id: ids.oAlpha, hours: 9, rate: 10, date: '2026-10-07' });
      eq("linking Other Co's project from Northwind is refused", cross.status, 400, 201);
      const bogus = await J('POST', '/api/timesheet', { employee: 'Sam', project_id: 999999, hours: 9, rate: 10, date: '2026-10-07' });
      eq('linking a project that does not exist is refused', bogus.status, 400, 201);

      // The stored hours / billed are not a second writer.
      await J('PUT', '/api/projects/' + ids.alpha, { hours: 999, billed: 99999 });
      eq('PUT hours / billed on a project does not override the linked entries', (await proj()).alpha, [3.5, 200], [999, 99999]);

      // Move Lee's Beta entry to Alpha.
      const mv = await J('PUT', '/api/timesheet/' + ids.leeBeta, { project_id: ids.alpha });
      eq('moving an entry to another project: saved', mv.status, 200);
      p = await proj();
      eq('after the move: Alpha 3.5 + 2 = 5.5h, billed 200 + 300 = 500', p.alpha, [5.5, 500], [3.5, 200]);
      eq('after the move: Beta 2h, billed 300', p.beta, [2, 300], [4, 600]);

      // Other Co still sees only its own figure.
      await ok('POST', '/api/entities/' + other.id + '/activate', {});
      const oRows = (await J('GET', '/api/projects')).json || [];
      eq("Other Co's Alpha: 5h, billed 250 — nothing from Northwind", oRows.map(x => [x.name, r2(x.hours), r2(x.billed)]), [['Alpha', 5, 250]], [['Alpha', 0, 0]]);
      await ok('POST', '/api/entities/' + nw.id + '/activate', {});
    } });

    // ── SPA (bundle) ──
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('projects');
    await settle(40, 50);
    const list = (d.getElementById('projects-list') || {}).textContent || '';
    const row = name => { const el = Array.from(d.querySelectorAll('#projects-list > div')).find(x => (x.textContent || '').includes(name + '')); return el ? el.textContent.replace(/\s+/g, ' ') : ''; };
    eq('Projects page: Alpha row reads "5.5h logged"', /5\.5h logged/.test(row('Acme')), true, false);
    eq('Projects page: Alpha row shows billed $500.00 of $1,000.00', /\$500(\.00)?\s*\/\s*\$1,000(\.00)?(?!\d)/.test(row('Acme')), true, false);
    eq('Projects page: Beta row reads "2h logged", billed $300.00 of $2,000.00', /2h logged/.test(row('Bright')) && /\$300(\.00)?\s*\/\s*\$2,000(\.00)?(?!\d)/.test(row('Bright')), true, false);
    eq('Projects page: Revenue card = 500 + 300', /^\$800(\.00)?$/.test((d.getElementById('proj-revenue') || {}).textContent), true, false);
    eq('Projects page: Unbilled card = (1,000 − 500) + (2,000 − 300) = 2,200', /^\$2,200(\.00)?$/.test((d.getElementById('proj-unbilled') || {}).textContent), true, false);
    if (!list) console.log('  (projects list empty)');

    // Log Time from the Timesheet page, picking Beta.
    w.showPage('timesheet');
    await settle(20, 50);
    w.openLogTimeModal();
    await settle(20, 50);
    const sel = d.getElementById('ts-project-id');
    const opts = sel ? Array.from(sel.options).map(o => o.textContent.trim()) : null;
    eq('Log Time: a project picker lists this business\'s projects', opts, ['— No project —', 'Alpha', 'Beta'], null);
    if (sel) {
      d.getElementById('ts-employee').value = 'Jo';
      d.getElementById('ts-hours').value = '1.25';
      d.getElementById('ts-rate').value = '200';
      d.getElementById('ts-billable').value = 'Yes';
      sel.value = String(ids.beta);
      await w.saveTimesheetEntry();
      await settle(40, 50);
      const rows = await (await w.fetch('/api/projects', { credentials: 'include' })).json();
      const b = rows.find(x => x.id === ids.beta) || {};
      eq('Log Time → Beta: Beta 2 + 1.25 = 3.25h, billed 300 + 250 = 550', [r2(b.hours), r2(b.billed)], [3.25, 550], [2, 300]);
      w.showPage('projects');
      await settle(40, 50);
      eq('Projects page re-renders Beta as "3.25h logged"', /3\.25h logged/.test(row('Bright')), true, false);
    }
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
