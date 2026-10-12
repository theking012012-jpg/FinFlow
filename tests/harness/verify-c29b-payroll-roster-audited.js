'use strict';
/**
 * C29b (found while fixing C29): adding, editing and removing an employee on the payroll roster is recorded in the
 * audit trail, and the Audit page's Payroll filter shows it.
 * BUG: POST/PUT/DELETE /api/payroll wrote no audit entry at all — a pay change to an employee left no record of
 * who changed it, from what, to what.
 * Executed: real endpoints on scratch Postgres; the trail is read back through /api/audit-log with the Payroll
 * filter's value (payroll_runs,payroll).
 *   roster events → CREATE, UPDATE, DELETE                       bug: none
 *   the UPDATE carries gross 4,000 → 4,500 (seed values differ)  bug: no record
 */
const { run } = require('./moneyFixKit.js');

run('C29b — payroll roster changes are audited', async ({ newOwner, eq, A }) => {
  const o = await newOwner('C29b');
  const emp = await o.J('POST', '/api/payroll', { fname: 'Dana', lname: 'Roster', role: 'Designer', gross: 4000, deductions: [] });
  await o.J('PUT', '/api/payroll/' + emp.id, { gross: 4500 });
  await o.J('DELETE', '/api/payroll/' + emp.id);
  const log = await o.J('GET', '/api/audit-log?type=' + encodeURIComponent('payroll_runs,payroll'));
  const ev = (log.rows || []).filter(r => r.table_name === 'payroll' && Number(r.record_id) === Number(emp.id));
  eq('roster events recorded', ev.map(r => r.action).sort(), ['CREATE', 'DELETE', 'UPDATE'], []);
  const up = ev.find(r => r.action === 'UPDATE');
  const g = d => { try { return Number((typeof d === 'string' ? JSON.parse(d) : d).gross); } catch (_) { return null; } };
  eq('the pay change records old and new gross', up ? [g(up.old_data), g(up.new_data)] : null, [4000, 4500], null);
  A('every roster event is attributed to the owner', ev.length === 3 && ev.every(r => r.actor_type === 'user'), JSON.stringify(ev.map(r => r.actor_type)));
});
