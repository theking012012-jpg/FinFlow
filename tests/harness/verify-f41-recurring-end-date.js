'use strict';
/**
 * verify-f41-recurring-end-date — F41. A recurring bill can be given an end date in the form and on edit, and stops
 * there; every recurring type (bills, invoices, personal) checks the end date the same way on create and edit, and an
 * end date can be removed.
 *
 * Executed: the real /app in jsdom + the real server + scratch Postgres (Rule 3); the real recurring job.
 * Bug values (old code): the bill form had no end date; PUT /api/recurring-bills ignored end_date (the bill repeated:
 * 2 bills instead of 1); an end before the next run was stored (200); null could not remove an end on invoices.
 * Malformed dates were already refused by body-shape.js (INVALID_DATE) — asserted as controls.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f41-recurring-end-date.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };

(async () => {
  let h;
  console.log('\nF41 — recurring schedules end when told to\n');
  try {
    h = await bootSpaInJsdom({});
    await h.idle();
    const { http, client: c, window: w } = h;
    const data = async (t, id) => (await c.query(`SELECT data FROM ${t} WHERE id = $1`, [id])).rows[0].data;
    const count = async (t) => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;

    // ── the form ──
    w.openNewRecurringBillModal();
    A('the recurring-bill form has an end-date field, empty when opened (bug: no field)', !!w.document.getElementById('rb-end') && w.document.getElementById('rb-end').value === '');
    w.document.getElementById('rb-vendor').value = 'Ending Hosting';
    w.document.getElementById('rb-amount').value = '45';
    w.document.getElementById('rb-next').value = '2026-08-01';
    if (w.document.getElementById('rb-end')) w.document.getElementById('rb-end').value = '2026-12-31';
    await w.saveRecurringBill(); await h.idle();
    const formRow = (await c.query(`SELECT id, data FROM recurring_bills WHERE data->>'vendor' = 'Ending Hosting'`)).rows[0];
    A('saved from the form with its end date 2026-12-31', formRow && formRow.data.end_date === '2026-12-31', JSON.stringify(formRow && formRow.data));
    w.renderRecurringBills && w.renderRecurringBills();
    const listTxt = (w.document.getElementById('recurring-bills-list') || {}).textContent || '';
    A('the list shows "Ends: 2026-12-31"', /Ends: 2026-12-31/.test(listTxt), listTxt.slice(0, 200));

    // ── create: the value is checked, on every recurring type ──
    const CREATE = [
      ['/api/recurring-bills', 'recurring_bills', { vendor: 'V1', amount: 10, frequency: 'Monthly', next_run: '2026-08-01' }],
      ['/api/recurring-invoices', 'recurring_invoices', { client: 'C1', amount: 10, frequency: 'Monthly', next_run: '2026-08-01' }],
      ['/api/recurring-personal-transactions', 'recurring_personal_transactions', { description: 'P1', amount: 10, frequency: 'Monthly', next_run: '2026-08-01' }],
    ];
    for (const [route, table, body] of CREATE) {
      // Malformed dates: refused already by body-shape.js for every /api write (INVALID_DATE) — controls, not the bug.
      for (const [bad, codes, why] of [['soon', ['INVALID_DATE', 'BAD_END_DATE'], 'control'], ['2026-02-31', ['INVALID_DATE', 'BAD_END_DATE'], 'control'],
                                      ['2026-07-15', ['END_BEFORE_NEXT_RUN'], 'bug: 200, stored']]) {
        const n0 = await count(table);
        const r = await http.post(route, Object.assign({}, body, { end_date: bad }));
        A(`POST ${route} end "${bad}" → 400 ${codes[0]}, nothing stored (${why})`, r.status === 400 && r.json && codes.includes(r.json.code) && (await count(table)) === n0, `${r.status} ${String(r.text).slice(0, 120)}`);
      }
    }

    // ── edit: a bill's end date is saved and can be removed (bug: ignored) ──
    const b = (await http.post('/api/recurring-bills', { vendor: 'Edit Me', amount: 20, frequency: 'Monthly', next_run: '2026-08-01' })).json;
    await http.request('PUT', '/api/recurring-bills/' + b.id, { end_date: '2027-03-31' });
    A('PUT a bill\'s end date 2027-03-31 → saved (bug: ignored)', (await data('recurring_bills', b.id)).end_date === '2027-03-31', JSON.stringify(await data('recurring_bills', b.id)));
    const badPut = await http.request('PUT', '/api/recurring-bills/' + b.id, { end_date: '2026-07-01' });
    A('PUT an end before the next run → 400, unchanged', badPut.status === 400 && (await data('recurring_bills', b.id)).end_date === '2027-03-31', `${badPut.status}`);
    await http.request('PUT', '/api/recurring-bills/' + b.id, { end_date: null });
    A('PUT end null → removed (repeats until stopped)', (await data('recurring_bills', b.id)).end_date === null, JSON.stringify(await data('recurring_bills', b.id)));
    const ri = (await http.post('/api/recurring-invoices', { client: 'Inv Ends', amount: 30, frequency: 'Monthly', next_run: '2026-08-01', end_date: '2026-12-31' })).json;
    await http.request('PUT', '/api/recurring-invoices/' + ri.id, { end_date: null });
    A('PUT a recurring invoice\'s end null → removed (bug: ignored)', (await data('recurring_invoices', ri.id)).end_date === null, JSON.stringify(await data('recurring_invoices', ri.id)));
    const rp = (await http.post('/api/recurring-personal-transactions', { description: 'Gym', amount: 30, frequency: 'Monthly', next_run: '2026-08-01' })).json;
    const rpBad = await http.request('PUT', '/api/recurring-personal-transactions/' + rp.id, { end_date: 'whenever' });
    A('PUT personal end "whenever" → 400, not stored (control — body-shape)', rpBad.status === 400 && (await data('recurring_personal_transactions', rp.id)).end_date == null, `${rpBad.status} ${JSON.stringify(await data('recurring_personal_transactions', rp.id))}`);

    // ── the job: an end set by EDIT stops the bill (bug: it repeated) ──
    const j = (await http.post('/api/recurring-bills', { vendor: 'Stops In June', amount: 70, frequency: 'Monthly', next_run: '2026-06-01' })).json;
    await http.request('PUT', '/api/recurring-bills/' + j.id, { end_date: '2026-06-30' });
    const jobs = require('../../server.js')._jobs;
    await jobs.recurring(); await jobs.recurring();
    const made = (await c.query(`SELECT count(*)::int n FROM bills WHERE data->>'vendor' = 'Stops In June'`)).rows[0].n;
    A('the job makes the June bill only, then completes the schedule (bug: 2 bills — July too)', made === 1 && (await data('recurring_bills', j.id)).status === 'completed', `bills=${made} status=${(await data('recurring_bills', j.id)).status}`);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (h) { try { await h.stop(); } catch (_) {} } }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F41 recurring end date)\n`);
  process.exitCode = fail ? 1 : 0;
})();
