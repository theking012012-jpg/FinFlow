'use strict';
/**
 * verify-fix3-audit-coverage.js — FIX-3 (Cowork live check 2026-10-19, COWORK_FIX_HANDOFF.md).
 *
 * Live: after creating a quote, a project, a time entry and a budget target, the Audit trail showed NO row for any of
 * them, and its filter had no Quotes / Projects / Time / Budget option. Budget targets and time entries feed billing
 * and the Budget page; a change to them left no trace of who changed what.
 * Fix: every create / edit / delete of these records writes one audit_trail row (the single audited write path,
 * recordAudit) with the record before and after, attributed to the person and scoped to the record's business; the
 * Audit page lists one line per changed field and its filter has options for them.
 *
 * Real scratch Postgres, real server, real routes, real SPA (bundle). Each step changes ONE field to a distinctive
 * value, so the assertion names the field that changed and both values (bug: no row at all).
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-fix3-audit-coverage.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

// LR12: the Audit table gained a "By" column — read cells by HEADER, not position, in the fixed order
// Date · Table · Record ID · Action · Field · Old Value · New Value (a new column can never shift these again).
const _auditRowsByHeader = d => {
  const heads = Array.from(d.getElementById('audit-trail-body').closest('table').querySelectorAll('thead th')).map(th => th.textContent.trim());
  const at = ['Date', 'Table', 'Record ID', 'Action', 'Field', 'Old Value', 'New Value'].map(h => heads.indexOf(h));
  return Array.from(d.querySelectorAll('#audit-trail-body tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()))
    .filter(r => r.length > 1).map(r => at.map(i => (i >= 0 ? r[i] : undefined)));
};
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nFIX-3 — quotes, projects, time entries and budget targets are on the audit trail\n');
  try {
    let eid;
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const nw = await J('POST', '/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + nw.id + '/activate', {});
      eid = nw.id;
      const trail = async (table, id) => (await client.query(
        `SELECT action, user_id, entity_id, actor_type, actor_id, old_data, new_data FROM audit_trail
          WHERE user_id = $1 AND table_name = $2 AND ($3::int IS NULL OR record_id = $3) ORDER BY id`, [userId, table, id == null ? null : id])).rows;
      const shape = rows => rows.map(r => [r.action, r.user_id === userId && r.actor_type === 'user' && r.actor_id === userId, r.entity_id === eid]);

      // ── quotes ──
      const q = await J('POST', '/api/quotes', { client: 'Acme', amount: 1234, expiry_date: '2026-11-30' });
      await J('PUT', '/api/quotes/' + q.id, { amount: 1500 });
      await J('DELETE', '/api/quotes/' + q.id);
      let t = await trail('quotes', q.id);
      eq('quote: CREATE · UPDATE · DELETE, by the owner, on Northwind', shape(t), [['CREATE', true, true], ['UPDATE', true, true], ['DELETE', true, true]], []);
      eq('quote UPDATE records amount 1234 → 1500', t[1] ? [t[1].old_data.amount, t[1].new_data.amount] : null, [1234, 1500], null);

      // ── projects ──
      const p = await J('POST', '/api/projects', { name: 'Portal', client: 'Acme', budget: 800 });
      await J('PUT', '/api/projects/' + p.id, { budget: 950 });
      t = await trail('projects', p.id);
      eq('project: CREATE · UPDATE', shape(t), [['CREATE', true, true], ['UPDATE', true, true]], []);
      eq('project UPDATE records budget 800 → 950', t[1] ? [t[1].old_data.budget, t[1].new_data.budget] : null, [800, 950], null);

      // ── time entries ──
      const ts = await J('POST', '/api/timesheet', { employee: 'Sam', project_id: p.id, hours: 2.5, rate: 120, billable: 'Yes', date: '2026-10-06' });
      await J('PUT', '/api/timesheet/' + ts.id, { hours: 3.75 });
      await J('DELETE', '/api/timesheet/' + ts.id);
      t = await trail('timesheet', ts.id);
      eq('time entry: CREATE · UPDATE · DELETE', shape(t), [['CREATE', true, true], ['UPDATE', true, true], ['DELETE', true, true]], []);
      eq('time entry UPDATE records hours 2.5 → 3.75', t[1] ? [t[1].old_data.hours, t[1].new_data.hours] : null, [2.5, 3.75], null);
      eq('time entry DELETE keeps the deleted entry (employee, hours)', t[2] ? [t[2].old_data.employee, t[2].old_data.hours] : null, ['Sam', 3.75], null);

      await J('DELETE', '/api/projects/' + p.id);
      t = await trail('projects', p.id);
      eq('project DELETE recorded, with the deleted project', t[2] ? [t[2].action, t[2].old_data.name] : null, ['DELETE', 'Portal'], null);

      // ── budget targets ── (one row per business; first save creates it)
      await J('PUT', '/api/budget-targets', { Software: 400 });
      await J('PUT', '/api/budget-targets', { Software: 650, Travel: 90 });
      t = await trail('budget_targets', null);
      eq('budget targets: CREATE then UPDATE, on Northwind', shape(t), [['CREATE', true, true], ['UPDATE', true, true]], []);
      const _s = o => o ? Object.keys(o).sort().map(k => k + '=' + o[k]).join(' ') : null;   // JSONB does not keep key order
      eq('budget UPDATE records Software 400 → 650 and the new Travel 90', t[1] ? [_s(t[1].old_data), _s(t[1].new_data)] : null, ['Software=400', 'Software=650 Travel=90'], null);
    } });

    // ── SPA: the Audit page filters and lists them ──
    const { window: w, settle } = boot; const d = w.document;
    await settle(60, 60);
    const errBefore = boot.consoleErrors.length;   // boot-time errors are the jsdom harness's (bare fetch before window.fetch is set)
    try { w.showPage('audit'); } catch (_) {}
    await settle(10, 40);
    const opts = Array.from(d.getElementById('audit-filter-table').options).map(o => [o.textContent.trim(), o.value]);
    const opt = label => (opts.find(o => o[0] === label) || [])[1] || null;
    eq('Audit filter has Quotes / Projects & time / Budget', [opt('Quotes'), opt('Projects & time'), opt('Budget')], ['quotes', 'projects,timesheet', 'budget_targets'], [null, null, null]);
    const rows = async v => { d.getElementById('audit-filter-table').value = v; d.getElementById('audit-filter-action').value = 'all';
      await w.loadAuditTrail(); await settle(5, 30);
      return _auditRowsByHeader(d); };
    if (opt('Budget')) {
      const b = await rows(opt('Budget'));
      const upd = b.filter(r => r[3] === 'UPDATE').map(r => r[4]);
      eq('Budget filter: the UPDATE shows one line per changed target', upd.slice().sort(), ['Software', 'Travel'], ['targets']);
      console.log('     budget UPDATE lines: ' + JSON.stringify(b.filter(r => r[3] === 'UPDATE').map(r => r.slice(4))));
    }
    if (opt('Projects & time')) {
      const pt = await rows(opt('Projects & time'));
      eq('Projects & time filter lists only projects and time entries', [...new Set(pt.map(r => r[1]))].sort(), ['projects', 'timesheet']);
      const hrs = pt.find(r => r[1] === 'timesheet' && r[3] === 'UPDATE' && r[4] === 'hours');
      eq('…the time-entry UPDATE line reads hours 2.5 → 3.75', hrs ? [hrs[5], hrs[6]] : null, ['2.5', '3.75'], null);
    }
    const _errs = boot.consoleErrors.slice(errBefore);
    eq('Audit page: no console errors while filtering', _errs.length, 0);
    if (_errs.length) console.log('     console errors: ' + JSON.stringify(_errs).slice(0, 800));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
