'use strict';
/**
 * verify-la3-owner-salary-crossing.js — LA3 (live audit 2026-10-13 B2): "the owner salary does not reach Personal".
 *
 * The live account added its owner through Add employee, which always saved is_owner:false — so the owner was an
 * ordinary roster entry and a paid run crossed nothing, silently. This replays that path through the real routes and
 * real Postgres. Seed (Rule 4 — each source gives a different number):
 *   Sam (the owner, added as an employee)  gross 5,000, deduction 20% → net 4,000
 *   Jordan (employee)                       gross 3,000, deduction 10% → net 2,700
 * Expected:
 *   paid run, nobody flagged   → 0 Personal rows; mark-paid SAYS so (owner_salary.ownerOnRun false)   (bug: says nothing)
 *   PUT Sam is_owner:true      → flag set                                                              (bug: ignored)
 *   paid run with Sam flagged  → ONE Personal row, 4,000 USD (not 2,700, not 6,700, not 5,000); response lists it
 *   flagging Jordan as well    → 409 (one owner per business)                                          (bug: 200, two owners)
 *   POST a second is_owner row → 409                                                                   (bug: 201)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la3-owner-salary-crossing.js
 */
const { run } = require('./moneyFixKit.js');

run('LA3 — the owner can be marked on the roster, and mark-paid says what crossed to Personal', async ({ newOwner, eq }) => {
  const { http, J } = await newOwner('LA3', [{ name: 'Northwind LA3', currency: 'USD' }]);
  const salaryRows = async () => (await J('GET', '/api/personal-transactions')).filter(t => t.source === 'payroll');

  // Exactly what the Add employee form sent for the owner before the fix.
  const sam = await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Owner', gross: 5000, is_owner: false, deductions: [{ label: 'Income tax', value: 20, type: 'percent' }] });
  const jordan = await J('POST', '/api/payroll', { fname: 'Jordan', lname: 'Lee', gross: 3000, is_owner: false, deductions: [{ label: 'Income tax', value: 10, type: 'percent' }] });

  const r1 = await J('POST', '/api/payroll-runs', { period: 'September 2026', idempotency_key: 'la3-sep' });
  await J('PUT', '/api/payroll-runs/' + r1.id + '/approve', {});
  const p1 = await J('PUT', '/api/payroll-runs/' + r1.id + '/mark-paid', {});
  eq('nobody flagged → nothing crosses', (await salaryRows()).length, 0);
  eq('nobody flagged → mark-paid reports there was no owner on the run', p1.owner_salary && p1.owner_salary.ownerOnRun, false, undefined);

  // The fix: mark the existing employee as the owner (Edit employee → "This is me").
  await J('PUT', '/api/payroll/' + sam.id, { is_owner: true });
  const roster = await J('GET', '/api/payroll');
  eq('Sam is flagged owner after the edit', !!(roster.find(r => r.id === sam.id) || {}).is_owner, true, false);

  const r2 = await J('POST', '/api/payroll-runs', { period: 'October 2026', idempotency_key: 'la3-oct' });
  await J('PUT', '/api/payroll-runs/' + r2.id + '/approve', {});
  const p2 = await J('PUT', '/api/payroll-runs/' + r2.id + '/mark-paid', {});
  const rows = await salaryRows();
  eq('owner flagged → one Personal row', rows.length, 1, 0);
  eq('row = Sam NET 4,000 (not Jordan 2,700, not run net 6,700, not gross 5,000)', rows[0] && Number(rows[0].amount), 4000);
  eq('row currency = the business currency', rows[0] && rows[0].currency, 'USD');
  eq('mark-paid response lists what crossed', p2.owner_salary && p2.owner_salary.booked.map(b => [b.amount, b.currency, b.isNew]), [[4000, 'USD', true]], undefined);
  const p2b = await J('PUT', '/api/payroll-runs/' + r2.id + '/mark-paid', {});
  eq('repeat mark-paid: still one row, reported as not new', [(await salaryRows()).length, p2b.owner_salary.booked.map(b => b.isNew)], [1, [false]]);

  // One owner per business.
  const second = await http.request('PUT', '/api/payroll/' + jordan.id, { is_owner: true });
  eq('flagging a second owner is refused', second.status, 409, 200);
  const third = await http.request('POST', '/api/payroll', { fname: 'Pat', lname: 'Other', gross: 1000, is_owner: true });
  eq('creating a second owner is refused', third.status, 409, 201);
  const after = await J('GET', '/api/payroll');
  eq('still exactly one owner on the roster', after.filter(r => r.is_owner).map(r => r.fname), ['Sam']);

  // Void still removes it (M14 behaviour unchanged).
  await J('PUT', '/api/payroll-runs/' + r2.id + '/void', {});
  eq('void removes the owner-salary row', (await salaryRows()).length, 0);
});
