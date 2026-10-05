'use strict';
/**
 * verify-payment-reminders.js — executes the SHIPPED reminder engine (../../payment-reminders.js,
 * the exact function GET /api/payment-reminders calls) against a discriminating seed.
 *
 * Rule 4: every rule has a positive AND a near-miss negative — a paid invoice, a draft invoice, a
 * far-future invoice, a chronic vs non-chronic customer, a customer with no email.
 * Rule 6: expected counts are hand-computed from the seed, never read from the engine.
 *
 * UNEXECUTED here: the HTTP/auth wrapper and the Resend send path (no live email in a test). The
 * engine — prediction, candidate selection, severity, draft wording, email resolution — is fully
 * executed.
 *
 * Owner oracle (today = 2026-10-05):
 *   total = 5, overdue = 3, due_soon = 2, predicted_late = 1, missing_email = 1,
 *   total_outstanding = 2150.00
 */

const { buildReminderCandidates, daysBetween } = require('../../payment-reminders.js');

const today = '2026-10-05';
const customers = [
  { id: 1, company: 'Acme', fname: '', lname: '', email: 'acme@example.com' },
  { id: 2, company: '', fname: 'Bob', lname: 'Lee', email: 'bob@example.com' },
  { id: 3, company: 'Gamma', fname: '', lname: '', email: '' },            // no email
];
let iid = 0;
const inv = (client, amount, amount_paid, status, due_date, num) =>
  ({ id: ++iid, entity_id: 7, client, amount, amount_paid, status, due_date, num });

const invoices = [
  inv('Acme',    1000, 0,   'pending', '2026-08-01', 'INV-1'),   // #1 65d overdue → high, email
  inv('Bob Lee',  500, 100, 'partial', '2026-09-28', 'INV-2'),   // #2 7d overdue → medium, outstanding 400
  inv('Gamma',    300, 0,   'overdue', '2026-07-01', 'INV-3'),   // #3 overdue high, NO email
  inv('Acme',     200, 0,   'pending', '2026-10-10', 'INV-4'),   // #4 due in 5d → upcoming; Acme chronic → predicted_late
  inv('Acme',     999, 999, 'paid',    '2026-09-01', 'INV-5'),   // paid → NOT candidate
  inv('Zed',       50, 0,   'draft',   '2026-10-06', 'INV-6'),   // draft → NOT candidate
  inv('Delta',    400, 0,   'pending', '2026-11-30', 'INV-7'),   // 56d future → beyond window → NOT candidate
  inv('Bob Lee',  250, 0,   'pending', '2026-10-08', 'INV-8'),   // #8 due in 3d → upcoming; Beta NOT chronic
];
// A prior PAID Acme invoice (id 9) used only to establish Acme's late-payment history.
invoices.push({ id: ++iid, entity_id: 7, client: 'Acme', amount: 777, amount_paid: 777, status: 'paid', due_date: '2026-06-01', num: 'INV-0' });
const ACME_PRIOR_ID = iid;
// An invoice with no due date — must be skipped entirely.
invoices.push({ id: ++iid, entity_id: 7, client: 'Acme', amount: 123, amount_paid: 0, status: 'pending', due_date: null, num: 'INV-X' });

const payments = [
  { invoice_id: ACME_PRIOR_ID, payment_date: '2026-06-20', amount: 777 },   // Acme paid 19d late → chronic
];

let pass = 0, fail = 0;
const A = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); } };

// daysBetween sanity (symmetric UTC parse).
A('daysBetween 10-05 vs 08-01 = 65', daysBetween('2026-10-05', '2026-08-01') === 65, 'got ' + daysBetween('2026-10-05','2026-08-01'));
A('daysBetween 10-05 vs 10-10 = -5', daysBetween('2026-10-05', '2026-10-10') === -5);

const { items, summary } = buildReminderCandidates({ invoices, customers, payments, businessName: 'Saige Co', currency: 'USD', today });
const byInv = (id) => items.find(i => i.invoice_id === id);

A('total = 5 (got ' + summary.total + ')', summary.total === 5);
A('overdue = 3 (got ' + summary.overdue + ')', summary.overdue === 3);
A('due_soon = 2 (got ' + summary.due_soon + ')', summary.due_soon === 2);
A('predicted_late = 1 (got ' + summary.predicted_late + ')', summary.predicted_late === 1);
A('missing_email = 1 (got ' + summary.missing_email + ')', summary.missing_email === 1);
A('total_outstanding = 2150 (got ' + summary.total_outstanding + ')', summary.total_outstanding === 2150);

A('paid invoice (INV-5) excluded', !byInv(5));
A('draft invoice (INV-6) excluded', !byInv(6));
A('far-future invoice (INV-7) excluded', !byInv(7));
A('no-due-date invoice excluded', !items.some(i => i.invoice_id === iid));
A('prior paid Acme (history only) not a candidate', !byInv(ACME_PRIOR_ID));

A('INV-1 severity high', byInv(1) && byInv(1).severity === 'high', byInv(1) && byInv(1).severity);
A('INV-2 severity medium + outstanding 400', byInv(2) && byInv(2).severity === 'medium' && byInv(2).amount_outstanding === 400);
A('INV-3 high + no email (send blocked)', byInv(3) && byInv(3).severity === 'high' && byInv(3).has_email === false);
A('INV-4 upcoming + predicted_late TRUE (Acme chronic)', byInv(4) && byInv(4).severity === 'upcoming' && byInv(4).predicted_late === true);
A('INV-8 upcoming + predicted_late FALSE (Beta not chronic)', byInv(8) && byInv(8).severity === 'upcoming' && byInv(8).predicted_late === false);

A('email resolved via company (Acme)', byInv(1) && byInv(1).email === 'acme@example.com');
A('email resolved via fname+lname (Bob Lee)', byInv(2) && byInv(2).email === 'bob@example.com');
A('worst-first ordering (first item most overdue)', items.length && items[0].days_overdue === Math.max(...items.map(i => i.days_overdue)));

A('overdue draft subject says Overdue', byInv(1) && /overdue/i.test(byInv(1).draft.subject));
A('upcoming draft subject says due soon', byInv(4) && /due soon/i.test(byInv(4).draft.subject));
A('draft body carries amount + business signoff', byInv(1) && byInv(1).draft.body.includes('USD 1,000.00') && byInv(1).draft.body.includes('Saige Co'));

const empty = buildReminderCandidates({ invoices: [], customers: [], payments: [], today });
A('empty input → total 0', empty.summary.total === 0 && empty.items.length === 0);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
