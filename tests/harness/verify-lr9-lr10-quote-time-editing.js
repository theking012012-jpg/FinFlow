'use strict';
/**
 * verify-lr9-lr10-quote-time-editing.js — LR9 / LR10 (owner decision 2026-10-21: build quote + time editing and
 * quote → invoice, better and more secure). The edit routes existed with no caller and checked almost nothing.
 *
 * Real scratch Postgres, real routes, two businesses. What the old code gives (Rule 4) beside each check:
 *  QUOTES
 *   1. edit pending quote 1,000 → 1,500, audited                                  (old: same — GUARD)
 *   2. status set to "converted" by an edit → 400                                 (old: 200, any status)
 *   3. convert → invoice 1,500 linked to the quote; quote "converted" + invoice_id (old: quote untouched)
 *   4. convert again with a DIFFERENT key → the same invoice, still 1 invoice      (old: a second invoice)
 *   5. edit / delete a converted quote → 409                                      (old: 200 / 200)
 *   6. convert a declined quote → 409                                             (old: 201)
 *   7. edit a quote of business A while business B is in view → 404              (old: 200)
 *  TIME
 *   8. edit hours 2 → 3.5, audited                                                (old: same — GUARD)
 *   9. hours 30 or rate −5 → 400                                                  (old: 30 h saved; −5 already refused)
 *  10. with June locked: log time on 20 Jun → refused; move a July entry to 20 Jun → refused; edit / delete an
 *      entry already dated in June → refused                                      (old: 201 / 200 / 200 / 200)
 *  11. edit / delete an entry of business A while business B is in view → 404     (old: 200 / 200)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lr9-lr10-quote-time-editing.js
 */
const { run } = require('./moneyFixKit.js');

