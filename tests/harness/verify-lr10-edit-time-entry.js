'use strict';
/**
 * LR10 (decision 2026-10-21: build Edit). Time entries could only be deleted (✕) — PUT /api/timesheet/:id existed (audited,
 * FIX-1 project-link rules) but no UI called it. Now each row has Edit: the Log Time modal opens pre-filled and Save
 * sends PUT for that entry (never a second POST).
 * Real SPA in jsdom → real server → scratch Postgres. Projects X and Y; an entry of 2 h on X at 50 / h.
 *   1  Edit opens the modal pre-filled (2 h, project X)                           bug: no Edit
 *   2  change to 3.75 h on Y + Save → still ONE entry, hours 3.75, project Y      bug: unchanged (or a 2nd entry)
 *   3  the project figures follow (FIX-1, derived): X 0 h, Y 3.75 h                bug: X 2 h, Y 0 h
 *   4  one timesheet UPDATE audit row                                             bug: none
 *   5  after an edit, "+ Log Time" opens a blank modal and creates a NEW entry (edit state never leaks)
 */
const { run } = require('./clientMoneyKit.js');
run('LR10 — time entries can be edited', async ({ w, d, settle, eq, A, http }) => {
  const X = (await http.post('/api/projects', { name: 'Project X', budget: 1000 })).json;
  const Y = (await http.post('/api/projects', { name: 'Project Y', budget: 1000 })).json;
  const e = (await http.post('/api/timesheet', { employee: 'Sam', project_id: X.id, date: '2026-07-20', hours: 2, billable: 'Yes', rate: 50 })).json;
  const eid = (e.row || e).id;
  try { w.showPage('timesheet'); } catch (_) {}
  await settle(30, 60);
  const val = id => (d.getElementById(id) || {}).value;
  if (typeof w.editTimesheetEntry === 'function') { await w.editTimesheetEntry(eid); await settle(10, 40); }
  const _m = d.getElementById('ts-log-modal');
  A('1  Edit exists and opens the modal pre-filled (2 h, project X)', typeof w.editTimesheetEntry === 'function'
    && !!_m && !_m.classList.contains('hidden') && val('ts-hours') === '2' && String(val('ts-project-id')) === String(X.id),
    JSON.stringify({ fn: typeof w.editTimesheetEntry, hours: val('ts-hours'), pid: val('ts-project-id') }));
  if (typeof w.editTimesheetEntry === 'function') {
    d.getElementById('ts-hours').value = '3.75';
    const sel = d.getElementById('ts-project-id'); if (sel) sel.value = String(Y.id);
    await w.saveTimesheetEntry(); await settle(30, 60);
  }
  const rows = (await http.get('/api/timesheet')).json || [];
  const me = rows.filter(r => r.employee === 'Sam');
  eq('2  one entry, 3.75 h on Y', me.map(r => [r.id === eid, Number(r.hours), Number(r.project_id)]), [[true, 3.75, Y.id]], [[true, 2, X.id]]);
  const pj = (await http.get('/api/projects')).json || [];
  const hrs = n => Number((pj.find(p => p.name === n) || {}).hours || 0);
  eq('3  project hours follow: X 0 · Y 3.75', [hrs('Project X'), hrs('Project Y')], [0, 3.75], [2, 0]);
  const au = ((await http.get('/api/audit-log')).json || {}).rows || [];
  eq('4  one timesheet UPDATE audit row', au.filter(r => r.table_name === 'timesheet' && r.action === 'UPDATE' && r.record_id === eid).length, 1, 0);
  w.openLogTimeModal(); await settle(2, 20);
  A('5a  + Log Time after an edit opens blank', val('ts-hours') === '' && val('ts-employee') === '', JSON.stringify({ h: val('ts-hours'), e: val('ts-employee') }));
  d.getElementById('ts-employee').value = 'Ana'; d.getElementById('ts-hours').value = '1';
  await w.saveTimesheetEntry(); await settle(30, 60);
  const rows2 = (await http.get('/api/timesheet')).json || [];
  eq('5b  …and creates a NEW entry (Sam unchanged at 3.75)', [rows2.length, Number((rows2.find(r => r.id === eid) || {}).hours)], [rows.length + 1, 3.75]);
});