run('LR9 / LR10 — quotes and time entries are editable, with every lock enforced on the server', async ({ newOwner, c, eq }) => {
  const { uid, http, J, ids } = await newOwner('LR9', [{ name: 'Alpha LR9', currency: 'USD' }, { name: 'Beta LR9', currency: 'USD' }]);
  const [A, B] = ids;
  const req = (m, p, b) => http.request(m, p, b);
  const activate = id => J('POST', '/api/entities/' + id + '/activate', {});
  await activate(A);

  // ── QUOTES ──
  const q = await J('POST', '/api/quotes', { client: 'Bright Labs', amount: 1000, status: 'pending', expiry_date: '2026-08-31' });
  const e1 = await req('PUT', '/api/quotes/' + q.id, { amount: 1500 });
  const a1 = (await c.query(`SELECT old_data->>'amount' o, new_data->>'amount' n FROM audit_trail WHERE table_name='quotes' AND record_id=$1 AND action='UPDATE' ORDER BY id DESC LIMIT 1`, [q.id])).rows[0];
  eq('1. edit 1,000 → 1,500 is saved and audited (guard)', [e1.status, a1 && Number(a1.o), a1 && Number(a1.n)], [200, 1000, 1500]);
  eq('2. an edit cannot set status "converted"', (await req('PUT', '/api/quotes/' + q.id, { status: 'converted' })).status, 400, 200);

  const inv1 = await req('POST', '/api/invoices', { client: 'Bright Labs', amount: 1500, status: 'pending', issue_date: '2026-07-20', due_date: '2026-08-19', from_quote_id: q.id, idempotency_key: 'client-key-1' });
  const qAfter = (await J('GET', '/api/quotes')).find(x => x.id === q.id) || {};
  eq('3. convert → an invoice of 1,500 linked to the quote; the quote is converted and points at it',
    [inv1.status, inv1.json && Number(inv1.json.amount), inv1.json && inv1.json.from_quote_id, qAfter.status, qAfter.invoice_id],
    [201, 1500, q.id, 'converted', inv1.json && inv1.json.id], [201, 1500, undefined, 'pending', undefined]);
  const inv2 = await req('POST', '/api/invoices', { client: 'Bright Labs', amount: 1500, status: 'pending', issue_date: '2026-07-20', from_quote_id: q.id, idempotency_key: 'client-key-2' });
  const nInv = (await c.query(`SELECT COUNT(*)::int n FROM invoices WHERE user_id=$1 AND data->>'client'='Bright Labs'`, [uid])).rows[0].n;
  eq('4. converting again (another key) → the SAME invoice; one invoice in the books', [inv2.json && inv2.json.id, nInv], [inv1.json && inv1.json.id, 1], [undefined, 2]);
  eq('5. a converted quote cannot be edited or deleted', [(await req('PUT', '/api/quotes/' + q.id, { amount: 9 })).status, (await req('DELETE', '/api/quotes/' + q.id)).status], [409, 409], [200, 200]);

  const qd = await J('POST', '/api/quotes', { client: 'Delta Retail', amount: 400, status: 'declined' });
  eq('6. a declined quote cannot become an invoice', (await req('POST', '/api/invoices', { client: 'Delta Retail', amount: 400, status: 'pending', issue_date: '2026-07-20', from_quote_id: qd.id })).status, 409, 201);

  const qa = await J('POST', '/api/quotes', { client: 'Acme', amount: 250, status: 'pending' });
  await activate(B);
  eq('7. a quote of Alpha is not editable while Beta is in view', (await req('PUT', '/api/quotes/' + qa.id, { amount: 1 })).status, 404, 200);
  await activate(A);

  // ── TIME ──
  const t = await J('POST', '/api/timesheet', { employee: 'Sam', date: '2026-07-10', hours: 2, billable: 'Yes', rate: 100 });
  const t1 = await req('PUT', '/api/timesheet/' + t.id, { hours: 3.5 });
  const a8 = (await c.query(`SELECT old_data->>'hours' o, new_data->>'hours' n FROM audit_trail WHERE table_name='timesheet' AND record_id=$1 AND action='UPDATE' ORDER BY id DESC LIMIT 1`, [t.id])).rows[0];
  eq('8. edit 2h → 3.5h is saved and audited (guard)', [t1.status, a8 && Number(a8.o), a8 && Number(a8.n)], [200, 2, 3.5]);
  eq('9. 30 hours in a day, or a negative rate, is refused', [(await req('PUT', '/api/timesheet/' + t.id, { hours: 30 })).status, (await req('PUT', '/api/timesheet/' + t.id, { rate: -5 })).status], [400, 400], [200, 400]);

  const june = await J('POST', '/api/timesheet', { employee: 'Lee', date: '2026-06-15', hours: 1, billable: 'No', rate: 0 });   // logged before the lock
  await J('POST', '/api/lock-settings', { enabled: true, lock_date: '2026-06-30' });
  const s10 = [
    (await req('POST', '/api/timesheet', { employee: 'Kim', date: '2026-06-20', hours: 1, billable: 'No' })).status,
    (await req('PUT', '/api/timesheet/' + t.id, { date: '2026-06-20' })).status,
    (await req('PUT', '/api/timesheet/' + june.id, { hours: 2 })).status,
    (await req('DELETE', '/api/timesheet/' + june.id)).status,
  ].map(s => s >= 400 && s < 500 ? 'refused' : s);
  eq('10. with June locked: log in June, move into June, edit / delete a June entry — all refused', s10, ['refused', 'refused', 'refused', 'refused'], [201, 200, 200, 200]);
  const tRow = (await c.query(`SELECT data->>'date' d FROM timesheet WHERE id=$1`, [t.id])).rows[0];
  eq('10. …and the July entry kept its date', tRow && tRow.d, '2026-07-10', '2026-06-20');

  await activate(B);
  eq('11. an entry of Alpha cannot be edited or deleted while Beta is in view', [(await req('PUT', '/api/timesheet/' + t.id, { hours: 1 })).status, (await req('DELETE', '/api/timesheet/' + t.id)).status], [404, 404], [200, 200]);
});
